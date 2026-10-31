/**
 * Idempotent refresh recovery (XENO AUTH) against a real Postgres.
 *
 * A client killed after sending a refresh but before persisting the successor presents the OLD token
 * again with the same `rotation_id`. Recovery must apply ONLY when the rotation_id matches, the
 * session is DPoP-bound to the same key, and the successor was never used; every other replay of a
 * rotated token must still revoke the family (RFC 9700 reuse detection), exactly as before.
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55460/t node tests/oidc-refresh-recovery.test.mjs
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import express from 'express';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import oauth2Router from '../routes/oauth2Routes.js';
import { issuer } from '../config/hosts.js';
import { jwkThumbprint } from '../utils/dpop.js';
import { getSigningKey, createAuthorizationCode, exchangeAuthorizationCode, refreshTokenGrant } from '../utils/oidcProvider.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const REDIRECT = 'https://post.xenostudio.ai/api/v1/platform/xeno/callback';
const CLIENT = 'xeno-post';
const JKT = 'jkt-' + crypto.randomBytes(16).toString('base64url');
const rid = () => crypto.randomBytes(24).toString('base64url');   // 32 chars of [A-Za-z0-9_-]
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function errorOf(p) { try { await p; return null; } catch (e) { return e; } }
async function rowOf(token) {
  return (await pool.query('SELECT * FROM oauth_refresh_tokens WHERE token_hash = $1', [sha(token)])).rows[0];
}
async function familyRevoked(familyId) {
  const r = await pool.query('SELECT bool_and(revoked) AS all_revoked FROM oauth_refresh_tokens WHERE family_id = $1', [familyId]);
  return r.rows[0].all_revoked === true;
}

let userId;
async function signIn({ dpopJkt = JKT } = {}) {
  const v = crypto.randomBytes(32).toString('base64url');
  const c = crypto.createHash('sha256').update(v).digest('base64url');
  const code = await createAuthorizationCode(pool, { clientId: CLIENT, userId, redirectUri: REDIRECT, scope: 'openid email', codeChallenge: c });
  return exchangeAuthorizationCode(pool, { code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: v, dpopJkt });
}

/** Sign in, then perform ONE rotation whose response the "client" never persists. */
async function unconsumedRotation({ dpopJkt = JKT } = {}) {
  const tokens = await signIn({ dpopJkt });
  const rotationId = rid();
  const lost = await refreshTokenGrant(pool, { refreshToken: tokens.refresh_token, clientId: CLIENT, dpopJkt, rotationId });
  const old = await rowOf(tokens.refresh_token);
  return { old: tokens.refresh_token, oldRow: old, rotationId, lost };
}

