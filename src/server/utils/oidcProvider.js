/**
 * OIDC Provider v2 — the identity (login) half of the XENO unified account.
 *
 * ADDITIVE + flag-gated (OIDC_ENABLED). Implements the relying-party surface the
 * @xeno/account SDK expects (see XENO ACCOUNT - ARCHITECTURE.md §2):
 *  - Authorization Code + PKCE (S256) — web/native (RFC 8252)
 *  - Device Authorization Grant (RFC 8628) — CLI / headless
 *  - RS256 signing + JWKS (RFC 7517), key material in oidc_signing_keys
 *  - Refresh-token rotation with reuse detection (RFC 9700 §2.2.2): a replayed
 *    refresh token revokes the whole family.
 *
 * Tokens are signed RS256 with a key persisted in the DB (so all backend
 * replicas share it). The legacy HS256 JWT + /api/auth/* are UNTOUCHED — this is
 * a brand-new, separate surface (Identity Plan R2).
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { issuer, mailDomain } from '../config/hosts.js';
import { OIDC_SCOPES, scopesForClient } from '../config/oidcAuthorityPolicy.js';
import { jwkThumbprint, publicJwk } from './dpop.js';
import { recordSecurityEventAsync, EVENTS } from '../services/securityEvents.js';

const ACCESS_TTL_SEC = 10 * 60; // 10 min
const ID_TTL_SEC = 10 * 60;

// ── What an ACCESS token is (the issuer owns this definition) ────────────────
// Three different asymmetric JWTs are minted below off the SAME signing key:
//   access token  aud=ACCESS_TOKEN_AUDIENCE  typ='at+jwt' (payload AND header)
//   ID token      aud=<client_id>            no payload typ, header typ='JWT'
//   logout token  aud=<client_id>            `events` claim, header typ='logout+jwt'
// A verifier that only checks the SIGNATURE therefore cannot tell them apart, and
// an ID token or a back-channel logout token becomes replayable as an access token
// (token confusion). Both the mint side and every verify side (middleware/auth.js
// `resolveAuthedUser`, `introspectToken` below) use the constants + predicate here,
// so the two can never drift. LOCKED by XENO AUTH - SPEC.md §3.2.
export const ACCESS_TOKEN_AUDIENCE = 'xeno-api';
export const ACCESS_TOKEN_TYP = 'at+jwt';

/** RFC 7519 `aud` may be a string or an array of strings. */
function audienceIncludes(aud, expected) {
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected;
}

/**
 * True ONLY for a token minted as an ACCESS token for this resource server:
 * audience-scoped to `xeno-api` AND explicitly typed `at+jwt` (RFC 9068 — set in
 * both the payload and the JOSE header since the provider's first commit, so this
 * cannot reject any access token we have ever issued). Rejects ID tokens (no
 * payload `typ`) and back-channel logout tokens (`events`, `typ: 'logout+jwt'`)
 * even if a client were ever registered under the `xeno-api` client_id.
 * @param {object|undefined} header decoded JOSE header
 * @param {object|undefined} payload verified claims
 */
export function isAccessToken(header, payload) {
  if (!payload || !audienceIncludes(payload.aud, ACCESS_TOKEN_AUDIENCE)) return false;
  if (payload.events !== undefined) return false; // OIDC back-channel logout marker
  if (payload.typ !== undefined) return payload.typ === ACCESS_TOKEN_TYP;
  return header?.typ === ACCESS_TOKEN_TYP;
}
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const CODE_TTL_SEC = 5 * 60;
const DEVICE_TTL_SEC = 10 * 60;

// `issuer()` now lives in ../config/hosts.js (imported above). It resolves
// identically: OIDC_ISSUER, else the configured site origin, else the frozen
// default 'https://xenostudio.ai'. See that module for why an OIDC issuer is
// the one host in this codebase that CANNOT be dual-homed by widening a list.

// ── Signing key (RS256) ─────────────────────────────────────────────────────

let cachedKey = null;

/** Load the active signing key, generating + persisting one on first use. */
export async function getSigningKey(db) {
  if (cachedKey) return cachedKey;
  // Prefer an active ES256 key for SIGNING (Arch §2.4: ES256 default). Any
  // existing RS256 keys stay in the table + JWKS so older tokens keep verifying
  // (verify-by-kid, see getKeyByKid) — additive, no break.
  const existing = await db.query(
    "SELECT kid, alg, private_pem, public_jwk FROM oidc_signing_keys WHERE active = true AND alg = 'ES256' ORDER BY created_at DESC LIMIT 1",
  );
  if (existing.rows.length > 0) {
    const r = existing.rows[0];
    cachedKey = { kid: r.kid, alg: r.alg, privatePem: r.private_pem, publicJwk: r.public_jwk };
    return cachedKey;
  }
  // Generate a fresh ES256 (P-256) keypair.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const kid = crypto.randomBytes(8).toString('hex');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const jwk = publicKey.export({ format: 'jwk' });
  const publicJwk = { ...jwk, kid, use: 'sig', alg: 'ES256' };
  await db.query(
    "INSERT INTO oidc_signing_keys (kid, alg, private_pem, public_jwk, active) VALUES ($1,'ES256',$2,$3::jsonb,true)",
    [kid, privatePem, JSON.stringify(publicJwk)],
  );
  cachedKey = { kid, alg: 'ES256', privatePem, publicJwk };
  return cachedKey;
}

/** Resolve any signing key (active or not) by kid → public key, for verification. */
export async function getKeyByKid(db, kid) {
  const r = await db.query('SELECT alg, private_pem FROM oidc_signing_keys WHERE kid = $1', [kid]);
  if (!r.rows[0]) return null;
  return { alg: r.rows[0].alg, publicKey: crypto.createPublicKey(r.rows[0].private_pem) };
}

