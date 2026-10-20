/**
 * /api/workspace-analytics — Corpo › Analytics (services/analytics.js), the workspace's own dashboards. Distinct
 * from /api/analytics (analyticsRoutes.js), which is XENO staff's site-wide admin statistics. Mounted behind
 * authMiddleware. Every route takes `workspace` (query or body; absent = the person's Personal workspace).
 *
 *   GET    /metrics                           the metric catalogue (+ the workspace's divisions)
 *   GET    /metrics/:metric?days=&division=   one metric's value now
 *   GET    /dashboards                        · POST /dashboards {name, widgets}
 *   GET    /dashboards/:id                    · PATCH /dashboards/:id {name?, widgets?}
 *   DELETE /dashboards/:id                    (soft; undo with POST /dashboards/:id/restore)
 *
 * A request made with an agent's credential is the agent: it reads as its owner and cannot change dashboards.
 */
import express from 'express';
import * as A from '../services/analytics.js';

const router = express.Router();
const ws = (req) => (req.body && req.body.workspace) || req.query.workspace || null;
const actorOf = async (req) => {
  const isAgent = (await req.db.query('SELECT 1 FROM agent_identities WHERE user_id = $1', [req.user.id])).rows.length > 0;
  return { id: req.user.id, kind: isAgent ? 'agent' : 'human' };
};
const run = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req, await actorOf(req))) }); }
  catch (e) {
    if (e instanceof A.AnalyticsError) return res.status(e.status).json({ success: false, code: e.code, error: e.message });
    console.error('Workspace analytics failed:', e); res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

router.get('/metrics', run((req, a) => A.listMetrics(req.db, a, { workspace: ws(req) })));
router.get('/metrics/:metric', run((req, a) => A.queryMetric(req.db, a, { workspace: ws(req), metric: req.params.metric, days: req.query.days, division: req.query.division || null })));
router.get('/dashboards', run((req, a) => A.listDashboards(req.db, a, { workspace: ws(req) })));
router.post('/dashboards', run((req, a) => A.createDashboard(req.db, a, { workspace: ws(req), name: req.body?.name, widgets: req.body?.widgets || [] })));
router.get('/dashboards/:id', run((req, a) => A.getDashboard(req.db, a, { workspace: ws(req), id: req.params.id })));
router.patch('/dashboards/:id', run((req, a) => A.updateDashboard(req.db, a, { workspace: ws(req), id: req.params.id, name: req.body?.name, widgets: req.body?.widgets })));
router.delete('/dashboards/:id', run((req, a) => A.deleteDashboard(req.db, a, { workspace: ws(req), id: req.params.id })));
router.post('/dashboards/:id/restore', run((req, a) => A.restoreDashboard(req.db, a, { workspace: ws(req), id: req.params.id })));

export default router;
