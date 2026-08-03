/**
 * Per-Endpoint Rate Limiting Middleware
 *
 * Different rate limits for different endpoint categories:
 * - Auth endpoints: strict (prevent brute force)
 * - LLM/AI proxy: per-user credit-based + IP fallback
 * - API general: moderate
 *
 * ── RULE: every limiter exported from this file MUST be mounted somewhere ──────
 * An exported-but-unmounted rate limiter is not a security control, it is a
 * decoy: it reads as protection in review while enforcing nothing. Four used to
 * live here (authLimiter, staticLimiter, apiLimiter, webhookLimiter) with ZERO
 * import sites; they have been deleted rather than mounted (see the note at the
 * bottom of this file for the per-limiter reasoning). If you add a limiter here,
 * mount it in the same commit. Enforced by tests/route-mounting.test.mjs.
 *
 * ── RULE: every limiter MUST set an explicit keyGenerator ─────────────────────
 * express-rate-limit's DEFAULT key is `req.ip`. This app sits behind
 * CF edge → cloudflared → nginx, nginx APPENDS to X-Forwarded-For, and
 * `trust proxy = 1` therefore resolves req.ip to the CONSTANT loopback hop.
 * A limiter that takes the default key is not "per IP" here — it is ONE GLOBAL
 * BUCKET shared by every visitor on earth, i.e. a trivially triggerable
 * platform-wide outage of whatever it protects. Always pass
 * `keyGenerator: <something built on clientIp()>` + `validate: { ip: false }`.
 */

import rateLimit from 'express-rate-limit';

// --------------------------------------------------------------------------
// Helper: normalize IP for IPv6 compatibility
// --------------------------------------------------------------------------
// The platform sits behind Cloudflare (CF edge → cloudflared → nginx → app). nginx uses
// `$proxy_add_x_forwarded_for` (APPEND), and with `trust proxy = 1` Express resolves
// req.ip to a CONSTANT upstream hop (the cloudflared/nginx peer) rather than the client —
// which would collapse every IP-keyed limiter into ONE shared global bucket (a trivially
// triggerable, platform-wide auth/login DoS). CF sets `CF-Connecting-IP` to the true client
// IP at its edge and OVERWRITES any client-supplied value, and neither cloudflared nor nginx
// rewrite it — so it is the unspoofable, per-client key. Prefer it; fall back to req.ip only
// for non-CF/direct traffic (which on this box only arrives via the tunnel anyway).
export function clientIp(req) {
  let ip = req.headers['cf-connecting-ip']
    || (req.headers['x-real-ip'])
    || req.ip
    || req.connection?.remoteAddress
    || 'unknown';
  if (Array.isArray(ip)) ip = ip[0];
  if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
  // Collapse IPv6-mapped IPv4 (::ffff:127.0.0.1 -> 127.0.0.1)
  if (typeof ip === 'string' && ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip || 'unknown';
}

function normalizeIp(req) {
  return clientIp(req);
}

// --------------------------------------------------------------------------
// 1. Account-email limiter — token-minting / mail-sending endpoints
// --------------------------------------------------------------------------
// Mounted in index.js on /api/auth/forgot-password and /api/auth/resend-verification.
// These are the endpoints that MINT a single-use account token and SEND mail to an
// address the caller merely names, so the abuse is inbox flooding + mail-reputation
// burn, not credential guessing. 3/hour sits on top of (not instead of) the 10-per-
// 15-min auth limiter already covering the whole /api/auth surface.
//
// NOT mounted on /api/auth/reset-password: that endpoint CONSUMES a 256-bit
// single-use token (routes/authRoutes.js newAccountToken → randomBytes(32)) which is
// atomically claimed, so guessing is infeasible and the 10-per-15-min limiter is the
// right cap. A 3/hour cap there would lock a legitimate user out of their own reset
// after three rejections by the password-policy check.
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  message: {
    success: false,
    error: 'Too many password reset attempts. Please try again in 1 hour.',
    retryAfter: 3600,
  },
  // MUST be explicit — the default req.ip key collapses to one global bucket behind
  // this proxy chain, which would make 3 requests/hour a platform-wide password-reset
  // outage for every user at once. See the header note.
  keyGenerator: (req) => `pwreset:${normalizeIp(req)}`,
});

