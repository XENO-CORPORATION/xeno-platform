/**
 * The staged OIDC issuer move (docs/decisions/2026-10-28-oidc-issuer-staged-move.md) against a real Postgres.
 *
 * With XENO_ISSUER_PER_HOST=on each host in the closed list is its own consistent provider: its discovery names
 * it, its token endpoint mints that issuer, an unknown host gets today's issuer, and the platform verifies tokens of
 * either. A refresh family started on one host continues on the other under the new provider (how a product moves).
 * Off: byte-for-byte today's single issuer.
 *
 * Run: DATABASE_URL=postgresql://… node tests/oidc-issuer-per-host.test.mjs
 */
import crypto from 'node:crypto';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import express from 'express';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import oauth2Router from '../routes/oauth2Routes.js';
import { issuer, issuerForHost, knownIssuers } from '../config/hosts.js';
import { createAuthorizationCode, startDeviceAuthorization, approveDevice, verifyAccessToken, getSigningKey } from '../utils/oidcProvider.js';
import { resolveAuthedUser } from '../middleware/auth.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const OLD = issuer();
const NEW = 'https://xenosystem.ai';
const OLD_HOST = new URL(OLD).host, NEW_HOST = new URL(NEW).host;
const CLIENT = 'iss-test-client';
const REDIRECT = 'http://127.0.0.1/callback';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const issOf = (t) => jwt.decode(t).iss;

