/**
 * /api/v2/me — canonical account for a token (the SDK's identity-read).
 *
 * Returns the unified account shape: id (= canonical platform_user_id), email,
 * profile, and the app surfaces linked to this account (from
 * external_identity_links). Auth via the same authMiddleware (accepts the RS256
 * OIDC access token OR the legacy HS256 token during transition).
 */
import express from 'express';
import { eraseSubject } from '../utils/gdprErasure.js';

const router = express.Router();

// POST /api/v2/me/erase { confirm: true } — GDPR self-erasure (Arch §6.2).
// Tombstones PII + revokes tokens; the immutable ledger facts survive intact.
router.post('/erase', async (req, res) => {
  try {
    if ((req.body || {}).confirm !== true) {
      return res.status(400).json({ error: { code: 'CONFIRM_REQUIRED', message: 'pass { confirm: true } to erase this account' } });
    }
    res.json(await eraseSubject(req.db, req.user.id));
  } catch (e) {
    console.error('[v2/me/erase] error:', e.message);
    res.status(500).json({ error: { code: 'PLATFORM_ERROR', message: 'erasure failed' } });
  }
});

router.get('/', async (req, res) => {
  try {
    const u = req.user;
    const links = await req.db.query(
      'SELECT DISTINCT source_system FROM external_identity_links WHERE platform_user_id = $1',
      [u.id],
    );
    // XENO handle unification: a conforming, non-reserved handle IS the user's
    // @<MAIL_PRIMARY_DOMAIN> address (one handle = login = identity = mailbox).
    const domain = process.env.MAIL_PRIMARY_DOMAIN || 'xenostudio.ai';
    const handle = String(u.username || '').toLowerCase();
    let xenoAddress = null;
    if (/^[a-z0-9](?:[a-z0-9]|[._-](?![._-])){1,30}[a-z0-9]$/.test(handle)) {
      const reserved = await req.db.query('SELECT 1 FROM reserved_handles WHERE handle = $1', [handle]);
      if (reserved.rows.length === 0) xenoAddress = `${handle}@${domain}`;
    }
    res.json({
      id: u.id,
      email: u.email,
      username: u.username ?? null,
      xenoAddress,
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
