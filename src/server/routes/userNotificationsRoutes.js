/**
 * /api/notifications — the person's inbox (user_notifications). Any product writes rows with its own `source`;
 * today that is XENO Tasks.
 *
 *   GET  /api/notifications?view=&unread=1&limit=   newest first, with the unread count. view: inbox (default), snoozed, archive, all (with prefs)
 *   POST /api/notifications/read {ids|all, read?}    mark read, or read: false for unread
 *   POST /api/notifications/archive {ids, archived?} archive, or archived: false to bring back
 *   POST /api/notifications/snooze {ids, until}      until a time; until: null wakes them
 *   GET|PUT /api/notifications/prefs                 what reaches the person: digest and per-area levels
 */
import express from 'express';
import { listNotifications, markNotificationsRead, archiveNotifications, snoozeNotifications, getPrefs, setPrefs, InboxError } from '../services/inbox.js';

const router = express.Router();   // mounted behind authMiddleware in index.js

const handle = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req, req.body || {})) }); }
  catch (error) {
    if (error instanceof InboxError) return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    console.error('[notifications]', error); res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
const counted = (req) => listNotifications(req.db, req.user.id, { limit: 1 });
router.get('/', handle(async (req) => ({ ...(await listNotifications(req.db, req.user.id, { view: req.query.view || 'inbox', unread: req.query.unread === '1', limit: req.query.limit })), ...(req.query.view === 'all' ? { prefs: await getPrefs(req.db, req.user.id) } : {}) })));
router.post('/read', handle(async (req, b) => { await markNotificationsRead(req.db, req.user.id, b.all === true ? 'all' : b.ids, { read: b.read !== false }); return counted(req); }));
router.post('/archive', handle(async (req, b) => { await archiveNotifications(req.db, req.user.id, b.ids, { archived: b.archived !== false }); return counted(req); }));
router.post('/snooze', handle(async (req, b) => { await snoozeNotifications(req.db, req.user.id, b.ids, b.until === null ? null : b.until); return counted(req); }));
router.get('/prefs', handle(async (req) => ({ prefs: await getPrefs(req.db, req.user.id) })));
router.put('/prefs', handle(async (req, b) => ({ prefs: await setPrefs(req.db, req.user.id, b) })));

export default router;
