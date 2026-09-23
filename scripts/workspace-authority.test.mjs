import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import { createRequire } from 'node:module';
import express from 'express';
import { authMiddleware } from '../src/server/middleware/auth.js';
import { workspaceRoutes, workspaceInviteRoutes } from '../src/server/routes/workspaceRoutes.js';
import { migrateAccountV2 } from '../src/server/database/migrate-account-v2.js';
import { getSigningKey } from '../src/server/utils/oidcProvider.js';
import { accessTokenHash, jwkThumbprint } from '../src/server/utils/dpop.js';
import { workspaceRequiredScope } from '../src/server/middleware/workspaceScopes.js';
const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');

const url = process.env.WORKSPACE_AUTH_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/workspaceproof') throw new Error('Only the isolated local workspaceproof database is permitted.');
}

test('workspace request scope policy keeps billing separate and selection read-only', () => {
  for (const [method, path, expected] of [
    ['GET', '/one/members', 'team:read'], ['PATCH', '/one/members/two', 'team:manage'],
    ['POST', '/one/select', 'team:read'], ['GET', '/one/billing', 'billing:read'],
    ['POST', '/one/billing/transfer', 'billing:manage'], ['PATCH', '/one/budget', 'billing:manage'],
    ['GET', '/one/BILLING', 'billing:read'], ['POST', '/one/SELECT', 'team:read'],
  ]) assert.equal(workspaceRequiredScope({ method, path }), expected);
});

