/**
 * Divisions (services/workforceDivisions.js). The person's own signed-in session.
 *
 *   GET    /api/divisions[?workspace=<id>&archived=1]   the divisions of a workspace (default: the caller's personal one)
 *   POST   /api/divisions                               { workspaceId?, name, parentId? }        (workspace admin)
 *   GET    /api/divisions/:id                           one division: head, parent, children, agents, projects
 *   PATCH  /api/divisions/:id                           { name?, parentId?, headId? }            (workspace admin)
 *   POST   /api/divisions/:id/archive                   one-way; refused while it has active children
 *   PUT    /api/divisions/projects/:projectId           { divisionId | null } — the project's owning division
 */
import express from 'express';
import * as divisions from '../services/workforceDivisions.js';

const router = express.Router();
const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof divisions.DivisionError) return res.status(e.status).json({ success: false, error: e.message, code: e.code });
    console.error('[divisions]', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
router.use((req, _res, next) => { req.me = { id: req.owner, kind: 'human' }; next(); });

router.get('/', handled(async (req, res) => { res.json({ success: true, ...(await divisions.list(req.db, req.me, { workspaceId: req.query.workspace ? String(req.query.workspace) : null, archived: req.query.archived === '1' })) }); }));
router.post('/', handled(async (req, res) => { res.status(201).json({ success: true, division: await divisions.create(req.db, req.me, req.body || {}) }); }));
router.put('/projects/:projectId', handled(async (req, res) => { res.json({ success: true, ...(await divisions.setProjectDivision(req.db, req.me, req.params.projectId, (req.body && req.body.divisionId) || null)) }); }));
router.get('/:id', handled(async (req, res) => { res.json({ success: true, division: await divisions.get(req.db, req.me, req.params.id) }); }));
router.patch('/:id', handled(async (req, res) => { res.json({ success: true, division: await divisions.update(req.db, req.me, req.params.id, req.body || {}) }); }));
router.post('/:id/archive', handled(async (req, res) => { res.json({ success: true, division: await divisions.archive(req.db, req.me, req.params.id) }); }));

export default router;
