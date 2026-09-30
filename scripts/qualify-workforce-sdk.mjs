// Explicit local-only qualification of the SDK candidate through the REAL gateway server.
// TEST_DATABASE_URL must name a migrated disposable DB; SDK and gateway paths are explicit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import pg from 'pg';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';
import { createWorkforceResource } from '../src/server/services/workforceResources.js';
import { admitRun } from '../src/server/services/workforceRunAdmission.js';
import { reportRunResult } from '../src/server/services/workforceRunResults.js';
import { createServiceLedgerRouter } from '../src/server/routes/serviceLedgerRoutes.js';
import { addGrant, getBalanceV2 } from '../src/server/utils/creditLedgerV2.js';
import { jwks } from '../src/server/utils/oidcProvider.js';
import { revokeRun } from '../src/server/services/workforceRunAuthority.js';

const url = process.env.TEST_DATABASE_URL;
test('SDK physical dispatches traverse gateway auth, run draws, provider and canonical ledger', { timeout: 90000 }, async t => {
  const pool = new pg.Pool({ connectionString: requireProofDatabase(url), max: 12 }); t.after(() => pool.end());
  const gateway = resolve(process.env.WORKFORCE_GATEWAY_SOURCE || ''), sdk = resolve(process.env.WORKFORCE_SDK_SOURCE || '');
  assert(process.env.WORKFORCE_GATEWAY_SOURCE && process.env.WORKFORCE_SDK_SOURCE, 'Explicit candidate paths required');
  assert(!existsSync(join(gateway, '.env')), 'Gateway fixture must not load any local env file');
  const sdkRevision = process.env.WORKFORCE_SDK_COMMIT;
  assert.match(sdkRevision || '', /^[a-f0-9]{40}$/);
  assert.equal(execFileSync('git', ['-C', sdk, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sdkRevision);
  assert.equal(execFileSync('git', ['-C', sdk, 'status', '--porcelain', '--', 'src', 'package.json', 'tsup.config.ts'], { encoding: 'utf8' }).trim(), '', 'SDK source must match its declared candidate');
  const revision = process.env.WORKFORCE_GATEWAY_COMMIT;
  assert.match(revision || '', /^[a-f0-9]{40}$/);
  assert.equal(execFileSync('git', ['-C', gateway, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), revision);
  const files = execFileSync('git', ['-C', gateway, 'ls-tree', '-r', '--name-only', revision], { encoding: 'utf8' }).trim().split('\n');
  for (const file of files.filter(f => /\.(js|mjs|cjs|json)$/.test(f) && !f.startsWith('test/') && !f.startsWith('scripts/'))) {
    const committed = execFileSync('git', ['-C', gateway, 'cat-file', 'blob', `${revision}:${file}`]);
    assert.equal(readFileSync(join(gateway, file), 'utf8').replaceAll('\r\n', '\n'), committed.toString('utf8').replaceAll('\r\n', '\n'), `gateway candidate source ${file}`);
  }
  process.env.XENO_AGENT_HOME = mkdtempSync(join(tmpdir(), 'workforce-sdk-proof-'));
  const { AgentLoop, PermissionEngine, ToolRegistry } = await import(pathToFileURL(join(sdk, 'dist/index.js')).href);
  const { createWorkforceRunAuthority } = await import(pathToFileURL(join(sdk, 'dist/workforce/index.js')).href);
  const name = randomUUID();
  const owner = (await pool.query("INSERT INTO users(username,email,password_hash,display_name,email_verified) VALUES($1,$2,'fixture',$1,true) RETURNING id", [name, `${name}@example.test`])).rows[0].id;
  await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)', [owner]);
  const ceiling = 100000000;
  await addGrant(pool, owner, { amountMicro: ceiling, kind: 'paid', sourceRef: `sdk-proof:${name}` });
  const apiKey = 'xeno-' + randomUUID().replaceAll('-', '') + randomUUID().slice(0, 16).replaceAll('-', '');
  await pool.query('INSERT INTO api_keys(user_id,key_prefix,key_hash,name) VALUES($1,$2,$3,$4)', [owner, apiKey.slice(0, 16), createHash('sha256').update(apiKey).digest('hex'), 'local SDK proof']);
  const context = { actorUserId: owner, clientId: 'legacy-workforce-session' };
  const made = await createWorkforceResource(pool, context, { operationId: randomUUID(), kind: 'agent', name: 'Local fixture', owner: { type: 'user', id: owner },
    definition: { schemaVersion: 1, instructions: 'Fixture', skills: [], requestedCapabilities: [] } });
  const admitted = await admitRun(pool, context, { operationId: randomUUID(), expectedActorAccountId: owner,
    agent: { resourceId: made.resource.id, version: made.version.version, contentHash: made.version.contentHash },
    target: { kind: 'personal', ownerUserId: owner }, capabilities: [], runtimeCapabilities: [], budget: { ceilingMicro: String(ceiling) } });
  const admissionId = admitted.admission.admissionId;
  assert.equal((await getBalanceV2(pool, owner)).availableMicro, 0, 'one root reserves the entire wallet');
  const serviceToken = `fixture-${randomUUID()}`;
  process.env.JWT_SECRET ||= `local-proof-${randomUUID()}`;
  const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
  const accountToken = jwt.sign({ userId: owner }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const { default: workforceRouter } = await import('../src/server/routes/workforceRoutes.js');
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.db = pool; next(); });
  app.get('/api/oauth2/jwks', async (_req, res) => res.json(await jwks(pool)));
  app.use('/api/workforce', workforceRouter);
  app.use('/api/v2/ledger/service', createServiceLedgerRouter({ getServiceToken: () => serviceToken }));
  const serve = async app => { const s = app.listen(0, '127.0.0.1'); await new Promise(r => s.once('listening', r)); t.after(async () => { s.closeAllConnections(); await new Promise(r => s.close(r)); }); return s; };
  const platformServer = await serve(app), platformUrl = `http://127.0.0.1:${platformServer.address().port}`;
  let providerCalls = 0, streamedCalls = 0, observeStream;
  const streamObserved = new Promise(resolve => { observeStream = resolve; });
  const provider = express(); provider.use(express.json());
  provider.get('/v1/models', (_req, res) => res.json({ data: [{ id: 'gpt-5.5', owned_by: 'openai', object: 'model' }] }));
  provider.post('/v1/chat/completions', async (req, res) => {
    const draws = (await pool.query("SELECT * FROM credit_hold_draws WHERE admission_id=$1 AND state='open'", [admissionId])).rows;
    assert.equal(draws.length, 1, 'provider has one admitted open draw before execution');
    assert.equal(req.body.max_tokens, 100, 'provider receives enforceable output bound');
    providerCalls++;
    if (req.body.stream === true) {
      streamedCalls++;
      res.type('text/event-stream');
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `reply-${providerCalls}` }, finish_reason: null }] })}\n\n`);
      await Promise.race([streamObserved, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('SDK did not receive streaming content before provider completion')), 5000); timer.unref(); })]);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }
    res.json({ model: 'gpt-5.5', choices: [{ message: { role: 'assistant', content: `reply-${providerCalls}` }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  });
  const providerServer = await serve(provider), providerUrl = `http://127.0.0.1:${providerServer.address().port}`;
  const portServer = await serve(express()), gatewayPort = portServer.address().port;
  await new Promise(r => portServer.close(r));
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
  const home = mkdtempSync(join(tmpdir(), 'workforce-gateway-proof-'));
  const env = Object.fromEntries(['PATH','Path','SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  Object.assign(env, { NODE_ENV: 'test', HOST: '127.0.0.1', HOME: home, USERPROFILE: home,
    PLATFORM_DATABASE_URL: url, PLATFORM_API_KEY_LIVE_MODE: 'true', PLATFORM_CREDIT_LIVE_MODE: 'true',
    PLATFORM_LEDGER_BASE_URL: platformUrl, PLATFORM_LEDGER_SERVICE_TOKEN: serviceToken, PLATFORM_ACCOUNT_BASE_URL: platformUrl,
    OIDC_ISSUER: platformUrl, OIDC_JWKS_URL: platformUrl + '/api/oauth2/jwks', PUBLIC_API_ORIGIN: gatewayUrl,
    XENO_PROXY_URL: providerUrl, ANTIGRAVITY_URL: providerUrl, MIRASIM_RELAY_GATEWAY_URL: providerUrl,
    XENO_PROXY_GATEWAY_KEY: 'fixture-provider-key', MIRASIM_API_KEY: 'fixture-relay-key',
    GLABS_URL: providerUrl, H200_URL: providerUrl, ARK_BASE_URL: providerUrl, NVIDIA_BASE_URL: providerUrl,
    CODEX_IMG_URL: providerUrl, CHATJIMMY_URL: providerUrl, DREAMINA_URL: providerUrl,
    GLABS_MODELS_ENABLED: 'false', ARK_MODELS_ENABLED: 'false', H200_MODELS_ENABLED: 'false', NVIDIA_MODELS_ENABLED: 'false', CHATJIMMY_MODELS_ENABLED: 'false',
    XEP_ENABLED: 'false', DREAMINA_XEP_ENABLED: 'false', DREAMINA_SERVICE_ENV_FILE: join(home, 'absent.env'),
    MODEL_AVAILABILITY_STATUS_PATH: join(home, 'absent-status.json'), EXTERNAL_DOCS_DIR: home,
    WORKFORCE_LOOPBACK_PORTS: JSON.stringify([new URL(url).port, platformServer.address().port, providerServer.address().port].map(Number)) });
  let logs = '';
  const child = spawn(process.execPath, ['--import', new URL('./lib/workforce-loopback-only.mjs', import.meta.url).href, 'server.js', `--port=${gatewayPort}`], { cwd: gateway, env, stdio: ['ignore','pipe','pipe'] });
  child.stdout.on('data', c => { logs = (logs + c).slice(-24000); }); child.stderr.on('data', c => { logs = (logs + c).slice(-24000); });
  const exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([exited, new Promise(resolve => { const timer = setTimeout(resolve, 3000); timer.unref(); })]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await exited;
  });
  let ready = false;
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) assert.fail(`Gateway exited ${child.exitCode}: ${logs.replaceAll(apiKey, '[fixture-key]')}`);
    try { const response = await fetch(gatewayUrl + '/health', { signal: AbortSignal.timeout(500) }); await response.arrayBuffer(); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  assert(ready, 'real gateway must reach its local listener before qualification');
  const invalid = await fetch(gatewayUrl + '/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer xeno-invalid-fixture', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-5.5', messages: [{ role: 'user', content: 'denied' }], max_tokens: 100 }) });
  assert.equal(invalid.status, 401, 'real gateway refuses an invalid account key');
  assert.equal(providerCalls, 0, 'failed authentication reaches no provider');
  const sequences = new Map(); let exchanges = 0;
  const authority = createWorkforceRunAuthority({ issuer: 'https://platform.test', admissionId,
    authorizeRequest: async () => ({ authorization: `Bearer ${accountToken}` }), capabilityForTool: () => null,
    sequenceStore: { read: id => sequences.get(id) ?? null, write: (id, seq) => { sequences.set(id, seq); } },
    fetchImpl: (target, options) => { if (options.method === 'POST') exchanges++; return fetch(String(target).replace('https://platform.test', platformUrl), options); } });
  const agent = new AgentLoop({ apiKey, baseURL: gatewayUrl, model: 'gpt-5.5', maxTokens: 100, maxIterations: 2, systemPrompt: 'Reply briefly.',
    toolRegistry: new ToolRegistry(), permissionEngine: new PermissionEngine({ mode: 'bypassPermissions' }), runAuthority: authority });
  try { assert.match(await agent.run('one'), /reply-1/); assert.match(await agent.run('two'), /reply-2/); }
  catch (error) { assert.fail(`Composed turn failed: ${error.message}; gateway=${logs.replaceAll(apiKey, '[fixture-key]')}`); }
  const streamedText = [];
  const streamingAgent = new AgentLoop({ apiKey, baseURL: gatewayUrl, model: 'gpt-5.5', maxTokens: 100, maxIterations: 2, systemPrompt: 'Reply briefly.',
    streamAgentResponses: true, onText: text => { streamedText.push(text); observeStream(); },
    toolRegistry: new ToolRegistry(), permissionEngine: new PermissionEngine({ mode: 'bypassPermissions' }), runAuthority: authority });
  assert.match(await streamingAgent.run('stream three'), /reply-3/);
  assert.equal(streamedText.join(''), 'reply-3', 'SDK receives real stream content before provider completion');
  assert.equal(streamedCalls, 1, 'one request traverses the actual gateway streaming relay');
  assert.deepEqual({ input: streamingAgent.tokenUsage.input, output: streamingAgent.tokenUsage.output }, { input: 10, output: 5 }, 'SDK consumes the gateway terminal usage frame');
  assert.equal(exchanges, 3, 'N physical SDK calls exchange N fresh leases');
  assert.equal(providerCalls, 3, 'buffered and streamed calls reach the real gateway provider route');
  // SSE completion is transport completion, not the ledger's settlement acknowledgement.
  // Observe durable draw state with a bounded wait; never equate [DONE] with charged.
  let draws;
  for (let attempt = 0; attempt < 100; attempt++) {
    draws = (await pool.query('SELECT * FROM credit_hold_draws WHERE admission_id=$1 ORDER BY created_at', [admissionId])).rows;
    if (draws.length === 3 && draws.every(draw => draw.state === 'settled')) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(draws.length, 3, 'N calls create N draws on one admission');
  assert.equal(new Set(draws.map(d => d.lease_hash)).size, 3, 'ledger consumes distinct leases');
  assert(draws.every(d => d.state === 'settled' && d.outcome === 'measured' && String(d.input_tokens) === '10' && String(d.output_tokens) === '5'), `all provider responses settle measured usage: ${JSON.stringify(draws.map(d => ({ state: d.state, outcome: d.outcome, input: d.input_tokens, output: d.output_tokens })))}`);
  assert.equal((await pool.query('SELECT count(*)::int n FROM credit_holds WHERE user_id=$1', [owner])).rows[0].n, 1, 'gateway creates no second wallet hold');
  await reportRunResult(pool, context, { admissionId, outcome: 'completed', summary: 'Local proof completed', artifacts: [] });
  assert.equal((await pool.query('SELECT state FROM credit_holds WHERE hold_id=$1', [admissionId])).rows[0].state, 'settled', 'terminal run releases the remaining reservation');
  const charged = draws.reduce((sum, d) => sum + BigInt(d.charged_micro), 0n);
  assert.equal(BigInt((await getBalanceV2(pool, owner)).availableMicro), BigInt(ceiling) - charged, 'wallet conservation matches measured draw charges');
  const revoked = await admitRun(pool, context, { operationId: randomUUID(), expectedActorAccountId: owner,
    agent: { resourceId: made.resource.id, version: made.version.version, contentHash: made.version.contentHash },
    target: { kind: 'personal', ownerUserId: owner }, capabilities: [], runtimeCapabilities: [], budget: { ceilingMicro: '1000000' } });
  const revokedId = revoked.admission.admissionId;
  const revokedAuthority = createWorkforceRunAuthority({ issuer: 'https://platform.test', admissionId: revokedId,
    authorizeRequest: async () => ({ authorization: `Bearer ${accountToken}` }), capabilityForTool: () => null,
    sequenceStore: { read: id => sequences.get(id) ?? null, write: (id, seq) => { sequences.set(id, seq); } },
    fetchImpl: (target, options) => fetch(String(target).replace('https://platform.test', platformUrl), options) });
  await revokeRun(pool, context, revokedId);
  agent.configureModelExecution({ runAuthority: revokedAuthority });
  await assert.rejects(agent.run('must not dispatch after revoke'), error => (error.reason ?? error.cause?.reason) === 'admission_revoked', 'real platform revocation stops the next SDK request');
  assert.equal(providerCalls, 3, 'revoked authority reaches no provider');
  assert.equal((await pool.query('SELECT count(*)::int n FROM credit_hold_draws WHERE admission_id=$1', [revokedId])).rows[0].n, 0, 'revocation creates no new draw');
  assert(!logs.includes('WORKFORCE_FIXTURE_EGRESS_REFUSED'), 'gateway made no unexpected outbound call');
  const bundles = Object.fromEntries(['dist/index.js', 'dist/workforce/index.js'].map(file => [file, createHash('sha256').update(readFileSync(join(sdk, file))).digest('hex')]));
  console.log('Qualification evidence:', JSON.stringify({ sdkRevision, bundles, gatewayRevision: revision, providerCalls, draws: draws.length }));
});
