/**
 * Authentication Middleware
 * JWT-based route protection and user context
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getKeyByKid } from '../utils/oidcProvider.js';

const JWT_DEFAULT_SECRET = 'xenostudio-super-secret-jwt-key-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || JWT_DEFAULT_SECRET;
// SECURITY: never run on a missing/committed-default signing secret in production — with
// it, anyone can forge an HS256 token for ANY user. Fail fast instead of just warning.
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || JWT_SECRET === JWT_DEFAULT_SECRET)) {
  console.error('FATAL: JWT_SECRET is unset or equals the committed default in production. Refusing to boot. Set a strong JWT_SECRET.');
  process.exit(1);
}

// A JWT is exactly three base64url segments separated by dots (header.payload.
// signature). Platform API keys (`xeno-<hex>`) contain no dots, so this is a
// reliable, allocation-free discriminator between the two credential shapes.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// Same at-rest scheme the gateway (xeno-api-proxy `getPlatformApiKeyRecord`) and
// the portal/gateway key-mint use: sha256(rawKey) hex, looked up alongside the
// 16-char key_prefix. Keys are high-entropy (`xeno-`+48 hex), so a single indexed
// sha256 equality is correct here (not a low-entropy password). The lookup is by
// HASH, never by comparing the plaintext secret, so there is no timing oracle on
// the raw key; and the key is never logged.
function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(String(rawKey)).digest('hex');
}

/**
 * Resolve a platform API KEY (`xeno-...`) to its owning user, mirroring the
 * gateway's canonical `validateApiKeyFromDB`: hash → (key_prefix, key_hash)
 * lookup on active, unexpired keys → load the SAME user shape the JWT path
 * returns. Best-effort `last_used_at`/`usage_count` bump. Returns null on any
 * miss (unknown / inactive / expired key, or inactive user) so the caller emits
 * the identical 401 as the JWT path.
 * @returns {Promise<object | null>} the user row, or null.
 */
async function resolveApiKeyUser(req, rawKey) {
  const keyPrefix = rawKey.slice(0, 16);
  const keyHash = hashApiKey(rawKey);
  const { rows } = await req.db.query(
    `SELECT ak.id AS key_id, ak.expires_at,
            u.id, u.username, u.email, u.display_name, u.avatar_url,
            u.created_at, u.email_verified, u.is_active
       FROM api_keys ak
       JOIN users u ON u.id = ak.user_id
      WHERE ak.key_prefix = $1 AND ak.key_hash = $2 AND ak.is_active = true
        AND u.is_active = true
      LIMIT 1`,
    [keyPrefix, keyHash],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  // Best-effort usage bump — never block auth on this write, never let it throw.
  req.db
    .query(
      'UPDATE api_keys SET last_used_at = NOW(), usage_count = usage_count + 1 WHERE id = $1',
      [row.key_id],
    )
    .catch(() => {});

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    created_at: row.created_at,
    email_verified: row.email_verified,
    is_active: row.is_active,
  };
}

/**
 * Unified token resolution for EVERY authed surface (the single source of truth
 * shared by authMiddleware and the v2 oidcAuth). Accepts:
 *   - the legacy HS256 platform token (payload.userId),
 *   - OIDC access tokens (RS256/ES256, payload.sub) verified against the signing
 *     key for their `kid`, and
 *   - platform API KEYS (`xeno-...`) resolved via the api_keys table (this is
 *     what `xeno remote` / the CLI sends).
 * so an OIDC-signed-in user OR an API-key caller works on ALL routes, not only
 * /api/v2/*. `algorithms` is pinned per branch (defends against alg-confusion;
 * the old global verify accepted any algorithm). Header-only by design — the app
 * authenticates via `Authorization: Bearer` and sets NO auth cookie.
 * @returns {{ user: object } | { status: number, error: string }}
 */
export async function resolveAuthedUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return { status: 401, error: 'Authentication token required' };

  // ADDITIVE branch: a token that is NOT JWT-shaped can only be an API key.
  // JWT-shaped tokens fall through to the byte-for-byte-unchanged JWT logic below.
  if (!JWT_SHAPE.test(token)) {
    const user = await resolveApiKeyUser(req, token);
    if (user) return { user };
    return { status: 401, error: 'Invalid authentication token' };
  }

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
