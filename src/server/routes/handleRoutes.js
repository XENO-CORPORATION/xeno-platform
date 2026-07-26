/**
 * /api/v2/handles — the central XENO handle registry API.
 *
 * The handle IS the user's workspace identity and (when conforming) their
 * @xenostudio.ai address (Google model: one handle = login = identity = mailbox).
 * Products (XENO Mail first) CONSUME this registry — they never keep their own.
 *
 *   GET  /api/v2/handles/check?handle=foo   → { ok, reason?, handle, address? }   (auth'd)
 *   POST /api/v2/handles/claim { handle }   → { ok, reason?, handle, address }    (auth'd; sets own username)
 *
 * Policy: 3–32 chars, ^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$, no consecutive separators,
 * case-insensitive-unique, not reserved. MAIL_PRIMARY_DOMAIN drives the address.
 */
import express from 'express';
import { mailDomain } from '../config/hosts.js';

// Auth + db are applied at the mount point (index.js: databaseMiddleware + oidcAuth),
// matching the other /api/v2/* routes.
const router = express.Router();

const PRIMARY_DOMAIN = mailDomain();
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9]|[._-](?![._-])){1,30}[a-z0-9]$/;

export function normalizeHandle(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function validateHandleSyntax(handle) {
  if (handle.length < 3 || handle.length > 32) return 'invalid';
  if (!HANDLE_RE.test(handle)) return 'invalid';
  return null;
}

async function checkHandle(db, handle, selfUserId) {
  const syntax = validateHandleSyntax(handle);
  if (syntax) return { ok: false, reason: syntax, handle };

  const reserved = await db.query('SELECT 1 FROM reserved_handles WHERE handle = $1', [handle]);
  if (reserved.rows.length > 0) return { ok: false, reason: 'reserved', handle };

  const taken = await db.query(
    'SELECT id FROM users WHERE lower(username) = $1 LIMIT 1',
    [handle],
  );
  if (taken.rows.length > 0 && taken.rows[0].id !== selfUserId) {
    return { ok: false, reason: 'taken', handle };
  }
  return { ok: true, handle, address: `${handle}@${PRIMARY_DOMAIN}` };
}

// GET /api/v2/handles/check?handle=foo
router.get('/check', async (req, res) => {
  try {
    const handle = normalizeHandle(req.query.handle);
    res.json(await checkHandle(req.db, handle, req.user.id));
  } catch (e) {
    console.error('[handles/check] error:', e.message);
    res.status(500).json({ ok: false, reason: 'error' });
  }
});

// POST /api/v2/handles/claim { handle } — set the caller's own handle (username).
router.post('/claim', async (req, res) => {
  try {
    const handle = normalizeHandle((req.body || {}).handle);
    const check = await checkHandle(req.db, handle, req.user.id);
    if (!check.ok) return res.status(409).json(check);

    // Already theirs (case-insensitively)? No-op success.
    const current = normalizeHandle(req.user.username);
    if (current === handle) {
      return res.json({ ok: true, handle, address: `${handle}@${PRIMARY_DOMAIN}`, changed: false });
    }

    await req.db.query('UPDATE users SET username = $1, updated_at = NOW() WHERE id = $2', [
      handle,
      req.user.id,
    ]);
    console.log(`[handles] ${req.user.id} claimed handle '${handle}' (was '${req.user.username}')`);
    res.json({ ok: true, handle, address: `${handle}@${PRIMARY_DOMAIN}`, changed: true });
  } catch (e) {
    // unique-violation race → taken
    if (e && e.code === '23505') {
      return res.status(409).json({ ok: false, reason: 'taken' });
    }
    console.error('[handles/claim] error:', e.message);
    res.status(500).json({ ok: false, reason: 'error' });
  }
});

export default router;
