/**
 * /api/tasks — XENO Tasks (codename Telos). Product spec: xeno-tasks/SPEC.md; rules: services/xenoTasks.js.
 *
 *   GET    /api/tasks?area=&projectId=&status=&assignee=me|none|<id>&q=   the tasks the caller can see
 *   POST   /api/tasks                                     raise one (lands in `raised`)
 *   GET    /api/tasks/:key                                one task (T-123) with its history and the moves allowed
 *   PATCH  /api/tasks/:key                                edit, assign, set the review
 *   POST   /api/tasks/:key/transition {to, from?, note?}  move it (the state machine and who may); `from` = the status
 *                                                           the screen showed — refused with 409 if it has moved since
 *   POST   /api/tasks/:key/claim                          take it (atomic)
 *   POST   /api/tasks/:key/comments {body}                comment
 *
 * The caller is a principal (person or agent); agents act through the same routes as a person's screen.
 */
import express from 'express';
import * as tasks from '../services/xenoTasks.js';
import { resolvePrincipal, assertPrincipalUsable } from '../services/agentIdentity.js';

const router = express.Router();   // mounted behind authMiddleware in index.js

router.use(async (req, res, next) => {
  try { const p = await resolvePrincipal(req.db, req.user.id); assertPrincipalUsable(p); req.me = { id: p.id, kind: p.kind, role: p.role }; next(); }
  catch (error) { res.status(error.statusCode || 403).json({ success: false, error: error.message || 'Not allowed', code: error.code || 'not_allowed' }); }
});
const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (error) {
    if (error instanceof tasks.TaskError) return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    console.error('[tasks]', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

router.get('/', handled(async (req, res) => {
  res.json({ success: true, tasks: await tasks.listTasks(req.db, req.me, { area: req.query.area, projectId: req.query.projectId, status: req.query.status, assignee: req.query.assignee, q: req.query.q, limit: req.query.limit }) });
}));
router.post('/', handled(async (req, res) => {
  res.status(201).json({ success: true, task: await tasks.createTask(req.db, req.me, req.body || {}) });
}));
router.get('/:key', handled(async (req, res) => { res.json({ success: true, task: await tasks.getTask(req.db, req.me, req.params.key) }); }));
router.patch('/:key', handled(async (req, res) => { res.json({ success: true, task: await tasks.updateTask(req.db, req.me, req.params.key, req.body || {}) }); }));
router.post('/:key/transition', handled(async (req, res) => { res.json({ success: true, task: await tasks.transitionTask(req.db, req.me, req.params.key, { to: req.body?.to, note: req.body?.note, from: req.body?.from }) }); }));
router.post('/:key/claim', handled(async (req, res) => { res.json({ success: true, task: await tasks.claimTask(req.db, req.me, req.params.key) }); }));
router.post('/:key/comments', handled(async (req, res) => { res.json({ success: true, task: await tasks.commentTask(req.db, req.me, req.params.key, { body: req.body?.body }) }); }));

export default router;