/** JWKS document (public keys only). Ensures a key exists (lazy generation). */
export async function jwks(db) {
  await getSigningKey(db); // generate-on-first-use so JWKS is never empty
  const rows = await db.query("SELECT public_jwk FROM oidc_signing_keys WHERE active = true");
  return { keys: rows.rows.map((r) => r.public_jwk) };
}

/** OIDC discovery document. */
export function discovery() {
  const iss = issuer();
  // Endpoints live under /api/* because the edge routes only /api to the backend.
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/api/oauth2/authorize`,
    token_endpoint: `${iss}/api/oauth2/token`,
    device_authorization_endpoint: `${iss}/api/oauth2/device_authorization`,
    revocation_endpoint: `${iss}/api/oauth2/revoke`,
    introspection_endpoint: `${iss}/api/oauth2/introspect`,
    end_session_endpoint: `${iss}/api/oauth2/end_session`,
    xeno_logout_everywhere_endpoint: `${iss}/api/oauth2/logout_everywhere`,
    jwks_uri: `${iss}/api/oauth2/jwks`,
    userinfo_endpoint: `${iss}/api/v2/me`,
    response_types_supported: ['code'],
    grant_types_supported: [
      'authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code',
      'urn:ietf:params:oauth:grant-type:token-exchange',
    ],
    code_challenge_methods_supported: ['S256'],
    acr_values_supported: ['urn:xeno:acr:fresh'],
    claims_supported: [
      'iss', 'sub', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'sid',
      'client_id', 'azp', 'scope', 'cnf', 'act', 'auth_epoch',
    ],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    // We sign ES256 (getSigningKey prefers/generates ES256); any legacy RS256 keys
    // stay in JWKS so older tokens keep verifying. Advertise honestly (XENO AUTH §3.2).
    id_token_signing_alg_values_supported: ['ES256', 'RS256'],
    scopes_supported: [...OIDC_SCOPES],
  };
}

// ── Clients ─────────────────────────────────────────────────────────────────

export async function getClient(db, clientId) {
  const r = await db.query('SELECT * FROM oauth_clients WHERE client_id = $1', [clientId]);
  return r.rows[0] || null;
}

function clientAllowsRedirect(client, redirectUri) {
  const uris = Array.isArray(client.redirect_uris) ? client.redirect_uris : [];
  if (uris.includes(redirectUri)) return true;
  // RFC 8252 §7.3 loopback: a native/desktop client (`loopback` flag) may receive
  // the callback on ANY ephemeral port of 127.0.0.1 / [::1], provided the PATH
  // matches a registered loopback redirect. Loopback literals ONLY — never an
  // arbitrary host (XENO AUTH §14 P-a). Non-loopback clients stay exact-match.
  if (!client.loopback) return false;
  let req;
  try { req = new URL(redirectUri); } catch { return false; }
  if (req.protocol !== 'http:') return false;
  const host = req.hostname.replace(/^\[|\]$/g, ''); // URL keeps IPv6 brackets
  if (host !== '127.0.0.1' && host !== '::1') return false;
  return uris.some((u) => {
    let reg;
    try { reg = new URL(u); } catch { return false; }
    const rh = reg.hostname.replace(/^\[|\]$/g, '');
    return (rh === '127.0.0.1' || rh === '::1') && reg.pathname === req.pathname;
  });
}

/** Intersect a requested scope string with the client's allowed_scopes (XENO AUTH
 *  §14 P-e). Never grants a scope the client isn't authorized for; keeps `openid`. */
function downscope(requested, allowedScopes) {
  const allow = new Set(Array.isArray(allowedScopes) ? allowedScopes : []);
  const granted = String(requested || '')
    .split(/\s+/)
    .filter((s) => s && allow.has(s));
  if (!granted.includes('openid')) granted.unshift('openid');
  return granted.join(' ');
}

/** Validate the browser authorization request before showing any login UI. */
export async function validateAuthorizationRequest(db, {
  clientId,
  redirectUri,
  codeChallenge,
  codeChallengeMethod,
}) {
  const client = await getClient(db, clientId);
  if (!client) throw oauthError('invalid_client', 'unknown client');
  if (!clientAllowsRedirect(client, redirectUri)) throw oauthError('invalid_request', 'redirect_uri mismatch');
  if (!codeChallenge) throw oauthError('invalid_request', 'code_challenge required (PKCE S256)');
  if (codeChallengeMethod !== 'S256') throw oauthError('invalid_request', 'code_challenge_method must be S256');
  return client;
}

// ── Token minting ───────────────────────────────────────────────────────────

async function userClaims(db, userId) {
  const r = await db.query(
    'SELECT id, email, username, display_name, avatar_url, email_verified FROM users WHERE id = $1 AND is_active = true',
    [userId],
  );
  return r.rows[0] || null;
}

async function currentAuthEpoch(db, userId, { forUpdate = false } = {}) {
  await db.query(
    `INSERT INTO oauth_user_auth_epochs (user_id, epoch)
     VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  const r = await db.query(
    `SELECT epoch, changed_at FROM oauth_user_auth_epochs WHERE user_id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [userId],
  );
  return r.rows[0];
}

async function registerSession(db, { sid, userId, authTime = new Date(), dpopJkt = null }) {
  const epoch = await currentAuthEpoch(db, userId);
  await db.query(
    `INSERT INTO oauth_session_state (sid, user_id, auth_epoch, auth_time, dpop_jkt, expires_at)
     VALUES ($1,$2,$3,$4,$5, now() + interval '${REFRESH_TTL_SEC} seconds')
     ON CONFLICT (sid) DO NOTHING`,
    [sid, userId, epoch.epoch, authTime, dpopJkt],
  );
  return { epoch: Number(epoch.epoch), authTime: new Date(authTime) };
}

async function ensureRefreshSession(db, row) {
  const epoch = await currentAuthEpoch(db, row.user_id, { forUpdate: true });
  let state = await db.query('SELECT * FROM oauth_session_state WHERE sid = $1 FOR UPDATE', [row.sid]);
  if (state.rows.length === 0) {
    // Compatibility for refresh tokens minted before the session-state migration.
    // A token older than a completed global revocation is never blessed into the
    // new epoch merely because this is its first post-migration refresh.
    if (Number(epoch.epoch) > 0 && new Date(row.created_at) < new Date(epoch.changed_at)) {
      throw oauthError('invalid_grant', 'session revoked');
    }
    await db.query(
      `INSERT INTO oauth_session_state (sid, user_id, auth_epoch, auth_time, dpop_jkt, expires_at)
       VALUES ($1,$2,$3,$4,NULL,$5) ON CONFLICT (sid) DO NOTHING`,
      [row.sid, row.user_id, epoch.epoch, row.created_at, row.expires_at],
    );
    state = await db.query('SELECT * FROM oauth_session_state WHERE sid = $1 FOR UPDATE', [row.sid]);
  }
  const session = state.rows[0];
  if (!session || session.user_id !== row.user_id || session.revoked_at
      || new Date(session.expires_at).getTime() <= Date.now()
      || Number(session.auth_epoch) !== Number(epoch.epoch)) {
    throw oauthError('invalid_grant', 'session revoked');
  }
  return session;
}

async function mintTokens(db, { user, clientId, scope, sid, nonce, authTime = new Date(), dpopJkt = null }) {
  const key = await getSigningKey(db);
  const now = Math.floor(Date.now() / 1000);
  const session = await registerSession(db, { sid, userId: user.id, authTime, dpopJkt });
  const base = {
    iss: issuer(), iat: now, sid, auth_epoch: session.epoch,
    auth_time: Math.floor(session.authTime.getTime() / 1000),
  };
  const accessToken = jwt.sign(
    { ...base, sub: user.id, aud: ACCESS_TOKEN_AUDIENCE, client_id: clientId, azp: clientId, scope, typ: ACCESS_TOKEN_TYP,
      ...(dpopJkt ? { cnf: { jkt: dpopJkt } } : {}) },
    key.privatePem,
    { algorithm: key.alg, keyid: key.kid, expiresIn: ACCESS_TTL_SEC, header: { typ: ACCESS_TOKEN_TYP, kid: key.kid } },
  );
  // XENO handle unification: a conforming, non-reserved handle IS the @<domain> address.
  const handleDomain = mailDomain();
  const lowHandle = String(user.username || '').toLowerCase();
  let xenoAddress = null;
  if (/^[a-z0-9](?:[a-z0-9]|[._-](?![._-])){1,30}[a-z0-9]$/.test(lowHandle)) {
    const registry = await db.query("SELECT to_regclass('public.reserved_handles') AS rel");
    if (registry.rows[0]?.rel) {
      const rsv = await db.query('SELECT 1 FROM reserved_handles WHERE handle = $1', [lowHandle]);
      if (rsv.rows.length === 0) xenoAddress = `${lowHandle}@${handleDomain}`;
    }
  }
  const idToken = jwt.sign(
    { ...base, sub: user.id, aud: clientId, email: user.email, email_verified: user.email_verified ?? false,
      name: user.display_name || user.username, preferred_username: user.username,
      ...(xenoAddress ? { xeno_address: xenoAddress } : {}),
      // Echo the request nonce so the SDK can defend against id_token replay
      // (XENO AUTH §3.3 / §14 P-c). Only present on code/device mint.
      ...(nonce ? { nonce } : {}) },
    key.privatePem,
    { algorithm: key.alg, keyid: key.kid, expiresIn: ID_TTL_SEC },
  );
  // Identity-by-(provider,subject): record that this canonical user is linked to
  // the client's SURFACE (Arch §2.1, §0.4). This is the "from where" join key —
  // /api/v2/me reads linkedSurfaces from here, never from email.
  await recordSurfaceLink(db, { userId: user.id, clientId, email: user.email });
  // Opaque refresh token, hashed at rest, with a rotation family.
  const familyId = crypto.randomUUID();
  const refreshToken = await issueRefreshToken(db, { userId: user.id, clientId, scope, sid, familyId });
  return {
    access_token: accessToken,
    token_type: dpopJkt ? 'DPoP' : 'Bearer',
    expires_in: ACCESS_TTL_SEC,
    refresh_token: refreshToken,
    id_token: idToken,
    scope,
  };
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Upsert the (surface → canonical user) link on sign-in. `source_system` is the
 * client's declared surface (xeno_post, …). Keyed on (source_system,
 * platform_user_id) so it's idempotent. external_user_id is later backfilled by
 * the branch (it owns its local id); email is contact-only.
 */
async function recordSurfaceLink(db, { userId, clientId, email }) {
  const c = await getClient(db, clientId);
  const surface = c?.surface || clientId;
  await db.query(
    `INSERT INTO external_identity_links (source_system, platform_user_id, external_email, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (source_system, platform_user_id)
       DO UPDATE SET external_email = EXCLUDED.external_email, updated_at = now()`,
    [surface, userId, email || null],
  );
}

async function issueRefreshToken(db, { userId, clientId, scope, sid, familyId }) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, family_id, scope, sid, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6, now() + interval '${REFRESH_TTL_SEC} seconds')`,
    [sha256(token), clientId, userId, familyId, scope, sid],
  );
  return token;
}

// ── Authorization Code flow ─────────────────────────────────────────────────

/**
 * Issue an authorization code for an ALREADY-AUTHENTICATED user (the caller
 * proves identity with a valid platform token → authMiddleware → req.user).
 * First-party clients skip the consent screen (Identity Plan §2.3).
 */
export async function createAuthorizationCode(db, {
  clientId,
  userId,
  redirectUri,
  scope,
  codeChallenge,
  codeChallengeMethod = 'S256',
  nonce,
  authTime = new Date(),
  prompt = null,
  maxAge = null,
  acr = null,
}) {
  const client = await validateAuthorizationRequest(db, {
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
  });
  const grantedScope = downscope(scope || 'openid profile email', client.allowed_scopes);
  if (prompt !== null && prompt !== '' && prompt !== 'login') {
    throw oauthError('invalid_request', 'unsupported prompt');
  }
  const normalizedMaxAge = maxAge === null || maxAge === '' ? null : Number(maxAge);
  if (normalizedMaxAge !== null && (!Number.isInteger(normalizedMaxAge) || normalizedMaxAge < 0 || normalizedMaxAge > 30 * 24 * 60 * 60)) {
    throw oauthError('invalid_request', 'invalid max_age');
  }
  if (acr && acr !== 'urn:xeno:acr:fresh') throw oauthError('invalid_request', 'unsupported acr_values');
  const authenticatedAt = new Date(authTime);
  if (!Number.isFinite(authenticatedAt.getTime())) throw oauthError('login_required', 'fresh authentication required');
  const ageSec = Math.max(0, (Date.now() - authenticatedAt.getTime()) / 1000);
  const requiredMaxAge = prompt === 'login' ? Math.min(normalizedMaxAge ?? 60, 60) : normalizedMaxAge;
  if (requiredMaxAge !== null && ageSec > requiredMaxAge + 60) {
    throw oauthError('login_required', 'fresh authentication required');
  }
  const code = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `WITH inserted AS (
       INSERT INTO oauth_authorization_codes
         (code, client_id, user_id, redirect_uri, scope, code_challenge, nonce, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + interval '${CODE_TTL_SEC} seconds')
       RETURNING code
     )
     INSERT INTO oauth_authorization_context (code, auth_time, prompt, acr)
     SELECT code, $8, $9, $10 FROM inserted`,
    [code, clientId, userId, redirectUri, grantedScope, codeChallenge, nonce || null,
      authenticatedAt, prompt || null, acr || null],
  );
  return code;
}

