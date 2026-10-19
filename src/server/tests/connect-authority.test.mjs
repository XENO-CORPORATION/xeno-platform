// XENO Connect audience + authority (services/connectAuthority.js), against real Postgres.
// Proves: exchange only from a DPoP-bound xeno-api token of a ceilinged client; connect:manage for people only; the
// xeno-connect token is refused where xeno-api is required (and the reverse); live authority narrows on suspension
// and on lost membership; no workspace → refused; the service surface fails closed; the Connect adapter round-trips.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { accessTokenHash, jwkThumbprint } from '../utils/dpop.js';
import oauth2Router from '../routes/oauth2Routes.js';
import { issuer } from '../config/hosts.js';
import { createAuthorizationCode, exchangeAuthorizationCode, verifyAccessToken } from '../utils/oidcProvider.js';
import {
  authorityForCallback, authorityForToken, connectExchangeGrant, verifyConnectAccessToken,
} from '../services/connectAuthority.js';
import { createConnectAuthorityRouter } from '../routes/connectAuthorityRoutes.js';
import { createPlatformAuthority } from '../../../integrations/xeno-connect/platform-authority.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const RESOURCE = 'https://connect.xeno.test';
const env = { XENO_CONNECT_ORIGINS: RESOURCE };
const TT = 'urn:ietf:params:oauth:token-type:access_token';

function keyPair() {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return publicKey.export({ format: 'jwk' });
}
async function refusal(promise, code) {
  await assert.rejects(promise, (e) => { assert.equal(e.oauthError || e.code, code); return true; });
}

