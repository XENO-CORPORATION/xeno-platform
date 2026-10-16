/**
 * Platform agents (services/platformAgents.js). The person's own signed-in session only — an agent's token is refused.
 *
 *   GET    /api/agents[?division=<id>|none]       the person's agents
 *   POST   /api/agents                            { name, description, instructions?, divisionId? } → the agent (id = agt_…)
 *   GET    /api/agents/:id                        { id, name, description, owner, projects, credentials, connections }
 *   PATCH  /api/agents/:id                        { name?, description?, instructions? }  (instructions = a new version)
 *   GET    /api/agents/presence                   each agent: working | online | cloud | offline | new | paused, and canTakeWork
 *   GET    /api/agents/presence/stream            the same, live (Server-Sent Events): a snapshot, then each change
 *   GET    /api/agents/:id/activity               its log: task actions, XENO MCP calls (metadata only) and cloud runs, newest first
 *   GET    /api/agents/lends/inbox                offers to lend an agent into a workspace you administer
 *   POST   /api/agents/lends/:lendId/accept|decline|revoke
 *   POST   /api/agents/:id/lend                   { divisionId? , workspaceId? } — lend it there (accepted at once when you administer the target)
 *   PUT    /api/agents/:id/webhook                { url | null } — where it hears about new work (the signing secret is shown once)
 *   PUT    /api/agents/:id/division               { divisionId | null } — its owning division; projects outside it are removed
 *   GET    /api/agents/:id/project-choices        projects it could be given, each saying whether its division matches
 *   DELETE /api/agents/:id                        deletes it; every credential and connection stops working
 *   POST   /api/agents/:id/credentials            { ttlHours?=1, scopes?, label? } → { id, token (xtk_…, shown once), expiresAt, scopes }
 *   DELETE /api/agents/:id/credentials/:cid
 *   PUT    /api/agents/:id/projects/:projectId    { access: viewer|editor }
 *   DELETE /api/agents/:id/projects/:projectId
 */
import express from 'express';
import * as agents from '../services/platformAgents.js';
import { TaskError } from '../services/xenoTasks.js';
import { DivisionError } from '../services/workforceDivisions.js';
import * as lending from '../services/agentLending.js';
import * as cloudRuns from '../services/agentCloudRuns.js';
import * as access from '../services/agentAccess.js';
import * as presence from '../services/agentPresence.js';
import * as presenceStream from '../services/agentPresenceStream.js';
import { requireConfirmation } from '../services/accountConfirmation.js';
import * as transfer from '../services/workforceOwnershipTransfer.js';