export async function exchangeAuthorizationCode(db, { code, clientId, redirectUri, codeVerifier, dpopJkt = null }) {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const r = await tx.query(
      `SELECT c.*, x.auth_time, x.prompt, x.acr
         FROM oauth_authorization_codes c
         JOIN oauth_authorization_context x ON x.code = c.code
        WHERE c.code = $1 FOR UPDATE OF c`,
      [code],
    );
    const row = r.rows[0];
    if (!row || row.consumed) throw oauthError('invalid_grant', 'code invalid or already used');
    if (new Date(row.expires_at).getTime() < Date.now()) throw oauthError('invalid_grant', 'code expired');
    if (row.client_id !== clientId) throw oauthError('invalid_grant', 'client mismatch');
    if (row.redirect_uri !== redirectUri) throw oauthError('invalid_grant', 'redirect_uri mismatch');
    const challenge = crypto.createHash('sha256').update(codeVerifier || '').digest('base64url');
    if (challenge !== row.code_challenge) throw oauthError('invalid_grant', 'PKCE verification failed');
    await tx.query('UPDATE oauth_authorization_codes SET consumed = true WHERE code = $1', [code]);
    const user = await userClaims(tx, row.user_id);
    if (!user) throw oauthError('invalid_grant', 'user not found');
    const tokens = await mintTokens(tx, {
      user, clientId, scope: row.scope, sid: crypto.randomUUID(), nonce: row.nonce, dpopJkt,
      authTime: row.auth_time,
    });
    await tx.query('COMMIT');
    return tokens;
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    tx.release();
  }
}

