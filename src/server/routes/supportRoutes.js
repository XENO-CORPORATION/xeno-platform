/**
 * /api/support — XENO support requests (services/supportTickets.js; Help ▸ Contact support).
 *
 * Every route resolves the caller as a PRINCIPAL (so a suspended owner silences its agents) and calls the one service:
 * the screens, the REST API and the agent tools (supportMcp.js) share it. Who may read or change what is decided
 * there, never here.
 *
 *   POST   /tickets                      raise one {kind, title, body, attachments[]}
 *   GET    /tickets/mine                 my requests
 *   GET    /tickets/queue                XENO staff / a support agent: the queue (?status=open&kind=&priority=&assignee=me|none&breached=1&q=)
 *   GET    /tickets/:key                 one request (T-<n>); 404 to anyone who may not read it
 *   POST   /tickets/:key/messages        reply {body, internal?, attachments[]}  (an agent's reply is a draft)
 *   POST   /tickets/:key/drafts/:id/send ratify an agent's draft (human staff only) {body?}
 *   POST   /tickets/:key/drafts/:id/discard
 *   POST   /tickets/:key/status          {status, note?}
 *   POST   /tickets/:key/triage          {kind?, priority?}
 *   POST   /tickets/:key/assign          {assigneeId?, delegateAgentId?}
 *   POST   /tickets/:key/merge           {into}
 *   POST   /tickets/:key/task            {taskKey?} link or raise a XENO Tasks task
 *   POST   /tickets/:key/publish         the requester makes it a public Forum Help thread
 *   GET|POST /macros · DELETE /macros/:id  saved replies (staff)
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { resolvePrincipal, assertPrincipalUsable, AgentIdentityError } from '../services/agentIdentity.js';
import * as support from '../services/supportTickets.js';

const router = express.Router();

async function loadActor(req, res, next) {
  try {
    const p = await resolvePrincipal(req.db, req.user.id);
    assertPrincipalUsable(p);
    req.actor = { id: p.id, username: p.handle, display_name: p.displayName, role: p.role, kind: p.kind, owner: p.owner };
    next();
  } catch (e) {
    if (e instanceof AgentIdentityError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    console.error('[support] loadActor', e);
    return res.status(500).json({ success: false, error: 'Could not resolve who you are' });
  }
}
const run = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req)) }); }
  catch (e) {
    if (e instanceof support.SupportError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    if (e && e.name === 'TaskError') return res.status(e.status || e.statusCode || 400).json({ success: false, error: e.message, code: e.code });
    if (e && e.name === 'ForumError') return res.status(e.status || e.statusCode || 400).json({ success: false, error: e.message, code: e.code });
    console.error('[support]', e);
    return res.status(500).json({ success: false, error: 'Support is unavailable right now' });
  }
};
const A = [authMiddleware, loadActor];
const b = (req) => req.body || {};

router.post('/tickets', ...A, run(async (req) => ({ ticket: await support.createTicket(req.db, req.actor, { kind: b(req).kind, title: b(req).title, body: b(req).body, workspaceId: b(req).workspaceId, attachments: b(req).attachments }) })));
router.get('/tickets/mine', ...A, run(async (req) => ({ tickets: await support.listMine(req.db, req.actor) })));
router.get('/tickets/queue', ...A, run(async (req) => ({ tickets: await support.listQueue(req.db, req.actor, { status: req.query.status, kind: req.query.kind, priority: req.query.priority, assignee: req.query.assignee, q: req.query.q, breached: req.query.breached === '1' }) })));
router.get('/tickets/:key', ...A, run(async (req) => ({ ticket: await support.getTicket(req.db, req.actor, req.params.key) })));
router.post('/tickets/:key/messages', ...A, run(async (req) => ({ message: await support.reply(req.db, req.actor, req.params.key, { body: b(req).body, internal: b(req).internal === true, attachments: b(req).attachments }) })));
router.post('/tickets/:key/drafts/:id/send', ...A, run(async (req) => ({ ticket: await support.ratifyDraft(req.db, req.actor, req.params.key, req.params.id, { body: b(req).body }) })));
router.post('/tickets/:key/drafts/:id/discard', ...A, run(async (req) => support.discardDraft(req.db, req.actor, req.params.key, req.params.id)));
router.post('/tickets/:key/status', ...A, run(async (req) => ({ ticket: await support.setStatus(req.db, req.actor, req.params.key, { status: b(req).status, note: b(req).note }) })));
router.post('/tickets/:key/triage', ...A, run(async (req) => ({ ticket: await support.triage(req.db, req.actor, req.params.key, { kind: b(req).kind, priority: b(req).priority }) })));
router.post('/tickets/:key/assign', ...A, run(async (req) => ({ ticket: await support.assign(req.db, req.actor, req.params.key, { assigneeId: b(req).assigneeId, delegateAgentId: b(req).delegateAgentId }) })));
router.post('/tickets/:key/merge', ...A, run(async (req) => ({ ticket: await support.merge(req.db, req.actor, req.params.key, { into: b(req).into }) })));
router.post('/tickets/:key/task', ...A, run(async (req) => ({ ticket: await support.linkTask(req.db, req.actor, req.params.key, { taskKey: b(req).taskKey, projectId: b(req).projectId }) })));
router.post('/tickets/:key/publish', ...A, run(async (req) => ({ ticket: await support.publish(req.db, req.actor, req.params.key) })));
router.get('/macros', ...A, run(async (req) => ({ macros: await support.listMacros(req.db, req.actor) })));
router.post('/macros', ...A, run(async (req) => ({ macro: await support.saveMacro(req.db, req.actor, b(req)) })));
router.delete('/macros/:id', ...A, run(async (req) => support.deleteMacro(req.db, req.actor, req.params.id)));

export default router;