const router = express.Router();
const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof agents.AgentError || e instanceof TaskError || e instanceof DivisionError || e instanceof lending.LendError || e instanceof cloudRuns.AgentRunError || e instanceof access.AccessError) return res.status(e.status).json({ success: false, error: e.message, code: e.code });
    console.error('[agents]', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
// runs after personOnly (xenoMcpRoutes), which sets req.owner; the owner acts as a person
router.use((req, _res, next) => { req.me = { id: req.owner, kind: 'human' }; next(); });

// lending: offers waiting for you (as a target admin), and deciding or ending one -- before '/:id' so 'lends' is not an id
router.get('/lends/inbox', handled(async (req, res) => { res.json({ success: true, offers: await lending.inbox(req.db, req.me) }); }));
router.post('/lends/:lendId/accept', handled(async (req, res) => { res.json({ success: true, lend: await lending.decide(req.db, req.me, req.params.lendId, true) }); }));
router.post('/lends/:lendId/decline', handled(async (req, res) => { res.json({ success: true, lend: await lending.decide(req.db, req.me, req.params.lendId, false) }); }));
router.post('/lends/:lendId/revoke', handled(async (req, res) => { res.json({ success: true, lend: await lending.revoke(req.db, req.me, req.params.lendId) }); }));
// presence (online / working / cloud / offline …) for every agent you can see, and one agent's activity log
router.get('/presence/stream', async (req, res) => { try { await presenceStream.serve(req, res); } catch (e) { console.error('[agents presence stream]', e); if (!res.headersSent) res.status(500).json({ success: false, error: 'Internal server error' }); else res.end(); } });
router.get('/presence', handled(async (req, res) => { res.json({ success: true, agents: await presence.presenceAll(req.db, req.me) }); }));
router.get('/:id/activity', handled(async (req, res) => { res.json({ success: true, ...(await presence.activity(req.db, req.me, req.params.id, { limit: req.query.limit, before: req.query.before })) }); }));
router.get('/', handled(async (req, res) => { res.json({ success: true, agents: await agents.list(req.db, req.me, { divisionId: req.query.division ? String(req.query.division) : null }) }); }));
router.post('/', handled(async (req, res) => { res.status(201).json({ success: true, agent: await agents.create(req.db, req.me, req.body || {}) }); }));
router.get('/:id', handled(async (req, res) => { res.json({ success: true, agent: await agents.get(req.db, req.me, req.params.id) }); }));
// cloud runs: run the agent on a task, in the cloud (agentCloudRuns.js)
router.post('/runs/:runId/stop', handled(async (req, res) => { res.json({ success: true, run: await cloudRuns.stop(req.db, req.me, req.params.runId) }); }));
router.get('/:id/runs', handled(async (req, res) => { res.json({ success: true, runs: await cloudRuns.listForAgent(req.db, req.me, req.params.id) }); }));
router.post('/:id/runs', handled(async (req, res) => {
  const run = await cloudRuns.start(req.db, req.me, req.params.id, { taskKey: req.body?.task, budgetCredits: req.body?.budgetCredits });
  res.status(run.existing ? 200 : 201).json({ success: true, run });
}));
// company ownership and the four rights (agentAccess.js). Changing who answers for an agent, or giving it away, is
// a sensitive act: the browser must have confirmed it is you recently.
const agentUser = async (req) => (await agents.get(req.db, req.me, req.params.id)).userId;
router.get('/:id/access', handled(async (req, res) => { res.json({ success: true, access: await access.accessList(req.db, req.me, await agentUser(req)) }); }));
router.put('/:id/access/:userId/:right', handled(async (req, res) => { res.json({ success: true, access: await access.setRight(req.db, req.me, await agentUser(req), { userId: req.params.userId, right: req.params.right, grant: true }) }); }));
router.delete('/:id/access/:userId/:right', handled(async (req, res) => { res.json({ success: true, access: await access.setRight(req.db, req.me, await agentUser(req), { userId: req.params.userId, right: req.params.right, grant: false }) }); }));
router.post('/:id/accountable', requireConfirmation(), handled(async (req, res) => { res.json({ success: true, access: await access.setAccountable(req.db, req.me, await agentUser(req), { toUserId: req.body?.userId, note: req.body?.note }) }); }));
// Moving the agent to another owner (a company, or a person) is the OWN-05 two-sided transfer, unchanged -- the
// same service as /api/workforce/ownership-transfers. This is its browser door: a cookie session that has just
// confirmed it is you (never an API key or a bearer token a script could hold), for an agent this person manages.
const browserOnly = (req, res, next) => (req.browserSession && req.browserSession.sid
  ? next() : res.status(403).json({ success: false, error: 'This needs a signed-in browser session', code: 'confirmation_unavailable' }));
const T_STATUS = { bad_input: 400, denied: 403, not_found: 404, conflict: 409 };
const TRANSFER_REASON = {
  transfer_to_current_owner: 'It already belongs there', transfer_already_in_progress: 'A move is already in progress',
  destination_unavailable: 'That workspace is not available', destination_acceptance_required: 'Only an admin of the receiving workspace can accept',
  source_authorization_required: 'Only its current owner can approve the move', live_assignments_must_be_settled: 'It is still lent out; end its lends first',
  definition_changed_since_review: 'Its instructions changed since the review; review again', review_secret_references_incomplete: 'The review must list every secret it uses',
  transfer_not_found: 'Move not found', resource_not_found: 'Agent not found',
};
const viaTransfer = (fn) => handled(async (req, res) => {
  try { res.json({ success: true, ...(await fn(req)) }); }
  catch (e) {
    if (e instanceof transfer.OwnershipTransferError) {
      const reason = e.details && e.details.reason;
      return res.status(T_STATUS[e.code] || 400).json({ success: false, code: reason || e.code, error: TRANSFER_REASON[reason] || 'The move was refused' });
    }
    throw e;
  }
});
router.get('/:id/transfers', viaTransfer(async (req) => {
  const a = await agents.get(req.db, req.me, req.params.id);
  const rows = (await req.db.query('SELECT * FROM workforce_ownership_transfers WHERE resource_id = $1 ORDER BY created_at DESC LIMIT 10', [a.definitionId])).rows;
  return { transfers: rows.map(transfer.publicTransfer) };
}));
router.post('/:id/transfers', browserOnly, requireConfirmation(), viaTransfer(async (req) => {
  const a = await agents.get(req.db, req.me, req.params.id);
  if (!a.rights || !a.rights.manage) throw new agents.AgentError('Only its owner or a workspace admin can move it', 'not_allowed', 403);
  const to = req.body?.workspaceId ? { type: 'workspace', id: String(req.body.workspaceId) } : req.body?.userId ? { type: 'user', id: String(req.body.userId) } : null;
  if (!to) throw new agents.AgentError('Choose where to move it', 'invalid_target');
  // propose and authorize are both the source's acts; the source is the person asking, so do them together
  const t = await transfer.proposeOwnershipTransfer(req.db, { actorUserId: req.user.id, resourceId: a.definitionId, to });
  return { transfer: await transfer.authorizeOwnershipTransfer(req.db, { actorUserId: req.user.id, transferId: t.id }) };
}));
// agents being moved TO a workspace I administer (or to me), waiting for my review or acceptance
router.get('/transfers/inbox', handled(async (req, res) => {
  const rows = (await req.db.query(`SELECT t.*, ai.public_id AS agent_public_id, COALESCE(au.display_name, au.username) AS agent_name, w.name AS to_workspace_name,
        COALESCE(u.display_name, u.username) AS from_name
      FROM workforce_ownership_transfers t
      JOIN agent_identities ai ON ai.workforce_resource_id = t.resource_id
      JOIN users au ON au.id = ai.user_id
      LEFT JOIN workspaces w ON w.id = t.to_owner_workspace_id LEFT JOIN users u ON u.id = t.proposed_by_user_id
     WHERE t.state IN ('authorized', 'reviewed') AND t.resource_kind = 'agent'
       AND (t.to_owner_user_id = $1 OR (w.status = 'active' AND (w.owner_user_id = $1 OR EXISTS (SELECT 1 FROM relationship_tuples x
             WHERE x.object_type = 'workspace' AND x.object_id = w.id::text AND x.subject_type = 'user' AND x.subject_id = $1::text AND x.relation IN ('owner', 'admin')))))
     ORDER BY t.created_at DESC LIMIT 20`, [req.user.id])).rows;
  res.json({ success: true, transfers: rows.map((r) => ({ ...transfer.publicTransfer(r), agent: { id: r.agent_public_id, name: r.agent_name }, toName: r.to_workspace_name || 'You', fromName: r.from_name })) });
}));
router.get('/transfers/:tid/review-subject', viaTransfer(async (req) => ({ subject: await transfer.transferReviewSubject(req.db, { actorUserId: req.user.id, transferId: req.params.tid }) })));
router.post('/transfers/:tid/review', browserOnly, requireConfirmation(), viaTransfer(async (req) => ({
  transfer: await transfer.reviewOwnershipTransfer(req.db, { actorUserId: req.user.id, transferId: req.params.tid, agentVersion: req.body?.agentVersion ?? null, review: req.body?.review }) })));
router.post('/transfers/:tid/accept', browserOnly, requireConfirmation(), viaTransfer(async (req) => ({
  transfer: await transfer.acceptOwnershipTransfer(req.db, { actorUserId: req.user.id, transferId: req.params.tid, rationale: req.body?.rationale }) })));
router.post('/transfers/:tid/decline', browserOnly, viaTransfer(async (req) => ({
  transfer: await transfer.declineOwnershipTransfer(req.db, { actorUserId: req.user.id, transferId: req.params.tid, reason: req.body?.reason }) })));
router.patch('/:id', handled(async (req, res) => { res.json({ success: true, agent: await agents.update(req.db, req.me, req.params.id, req.body || {}) }); }));
router.delete('/:id', handled(async (req, res) => { res.json({ success: true, ...(await agents.remove(req.db, req.me, req.params.id)) }); }));
router.put('/:id/division', handled(async (req, res) => { res.json({ success: true, agent: await agents.setDivision(req.db, req.me, req.params.id, (req.body && req.body.divisionId) || null) }); }));
router.get('/:id/project-choices', handled(async (req, res) => { res.json({ success: true, projects: await agents.projectChoices(req.db, req.me, req.params.id) }); }));
router.post('/:id/lend', handled(async (req, res) => { res.status(201).json({ success: true, agent: await agents.lend(req.db, req.me, req.params.id, req.body || {}) }); }));
router.put('/:id/webhook', handled(async (req, res) => { res.set('cache-control', 'no-store'); res.json({ success: true, ...(await agents.setWebhook(req.db, req.me, req.params.id, req.body && req.body.url)) }); }));
router.post('/:id/credentials', handled(async (req, res) => {
  res.set('cache-control', 'no-store');
  res.status(201).json({ success: true, credential: await agents.mintCredential(req.db, req.me, req.params.id, req.body || {}) });
}));
router.delete('/:id/credentials/:cid', handled(async (req, res) => { res.json({ success: true, ...(await agents.revokeCredential(req.db, req.me, req.params.id, req.params.cid)) }); }));
router.put('/:id/projects/:projectId', handled(async (req, res) => { res.json({ success: true, agent: await agents.addProject(req.db, req.me, req.params.id, req.params.projectId, (req.body && req.body.access) || 'editor') }); }));
router.delete('/:id/projects/:projectId', handled(async (req, res) => { res.json({ success: true, agent: await agents.removeProject(req.db, req.me, req.params.id, req.params.projectId) }); }));

export default router;