// ── Refresh rotation + reuse detection ──────────────────────────────────────

export async function refreshTokenGrant(db, { refreshToken, clientId, dpopJkt = null }) {
  const hash = sha256(refreshToken);
  const tx = await db.connect();
  let reuse = null;
  let refreshed = null;
  let refreshEvent = null;
  try {
    await tx.query('BEGIN');
    const r = await tx.query('SELECT * FROM oauth_refresh_tokens WHERE token_hash = $1 FOR UPDATE', [hash]);
    const row = r.rows[0];
    if (!row) throw oauthError('invalid_grant', 'unknown refresh token');
    if (row.client_id !== clientId) throw oauthError('invalid_grant', 'client mismatch');
    if (row.revoked) throw oauthError('invalid_grant', 'refresh token revoked');
    if (new Date(row.expires_at).getTime() < Date.now()) throw oauthError('invalid_grant', 'refresh token expired');
    if (row.rotated) {
      await tx.query('UPDATE oauth_refresh_tokens SET revoked = true WHERE family_id = $1', [row.family_id]);
      await tx.query('UPDATE oauth_session_state SET revoked_at = COALESCE(revoked_at, now()) WHERE sid = $1', [row.sid]);
      reuse = row;
      await tx.query('COMMIT');
    } else {
      const session = await ensureRefreshSession(tx, row);
      if (session.dpop_jkt && session.dpop_jkt !== dpopJkt) {
        throw oauthError('invalid_dpop_proof', 'refresh token sender constraint mismatch');
      }
      await tx.query('UPDATE oauth_refresh_tokens SET rotated = true WHERE id = $1', [row.id]);
      const user = await userClaims(tx, row.user_id);
      if (!user) throw oauthError('invalid_grant', 'user not found');
      const key = await getSigningKey(tx);
      const now = Math.floor(Date.now() / 1000);
      const authTime = Math.floor(new Date(session.auth_time).getTime() / 1000);
      const access = jwt.sign(
        { iss: issuer(), iat: now, sub: user.id, aud: ACCESS_TOKEN_AUDIENCE, client_id: clientId, azp: clientId,
          scope: row.scope, sid: row.sid, auth_epoch: Number(session.auth_epoch), auth_time: authTime,
          typ: ACCESS_TOKEN_TYP, ...(session.dpop_jkt ? { cnf: { jkt: session.dpop_jkt } } : {}) },
        key.privatePem,
        { algorithm: key.alg, keyid: key.kid, expiresIn: ACCESS_TTL_SEC, header: { typ: ACCESS_TOKEN_TYP, kid: key.kid } },
      );
      const newRefresh = await issueRefreshToken(tx, {
        userId: user.id, clientId, scope: row.scope, sid: row.sid, familyId: row.family_id,
      });
      refreshed = { access_token: access, token_type: session.dpop_jkt ? 'DPoP' : 'Bearer', expires_in: ACCESS_TTL_SEC, refresh_token: newRefresh, scope: row.scope };
      refreshEvent = { userId: row.user_id, familyId: row.family_id };
      await tx.query('COMMIT');
    }
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    tx.release();
  }
  if (reuse) {
    recordSecurityEventAsync(db, EVENTS.TOKEN_REUSE_DETECTED, {
      userId: reuse.user_id,
      metadata: { clientId, familyId: reuse.family_id, sid: reuse.sid },
    });
    throw oauthError('invalid_grant', 'refresh token reuse detected — family revoked');
  }
  recordSecurityEventAsync(db, EVENTS.TOKEN_REFRESHED, {
    userId: refreshEvent.userId,
    metadata: { clientId, familyId: refreshEvent.familyId },
  });
  return refreshed;
}