test('real PostgreSQL + HTTP workspace authentication, DPoP, scope and ReBAC boundary', { skip: !url }, async (t) => {
  const schema = `workspace_auth_${crypto.randomBytes(8).toString('hex')}`;
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 3 });
  let server;
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TABLE users (id uuid PRIMARY KEY, username text, email text, display_name text, avatar_url text, created_at timestamptz DEFAULT now(), email_verified boolean DEFAULT true, is_active boolean DEFAULT true);
      CREATE TABLE credit_transactions (user_id uuid, reference_type text, reference_id text);
      CREATE TABLE user_sessions (id uuid PRIMARY KEY, user_id uuid, expires_at timestamptz, last_active_at timestamptz DEFAULT now());
      CREATE TABLE api_keys (id uuid PRIMARY KEY, user_id uuid, key_prefix text, key_hash text, is_active boolean, expires_at timestamptz, last_used_at timestamptz, usage_count integer DEFAULT 0);`);
    await migrateAccountV2(pool);
    const migration = await fs.readFile(new URL('../src/server/database/migrations/20260711120000-workspaces.sql', import.meta.url), 'utf8');
    await pool.query(migration.split('-- DOWN')[0]);
    await pool.query((await fs.readFile(new URL('../src/server/database/migrations/20260318000001-infrastructure-tables.sql', import.meta.url), 'utf8')).split('-- DOWN')[0]);
    for (const file of ['20260904120000-durable-webhook-delivery.sql', '20260904121000-agent-notification-scopes.sql', '20260904200000-workspace-key-operations.sql', '20260904210000-workspace-membership-operations.sql', '20260904270000-notification-destination-operations.sql']) {
      await pool.query((await fs.readFile(new URL(`../src/server/database/migrations/${file}`, import.meta.url), 'utf8')).split('-- DOWN')[0]);
    }
    const owner = crypto.randomUUID(), admin = crypto.randomUUID(), viewer = crypto.randomUUID(), stranger = crypto.randomUUID();
    for (const [id, name] of [[owner, 'owner'], [admin, 'admin'], [viewer, 'viewer'], [stranger, 'stranger']]) {
      await pool.query('INSERT INTO users(id,username,email,display_name) VALUES ($1,$2,$3,$2)', [id, name, `${name}@example.test`]);
    }
    const ws = crypto.randomUUID(), foreign = crypto.randomUUID();
    for (const [id, ownerId] of [[ws, owner], [foreign, stranger]]) {
      await pool.query("INSERT INTO workspaces(id,owner_user_id,workspace_type,name,slug,metadata) VALUES ($1::uuid,$2,'team','Test',$1::text,'{\"billing\":{\"plan\":\"team\",\"status\":\"active\",\"seat_limit\":10}}')", [id, ownerId]);
    }
    for (const [workspace, id, role] of [[ws, owner, 'owner'], [ws, admin, 'admin'], [ws, viewer, 'viewer'], [foreign, stranger, 'owner']]) {
      await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,$2,'user',$3)", [workspace, role, id]);
    }
    const key = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const publicJwk = key.publicKey.export({ format: 'jwk' });
    const jkt = jwkThumbprint(publicJwk);
    const signing = await getSigningKey(pool);
    const mint = async ({ user = owner, client = 'xeno-post', scopes = 'team:read team:manage', bound = true } = {}) => {
      const sid = crypto.randomUUID();
      await pool.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch) VALUES($1,0) ON CONFLICT DO NOTHING', [user]);
      await pool.query("INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at) VALUES($1,$2,0,now(),$3,now()+interval '1 hour')", [sid, user, bound ? jkt : null]);
      return jwt.sign({ sub: user, sid, auth_epoch: 0, auth_time: Math.floor(Date.now()/1000), client_id: client, scope: scopes, typ: 'at+jwt', ...(bound ? { cnf: { jkt } } : {}) }, signing.privatePem, { algorithm: signing.alg, keyid: signing.kid, audience: 'xeno-api', issuer: 'https://xenostudio.ai', expiresIn: '10m', header: { typ: 'at+jwt' } });
    };
    const proof = (token, method, path, overrides = {}) => jwt.sign({
      jti: crypto.randomUUID(), htm: method, htu: `https://xenostudio.ai${path}`, iat: Math.floor(Date.now()/1000), ath: accessTokenHash(token), ...overrides,
    }, key.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk: publicJwk } });
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.db = pool; next(); });
    app.use('/api/workspaces', authMiddleware, workspaceRoutes);
    app.use('/api/workspace-invites', authMiddleware, workspaceInviteRoutes);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const request = async (token, method, path, body, suppliedProof, scheme = 'DPoP', extra = {}) => {
      const headers = { authorization: `${scheme} ${token}`, 'content-type': 'application/json', ...extra };
      if (suppliedProof !== null) headers.dpop = suppliedProof ?? proof(token, method, path);
      return fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    };
    const token = await mint(), members = `/api/workspaces/${ws}/members`;
    await t.test('notification ingress requires DPoP account authority, scope and current ReBAC', async () => {
      const scope = { workspaceId: 'local-workspace', workspaceCreatedAt: new Date().toISOString() };
      const endpoint = `/api/workspaces/${ws}/notifications`;
      const query = `${endpoint}?scope=${encodeURIComponent(JSON.stringify(scope))}`;
      const endpointId = (await pool.query("INSERT INTO webhooks(user_id,notification_workspace_id,url,secret,events) VALUES($1,$2,'https://hooks.slack.com/services/T123/B123/fixture-token','fixture-secret',ARRAY[]::text[]) RETURNING id", [owner, ws])).rows[0].id;
      const response = await request(token, 'GET', query, undefined, proof(token, 'GET', endpoint));
      assert.equal(response.status, 200); assert.equal((await response.json()).revision, '0');
      assert.equal((await request(token, 'GET', query, undefined, null)).status, 401);
      assert.equal((await request(await mint({ bound: false }), 'GET', query, undefined, null, 'Bearer')).status, 401);
      const body = { scope, expectedRevision: '0', rules: [{ event: 'agent.finished', channel: 'webhook', destinationId: endpointId, enabled: true }] };
      assert.equal((await request(await mint({ scopes: 'team:read' }), 'POST', `${endpoint}/settings`, body)).status, 403);
      assert.equal((await request(await mint({ user: stranger }), 'POST', `${endpoint}/settings`, body)).status, 403);
      assert.equal((await request(await mint({ user: viewer }), 'POST', `${endpoint}/settings`, body)).status, 403);
      assert.equal((await request(token, 'POST', `${endpoint}/settings`, body)).status, 200);
      const richResponse = await request(token, 'GET', `${endpoint}/v2?scope=${encodeURIComponent(JSON.stringify(scope))}`, undefined, proof(token, 'GET', `${endpoint}/v2`));
      assert.equal(richResponse.status, 200);
      const rich = await richResponse.json();
      assert.equal(rich.channelVersion, 2); assert.equal(rich.destinations[0].channel, 'slack');
      assert.ok(!JSON.stringify(rich).includes('fixture-token'));
      assert.equal((await request(token, 'GET', `${endpoint}/v2?scope=${encodeURIComponent(JSON.stringify(scope))}`, undefined, null)).status, 401);
      assert.equal((await request(token, 'POST', `${endpoint}/v2/settings`, { ...body, expectedRevision: rich.revision })).status, 400);
      assert.equal((await request(token, 'POST', `${endpoint}/v2/settings`, { ...body, expectedRevision: rich.revision, rules: [{ ...body.rules[0], channel: 'slack' }] })).status, 200);
      const event = { scope, event: 'agent.finished', eventId: 'a'.repeat(64), occurredAt: new Date().toISOString(), conversationId: 'c', requestId: 'r' };
      assert.equal((await request(token, 'POST', `${endpoint}/events`, event)).status, 200);
      const replay = await request(token, 'POST', `${endpoint}/events`, event);
      assert.equal(replay.status, 200); assert.equal((await replay.json()).duplicate, true);
    });
    await t.test('valid sender-bound account sees own members', async () => {
      const response = await request(token, 'GET', members); assert.equal(response.status, 200);
      assert.equal((await response.json()).members.length, 3);
    });
    await t.test('missing proof and Bearer downgrade are rejected', async () => {
      assert.equal((await request(token, 'GET', members, null, null)).status, 401);
      assert.equal((await request(token, 'GET', members, null, undefined, 'Bearer')).status, 401);
    });
    await t.test('method, URI, key, token hash and time are bound; forwarded host cannot override origin', async () => {
      for (const override of [{ htm: 'POST' }, { htu: 'https://evil.test'+members }, { ath: 'wrong' }, { iat: 1 }]) {
        assert.equal((await request(token, 'GET', members, null, proof(token, 'GET', members, override), 'DPoP', { 'x-forwarded-host': 'evil.test' })).status, 401);
      }
      const otherKey = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const otherProof = jwt.sign({ jti: crypto.randomUUID(), htm: 'GET', htu: 'https://xenostudio.ai'+members, ath: accessTokenHash(token), iat: Math.floor(Date.now()/1000) }, otherKey.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk: otherKey.publicKey.export({ format: 'jwk' }) } });
      assert.equal((await request(token, 'GET', members, null, otherProof)).status, 401);
    });
    await t.test('one proof cannot be consumed twice, including concurrent requests', async () => {
      const sharedProof = proof(token, 'GET', members);
      const replies = await Promise.all([request(token, 'GET', members, null, sharedProof), request(token, 'GET', members, null, sharedProof)]);
      assert.deepEqual(replies.map(r => r.status).sort(), [200, 401]);
    });
    await t.test('missing scope and sibling product ceiling reject even the workspace owner', async () => {
      assert.equal((await request(await mint({ scopes: 'inference:run' }), 'GET', members)).status, 403);
      assert.equal((await request(await mint({ client: 'xeno-pixel' }), 'GET', members)).status, 403);
      assert.equal((await request(await mint({ client: 'xeno-agent-cli' }), 'GET', members)).status, 403);
      const readOnly = await mint({ scopes: 'team:read' });
      assert.equal((await request(readOnly, 'PATCH', `${members}/${viewer}`, { member_role: 'member' })).status, 403);
    });
    await t.test('scopes do not bypass foreign workspace, viewer or owner restrictions', async () => {
      assert.equal((await request(token, 'GET', `/api/workspaces/${foreign}/members`)).status, 403);
      assert.equal((await request(await mint({ user: viewer }), 'PATCH', `${members}/${admin}`, { member_role: 'viewer' })).status, 403);
      const adminToken = await mint({ user: admin });
      assert.equal((await request(adminToken, 'PATCH', `${members}/${owner}`, { member_role: 'viewer' })).status, 400);
      assert.equal((await request(adminToken, 'PATCH', `${members}/${viewer}`, { member_role: 'owner' })).status, 400);
      assert.equal((await request(adminToken, 'POST', `/api/workspaces/${ws}/owner-transfer`, { new_owner_user_id: admin })).status, 403);
      assert.equal((await request(adminToken, 'POST', `/api/workspaces/${ws}/invites`, { email: 'someone@example.test', role: 'owner' })).status, 400);
      assert.equal(Number((await pool.query('SELECT count(*) FROM workspace_invites WHERE workspace_id=$1', [ws])).rows[0].count), 0, 'invalid owner invitations create no rows');
      assert.equal((await pool.query('SELECT owner_user_id FROM workspaces WHERE id=$1', [ws])).rows[0].owner_user_id, owner);
      assert.equal((await request(adminToken, 'PATCH', `${members}/${viewer}`, { member_role: 'member' })).status, 200);
    });
    await t.test('foreign invitation cannot be accepted or enumerated', async () => {
      const invite = crypto.randomUUID();
      await pool.query("INSERT INTO workspace_invites(id,workspace_id,invited_by_user_id,invited_user_id,invited_email,role,token,expires_at) VALUES($1::uuid,$2,$3,$4,'stranger@example.test','editor',$1::text,now()+interval '1 day')", [invite, ws, owner, stranger]);
      assert.equal((await request(token, 'POST', `/api/workspace-invites/${invite}/accept`)).status, 404);
      const unchanged = (await pool.query('SELECT status,invited_user_id FROM workspace_invites WHERE id=$1', [invite])).rows[0];
      assert.equal(unchanged.status, 'pending'); assert.equal(unchanged.invited_user_id, stranger);
      assert.deepEqual((await (await request(token, 'GET', '/api/workspace-invites')).json()).invites, []);
    });
    await t.test('verified legacy browser session remains compatible; cookies alone do not authenticate', async () => {
      const sid = crypto.randomUUID();
      await pool.query("INSERT INTO user_sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [sid, owner]);
      const legacy = jwt.sign({ userId: owner, sid }, process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production', { algorithm: 'HS256', expiresIn: '10m' });
      assert.equal((await request(legacy, 'GET', members, null, null, 'Bearer')).status, 200);
      assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${members}`, { headers: { cookie: `token=${legacy}` } })).status, 401);
      await pool.query('DELETE FROM user_sessions WHERE id=$1', [sid]);
      assert.equal((await request(legacy, 'GET', members, null, null, 'Bearer')).status, 401);
    });
    await t.test('revoked OAuth session fails before proof or workspace reads', async () => {
      await pool.query('UPDATE oauth_session_state SET revoked_at=now() WHERE sid=$1', [jwt.decode(token).sid]);
      assert.equal((await request(token, 'GET', members)).status, 401);
    });
    await t.test('legacy unbound OIDC still needs scopes, and existing API keys still need membership', async () => {
      assert.equal((await request(await mint({ bound: false }), 'GET', members, null, null, 'Bearer')).status, 200);
      const raw = 'xeno-' + crypto.randomBytes(24).toString('hex');
      const keyId = crypto.randomUUID();
      await pool.query('INSERT INTO api_keys(id,user_id,key_prefix,key_hash,is_active) VALUES($1,$2,$3,$4,true)', [keyId, owner, raw.slice(0,16), crypto.createHash('sha256').update(raw).digest('hex')]);
      assert.equal((await request(raw, 'GET', members, null, null, 'Bearer')).status, 200);
      assert.equal((await request(raw, 'GET', `/api/workspaces/${foreign}/members`, null, null, 'Bearer')).status, 403);
      await pool.query('UPDATE api_keys SET is_active=false WHERE id=$1', [keyId]);
      assert.equal((await request(raw, 'GET', members, null, null, 'Bearer')).status, 401);
    });
    await t.test('proof ledger failure refuses the request without leaking DB errors', async () => {
      const valid = await mint();
      await pool.query('ALTER TABLE oauth_dpop_replays RENAME TO unavailable_dpop_replays');
      const response = await request(valid, 'GET', members);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { success: false, error: 'authorization_unavailable' });
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    // Only the unique schema created above in the explicitly isolated local DB.
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end();
  }
});
