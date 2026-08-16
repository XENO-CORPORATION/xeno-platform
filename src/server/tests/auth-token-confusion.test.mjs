/**
 * Token-confusion regression gate for resolveAuthedUser / authMiddleware.
 *
 * The OIDC provider mints THREE asymmetric JWTs off ONE signing key — an access
 * token (aud='xeno-api', typ='at+jwt'), an ID token (aud=<client_id>) and a
 * back-channel logout token (typ='logout+jwt', `events`). Before this gate the
 * middleware verified the SIGNATURE only (verify-by-kid, no `aud`, no `typ`), so
 * an ID token — held by every relying party and by the browser — and a logout
 * token — POSTed by US to an RP's `backchannel_logout_uri`, possibly third-party —
 * were replayable as ACCESS tokens and got full API authority as that user.
 *
 * Every token here is minted through the REAL provider path (createAuthorizationCode
 * → exchangeAuthorizationCode → mintTokens, refreshTokenGrant, emitBackchannelLogout)
 * against a real Postgres, and driven through the REAL authMiddleware. Asserts:
 *   1. what the provider actually mints (aud/typ on access vs id vs logout)
 *   2. a genuine access token (code-exchange AND refresh-grant) → 200
 *   3. an ID token                                              → 401
 *   4. a back-channel logout token                              → 401
 *   5. a wrong-`aud` token signed by the real key               → 401
 *   6. a right-`aud` but UNTYPED token (an id_token for a client registered as
 *      `xeno-api`)                                              → 401
 *   7. no regression: legacy HS256 (incl. sid session revocation) + platform API
 *      keys still authenticate
 *   8. optionalAuthMiddleware does not attach a user for a confused token
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:PORT/t node tests/auth-token-confusion.test.mjs
 */
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import {
  getSigningKey, createAuthorizationCode, exchangeAuthorizationCode,
  refreshTokenGrant, emitBackchannelLogout, introspectToken, isAccessToken,
} from '../utils/oidcProvider.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const sha256 = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const pkce = () => {
  const v = crypto.randomBytes(32).toString('base64url');
  return { v, c: crypto.createHash('sha256').update(v).digest('base64url') };
};

const REDIRECT = 'https://post.xenostudio.ai/auth/callback';

