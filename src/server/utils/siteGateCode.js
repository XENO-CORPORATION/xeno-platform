/**
 * The site gate's access-code cookie, in one place, because TWO middlewares need it: the page check
 * (routes/siteGateRoutes.js) and the registration gate (middleware/registrationGate.js — an invited
 * person may create an account, the public may not). A second copy of the signature would drift.
 *
 * The cookie is `<prefix>xeno_gate` = `v1.<expiry>.<hmac>`, where the HMAC covers the expiry AND a digest
 * of the current SITE_GATE_CODE. Two consequences, both deliberate:
 *   - rotating SITE_GATE_CODE invalidates every cookie already issued (no separate revocation list);
 *   - the cookie is not an auth token. It opens PAGES and, here, account creation. /api/ still wants a
 *     real account session.
 */
import crypto from 'node:crypto';

export const GATE_DAYS = 7;

/** `__Host-` in production: the cookie then cannot be set from a subdomain and cannot be read by script. */
export const gateCookieName = (env = process.env) => `${env.NODE_ENV === 'production' ? '__Host-' : ''}xeno_gate`;

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

/** Constant-time compare of the configured code against what was typed. Hashing first hides its length. */
export function codeMatches(given, expected) {
  if (!expected) return false;
  return crypto.timingSafeEqual(digest(given), digest(expected));
}

function sign(secret, code, expiresAt) {
  return crypto.createHmac('sha256', secret)
    .update(`v1.${expiresAt}.${digest(code).toString('hex').slice(0, 32)}`)
    .digest('base64url');
}

/** Issue a gate cookie value, or null when no code/secret is configured. */
export function mintGateCookie(code, secret, now = Date.now()) {
  if (!code || !secret) return null;
  const expiresAt = Math.floor(now / 1000) + GATE_DAYS * 86400;
  return `v1.${expiresAt}.${sign(secret, code, expiresAt)}`;
}

/** Is this cookie value one WE issued for the CURRENT code, and not expired? */
export function gateCookieValid(value, code, secret, now = Date.now()) {
  const m = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(String(value || ''));
  if (!m || !code || !secret) return false;
  const expiresAt = Number(m[1]);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= now) return false;
  const expected = sign(secret, code, expiresAt);
  const a = Buffer.from(m[2]); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    if (part.slice(0, i).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return part.slice(i + 1).trim(); }
  }
  return null;
}

/** Did this request arrive holding a valid access-code cookie? False whenever the gate or the code is off. */
export function hasGateInvite(cookieHeader, env = process.env) {
  if (env.SITE_GATE !== 'on') return false;
  const code = String(env.SITE_GATE_CODE || '');
  const secret = env.SITE_GATE_SECRET || env.JWT_SECRET;
  return gateCookieValid(readCookie(cookieHeader, gateCookieName(env)), code, secret);
}