// ── Device Authorization Grant (RFC 8628) ───────────────────────────────────

export async function startDeviceAuthorization(db, { clientId, scope }) {
  const client = await getClient(db, clientId);
  if (!client) throw oauthError('invalid_client', 'unknown client');
  const grantedScope = downscope(scope || 'openid profile email ledger', client.allowed_scopes);
  const deviceCode = crypto.randomBytes(32).toString('base64url');
  const userCode = `${rand4()}-${rand4()}`;
  await db.query(
    `INSERT INTO oauth_device_codes (device_code, user_code, client_id, scope, interval_secs, expires_at)
     VALUES ($1,$2,$3,$4,5, now() + interval '${DEVICE_TTL_SEC} seconds')`,
    [deviceCode, userCode, clientId, grantedScope],
  );
  const iss = issuer();
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${iss}/activate`,
    verification_uri_complete: `${iss}/activate?code=${userCode}`,
    expires_in: DEVICE_TTL_SEC,
    interval: 5,
  };
}

/** Registered client + requested scopes for the authenticated consent screen. */
export async function inspectDeviceAuthorization(db, { userCode }) {
  const normalized = String(userCode || '').toUpperCase();
  const r = await db.query(
    `SELECT dc.client_id, dc.scope, c.name AS client_name
       FROM oauth_device_codes dc
       JOIN oauth_clients c ON c.client_id = dc.client_id
      WHERE dc.user_code = $1
        AND dc.approved = false
        AND dc.denied = false
        AND dc.expires_at > now()`,
    [normalized],
  );
  const row = r.rows[0];
  if (!row) throw oauthError('invalid_request', 'invalid or expired user_code');
  return { client_id: row.client_id, client_name: row.client_name, scope: row.scope };
}

/** Approve a device code for an authenticated user (called from the activate UI/API). */
export async function approveDevice(db, { userCode, userId }) {
  const r = await db.query(
    "UPDATE oauth_device_codes SET approved = true, user_id = $1 WHERE user_code = $2 AND approved = false AND denied = false AND expires_at > now() RETURNING device_code",
    [userId, String(userCode || '').toUpperCase()],
  );
  if (r.rows.length === 0) throw oauthError('invalid_request', 'invalid or expired user_code');
  return { ok: true };
}

export async function deviceTokenGrant(db, { deviceCode, clientId, dpopJkt = null }) {
  const r = await db.query('SELECT * FROM oauth_device_codes WHERE device_code = $1 AND client_id = $2', [deviceCode, clientId]);
  const row = r.rows[0];
  if (!row) throw oauthError('invalid_grant', 'unknown device_code');
  if (new Date(row.expires_at).getTime() < Date.now()) throw oauthError('expired_token', 'device code expired');
  if (row.denied) throw oauthError('access_denied', 'user denied');
  if (!row.approved) throw oauthError('authorization_pending', 'pending user approval');
  const user = await userClaims(db, row.user_id);
  if (!user) throw oauthError('invalid_grant', 'user not found');
  await db.query('DELETE FROM oauth_device_codes WHERE device_code = $1', [deviceCode]);
  return mintTokens(db, { user, clientId, scope: row.scope, sid: crypto.randomUUID(), dpopJkt });
}

// ── Revocation (RFC 7009) + Introspection (RFC 7662) ────────────────────────

/**
 * Revoke a refresh token and its whole rotation family (RFC 7009). Also accepts
 * a `sid` to kill every refresh token for a session (RP-initiated / global
 * logout, Arch §2.5). Always succeeds (no token enumeration). Access-token JWTs
 * expire on their own via the 10-min TTL.
 */
const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

/**
 * OIDC Back-Channel Logout (Arch §2.5): for every relying party that holds a
 * session under `sid` and has registered a `backchannel_logout_uri`, POST a
 * signed Logout Token so it can kill its local session — the only reliable
 * cross-app logout (no browser). Best-effort; never throws into the caller.
 */
export async function emitBackchannelLogout(db, sid) {
  if (!sid) return;
  let rows;
  try {
    rows = await db.query(
      `SELECT DISTINCT rt.client_id, rt.user_id, c.backchannel_logout_uri
         FROM oauth_refresh_tokens rt JOIN oauth_clients c ON c.client_id = rt.client_id
        WHERE rt.sid = $1 AND c.backchannel_logout_uri IS NOT NULL`,
      [sid],
    );
  } catch { return; } // column may not exist yet on older DBs
  if (rows.rows.length === 0) return;
  const key = await getSigningKey(db);
  const now = Math.floor(Date.now() / 1000);
  await Promise.all(rows.rows.map(async (r) => {
    const logoutToken = jwt.sign(
      { iss: issuer(), aud: r.client_id, sub: r.user_id, sid, iat: now, jti: crypto.randomBytes(8).toString('hex'), events: { [LOGOUT_EVENT]: {} } },
      key.privatePem, { algorithm: key.alg, keyid: key.kid, expiresIn: 120, header: { typ: 'logout+jwt', kid: key.kid } },
    );
    try {
      // First-party RPs receive JSON (we control both ends). Spec RPs use
      // application/x-www-form-urlencoded `logout_token=…` — a trivial swap when
      // onboarding third parties.
      await fetch(r.backchannel_logout_uri, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ logout_token: logoutToken }),
      });
    } catch { /* RP unreachable — best effort */ }
  }));
}

export async function revokeToken(db, { token }) {
  if (!token) return { revoked: true };
  const r = await db.query('SELECT family_id, user_id, sid FROM oauth_refresh_tokens WHERE token_hash = $1', [sha256(token)]);
  if (r.rows[0]) {
    await db.query('UPDATE oauth_refresh_tokens SET revoked = true WHERE family_id = $1', [r.rows[0].family_id]);
    await db.query(
      'UPDATE oauth_session_state SET revoked_at = COALESCE(revoked_at, now()) WHERE sid = $1 AND user_id = $2',
      [r.rows[0].sid, r.rows[0].user_id],
    );
    recordSecurityEventAsync(db, EVENTS.TOKEN_REVOKED, {
      userId: r.rows[0].user_id, metadata: { familyId: r.rows[0].family_id, by: 'token' },
    });
    await emitBackchannelLogout(db, r.rows[0].sid).catch(() => {});
  }
  return { revoked: true };
}

/** Revoke exactly the authenticated subject's current OIDC session. */
export async function endSession(db, { sid, userId }) {
  if (!sid || !userId) throw oauthError('invalid_request', 'session unavailable');
  const tx = await db.connect();
  let found = false;
  try {
    await tx.query('BEGIN');
    const state = await tx.query('SELECT user_id FROM oauth_session_state WHERE sid = $1 FOR UPDATE', [sid]);
    // Same response for missing and foreign SIDs: never reveal another user's session.
    if (state.rows.length === 1 && state.rows[0].user_id === userId) {
      found = true;
      await tx.query('UPDATE oauth_session_state SET revoked_at = COALESCE(revoked_at, now()) WHERE sid = $1', [sid]);
      await tx.query('UPDATE oauth_refresh_tokens SET revoked = true WHERE sid = $1 AND user_id = $2', [sid, userId]);
    }
    await tx.query('COMMIT');
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    tx.release();
  }
  if (!found) throw oauthError('invalid_request', 'session unavailable');
  recordSecurityEventAsync(db, EVENTS.TOKEN_REVOKED, { userId, metadata: { sid, by: 'session_owner' } });
  await emitBackchannelLogout(db, sid).catch(() => {});
  return { ended: true };
}

/**
 * Subject-keyed global revocation. The epoch advances in the same transaction
 * that revokes every known session/family, so an access JWT from any older epoch
 * becomes inactive before this operation reports success.
 */
export async function logoutEverywhere(db, { userId }) {
  if (!userId) throw oauthError('invalid_request', 'authenticated subject required');
  const tx = await db.connect();
  let sids = [];
  let epoch;
  try {
    await tx.query('BEGIN');
    const current = await currentAuthEpoch(tx, userId, { forUpdate: true });
    epoch = Number(current.epoch) + 1;
    sids = (await tx.query('SELECT sid FROM oauth_session_state WHERE user_id = $1', [userId])).rows.map((r) => r.sid);
    await tx.query(
      'UPDATE oauth_user_auth_epochs SET epoch = $2, changed_at = now() WHERE user_id = $1',
      [userId, epoch],
    );
    await tx.query(
      'UPDATE oauth_session_state SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1',
      [userId],
    );
    await tx.query('UPDATE oauth_refresh_tokens SET revoked = true WHERE user_id = $1', [userId]);
    await tx.query('COMMIT');
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    tx.release();
  }
  recordSecurityEventAsync(db, EVENTS.TOKEN_REVOKED, {
    userId, metadata: { by: 'global_subject_epoch', epoch, sessionCount: sids.length },
  });
  await Promise.all(sids.map((sid) => emitBackchannelLogout(db, sid).catch(() => {})));
  return { ended: true, epoch };
}

export async function isOidcSessionActive(db, { sid, userId, authEpoch }) {
  if (!sid || !userId || !Number.isInteger(Number(authEpoch))) return false;
  const r = await db.query(
    `SELECT 1
       FROM oauth_session_state s
       JOIN oauth_user_auth_epochs e ON e.user_id = s.user_id
      WHERE s.sid = $1 AND s.user_id = $2 AND s.revoked_at IS NULL
        AND s.expires_at > now() AND s.auth_epoch = $3 AND e.epoch = $3`,
    [sid, userId, Number(authEpoch)],
  );
  return r.rows.length === 1;
}

export async function verifyAccessToken(db, token) {
  if (!token) throw oauthError('invalid_token', 'access token required');
  const decoded = jwt.decode(token, { complete: true });
  const header = decoded?.header;
  const key = header?.kid ? await getKeyByKid(db, header.kid) : null;
  if (!key) throw oauthError('invalid_token', 'unknown signing key');
  let payload;
  try {
    payload = jwt.verify(token, key.publicKey, {
      algorithms: [key.alg], audience: ACCESS_TOKEN_AUDIENCE, issuer: issuer(),
    });
  } catch {
    throw oauthError('invalid_token', 'invalid access token');
  }
  if (!isAccessToken(header, payload)) throw oauthError('invalid_token', 'invalid access token type');
  if (!await isOidcSessionActive(db, {
    sid: payload.sid, userId: payload.sub, authEpoch: payload.auth_epoch,
  })) throw oauthError('invalid_token', 'session expired or revoked');
  return payload;
}

function scopeSet(value) {
  return new Set(String(value || '').split(/\s+/).filter(Boolean));
}

export function brokerExchangeRequestHash({
  subjectToken, childClientId, childJkt, resource, audience, scope,
}) {
  const canonical = JSON.stringify({
    subject_token_hash: sha256(subjectToken),
    child_client_id: childClientId,
    child_jkt: childJkt,
    resource,
    audience,
    scope: [...scopeSet(scope)].sort(),
  });
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}

export async function enrollBrokerInstallation(db, { userId, publicKeyJwk }) {
  const jwk = publicJwk(publicKeyJwk);
  const jkt = jwkThumbprint(jwk);
  const r = await db.query(
    `INSERT INTO oauth_broker_installations (user_id, public_jwk, jkt)
     VALUES ($1,$2::jsonb,$3)
     ON CONFLICT (user_id, jkt) DO UPDATE SET revoked_at = NULL
     RETURNING installation_id, jkt`,
    [userId, JSON.stringify(jwk), jkt],
  );
  return r.rows[0];
}

async function verifyBrokerAssertion(db, {
  assertion,
  userId,
  subjectSid,
  requestHash,
  childClientId,
  childJkt,
  resource,
  scope,
}) {
  const decoded = jwt.decode(assertion, { complete: true });
  const installationId = decoded?.header?.kid;
  if (!installationId || decoded.header.alg !== 'ES256' || decoded.header.typ !== 'xeno-broker+jwt') {
    throw oauthError('invalid_grant', 'invalid broker assertion header');
  }
  const r = await db.query(
    `SELECT installation_id, user_id, public_jwk, jkt
       FROM oauth_broker_installations
      WHERE installation_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [installationId, userId],
  );
  const installation = r.rows[0];
  if (!installation) throw oauthError('invalid_grant', 'unknown broker installation');
  let claims;
  try {
    claims = jwt.verify(
      assertion,
      crypto.createPublicKey({ key: installation.public_jwk, format: 'jwk' }),
      { algorithms: ['ES256'], audience: `${issuer()}/api/oauth2/token`, issuer: 'xeno-hub-broker', maxAge: '30s' },
    );
  } catch {
    throw oauthError('invalid_grant', 'invalid broker assertion');
  }
  const now = Math.floor(Date.now() / 1000);
  const expectedScope = [...scopeSet(scope)].sort().join(' ');
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
      || claims.iat > now + 60 || claims.exp <= now || claims.exp - claims.iat > 30
      || claims.sub !== userId || claims.subject_sid !== subjectSid
      || claims.installation_id !== installationId || claims.request_hash !== requestHash
      || claims.child_client_id !== childClientId || claims.package_identity !== childClientId
      || claims.child_jkt !== childJkt || claims.resource !== resource
      || [...scopeSet(claims.scope)].sort().join(' ') !== expectedScope
      || !claims.jti) {
    throw oauthError('invalid_grant', 'broker assertion binding mismatch');
  }
  try {
    await db.query('DELETE FROM oauth_broker_assertion_replays WHERE expires_at <= now()');
    await db.query(
      `INSERT INTO oauth_broker_assertion_replays (installation_id, jti, expires_at)
       VALUES ($1,$2, to_timestamp($3))`,
      [installationId, claims.jti, claims.exp],
    );
  } catch (error) {
    if (error?.code === '23505') throw oauthError('invalid_grant', 'broker assertion replayed');
    throw error;
  }
  return installation;
}