let base;
/** A request to the provider as if it arrived on `host` (the Host header is how hosts.js tells them apart). */
function call(method, path, host, body) {
  return new Promise((resolve, reject) => {
    const data = body ? new URLSearchParams(body).toString() : null;
    const r = http.request(`${base}${path}`, { method, headers: { host, ...(data ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(s) }); } catch { resolve({ status: res.statusCode, body: s }); } });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

let userId;
async function codeTokens(host) {
  const v = crypto.randomBytes(32).toString('base64url');
  const c = crypto.createHash('sha256').update(v).digest('base64url');
  const code = await createAuthorizationCode(pool, { clientId: CLIENT, userId, redirectUri: REDIRECT, scope: 'openid email', codeChallenge: c });
  return call('POST', '/api/oauth2/token', host, { grant_type: 'authorization_code', code, client_id: CLIENT, redirect_uri: REDIRECT, code_verifier: v });
}
async function deviceTokens(host) {
  const d = await startDeviceAuthorization(pool, { clientId: CLIENT, scope: 'openid' });
  await approveDevice(pool, { userCode: d.user_code, userId });
  return call('POST', '/api/oauth2/token', host, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: d.device_code, client_id: CLIENT });
}
const refresh = (host, refresh_token) => call('POST', '/api/oauth2/token', host, { grant_type: 'refresh_token', refresh_token, client_id: CLIENT });

async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, reference_type varchar(64), reference_id varchar(128))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS external_identity_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system varchar(64) NOT NULL, external_user_id text, external_email text, platform_user_id uuid NOT NULL, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`);
  await migrateAccountV2(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, username text, display_name text, avatar_url text, email_verified boolean DEFAULT true, is_active boolean DEFAULT true, role text DEFAULT 'user', created_at timestamptz DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS security_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, event_type varchar(50) NOT NULL, ip_address inet, user_agent text, metadata jsonb, created_at timestamp DEFAULT now())`);
  userId = (await pool.query("INSERT INTO users (email, username, display_name) VALUES ('i@x.co','ivy','Ivy') RETURNING id")).rows[0].id;
  await pool.query(`INSERT INTO oauth_clients (client_id, name, redirect_uris, surface, is_first_party) VALUES ($1,'Issuer test', ARRAY[$2], $1, true) ON CONFLICT DO NOTHING`, [CLIENT, REDIRECT]);
  await getSigningKey(pool);
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use('/api/oauth2', (req, _res, next) => { req.db = pool; next(); }, oauth2Router);
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${srv.address().port}`;
  const disc = async (host) => (await call('GET', '/api/oauth2/.well-known/openid-configuration', host)).body;

  console.log('off (the default): one issuer, exactly today');
  delete process.env.XENO_ISSUER_PER_HOST;
  process.env.XENO_ALIAS_SITE_ORIGINS = NEW;
  ok((await disc(NEW_HOST)).issuer === OLD && (await disc(OLD_HOST)).issuer === OLD, 'discovery names the old issuer on both hosts');
  const offTok = await codeTokens(NEW_HOST);
  ok(offTok.status === 200 && issOf(offTok.body.access_token) === OLD && issOf(offTok.body.id_token) === OLD, 'a token minted on the new host still carries the old issuer');

  console.log('on: each host is its own provider');
  process.env.XENO_ISSUER_PER_HOST = 'on';
  const dn = await disc(NEW_HOST), dold = await disc(OLD_HOST), dbad = await disc('evil.example');
  ok(dn.issuer === NEW && dn.token_endpoint === `${NEW}/api/oauth2/token` && dn.jwks_uri === `${NEW}/api/oauth2/jwks`, 'discovery on the new host names the new host, endpoints included (RFC 8414 §3.3)');
  ok(dold.issuer === OLD && dold.token_endpoint === `${OLD}/api/oauth2/token`, 'discovery on the old host still names the old host');
  ok(dbad.issuer === OLD, 'a host outside the closed list gets the old issuer, never its own name');
  ok(issuerForHost('XENOSYSTEM.AI:443') === NEW && issuerForHost('xenosystem.ai.evil.com') === OLD && issuerForHost('xeno system.ai') === OLD, 'host matching is exact (case, :443) and refuses anything else');

  const nt = await codeTokens(NEW_HOST), ot = await codeTokens(OLD_HOST);
  ok(issOf(nt.body.access_token) === NEW && issOf(nt.body.id_token) === NEW, 'the code grant on the new host mints the new issuer (access + id token)');
  ok(issOf(ot.body.access_token) === OLD && issOf(ot.body.id_token) === OLD, 'the code grant on the old host mints the old issuer');
  const dv = await deviceTokens(NEW_HOST);
  ok(dv.status === 200 && issOf(dv.body.access_token) === NEW, 'the device grant follows the token endpoint’s host too');
  ok((await pool.query('SELECT issuer FROM oauth_refresh_tokens WHERE token_hash = $1', [sha(nt.body.refresh_token)])).rows[0].issuer === NEW, 'the refresh token records the provider that issued it');

  console.log('moving a product: an old-host family refreshed on the new host');
  const moved = await refresh(NEW_HOST, ot.body.refresh_token);
  ok(moved.status === 200 && issOf(moved.body.access_token) === NEW, 'the same sign-in continues; the new tokens carry the new issuer');
  ok((await pool.query('SELECT issuer FROM oauth_refresh_tokens WHERE token_hash = $1', [sha(moved.body.refresh_token)])).rows[0].issuer === NEW, 'and its next refresh token is recorded under the new provider');
  const stay = await refresh(OLD_HOST, nt.body.refresh_token);
  ok(stay.status === 200 && issOf(stay.body.access_token) === OLD, 'and back: a refresh on the old host mints the old issuer');

  console.log('the platform accepts its own tokens under either name');
  for (const [label, t] of [['old', ot.body.access_token], ['new', nt.body.access_token]]) {
    ok((await verifyAccessToken(pool, t)).sub === String(userId), `verifyAccessToken accepts the ${label} issuer`);
    const a = await resolveAuthedUser({ headers: { authorization: `Bearer ${t}` }, db: pool });
    ok(a.user && String(a.user.id) === String(userId), `the API middleware accepts the ${label} issuer`);
  }
  const key = await getSigningKey(pool);
  const forged = jwt.sign({ iss: 'https://evil.example', sub: userId, aud: 'xeno-api', typ: 'at+jwt', client_id: CLIENT, scope: 'openid' }, key.privatePem, { algorithm: key.alg, keyid: key.kid, expiresIn: 60, header: { typ: 'at+jwt', kid: key.kid } });
  let refused = false; try { await verifyAccessToken(pool, forged); } catch { refused = true; }
  ok(refused, 'an issuer outside the known list is refused by verifyAccessToken');
  ok(knownIssuers().join(',') === `${OLD},${NEW}`, 'known issuers are the old one first, then the alias');

  console.log('rollback: switch off again');
  delete process.env.XENO_ISSUER_PER_HOST;
  ok((await disc(NEW_HOST)).issuer === OLD, 'discovery on the new host is the old issuer again');
  ok((await verifyAccessToken(pool, nt.body.access_token)).sub === String(userId), 'a token already minted under the new name still verifies');

  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
