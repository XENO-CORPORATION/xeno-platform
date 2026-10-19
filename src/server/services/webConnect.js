/**
 * XENO Connect for the WEBSITE's Storage ("Connected clouds") — the backend-for-frontend half.
 *
 * DESIGN
 *   The browser never holds a Google token (Connect owns that, always) and never holds a Connect token either.
 *   The website session is an opaque HttpOnly cookie (middleware/browserSession.js); this module turns a LIVE website
 *   session into a short `xeno-connect` token, entirely inside the backend, and calls Connect on the person's behalf.
 *
 *   - Consumer: `xeno-web-storage` (config/oidcAuthorityPolicy.js CONNECT_WEB_CONSUMER) — its own ceiling and its own
 *     Connect audit trail, distinct from the desktop `xeno-storage`. Connect admits Consumer rows from verified
 *     authority (xeno-connect apps/service/src/runtime.ts `admit`), so nothing is registered there by hand.
 *   - Minting, not exchange: Platform IS the issuer, so the token is signed here with the same key, audience, `typ` and
 *     ≤300 s lifetime as connectExchangeGrant. It carries `sid` + `xeno_session: 'web'`, and verifyConnectAccessToken
 *     checks THAT session (user_sessions + browser_session_state) on every Connect request — sign-out ends access.
 *     RFC 8693 exchange can never yield this consumer (connectExchangeGrant refuses it).
 *   - Sender constraint: one ES256 DPoP key per backend process, generated at start, held only in memory, never
 *     logged or returned. Every Connect call carries a fresh proof (htm, htu, iat, jti, ath). A restart rotates it.
 *   - Only a COOKIE session may mint (req.browserSession, same sid as the resolved auth). A bearer token, CLI login or
 *     API key reaching this route is refused: they have their own clients and ceilings.
 *   - The workspace is always named by the caller and checked for membership here; there is no personal fallback.
 *     connect:manage only for people (agents have no website session, and resolvePrincipal is checked anyway).
 *   - Linking uses Connect's `browser-start` delivery. `direct` sets `__Host-connect-link` on the response to the
 *     party that POSTs — here, this backend — and a __Host- cookie is host-only, so it could never reach the browser.
 *     browser-start hands back a one-use URL ON Connect's origin; the browser navigates there and Connect sets the
 *     binding cookie on its own host, then 303s to Google and finally to /account/connected.
 *
 * THREATS
 *   stolen browser JS / XSS — no token to steal; CSRF on mutations is the cookie middleware's double-submit check.
 *   token leak from the backend — ≤300 s, DPoP-bound to a key that never leaves the process, session-bound.
 *   path confusion — only the closed list of Connect paths below is proxied; ids are [A-Za-z0-9_-]; no redirects.
 *   Connect cookies / headers — never forwarded to the browser (only status, JSON body and range headers).
 *   grant expiry — on 410 EXPIRED: PUT grants/self {} ONCE, then repeat with the SAME Idempotency-Key. 403 is final.
 *   Library writes — none. A future Drive→XENO copy must enter through registerManagedLibraryFile (scan + allowance).
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { issuer } from '../config/hosts.js';
import { CONNECT_HUMAN_ONLY_SCOPES, CONNECT_SCOPES, CONNECT_WEB_CONSUMER } from '../config/oidcAuthorityPolicy.js';
import { ACCESS_TOKEN_TYP, getSigningKey } from '../utils/oidcProvider.js';
import { jwkThumbprint } from '../utils/dpop.js';
import { resolvePrincipal } from './agentIdentity.js';
import { isWorkspaceMember } from '../utils/workspaceContext.js';
import { CONNECT_AUDIENCE, CONNECT_TOKEN_MAX_SECONDS, connectResources, isWebSessionActive } from './connectAuthority.js';

const ID = /^[A-Za-z0-9_-]{1,256}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const WEB_OPERATIONS = Object.freeze(['drive.files.list', 'drive.files.stat', 'drive.quota.read', 'drive.files.create',
  'drive.files.rename', 'drive.files.move', 'drive.files.trash', 'drive.files.restore']);

export class WebConnectError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } }

let processKey = null;
/** The process DPoP key. Private half never leaves this closure. */
export function dpopKey() {
  if (!processKey) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const pub = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
    processKey = { privateKey, pub, jkt: jwkThumbprint(pub) };
  }
  return processKey;
}

