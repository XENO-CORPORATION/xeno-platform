/**
 * /api/message — the workspace's Message area, a front-end to XENO Comms (services/xenoComms.js). Mounted behind
 * authMiddleware. Every route takes `workspace` (query or body; absent = the person's Personal workspace).
 *
 *   GET  /status                              configured? realtime?
 *   GET  /conversations                       the caller's channels (one per scope) and direct messages here
 *   POST /channels/open {key}                 find or create the scope's channel; membership = its audience
 *   GET  /messages?key=|conversationId=&thread=
 *   POST /messages {key|conversationId, text, replyTo, clientMessageId}
 *   POST /direct {userId}                     a direct message with a co-member of this workspace
 *   POST /handoff {key|conversationId, messageId, agentId, prompt}   @agent: the chat's hand-off
 *   GET  /realtime                            a single-use ticket for the Comms gateway
 *   GET  /directory                           co-members, for the New message dialog
 *
 * Scope keys: `workspace`, `division:<id>`, `team:<id>`, `project:<id>`.
 */
import express from 'express';
import * as M from '../services/xenoComms.js';

const router = express.Router();
const ws = (req) => (req.body && req.body.workspace) || req.query.workspace || null;
const run = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req, { id: req.user.id })) }); }
  catch (e) {
    if (e instanceof M.MessageError) return res.status(e.status).json({ success: false, code: e.code, error: e.message });
    console.error('Message failed:', e); res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

router.get('/status', run((req, a) => M.status(req.db, a, { workspace: ws(req) })));
router.get('/conversations', run((req, a) => M.listConversations(req.db, a, { workspace: ws(req) })));
router.post('/channels/open', run(async (req, a) => { const r = await M.openChannel(req.db, a, { workspace: ws(req), key: req.body?.key }); return { channel: r.channel }; }));
router.get('/messages', run((req, a) => M.readMessages(req.db, a, { workspace: ws(req), key: req.query.key || null, conversationId: req.query.conversationId || null, thread: req.query.thread || null })));
router.post('/messages', run((req, a) => M.postMessage(req.db, a, { workspace: ws(req), key: req.body?.key || null, conversationId: req.body?.conversationId || null, text: req.body?.text, replyTo: req.body?.replyTo || null, clientMessageId: req.body?.clientMessageId })));
router.post('/direct', run((req, a) => M.openDirect(req.db, a, { workspace: ws(req), userId: req.body?.userId })));
router.post('/handoff', run((req, a) => M.handOff(req.db, a, { workspace: ws(req), key: req.body?.key || null, conversationId: req.body?.conversationId || null, messageId: req.body?.messageId || null, agentId: req.body?.agentId, prompt: req.body?.prompt, run: req.body?.run !== false })));
router.get('/realtime', run((req, a) => M.realtimeTicket(req.db, a, { workspace: ws(req) })));
router.get('/directory', run((req, a) => M.directory(req.db, a, { workspace: ws(req) })));

export default router;