// --------------------------------------------------------------------------
// 2. LLM / AI generation rate limiter — per-user (by JWT userId)
// --------------------------------------------------------------------------
export const llmLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 generation requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  message: {
    success: false,
    error: 'Generation rate limit exceeded. Please wait before trying again.',
    retryAfter: 60,
  },
  keyGenerator: (req) => {
    const userId = req.user?.id; // never the spoofable x-user-id header
    return userId ? `llm:user:${userId}` : `llm:ip:${normalizeIp(req)}`;
  },
});

// Image generation — more expensive, tighter limit
export const imageGenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  message: {
    success: false,
    error: 'Image generation rate limit exceeded. Please wait before trying again.',
    retryAfter: 60,
  },
  keyGenerator: (req) => {
    const userId = req.user?.id; // never the spoofable x-user-id header
    return userId ? `imggen:user:${userId}` : `imggen:ip:${normalizeIp(req)}`;
  },
});

// Video generation — very expensive
export const videoGenLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  message: {
    success: false,
    error: 'Video generation rate limit exceeded. Please wait before trying again.',
    retryAfter: 300,
  },
  keyGenerator: (req) => {
    const userId = req.user?.id; // never the spoofable x-user-id header
    return userId ? `vidgen:user:${userId}` : `vidgen:ip:${normalizeIp(req)}`;
  },
});

// --------------------------------------------------------------------------
// 3. Upload rate limiter — prevent abuse of file upload
// --------------------------------------------------------------------------
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  message: {
    success: false,
    error: 'Too many uploads. Please wait before uploading more files.',
    retryAfter: 600,
  },
  // Per-user when authed, else per-client IP (CF-Connecting-IP) — never the
  // collapsed proxy hop (which would be ONE shared global bucket).
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId ? `upload:user:${userId}` : `upload:ip:${normalizeIp(req)}`;
  },
});

// NOTE: no default export. The aggregate `export default { ...allLimiters }` this file
// used to carry had no import site either, and it defeated the whole point of the
// unmounted-limiter check — a limiter reachable only through a bag nobody opens still
// looks "used" to a naive grep. Named exports only, every one of them imported.

// ── DELETED LIMITERS — do not re-add without reading this ─────────────────────
// Four limiters were exported from this file with ZERO import sites anywhere in
// src/server. Each was reviewed and DELETED rather than mounted:
//
// • authLimiter — keyed `auth:<ip>:<email>`, 10 per 15 min. Strictly DOMINATED by
//   the IP-only auth limiter already mounted in index.js on the same seven
//   /api/auth/* paths: for any fixed IP, count(ip,email) <= count(ip), so a
//   per-(ip,email) bucket can never trip before the per-ip bucket it sits behind.
//   Adding the email to the key SUBDIVIDES the budget — it makes the limit looser
//   (an attacker stuffing many emails from one IP gets a fresh 10 per email),
//   not tighter. Mounting it would have been pure ceremony.
//   The genuine gap it did NOT cover is an ACCOUNT-targeted limiter (keyed on
//   email alone) to blunt distributed password spraying against one user. That is
//   a real control worth adding, but it is a new design (it introduces a
//   victim-lockout DoS that needs handling), not a re-mount of this one.
//
// • staticLimiter — 300/min for "static content". Express serves no rate-limitable
//   static surface here (nginx + Cloudflare front all of it), and the limiter took
//   the default req.ip key, so mounting it would have been one global bucket.
//
// • apiLimiter — 200/min. A duplicate of the `globalLimiter` already mounted on
//   '/api/' in index.js, with the same window and max but WITHOUT the clientIp
//   keyGenerator. Mounting it would have added a collapsed global 200/min cap on
//   top of a working per-client one.
//
// • webhookLimiter — 100/min, default key. /api/webhooks already sits under the
//   mounted '/api/' globalLimiter. A collapsed global 100/min bucket in front of
//   webhook delivery drops other tenants' legitimate deliveries once any single
//   caller is noisy.
