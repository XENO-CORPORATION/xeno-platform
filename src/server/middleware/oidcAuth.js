/**
 * v2 auth for /api/v2/*. Thin wrapper over the unified resolveAuthedUser
 * (middleware/auth.js), which accepts BOTH OIDC access tokens (RS256/ES256,
 * sub = userId) AND the legacy HS256 platform token (userId). Kept as a named
 * export so the v2 route mounts read clearly and can be swapped independently.
 *
 * Previously this file duplicated the token-verification logic; unifying it means
 * the legacy and v2 surfaces can never drift apart in how they authenticate.
 */
import { resolveAuthedUser } from './auth.js';

export async function oidcAuth(req, res, next) {
  try {
    const resolved = await resolveAuthedUser(req);
    if (resolved.error) {
      return res.status(resolved.status).json({ success: false, error: resolved.error });
    }
    req.user = resolved.user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Invalid authentication token' });
    }
    console.error('oidcAuth error:', err.message);
    return res.status(500).json({ success: false, error: 'Authentication failed' });
  }
}

export default oidcAuth;
