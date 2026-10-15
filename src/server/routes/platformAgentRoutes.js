/**
 * Platform agents (services/platformAgents.js). The person's own signed-in session only — an agent's token is refused.
 *
 *   GET    /api/agents                            the person's agents
 *   POST   /api/agents                            { name, description } → the agent (id = agt_…)
 *   GET    /api/agents/:id                        { id, name, description, owner, projects, credentials, connections }
 *   PATCH  /api/agents/:id                        { name?, description? }
 *   DELETE /api/agents/:id                        deletes it; every credential and connection stops working
 *   POST   /api/agents/:id/credentials            { ttlHours?=1, scopes?, label? } → { id, token (xtk_…, shown once), expiresAt, scopes }
 *   DELETE /api/agents/:id/credentials/:cid
 *   PUT    /api/agents/:id/projects/:projectId    { access: viewer|editor }
 *   DELETE /api/agents/:id/projects/:projectId
 */
import express from 'express';
import * as agents from '../services/platformAgents.js';
import { TaskError } from '../services/xenoTasks.js';

const router = express.Router();
const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof agents.AgentError || e instanceof TaskError) return res.status(e.status).json({ success: false, error: e.message, code: e.code });
    console.error('[agents]', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
// runs after personOnly (xenoMcpRoutes), which sets req.owner; the owner acts as a person
router.use((req, _res, next) => { req.me = { id: req.owner, kind: 'human' }; next(); });

router.get('/', handled(async (req, res) => { res.json({ success: true, agents: await agents.list(req.db, req.me) }); }));
router.post('/', handled(async (req, res) => { res.status(201).json({ success: true, agent: await agents.create(req.db, req.me, req.body || {}) }); }));
router.get('/:id', handled(async (req, res) => { res.json({ success: true, agent: await agents.get(req.db, req.me, req.params.id) }); }));
router.patch('/:id', handled(async (req, res) => { res.json({ success: true, agent: await agents.update(req.db, req.me, req.params.id, req.body || {}) }); }));
router.delete('/:id', handled(async (req, res) => { res.json({ success: true, ...(await agents.remove(req.db, req.me, req.params.id)) }); }));
router.post('/:id/credentials', handled(async (req, res) => {
  res.set('cache-control', 'no-store');
  res.status(201).json({ success: true, credential: await agents.mintCredential(req.db, req.me, req.params.id, req.body || {}) });
}));
router.delete('/:id/credentials/:cid', handled(async (req, res) => { res.json({ success: true, ...(await agents.revokeCredential(req.db, req.me, req.params.id, req.params.cid)) }); }));
router.put('/:id/projects/:projectId', handled(async (req, res) => { res.json({ success: true, agent: await agents.addProject(req.db, req.me, req.params.id, req.params.projectId, (req.body && req.body.access) || 'editor') }); }));
router.delete('/:id/projects/:projectId', handled(async (req, res) => { res.json({ success: true, agent: await agents.removeProject(req.db, req.me, req.params.id, req.params.projectId) }); }));

export default router;
