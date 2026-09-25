import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import express from 'express';
import { issuer } from '../src/server/config/hosts.js';
import { accessTokenHash, jwkThumbprint } from '../src/server/utils/dpop.js';
import { WorkforceResourceError } from '../src/server/services/workforceResources.js';
const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
// Ephemeral fixture signing material, never a machine/operator credential.
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const { createWorkforceRouter } = await import('../src/server/routes/workforceRoutes.js');
const human = '11111111-1111-4111-8111-111111111111';
const owner = { type: 'user', id: human };
const operationId = '22222222-2222-4222-8222-222222222222';
const createBody = { operationId, owner, kind: 'team', name: 'Fixture team' };
const readBody = { operationId, owner };
const basePath = '/api/workforce';
const committed = () => ({ state: 'committed', replayed: false,
  operation: { schemaVersion: 1, operationId, action: 'agent.resource.create', state: 'committed', owner,
    resourceId: operationId, resourceRevision: '1', agentVersion: null, committedAt: '2026-09-05T12:00:00.000Z' },
  resource: { id: operationId, owner, kind: 'team', name: 'Fixture team' }, version: null, resourceAccess: { allowed: true } });

test('real HTTP/authMiddleware/JWT/DPoP boundary with query-aware auth DB and injected domain services', async t => {
  // This proves the HTTP/authentication code path locally. The relational fixture
  // is not a PostgreSQL server; service transaction/concurrency proof is separate.
  const signing = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const proofKey = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = proofKey.publicKey.export({ format: 'jwk' });
  const jkt = jwkThumbprint(jwk);
  const replays = new Set();
  const calls = [];
  let serviceFailure;
  let serviceResult;
  let active = true;
  let replayUnavailable = false;
  const db = { async query(source, params = []) {
    const sql = source.replace(/\s+/g, ' ').trim();
    let rows = [];
    if (sql === 'SELECT alg, private_pem FROM oidc_signing_keys WHERE kid = $1') {
      if (params[0] === 'workforce-fixture') rows = [{ alg: 'ES256', private_pem: signing.privateKey.export({ format: 'pem', type: 'pkcs8' }) }];
    } else if (sql.startsWith('SELECT id, username, email, display_name, avatar_url, created_at, email_verified, is_active FROM users')) {
      if (params[0] === human && active) rows = [{ id: human, username: 'fixture', is_active: true }];
    } else if (sql.startsWith('SELECT ak.id AS key_id, ak.expires_at,')) {
      rows = [{ id: human, key_id: operationId, username: 'fixture', is_active: true }];
    } else if (sql.startsWith('UPDATE api_keys SET last_used_at')) {
      rows = [];
    } else if (sql === "SELECT to_regclass('api_key_workforce_capabilities') IS NOT NULL AS present") {
      rows = [{ present: false }];
    } else if (sql.startsWith('DELETE FROM oauth_dpop_replays')) {
      if (replayUnavailable) throw new Error('private replay database outage');
    } else if (sql.startsWith('INSERT INTO oauth_dpop_replays')) {
      const key = `${params[0]}:${params[1]}`;
      if (replays.has(key)) throw Object.assign(new Error('duplicate fixture replay'), { code: '23505' });
      replays.add(key);
    } else throw new Error(`Unexpected fixture SQL: ${sql}`);
    return { rows, rowCount: rows.length };
  } };
  const invoke = method => async (pool, context, body) => {
    assert.equal(pool, db);
    calls.push({ method, context, body });
    if (serviceFailure) throw serviceFailure;
    if (serviceResult !== undefined) return serviceResult;
    // Remaining domain shape validation is intentionally delegated to service.
    const allowed = method === 'create' ? ['operationId', 'owner', 'kind', 'name', 'description', 'definition'] : ['operationId', 'owner'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw Object.assign(new Error('domain validation'), { code: 'bad_input' });
    return method === 'create' ? committed()
      : { state: 'not-observed', operation: null, resource: null, version: null, replayed: false };
  };
  const app = express();
  app.use((req, _res, next) => { req.db = db; next(); });
  // RUN-01/RUN-02 over HTTP: the admission service is injected exactly like the resource services.
  let admitFailure;
  let admitResult;
  const admittedFixture = () => ({ replayed: false, admission: { schemaVersion: 1, admissionId: operationId, operationId,
    agent: { resourceId: operationId, version: 1, contentHash: 'a'.repeat(64) },
    target: { kind: 'personal', ownerUserId: human, workspaceId: null, projectId: null, assignmentId: null, assignmentRevision: null, participationId: null, participationRevision: null },
    team: null, conversationId: null, root: null, entitlementId: null, payer: { kind: 'user', userId: human }, budget: { ceilingMicro: '1000' },
    capabilities: { requested: ['files.read'], effective: ['files.read'], terms: { definition: ['files.read'], target: ['files.read'], runtime: null, entitlement: null } },
    memoryNamespace: `user:${human}:agent:${operationId}`, admittedAt: '2026-09-25T12:00:00.000Z' } });
  const admit = method => async (pool, context, value) => {
    assert.equal(pool, db);
    calls.push({ method, context, body: value });
    if (admitFailure) throw admitFailure;
    if (admitResult !== undefined) return admitResult;
    return method === 'admit' ? admittedFixture() : admittedFixture().admission;
  };
  app.use(basePath, createWorkforceRouter({ createWorkforceResource: invoke('create'), readWorkforceResourceOperation: invoke('read'),
    admitRun: admit('admit'), readRunAdmission: admit('readAdmission'),
    authorizeRunStep: async (pool, context, value) => { calls.push({ method: 'authorizeStep', context, body: value }); if (admitFailure) throw admitFailure;
      return admitResult ?? { token: 'aaa.bbb.ccc', lease: { schemaVersion: 1, leaseId: operationId, admissionId: operationId, sequence: '1',
        operation: 'provider_dispatch', capability: null, effectiveCapabilities: ['files.read'], issuedAt: '2026-09-25T12:00:00.000Z',
        expiresAt: '2026-09-25T12:01:00.000Z', kid: 'k', secretSigningMaterial: 'hidden' } }; },
    revokeRun: async (pool, context, value) => { calls.push({ method: 'revoke', context, body: value });
      return { schemaVersion: 1, admissionId: operationId, revoked: true, reason: 'stopped_by_actor', revokedAt: '2026-09-25T12:00:00.000Z', replayed: false }; },
    readRunAuthority: async (pool, context, value) => { calls.push({ method: 'authority', context, body: value });
      return { schemaVersion: 1, admissionId: operationId, revoked: false, reason: null, latestLeaseSequence: '1' }; } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const mint = ({ clientId = 'xeno-agent-interface', scope = 'workforce:read workforce:manage', bound = false } = {}) => jwt.sign({
    sub: human, typ: 'at+jwt', client_id: clientId, scope, ...(bound ? { cnf: { jkt } } : {}),
  }, signing.privateKey, { algorithm: 'ES256', keyid: 'workforce-fixture', audience: 'xeno-api', expiresIn: '5m', header: { typ: 'at+jwt' } });
  const proof = (token, path = '/resources', overrides = {}) => jwt.sign({
    jti: crypto.randomUUID(), htm: 'POST', htu: `${issuer()}${basePath}${path}`,
    iat: Math.floor(Date.now() / 1000), ath: accessTokenHash(token), ...overrides,
  }, proofKey.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk } });
  const request = async ({ token = mint(), path = '/resources', method = 'POST', body = createBody, proof: dpop, scheme = 'Bearer', headers: extra = {}, raw } = {}) => {
    const headers = { 'content-type': 'application/json', ...extra };
    if (token) headers.authorization = `${scheme} ${token}`;
    if (dpop) headers.dpop = dpop;
    const response = await fetch(`${origin}${basePath}${path}`, { method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body: raw ?? JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, body: method === 'HEAD' ? null : await response.json() };
  };
  try {
    await t.test('canonical authenticated actor/client reaches create, forged headers cannot replace them', async () => {
      const result = await request({ headers: { 'x-user-id': 'forged', 'x-client-id': 'xeno-web', 'x-principal-type': 'human' } });
      assert.equal(result.status, 200);
      assert.equal(result.body.success, true);
      assert.deepEqual(calls.at(-1).context, { actorUserId: human, clientId: 'xeno-agent-interface' });
      assert.equal(calls.at(-1).method, 'create');
    });
    await t.test('body actor/client claims rejected before service; unknown domain fields validated by service', async () => {
      for (const key of ['actorUserId', 'clientId', 'userId', 'principal', 'auth']) {
        const before = calls.length;
        assert.equal((await request({ body: { ...createBody, [key]: 'forged' } })).status, 400);
        assert.equal(calls.length, before);
      }
      assert.equal((await request({ body: { ...createBody, unexpected: true } })).status, 400);
    });
    await t.test('missing/bad authentication, suspended user and cookie-only requests denied', async () => {
      const before = calls.length;
      assert.equal((await request({ token: null })).status, 401);
      assert.equal((await request({ token: 'invalid.jwt.signature' })).status, 401);
      assert.equal((await request({ token: null, headers: { cookie: `token=${mint()}` } })).status, 401);
      active = false;
      assert.equal((await request()).status, 401);
      active = true;
      assert.equal(calls.length, before);
    });
    await t.test('granted scope and checked-in client ceiling both required; team scopes are not workforce scopes', async () => {
      const before = calls.length;
      for (const token of [mint({ scope: 'workforce:read' }), mint({ scope: 'team:manage team:read' }), mint({ clientId: 'xeno-pixel' }), mint({ clientId: 'unregistered-client' })]) {
        const result = await request({ token });
        assert.equal(result.status, 403);
        assert.equal(result.body.required_scope, 'workforce:manage');
      }
      assert.equal(calls.length, before);
    });
    await t.test('POST receipt lookup requires workforce:read and never invokes create', async () => {
      const result = await request({ token: mint({ scope: 'workforce:read' }), path: '/resource-operations/read', body: readBody });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { success: true, state: 'not-observed', operation: null, resource: null, version: null, replayed: false });
      assert.equal(calls.at(-1).method, 'read');
      assert.deepEqual(calls.at(-1).body, readBody);
      assert.equal((await request({ token: mint({ scope: 'workforce:manage' }), path: '/resource-operations/read', body: readBody })).status, 403);
    });
    await t.test('bound token enforces real DPoP proof, no Bearer downgrade, method/token binding and replay', async () => {
      const token = mint({ bound: true });
      const before = calls.length;
      assert.equal((await request({ token })).status, 401);
      assert.equal((await request({ token, scheme: 'DPoP' })).status, 401);
      for (const overrides of [{ htm: 'GET' }, { ath: 'forged' }, { htu: `${issuer()}/other` }]) {
        assert.equal((await request({ token, scheme: 'DPoP', proof: proof(token, '/resources', overrides) })).status, 401);
      }
      assert.equal(calls.length, before);
      const validProof = proof(token);
      assert.equal((await request({ token, scheme: 'DPoP', proof: validProof })).status, 200);
      assert.equal((await request({ token, scheme: 'DPoP', proof: validProof })).status, 401);
      replayUnavailable = true;
      const unavailable = await request({ token, scheme: 'DPoP', proof: proof(token) });
      assert.equal(unavailable.status, 503);
      assert.ok(!JSON.stringify(unavailable.body).includes('private replay'));
      replayUnavailable = false;
    });
    await t.test('legacy header session has fixed namespace; ordinary/workspace keys cannot silently become humans', async () => {
      const legacy = jwt.sign({ userId: human }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
      assert.equal((await request({ token: legacy, headers: { 'x-client-id': 'forged' } })).status, 200);
      assert.deepEqual(calls.at(-1).context, { actorUserId: human, clientId: 'legacy-workforce-session' });
      const before = calls.length;
      assert.equal((await request({ token: `xeno-${'a'.repeat(48)}` })).status, 403);
      assert.equal((await request({ token: `xeno-ws-v1_${'a'.repeat(64)}` })).status, 403);
      assert.equal(calls.length, before);
    });
    await t.test('known errors use closed safe envelope and thrown internal errors never become success', async () => {
      for (const [code, expected] of [['bad_input', 400], ['denied', 403], ['conflict', 409], ['unavailable', 503], ['23505', 500]]) {
        serviceFailure = Object.assign(new Error('SECRET SQL INSERT private_values'), { code, details: { secret: 'private' } });
        const result = await request();
        assert.equal(result.status, expected);
        assert.equal(result.body.success, false);
        assert.ok(!JSON.stringify(result.body).includes('SQL'));
        assert.ok(!JSON.stringify(result.body).includes('private'));
      }
      serviceFailure = undefined;
      for (const result of [null, [], false, { success: false }]) {
        serviceResult = result;
        assert.equal((await request()).status, 500);
      }
      serviceResult = undefined;
    });
    await t.test('unsupported methods, malformed JSON, oversized and non-object bodies cannot dispatch', async () => {
      const before = calls.length;
      const wrongMethod = await request({ method: 'GET' });
      assert.equal(wrongMethod.status, 405);
      assert.equal(wrongMethod.headers.get('allow'), 'POST');
      assert.equal((await request({ raw: '{not JSON' })).status, 400);
      assert.equal((await request({ body: [] })).status, 400);
      assert.equal((await request({ body: { ...createBody, description: 'x'.repeat(300 * 1024) } })).status, 400);
      assert.equal(calls.length, before);
    });
    await t.test('empty/unknown state, malformed receipt and inconsistent identities cannot report success', async () => {
      const differentId = '33333333-3333-4333-8333-333333333333';
      const badReceipt = patch => ({ ...committed(), operation: { ...committed().operation, ...patch } });
      for (const result of [{}, { state: 'completed' }, { ...committed(), state: 'pending' },
        { ...committed(), operation: null }, badReceipt({ state: 'pending' }), badReceipt({ schemaVersion: 2 }),
        badReceipt({ operationId: differentId }), badReceipt({ owner: { type: 'user', id: differentId } }),
        badReceipt({ resourceId: 'not-a-uuid' }), badReceipt({ resourceRevision: '0' }), badReceipt({ committedAt: 'invalid' }),
        { ...committed(), resource: { ...committed().resource, id: differentId } },
        { state: 'not-observed', operation: null, resource: null, version: null, replayed: false }]) {
        serviceResult = result;
        const response = await request();
        assert.equal(response.status, 500);
        assert.equal(response.body.success, false);
      }
      serviceResult = { ...committed(), debug: 'private SQL', operation: { ...committed().operation, privateData: 'secret' },
        resource: { ...committed().resource, secret: 'hidden' } };
      const projected = await request();
      assert.equal(projected.status, 200);
      assert.ok(!JSON.stringify(projected.body).includes('private'));
      assert.ok(!JSON.stringify(projected.body).includes('secret'));
      serviceResult = { ...committed(), resource: null, version: null, resourceAccess: { allowed: false, reason: 'no_access' } };
      assert.equal((await request({ path: '/resource-operations/read', body: readBody })).status, 200);
      serviceResult = undefined;
    });
    await t.test('lost COMMIT error preserves only typed matching recovery identity, never private details', async () => {
      serviceFailure = new WorkforceResourceError('unavailable', 'operation_state_uncertain', {
        operationId, owner, sql: 'INSERT SECRET', credential: 'hidden', unrelated: true,
      });
      const result = await request();
      assert.equal(result.status, 503);
      assert.equal(result.body.success, false);
      assert.deepEqual(result.body.details, { schemaVersion: 1, reason: 'operation_state_uncertain', operationId, owner });
      assert.ok(!JSON.stringify(result.body).includes('SECRET'));
      for (const identity of [{ operationId: 'invalid', owner }, { operationId, owner: { type: 'workspace', id: human } }]) {
        serviceFailure = new WorkforceResourceError('unavailable', 'operation_state_uncertain', identity);
        const rejected = await request();
        assert.equal(rejected.status, 500);
        assert.equal(rejected.body.details, undefined);
      }
      serviceFailure = Object.assign(new Error('not a domain recovery error'), {
        code: 'unavailable', details: { schemaVersion: 1, reason: 'operation_state_uncertain', operationId, owner, secret: true },
      });
      assert.equal((await request()).body.details, undefined);
      serviceFailure = undefined;
    });
    await t.test('RUN-01/RUN-02: a run is admitted over HTTP by the authenticated actor, never one the body names', async () => {
      const admission = { operationId, agent: { resourceId: operationId, version: 1, contentHash: 'a'.repeat(64) },
        target: { kind: 'personal', ownerUserId: human }, capabilities: ['files.read'], budget: { ceilingMicro: '1000' } };
      const result = await request({ path: '/run-admissions', body: admission });
      assert.equal(result.status, 200, 'the admission route is reachable');
      assert.equal(result.body.admission.admissionId, operationId);
      assert.deepEqual(calls.at(-1).context, { actorUserId: human, clientId: 'xeno-agent-interface' }, 'the actor comes from authentication');
      assert.equal(calls.at(-1).method, 'admit');
      const before = calls.length;
      for (const key of ['actorUserId', 'clientId', 'userId', 'principal', 'auth']) {
        assert.equal((await request({ path: '/run-admissions', body: { ...admission, [key]: human } })).status, 400, 'a body cannot name the actor');
      }
      // Admitting a run commits a payer's budget, so it is a manage act; reading one back is a read.
      assert.equal((await request({ path: '/run-admissions', body: admission, token: mint({ scope: 'workforce:read' }) })).status, 403,
        'admitting a run needs workforce:manage');
      assert.equal(calls.length, before);
      const read = await request({ path: '/run-admissions/read', body: { admissionId: operationId }, token: mint({ scope: 'workforce:read' }) });
      assert.equal(read.status, 200);
      assert.equal(calls.at(-1).method, 'readAdmission');
      assert.equal((await request({ path: '/run-admissions/read', body: { admissionId: operationId, extra: 1 } })).status, 400);
      assert.equal((await request({ method: 'GET', path: '/run-admissions' })).status, 405);
    });
    await t.test('RUN-02: a refusal crosses the wire as its typed reason, and nothing else of the service error', async () => {
      const admission = { operationId, agent: { resourceId: operationId, version: 1, contentHash: 'a'.repeat(64) },
        target: { kind: 'personal', ownerUserId: human }, capabilities: ['files.read'], budget: { ceilingMicro: '1000' } };
      const { RunAdmissionError } = await import('../src/server/services/workforceRunAdmission.js');
      for (const [code, reason, extra, status] of [['conflict', 'agent_version_stale', { currentVersion: 2 }, 409],
        ['needs_approval', 'budget_exceeds_available', { availableMicro: '500' }, 403], ['denied', 'observer_cannot_dispatch', {}, 403]]) {
        admitFailure = new RunAdmissionError(code, reason, { ...extra, sql: 'SECRET private' });
        const result = await request({ path: '/run-admissions', body: admission });
        assert.equal(result.status, status);
        assert.deepEqual(result.body.details, { schemaVersion: 1, reason, ...extra }, 'the refusal reason reaches the client');
        assert.ok(!JSON.stringify(result.body).includes('SECRET'), 'nothing else of the service error crosses');
      }
      admitFailure = undefined;
      for (const result of [{}, { admission: { schemaVersion: 1 } }, { admission: { ...admittedFixture().admission, admissionId: 'x' } }]) {
        admitResult = result;
        assert.equal((await request({ path: '/run-admissions', body: admission })).status, 500, 'a partial admission is not a success');
      }
      admitResult = undefined;
    });
    await t.test('RUN-03: each step is authorized over HTTP by the admitted actor, as a bounded signed lease', async () => {
      const stepBody = { admissionId: operationId, operation: 'provider_dispatch' };
      const result = await request({ path: '/run-admissions/authorize-step', body: stepBody });
      assert.equal(result.status, 200, 'the step-authorization route is reachable');
      assert.equal(result.body.token, 'aaa.bbb.ccc');
      assert.ok(!JSON.stringify(result.body).includes('hidden'), 'only the documented lease fields cross');
      assert.deepEqual(calls.at(-1).context, { actorUserId: human, clientId: 'xeno-agent-interface' }, 'the actor comes from authentication');
      assert.equal((await request({ path: '/run-admissions/authorize-step', body: stepBody, token: mint({ scope: 'workforce:read' }) })).status, 403,
        'a lease authorizes spending, so it needs workforce:manage');
      for (const lease of [{ expiresAt: '2026-09-25T12:05:00.000Z' }, { sequence: '0' }]) {
        admitResult = { token: 'aaa.bbb.ccc', lease: { schemaVersion: 1, leaseId: operationId, admissionId: operationId, sequence: '1',
          operation: 'provider_dispatch', capability: null, effectiveCapabilities: [], issuedAt: '2026-09-25T12:00:00.000Z', expiresAt: '2026-09-25T12:01:00.000Z', kid: 'k', ...lease } };
        assert.equal((await request({ path: '/run-admissions/authorize-step', body: stepBody })).status, 500, 'a lease longer than 60 s is never reported');
      }
      admitResult = undefined;
      const { RunAdmissionError } = await import('../src/server/services/workforceRunAdmission.js');
      admitFailure = new RunAdmissionError('denied', 'admission_revoked', { revocation: 'authority_lost', sql: 'SECRET' });
      const refused = await request({ path: '/run-admissions/authorize-step', body: stepBody });
      assert.equal(refused.status, 403);
      assert.deepEqual(refused.body.details, { schemaVersion: 1, reason: 'admission_revoked', revocation: 'authority_lost' }, 'a revoked run says so, and why');
      admitFailure = undefined;
      const stopped = await request({ path: '/run-admissions/revoke', body: { admissionId: operationId } });
      assert.equal(stopped.status, 200);
      assert.equal(stopped.body.reason, 'stopped_by_actor');
      assert.equal((await request({ path: '/run-admissions/revoke', body: { admissionId: operationId }, token: mint({ scope: 'workforce:read' }) })).status, 403);
      const state = await request({ path: '/run-admissions/authority', body: { admissionId: operationId }, token: mint({ scope: 'workforce:read' }) });
      assert.equal(state.status, 200);
      assert.equal(state.body.revoked, false);
      assert.equal((await request({ path: '/run-admissions/authority', body: { admissionId: operationId, extra: 1 } })).status, 400);
      assert.equal((await request({ method: 'GET', path: '/run-admissions/authorize-step' })).status, 405);
    });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