export function dpopProof(method, url, accessToken, key = dpopKey()) {
  const htu = new URL(url); htu.search = ''; htu.hash = '';
  return jwt.sign({ htm: method.toUpperCase(), htu: htu.href, iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID(),
    ath: crypto.createHash('sha256').update(accessToken).digest('base64url') },
  key.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', alg: 'ES256', jwk: key.pub } });
}

/** Website session → the session's identity, or a refusal. Only a cookie session qualifies. */
export function webSessionOf(req) {
  const s = req.browserSession;
  if (!s || !req.user || !s.sid || s.userId !== req.user.id || req.auth?.sid !== s.sid) {
    throw new WebConnectError('website_session_required', 401);
  }
  return { sid: s.sid, userId: s.userId };
}

const cache = new Map();
/** A short xeno-connect token for this website session, cached until 30 s before it expires. */
export async function mintWebConnectToken(db, { sid, userId }, { key = dpopKey(), now = Date.now() } = {}) {
  const hit = cache.get(sid);
  if (hit && hit.userId === userId && hit.jkt === key.jkt && hit.exp * 1000 - 30000 > now) return hit.token;
  if (!await isWebSessionActive(db, { sid, userId })) throw new WebConnectError('website_session_required', 401);
  const principal = await resolvePrincipal(db, userId);
  if (!principal?.usable) throw new WebConnectError('account_not_usable', 403);
  const scopes = CONNECT_SCOPES.filter((s) => principal.kind === 'human' || !CONNECT_HUMAN_ONLY_SCOPES.includes(s));
  const iat = Math.floor(now / 1000); const exp = iat + CONNECT_TOKEN_MAX_SECONDS;
  const signing = await getSigningKey(db);
  const token = jwt.sign({
    iss: issuer(), iat, exp, sub: userId, aud: CONNECT_AUDIENCE, client_id: CONNECT_WEB_CONSUMER, azp: CONNECT_WEB_CONSUMER,
    scope: [...scopes].sort().join(' '), sid, xeno_session: 'web', typ: ACCESS_TOKEN_TYP, cnf: { jkt: key.jkt }, jti: crypto.randomUUID(),
  }, signing.privatePem, { algorithm: signing.alg, keyid: signing.kid, header: { typ: ACCESS_TOKEN_TYP, kid: signing.kid } });
  cache.set(sid, { token, exp, userId, jkt: key.jkt });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return token;
}
export function forgetWebConnectTokens() { cache.clear(); }

/** The one Connect origin this backend talks to. Unset → not configured (fails closed). */
export function connectOrigin(env = process.env) {
  const raw = String(env.XENO_WEB_CONNECT_ORIGIN || connectResources(env)[0] || '').trim();
  try {
    const u = new URL(raw);
    if (u.origin !== raw) return null;
    // https anywhere; plain http only on literal loopback (local stand-ins).
    if (u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname))) return u.origin;
  } catch { /* unset or malformed */ }
  return null;
}

/**
 * Map a browser request onto ONE Connect path, or refuse. `rest` is the path after /workspaces/<ws>/.
 * Returns { method, path, renewable, connectionId }.
 */