async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, reference_type varchar(64), reference_id varchar(128))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS external_identity_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system varchar(64) NOT NULL, external_user_id text, external_email text, platform_user_id uuid NOT NULL, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`);
  await migrateAccountV2(pool);
  await migrateAccountV2(pool);   // idempotent: the ADD COLUMN IF NOT EXISTS lines must re-run cleanly
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, username text, display_name text, avatar_url text, email_verified boolean DEFAULT true, is_active boolean DEFAULT true)`);
  // Same shape as database/migrate-auth-v2.js, so the security events are actually written and asserted.
  await pool.query(`CREATE TABLE IF NOT EXISTS security_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE SET NULL, event_type varchar(50) NOT NULL, ip_address inet, user_agent text, metadata jsonb, created_at timestamp DEFAULT now())`);
  userId = (await pool.query("INSERT INTO users (email, username, display_name) VALUES ('r@b.co','rita','Rita') RETURNING id")).rows[0].id;
  await pool.query(`INSERT INTO oauth_clients (client_id, name, redirect_uris, surface) VALUES ($1,'XENO Post', ARRAY[$2], 'xeno_post') ON CONFLICT DO NOTHING`, [CLIENT, REDIRECT]);
  const pub = crypto.createPublicKey((await getSigningKey(pool)).privatePem);

  console.log('normal rotation records the recovery facts');
  {
    const { oldRow, rotationId, lost } = await unconsumedRotation();
    const succ = await rowOf(lost.refresh_token);
    ok(oldRow.rotated && oldRow.successor_id === succ.id, 'rotated row points at its successor');
    ok(oldRow.rotation_id_hash === sha(rotationId), 'rotated row stores sha256(rotation_id), not the raw value');
    ok(!Object.values(oldRow).includes(rotationId), 'the raw rotation_id is stored nowhere on the row');
    const plain = await signIn();
    const r = await refreshTokenGrant(pool, { refreshToken: plain.refresh_token, clientId: CLIENT, dpopJkt: JKT });
    const plainRow = await rowOf(plain.refresh_token);
    ok(r.refresh_token && plainRow.rotation_id_hash === null && plainRow.successor_id === (await rowOf(r.refresh_token)).id,
      'without rotation_id: hash stays NULL, successor still recorded');
  }

  console.log('1. retry with the same rotation_id after an unconsumed rotation → recovered');
  {
    const { old, oldRow, rotationId, lost } = await unconsumedRotation();
    const r = await refreshTokenGrant(pool, { refreshToken: old, clientId: CLIENT, dpopJkt: JKT, rotationId });
    ok(r && r.refresh_token && r.access_token && r.token_type === 'DPoP', 'returns a full DPoP token set');
    ok(r.refresh_token !== lost.refresh_token, 'issues a FRESH successor, not the lost one');
    const at = jwt.verify(r.access_token, pub, { algorithms: ['ES256'] });
    ok(at.cnf?.jkt === JKT && at.sub === userId && at.sid === oldRow.sid, 'access token is bound to the same key, user and session');
    ok((await rowOf(lost.refresh_token)).revoked === true, 'the first (lost) successor is now revoked');
    const fresh = await rowOf(r.refresh_token);
    ok(!fresh.revoked && !fresh.rotated && fresh.family_id === oldRow.family_id, 'fresh successor is live, same family');
    ok((await rowOf(old)).successor_id === fresh.id, 'old row now points at the fresh successor');
    ok(!(await familyRevoked(oldRow.family_id)), 'family NOT revoked');
    const sess = (await pool.query('SELECT revoked_at FROM oauth_session_state WHERE sid = $1', [oldRow.sid])).rows[0];
    ok(sess.revoked_at === null, 'session NOT revoked');
    const again = await refreshTokenGrant(pool, { refreshToken: old, clientId: CLIENT, dpopJkt: JKT, rotationId });
    ok(again.refresh_token && (await rowOf(r.refresh_token)).revoked, 'a second crash-retry also recovers (and retires the previous fresh one)');
    const next = await refreshTokenGrant(pool, { refreshToken: again.refresh_token, clientId: CLIENT, dpopJkt: JKT, rotationId: rid() });
    ok(next.refresh_token, 'the recovered refresh token works for a further normal refresh');
    const lostReplay = await errorOf(refreshTokenGrant(pool, { refreshToken: lost.refresh_token, clientId: CLIENT, dpopJkt: JKT }));
    ok(lostReplay?.oauthError === 'invalid_grant' && /revoked/.test(lostReplay.message), 'the retired successor is refused as revoked');
    // The event is written fire-and-forget; give it a bounded moment to land.
    let recovered = 0;
    for (let i = 0; i < 50 && recovered < 2; i++) {
      recovered = Number((await pool.query("SELECT count(*) FROM security_events WHERE event_type = 'token_refresh_recovered' AND metadata->>'familyId' = $1", [oldRow.family_id])).rows[0].count);
      if (recovered < 2) await new Promise((r) => setTimeout(r, 20));
    }
    ok(recovered === 2, 'TOKEN_REFRESH_RECOVERED recorded once per recovery');
    const reuseEvts = Number((await pool.query("SELECT count(*) FROM security_events WHERE event_type = 'token_reuse_detected' AND metadata->>'familyId' = $1", [oldRow.family_id])).rows[0].count);
    ok(reuseEvts === 0, 'no reuse event for a recovered family');
  }

  console.log('2. wrong rotation_id → reuse, family revoked');
  {
    const { old, oldRow } = await unconsumedRotation();
    const e = await errorOf(refreshTokenGrant(pool, { refreshToken: old, clientId: CLIENT, dpopJkt: JKT, rotationId: rid() }));
    ok(e?.oauthError === 'invalid_grant' && /reuse/.test(e.message), 'invalid_grant: reuse detected');
    ok(await familyRevoked(oldRow.family_id), 'family revoked');
  }

  console.log('3. successor already used → reuse, family revoked');
  {
    const { old, oldRow, rotationId, lost } = await unconsumedRotation();
    await refreshTokenGrant(pool, { refreshToken: lost.refresh_token, clientId: CLIENT, dpopJkt: JKT, rotationId: rid() });
    const e = await errorOf(refreshTokenGrant(pool, { refreshToken: old, clientId: CLIENT, dpopJkt: JKT, rotationId }));
    ok(e?.oauthError === 'invalid_grant' && /reuse/.test(e.message), 'invalid_grant: reuse detected');
    ok(await familyRevoked(oldRow.family_id), 'family revoked');
  }

  console.log('4. no rotation_id on the retry → reuse (today\'s behaviour)');
  {
    const { old, oldRow } = await unconsumedRotation();
    const e = await errorOf(refreshTokenGrant(pool, { refreshToken: old, clientId: CLIENT, dpopJkt: JKT }));
    ok(e?.oauthError === 'invalid_grant' && /reuse/.test(e.message), 'invalid_grant: reuse detected');
    ok(await familyRevoked(oldRow.family_id), 'family revoked');
  }

  console.log('5. DPoP jkt mismatch → no recovery');
  {
    const { old, oldRow, rotationId } = await unconsumedRotation();
    const e = await errorOf(refreshTokenGrant(pool, { refreshToken: old, clientId: CLIENT, dpopJkt: 'jkt-attacker', rotationId }));
    ok(e?.oauthError === 'invalid_grant' && /reuse/.test(e.message), 'other key: reuse detected');
    ok(await familyRevoked(oldRow.family_id), 'family revoked');
    const { old: o2, oldRow: r2, rotationId: id2 } = await unconsumedRotation();
    const e2 = await errorOf(refreshTokenGrant(pool, { refreshToken: o2, clientId: CLIENT, dpopJkt: null, rotationId: id2 }));
    ok(e2?.oauthError === 'invalid_grant' && await familyRevoked(r2.family_id), 'no DPoP proof at all: reuse, family revoked');
    const { old: o3, oldRow: r3, rotationId: id3 } = await unconsumedRotation({ dpopJkt: null });
    const e3 = await errorOf(refreshTokenGrant(pool, { refreshToken: o3, clientId: CLIENT, dpopJkt: null, rotationId: id3 }));
    ok(e3?.oauthError === 'invalid_grant' && await familyRevoked(r3.family_id), 'non-DPoP (Bearer) session: never recovers');
  }

  console.log('6. malformed rotation_id → invalid_request');
  {
    const tokens = await signIn();
    for (const bad of ['short', 'x'.repeat(129), 'has space in it!!!!', 'dots.are.not.allowed.here', '', 12345678901234567]) {
      const e = await errorOf(refreshTokenGrant(pool, { refreshToken: tokens.refresh_token, clientId: CLIENT, dpopJkt: JKT, rotationId: bad }));
      ok(e?.oauthError === 'invalid_request' && e.statusCode === 400, `refused ${JSON.stringify(bad).slice(0, 24)}`);
    }
    const row = await rowOf(tokens.refresh_token);
    ok(!row.rotated && !row.revoked, 'a malformed request consumed nothing');
    ok((await refreshTokenGrant(pool, { refreshToken: tokens.refresh_token, clientId: CLIENT, dpopJkt: JKT, rotationId: 'A'.repeat(16) })).refresh_token,
      'boundary: exactly 16 chars is accepted');
  }

  console.log('7. over HTTP: the real /token route, real DPoP proofs');
  {
    const key = (() => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); return { privateKey, publicJwk: publicKey.export({ format: 'jwk' }) }; })();
    const jkt = jwkThumbprint(key.publicJwk);
    const proof = () => jwt.sign(
      { jti: crypto.randomUUID(), htm: 'POST', htu: `${issuer()}/api/oauth2/token`, iat: Math.floor(Date.now() / 1000) },
      key.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', alg: 'ES256', jwk: key.publicJwk } },
    );
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.db = pool; next(); });
    app.use('/api/oauth2', oauth2Router);
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const post = async (body) => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/oauth2/token`, {
        method: 'POST', headers: { 'content-type': 'application/json', dpop: proof() },
        body: JSON.stringify({ grant_type: 'refresh_token', client_id: CLIENT, ...body }),
      });
      return { status: res.status, body: await res.json() };
    };
    try {
      const tokens = await signIn({ dpopJkt: jkt });
      const bad = await post({ refresh_token: tokens.refresh_token, rotation_id: 'not valid!' });
      ok(bad.status === 400 && bad.body.error === 'invalid_request', 'malformed rotation_id → 400 invalid_request');
      const rotationId = rid();
      const first = await post({ refresh_token: tokens.refresh_token, rotation_id: rotationId });
      ok(first.status === 200 && first.body.token_type === 'DPoP', 'first refresh with rotation_id → 200 (response "lost")');
      const retry = await post({ refresh_token: tokens.refresh_token, rotation_id: rotationId });
      ok(retry.status === 200 && retry.body.refresh_token && retry.body.refresh_token !== first.body.refresh_token,
        'crash-retry with the same rotation_id → 200, fresh refresh token');
      const reuse = await post({ refresh_token: tokens.refresh_token, rotation_id: rid() });
      ok(reuse.status === 400 && reuse.body.error === 'invalid_grant', 'a different rotation_id → invalid_grant (reuse)');
      ok(await familyRevoked((await rowOf(tokens.refresh_token)).family_id), '…and the family is revoked');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
