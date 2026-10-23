/**
 * /api/automate — Dev › Automate, the workspace's front-end to XENO Workflow (services/xenoWorkflow.js). Every route
 * resolves the caller as a PRINCIPAL and calls the one service; who may do what is decided there. `?workspace=<id>`
 * (or body `workspace`) picks the workspace, default the caller's Personal one.
 *
 *   GET  /status · GET /catalogue (the runner's node catalogue + the workspace actions a step may call)
 *   GET  / · POST / {name, description, graph} · GET|PUT|DELETE /:id (PUT carries expectedRevision)
 *   POST /:id/enable · /:id/disable · /:id/run · /:id/webhook-secret
 *   GET  /runs (?state=&workflowId=) · GET /runs/:runId · POST /runs/:runId/retry · /runs/:runId/discard
 *
 *   hooks: POST /api/automate/hooks/:id — a signed webhook trigger (no session; HMAC over the raw body)
 */
import express from 'express';
import { resolvePrincipal, assertPrincipalUsable, AgentIdentityError } from '../services/agentIdentity.js';
import * as wf from '../services/xenoWorkflow.js';

const router = express.Router();
async function loadActor(req, res, next) {
  try {
    const p = await resolvePrincipal(req.db, req.user.id);
    assertPrincipalUsable(p);
    req.actor = { id: p.id, role: p.role, kind: p.kind, owner: p.owner };
    next();
  } catch (e) {
    if (e instanceof AgentIdentityError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    console.error('[automate] loadActor', e);
    return res.status(500).json({ success: false, error: 'Could not resolve who you are' });
  }
}
const run = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req)) }); }
  catch (e) {
    if (e instanceof wf.AutomateError) return res.status(e.status).json({ success: false, error: e.message, code: e.code });
    if (e && (e.name === 'WorkspaceCredentialError' || e.name === 'TaskError')) return res.status(e.status || e.statusCode || 400).json({ success: false, error: e.message, code: e.code });
    console.error('[automate]', e);
    return res.status(500).json({ success: false, error: 'Automate is unavailable right now' });
  }
};
router.use(loadActor);
const b = (req) => req.body || {};
const ws = (req) => b(req).workspace || req.query.workspace;

router.get('/status', run(async (req) => wf.status(req.db, req.actor, { workspace: ws(req) })));
router.get('/catalogue', run(async (req) => ({ nodes: await wf.runnerCatalogue(req.db, req.actor, { workspace: ws(req) }), actions: wf.actionCapabilities(), events: wf.EVENTS })));
router.get('/runs', run(async (req) => wf.listRuns(req.db, req.actor, { workspace: ws(req), workflowId: req.query.workflowId, state: req.query.state, limit: req.query.limit })));
router.get('/runs/:runId', run(async (req) => wf.getRun(req.db, req.actor, req.params.runId)));
router.post('/runs/:runId/retry', run(async (req) => wf.retryRun(req.db, req.actor, req.params.runId)));
router.post('/runs/:runId/discard', run(async (req) => wf.discardRun(req.db, req.actor, req.params.runId)));
router.get('/', run(async (req) => wf.listWorkflows(req.db, req.actor, { workspace: ws(req) })));
router.post('/', run(async (req) => wf.createWorkflow(req.db, req.actor, { ...b(req), workspace: ws(req) })));
router.get('/:id', run(async (req) => wf.getWorkflow(req.db, req.actor, req.params.id)));
router.put('/:id', run(async (req) => wf.updateWorkflow(req.db, req.actor, req.params.id, b(req))));
router.delete('/:id', run(async (req) => wf.deleteWorkflow(req.db, req.actor, req.params.id)));
router.post('/:id/enable', run(async (req) => wf.enableWorkflow(req.db, req.actor, req.params.id)));
router.post('/:id/disable', run(async (req) => wf.disableWorkflow(req.db, req.actor, req.params.id)));
router.post('/:id/run', run(async (req) => wf.runNow(req.db, req.actor, req.params.id, { event: b(req).event })));
router.post('/:id/webhook-secret', run(async (req) => wf.rotateWebhookSecret(req.db, req.actor, req.params.id)));

/** The signed webhook trigger. Mounted with express.raw BEFORE the JSON parser: the HMAC covers the exact bytes. */
export const hooksRouter = express.Router();
hooksRouter.post('/:id', async (req, res) => {
  try {
    const r = await wf.receiveWebhook(req.db, { id: req.params.id, raw: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), signature: req.get('x-xeno-signature'), timestamp: req.get('x-xeno-timestamp'), deliveryId: req.get('x-xeno-delivery') });
    res.status(202).json({ success: true, ...r });
  } catch (e) {
    if (e instanceof wf.AutomateError) return res.status(e.status).json({ success: false, error: e.message, code: e.code });
    console.error('[automate hooks]', e);
    res.status(500).json({ success: false, error: 'Could not accept the webhook' });
  }
});

export default router;
