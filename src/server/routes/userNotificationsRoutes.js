/**
 * /api/notifications — the person's inbox (user_notifications). Any product writes rows with its own `source`;
 * today that is XENO Tasks.
 *
 *   GET  /api/notifications?unread=1&limit=   newest first, with the unread count
 *   POST /api/notifications/read {ids|all}    mark read
 */
import express from 'express';
import { listNotifications, markNotificationsRead } from '../services/xenoTasks.js';

const router = express.Router();   // mounted behind authMiddleware in index.js

router.get('/', async (req, res) => {
  try { res.json({ success: true, ...(await listNotifications(req.db, req.user.id, { unread: req.query.unread === '1', limit: req.query.limit })) }); }
  catch (error) { console.error('[notifications]', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.post('/read', async (req, res) => {
  try {
    const body = req.body || {};
    await markNotificationsRead(req.db, req.user.id, body.all === true ? 'all' : body.ids);
    res.json({ success: true, ...(await listNotifications(req.db, req.user.id, { limit: 1 })) });
  } catch (error) { console.error('[notifications]', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

export default router;
