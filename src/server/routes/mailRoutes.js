/**
 * /api/mail — the workspace's Mail area, a front-end to XENO Mail (services/xenoMail.js). Mounted behind authMiddleware.
 * Every route takes `workspace` (query or body; absent = the person's Personal workspace).
 *
 *   GET    /status                                  configured? a mailbox for this person? which address this workspace uses
 *   PUT    /mailbox {address}   DELETE /mailbox      which of the person's own addresses this workspace uses (a person's act)
 *   GET    /threads?folder=&labelId=&q=             GET /threads/:id
 *   POST   /threads/read {threadIds, unread}        POST /threads/star {threadIds, starred}
 *   POST   /threads/label {threadIds, add, remove}  (label IDS)   POST /threads/archive {threadIds, undo}
 *   GET    /labels                                  POST /labels {name}
 *   GET    /drafts   GET /drafts/:id   DELETE /drafts/:id (a person's act)
 *   POST   /compose {to, cc, bcc, subject, body, threadId, draftId, send, confirm}
 *                                                   send needs a person and confirm:true; an agent's send is a draft
 *   POST   /threads/:id/task {projectId}   POST /threads/:id/ticket {kind}   POST /threads/:id/contact
 */
import express from 'express';
import * as M from '../services/xenoMail.js';
import { TaskError } from '../services/xenoTasks.js';
import { SupportError } from '../services/supportTickets.js';
import { CustomersError } from '../services/customers.js';

const router = express.Router();
const ws = (req) => (req.body && req.body.workspace) || req.query.workspace || null;
const actorOf = async (req) => {
  const isAgent = (await req.db.query('SELECT 1 FROM agent_identities WHERE user_id = $1', [req.user.id])).rows.length > 0;
  return { id: req.user.id, kind: isAgent ? 'agent' : 'human', role: req.user.role };
};
const run = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req, await actorOf(req))) }); }
  catch (e) {
    if (e instanceof M.MailError || e instanceof TaskError || e instanceof SupportError || e instanceof CustomersError) return res.status(e.status || e.statusCode || 400).json({ success: false, code: e.code, error: e.message });
    console.error('Mail failed:', e); res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
const b = (req) => req.body || {};

router.get('/status', run((req, a) => M.status(req.db, a, { workspace: ws(req) })));
router.put('/mailbox', run((req, a) => M.setMailbox(req.db, a, { workspace: ws(req), address: b(req).address })));
router.delete('/mailbox', run((req, a) => M.clearMailbox(req.db, a, { workspace: ws(req) })));
router.get('/threads', run((req, a) => M.listThreads(req.db, a, { workspace: ws(req), folder: req.query.folder, q: req.query.q, labelId: req.query.labelId, limit: req.query.limit })));
router.post('/threads/read', run((req, a) => M.markRead(req.db, a, { workspace: ws(req), threadIds: b(req).threadIds, unread: b(req).unread === true })));
router.post('/threads/star', run((req, a) => M.starThreads(req.db, a, { workspace: ws(req), threadIds: b(req).threadIds, starred: b(req).starred !== false })));
router.post('/threads/label', run((req, a) => M.labelThreads(req.db, a, { workspace: ws(req), threadIds: b(req).threadIds, add: b(req).add, remove: b(req).remove })));
router.post('/threads/archive', run((req, a) => M.archiveThreads(req.db, a, { workspace: ws(req), threadIds: b(req).threadIds, undo: b(req).undo === true })));
router.get('/threads/:id', run((req, a) => M.getThread(req.db, a, { workspace: ws(req), threadId: req.params.id })));
router.post('/threads/:id/task', run((req, a) => M.toTask(req.db, a, { workspace: ws(req), threadId: req.params.id, projectId: b(req).projectId })));
router.post('/threads/:id/ticket', run((req, a) => M.toTicket(req.db, a, { workspace: ws(req), threadId: req.params.id, kind: b(req).kind })));
router.post('/threads/:id/contact', run((req, a) => M.toContact(req.db, a, { workspace: ws(req), threadId: req.params.id })));
router.get('/labels', run((req, a) => M.listLabels(req.db, a, { workspace: ws(req) })));
router.post('/labels', run((req, a) => M.createLabel(req.db, a, { workspace: ws(req), name: b(req).name })));
router.get('/drafts', run((req, a) => M.listDrafts(req.db, a, { workspace: ws(req) })));
router.get('/drafts/:id', run((req, a) => M.getDraft(req.db, a, { workspace: ws(req), draftId: req.params.id })));
router.delete('/drafts/:id', run((req, a) => M.deleteDraft(req.db, a, { workspace: ws(req), draftId: req.params.id })));
router.post('/compose', run((req, a) => { const x = b(req); return M.compose(req.db, a, { workspace: ws(req), to: x.to, cc: x.cc, bcc: x.bcc, subject: x.subject, body: x.body, threadId: x.threadId, draftId: x.draftId, send: x.send === true, confirm: x.confirm === true }); }));

export default router;