export async function tokenExchangeGrant(db, {
  subjectToken,
  subjectPayload,
  hubDpopJkt,
  subjectTokenType,
  requestedTokenType,
  resource,
  audience,
  scope,
  childClientId,
  childPublicJwk,
  brokerAssertion,
}) {
  if (subjectTokenType !== 'urn:ietf:params:oauth:token-type:access_token'
      || requestedTokenType !== 'urn:ietf:params:oauth:token-type:access_token') {
    throw oauthError('invalid_request', 'unsupported token type');
  }
  if (resource !== 'https://api.xenostudio.ai' || audience !== ACCESS_TOKEN_AUDIENCE) {
    throw oauthError('invalid_target', 'unsupported resource or audience');
  }
  if (subjectPayload.client_id !== 'xeno-hub' || subjectPayload.cnf?.jkt !== hubDpopJkt
      || !scopeSet(subjectPayload.scope).has('broker:exchange')) {
    throw oauthError('unauthorized_client', 'Hub broker exchange authority required');
  }
  const childJwk = publicJwk(childPublicJwk);
  const childJkt = jwkThumbprint(childJwk);
  const policyScopes = scopesForClient(childClientId);
  const child = await getClient(db, childClientId);
  if (!child || !policyScopes) throw oauthError('invalid_target', 'unknown child client');
  const permitted = new Set(policyScopes.filter((s) => (child.allowed_scopes || []).includes(s)));
  const requested = [...scopeSet(scope)];
  if (requested.length === 0 || requested.some((s) => !permitted.has(s))) {
    throw oauthError('invalid_scope', 'requested child scope exceeds policy');
  }
  const normalizedScope = [...requested].sort().join(' ');
  const requestHash = brokerExchangeRequestHash({
    subjectToken, childClientId, childJkt, resource, audience, scope: normalizedScope,
  });
  const installation = await verifyBrokerAssertion(db, {
    assertion: brokerAssertion,
    userId: subjectPayload.sub,
    subjectSid: subjectPayload.sid,
    requestHash,
    childClientId,
    childJkt,
    resource,
    scope: normalizedScope,
  });
  const key = await getSigningKey(db);
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = Math.min(120, Number(subjectPayload.exp) - now);
  if (!Number.isInteger(expiresIn) || expiresIn <= 0) throw oauthError('invalid_grant', 'subject token expired');
  const installationHash = crypto.createHash('sha256').update(String(installation.installation_id)).digest('base64url');
  const access = jwt.sign(
    {
      iss: issuer(), iat: now, sub: subjectPayload.sub, aud: ACCESS_TOKEN_AUDIENCE,
      client_id: childClientId, azp: childClientId,
      act: { sub: 'xeno-hub', client_id: 'xeno-hub', installation_id_hash: installationHash },
      scope: normalizedScope, sid: subjectPayload.sid, auth_epoch: subjectPayload.auth_epoch,
      auth_time: subjectPayload.auth_time, typ: ACCESS_TOKEN_TYP, cnf: { jkt: childJkt },
    },
    key.privatePem,
    { algorithm: key.alg, keyid: key.kid, expiresIn, header: { typ: ACCESS_TOKEN_TYP, kid: key.kid } },
  );
  return {
    access_token: access,
    issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    token_type: 'DPoP',
    expires_in: expiresIn,
    scope: normalizedScope,
  };
}

