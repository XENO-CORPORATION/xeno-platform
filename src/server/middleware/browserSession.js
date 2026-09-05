import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const COOKIE_PREFIX = process.env.NODE_ENV === 'production' ? '__Host-' : '';
const SESSION_COOKIE = `${COOKIE_PREFIX}xeno_session`;
const CSRF_COOKIE = `${COOKIE_PREFIX}xeno_csrf`;
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseCookies(header = '') {
  const values = new Map();
  for (const part of String(header).split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try { values.set(key, decodeURIComponent(value)); } catch { values.set(key, value); }
  }
  return values;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function equalText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Resolve the opaque browser cookie and translate it into a short-lived bearer
 * visible only to server middleware. Unsafe cookie-authenticated requests must
 * also prove the double-submit CSRF value.
 */
export function browserSessionMiddleware(pool) {
  return async (req, res, next) => {
    try {
      if (req.headers.authorization) return next();
      const cookies = parseCookies(req.headers.cookie);
      const sessionToken = cookies.get(SESSION_COOKIE);
      if (!sessionToken) return next();

      const { rows } = await pool.query(
        `SELECT us.id AS sid, us.user_id, bss.csrf_hash
           FROM user_sessions us
           JOIN browser_session_state bss ON bss.sid = us.id
          WHERE us.token_hash = $1 AND us.expires_at > NOW()
          LIMIT 1`,
        [digest(sessionToken)],
      );
      if (!rows.length) return next();

      if (!SAFE_METHODS.has(req.method.toUpperCase())) {
        const csrfCookie = cookies.get(CSRF_COOKIE);
        const csrfHeader = req.get('x-xeno-csrf');
        if (!csrfCookie || !csrfHeader || !equalText(csrfCookie, csrfHeader)
            || !equalText(digest(csrfCookie), rows[0].csrf_hash)) {
          return res.status(403).json({ success: false, error: 'CSRF validation failed' });
        }
      }

      // This token never crosses the process boundary. The existing unified
      // auth middleware validates it and checks the same sid is still live.
      req.headers.authorization = `Bearer ${jwt.sign({
        userId: rows[0].user_id,
        sid: rows[0].sid,
      }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '2m' })}`;
      req.browserSession = { sid: rows[0].sid, userId: rows[0].user_id };
      return next();
    } catch (error) {
      console.error('[auth] browser session resolution failed:', error.message);
      return res.status(500).json({ success: false, error: 'Authentication failed' });
    }
  };
}

export const browserSessionCookies = { session: SESSION_COOKIE, csrf: CSRF_COOKIE };
