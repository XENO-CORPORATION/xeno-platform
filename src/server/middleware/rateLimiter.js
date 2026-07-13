/**
 * Per-Endpoint Rate Limiting Middleware
 *
 * Different rate limits for different endpoint categories:
 * - Auth endpoints: strict (prevent brute force)
 * - LLM/AI proxy: per-user credit-based + IP fallback
 * - Static/public pages: lenient
 * - API general: moderate
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
// 1. Auth rate limiter — very strict to prevent credential stuffing
// --------------------------------------------------------------------------
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again in 15 minutes.',
    retryAfter: 900,
  },
  keyGenerator: (req) => {
    const email = req.body?.email || '';
    return `auth:${normalizeIp(req)}:${email}`;
  },
});

// Password reset — even stricter
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many password reset attempts. Please try again in 1 hour.',
    retryAfter: 3600,
  },
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
    const userId = req.user?.id || req.headers['x-user-id'];
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
    const userId = req.user?.id || req.headers['x-user-id'];
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
    const userId = req.user?.id || req.headers['x-user-id'];
    return userId ? `vidgen:user:${userId}` : `vidgen:ip:${normalizeIp(req)}`;
  },
});

// --------------------------------------------------------------------------
// 3. Static pages / public endpoints — lenient
// --------------------------------------------------------------------------
export const staticLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300, // Very generous for static content
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please slow down.',
    retryAfter: 60,
  },
});

// --------------------------------------------------------------------------
// 4. General API rate limiter — moderate default
// --------------------------------------------------------------------------
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please try again later.',
    retryAfter: 60,
  },
  skip: (req) => {
    return req.path === '/api/status' || req.path === '/health' || req.path === '/api/health';
  },
});

// --------------------------------------------------------------------------
// 5. Upload rate limiter — prevent abuse of file upload
// --------------------------------------------------------------------------
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many uploads. Please wait before uploading more files.',
    retryAfter: 600,
  },
});

// --------------------------------------------------------------------------
// 6. Webhook delivery limiter — prevent webhook flood
// --------------------------------------------------------------------------
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Webhook rate limit exceeded.',
    retryAfter: 60,
  },
});

export default {
  authLimiter,
  passwordResetLimiter,
  llmLimiter,
  imageGenLimiter,
  videoGenLimiter,
  staticLimiter,
  apiLimiter,
  uploadLimiter,
  webhookLimiter,
};
