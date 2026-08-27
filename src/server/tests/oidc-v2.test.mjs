/**
 * Integration test for the OIDC provider v2 against a real Postgres.
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55460/t node tests/oidc-v2.test.mjs
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import {
  getSigningKey, jwks, createAuthorizationCode, exchangeAuthorizationCode,
  refreshTokenGrant, startDeviceAuthorization, approveDevice, deviceTokenGrant,
  revokeToken, endSession, logoutEverywhere, introspectToken,
} from '../utils/oidcProvider.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const pkce = () => { const v = crypto.randomBytes(32).toString('base64url'); return { v, c: crypto.createHash('sha256').update(v).digest('base64url') }; };

async function main() {
  // The migration adds an idempotency index on credit_transactions (exists on
  // live); stub it here so the OIDC-only test can run the additive migration.
  await pool.query(`CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, reference_type varchar(64), reference_id varchar(128))`);
  // mintTokens records the surface link (Arch §2.1) → needs external_identity_links.
  await pool.query(`CREATE TABLE IF NOT EXISTS external_identity_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system varchar(64) NOT NULL, external_user_id text, external_email text, platform_user_id uuid NOT NULL, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`);
  await migrateAccountV2(pool);
  // Minimal users table for the test.
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, username text, display_name text, avatar_url text, email_verified boolean DEFAULT true, is_active boolean DEFAULT true)`);
  const u = await pool.query("INSERT INTO users (email, username, display_name) VALUES ('a@b.co','alice','Alice') RETURNING id");
  const userId = u.rows[0].id;
  const other = await pool.query("INSERT INTO users (email, username, display_name) VALUES ('other@b.co','other','Other') RETURNING id");
  const otherUserId = other.rows[0].id;
  await pool.query(`INSERT INTO oauth_clients (client_id, name, redirect_uris, surface) VALUES ('xeno-post','XENO Post', ARRAY['https://post.xenostudio.ai/auth/callback'], 'xeno_post') ON CONFLICT DO NOTHING`);

  // 1. signing key (ES256 default) + JWKS
  const key = await getSigningKey(pool);
  ok(key.kid && key.alg === 'ES256' && key.privatePem.includes('PRIVATE KEY'), 'ES256 signing key generated + persisted');
  const j = await jwks(pool);
  ok(j.keys.length === 1 && j.keys[0].kid === key.kid && j.keys[0].kty === 'EC', 'JWKS serves the EC public key');

  // 2. auth-code + PKCE → tokens (signed ES256, verified by kid)
  const { v, c } = pkce();
  const code = await createAuthorizationCode(pool, { clientId: 'xeno-post', userId, redirectUri: 'https://post.xenostudio.ai/auth/callback', scope: 'openid email ledger', codeChallenge: c });
  const tokens = await exchangeAuthorizationCode(pool, { code, clientId: 'xeno-post', redirectUri: 'https://post.xenostudio.ai/auth/callback', codeVerifier: v });
  ok(tokens.access_token && tokens.id_token && tokens.refresh_token, 'code exchange returns access+id+refresh');
  const pub = crypto.createPublicKey(key.privatePem);
  const at = jwt.verify(tokens.access_token, pub, { algorithms: ['ES256'] });
  ok(at.sub === userId && at.typ === 'at+jwt' && at.aud === 'xeno-api', 'access token is ES256, sub=user, typ=at+jwt');
  ok(at.client_id === 'xeno-post' && at.azp === 'xeno-post', 'access token binds client_id and azp');
  const idt = jwt.verify(tokens.id_token, pub, { algorithms: ['ES256'] });
  ok(idt.aud === 'xeno-post' && idt.email === 'a@b.co', 'id_token aud=client, carries email');

  // 3. replay the code → rejected
  let reused = null;
  try { await exchangeAuthorizationCode(pool, { code, clientId: 'xeno-post', redirectUri: 'https://post.xenostudio.ai/auth/callback', codeVerifier: v }); } catch (e) { reused = e.oauthError; }
  ok(reused === 'invalid_grant', 'consumed code cannot be reused');

  // 3b. Concurrent code exchange is atomic: exactly one request can consume it.
  const codeRacePkce = pkce();
  const codeRace = await createAuthorizationCode(pool, {
    clientId: 'xeno-post', userId, redirectUri: 'https://post.xenostudio.ai/auth/callback',
    scope: 'openid ledger', codeChallenge: codeRacePkce.c,
  });
  const codeRaceResults = await Promise.allSettled([
    exchangeAuthorizationCode(pool, { code: codeRace, clientId: 'xeno-post', redirectUri: 'https://post.xenostudio.ai/auth/callback', codeVerifier: codeRacePkce.v }),
    exchangeAuthorizationCode(pool, { code: codeRace, clientId: 'xeno-post', redirectUri: 'https://post.xenostudio.ai/auth/callback', codeVerifier: codeRacePkce.v }),
  ]);
  ok(codeRaceResults.filter((x) => x.status === 'fulfilled').length === 1, 'concurrent code exchange mints exactly one token set');

  // 4. PKCE failure
  const { c: c2 } = pkce();
  const code2 = await createAuthorizationCode(pool, { clientId: 'xeno-post', userId, redirectUri: 'https://post.xenostudio.ai/auth/callback', scope: 'openid', codeChallenge: c2 });
  let pkceErr = null;
  try { await exchangeAuthorizationCode(pool, { code: code2, clientId: 'xeno-post', redirectUri: 'https://post.xenostudio.ai/auth/callback', codeVerifier: 'wrong-verifier' }); } catch (e) { pkceErr = e.message; }
  ok(/PKCE/.test(pkceErr || ''), 'wrong PKCE verifier rejected');

  // 4b. Step-up transactions carry the verified authentication time and reject
  // a stale session instead of silently satisfying prompt=login.
  const step = pkce();
  const steppedAt = new Date(Date.now() - 10_000);
  const stepCode = await createAuthorizationCode(pool, {
    clientId: 'xeno-post', userId, redirectUri: 'https://post.xenostudio.ai/auth/callback',
    scope: 'openid', codeChallenge: step.c, authTime: steppedAt,
    prompt: 'login', maxAge: 60, acr: 'urn:xeno:acr:fresh',
  });
  const stepTokens = await exchangeAuthorizationCode(pool, {
    code: stepCode, clientId: 'xeno-post', redirectUri: 'https://post.xenostudio.ai/auth/callback', codeVerifier: step.v,
  });
  const steppedId = jwt.verify(stepTokens.id_token, pub, { algorithms: ['ES256'] });
  ok(Math.abs(steppedId.auth_time - Math.floor(steppedAt.getTime() / 1000)) <= 1, 'step-up auth_time is preserved in issued tokens');
  let staleStep = null;
  try {
    await createAuthorizationCode(pool, {
      clientId: 'xeno-post', userId, redirectUri: 'https://post.xenostudio.ai/auth/callback',
      scope: 'openid', codeChallenge: step.c, authTime: new Date(Date.now() - 10 * 60_000),
      prompt: 'login', maxAge: 60, acr: 'urn:xeno:acr:fresh',
    });
  } catch (e) { staleStep = e.oauthError; }
  ok(staleStep === 'login_required', 'stale session cannot silently satisfy prompt=login step-up');

  // 5. refresh rotation + reuse detection
  const r1 = await refreshTokenGrant(pool, { refreshToken: tokens.refresh_token, clientId: 'xeno-post' });
  ok(r1.access_token && r1.refresh_token && r1.refresh_token !== tokens.refresh_token, 'refresh rotates the token');
  const refreshedAt = jwt.verify(r1.access_token, pub, { algorithms: ['ES256'] });
  ok(refreshedAt.client_id === 'xeno-post' && refreshedAt.azp === 'xeno-post', 'refreshed access token preserves client_id and azp');
  let reuse = null;
  try { await refreshTokenGrant(pool, { refreshToken: tokens.refresh_token, clientId: 'xeno-post' }); } catch (e) { reuse = e.message; }
  ok(/reuse/.test(reuse || ''), 'replaying the rotated refresh token is detected');
  let familyDead = null;
  try { await refreshTokenGrant(pool, { refreshToken: r1.refresh_token, clientId: 'xeno-post' }); } catch (e) { familyDead = e.message; }
  ok(/revoked/.test(familyDead || ''), 'reuse revoked the WHOLE family (the good token too)');

  // 5b. Concurrent refresh consumes one row atomically. One successor is minted;
  // the racing reuse then revokes the family/session, so that successor is dead.
  const refreshRacePkce = pkce();
  const refreshRaceCode = await createAuthorizationCode(pool, {
    clientId: 'xeno-post', userId, redirectUri: 'https://post.xenostudio.ai/auth/callback',
    scope: 'openid ledger', codeChallenge: refreshRacePkce.c,
  });
  const refreshRaceSeed = await exchangeAuthorizationCode(pool, {
    code: refreshRaceCode, clientId: 'xeno-post', redirectUri: 'https://post.xenostudio.ai/auth/callback', codeVerifier: refreshRacePkce.v,
  });
  const refreshRaceResults = await Promise.allSettled([
    refreshTokenGrant(pool, { refreshToken: refreshRaceSeed.refresh_token, clientId: 'xeno-post' }),
    refreshTokenGrant(pool, { refreshToken: refreshRaceSeed.refresh_token, clientId: 'xeno-post' }),
  ]);
  const refreshRaceWins = refreshRaceResults.filter((x) => x.status === 'fulfilled');
  ok(refreshRaceWins.length === 1, 'concurrent refresh mints exactly one successor');
  const refreshRaceHash = crypto.createHash('sha256').update(refreshRaceSeed.refresh_token).digest('hex');
  const refreshRaceFamily = await pool.query(
    `SELECT count(*)::int AS count FROM oauth_refresh_tokens
      WHERE family_id = (SELECT family_id FROM oauth_refresh_tokens WHERE token_hash = $1)`,
    [refreshRaceHash],
  );
  ok(refreshRaceFamily.rows[0].count === 2, 'concurrent refresh creates no duplicate successor rows');
  ok((await introspectToken(pool, { token: refreshRaceWins[0].value.access_token })).active === false,
    'reuse race revokes the access session before the returned successor can be used');

  // 6. device grant
  const dev = await startDeviceAuthorization(pool, { clientId: 'xeno-post', scope: 'openid ledger' });
  ok(dev.device_code && dev.user_code.includes('-'), 'device authorization returns device + user code');
  let pending = null;
  try { await deviceTokenGrant(pool, { deviceCode: dev.device_code, clientId: 'xeno-post' }); } catch (e) { pending = e.oauthError; }
  ok(pending === 'authorization_pending', 'device token pending before approval');
  await approveDevice(pool, { userCode: dev.user_code, userId });
  const devTokens = await deviceTokenGrant(pool, { deviceCode: dev.device_code, clientId: 'xeno-post' });
  ok(devTokens.access_token && devTokens.refresh_token, 'approved device grant issues tokens');

  // 7. introspection (RFC 7662): active access + active refresh
  const ia = await introspectToken(pool, { token: devTokens.access_token });
  ok(ia.active === true && ia.token_type === 'access_token' && ia.sub === userId, 'introspect: access token active, sub correct');
  const ir = await introspectToken(pool, { token: devTokens.refresh_token });
  ok(ir.active === true && ir.token_type === 'refresh_token', 'introspect: refresh token active');
  ok((await introspectToken(pool, { token: 'garbage.token.value' })).active === false, 'introspect: garbage token inactive');

  // 8. revocation (RFC 7009): revoke refresh → introspect inactive + refresh grant fails
  await revokeToken(pool, { token: devTokens.refresh_token });
  ok((await introspectToken(pool, { token: devTokens.refresh_token })).active === false, 'revoke: refresh token now inactive');
  let revoked = null;
  try { await refreshTokenGrant(pool, { refreshToken: devTokens.refresh_token, clientId: 'xeno-post' }); } catch (e) { revoked = e.message; }
  ok(/revoked/.test(revoked || ''), 'revoke: refresh grant rejected after revocation');

  // 9. Session logout derives ownership from the authenticated subject.
  const ownedPkce = pkce();
  const ownedCode = await createAuthorizationCode(pool, {
    clientId: 'xeno-post', userId, redirectUri: 'https://post.xenostudio.ai/auth/callback',
    scope: 'openid ledger', codeChallenge: ownedPkce.c,
  });
  const owned = await exchangeAuthorizationCode(pool, {
    code: ownedCode, clientId: 'xeno-post', redirectUri: 'https://post.xenostudio.ai/auth/callback', codeVerifier: ownedPkce.v,
  });
  const ownedClaims = jwt.decode(owned.access_token);
  let foreignEnd = null;
  try { await endSession(pool, { sid: ownedClaims.sid, userId: otherUserId }); } catch (e) { foreignEnd = e.oauthError; }
  ok(foreignEnd === 'invalid_request', 'another subject cannot revoke a foreign SID');
  ok((await introspectToken(pool, { token: owned.access_token })).active === true, 'foreign logout attempt leaves the owner session active');
  await endSession(pool, { sid: ownedClaims.sid, userId });
  ok((await introspectToken(pool, { token: owned.access_token })).active === false, 'owner session logout immediately revokes access');

  // 10. Global logout advances one durable subject epoch and kills every old
  // session, while a session created after the commit uses the new epoch.
  async function issueSession() {
    const p = pkce();
    const c = await createAuthorizationCode(pool, {
      clientId: 'xeno-post', userId, redirectUri: 'https://post.xenostudio.ai/auth/callback',
      scope: 'openid ledger', codeChallenge: p.c,
    });
    return exchangeAuthorizationCode(pool, {
      code: c, clientId: 'xeno-post', redirectUri: 'https://post.xenostudio.ai/auth/callback', codeVerifier: p.v,
    });
  }
  const globalA = await issueSession();
  const globalB = await issueSession();
  const globalResult = await logoutEverywhere(pool, { userId });
  ok(globalResult.epoch >= 1, 'global logout advances the subject revocation epoch');
  ok((await introspectToken(pool, { token: globalA.access_token })).active === false
    && (await introspectToken(pool, { token: globalB.access_token })).active === false,
  'global logout immediately revokes every prior access session');
  let globalRefresh = null;
  try { await refreshTokenGrant(pool, { refreshToken: globalA.refresh_token, clientId: 'xeno-post' }); } catch (e) { globalRefresh = e.message; }
  ok(/revoked|session/.test(globalRefresh || ''), 'global logout prevents every prior refresh family from minting');
  const afterGlobal = await issueSession();
  ok((await introspectToken(pool, { token: afterGlobal.access_token })).active === true, 'a session created after global logout uses the new epoch');

  console.log(`\n${fail === 0 ? '✅' : '❌'} oidc-v2: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
