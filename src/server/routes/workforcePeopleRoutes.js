/**
 * People in a company workspace (services/workforcePeople.js) — the person's own signed-in session.
 *
 *   GET    /api/people?workspace=<id>[&q=&division=&team=&kind=]  the directory
 *   GET    /api/people/org-chart?workspace=<id>                   humans + agents and the manager chain
 *   GET    /api/people/me/work?workspace=<id>                     "my work": tasks, approvals, runs, assignments, reports
 *   POST   /api/people/time-off                                   { workspaceId, principalId?, startsAt, endsAt, kind, note }
 *   POST   /api/people/time-off/:id/cancel                        { workspaceId }
 *   GET    /api/people/:principalId?workspace=<id>                one profile (private fields only for self/admin/managers)
 *   PATCH  /api/people/:principalId                               { workspaceId, expectedRevision?, …fields }
 *   onboard / offboard-plan / offboard: routes/peopleLifecycleRoutes.js (same /api/people prefix)
 */
import express from 'express';
import * as people from '../services/workforcePeople.js';

const router = express.Router();
const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof people.PeopleError || (e && Number.isInteger(e.status) && typeof e.code === 'string')) return res.status(e.status || 400).json({ success: false, error: e.message, code: e.code });
    console.error('[people]', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
const me = (req) => ({ id: req.owner });
const ws = (req) => String(req.query.workspace || (req.body && req.body.workspaceId) || '');

router.get('/', handled(async (req, res) => { res.json({ success: true, ...(await people.directory(req.db, me(req), { workspaceId: ws(req), q: req.query.q, divisionId: req.query.division || null, teamId: req.query.team || null, kind: req.query.kind || null })) }); }));
router.get('/org-chart', handled(async (req, res) => { res.json({ success: true, ...(await people.orgChart(req.db, me(req), { workspaceId: ws(req) })) }); }));
router.get('/me/work', handled(async (req, res) => { res.json({ success: true, ...(await people.myWork(req.db, me(req), { workspaceId: ws(req) })) }); }));
router.post('/time-off', handled(async (req, res) => { const b = req.body || {}; res.status(201).json({ success: true, timeOff: await people.addTimeOff(req.db, me(req), { workspaceId: ws(req), principalId: b.principalId, startsAt: b.startsAt, endsAt: b.endsAt, kind: b.kind, note: b.note }) }); }));
router.post('/time-off/:id/cancel', handled(async (req, res) => { res.json({ success: true, ...(await people.cancelTimeOff(req.db, me(req), { workspaceId: ws(req), timeOffId: req.params.id })) }); }));
router.get('/:principalId', handled(async (req, res) => { res.json({ success: true, ...(await people.getPerson(req.db, me(req), { workspaceId: ws(req), principalId: req.params.principalId })) }); }));
router.patch('/:principalId', handled(async (req, res) => {
  const { workspaceId: _w, ...fields } = req.body || {};
  res.json({ success: true, ...(await people.updateProfile(req.db, me(req), { workspaceId: ws(req), principalId: req.params.principalId, ...fields })) });
}));

export default router;
