/**
 * /api/v2/me — canonical account for a token (the SDK's identity-read).
 *
 * Returns the unified account shape: id (= canonical platform_user_id), email,
 * profile, and the app surfaces linked to this account (from
 * external_identity_links). Auth via the same authMiddleware (accepts the RS256
 * OIDC access token OR the legacy HS256 token during transition).
 */
import express from 'express';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const u = req.user;
    const links = await req.db.query(
      'SELECT DISTINCT source_system FROM external_identity_links WHERE platform_user_id = $1',
      [u.id],
    );
    res.json({
      id: u.id,
      email: u.email,
      username: u.username ?? null,
      displayName: u.display_name ?? null,
      avatarUrl: u.avatar_url ?? null,
      emailVerified: u.email_verified ?? false,
      linkedSurfaces: links.rows.map((r) => r.source_system).filter(Boolean),
    });
  } catch (e) {
    console.error('[v2/me] error:', e.message);
    res.status(500).json({ error: { code: 'PLATFORM_ERROR', message: 'failed to load account' } });
  }
});

export default router;
