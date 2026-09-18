/**
 * View tokens: a short-lived, path-scoped grant to read ONE artifact's raw
 * revision files. The viewer iframe runs as an opaque origin (CSP `sandbox`
 * with no allow-same-origin), so it cannot rely on the account cookie —
 * and a link pasted from the CLI must open with no cookie at all. The token
 * is what carries authority to the raw files; it names the artifact, so a
 * token for one page cannot fetch another.
 *
 * HMAC-SHA256 over `artifactId.revision.expiry` with the platform's JWT
 * secret — the same key the browser session bearer uses, so rotating one
 * rotates both. Not a JWT: nothing here needs headers, algorithms or claims.
 */
import crypto from 'crypto';

const SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const DEFAULT_TTL_SECONDS = 3600;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function signature(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest();
}

export function mintViewToken({ artifactId, revision, ttlSeconds = DEFAULT_TTL_SECONDS, now = Date.now() }) {
  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const payload = `${artifactId}.${revision}.${expiresAt}`;
  return `v1.${b64url(payload)}.${b64url(signature(payload))}`;
}

/** Returns { artifactId, revision, expiresAt } or null. Never throws. */
export function verifyViewToken(token, { now = Date.now() } = {}) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  let payload;
  try {
    payload = Buffer.from(parts[1], 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = signature(payload);
  let presented;
  try {
    presented = Buffer.from(parts[2], 'base64url');
  } catch {
    return null;
  }
  if (presented.length !== expected.length || !crypto.timingSafeEqual(presented, expected)) return null;
  const [artifactId, revisionText, expiresText] = payload.split('.');
  const revision = Number.parseInt(revisionText, 10);
  const expiresAt = Number.parseInt(expiresText, 10);
  if (!artifactId || !Number.isInteger(revision) || !Number.isInteger(expiresAt)) return null;
  if (expiresAt * 1000 <= now) return null;
  return { artifactId, revision, expiresAt };
}
