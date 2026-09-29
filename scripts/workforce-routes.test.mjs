import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import express from 'express';
import { issuer } from '../src/server/config/hosts.js';
import { apiCacheMiddleware } from '../src/server/middleware/cdnOptimization.js';
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
  app.use('/api/', apiCacheMiddleware);
  app.use((req, _res, next) => { req.db = db; next(); });
  // RUN-01/RUN-02 over HTTP: the admission service is injected exactly like the resource services.
  let admitFailure;
  let admitResult;
  let pinResult;
  let capacityResult;
  let evaluationResult;
  let deliveryResult;
  let revisionResult;
  const revisedAgent = '88888888-8888-4888-8888-888888888888';
  const revisionFixture = (opId) => ({ schemaVersion: 1, state: 'committed', replayed: false,
    revision: { operationId: opId, resourceId: revisedAgent, previousVersion: 1, version: 2, committedAt: '2026-09-27T12:00:00.000Z' },
    version: { resourceId: revisedAgent, version: 2, schemaVersion: 1, content: { instructions: 'v2' }, contentHash: 'c'.repeat(64),
      provenance: {}, license: {}, createdByUserId: human, createdAt: '2026-09-27T12:00:00.000Z', internalRow: 'hidden' },
    access: { allowed: true } });
  let definitionReadResult, definitionReadFailure;
  const definitionReadFixture = (request) => ({ schemaVersion: 1,
    version: { resourceId: request.resourceId, version: request.version, schemaVersion: 1, content: { instructions: 'pinned', skills: [], requestedCapabilities: [], secretReferences: [] },
      contentHash: request.contentHash, provenance: {}, license: {}, createdByUserId: human, createdAt: '2026-09-27T12:00:00.000Z', internalRow: 'hidden' },
    access: { allowed: true } });
  let createAndAssignResult;
  const assignedWorkspace = '66666666-6666-4666-8666-666666666666';
  const createAndAssignFixture = () => ({ ...committed(), owner, assignments: [{ assignmentId: '77777777-7777-4777-8777-777777777777',
    workspaceId: assignedWorkspace, state: 'proposed', policy: { schemaVersion: 1, mode: 'none', capabilities: [] },
    sourceApprovedByUserId: human, targetAcceptedByUserId: null, awaiting: 'target_acceptance', internalRow: 'hidden' }] });
  let removalResult, removalFailure;
  const removalFixture = (membershipId) => ({ schemaVersion: 1, membershipId, teamId: operationId,
    decision: { actorUserId: human, clientId: 'xeno-agent-interface', operationId },
    removedAt: '2026-09-27T12:00:00.000Z', archivedAt: null, settled: false,
    runs: [{ admissionId: operationId, fenced: true, leaseLive: false, accounted: false, settled: false, owes: 'report_or_delivery', sql: 'hidden' }] });
  const admittedFixture = () => ({ replayed: false, admission: { schemaVersion: 1, admissionId: operationId, operationId,
    agent: { resourceId: operationId, version: 1, contentHash: 'a'.repeat(64) },
    target: { kind: 'personal', ownerUserId: human, workspaceId: null, projectId: null, assignmentId: null, assignmentRevision: null, participationId: null, participationRevision: null },
    team: null, conversationId: null, root: null, entitlementId: null, payer: { kind: 'user', userId: human }, budget: { ceilingMicro: '1000' },
    capabilities: { requested: ['files.read'], effective: ['files.read'], terms: { definition: ['files.read'], target: ['files.read'], runtime: null, entitlement: null } },
    taskRef:'goal-1:task-7', memoryNamespace: `user:${human}:agent:${operationId}`, admittedAt: '2026-09-25T12:00:00.000Z' } });
  const admit = method => async (pool, context, value, options) => {
    assert.equal(pool, db);
    calls.push({ method, context, body: value, options });
    if (admitFailure) throw admitFailure;
    if (admitResult !== undefined) return admitResult;
    return method === 'admit' ? admittedFixture() : admittedFixture().admission;
  };
  app.use(basePath, createWorkforceRouter({ createWorkforceResource: invoke('create'), readWorkforceResourceOperation: invoke('read'),
    reviseAgentDefinition: async (pool, context, value) => { calls.push({ method: 'revise', context, body: value });
      return revisionResult ?? revisionFixture(value.operationId); },
    readAgentRevision: async (pool, context, value) => { calls.push({ method: 'readRevision', context, body: value });
      return revisionResult ?? revisionFixture(value.operationId); },
    readAgentDefinition: async (pool, context, value) => { calls.push({ method: 'readDefinition', context, body: value });
      if (definitionReadFailure) throw definitionReadFailure;
      return definitionReadResult ?? definitionReadFixture(value); },
    createAndAssignWorkforceResource: async (pool, context, value) => { calls.push({ method: 'createAndAssign', context, body: value });
      return createAndAssignResult ?? createAndAssignFixture(); },
    admitRun: admit('admit'), readRunAdmission: admit('readAdmission'),
    readRunAdmissionOperation:async(pool,context,value)=>{
      calls.push({method:'readAdmissionOperation',context,body:value});
      return admitResult??{schemaVersion:1,state:'committed',operationId:value.operationId,admission:admittedFixture().admission};
    },
    readWorkforceCapacity: async (pool, context, value) => { calls.push({ method: 'capacity', context, body: value });
      return capacityResult ?? { schemaVersion: 1, owner: value.owner, derivedAt: '2026-09-27T12:00:00.000Z', activeAdmissions: 2, inFlightRuns: 1,
        activeAgents: 2, committedCeilingMicro: '3500000', funding: [{ payerUserId: human, canFund: true, availableMicro: '7000000', internal: 'hidden' }] }; },
    reportRunResult: async (pool, context, value) => { calls.push({ method: 'report', context, body: value });
      return { replayed: false, result: { outcome: 'completed', interruptedReason: null, summary: 's', artifacts: [{ name: 'diff', ref: 'artifact:1', content: 'hidden' }],
        reportedAt: '2026-09-27T12:00:00.000Z', reportHash: 'hidden' } }; },
    deliverRunResult: async (pool, context, value) => { calls.push({ method: 'deliver', context, body: value });
      return deliveryResult ?? { replayed: false, delivery: { childAdmissionId: value.childAdmissionId, parentAdmissionId: value.parentAdmissionId,
        outcome: 'interrupted', interruptedReason: 'stopped', deliveredAt: '2026-09-27T12:00:00.000Z' } }; },
    removeTeamMember: async (pool, context, value) => { calls.push({ method: 'remove', context, body: value }); if (removalFailure) throw removalFailure;
      return { replayed: false, removal: removalResult ?? removalFixture(value.membershipId) }; },
    readMemberRemoval: async (pool, context, value) => { calls.push({ method: 'readRemoval', context, body: value }); if (removalFailure) throw removalFailure;
      return removalResult ?? removalFixture(value.membershipId); },
    archiveMemberRemoval: async (pool, context, value) => { calls.push({ method: 'archive', context, body: value }); if (removalFailure) throw removalFailure;
      return { replayed: false, removal: removalResult ?? removalFixture(value.membershipId) }; },
    readRunOutcome: async (pool, context, value) => { calls.push({ method: 'outcome', context, body: value });
      return { schemaVersion: 1, admissionId: value.admissionId, parentAdmissionId: null, taskRef: 'goal-1:task-7', conversationId: null, state: 'running',
        result: null, interruption: null, delivery: null, children: [] }; },
    readWorkforceEvaluation: async (pool, context, value) => { calls.push({ method: 'evaluation', context, body: value });
      return evaluationResult ?? { schemaVersion: 1, owner: value.owner, subject: value.subject, window: value.window,
        derivedAt: '2026-09-27T12:00:00.000Z', settledBefore: '2026-09-27T11:55:00.000Z', closed: true,
        runs: { admitted: 3, children: 1, activeAtEnd: 2, stopped: { stopped_by_actor: 1, stopped_by_target: 0, authority_lost: 0 } },
        steps: { privilegedCalls: 1, providerDispatches: 2 }, handoffs: null,
        decisions: { byRelation: { about: { 'division.assign': 1 } }, withEvidence: 0 },
        records: { admissions: [operationId], handoffs: [], decisions: [], truncated: false },
        notRecorded: ['contributions', 'reviewerDecisions', 'settlements'], score: 97 }; },
    readRunnablePin: async (pool, context, value) => { calls.push({ method: 'pin', context, body: value }); if (admitFailure) throw admitFailure;
      return pinResult ?? { schemaVersion: 1, agent: { resourceId: value.agent.resourceId, version: 3, contentHash: 'b'.repeat(64) },
        target: value.target, team: null, terms: { definition: ['files.read'], target: ['files.read'] }, internalRow: 'hidden' }; },
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
      assert.equal(result.body.admission.taskRef,'goal-1:task-7','admission HTTP preserves the recorded task binding');
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
      assert.equal(read.body.admission.taskRef,'goal-1:task-7','admission readback preserves the task binding');
      assert.equal(calls.at(-1).method, 'readAdmission');
      const boundRead = await request({ path: '/run-admissions/read', body: { admissionId: operationId, expectedActorAccountId: human }, token: mint({ scope: 'workforce:read' }) });
      assert.equal(boundRead.status,200,'prepared admission readback accepts the expected actor field');
      assert.deepEqual(calls.at(-1).options,{expectedActorAccountId:human},'HTTP passes the expected actor to the receipt authority');
      assert.equal((await request({ path: '/run-admissions/read', body: { admissionId: operationId, extra: 1 } })).status, 400);
      assert.equal((await request({ method: 'GET', path: '/run-admissions' })).status, 405);
    });
    await t.test('admission recovery is a read and refuses a receipt for another operation',async()=>{
      const body={operationId,expectedActorAccountId:human};
      const query=()=>request({path:'/run-admissions/operations/read',body,token:mint({scope:'workforce:read'})});
      admitResult=undefined;
      const recovered=await query();
      assert.equal(recovered.status,200,'operation recovery is mounted under read authority');
      assert.equal(recovered.body.admission.taskRef,'goal-1:task-7','operation recovery preserves the task binding');
      assert.deepEqual(calls.at(-1).body,body,'operation recovery retains the expected actor precondition');
      admitResult={schemaVersion:1,state:'committed',operationId,admission:{...admittedFixture().admission,taskRef:{secret:'private'}}};
      assert.equal((await query()).status,500,'invalid task metadata is refused instead of disclosed');
      admitResult={schemaVersion:1,state:'not-observed',operationId,admission:null};
      assert.deepEqual((await query()).body,{...admitResult,success:true},'no receipt is reported honestly as not-observed');
      admitResult={schemaVersion:1,state:'committed',operationId,admission:{...admittedFixture().admission,operationId:crypto.randomUUID()}};
      assert.equal((await query()).status,500,'a receipt for another operation cannot be reported as recovered');
      const mixed='abcdefab-abcd-4abc-8abc-abcdefabcdef';
      admitResult={schemaVersion:1,state:'not-observed',operationId:mixed,admission:null};
      assert.equal((await request({path:'/run-admissions/operations/read',body:{operationId:mixed.toUpperCase(),expectedActorAccountId:human},token:mint({scope:'workforce:read'})})).status,200,
        'recovery compares canonical UUIDs rather than their original casing');
      admitResult=undefined;
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
    // Mutation-checked 2026-09-26, 4 mutants, each fails the named assertion; restored passes:
    //   the route demands workforce:manage              -> "reading a pin is a read"
    //   the validator accepts another resource / target -> "a pin for something not asked about is never reported"
    //   the route projects the whole service reply      -> "only the documented pin fields cross"
    await t.test('RUN-01: the pin an admission must name is read over HTTP as a read, and only for what was asked', async () => {
      const ask = { agent: { resourceId: operationId }, target: { kind: 'personal', ownerUserId: human } };
      const read = await request({ path: '/run-admissions/pin', body: ask, token: mint({ scope: 'workforce:read' }) });
      assert.equal(read.status, 200, 'reading a pin is a read');
      assert.deepEqual(read.body.agent, { resourceId: operationId, version: 3, contentHash: 'b'.repeat(64) });
      assert.ok(!JSON.stringify(read.body).includes('hidden'), 'only the documented pin fields cross');
      assert.deepEqual(calls.at(-1).context, { actorUserId: human, clientId: 'xeno-agent-interface' }, 'the actor comes from authentication');
      const before = calls.length;
      for (const key of ['actorUserId', 'clientId', 'userId', 'principal', 'auth']) {
        assert.equal((await request({ path: '/run-admissions/pin', body: { ...ask, [key]: human } })).status, 400, 'a body cannot name the actor');
      }
      assert.equal(calls.length, before);
      // A reply about another agent, another target, or with a malformed pin is not an answer to this question.
      for (const bad of [{ agent: { resourceId: human, version: 3, contentHash: 'b'.repeat(64) } }, { agent: { resourceId: operationId, version: 0, contentHash: 'b'.repeat(64) } },
        { agent: { resourceId: operationId, version: 3, contentHash: 'B'.repeat(64) } }, { target: { kind: 'personal', ownerUserId: operationId } }]) {
        pinResult = { schemaVersion: 1, agent: { resourceId: operationId, version: 3, contentHash: 'b'.repeat(64) }, target: ask.target, team: null,
          terms: { definition: [], target: [] }, ...bad };
        assert.equal((await request({ path: '/run-admissions/pin', body: ask })).status, 500, 'a pin for something not asked about is never reported');
      }
      pinResult = undefined;
      const { RunAdmissionError } = await import('../src/server/services/workforceRunAdmission.js');
      admitFailure = new RunAdmissionError('denied', 'actor_cannot_act_for_target', { sql: 'SECRET' });
      const refused = await request({ path: '/run-admissions/pin', body: ask });
      assert.equal(refused.status, 403);
      assert.deepEqual(refused.body.details, { schemaVersion: 1, reason: 'actor_cannot_act_for_target' }, 'the refusal reason reaches the client, nothing else');
      admitFailure = undefined;
      assert.equal((await request({ method: 'GET', path: '/run-admissions/pin' })).status, 405);
    });
    // Mutation-checked 2026-09-27: the route demands workforce:manage -> "reading capacity is a read";
    // the validator accepts another scope -> "capacity for another scope is never reported".
    await t.test('LIFE-09: capacity is read over HTTP as a read, only for the scope asked about', async () => {
      const ask = { owner: { type: 'user', id: human }, expectedActorAccountId: human };
      const read = await request({ path: '/capacity', body: ask, token: mint({ scope: 'workforce:read' }) });
      assert.equal(read.status, 200, 'reading capacity is a read');
      assert.equal(read.body.committedCeilingMicro, '3500000');
      assert.ok(!JSON.stringify(read.body).includes('hidden'), 'only the documented capacity fields cross');
      assert.deepEqual(calls.at(-1).context, { actorUserId: human, clientId: 'xeno-agent-interface' }, 'the actor comes from authentication');
      for (const bad of [{ owner: { type: 'user', id: operationId } }, { inFlightRuns: 5 }, { committedCeilingMicro: '-1' }]) {
        capacityResult = { schemaVersion: 1, owner: ask.owner, derivedAt: '2026-09-27T12:00:00.000Z', activeAdmissions: 2, inFlightRuns: 1,
          activeAgents: 2, committedCeilingMicro: '0', funding: [], ...bad };
        assert.equal((await request({ path: '/capacity', body: ask })).status, 500, 'capacity for another scope is never reported');
      }
      capacityResult = undefined;
      assert.equal((await request({ method: 'GET', path: '/capacity' })).status, 405);
    });
    // Mutation-checked 2026-09-27: the projection drops `parent` -> "a child admission crosses with its parent";
    // the projection accepts a malformed parent -> "a malformed parent reference is not a success".
    await t.test('RUN-10: a child is admitted over HTTP under its parent, and reports it', async () => {
      const parentId = crypto.randomUUID();
      const child = { operationId, agent: { resourceId: operationId, version: 1, contentHash: 'a'.repeat(64) },
        target: { kind: 'personal', ownerUserId: human }, capabilities: ['files.read'], budget: { ceilingMicro: '1000' }, parent: { admissionId: parentId } };
      admitResult = { replayed: false, admission: { ...admittedFixture().admission, parent: { admissionId: parentId, depth: 1 } } };
      const result = await request({ path: '/run-admissions', body: child });
      assert.equal(result.status, 200);
      assert.deepEqual(calls.at(-1).body.parent, { admissionId: parentId }, 'the parent reaches the service as asked');
      assert.deepEqual(result.body.admission.parent, { admissionId: parentId, depth: 1 }, 'a child admission crosses with its parent');
      for (const parent of [{ admissionId: 'x', depth: 1 }, { admissionId: parentId, depth: 0 }, { admissionId: parentId, depth: 1, budget: 'hidden' }]) {
        admitResult = { replayed: false, admission: { ...admittedFixture().admission, parent } };
        assert.equal((await request({ path: '/run-admissions', body: child })).status, 500, 'a malformed parent reference is not a success');
      }
      admitResult = undefined;
    });
    // Mutation-checked 2026-09-27: the route demands workforce:manage -> "reading an evaluation is a read";
    // the projection passes unknown fields -> "no score crosses the wire"; it accepts another window ->
    // "an evaluation of another window is never reported".
    // Mutation-checked 2026-09-27: the delivery projection accepts another parent -> "a delivery to another
    // parent is never reported"; the report projection passes unknown fields -> "only the documented result fields cross".
    await t.test('RUN-04: a result is reported and delivered over HTTP as manage acts, and the outcome read as a read', async () => {
      const parentId = crypto.randomUUID();
      const reported = await request({ path: '/run-admissions/result', body: { admissionId: operationId, outcome: 'completed' } });
      assert.equal(reported.status, 200);
      assert.ok(!JSON.stringify(reported.body).includes('hidden'), 'only the documented result fields cross');
      assert.equal((await request({ path: '/run-admissions/result', body: { admissionId: operationId, outcome: 'completed' },
        token: mint({ scope: 'workforce:read' }) })).status, 403, 'reporting a result is a manage act');
      const delivered = await request({ path: '/run-admissions/deliver', body: { childAdmissionId: operationId, parentAdmissionId: parentId } });
      assert.deepEqual([delivered.status, delivered.body.delivery.parentAdmissionId], [200, parentId]);
      deliveryResult = { replayed: false, delivery: { childAdmissionId: operationId, parentAdmissionId: crypto.randomUUID(), outcome: 'completed',
        interruptedReason: null, deliveredAt: '2026-09-27T12:00:00.000Z' } };
      assert.equal((await request({ path: '/run-admissions/deliver', body: { childAdmissionId: operationId, parentAdmissionId: parentId } })).status, 500,
        'a delivery to another parent is never reported');
      deliveryResult = undefined;
      const read = await request({ path: '/run-admissions/outcome', body: { admissionId: operationId }, token: mint({ scope: 'workforce:read' }) });
      assert.deepEqual([read.status, read.body.taskRef], [200, 'goal-1:task-7'], 'reading an outcome is a read');
      assert.deepEqual(calls.at(-1).context, { actorUserId: human, clientId: 'xeno-agent-interface' }, 'the actor comes from authentication');
      for (const path of ['/run-admissions/result', '/run-admissions/deliver', '/run-admissions/outcome']) {
        assert.equal((await request({ method: 'GET', path })).status, 405);
      }
    });
    // Mutation-checked 2026-09-27: removal demands only workforce:read -> "removing a member is a manage act";
    // the projection accepts another membership -> "a removal of another membership is never reported"; the
    // unsettled list passes the service's detail through -> "only what is still owed crosses the wire"; the
    // projection trusts the service's settled flag -> "a removal cannot claim to be settled while a run still owes something".
    await t.test('LIFE-02: a member is removed and archived as manage acts, and what it still owes is read as a read', async () => {
      const { MemberRemovalError } = await import('../src/server/services/workforceMemberRemoval.js');
      const membershipId = crypto.randomUUID();
      const ask = { operationId: crypto.randomUUID(), membershipId, rationale: 'left the project' };
      const removed = await request({ path: '/member-removals', body: ask });
      assert.equal(removed.status, 200);
      assert.deepEqual([removed.body.removal.membershipId, removed.body.removal.runs[0].owes], [membershipId, 'report_or_delivery']);
      assert.ok(!JSON.stringify(removed.body).includes('hidden'), 'only the documented removal fields cross');
      assert.deepEqual(calls.at(-1).context, { actorUserId: human, clientId: 'xeno-agent-interface' }, 'the actor comes from authentication');
      assert.equal((await request({ path: '/member-removals', body: ask, token: mint({ scope: 'workforce:read' }) })).status, 403,
        'removing a member is a manage act');
      assert.equal((await request({ path: '/member-removals/archive', body: { membershipId }, token: mint({ scope: 'workforce:read' }) })).status, 403,
        'archiving a removal is a manage act');
      const read = await request({ path: '/member-removals/read', body: { membershipId }, token: mint({ scope: 'workforce:read' }) });
      assert.deepEqual([read.status, read.body.settled], [200, false], 'reading a removal is a read');
      removalResult = removalFixture(crypto.randomUUID());
      assert.equal((await request({ path: '/member-removals/read', body: { membershipId }, token: mint({ scope: 'workforce:read' }) })).status, 500,
        'a removal of another membership is never reported');
      removalResult = { ...removalFixture(membershipId), settled: true };
      assert.equal((await request({ path: '/member-removals/read', body: { membershipId }, token: mint({ scope: 'workforce:read' }) })).status, 500,
        'a removal cannot claim to be settled while a run still owes something');
      removalResult = undefined;
      removalFailure = new MemberRemovalError('conflict', 'removal_not_settled',
        { unsettled: [{ admissionId: operationId, owes: 'lease_expiry', sql: 'SECRET private' }] });
      const refused = await request({ path: '/member-removals/archive', body: { membershipId } });
      assert.equal(refused.status, 409);
      assert.deepEqual(refused.body.details, { schemaVersion: 1, reason: 'removal_not_settled', unsettled: [{ admissionId: operationId, owes: 'lease_expiry' }] },
        'only what is still owed crosses the wire');
      removalFailure = new MemberRemovalError('not_found', 'membership_not_found', { team: 'SECRET' });
      const hidden = await request({ path: '/member-removals', body: ask });
      assert.deepEqual([hidden.status, hidden.body.details], [404, { schemaVersion: 1, reason: 'membership_not_found' }]);
      removalFailure = undefined;
      for (const path of ['/member-removals', '/member-removals/read', '/member-removals/archive']) {
        assert.equal((await request({ method: 'GET', path })).status, 405);
      }
    });
    // Mutation-checked 2026-09-27: the route demands only workforce:read -> "creating and assigning is a manage act";
    // the projection accepts an assignment to a workspace nobody asked for -> "an assignment nobody asked for is never
    // reported"; it accepts a proposed assignment claiming a target approver -> "a proposed assignment names no target
    // approver"; it passes the service's extra fields -> "only the documented assignment fields cross".
    await t.test('VIEW-03: create-plus-assign is one manage act over HTTP, reporting the owner and each assignment asked for', async () => {
      const body = { ...createBody, operationId: crypto.randomUUID(),
        assignments: [{ workspaceId: assignedWorkspace, policy: { schemaVersion: 1, mode: 'none', capabilities: [] } }] };
      // The fixture's receipt is for the shared operationId; answer for the one asked.
      const reply = () => { const f = createAndAssignFixture(); f.operation = { ...f.operation, operationId: body.operationId }; return f; };
      createAndAssignResult = reply();
      const made = await request({ path: '/resources/create-and-assign', body });
      assert.equal(made.status, 200);
      assert.deepEqual([made.body.owner, made.body.assignments[0].state, made.body.assignments[0].awaiting], [owner, 'proposed', 'target_acceptance']);
      assert.ok(!JSON.stringify(made.body).includes('hidden'), 'only the documented assignment fields cross');
      assert.deepEqual(calls.at(-1).context, { actorUserId: human, clientId: 'xeno-agent-interface' }, 'the actor comes from authentication');
      assert.equal((await request({ path: '/resources/create-and-assign', body, token: mint({ scope: 'workforce:read' }) })).status, 403,
        'creating and assigning is a manage act');
      createAndAssignResult = { ...reply(), assignments: [{ ...reply().assignments[0], workspaceId: human }] };
      assert.equal((await request({ path: '/resources/create-and-assign', body })).status, 500, 'an assignment nobody asked for is never reported');
      createAndAssignResult = { ...reply(), assignments: [{ ...reply().assignments[0], targetAcceptedByUserId: human }] };
      assert.equal((await request({ path: '/resources/create-and-assign', body })).status, 500, 'a proposed assignment names no target approver');
      createAndAssignResult = { ...reply(), owner: { type: 'workspace', id: assignedWorkspace } };
      assert.equal((await request({ path: '/resources/create-and-assign', body })).status, 500, 'a reply owned by someone else is never reported');
      createAndAssignResult = undefined;
      assert.equal((await request({ method: 'GET', path: '/resources/create-and-assign' })).status, 405);
      // The shipped /resources reply is untouched: no owner or assignments key appears on it.
      const plain = await request({ path: '/resources' });
      assert.equal(plain.status, 200);
      assert.deepEqual([Object.hasOwn(plain.body, 'assignments'), Object.hasOwn(plain.body, 'owner')], [false, false],
        'the plain create reply keeps the shape shipped clients parse strictly');
    });
    // Mutation-checked 2026-09-27: the revision route demands only workforce:read -> "revising a definition is a
    // manage act"; the projection accepts a receipt for another agent -> "a revision for another agent is never
    // reported"; it passes the service's extra fields -> "only the documented version fields cross".
    await t.test('MKT-01: revising a definition is a manage act over HTTP, reporting the version it wrote', async () => {
      const body = { operationId: crypto.randomUUID(), resourceId: revisedAgent, baseVersion: 1,
        definition: { schemaVersion: 1, instructions: 'v2', skills: [], requestedCapabilities: [] } };
      revisionResult = undefined;
      const made = await request({ path: '/resources/revise-definition', body });
      assert.equal(made.status, 200);
      assert.deepEqual([made.body.revision.previousVersion, made.body.revision.version, made.body.version.version], [1, 2, 2]);
      assert.ok(!JSON.stringify(made.body).includes('hidden'), 'only the documented version fields cross');
      assert.deepEqual(calls.at(-1).context, { actorUserId: human, clientId: 'xeno-agent-interface' }, 'the actor comes from authentication');
      assert.equal((await request({ path: '/resources/revise-definition', body, token: mint({ scope: 'workforce:read' }) })).status, 403,
        'revising a definition is a manage act');
      // A consistent reply about ANOTHER agent -- receipt and version agree with each other, just not with the request.
      const other = revisionFixture(body.operationId);
      revisionResult = { ...other, revision: { ...other.revision, resourceId: human }, version: { ...other.version, resourceId: human } };
      assert.equal((await request({ path: '/resources/revise-definition', body })).status, 500, 'a revision for another agent is never reported');
      revisionResult = undefined;
      // Reconciling a revision is a read, by operation id alone.
      const read = await request({ path: '/resources/revise-definition/read', body: { operationId: body.operationId }, token: mint({ scope: 'workforce:read' }) });
      assert.deepEqual([read.status, read.body.revision.version], [200, 2]);
      assert.equal((await request({ method: 'GET', path: '/resources/revise-definition' })).status, 405);
    });
    // Mutation-checked pattern (see the revise-definition block above): the route demands only workforce:read ->
    // "reading a definition is a read, never a manage act"; the projection accepts a reply naming another
    // resource, version or hash than the one asked about -> "a reply for another pin is never reported".
    await t.test('MKT-01: a definition is read over HTTP under the exact pin asked for, and never as a manage act', async () => {
      const ask = { resourceId: revisedAgent, version: 2, contentHash: 'c'.repeat(64), expectedActorAccountId: human };
      definitionReadResult = undefined;
      const read = await request({ path: '/resources/definition/read', body: ask, token: mint({ scope: 'workforce:read' }) });
      assert.equal(read.status, 200);
      assert.deepEqual([read.body.version.resourceId, read.body.version.version, read.body.version.contentHash], [revisedAgent, 2, 'c'.repeat(64)]);
      assert.match(read.headers.get('cache-control'), /no-store/, 'private definitions are never cacheable');
      assert.ok(!JSON.stringify(read.body).includes('hidden'), 'only the documented version fields cross');
      assert.deepEqual(calls.at(-1).context, { actorUserId: human, clientId: 'xeno-agent-interface' }, 'the actor comes from authentication');
      assert.equal(calls.at(-1).method, 'readDefinition');
      const boundRead = mint({ scope: 'workforce:read', bound: true });
      const beforeProof = calls.length;
      assert.equal((await request({ path: '/resources/definition/read', body: ask, token: boundRead, scheme: 'DPoP' })).status, 401,
        'a bound definition reader cannot omit its proof');
      assert.equal(calls.length, beforeProof, 'missing proof never reaches definition authority');
      const signedRead = proof(boundRead, '/resources/definition/read');
      assert.equal((await request({ path: '/resources/definition/read', body: ask, token: boundRead, scheme: 'DPoP', proof: signedRead })).status, 200);
      assert.equal((await request({ path: '/resources/definition/read', body: ask, token: boundRead, scheme: 'DPoP', proof: signedRead })).status, 401,
        'a definition-read DPoP proof cannot be replayed');
      // A read, never a manage act: workforce:manage alone is not enough, and a body cannot name the actor.
      assert.equal((await request({ path: '/resources/definition/read', body: ask, token: mint({ scope: 'workforce:manage' }) })).status, 403,
        'reading a definition needs workforce:read, not workforce:manage');
      const before = calls.length;
      for (const key of ['actorUserId', 'clientId', 'userId', 'principal', 'auth']) {
        assert.equal((await request({ path: '/resources/definition/read', body: { ...ask, [key]: human }, token: mint({ scope: 'workforce:read' }) })).status, 400,
          'a body cannot name the actor');
      }
      assert.equal(calls.length, before, 'a rejected forged body never reaches the service');
      // A reply naming a DIFFERENT resource, version or hash than the one asked about is not an answer to
      // this question -- swapping any one of the three id/version/hash fields is caught, never reported.
      for (const bad of [{ resourceId: human }, { version: 3 }, { contentHash: 'd'.repeat(64) }]) {
        definitionReadResult = { ...definitionReadFixture(ask), version: { ...definitionReadFixture(ask).version, ...bad } };
        assert.equal((await request({ path: '/resources/definition/read', body: ask, token: mint({ scope: 'workforce:read' }) })).status, 500,
          'a reply for another pin is never reported');
      }
      for (const bad of [{ schemaVersion: 2 }, { content: null }, { content: { instructions: 'missing references' } },
        { provenance: [] }, { license: null }, { createdByUserId: 'invalid' }, { createdAt: 'invalid' },
        { content: { instructions: 'x'.repeat(262145), skills: [], requestedCapabilities: [], secretReferences: [] } }]) {
        definitionReadResult = { ...definitionReadFixture(ask), version: { ...definitionReadFixture(ask).version, ...bad } };
        assert.equal((await request({ path: '/resources/definition/read', body: ask, token: mint({ scope: 'workforce:read' }) })).status, 500,
          'an incomplete or oversized definition is never reported as usable');
      }
      definitionReadResult = undefined;
      // A refusal from the service crosses as its typed reason, exactly like every other AgentRevisionError --
      // the SAME catch block the revise-definition routes already use, unmodified.
      const { AgentRevisionError } = await import('../src/server/services/workforceAgentRevision.js');
      definitionReadFailure = new AgentRevisionError('denied', 'expected_actor_account_mismatch', { sql: 'SECRET private' });
      const refused = await request({ path: '/resources/definition/read', body: ask, token: mint({ scope: 'workforce:read' }) });
      assert.equal(refused.status, 403);
      assert.deepEqual(refused.body.details, { schemaVersion: 1, reason: 'expected_actor_account_mismatch' }, 'the refusal reason reaches the client, nothing else');
      assert.ok(!JSON.stringify(refused.body).includes('SECRET'), 'nothing else of the service error crosses');
      definitionReadFailure = new AgentRevisionError('not_found', 'agent_not_found');
      assert.equal((await request({ path: '/resources/definition/read', body: ask, token: mint({ scope: 'workforce:read' }) })).status, 404,
        'an unauthorized read is reported not_found, hiding whether the id names anything');
      definitionReadFailure = undefined;
      assert.equal((await request({ method: 'GET', path: '/resources/definition/read' })).status, 405);
    });
    await t.test('LIFE-04: an evaluation is read over HTTP as a read, for the subject and window asked about', async () => {
      const ask = { owner: { type: 'workspace', id: operationId }, subject: { kind: 'agent', resourceId: operationId },
        window: { since: '2026-09-01T00:00:00.000Z', until: '2026-09-02T00:00:00.000Z' }, expectedActorAccountId: human };
      const read = await request({ path: '/evaluation', body: ask, token: mint({ scope: 'workforce:read' }) });
      assert.equal(read.status, 200, 'reading an evaluation is a read');
      assert.deepEqual(read.body.runs.stopped, { stopped_by_actor: 1, stopped_by_target: 0, authority_lost: 0 });
      assert.equal(Object.hasOwn(read.body, 'score'), false, 'no score crosses the wire');
      assert.deepEqual(calls.at(-1).context, { actorUserId: human, clientId: 'xeno-agent-interface' }, 'the actor comes from authentication');
      const base = () => ({ schemaVersion: 1, owner: ask.owner, subject: ask.subject, window: ask.window, derivedAt: '2026-09-27T12:00:00.000Z',
        settledBefore: '2026-09-27T11:55:00.000Z', closed: true, runs: { admitted: 0, children: 0, activeAtEnd: 0, stopped: { stopped_by_actor: 0, stopped_by_target: 0, authority_lost: 0 } },
        steps: { privilegedCalls: 0, providerDispatches: 0 }, handoffs: null, decisions: { byRelation: {}, withEvidence: 0 },
        records: { admissions: [], handoffs: [], decisions: [], truncated: false }, notRecorded: [] });
      for (const bad of [{ window: { since: '2026-08-01T00:00:00.000Z', until: '2026-09-02T00:00:00.000Z' } },
        { subject: { kind: 'agent', resourceId: human } }, { runs: { admitted: -1, children: 0, activeAtEnd: 0, stopped: {} } }]) {
        evaluationResult = { ...base(), ...bad };
        assert.equal((await request({ path: '/evaluation', body: ask })).status, 500, 'an evaluation of another window is never reported');
      }
      evaluationResult = undefined;
      assert.equal((await request({ path: '/evaluation', body: ask, token: mint({ scope: 'workforce:manage' }) })).status, 403,
        'an evaluation needs workforce:read');
      assert.equal((await request({ method: 'GET', path: '/evaluation' })).status, 405);
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
