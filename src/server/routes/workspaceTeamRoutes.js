import express from 'express';
import { UUID_RE } from '../utils/workspaceContext.js';
import { listWorkspaceTeams, saveWorkspaceTeam } from '../services/workspaceTeams.js';

const router = express.Router({ mergeParams: true });
router.use((req, res, next) => {
  const id = req.params.id;
  if (!UUID_RE.test(id || '')) return res.status(400).json({ success: false, error: 'Invalid workspace id' });
  for (const context of [req.headers['x-xeno-workspace'], req.body?.workspace_id, req.query?.workspace_id]) {
    if (context === undefined) continue;
    if (typeof context !== 'string' || !UUID_RE.test(context)) return res.status(400).json({ success: false, error: 'Invalid workspace context' });
    if (context.toLowerCase() !== id.toLowerCase()) return res.status(409).json({ success: false, error: 'Workspace context changed. Refresh and try again.', code: 'workspace_context_mismatch' });
  }
  next();
});
const wrap = (fn) => async (req, res) => {
  try { res.json({ success: true, ...await fn(req) }); }
  catch (error) {
    if (!error.status) console.error('[workspace-teams]', error.message);
    res.status(error.status || 500).json({ success: false, error: error.status ? error.message : 'Teams are unavailable. Please try again.', code: error.status ? error.code : 'teams_unavailable' });
  }
};
router.get('/', wrap(req => listWorkspaceTeams(req.db, req.params.id, req.user.id)));
router.post('/', wrap(req => saveWorkspaceTeam(req.db, { workspaceId: req.params.id, userId: req.user.id, input: req.body })));
router.put('/:teamId', wrap(req => saveWorkspaceTeam(req.db, { workspaceId: req.params.id, userId: req.user.id, teamId: req.params.teamId, input: req.body })));
router.delete('/:teamId', wrap(req => saveWorkspaceTeam(req.db, { workspaceId: req.params.id, userId: req.user.id, teamId: req.params.teamId, input: req.body, archive: true })));
export default router;
