/**
 * Dual-mode auth for the v2 surface (/api/v2/*).
 *
 * Accepts EITHER the new RS256 OIDC access token (sub = userId) OR the legacy
 * HS256 platform token (userId), so v2 endpoints work for OIDC-signed-in users
 * AND during the transition — without modifying the global authMiddleware (the
 * legacy path stays byte-for-byte intact for all existing routes).
 */
import jwt from 'jsonwebtoken';
import { getKeyByKid } from '../utils/oidcProvider.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';

export async function oidcAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'Authentication token required' });

    let userId = null;
    const header = jwt.decode(token, { complete: true })?.header;

    if (header && header.alg !== 'HS256' && header.kid) {
      // OIDC access token (ES256 or RS256) — verify against the key with this kid,
      // so tokens issued under any signing key (incl. the old RS256 one) verify.
      const key = await getKeyByKid(req.db, header.kid);
      if (!key) return res.status(401).json({ success: false, error: 'Invalid authentication token' });
      const payload = jwt.verify(token, key.publicKey, { algorithms: [key.alg] });
      userId = payload.sub;
    } else {
      // Legacy HS256 platform token.
      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      userId = payload.userId;
    }

    if (!userId) return res.status(401).json({ success: false, error: 'Invalid authentication token' });

    const result = await req.db.query(
      `SELECT id, username, email, display_name, avatar_url, created_at, email_verified, is_active
         FROM users WHERE id = $1 AND is_active = true`,
      [userId],
    );
    if (result.rows.length === 0) return res.status(401).json({ success: false, error: 'Invalid or expired token' });

    req.user = result.rows[0];
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
