/**
 * Divisions (services/workforceDivisions.js). The person's own signed-in session.
 *
 *   GET    /api/divisions[?workspace=<id>&archived=1]   the divisions of a workspace (default: the caller's personal one)
 *   POST   /api/divisions                               { workspaceId?, name, parentId? }        (workspace admin)
 *   GET    /api/divisions/:id                           one division: head, parent, children, agents, projects
 *   GET    /api/divisions/:id/home[?known=<rev>]        its HOME through the scoped read (division:<id> / home): members,
 *                                                       objectives, runs, spend, funding, projects, handoffs, decisions —
 *                                                       each part decided per row on the server; unseen parts arrive closed
 *   PATCH  /api/divisions/:id                           { name?, parentId?, headId? }            (workspace admin)
 *   POST   /api/divisions/:id/archive                   one-way; refused while it has active children
 *   PUT    /api/divisions/projects/:projectId           { divisionId | null } — the project's owning division
 */
import express from 'express';
import * as divisions from '../services/workforceDivisions.js';
import * as agentBudget from '../services/divisionAgentBudget.js';
import { readScoped } from '../services/scopedReads.js';

const router = express.Router();
const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof agentBudget.BudgetError) return res.status(e.status).json({ success: false, error: e.message, code: e.code });
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
router.get('/:id/home', handled(async (req, res) => {
  const id = String(req.params.id).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) return res.status(404).json({ success: false, error: 'Division not found', code: 'division_not_found' });
  const known = req.query.known === undefined ? undefined : Number(req.query.known);
  const r = await readScoped(req.db, { scope: `division:${id}`, key: 'home', actorUserId: String(req.owner), knownRevision: Number.isInteger(known) && known >= 0 ? known : undefined });
  if (r.state === 'denied') return res.status(404).json({ success: false, error: 'Division not found', code: 'division_not_found' });
  if (r.state === 'unavailable') return res.status(503).json({ success: false, error: 'The division could not be read just now', code: 'unavailable' });
  res.json({ success: true, state: r.state, revision: r.revision, home: r.rows ? r.rows[0] : null });
}));
router.patch('/:id', handled(async (req, res) => { res.json({ success: true, division: await divisions.update(req.db, req.me, req.params.id, req.body || {}) }); }));
// the division's AGENT budget (divisionAgentBudget.js): what its agents may spend per period, and whether a generation
// inside it runs without waiting for the agent's owner. Readable by the workspace; set by its admins.
router.get('/:id/agent-budget', handled(async (req, res) => {
  const d = await divisions.readable(req.db, req.me, req.params.id);
  const b = await agentBudget.budgetOf(req.db, d.id);
  res.json({ success: true, budget: b ? b.view : null, spend: await agentBudget.divisionSpend(req.db, d.id), canManage: await divisions.mayManage(req.db, req.me, d.workspace_id) });
}));
router.put('/:id/agent-budget', handled(async (req, res) => {
  const b = req.body || {};
  res.json({ success: true, budget: await agentBudget.setBudget(req.db, req.me, req.params.id, { credits: b.credits === undefined ? undefined : b.credits, windowDays: b.windowDays ?? 30, autoApprove: b.autoApprove === true }) });
}));
router.post('/:id/archive', handled(async (req, res) => { res.json({ success: true, division: await divisions.archive(req.db, req.me, req.params.id) }); }));

export default router;
