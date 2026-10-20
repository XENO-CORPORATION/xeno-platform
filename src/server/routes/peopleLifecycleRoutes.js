/**
 * Onboarding and offboarding (services/peopleLifecycle.js) — mounted at /api/people beside routes/workforcePeopleRoutes.js.
 * A separate router because these compose Tasks, projects and workspace membership (NFR-09 keeps that reach out of
 * the workforce surface).
 *
 *   POST   /api/people/:principalId/onboard          { workspaceId, tasks? }          (human admin)
 *   GET    /api/people/:principalId/offboard-plan?workspace=<id>                      (human admin)
 *   POST   /api/people/:principalId/offboard         { workspaceId, confirm: true }   (human admin)
 */
import express from 'express';
import * as lifecycle from '../services/peopleLifecycle.js';

const router = express.Router();
const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e && Number.isInteger(e.status) && typeof e.code === 'string') return res.status(e.status).json({ success: false, error: e.message, code: e.code });
    console.error('[people-lifecycle]', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
const me = (req) => ({ id: req.owner });
const ws = (req) => String(req.query.workspace || (req.body && req.body.workspaceId) || '');

router.post('/:principalId/onboard', handled(async (req, res) => { res.status(201).json({ success: true, ...(await lifecycle.onboard(req.db, me(req), { workspaceId: ws(req), principalId: req.params.principalId, tasks: req.body?.tasks })) }); }));
router.get('/:principalId/offboard-plan', handled(async (req, res) => { res.json({ success: true, plan: await lifecycle.offboardPlan(req.db, me(req), { workspaceId: ws(req), principalId: req.params.principalId }) }); }));
router.post('/:principalId/offboard', handled(async (req, res) => { res.json({ success: true, ...(await lifecycle.offboard(req.db, me(req), { workspaceId: ws(req), principalId: req.params.principalId, confirm: req.body?.confirm, endDate: req.body?.endDate })) }); }));

export default router;
