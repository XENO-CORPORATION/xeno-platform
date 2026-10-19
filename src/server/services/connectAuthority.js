/**
 * XENO Connect — the Platform half of its authority seam (xeno-connect/docs/STORAGE-HANDOFF.md §1).
 *
 * Connect VERIFIES, it never issues. Platform owns three things here:
 *   1. The `xeno-connect` audience: a short ES256 `at+jwt`, DPoP-bound (`cnf.jkt`), minted ONLY by RFC 8693 exchange of
 *      the client's own DPoP-bound `xeno-api` token. Never accepted where `xeno-api` is required, and the reverse.
 *   2. resolveVerifiedToken: the LIVE authority behind such a token for one workspace — principal kind (owner-capped,
 *      via resolvePrincipal), workspace membership (relationship_tuples), the client ceiling, a stable consumerId and
 *      an expiry that never outlives the token. No fallback to a personal workspace: the workspace is named or refused.
 *   3. resolveBrowserCallback: the live authority of the PERSON who started a link, re-checked when Google redirects.
 *
 * Authority is derived at read time on every call, so a suspension, a removed membership or an ended sign-in session
 * takes effect on the next Connect request without anything having to remember to propagate it.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { issuer } from '../config/hosts.js';
import {
  CONNECT_HUMAN_ONLY_SCOPES, CONNECT_SCOPES, CONNECT_WEB_CONSUMER, connectAuthorityForClient,
} from '../config/oidcAuthorityPolicy.js';
import {
  ACCESS_TOKEN_TYP, getKeyByKid, getSigningKey, isOidcSessionActive, oauthError,
} from '../utils/oidcProvider.js';
import { resolvePrincipal } from './agentIdentity.js';
import { isWorkspaceMember } from '../utils/workspaceContext.js';

export const CONNECT_AUDIENCE = 'xeno-connect';
export const CONNECT_TOKEN_MAX_SECONDS = 300;
// A browser callback authority only has to outlive the redirect it is checked for.
export const CONNECT_CALLBACK_SECONDS = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Connect origins a token may be minted for. Unset → none: the exchange fails closed rather than guess a host. */
export function connectResources(env = process.env) {
  return String(env.XENO_CONNECT_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
    .filter((o) => { try { const u = new URL(o); return u.protocol === 'https:' && u.origin === o; } catch { return false; } });
}

function scopeList(value) {
  return [...new Set(String(value || '').split(/\s+/).filter(Boolean))];
}

/**
 * RFC 8693: a DPoP-bound `xeno-api` token (already verified, with a DPoP proof whose key IS its cnf.jkt) becomes a
 * `xeno-connect` token for the same person, client and key. The caller has verified both; this enforces the rest.
 */
export async function connectExchangeGrant(db, {
  subjectPayload, proofJkt, subjectTokenType, requestedTokenType, resource, audience, scope, env = process.env,
}) {
  if (subjectTokenType !== 'urn:ietf:params:oauth:token-type:access_token'
      || requestedTokenType !== 'urn:ietf:params:oauth:token-type:access_token') {
    throw oauthError('invalid_request', 'unsupported token type');
  }
  if (audience !== CONNECT_AUDIENCE || !connectResources(env).includes(resource)) {
    throw oauthError('invalid_target', 'unsupported resource or audience');
  }
  // Sender-constrained in, sender-constrained out: an unbound subject could be replayed by anyone holding it.
  if (!subjectPayload.cnf?.jkt || subjectPayload.cnf.jkt !== proofJkt) {
    throw oauthError('invalid_grant', 'a DPoP-bound subject token is required');
  }
  // The website consumer is minted in-process for a website session (services/webConnect.js), never exchanged:
  // an OIDC client that happened to be registered under that id must not borrow its ceiling.
  if (subjectPayload.client_id === CONNECT_WEB_CONSUMER) throw oauthError('unauthorized_client', 'this client may not reach XENO Connect');
  const ceiling = connectAuthorityForClient(subjectPayload.client_id);
  if (!ceiling) throw oauthError('unauthorized_client', 'this client may not reach XENO Connect');
  const requested = scopeList(scope);
  if (requested.length === 0 || requested.some((s) => !ceiling.scopes.includes(s))) {
    throw oauthError('invalid_scope', 'requested scope exceeds the client ceiling');
  }
  const principal = await resolvePrincipal(db, subjectPayload.sub);
  if (!principal?.usable) throw oauthError('invalid_grant', 'account is not usable');
  if (principal.kind !== 'human' && requested.some((s) => CONNECT_HUMAN_ONLY_SCOPES.includes(s))) {
    throw oauthError('invalid_scope', 'connect:manage is for people only');
  }
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = Math.min(CONNECT_TOKEN_MAX_SECONDS, Number(subjectPayload.exp) - now);
  if (!Number.isInteger(expiresIn) || expiresIn <= 0) throw oauthError('invalid_grant', 'subject token expired');
  const normalized = requested.sort().join(' ');
  const key = await getSigningKey(db);
  const access = jwt.sign(
    {
      iss: issuer(), iat: now, sub: subjectPayload.sub, aud: CONNECT_AUDIENCE,
      client_id: subjectPayload.client_id, azp: subjectPayload.client_id, scope: normalized,
      sid: subjectPayload.sid, auth_epoch: subjectPayload.auth_epoch, auth_time: subjectPayload.auth_time,
      typ: ACCESS_TOKEN_TYP, cnf: { jkt: proofJkt }, jti: crypto.randomUUID(),
    },
    key.privatePem,
    { algorithm: key.alg, keyid: key.kid, expiresIn, header: { typ: ACCESS_TOKEN_TYP, kid: key.kid } },
  );
  return {
    access_token: access,
    issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    token_type: 'DPoP',
    expires_in: expiresIn,
    scope: normalized,
  };
}

/** Verify a `xeno-connect` token and that its sign-in session is still live. Throws invalid_token otherwise. */
export async function verifyConnectAccessToken(db, token) {
  const decoded = jwt.decode(String(token || ''), { complete: true });
  const key = decoded?.header?.kid ? await getKeyByKid(db, decoded.header.kid) : null;
  if (!key) throw oauthError('invalid_token', 'unknown signing key');
  let payload;
  try {
    payload = jwt.verify(token, key.publicKey, { algorithms: ['ES256'], audience: CONNECT_AUDIENCE, issuer: issuer() });
  } catch { throw oauthError('invalid_token', 'invalid access token'); }
  // isAccessToken() is pinned to xeno-api on purpose; this is its xeno-connect twin (RFC 9068, header AND payload).
  if (payload.aud !== CONNECT_AUDIENCE || payload.events !== undefined || payload.typ !== ACCESS_TOKEN_TYP
      || decoded.header.typ !== ACCESS_TOKEN_TYP || !payload.cnf?.jkt) {
    throw oauthError('invalid_token', 'invalid access token type');
  }
  // A website token's liveness is its WEBSITE session (user_sessions + browser_session_state), not an OIDC session:
  // signing out of the site, or the session expiring, ends Connect access on the next request.
  const live = payload.client_id === CONNECT_WEB_CONSUMER
    ? payload.xeno_session === 'web' && await isWebSessionActive(db, { sid: payload.sid, userId: payload.sub })
    : payload.xeno_session === undefined
      && await isOidcSessionActive(db, { sid: payload.sid, userId: payload.sub, authEpoch: payload.auth_epoch });
  if (!live) throw oauthError('invalid_token', 'session expired or revoked');
  return payload;
}

/** A website (cookie) session is live: the row exists, is unexpired, and is a standard browser session. */
export async function isWebSessionActive(db, { sid, userId }) {
  if (!UUID_RE.test(String(sid || '')) || !UUID_RE.test(String(userId || ''))) return false;
  const r = await db.query(`SELECT 1 FROM user_sessions us JOIN browser_session_state bss ON bss.sid = us.id
    WHERE us.id = $1 AND us.user_id = $2 AND us.expires_at > now() AND bss.purpose = 'standard'`, [sid, userId]);
  return r.rows.length === 1;
}

class ConnectAuthorityError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

async function liveAuthority(db, { userId, workspaceId, clientId, scopes, expiresAtMs }) {
  if (!UUID_RE.test(String(workspaceId || ''))) throw new ConnectAuthorityError('workspace_required', 400);
  const ceiling = connectAuthorityForClient(clientId);
  if (!ceiling) throw new ConnectAuthorityError('client_not_permitted', 403);
  const principal = await resolvePrincipal(db, userId);
  if (!principal) throw new ConnectAuthorityError('unknown_principal', 403);
  const membershipActive = await isWorkspaceMember(db, workspaceId, userId);
  const granted = scopes.filter((s) => ceiling.scopes.includes(s)
    && (principal.kind === 'human' || !CONNECT_HUMAN_ONLY_SCOPES.includes(s)));
  return {
    workspaceId,
    principalId: principal.id,
    principalKind: principal.kind,
    consumerId: clientId,
    active: principal.usable,
    membershipActive,
    authorityExpiresAt: expiresAtMs,
    operations: principal.usable && membershipActive ? ceiling.operations : [],
    scopes: principal.usable && membershipActive ? granted : [],
  };
}

/** resolveVerifiedToken's server half: Connect sends the token it verified and the workspace from its path. */
export async function authorityForToken(db, { token, workspaceId }) {
  let payload;
  try { payload = await verifyConnectAccessToken(db, token); } catch { throw new ConnectAuthorityError('invalid_token', 401); }
  return liveAuthority(db, {
    userId: payload.sub, workspaceId, clientId: payload.client_id,
    scopes: scopeList(payload.scope).filter((s) => CONNECT_SCOPES.includes(s)),
    expiresAtMs: Number(payload.exp) * 1000,
  });
}

/** resolveBrowserCallback's server half: the person who started the link, checked live, for the redirect only. */
export async function authorityForCallback(db, { principalId, workspaceId, consumerId }) {
  if (!UUID_RE.test(String(principalId || ''))) throw new ConnectAuthorityError('principal_required', 400);
  const a = await liveAuthority(db, {
    userId: principalId, workspaceId, clientId: consumerId, scopes: ['connect:manage'],
    expiresAtMs: Date.now() + CONNECT_CALLBACK_SECONDS * 1000,
  });
  // Linking is management; only a person may complete it, whatever the ceiling says.
  if (a.principalKind !== 'human') return { ...a, scopes: [], operations: [] };
  return a;
}

export { ConnectAuthorityError };
