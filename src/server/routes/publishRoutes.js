/**
 * /api/publish — the workspace's Publish area, backed by XENO Post (services/xenoPost.js). Mounted behind
 * authMiddleware. Every route takes `workspace` (query or body; absent = the person's Personal workspace).
 *
 *   GET  /status                       configured? linked? which xeno-post workspace
 *   PUT  /link        {postWorkspaceId}       admins only; proven against xeno-post before it is saved
 *   GET  /channels                     · POST /channels/connect {platform} → { url }  (admins; xeno-post owns the OAuth)
 *   GET  /posts?state=                 · POST /posts {text, channelIds, media[], requestKey} → a draft
 *   POST /posts/:id/schedule {at}      · POST /posts/:id/publish {confirm:true} · POST /posts/:id/retract {confirm:true}
 *   GET  /approvals                    · POST /approvals/:kind/:id {approve, confirm}
 *   GET  /inbox
 *
 * A request made with an agent's credential is the agent (resolved from agent_identities in the service), so it
 * acts for its owner and cannot publish, retract or approve.
 */
import express from 'express';
import * as P from '../services/xenoPost.js';

const router = express.Router();
const ws = (req) => (req.body && req.body.workspace) || req.query.workspace || null;
const actorOf = async (req) => {
  const isAgent = (await req.db.query('SELECT 1 FROM agent_identities WHERE user_id = $1', [req.user.id])).rows.length > 0;
  return { id: req.user.id, kind: isAgent ? 'agent' : 'human' };
};
const run = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req, await actorOf(req))) }); }
  catch (e) {
    if (e instanceof P.PublishError) return res.status(e.status).json({ success: false, code: e.code, error: e.message });
    console.error('Publish failed:', e); res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

router.get('/status', run((req, a) => P.status(req.db, a, { workspace: ws(req) })));
router.put('/link', run((req, a) => P.linkWorkspace(req.db, a, { workspace: ws(req), postWorkspaceId: req.body && req.body.postWorkspaceId })));
router.get('/channels', run((req, a) => P.listChannels(req.db, a, { workspace: ws(req) })));
router.post('/channels/connect', run((req, a) => P.connectChannelUrl(req.db, a, { workspace: ws(req), platform: req.body && req.body.platform })));
router.get('/posts', run((req, a) => P.listPosts(req.db, a, { workspace: ws(req), state: req.query.state })));
router.post('/posts', run((req, a) => P.createDraft(req.db, a, { workspace: ws(req), text: req.body?.text, channelIds: req.body?.channelIds, media: req.body?.media || [], requestKey: req.body?.requestKey })));
router.post('/posts/:id/schedule', run((req, a) => P.schedulePost(req.db, a, { workspace: ws(req), postId: req.params.id, at: req.body?.at })));
router.post('/posts/:id/publish', run((req, a) => P.publishNow(req.db, a, { workspace: ws(req), postId: req.params.id, confirm: req.body?.confirm })));
router.post('/posts/:id/retract', run((req, a) => P.retractPost(req.db, a, { workspace: ws(req), postId: req.params.id, confirm: req.body?.confirm })));
router.get('/approvals', run((req, a) => P.listApprovals(req.db, a, { workspace: ws(req) })));
router.post('/approvals/:kind/:id', run((req, a) => P.decideApproval(req.db, a, { workspace: ws(req), kind: req.params.kind, id: req.params.id, approve: req.body?.approve === true, confirm: req.body?.confirm })));
router.get('/inbox', run((req, a) => P.listInbox(req.db, a, { workspace: ws(req) })));

export default router;
