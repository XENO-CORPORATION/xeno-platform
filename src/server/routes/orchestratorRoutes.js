/**
 * XENO Orchestrator on the platform (services/workforceOrchestrator.js). The person's own signed-in session; agents
 * reach the same service functions through /api/mcp (orchestrator.* in the capability catalogue).
 *
 *   GET    /api/orchestrator/graph?project=<id>            a project's dependency graph: tasks, goals, objectives, edges,
 *                                                         per-node done / ready / blockedBy
 *   GET    /api/orchestrator/ready?project=<id>[&kind=]    the ready set (default: tasks)
 *   POST   /api/orchestrator/edges                         { from: { kind, id|key }, to: { kind, id|key } } — from blocks to;
 *                                                         a loop is refused (409 cycle)
 *   DELETE /api/orchestrator/edges/:edgeId
 *   GET    /api/orchestrator/plans?project=<id>
 *   POST   /api/orchestrator/plans                         { projectId, name, steps: [{ task: 'T-n', maxAttempts? }] }
 *   GET    /api/orchestrator/plans/:planId                 steps in dependency order, readiness, attempts (state from the run)
 *   POST   /api/orchestrator/plans/:planId/attempts        { task, admissionId } — bind the next attempt to an admitted run
 */
import express from 'express';
import * as orch from '../services/workforceOrchestrator.js';
import { TaskError } from '../services/xenoTasks.js';

const router = express.Router();
const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof orch.OrchestratorError || e instanceof TaskError) return res.status(e.status || 400).json({ success: false, error: e.message, code: e.code });
    console.error('[orchestrator]', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
router.use((req, _res, next) => { req.me = { id: req.owner, kind: 'human' }; next(); });

router.get('/graph', handled(async (req, res) => { res.json({ success: true, graph: await orch.readGraph(req.db, req.me, { projectId: req.query.project }) }); }));
router.get('/ready', handled(async (req, res) => { res.json({ success: true, ...(await orch.readReady(req.db, req.me, { projectId: req.query.project, kind: req.query.kind || 'task' })) }); }));
router.post('/edges', handled(async (req, res) => { res.status(201).json({ success: true, ...(await orch.addEdge(req.db, req.me, req.body || {})) }); }));
router.delete('/edges/:edgeId', handled(async (req, res) => { res.json({ success: true, ...(await orch.removeEdge(req.db, req.me, { edgeId: req.params.edgeId })) }); }));
router.get('/plans', handled(async (req, res) => { res.json({ success: true, ...(await orch.listPlans(req.db, req.me, { projectId: req.query.project })) }); }));
router.post('/plans', handled(async (req, res) => { res.status(201).json({ success: true, ...(await orch.createPlan(req.db, req.me, req.body || {})) }); }));
router.get('/plans/:planId', handled(async (req, res) => { res.json({ success: true, ...(await orch.getPlan(req.db, req.me, { planId: req.params.planId })) }); }));
router.post('/plans/:planId/attempts', handled(async (req, res) => { res.status(201).json({ success: true, ...(await orch.startAttempt(req.db, req.me, { ...(req.body || {}), planId: req.params.planId })) }); }));

export default router;
