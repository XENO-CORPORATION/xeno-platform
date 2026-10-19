// Website Storage → XENO Connect BFF (services/webConnect.js), against real Postgres and a Connect stand-in that
// verifies exactly what Connect verifies: ES256 at+jwt for aud xeno-connect, DPoP (jkt, htm, htu, ath, jti replay),
// then asks Platform's authority for the live answer. Proves: only a website COOKIE session mints; the token never
// reaches the browser; 410 EXPIRED renews once with the same Idempotency-Key; 403 is never renewed; membership and
// workspace are required; linking is forced to browser-start and an off-origin start URL is refused; sign-out ends
// access; the RFC 8693 exchange can never produce the web consumer; unlisted Connect paths are not proxied.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { browserSessionMiddleware } from '../middleware/browserSession.js';
import { authMiddleware } from '../middleware/auth.js';
import { createWebConnectRouter } from '../routes/webConnectRoutes.js';
import { authorityForToken, connectExchangeGrant, verifyConnectAccessToken } from '../services/connectAuthority.js';
import { CONNECT_WEB_CONSUMER } from '../config/oidcAuthorityPolicy.js';
import { forgetWebConnectTokens, routeFor } from '../services/webConnect.js';
import { jwkThumbprint } from '../utils/dpop.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

async function setup() {
  await pool.query('CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, reference_type varchar(64), reference_id varchar(128))');
  await pool.query('CREATE TABLE IF NOT EXISTS external_identity_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system varchar(64) NOT NULL, external_user_id text, external_email text, platform_user_id uuid NOT NULL, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())');
  await migrateAccountV2(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, username text,
    display_name text, avatar_url text, created_at timestamptz DEFAULT now(), email_verified boolean DEFAULT true,
    is_active boolean DEFAULT true, role text DEFAULT 'user', status text DEFAULT 'active')`);
  for (const col of ['created_at timestamptz DEFAULT now()', 'email_verified boolean DEFAULT true', 'is_active boolean DEFAULT true']) {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col}`);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS agent_identities (user_id uuid PRIMARY KEY, owner_user_id uuid, agent_role text,
    agent_origin text, status text DEFAULT 'active')`);
  await pool.query(`CREATE TABLE IF NOT EXISTS user_sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL, token_hash text,
    expires_at timestamptz NOT NULL, last_active_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS browser_session_state (sid uuid PRIMARY KEY REFERENCES user_sessions(id) ON DELETE CASCADE,
    csrf_hash text NOT NULL, purpose text NOT NULL DEFAULT 'standard', created_at timestamptz DEFAULT now(), rotated_at timestamptz DEFAULT now())`);
  const person = (await pool.query("INSERT INTO users (email, username, display_name) VALUES ('p@xeno.test','person','Person') RETURNING id")).rows[0].id;
  const outsider = (await pool.query("INSERT INTO users (email, username, display_name) VALUES ('o@xeno.test','other','Other') RETURNING id")).rows[0].id;
  const ws = crypto.randomUUID(); const otherWs = crypto.randomUUID();
  await pool.query(`INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id) VALUES
    ('workspace',$1,'member','user',$2), ('workspace',$3,'member','user',$4)`, [ws, person, otherWs, outsider]);
  return { person, ws, otherWs };
}

async function browserSession(userId) {
  const sid = crypto.randomUUID(); const cookie = crypto.randomBytes(24).toString('base64url'); const csrf = crypto.randomBytes(16).toString('hex');
  await pool.query("INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3, now() + interval '1 hour')", [sid, userId, sha(cookie)]);
  await pool.query('INSERT INTO browser_session_state (sid, csrf_hash) VALUES ($1,$2)', [sid, sha(csrf)]);
  return { sid, headers: { cookie: `xeno_session=${cookie}; xeno_csrf=${csrf}`, 'x-xeno-csrf': csrf } };
}

/** The Connect stand-in: same verification order as xeno-connect apps/service/src/auth.ts + dpop.ts. */
function connectStandIn(state) {
  const app = express();
  const seen = new Set();
  app.use(express.raw({ type: '*/*', limit: '9mb' }));
  app.use(async (req, res, next) => {
    try {
      const m = /^DPoP ([A-Za-z0-9_.-]+)$/.exec(req.headers.authorization || '');
      if (!m) throw new Error('no dpop token');
      const claims = await verifyConnectAccessToken(pool, m[1]);
      const proof = jwt.decode(req.headers.dpop, { complete: true });
      const p = jwt.verify(req.headers.dpop, crypto.createPublicKey({ key: proof.header.jwk, format: 'jwk' }), { algorithms: ['ES256'] });
      const htu = new URL(req.originalUrl, state.origin); htu.search = '';
      if (jwkThumbprint(proof.header.jwk) !== claims.cnf.jkt || p.htm !== req.method || p.htu !== htu.href
        || p.ath !== crypto.createHash('sha256').update(m[1]).digest('base64url') || seen.has(p.jti)) throw new Error('bad proof');
      seen.add(p.jti);
      req.authority = await authorityForToken(pool, { token: m[1], workspaceId: req.originalUrl.split('/')[4] });
      if (!req.authority.scopes.length) throw new Error('no authority');
      state.tokens.push(m[1]); state.log.push({ method: req.method, path: req.path, key: req.headers['idempotency-key'] || null });
      next();
    } catch (e) { state.refusals.push(e.message); res.status(403).json({ error: { code: 'FORBIDDEN' } }); }
  });
  const base = '/v1/connect/workspaces/:ws';
  app.get(`${base}/connections`, (req, res) => res.json([{ id: 'conn1', workspaceId: req.params.ws, providerId: 'google', providerAppId: 'google-xeno', providerAccountId: 'acct', displayName: 'p@gmail.test', status: 'active', grantedScopes: [], revision: 1 }]));
  app.post(`${base}/link/sessions`, (req, res) => {
    state.linkBody = JSON.parse(req.body.toString());
    res.set('set-cookie', '__Host-connect-link=binding; Secure; HttpOnly');
    res.json({ id: 'link1', startUrl: state.startUrl ?? `${state.origin}/v1/connect/link/start/${'h'.repeat(24)}`, expiresAt: Date.now() + 600000 });
  });
  app.put(`${base}/connections/:c/grants/self`, (req, res) => { state.grantLive = true; res.json({ ok: true }); });
  app.post(`${base}/connections/:c/operations/drive.files.list`, (req, res) => {
    if (req.params.c === 'gone') return res.status(410).json({ error: { code: 'GONE' } });
    if (req.params.c === 'denied') return res.status(403).json({ error: { code: 'FORBIDDEN' } });
    if (!state.grantLive) return res.status(410).json({ error: { code: 'EXPIRED' } });
    res.json({ files: [{ id: 'f1', name: 'a.txt', mimeType: 'text/plain', size: '5' }], incompleteSearch: false });
  });
  app.get(`${base}/connections/:c/content`, (req, res) => { res.status(206).set('content-range', `bytes ${req.query.start}-${req.query.end}/5`); res.end(Buffer.from('hello').subarray(Number(req.query.start), Number(req.query.end) + 1)); });
  app.put(`${base}/connections/:c/uploads/:u/parts`, (req, res) => res.json({ id: req.params.u, status: 'completed', acknowledgedBytes: String(req.body.length), fileId: 'f2' }));
  return app;
}

const listen = (app) => new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });

async function main() {
  const { person, ws, otherWs } = await setup();
  const state = { tokens: [], log: [], refusals: [], grantLive: false };
  const connect = await listen(connectStandIn(state));
  state.origin = `http://127.0.0.1:${connect.address().port}`;
  const env = { XENO_WEB_CONNECT_ORIGIN: state.origin };
  const app = express();
  app.use('/api/', browserSessionMiddleware(pool));
  const databaseMiddleware = (req, _res, next) => { req.db = pool; next(); };
  app.use('/api/storage/connect', databaseMiddleware, authMiddleware, createWebConnectRouter({ env }));
  const server = await listen(app);
  const at = `http://127.0.0.1:${server.address().port}/api/storage/connect/workspaces`;
  const s = await browserSession(person);
  const call = (method, path, { headers = s.headers, body, raw } = {}) => fetch(`${at}/${path}`, {
    method, headers: { ...headers, ...(raw ? { 'content-type': 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  try {
    // 1. A website cookie session reaches Connect; the reply carries no token.
    let r = await call('GET', `${ws}/connections`);
    assert.equal(r.status, 200); const text = await r.text();
    assert.equal(JSON.parse(text)[0].id, 'conn1');
    assert.ok(state.tokens.length && !state.tokens.some((t) => text.includes(t)), 'the Connect token must never reach the browser');
    assert.equal(r.headers.get('set-cookie'), null);
    const claims = jwt.decode(state.tokens[0]);
    assert.equal(claims.client_id, CONNECT_WEB_CONSUMER); assert.equal(claims.xeno_session, 'web'); assert.ok(claims.exp - claims.iat <= 300);
    assert.equal(claims.scope, 'connect:manage connect:read connect:use');

    // 2. A bearer token (no cookie) cannot use the web consumer, even for the same user and a live session.
    const bearer = jwt.sign({ userId: person, sid: s.sid }, process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production', { algorithm: 'HS256', expiresIn: '2m' });
    r = await call('GET', `${ws}/connections`, { headers: { authorization: `Bearer ${bearer}` } });
    assert.equal(r.status, 401); assert.equal((await r.json()).error.code, 'website_session_required');

    // 3. Workspace named and a member, or refused. No fallback.
    assert.equal((await call('GET', 'not-a-uuid/connections')).status, 400);
    const before = state.log.length + state.refusals.length;
    assert.equal((await call('GET', `${otherWs}/connections`)).status, 403);
    assert.equal(state.log.length + state.refusals.length, before, 'a non-member is refused before anything reaches Connect');

    // 4. 410 EXPIRED → PUT grants/self {} once → the same request with the SAME Idempotency-Key.
    state.log.length = 0;
    r = await call('POST', `${ws}/connections/conn1/operations/drive.files.list`, { body: {}, headers: { ...s.headers, 'idempotency-key': 'k'.repeat(20) } });
    assert.equal(r.status, 200); assert.equal((await r.json()).files[0].id, 'f1');
    assert.deepEqual(state.log.map((l) => [l.method, l.path.split('/').slice(-2).join('/'), l.key]), [
      ['POST', 'operations/drive.files.list', 'k'.repeat(20)], ['PUT', 'grants/self', null], ['POST', 'operations/drive.files.list', 'k'.repeat(20)]]);

    // 5. 403 is final: never renewed.
    state.log.length = 0; state.grantLive = false;
    r = await call('POST', `${ws}/connections/denied/operations/drive.files.list`, { body: {} });
    assert.equal(r.status, 403); assert.equal(state.log.length, 1);
    state.log.length = 0;
    r = await call('POST', `${ws}/connections/gone/operations/drive.files.list`, { body: {} });
    assert.equal(r.status, 410); assert.equal(state.log.length, 1, 'only EXPIRED is renewed');

    // 6. Linking is forced to browser-start; Connect's binding cookie is never forwarded; off-origin start refused.
    r = await call('POST', `${ws}/link/sessions`, { body: { providerAppId: 'google-xeno', delivery: 'direct' } });
    assert.equal(r.status, 200); assert.deepEqual(state.linkBody, { providerAppId: 'google-xeno', delivery: 'browser-start' });
    assert.equal(r.headers.get('set-cookie'), null);
    const started = await r.json();
    assert.deepEqual(Object.keys(started).sort(), ['expiresAt', 'id', 'startUrl']);
    assert.ok(started.startUrl.startsWith(`${state.origin}/v1/connect/link/start/`));
    state.startUrl = 'https://evil.test/v1/connect/link/start/' + 'h'.repeat(24);
    assert.equal((await call('POST', `${ws}/link/sessions`, { body: { providerAppId: 'google-xeno' } })).status, 502);
    delete state.startUrl;

    // 7. Ranged read passes Content-Range through; upload part carries the bytes.
    r = await call('GET', `${ws}/connections/conn1/content?fileId=f1&start=1&end=3`);
    assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), 'bytes 1-3/5'); assert.equal(await r.text(), 'ell');
    r = await call('PUT', `${ws}/connections/conn1/uploads/up1/parts?offset=0`, { raw: Buffer.from('abc') });
    assert.equal(r.status, 200); assert.equal((await r.json()).fileId, 'f2');

    // 8. Only the closed list is proxied: grant management, unknown operations and traversal are not.
    assert.equal(routeFor('PUT', 'connections/conn1/grants'), null);
    assert.equal(routeFor('POST', 'connections/conn1/operations/drive.files.replace'), null);
    assert.equal(routeFor('GET', 'connections/../audit/verify'), null);
    assert.equal((await call('PUT', `${ws}/connections/conn1/grants`, { body: {} })).status, 404);

    // 9. CSRF: a cookie POST without the double-submit header is refused before any Connect call.
    const noCsrf = { cookie: s.headers.cookie };
    assert.equal((await call('POST', `${ws}/connections/conn1/revoke`, { body: {}, headers: noCsrf })).status, 403);

    // 10. Sign-out ends access: the cached token is refused by Connect on its next use.
    const cached = state.tokens.at(-1);
    await pool.query('DELETE FROM user_sessions WHERE id = $1', [s.sid]);
    await assert.rejects(verifyConnectAccessToken(pool, cached));

    // 12. RFC 8693 can never yield the web consumer.
    await assert.rejects(connectExchangeGrant(pool, {
      subjectPayload: { client_id: CONNECT_WEB_CONSUMER, sub: person, cnf: { jkt: 'x' }, exp: Math.floor(Date.now() / 1000) + 60 }, proofJkt: 'x',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token', requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      resource: 'https://connect.xeno.test', audience: 'xeno-connect', scope: 'connect:read', env: { XENO_CONNECT_ORIGINS: 'https://connect.xeno.test' },
    }), (e) => e.oauthError === 'unauthorized_client');
  } finally { server.close(); connect.close(); forgetWebConnectTokens(); }
  console.log('web-connect: ok');
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
