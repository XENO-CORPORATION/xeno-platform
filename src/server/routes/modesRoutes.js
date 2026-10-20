/**
 * Custom modes REST (XENO MODES - SPEC.md §8, §8c.3). One code path: every route calls services/modeApply.js, the
 * same functions the XENO MCP `modes_*` tools run. Mounted behind authMiddleware + requireActivated in index.js.
 *
 *   /api/v2/me/modes                          GET (mine + my workspaces' + where I am admin) · POST create
 *   /api/v2/me/modes/:modeId                  PATCH · DELETE (archives)
 *   /api/v2/workspaces/:wid/modes/packs       GET   the packs that can be applied
 *   /api/v2/workspaces/:wid/modes/plan        POST  {packId, answers}            → {plan, planHash} (writes nothing)
 *   /api/v2/workspaces/:wid/modes/apply       POST  {packId, answers, planHash, idempotencyKey, confirm: true}
 *   /api/v2/workspaces/:wid/modes/applications GET  the receipts
 *   /api/v2/workspaces/:wid/modes/:applicationId/revert POST
 *   /api/v2/workspaces/:wid/modes/items/:modeId PATCH a workspace mode (marks it as a person's edit)
 * `Idempotency-Key` is accepted for apply when the body names none.
 */
import express from 'express';
import * as modes from '../services/modeApply.js';

const send = (res, fn) => fn().then((out) => res.json({ success: true, ...out })).catch((e) => {
  if (e instanceof modes.ModeError) return res.status(e.status).json({ success: false, error: e.code, message: e.message });
  if (e?.code === '23514' || e?.code === '23505') return res.status(409).json({ success: false, error: 'conflict', message: e.message });
  console.error('[modes]', e?.message || e);
  return res.status(500).json({ success: false, error: 'internal_error' });
});
const actor = (req) => ({ id: req.user.id });
const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

export const meModesRouter = express.Router();
meModesRouter.use(express.json({ limit: '64kb' }));
meModesRouter.get('/', (req, res) => send(res, () => modes.listMine(req.db, actor(req))));
meModesRouter.post('/', (req, res) => send(res, () => modes.createMine(req.db, actor(req), body(req))));
meModesRouter.patch('/:modeId', (req, res) => send(res, () => modes.updateMine(req.db, actor(req), req.params.modeId, body(req))));
meModesRouter.delete('/:modeId', (req, res) => send(res, () => modes.removeMine(req.db, actor(req), req.params.modeId)));

export const workspaceModesRouter = express.Router();
workspaceModesRouter.use(express.json({ limit: '64kb' }));
workspaceModesRouter.get('/:wid/modes/packs', (req, res) => send(res, () => modes.listPacks(req.db)));
workspaceModesRouter.post('/:wid/modes/plan', (req, res) => send(res, () => modes.plan(req.db, actor(req), { ...body(req), workspaceId: req.params.wid })));
workspaceModesRouter.post('/:wid/modes/apply', (req, res) => send(res, () => modes.apply(req.db, actor(req), {
  ...body(req), workspaceId: req.params.wid, idempotencyKey: body(req).idempotencyKey ?? req.get('idempotency-key') })));
workspaceModesRouter.get('/:wid/modes/applications', (req, res) => send(res, () => modes.status(req.db, actor(req), { workspaceId: req.params.wid })));
workspaceModesRouter.post('/:wid/modes/:applicationId/revert', (req, res) => send(res, () => modes.revert(req.db, actor(req), { workspaceId: req.params.wid, applicationId: req.params.applicationId })));
workspaceModesRouter.patch('/:wid/modes/items/:modeId', (req, res) => send(res, () => modes.updateWorkspaceMode(req.db, actor(req), req.params.wid, req.params.modeId, body(req))));

export default meModesRouter;