async function setup() {
  await pool.query('CREATE TABLE credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, reference_type varchar(64), reference_id varchar(128))');
  await pool.query('CREATE TABLE external_identity_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system varchar(64) NOT NULL, external_user_id text, external_email text, platform_user_id uuid NOT NULL, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())');
  await migrateAccountV2(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, username text,
    display_name text, avatar_url text, email_verified boolean DEFAULT true, is_active boolean DEFAULT true,
    role text DEFAULT 'user', status text DEFAULT 'active')`);
  await pool.query(`CREATE TABLE IF NOT EXISTS agent_identities (user_id uuid PRIMARY KEY, owner_user_id uuid, agent_role text,
    agent_origin text, status text DEFAULT 'active')`);
  const human = (await pool.query("INSERT INTO users (email, username, display_name) VALUES ('p@xeno.test','person','Person') RETURNING id")).rows[0].id;
  const agent = (await pool.query("INSERT INTO users (email, username, display_name) VALUES ('a@xeno.test','bot.person','Bot') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO agent_identities (user_id, owner_user_id, agent_role) VALUES ($1,$2,'worker')", [agent, human]);
  await pool.query(`INSERT INTO oauth_clients (client_id, name, redirect_uris, allowed_scopes, surface, is_first_party) VALUES
    ('xeno-storage','XENO Storage',ARRAY['http://127.0.0.1/callback'],ARRAY['openid','profile'],'xeno-storage',true),
    ('xeno-pixel','XENO Pixel',ARRAY['http://127.0.0.1/callback'],ARRAY['openid','profile'],'xeno-pixel',true)`);
  const ws = crypto.randomUUID();
  for (const u of [human, agent]) {
    await pool.query(`INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id)
      VALUES ('workspace',$1,'member','user',$2)`, [ws, u]);
  }
  return { human, agent, ws };
}

async function signIn(userId, clientId, jkt) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const code = await createAuthorizationCode(pool, {
    clientId, userId, redirectUri: 'http://127.0.0.1/callback', scope: 'openid profile',
    codeChallenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
  });
  const t = await exchangeAuthorizationCode(pool, { code, clientId, redirectUri: 'http://127.0.0.1/callback', codeVerifier: verifier, dpopJkt: jkt });
  const payload = await verifyAccessToken(pool, t.access_token);
  Object.defineProperty(payload, 'raw', { value: t.access_token });
  return payload;
}

async function main() {
  const { human, agent, ws } = await setup();
  const jkt = jwkThumbprint(keyPair());
  const subject = await signIn(human, 'xeno-storage', jkt);
  const ask = (over = {}) => connectExchangeGrant(pool, {
    subjectPayload: subject, proofJkt: jkt, subjectTokenType: TT, requestedTokenType: TT,
    resource: RESOURCE, audience: 'xeno-connect', scope: 'connect:read connect:use connect:manage', env, ...over,
  });

  // 1. The exchange, and every refusal around it.
  const out = await ask();
  assert.equal(out.token_type, 'DPoP');
  assert.ok(out.expires_in <= 300);
  const claims = await verifyConnectAccessToken(pool, out.access_token);
  assert.equal(claims.aud, 'xeno-connect');
  assert.equal(claims.cnf.jkt, jkt);
  assert.equal(claims.client_id, 'xeno-storage');
  assert.equal(jwt.decode(out.access_token, { complete: true }).header.typ, 'at+jwt');
  await refusal(ask({ env: {} }), 'invalid_target');                                   // no configured origin
  await refusal(ask({ resource: 'https://evil.test' }), 'invalid_target');
  await refusal(ask({ audience: 'xeno-api' }), 'invalid_target');
  await refusal(ask({ proofJkt: jwkThumbprint(keyPair()) }), 'invalid_grant');          // a different key
  await refusal(ask({ subjectPayload: { ...subject, cnf: undefined } }), 'invalid_grant'); // unbound subject
  await refusal(ask({ scope: 'connect:read tasks:write' }), 'invalid_scope');
  await refusal(ask({ subjectPayload: await signIn(human, 'xeno-pixel', jkt) }), 'unauthorized_client');
  const agentSubject = await signIn(agent, 'xeno-storage', jkt);
  await refusal(ask({ subjectPayload: agentSubject }), 'invalid_scope');                // agents never get manage
  assert.ok((await ask({ subjectPayload: agentSubject, scope: 'connect:read' })).access_token);


  // 1b. The real HTTP grant dispatch: DPoP proof by the client's own key, same key bound on the way out.
  {
    process.env.XENO_CONNECT_ORIGINS = RESOURCE;
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pub = publicKey.export({ format: 'jwk' });
    const s = await signIn(human, 'xeno-storage', jwkThumbprint(pub));
    const proofBy = (key, jwk) => jwt.sign({ jti: crypto.randomUUID(), htm: 'POST', htu: `${issuer()}/api/oauth2/token`,
      iat: Math.floor(Date.now() / 1000), ath: accessTokenHash(s.raw) }, key, { algorithm: 'ES256', header: { typ: 'dpop+jwt', alg: 'ES256', jwk } });
    const app = express(); app.use(express.json()); app.use((req, _r, n) => { req.db = pool; n(); }); app.use('/api/oauth2', oauth2Router);
    const srv = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
    const call = (dpop) => fetch(`http://127.0.0.1:${srv.address().port}/api/oauth2/token`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `DPoP ${s.raw}`, dpop },
      body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: s.raw,
        subject_token_type: TT, requested_token_type: TT, resource: RESOURCE, audience: 'xeno-connect', scope: 'connect:read' }) });
    try {
      const ok = await call(proofBy(privateKey, pub)); const body = await ok.json();
      assert.equal(ok.status, 200, JSON.stringify(body));
      assert.equal((await verifyConnectAccessToken(pool, body.access_token)).cnf.jkt, jwkThumbprint(pub));
      const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      assert.equal((await call(proofBy(other.privateKey, other.publicKey.export({ format: 'jwk' })))).status, 400);
    } finally { srv.close(); }
  }

  // 2. The audiences never cross.
  await refusal(verifyAccessToken(pool, out.access_token), 'invalid_token');
  assert.equal(subject.aud, 'xeno-api'); // the subject was a real xeno-api token, and stays one

  // 3. Live authority.
  let a = await authorityForToken(pool, { token: out.access_token, workspaceId: ws });
  assert.deepEqual({ k: a.principalKind, c: a.consumerId, act: a.active, m: a.membershipActive },
    { k: 'human', c: 'xeno-storage', act: true, m: true });
  assert.deepEqual(new Set(a.scopes), new Set(['connect:read', 'connect:use', 'connect:manage']));
  assert.ok(a.operations.includes('drive.files.list') && a.operations.includes('drive.files.replace'));
  assert.equal(a.authorityExpiresAt, claims.exp * 1000);
  await assert.rejects(authorityForToken(pool, { token: out.access_token, workspaceId: null }), { code: 'workspace_required' });
  a = await authorityForToken(pool, { token: out.access_token, workspaceId: crypto.randomUUID() });
  assert.equal(a.membershipActive, false); assert.deepEqual(a.operations, []); assert.deepEqual(a.scopes, []);
  await pool.query("UPDATE users SET is_active = false WHERE id = $1", [human]);
  a = await authorityForToken(pool, { token: out.access_token, workspaceId: ws });
  assert.equal(a.active, false); assert.deepEqual(a.scopes, []);
  const cb = await authorityForCallback(pool, { principalId: agent, workspaceId: ws, consumerId: 'xeno-storage' });
  assert.equal(cb.active, false, 'owner suspended → agent unusable');                   // owner-chain cascade
  await pool.query("UPDATE users SET is_active = true WHERE id = $1", [human]);
  const cbAgent = await authorityForCallback(pool, { principalId: agent, workspaceId: ws, consumerId: 'xeno-storage' });
  assert.deepEqual(cbAgent.scopes, []);                                                 // only a person completes a link
  const cbHuman = await authorityForCallback(pool, { principalId: human, workspaceId: ws, consumerId: 'xeno-storage' });
  assert.deepEqual(cbHuman.scopes, ['connect:manage']);
  assert.ok(cbHuman.authorityExpiresAt <= Date.now() + 120_000);

  // 4. The service surface fails closed, and the Connect adapter round-trips through it.
  const secret = crypto.randomBytes(24).toString('base64url');
  const app = express();
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/connect/authority', createConnectAuthorityRouter({ getExpected: () => secret }));
  const closed = express();
  closed.use('/api/connect/authority', createConnectAuthorityRouter({ getExpected: () => '' }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const closedServer = await new Promise((r) => { const s = closed.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = (url, auth) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: '{}' });
    assert.equal((await post(`${base}/api/connect/authority/token`)).status, 401);
    assert.equal((await post(`${base}/api/connect/authority/token`, 'Bearer wrong')).status, 401);
    assert.equal((await post(`http://127.0.0.1:${closedServer.address().port}/api/connect/authority/token`, 'Bearer ')).status, 401);
    const adapter = createPlatformAuthority({
      platformOrigin: base, serviceToken: secret,
      lookupLink: async (state) => (state === 's1' ? { principalId: human, workspaceId: ws, consumerId: 'xeno-storage' } : null),
    });
    const request = { url: `/v1/connect/workspaces/${ws}/connections`, params: { workspaceId: ws }, headers: { authorization: `DPoP ${out.access_token}` } };
    const via = await adapter.resolveVerifiedToken(claims, request);
    assert.equal(via.principalId, human); assert.equal(via.membershipActive, true);
    await assert.rejects(adapter.resolveVerifiedToken({ ...claims, sub: agent }, request), /mismatch/);
    await assert.rejects(adapter.resolveVerifiedToken(claims, { ...request, url: '/v1/connect/x', params: {} }), /workspace required/);
    assert.deepEqual((await adapter.resolveBrowserCallback({}, 's1')).scopes, ['connect:manage']);
    await assert.rejects(adapter.resolveBrowserCallback({}, 'nope'), /unknown link/);
  } finally { server.close(); closedServer.close(); }
  console.log('connect-authority: ok');
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
