import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import express from 'express';
import { issuer } from '../src/server/config/hosts.js';
import { jwkThumbprint, accessTokenHash } from '../src/server/utils/dpop.js';
import { createWorkforceResource } from '../src/server/services/workforceResources.js';
import { listOwnedWorkforceResources } from '../src/server/services/workforceCatalog.js';
import { apiKeyWorkforceNamespace } from '../src/server/services/apiKeyWorkforceAuthority.js';
import { recentOidcAuthAllowed } from '../src/server/middleware/recentOidcAuth.js';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
const { default: router } = await import('../src/server/routes/workforceRoutes.js');
const { authMiddleware } = await import('../src/server/middleware/auth.js');

test('API key workforce grants and use through real isolated PostgreSQL + HTTP', async t => {
  const connectionString = process.env.WORKFORCE_TEST_DATABASE_URL;
  assert.ok(connectionString, 'WORKFORCE_TEST_DATABASE_URL required; no skipped database proof');
  const url = new URL(connectionString); assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)); assert.equal(url.pathname, '/workforceproof'); assert.equal(url.search, '');
  const schema = `workforce_key_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 8, application_name: schema });
  let server, created = false;
  const owner = randomUUID(), foreign = randomUUID(), agent = randomUUID(), foreignAgent = randomUUID();
  const keyId = randomUUID(), secondKeyId = randomUUID(), foreignKeyId = randomUUID(), agentKeyId = randomUUID(), foreignAgentKeyId = randomUUID();
  const rawKey = `xeno-${randomBytes(24).toString('hex')}`, secondKey = `xeno-${randomBytes(24).toString('hex')}`, agentKey = `xk_${randomBytes(24).toString('hex')}`;
  const raws = new Map([[keyId, rawKey], [secondKeyId, secondKey], [foreignKeyId, `xeno-${randomBytes(24).toString('hex')}`], [agentKeyId, agentKey], [foreignAgentKeyId, `xk_${randomBytes(24).toString('hex')}`]]);
  const personal = { type: 'user', id: owner };
  const signer = generateKeyPairSync('ec', { namedCurve: 'P-256' }), proofKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = proofKey.publicKey.export({ format: 'jwk' }), jkt = jwkThumbprint(jwk);
  const sessions = new Map();
  let createOperation;
  const grantRequest = (id = keyId, expectedRevision = '0', scopes = ['workforce:read', 'workforce:manage']) => ({ keyId: id, expectedRevision, operationId: randomUUID(), action: 'set-scopes', scopes });
  let post;
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
    await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY,username TEXT,email TEXT,display_name TEXT,avatar_url TEXT,email_verified BOOLEAN DEFAULT true,
      role TEXT DEFAULT 'user',is_active BOOLEAN DEFAULT true,status TEXT DEFAULT 'active',created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE api_keys(id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id),key_prefix TEXT,key_hash TEXT,is_active BOOLEAN DEFAULT true,
        expires_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT clock_timestamp(),last_used_at TIMESTAMPTZ,usage_count BIGINT DEFAULT 0);
      CREATE TABLE oidc_signing_keys(kid TEXT PRIMARY KEY,alg TEXT,private_pem TEXT);
      CREATE TABLE oauth_clients(client_id TEXT PRIMARY KEY,allowed_scopes TEXT[]);
      CREATE TABLE oauth_session_state(sid UUID PRIMARY KEY,user_id UUID,auth_epoch INTEGER,expires_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ);
      CREATE TABLE oauth_user_auth_epochs(user_id UUID PRIMARY KEY,epoch INTEGER);
      CREATE TABLE oauth_dpop_replays(jkt TEXT,jti TEXT,htm TEXT,htu TEXT,expires_at TIMESTAMPTZ,UNIQUE(jkt,jti));`);
    for (const id of [owner, foreign, agent, foreignAgent]) {
      const sid = randomUUID(); sessions.set(id, sid);
      await pool.query('INSERT INTO users(id,username) VALUES($1,$2)', [id, id]);
      await pool.query('INSERT INTO oauth_user_auth_epochs VALUES($1,0)', [id]);
      await pool.query("INSERT INTO oauth_session_state(sid,user_id,auth_epoch,expires_at) VALUES($1,$2,0,now()+interval '1 hour')", [sid, id]);
    }
    for (const [id, user] of [[keyId, owner], [secondKeyId, owner], [foreignKeyId, foreign], [agentKeyId, agent], [foreignAgentKeyId, foreignAgent]]) {
      const raw = raws.get(id);
      await pool.query('INSERT INTO api_keys(id,user_id,key_prefix,key_hash) VALUES($1,$2,$3,$4)', [id, user, raw.slice(0, 16), createHash('sha256').update(raw).digest('hex')]);
    }
    await pool.query("INSERT INTO oidc_signing_keys VALUES('key-proof','ES256',$1)", [signer.privateKey.export({ format: 'pem', type: 'pkcs8' })]);
    await pool.query("INSERT INTO oauth_clients VALUES('xeno-agent-interface',ARRAY['openid','workforce:read','workforce:manage'])");
    const token = ({ actor = owner, scope = 'openid workforce:read workforce:manage', client = 'xeno-agent-interface', authTime = Math.floor(Date.now() / 1000), bound = true } = {}) => jwt.sign({
      sub: actor, sid: sessions.get(actor), auth_epoch: 0, auth_time: authTime, client_id: client, scope, typ: 'at+jwt', ...(bound ? { cnf: { jkt } } : {}),
    }, signer.privateKey, { algorithm: 'ES256', keyid: 'key-proof', audience: 'xeno-api', expiresIn: '5m', header: { typ: 'at+jwt' } });
    const app = express(); app.use((req, _res, next) => { req.db = pool; next(); }); app.use('/api/workforce', router);
    app.get('/existing-api', authMiddleware, (req, res) => res.json({ id: req.user.id, auth: req.auth }));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    post = async (path, body, options = {}) => {
      const credential = options.key ?? options.token ?? token();
      const full = `/api/workforce${path}`, headers = { 'content-type': 'application/json', authorization: `${options.key ? 'Bearer' : 'DPoP'} ${credential}`, ...options.headers };
      if (!options.key && options.proof !== false) headers.dpop = jwt.sign({ jti: randomUUID(), htm: 'POST', htu: `${issuer()}${full}`, ath: accessTokenHash(credential), iat: Math.floor(Date.now() / 1000) }, proofKey.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk } });
      const response = await fetch(origin + full, { method: 'POST', headers, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const existing = async () => { const response = await fetch(`${origin}/existing-api`, { headers: { authorization: `Bearer ${rawKey}` } }); return { status: response.status, body: await response.json() }; };

    await t.test('old schema/keys retain existing API authentication with no implicit workforce scopes', async () => {
      const result = await existing(); assert.equal(result.status, 200);
      assert.deepEqual(result.body.auth, { kind: 'api-key', keyId, scopes: [] });
      assert.ok(!JSON.stringify(result.body).includes(rawKey));
      assert.equal((await post('/resources/list', { owner: personal, expectedActorAccountId: owner }, { key: rawKey })).status, 403);
    });
    for (const name of ['20260711120000-workspaces.sql', '20260811130000-agent-identities.sql', '20260905120000-workforce-resources.sql', '20260905121000-workforce-resource-operations.sql', '20260905130000-api-key-workforce-capabilities.sql']) {
      await pool.query((await readFile(new URL(`../src/server/database/migrations/${name}`, import.meta.url), 'utf8')).split('-- DOWN')[0]);
    }
    await pool.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role) VALUES($1,$2,'personal'),($3,$4,'personal')", [agent, owner, foreignAgent, foreign]);

    await t.test('grant updates require fresh sender-bound OIDC session, no key self-escalation or body freshness', async () => {
      const input = grantRequest();
      for (const options of [{ key: rawKey }, { token: token({ bound: false }) }, { token: token(), proof: false }, { token: token({ authTime: Math.floor(Date.now() / 1000) - 301 }) }, { token: token({ authTime: Math.floor(Date.now() / 1000) + 61 }) }]) {
        assert.equal((await post('/api-key-capabilities/operations', input, options)).status, 401);
      }
      assert.equal((await post('/api-key-capabilities/operations', { ...input, authTime: Date.now() })).status, 400);
      assert.equal((await pool.query('SELECT count(*) FROM api_key_workforce_capabilities')).rows[0].count, '0');
    });
    await t.test('scope, registered client, usable human and exact owner each constrain grant authority', async () => {
      assert.equal((await post('/api-key-capabilities/operations', grantRequest(), { token: token({ scope: 'openid workforce:manage' }) })).status, 403);
      assert.equal((await post('/api-key-capabilities/operations', grantRequest(), { token: token({ client: 'xeno-pixel' }) })).status, 403);
      assert.equal((await post('/api-key-capabilities/operations', grantRequest(), { token: token({ client: 'xeno-hub' }) })).status, 403);
      assert.equal((await post('/api-key-capabilities/operations', grantRequest(foreignKeyId))).status, 403);
      assert.equal((await post('/api-key-capabilities/operations', grantRequest(agentKeyId), { token: token({ actor: agent }) })).status, 403);
      await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [owner]);
      assert.equal((await post('/api-key-capabilities/operations', grantRequest())).status, 403);
      await pool.query("UPDATE users SET status='active' WHERE id=$1", [owner]);
      await pool.query("UPDATE users SET role='service' WHERE id=$1", [owner]);
      assert.equal((await post('/api-key-capabilities/operations', grantRequest())).status, 403);
      await pool.query("UPDATE users SET role='user' WHERE id=$1", [owner]);
      for (const scopes of [['*'], ['team:manage'], ['workforce:manage', 'workforce:manage'], ['workforce:read', 'workforce:manage', '*']]) assert.equal((await post('/api-key-capabilities/operations', grantRequest(keyId, '0', scopes))).status, 400);
    });
    await t.test('grant CAS receipts replay exactly once, conflict on changed payload and never expose key material', async () => {
      const input = grantRequest();
      const results = await Promise.all([post('/api-key-capabilities/operations', input), post('/api-key-capabilities/operations', input)]);
      assert.deepEqual(results.map(r => r.status), [200, 200]);
      assert.deepEqual(results.map(r => r.body.replayed).sort(), [false, true]);
      assert.equal(results[0].body.operation.revision, '1');
      assert.ok(!JSON.stringify(results).includes(rawKey));
      assert.equal((await post('/api-key-capabilities/operations', { ...input, scopes: ['workforce:read'] })).status, 409);
      assert.equal((await post('/api-key-capabilities/operations', grantRequest())).status, 409);
      const read = await post('/api-key-capabilities/read', { keyId, operationId: input.operationId });
      assert.equal(read.status, 200); assert.equal(read.body.state, 'committed'); assert.equal(read.body.revision, '1');
      assert.equal((await pool.query('SELECT count(*) FROM api_key_workforce_operations')).rows[0].count, '1');
    });
    await t.test('real hash-authenticated key creates/reads with its stable server namespace and no forged client identity', async () => {
      createOperation = { operationId: randomUUID(), owner: personal, expectedActorAccountId: owner, kind: 'team', name: 'Key-created team' };
      const result = await post('/resources', createOperation, { key: rawKey, headers: { 'x-client-id': 'xeno-web', 'x-user-id': foreign } });
      assert.equal(result.status, 200); assert.equal(result.body.operation.state, 'committed');
      const stored = (await pool.query('SELECT client_id,actor_user_id FROM workforce_resource_operations WHERE operation_id=$1', [createOperation.operationId])).rows[0];
      assert.deepEqual(stored, { client_id: apiKeyWorkforceNamespace(keyId), actor_user_id: owner });
      const read = await post('/resource-operations/read', { operationId: createOperation.operationId, owner: personal, expectedActorAccountId: owner }, { key: rawKey });
      assert.equal(read.status, 200); assert.equal(read.body.operation.resourceId, result.body.operation.resourceId);
      assert.equal((await post('/resources/list', { owner: personal, expectedActorAccountId: owner }, { key: rawKey })).status, 200);
      assert.equal((await existing()).status, 200);
      assert.equal((await post('/api-key-capabilities/operations', grantRequest(secondKeyId), { key: rawKey })).status, 401);
    });
    await t.test('missing or read-only grants cannot create; two keys never share operation receipts', async () => {
      assert.equal((await post('/resources/list', { owner: personal, expectedActorAccountId: owner }, { key: secondKey })).status, 403);
      assert.equal((await post('/api-key-capabilities/operations', grantRequest(secondKeyId, '0', ['workforce:read']))).status, 200);
      assert.equal((await post('/resources', { ...createOperation, operationId: randomUUID() }, { key: secondKey })).status, 403);
      const read = await post('/resource-operations/read', { operationId: createOperation.operationId, owner: personal, expectedActorAccountId: owner }, { key: secondKey });
      assert.equal(read.status, 200); assert.equal(read.body.state, 'not-observed');
    });
    await t.test('responsible human can grant its agent key; foreign agents, retired agents and service machines cannot', async () => {
      assert.equal((await post('/api-key-capabilities/operations', grantRequest(foreignAgentKeyId))).status, 403);
      await pool.query("UPDATE agent_identities SET status='retired' WHERE user_id=$1", [agent]);
      assert.equal((await post('/api-key-capabilities/operations', grantRequest(agentKeyId))).status, 403);
      await pool.query("UPDATE agent_identities SET status='active' WHERE user_id=$1", [agent]);
      await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [owner]);
      assert.equal((await post('/api-key-capabilities/operations', grantRequest(agentKeyId))).status, 403);
      await pool.query("UPDATE users SET status='active' WHERE id=$1", [owner]);
      assert.equal((await post('/api-key-capabilities/operations', grantRequest(agentKeyId))).status, 200);
      await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('user',$1,'workforce_resource_creator','agent',$2)", [owner, agent]);
      const result = await post('/resources', { ...createOperation, operationId: randomUUID(), expectedActorAccountId: agent }, { key: agentKey });
      assert.equal(result.status, 200); assert.equal(result.body.resource.createdByUserId, agent);
      assert.equal((await post('/resources/list', { owner: personal, expectedActorAccountId: agent }, { key: agentKey })).status, 403, 'creator does not imply reader grant');
    });
    await t.test('same-transaction guard refuses revoked scope even with previously accepted ingress context', async () => {
      const tx = await pool.connect(); let pending;
      try {
        await tx.query('BEGIN'); await tx.query('SELECT id FROM api_keys WHERE id=$1 FOR UPDATE', [keyId]);
        await tx.query("UPDATE api_key_workforce_capabilities SET scopes=ARRAY['workforce:read'],revision=revision+1 WHERE api_key_id=$1", [keyId]);
        pending = createWorkforceResource(pool, { actorUserId: owner, clientId: apiKeyWorkforceNamespace(keyId), apiKeyId: keyId }, { ...createOperation, operationId: randomUUID() })
          .then(() => ({ allowed: true }), error => ({ allowed: false, code: error.code }));
        let waiting = false;
        for (let i = 0; i < 50; i++) {
          if ((await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%FROM api_keys%FOR SHARE%'", [schema])).rowCount) { waiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(waiting); await tx.query('COMMIT'); assert.deepEqual(await pending, { allowed: false, code: 'denied' });
      } finally { await tx.query('ROLLBACK').catch(() => {}); tx.release(); await pending; }
      assert.equal((await post('/resources', { ...createOperation, operationId: randomUUID() }, { key: rawKey })).status, 403);
      assert.equal((await post('/resources/list', { owner: personal, expectedActorAccountId: owner }, { key: rawKey })).status, 200);
    });
    await t.test('overall revocation and expiration deny authentication; untrusted workspace keys never gain global access', async () => {
      const revoke = { keyId, operationId: randomUUID(), expectedRevision: '2', action: 'revoke-key' };
      assert.equal((await post('/api-key-capabilities/operations', revoke)).status, 200);
      assert.equal((await existing()).status, 401);
      assert.equal((await post('/resources/list', { owner: personal, expectedActorAccountId: owner }, { key: rawKey })).status, 401);
      await pool.query("UPDATE api_keys SET expires_at=now()-interval '1 second' WHERE id=$1", [secondKeyId]);
      assert.equal((await post('/resources/list', { owner: personal, expectedActorAccountId: owner }, { key: secondKey })).status, 401);
      assert.equal((await post('/resources/list', { owner: personal, expectedActorAccountId: owner }, { key: `xeno-ws-v1_${'a'.repeat(64)}` })).status, 403);
      await assert.rejects(listOwnedWorkforceResources(pool, { actorUserId: owner, clientId: apiKeyWorkforceNamespace(keyId) }, { owner: personal, expectedActorAccountId: owner }), error => error.code === 'denied');
    });
    await t.test('grant audit is immutable and the shared step-up window preserves existing OAuth semantics', async () => {
      await assert.rejects(pool.query('DELETE FROM api_key_workforce_operations'), error => error.code === '23514');
      const policy = { scope: 'account:logout', clients: ['xeno-web'] }, auth = { kind: 'oidc', clientId: 'xeno-web', scope: 'account:logout', authTime: 1000 };
      assert.equal(recentOidcAuthAllowed(auth, policy, 1300), true); assert.equal(recentOidcAuthAllowed(auth, policy, 1301), false);
      assert.equal(recentOidcAuthAllowed({ ...auth, authTime: 1360 }, policy, 1300), true); assert.equal(recentOidcAuthAllowed({ ...auth, authTime: 1361 }, policy, 1300), false);
      assert.equal(recentOidcAuthAllowed({ ...auth, kind: 'api-key' }, policy, 1300), false);
    });
    await t.test('existing API-key, token-confusion and OIDC provider suites pass on separately isolated schemas', async () => {
      for (const filename of ['api-key-auth.test.mjs', 'auth-token-confusion.test.mjs', 'oidc-v2.test.mjs']) {
        const regressionSchema = `workforce_auth_regression_${randomBytes(10).toString('hex')}`;
        await pool.query(`CREATE SCHEMA "${regressionSchema}"`);
        try {
          const target = new URL(connectionString);
          target.searchParams.set('options', `-c search_path=${regressionSchema}`);
          const child = spawnSync(process.execPath, [fileURLToPath(new URL(`../src/server/tests/${filename}`, import.meta.url))], {
            cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true, timeout: 60000, encoding: 'utf8', maxBuffer: 1024 * 1024,
            env: { ...process.env, DATABASE_URL: target.toString() },
          });
          assert.equal(child.status, 0, `${filename} failed on owned schema:\n${child.stdout}\n${child.stderr}`);
        } finally { await pool.query(`DROP SCHEMA "${regressionSchema}" CASCADE`); }
      }
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
