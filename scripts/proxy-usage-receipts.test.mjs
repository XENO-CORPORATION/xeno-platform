// The proxy receipt verifier, through the real service route and ledger, against a local receipt
// server that behaves like xeno-proxy's GET /v0/usage-receipts/:dispatchId.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync, createHash } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';
import { createWorkforceResource } from '../src/server/services/workforceResources.js';
import { admitRun } from '../src/server/services/workforceRunAdmission.js';
import { authorizeRunStep } from '../src/server/services/workforceRunAuthority.js';
import { reportRunResult } from '../src/server/services/workforceRunResults.js';
import { createProxyReceiptVerifier, proxyReceiptVerifierFromEnv } from '../src/server/services/proxyUsageReceipts.js';
import { createServiceLedgerRouter } from '../src/server/routes/serviceLedgerRoutes.js';
import * as ledger from '../src/server/utils/creditLedgerV2.js';

const url = process.env.TEST_DATABASE_URL;
test('late corrections are certified only by the proxy receipt fetched by the platform itself', { skip: !url, timeout: 60000 }, async t => {
  const pool = new pg.Pool({ connectionString: requireProofDatabase(url), max: 8 }); t.after(() => pool.end());
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signingKey = { kid: 'receipt-fixture', privatePem: key.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const mark = randomUUID();
  const owner = (await pool.query("INSERT INTO users(username,email,password_hash,display_name) VALUES($1,$2,'fixture',$1) RETURNING id", [mark, `${mark}@example.test`])).rows[0].id;
  await pool.query("INSERT INTO xeno_account_plans(user_id,plan,status) VALUES($1,'internal','active')", [owner]);
  await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)', [owner]);
  await ledger.addGrant(pool, owner, { amountMicro: 100000, kind: 'paid', priority: 10, sourceRef: `receipt:${mark}` });
  const ctx = { actorUserId: owner, clientId: 'xeno-agent-interface' };
  const resource = await createWorkforceResource(pool, ctx, { operationId: randomUUID(), kind: 'agent', name: 'Receipt fixture', owner: { type: 'user', id: owner }, definition: { schemaVersion: 1, instructions: 'Fixture', skills: [], requestedCapabilities: [] } });
  const admissionId = (await admitRun(pool, ctx, { operationId: randomUUID(), agent: { resourceId: resource.resource.id, version: resource.version.version, contentHash: resource.version.contentHash }, target: { kind: 'personal', ownerUserId: owner }, capabilities: [], budget: { ceilingMicro: '100000' } })).admission.admissionId;
  const lease = (await authorizeRunStep(pool, ctx, { admissionId, operation: 'provider_dispatch' }, { signingKey })).token;
  const drawId = `draw-${randomUUID()}`;
  await ledger.openRunDrawV2(pool, { admissionId, actorUserId: owner, drawId, lease, model: 'claude-opus-5', inputBound: 10, outputBound: 10 });
  // The gateway settles a cut stream unmeasured; its draw id is the dispatch id the proxy filed under.
  await ledger.settleRunDrawV2(pool, { admissionId, drawId, providerRequestId: drawId, provider: 'xeno-proxy', model: 'claude-opus-5', measured: false });
  await reportRunResult(pool, ctx, { admissionId, outcome: 'completed', summary: 'cut stream', artifacts: [] });
  const draw = (await pool.query('SELECT * FROM credit_hold_draws WHERE draw_id=$1', [drawId])).rows[0];
  const tariff = draw.tariff;

  // The receipt server. Claude-shaped counts: input excludes cache tokens.
  const readerKey = `reader-${randomUUID()}`;
  const receipts = new Map();
  let reads = 0;
  const proxy = express();
  proxy.get('/v0/usage-receipts/:id', (req, res) => {
    reads++;
    if (req.headers.authorization !== `Bearer ${readerKey}`) return res.status(401).json({ error: 'unauthorized' });
    const r = receipts.get(req.params.id);
    if (!r) return res.status(404).json({ error: 'not_found' });
    res.json({ receipt: r, evidenceHash: createHash('sha256').update(JSON.stringify(r)).digest('hex'), certifies: r.status === 'completed' });
  });
  const listen = app => new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const proxyServer = await listen(proxy);
  t.after(() => new Promise(r => { proxyServer.closeAllConnections(); proxyServer.close(r); }));
  const proxyUrl = `http://127.0.0.1:${proxyServer.address().port}`;

  assert.equal(createProxyReceiptVerifier({ baseUrl: proxyUrl }), null, 'no reader key: no verifier');
  assert.equal(proxyReceiptVerifierFromEnv({}), null, 'unconfigured environment keeps corrections closed');

  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/svc', createServiceLedgerRouter({ getServiceToken: () => 'svc', verifyCorrectionReceipt: createProxyReceiptVerifier({ baseUrl: proxyUrl, readerKey }) }));
  const platform = await listen(app);
  t.after(() => new Promise(r => { platform.closeAllConnections(); platform.close(r); }));
  const correct = body => fetch(`http://127.0.0.1:${platform.address().port}/svc/runs/${admissionId}/draws/${drawId}/corrections`,
    { method: 'POST', headers: { authorization: 'Bearer svc', 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

  assert.equal((await correct()).status, 403, 'no receipt yet: nothing is certified');
  receipts.set(drawId, { dispatchId: drawId, status: 'truncated', provider: 'claude', model: 'claude-opus-5', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
  assert.equal((await correct()).status, 403, 'a truncated receipt never certifies counts');
  receipts.set(drawId, { dispatchId: 'draw-someone-else-000', status: 'completed', provider: 'claude', model: 'claude-opus-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 });
  assert.equal((await correct()).status, 403, 'a receipt filed under another dispatch cannot certify this draw');
  receipts.set(drawId, { dispatchId: drawId, status: 'completed', provider: 'claude', model: 'claude-opus-5', inputTokens: 2, outputTokens: 3, cacheReadTokens: 4, cacheCreationTokens: 1, reasoningTokens: 0 });
  const before = BigInt((await ledger.getBalanceV2(pool, owner)).availableMicro);
  const body = { inputTokens: 0, outputTokens: 0 }; // caller counts are ignored, not trusted
  const res = await correct(body);
  const result = await res.json();
  assert.equal(res.status, 200, JSON.stringify(result));
  const billedInput = 2n + 4n + 1n; // conservative: cache tokens count as input
  const priced = BigInt(tariff.inputMicroPerToken) * billedInput + BigInt(tariff.outputMicroPerToken) * 3n;
  assert.equal(result.correctedPricedMicro, priced.toString(), 'priced from the receipt at the pinned tariff, cache tokens included');
  assert.equal(result.correctionMicro, (BigInt(draw.charged_micro) - priced).toString());
  assert.equal(BigInt((await ledger.getBalanceV2(pool, owner)).availableMicro) - before, BigInt(result.restoredMicro));
  const stored = (await pool.query('SELECT correction_source_id,provider_receipt_id,input_tokens,output_tokens FROM credit_draw_corrections WHERE draw_row_id=$1', [draw.id])).rows[0];
  assert.deepEqual([stored.correction_source_id, stored.provider_receipt_id, stored.input_tokens, stored.output_tokens], [`proxy:${drawId}`, drawId, '7', '3']);
  assert.equal((await (await correct()).json()).replayed, true, 'the same receipt corrects once');
  assert(reads >= 5, 'every decision fetched the receipt from the proxy');

  // The background reconciler finds a second cut draw by itself and applies its receipt once.
  const { reconcileUnmeasuredDraws } = await import('../src/server/services/proxyUsageReceipts.js');
  const admission2 = (await admitRun(pool, ctx, { operationId: randomUUID(), agent: { resourceId: resource.resource.id, version: resource.version.version, contentHash: resource.version.contentHash }, target: { kind: 'personal', ownerUserId: owner }, capabilities: [], budget: { ceilingMicro: '50000' } })).admission.admissionId;
  const lease2 = (await authorizeRunStep(pool, ctx, { admissionId: admission2, operation: 'provider_dispatch' }, { signingKey })).token;
  const draw2 = `draw-${randomUUID()}`;
  await ledger.openRunDrawV2(pool, { admissionId: admission2, actorUserId: owner, drawId: draw2, lease: lease2, model: 'claude-opus-5', inputBound: 10, outputBound: 10 });
  await ledger.settleRunDrawV2(pool, { admissionId: admission2, drawId: draw2, providerRequestId: draw2, provider: 'xeno-proxy', model: 'claude-opus-5', measured: false });
  const verifier = createProxyReceiptVerifier({ baseUrl: proxyUrl, readerKey });
  receipts.set(draw2, { dispatchId: draw2, status: 'completed', provider: 'claude', model: 'claude-opus-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 });
  assert.deepEqual(await reconcileUnmeasuredDraws(pool, verifier, { ledger }), { scanned: 1, corrected: 0, pending: 1, failed: 0 },
    'a live run is left for a later sweep, never corrected early');
  await reportRunResult(pool, ctx, { admissionId: admission2, outcome: 'completed', summary: 'cut', artifacts: [] });
  assert.deepEqual(await reconcileUnmeasuredDraws(pool, verifier, { ledger }), { scanned: 1, corrected: 1, pending: 0, failed: 0 },
    'the reconciler corrects a terminal draw from its receipt');
  assert.deepEqual(await reconcileUnmeasuredDraws(pool, verifier, { ledger }), { scanned: 0, corrected: 0, pending: 0, failed: 0 },
    'a corrected draw leaves the queue');

  // A wrong reader key is an unavailable source, never a pass.
  const badKey = express(); badKey.use(express.json()); badKey.use((req, _res, next) => { req.db = pool; next(); });
  badKey.use('/svc', createServiceLedgerRouter({ getServiceToken: () => 'svc', verifyCorrectionReceipt: createProxyReceiptVerifier({ baseUrl: proxyUrl, readerKey: 'wrong' }) }));
  const bad = await listen(badKey);
  t.after(() => new Promise(r => { bad.closeAllConnections(); bad.close(r); }));
  const refused = await fetch(`http://127.0.0.1:${bad.address().port}/svc/runs/${admissionId}/draws/${drawId}/corrections`, { method: 'POST', headers: { authorization: 'Bearer svc' } });
  assert.equal(refused.status, 503, 'an unauthorized receipt read fails closed');
});