export function routeFor(method, rest) {
  const p = String(rest || '').split('/').filter(Boolean);
  // ids are [A-Za-z0-9_-]; only the operation name segment may carry dots (drive.files.list), never '.' or '..'.
  if (!p.every((x, i) => ID.test(x) || (i === 3 && p[2] === 'operations' && WEB_OPERATIONS.includes(x)))) return null;
  const M = method.toUpperCase();
  const one = (m, ok) => (M === m && ok ? true : null);
  if (p.length === 1 && p[0] === 'providers' && one('GET', true)) return { path: p, renewable: false };
  if (p.length === 1 && p[0] === 'connections' && one('GET', true)) return { path: p, renewable: false };
  if (p[0] === 'link' && p[1] === 'sessions') {
    if (p.length === 2 && M === 'POST') return { path: p, renewable: false, link: true };
    if (p.length === 3 && M === 'GET') return { path: p, renewable: false };
    if (p.length === 4 && p[3] === 'cancel' && M === 'POST') return { path: p, renewable: false };
    return null;
  }
  if (p[0] === 'operations' && p.length === 2 && M === 'GET') return { path: p, renewable: false };
  if (p[0] !== 'connections' || p.length < 3) return null;
  const c = { connectionId: p[1], renewable: true };
  if (p.length === 3 && p[2] === 'revoke' && M === 'POST') return { ...c, path: p, renewable: false };
  if (p.length === 4 && p[2] === 'operations' && WEB_OPERATIONS.includes(p[3]) && M === 'POST') return { ...c, path: p };
  if (p.length === 3 && p[2] === 'content' && M === 'GET') return { ...c, path: p, stream: true };
  if (p.length === 3 && p[2] === 'uploads' && M === 'POST') return { ...c, path: p };
  if (p.length === 5 && p[2] === 'uploads' && ['status', 'finish', 'cancel'].includes(p[4]) && M === 'POST') return { ...c, path: p };
  if (p.length === 5 && p[2] === 'uploads' && p[4] === 'parts' && M === 'PUT') return { ...c, path: p, bytes: true };
  return null;
}

/**
 * One proxied call, with the grant lifecycle. Returns the upstream Response (never followed redirects).
 * `body` is a Buffer (octet-stream) or a JSON value; for link creation delivery is FORCED to browser-start.
 */
export async function callConnect(db, session, { workspaceId, method, rest, query, body, idempotencyKey, range },
  { env = process.env, fetchImpl = globalThis.fetch, key = dpopKey() } = {}) {
  const origin = connectOrigin(env);
  if (!origin) throw new WebConnectError('connect_not_configured', 503);
  if (!UUID.test(String(workspaceId || ''))) throw new WebConnectError('workspace_required', 400);
  if (!await isWorkspaceMember(db, workspaceId, session.userId)) throw new WebConnectError('not_a_member', 403);
  const route = routeFor(method, rest);
  if (!route) throw new WebConnectError('not_found', 404);
  if (idempotencyKey !== undefined && !/^[A-Za-z0-9_-]{16,256}$/.test(String(idempotencyKey))) throw new WebConnectError('bad_idempotency_key', 400);
  let payload = body;
  if (route.link) {
    const appId = body && typeof body === 'object' ? body.providerAppId : null;
    if (!ID.test(String(appId || ''))) throw new WebConnectError('bad_input', 400);
    payload = { providerAppId: appId, delivery: 'browser-start' };
  }
  const base = `/v1/connect/workspaces/${workspaceId}`;
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';
  const send = async (m, path, b, withKey) => {
    const url = new URL(path, origin);
    if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/v1/connect/')) throw new WebConnectError('not_found', 404);
    const token = await mintWebConnectToken(db, session, { key });
    const headers = { authorization: `DPoP ${token}`, dpop: dpopProof(m, url.href, token, key), accept: 'application/json', 'x-xeno-client': 'web-storage/1' };
    if (withKey && idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    if (range) headers.range = range;
    let data;
    if (Buffer.isBuffer(b)) { headers['content-type'] = 'application/octet-stream'; data = b; }
    else if (b !== undefined && m !== 'GET') { headers['content-type'] = 'application/json'; data = JSON.stringify(b); }
    return fetchImpl(url, { method: m, headers, body: data, redirect: 'manual', signal: AbortSignal.timeout(Buffer.isBuffer(b) ? 120000 : 30000) });
  };
  const target = `${base}/${route.path.join('/')}${qs}`;
  const first = await send(method.toUpperCase(), target, payload, true);
  if (!route.renewable || first.status !== 410) return { response: first, route };
  let code = '';
  try { code = (await first.clone().json())?.error?.code || ''; } catch { /* not a Connect refusal */ }
  if (code !== 'EXPIRED') return { response: first, route };
  const renewed = await send('PUT', `${base}/connections/${route.connectionId}/grants/self`, {}, false);
  if (!renewed.ok) return { response: renewed, route, renewed: true };
  return { response: await send(method.toUpperCase(), target, payload, true), route, renewed: true };
}