async function main() {
  // ── schema: the additive account-v2 migration + the legacy tables it assumes ──
  await pool.query(`CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, reference_type varchar(64), reference_id varchar(128))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS external_identity_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system varchar(64) NOT NULL, external_user_id text, external_email text, platform_user_id uuid NOT NULL, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE (source_system, platform_user_id))`);
  await migrateAccountV2(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text UNIQUE, email text UNIQUE,
    display_name text, avatar_url text, email_verified boolean DEFAULT true,
    is_active boolean DEFAULT true, role text DEFAULT 'user', created_at timestamptz DEFAULT now())`);
  // user_sessions comes from the MIGRATIONS, not from a hand-written copy.
  // This fixture used to declare its own and lost `last_active_at` when session
  // liveness shipped, which broke CI for two days.
  await pool.query(tableDDL('user_sessions'));

  await pool.query(`CREATE TABLE IF NOT EXISTS api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    key_prefix varchar(16) NOT NULL, key_hash varchar(255) NOT NULL UNIQUE,
    name varchar(100) DEFAULT 'Default Key' NOT NULL, is_active boolean DEFAULT true,
    last_used_at timestamp, usage_count bigint DEFAULT 0,
    created_at timestamp DEFAULT now(), expires_at timestamp)`);

  const userId = (await pool.query(
    "INSERT INTO users (email, username, display_name) VALUES ('a@b.co','alice','Alice') RETURNING id",
  )).rows[0].id;

  // ── an RP that receives the back-channel logout token (the attacker's view) ──
  let capturedLogoutToken = null;
  const rp = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { capturedLogoutToken = JSON.parse(body).logout_token; } catch { /* ignore */ }
      res.writeHead(200).end('{}');
    });
  });
  rp.listen(0);
  await new Promise((r) => rp.once('listening', r));
  const rpUrl = `http://127.0.0.1:${rp.address().port}/backchannel-logout`;

  await pool.query(
    `INSERT INTO oauth_clients (client_id, name, redirect_uris, surface, backchannel_logout_uri)
     VALUES ('xeno-post','XENO Post', ARRAY[$1], 'xeno_post', $2)
     ON CONFLICT (client_id) DO UPDATE SET backchannel_logout_uri = EXCLUDED.backchannel_logout_uri`,
    [REDIRECT, rpUrl],
  );

  // ── mint the real token set through the real code-exchange path ─────────────
  const { v, c } = pkce();
  const code = await createAuthorizationCode(pool, {
    clientId: 'xeno-post', userId, redirectUri: REDIRECT, scope: 'openid profile email ledger', codeChallenge: c,
  });
  const tokens = await exchangeAuthorizationCode(pool, {
    code, clientId: 'xeno-post', redirectUri: REDIRECT, codeVerifier: v,
  });

  const key = await getSigningKey(pool);
  const pub = crypto.createPublicKey(key.privatePem);
  const decode = (t) => jwt.decode(t, { complete: true });

  // 1. Document what the provider ACTUALLY mints — the fix is derived from this.
  const at = decode(tokens.access_token);
  ok(at.payload.aud === 'xeno-api' && at.payload.typ === 'at+jwt' && at.header.typ === 'at+jwt',
    `access token: aud=xeno-api, payload typ=at+jwt, header typ=at+jwt`);
  const idt = decode(tokens.id_token);
  ok(idt.payload.aud === 'xeno-post' && idt.payload.typ === undefined && idt.header.typ !== 'at+jwt',
    `id_token: aud=<client_id>, NO payload typ, header typ=${JSON.stringify(idt.header.typ)}`);
  ok(idt.payload.sub === userId, 'id_token carries sub = the same user (why it was replayable)');
  // both are signed by the SAME key/kid — signature-only verification cannot tell them apart
  ok(at.header.kid === idt.header.kid && jwt.verify(tokens.id_token, pub, { algorithms: [key.alg] }).sub === userId,
    'access + id token share one kid and both verify against the JWKS key');

  const sid = (await pool.query('SELECT sid FROM oauth_refresh_tokens WHERE user_id = $1 LIMIT 1', [userId])).rows[0].sid;
  await emitBackchannelLogout(pool, sid);
  await new Promise((r) => setTimeout(r, 150));
  ok(typeof capturedLogoutToken === 'string' && capturedLogoutToken.length > 0,
    'captured a real back-channel logout token from the RP webhook');
  const lot = decode(capturedLogoutToken);
  ok(lot.header.typ === 'logout+jwt' && lot.payload.events !== undefined && lot.payload.sub === userId,
    'logout token: header typ=logout+jwt, has events, sub = the same user');

  // ── forged-but-real-key tokens ──────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const signAs = (payload, header = {}) => jwt.sign(
    { iss: 'https://xenostudio.ai', iat: now, sub: userId, ...payload },
    key.privatePem,
    { algorithm: key.alg, keyid: key.kid, expiresIn: 600, header: { kid: key.kid, ...header } },
  );
  // right type, WRONG audience (e.g. a token minted for another resource server)
  const wrongAud = signAs({ aud: 'xeno-other-api', typ: 'at+jwt' }, { typ: 'at+jwt' });
  // right audience, NO type — exactly an id_token for a client registered as `xeno-api`
  const untypedRightAud = signAs({ aud: 'xeno-api', email: 'a@b.co' });
  // no audience at all
  const noAud = signAs({ typ: 'at+jwt' }, { typ: 'at+jwt' });

  // ── the same fail-closed rule on the PUBLIC introspection surface ───────────
  // /api/oauth2/introspect is unauthenticated (RFC 7662 phantom-token validation);
  // it must not tell an edge validator that an ID/logout token is an access token.
  ok((await introspectToken(pool, { token: tokens.access_token })).active === true,
    'introspect: real access token → active access_token');
  ok((await introspectToken(pool, { token: tokens.id_token })).active === false,
    'introspect: ID token → inactive (was reported as an active access_token)');
  ok((await introspectToken(pool, { token: capturedLogoutToken })).active === false,
    'introspect: logout token → inactive');
  ok((await introspectToken(pool, { token: wrongAud })).active === false,
    'introspect: wrong-`aud` token → inactive');
  // the predicate itself, mint-side and verify-side share it
  ok(isAccessToken(at.header, at.payload) === true
    && isAccessToken(idt.header, idt.payload) === false
    && isAccessToken(lot.header, lot.payload) === false,
    'isAccessToken(): true for access, false for id + logout (one shared definition)');

  // ── legacy + API-key credentials that MUST keep working ─────────────────────
  const legacy = jwt.sign({ userId, email: 'a@b.co', username: 'alice' }, JWT_SECRET, { expiresIn: '1h' });
  const liveSid = crypto.randomUUID();
  await pool.query("INSERT INTO user_sessions (id, user_id, expires_at) VALUES ($1,$2, now() + interval '1 day')", [liveSid, userId]);
  const legacySession = jwt.sign({ userId, email: 'a@b.co', sid: liveSid }, JWT_SECRET, { expiresIn: '1h' });
  const legacyRevoked = jwt.sign({ userId, email: 'a@b.co', sid: crypto.randomUUID() }, JWT_SECRET, { expiresIn: '1h' });
  const rawKey = 'xeno-' + crypto.randomBytes(24).toString('hex');
  await pool.query('INSERT INTO api_keys (user_id, key_prefix, key_hash, name) VALUES ($1,$2,$3,$4)',
    [userId, rawKey.slice(0, 16), sha256(rawKey), 'cli']);

  // ── the REAL middleware over a v2-style route ───────────────────────────────
  const app = express();
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.get('/api/v2/me', authMiddleware, (req, res) => res.json({ success: true, user: req.user }));
  app.get('/api/optional', optionalAuthMiddleware, (req, res) => res.json({ user: req.user || null }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (token, path = '/api/v2/me') => {
    const res = await fetch(base + path, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  // 2. genuine access tokens pass
  const rAccess = await get(tokens.access_token);
  ok(rAccess.status === 200 && rAccess.json.user?.id === userId, 'OIDC ACCESS token → 200 with the right user');
  const refreshed = await refreshTokenGrant(pool, { refreshToken: tokens.refresh_token, clientId: 'xeno-post' });
  const rRefreshed = await get(refreshed.access_token);
  ok(rRefreshed.status === 200 && rRefreshed.json.user?.id === userId, 'refresh-grant ACCESS token → 200 (mint path 2 unaffected)');

  // 3-6. every confused token is refused
  const rId = await get(tokens.id_token);
  ok(rId.status === 401, 'ID token replayed as a Bearer access token → 401 (was 200: the vulnerability)');
  ok(rId.json.user === undefined, 'rejected ID token attaches no user');
  const rLogout = await get(capturedLogoutToken);
  ok(rLogout.status === 401, 'back-channel LOGOUT token replayed as an access token → 401 (was 200)');
  ok((await get(wrongAud)).status === 401, 'wrong-`aud` token signed by the real key → 401');
  ok((await get(untypedRightAud)).status === 401, 'right-`aud` but untyped token (id_token for a `xeno-api` client) → 401');
  ok((await get(noAud)).status === 401, 'token with no `aud` at all → 401');

  // 7. no regression on the credentials that legitimately authenticate
  ok((await get(legacy)).status === 200, 'legacy HS256 platform token → 200 (no regression)');
  ok((await get(legacySession)).status === 200, 'session-backed HS256 token with a live sid → 200');
  const rRevoked = await get(legacyRevoked);
  ok(rRevoked.status === 401 && /revoked|expired/i.test(rRevoked.json.error || ''), 'HS256 token with a dead sid → 401 (revocation preserved)');
  const rKey = await get(rawKey);
  ok(rKey.status === 200 && rKey.json.user?.id === userId, 'platform API key → 200 (no regression)');
  ok((await get('xeno-' + crypto.randomBytes(24).toString('hex'))).status === 401, 'unknown API key → 401');
  ok((await get('aaa.bbb.ccc')).status === 401, 'garbage JWT-shaped token → 401');
  ok((await get(null)).status === 401, 'missing token → 401');

  // 8. optional auth must not attach a user for a confused token
  ok((await get(tokens.id_token, '/api/optional')).json.user === null, 'optionalAuth: ID token attaches NO user');
  ok((await get(tokens.access_token, '/api/optional')).json.user?.id === userId, 'optionalAuth: access token still attaches the user');

  console.log(`\n${fail === 0 ? '✅' : '❌'} auth-token-confusion: ${pass} passed, ${fail} failed`);
  server.close();
  rp.close();
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
