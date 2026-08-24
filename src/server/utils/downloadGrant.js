/**
 * downloadGrant — a short-lived, signed permission to fetch ONE installer.
 *
 * ── WHY A GRANT AT ALL ──────────────────────────────────────────────────────
 *
 * Downloading requires an active paid plan (`canDownload`). Enforcing that on
 * `/product/:slug/download/:os` runs straight into how this app authenticates:
 *
 *   "the app authenticates via `Authorization: Bearer` and sets NO auth cookie"
 *                                              — src/server/middleware/auth.js
 *
 * A download is a plain <a href> navigation. A browser sends cookies on those,
 * never an Authorization header — so that route CANNOT read a session, and no
 * amount of middleware makes it able to. Mounting authMiddleware there would
 * refuse every real customer, which is a broken gate wearing a working one's
 * clothes.
 *
 * So the credential travels in the URL instead, and to be safe in a URL it must
 * be: signed (unforgeable), short-lived (a leaked link dies), and BOUND to the
 * exact artifact (it cannot be widened into a pass for everything).
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 *
 * It is not a session and must never become one. It authorises one product,
 * one OS, one version, for a few minutes. It carries no roles and grants
 * nothing else. Do not extend it into a general bearer token.
 *
 * ⚠️ While the CDN is still public, a grant is a control on OUR door only —
 * the bytes remain reachable by anyone who knows the R2 URL. That is Phase 3
 * (docs/DOWNLOAD-GATE.md), and until it lands do not describe downloads as
 * closed.
 */
import crypto from 'node:crypto';

/** Minutes are plenty: the grant is redeemed by an immediate navigation. */
export const GRANT_TTL_SECONDS = 300;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/**
 * The signing key. Falls back to JWT_SECRET so there is one fewer secret to
 * provision, but NEVER to a literal: index.js already refuses to boot in
 * production without a real JWT_SECRET, so an unset key cannot silently
 * degrade into a guessable one.
 */
function secret() {
  const key = process.env.DOWNLOAD_GRANT_SECRET || process.env.JWT_SECRET;
  if (!key) {
    const e = new Error('download grants are not configured');
    e.code = 'grant_unconfigured';
    throw e;
  }
  return key;
}

/** Everything the signature covers. Order is part of the contract. */
function payloadOf({ userId, slug, os, version, exp }) {
  return [String(userId), slug, os, version || '', String(exp)].join('|');
}

function sign(payload) {
  return b64url(crypto.createHmac('sha256', secret()).update(payload).digest());
}

/** Mint a grant for one artifact. Returns an opaque, URL-safe string. */
export function mintDownloadGrant({ userId, slug, os, version = '', ttlSeconds = GRANT_TTL_SECONDS }) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = b64url(JSON.stringify({ u: String(userId), s: slug, o: os, v: version, e: exp }));
  return `${body}.${sign(payloadOf({ userId, slug, os, version, exp }))}`;
}

/**
 * Verify a grant against the artifact actually being requested.
 *
 * Returns { ok: true, userId } or { ok: false, reason }. Never throws for a bad
 * grant — a malformed one is a refusal, not a 500.
 *
 * 🔴 The binding check is the point. Verifying only the signature would let a
 * grant for a free-to-anyone asset be replayed against a different product or
 * OS, which is how a per-artifact permission quietly becomes a global one.
 */
export function verifyDownloadGrant(grant, { slug, os, version = '' }) {
  if (typeof grant !== 'string' || !grant.includes('.')) return { ok: false, reason: 'malformed' };
  const [body, sig] = grant.split('.', 2);

  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!claims || typeof claims !== 'object') return { ok: false, reason: 'malformed' };

  const expected = sign(payloadOf({
    userId: claims.u, slug: claims.s, os: claims.o, version: claims.v, exp: claims.e,
  }));

  // Constant-time, and length-checked first because timingSafeEqual throws on
  // a length mismatch — which would turn a forged grant into a 500.
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };

  if (!Number.isFinite(claims.e) || claims.e < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  // Bound to THIS artifact, not merely to a valid signature.
  if (claims.s !== slug || claims.o !== os || (claims.v || '') !== (version || '')) {
    return { ok: false, reason: 'wrong_artifact' };
  }
  return { ok: true, userId: claims.u };
}

export default { mintDownloadGrant, verifyDownloadGrant, GRANT_TTL_SECONDS };
