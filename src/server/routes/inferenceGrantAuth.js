/**
 * Shared service-token + TLS gate for the grant-exchange surfaces.
 * INFERENCE_GRANT_TOKEN, fail-closed, constant-time. Not the ledger token.
 */
import crypto from 'node:crypto';

export function unauthorized(res) {
  return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
}

export function requireGrantToken(req, res, next) {
  const expected = process.env.INFERENCE_GRANT_TOKEN;
  if (!expected) return unauthorized(res);

  const header = req.headers.authorization || '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return unauthorized(res);
  const presented = header.slice(prefix.length);
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return unauthorized(res);
  if (!crypto.timingSafeEqual(a, b)) return unauthorized(res);
  return next();
}

export function requireTls(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  if (proto !== 'https') {
    return res.status(400).json({ error: { code: 'tls_required', message: 'grant exchange requires TLS' } });
  }
  return next();
}

export function sendGrantError(res, err) {
  const http = err && err.http ? err.http : 500;
  const code = (err && err.code) || 'PLATFORM_ERROR';
  const message = http === 500 ? 'grant exchange failed' : (err && err.message) || 'request failed';
  if (http === 500) console.error('[inference-grant] unhandled');
  return res.status(http).json({ error: { code, message } });
}
