/**
 * XENO-WORKFORCE-01 §15 audit view (services/workforceEvents.js): the typed workforce event stream of one scope, each
 * row decided for the reader on the server; unseen rows are counted in `hidden`, never sent.
 *
 *   GET /api/audit/events?scope=workspace:<id>|division:<id>|project:<id>[&before=<id>|&after=<id>][&limit=][&types=run,handoff]
 */
import express from 'express';
import * as events from '../services/workforceEvents.js';

const router = express.Router();
router.get('/events', async (req, res) => {
  try {
    res.json({ success: true, ...(await events.listEvents(req.db, { id: req.owner, kind: 'human' }, { scope: req.query.scope, before: req.query.before, after: req.query.after, limit: req.query.limit, types: req.query.types })) });
  } catch (e) {
    if (e instanceof events.EventsError) return res.status(e.status).json({ success: false, error: e.message, code: e.code });
    console.error('[audit]', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
export default router;
