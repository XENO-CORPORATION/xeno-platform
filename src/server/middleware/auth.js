/**
 * Authentication Middleware
 * JWT-based route protection and user context
 */

import jwt from 'jsonwebtoken';
import { getKeyByKid } from '../utils/oidcProvider.js';

const JWT_DEFAULT_SECRET = 'xenostudio-super-secret-jwt-key-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || JWT_DEFAULT_SECRET;
// SECURITY: never run on a missing/committed-default signing secret in production — with
// it, anyone can forge an HS256 token for ANY user. Fail fast instead of just warning.
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || JWT_SECRET === JWT_DEFAULT_SECRET)) {
  console.error('FATAL: JWT_SECRET is unset or equals the committed default in production. Refusing to boot. Set a strong JWT_SECRET.');
  process.exit(1);
}

/**
 * Unified token resolution for EVERY authed surface (the single source of truth
 * shared by authMiddleware and the v2 oidcAuth). Accepts BOTH:
 *   - the legacy HS256 platform token (payload.userId), and
 *   - OIDC access tokens (RS256/ES256, payload.sub) verified against the signing
 *     key for their `kid`.
 * so an OIDC-signed-in user works on ALL routes, not only /api/v2/*. `algorithms`
 * is pinned per branch (defends against alg-confusion; the old global verify
 * accepted any algorithm). Header-only by design — the app authenticates via
 * `Authorization: Bearer` and sets NO auth cookie.
 * @returns {{ user: object } | { status: number, error: string }}
 */
export async function resolveAuthedUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return { status: 401, error: 'Authentication token required' };

  let userId = null;
  let sid = null;
  const header = jwt.decode(token, { complete: true })?.header;
  if (header && header.alg !== 'HS256' && header.kid) {
    const key = await getKeyByKid(req.db, header.kid);
    if (!key) return { status: 401, error: 'Invalid authentication token' };
    userId = jwt.verify(token, key.publicKey, { algorithms: [key.alg] }).sub;
  } else {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    userId = decoded.userId;
    sid = decoded.sid || null;
  }
  if (!userId) return { status: 401, error: 'Invalid authentication token' };

  // Session-backed tokens: a JWT carrying a `sid` claim is only valid while its
  // user_sessions row (id = sid) exists and is unexpired — logout/password-reset/
  // account-deletion delete the row and the token dies instantly. Tokens WITHOUT
  // a sid (issued pre-deploy) keep the old stateless behavior and age out in <=7d.
  if (sid) {
    const sess = await req.db.query(
      'SELECT 1 FROM user_sessions WHERE id = $1 AND user_id = $2 AND expires_at > NOW()',
      [sid, userId],
    );
    if (sess.rows.length === 0) return { status: 401, error: 'Session expired or revoked' };
  }

  const result = await req.db.query(
    `SELECT id, username, email, display_name, avatar_url, created_at, email_verified, is_active
       FROM users WHERE id = $1 AND is_active = true`,
    [userId],
  );
  if (result.rows.length === 0) return { status: 401, error: 'Invalid or expired token' };
  return { user: result.rows[0] };
}

/**
 * Middleware to verify JWT token and add user to request
 */
export const authMiddleware = async (req, res, next) => {
  try {
    const publicPaths = new Set([
      '/status',
      '/download/extension/releases',
    ]);
    if (publicPaths.has(req.path)) {
      return next();
    }

    // Unified resolution: legacy HS256 OR OIDC RS256/ES256 (see resolveAuthedUser).
    const resolved = await resolveAuthedUser(req);
    if (resolved.error) {
      return res.status(resolved.status).json({ success: false, error: resolved.error });
    }
    req.user = resolved.user;
    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid authentication token'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Authentication token expired'
      });
    }
    
    console.error('Authentication middleware error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
      // SECURITY: Do not expose error.message to clients in production
    });
  }
};

/**
 * Optional authentication middleware - adds user if token is present but doesn't require it
 */
export const optionalAuthMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (token) {
      // Unified resolution (incl. the sid session-revocation check) so a
      // logged-out token can't keep attaching a user on optional-auth surfaces.
      const resolved = await resolveAuthedUser(req);
      if (resolved.user) {
        req.user = resolved.user;
      }
    }

    next();

  } catch (error) {
    // For optional auth, we don't return errors, just continue without user
    next();
  }
};

/**
 * Admin guard — authMiddleware's user SELECT omits `role`, and `is_admin` does not
 * exist as a column, so guards must query the DB (same pattern as marketplaceRoutes).
 * Mount AFTER authMiddleware (needs req.user + req.db).
 */
export async function requireAdmin(req, res, next) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const { rows } = await req.db.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (rows[0]?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
  } catch (error) {
    console.error('Admin guard error:', error.message);
    return res.status(500).json({ success: false, error: 'Authorization check failed' });
  }
}

export default authMiddleware;
