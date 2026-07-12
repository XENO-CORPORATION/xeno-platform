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
  const header = jwt.decode(token, { complete: true })?.header;
  if (header && header.alg !== 'HS256' && header.kid) {
    const key = await getKeyByKid(req.db, header.kid);
    if (!key) return { status: 401, error: 'Invalid authentication token' };
    userId = jwt.verify(token, key.publicKey, { algorithms: [key.alg] }).sub;
  } else {
    userId = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }).userId;
  }
  if (!userId) return { status: 401, error: 'Invalid authentication token' };

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
      const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

      const result = await req.db.query(`
        SELECT id, username, email, display_name, avatar_url, 
               created_at, email_verified, is_active
        FROM users 
        WHERE id = $1 AND is_active = true
      `, [decoded.userId]);

      if (result.rows.length > 0) {
        req.user = result.rows[0];
      }
    }
    
    next();

  } catch (error) {
    // For optional auth, we don't return errors, just continue without user
    next();
  }
};

export default authMiddleware;