/**
 * Introspect a token (RFC 7662) — the phantom-token edge-validation surface
 * (Arch §2.4). Returns {active:false} for anything invalid/expired/revoked.
 */
export async function introspectToken(db, { token }) {
  if (!token) return { active: false };
  // Try as a signed access token (ES256 or RS256), verified by kid. Fail CLOSED on
  // token type: an ID token and a back-channel logout token are signed by the same
  // key, so without `isAccessToken` this endpoint reported them as an active
  // `access_token` — a phantom-token edge validator would then admit them.
  try {
    const header = jwt.decode(token, { complete: true })?.header;
    const key = header?.kid ? await getKeyByKid(db, header.kid) : null;
    if (key) {
      const p = jwt.verify(token, key.publicKey, { algorithms: [key.alg] });
      if (isAccessToken(header, p)) {
        if (!await isOidcSessionActive(db, { sid: p.sid, userId: p.sub, authEpoch: p.auth_epoch })) {
          return { active: false };
        }
        return { active: true, token_type: 'access_token', sub: p.sub, scope: p.scope, client_id: p.client_id, aud: p.aud, sid: p.sid, exp: p.exp, iss: p.iss };
      }
      return { active: false };
    }
  } catch { /* not a valid access JWT — fall through */ }
  // Else try as an opaque refresh token.
  const r = await db.query(
    `SELECT rt.*, s.auth_epoch, s.revoked_at AS session_revoked_at, s.expires_at AS session_expires_at,
            e.epoch AS current_auth_epoch
       FROM oauth_refresh_tokens rt
       LEFT JOIN oauth_session_state s ON s.sid = rt.sid AND s.user_id = rt.user_id
       LEFT JOIN oauth_user_auth_epochs e ON e.user_id = rt.user_id
      WHERE rt.token_hash = $1`,
    [sha256(token)],
  );
  const row = r.rows[0];
  if (!row || row.revoked || row.rotated || row.session_revoked_at
      || new Date(row.expires_at).getTime() < Date.now()
      || !row.session_expires_at || new Date(row.session_expires_at).getTime() < Date.now()
      || Number(row.auth_epoch) !== Number(row.current_auth_epoch)) return { active: false };
  return { active: true, token_type: 'refresh_token', sub: row.user_id, scope: row.scope, client_id: row.client_id, sid: row.sid };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function rand4() {
  const A = 'BCDFGHJKLMNPQRSTVWXZ23456789';
  let s = '';
  for (let i = 0; i < 4; i += 1) s += A[crypto.randomInt(A.length)];
  return s;
}

export function oauthError(error, description) {
  const e = new Error(description || error);
  e.oauthError = error;
  e.statusCode = error === 'invalid_client' ? 401 : 400;
  return e;
}
