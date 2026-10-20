/**
 * XENO-WORKFORCE-01 SES-02/03/04/06/07/08/09 -- the session API.
 *
 * The session services (conversationModes, providerSessionCwd, sessionLineage, providerSelection,
 * conversationTurns) were built and tested with no route. They decide the session rules; they do NOT decide
 * whether the caller may touch the conversation at all -- several take only a conversation id. So this adapter
 * adds exactly one thing, at the boundary: the actor must hold the conversation (`editor` to change it,
 * `viewer` to read it) in the existing ReBAC service, or own it outright. A conversation the actor cannot see
 * answers `not_found`, byte for byte like one that does not exist (NFR-07).
 *
 *   - The session cwd root is HOST-owned (`XENO_SESSION_ROOT`); a client never names it (SES-02).
 *   - Host-only acts -- registering native commands and adapters, acknowledging a dispatch, appending turns,
 *     claiming adapter parity -- are not routed: a person's token must not be able to forge a host receipt.
 *   - The authenticated actor comes from the session (`req.workforceContext`); a body naming one is refused.
 */
import express from 'express';
import { check } from '../utils/authzReBAC.js';
import { resolvePrincipal } from '../services/agentIdentity.js';
import * as modes from '../services/conversationModes.js';
import { resolveProviderCwd, releaseProviderCwd } from '../services/providerSessionCwd.js';
import * as lineage from '../services/sessionLineage.js';
import * as selection from '../services/providerSelection.js';
import { recordBranchIntent } from '../services/conversationTurns.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS = { bad_input: 400, denied: 403, not_found: 404, conflict: 409, unavailable: 503 };
const refuse = (code, reason) => { throw Object.assign(new Error(reason), { code, reason }); };

/** The actor holds this conversation with at least `relation` -- or it does not exist for them. */
export async function assertConversationAccess(db, actorUserId, conversationId, relation) {
  if (typeof conversationId !== 'string' || !UUID.test(conversationId)) refuse('bad_input', 'invalid_conversation');
  const conv = (await db.query('SELECT owner_user_id FROM chat_conversations WHERE id=$1 AND deleted_at IS NULL', [conversationId])).rows[0];
  if (!conv) refuse('not_found', 'conversation_not_found');
  const p = await resolvePrincipal(db, actorUserId);
  if (!p?.usable || !['human', 'agent'].includes(p.kind)) refuse('not_found', 'conversation_not_found');
  if (p.kind === 'human' && conv.owner_user_id === actorUserId) return;
  const verdict = await check(db, { object: `conversation:${conversationId}`, relation, subject: `${p.kind === 'agent' ? 'agent' : 'user'}:${p.id}` });
  if (!verdict.allowed) refuse('not_found', 'conversation_not_found');
}

export function createWorkforceSessionRouter({ env = process.env } = {}) {
  const router = express.Router();
  const route = (relation, keys, service) => async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) refuse('bad_input', 'invalid_body');
      for (const k of Object.keys(body)) if (!keys.includes(k)) refuse('bad_input', 'unknown_field');
      if (relation) await assertConversationAccess(req.db, req.workforceContext.actorUserId, body.conversationId, relation);
      const result = await service(req.db, { ...body, actorUserId: req.workforceContext.actorUserId });
      return res.json({ success: true, result });
    } catch (error) {
      if (Object.hasOwn(STATUS, error?.code)) return res.status(STATUS[error.code]).json({ success: false, code: error.code, reason: error.reason || error.message });
      return res.status(503).json({ success: false, code: 'unavailable' });
    }
  };
  // SES-03 / SES-04 / SES-06: mode changes and resume
  router.post('/mode/agent', route('editor', ['conversationId', 'root'], modes.transitionToAgent));
  router.post('/mode/chat', route('editor', ['conversationId', 'dispositions'], modes.transitionToChat));
  router.post('/resume', route('viewer', ['conversationId', 'hints'], modes.resumeConversation));
  // SES-02: the isolated cwd for a directory-less chat, under the HOST's session root
  router.post('/cwd', route('editor', ['conversationId'], (db, v) => {
    if (!env.XENO_SESSION_ROOT) refuse('unavailable', 'session_root_unconfigured');
    return resolveProviderCwd(db, { conversationId: v.conversationId, sessionRoot: env.XENO_SESSION_ROOT });
  }));
  router.post('/cwd/release', route('editor', ['conversationId'], releaseProviderCwd));
  // SES-07: one lineage, one execution lease
  router.post('/lease/acquire', route('editor', ['conversationId', 'adapter', 'ttlSeconds'], lineage.acquireExecutionLease));
  router.post('/lease/release', route('editor', ['conversationId', 'adapter'], lineage.releaseExecutionLease));
  router.post('/events', route('editor', ['conversationId', 'adapter', 'kind', 'payload', 'presentation'], lineage.appendSessionEvent));
  router.post('/lineage', route('viewer', ['conversationId'], lineage.readSessionLineage));
  // SES-08: provider/model selection and commands -- the person's own selections only
  router.post('/models', route(null, ['provider'], selection.discoverModels));
  router.post('/models/select', route(null, ['provider', 'publicId'], selection.selectModel));
  router.post('/commands', route(null, ['provider'], selection.listNativeCommands));
  router.post('/commands/execute', route(null, ['selectionId', 'command', 'surface'], selection.executeCommand));
  router.post('/commands/read', route(null, ['commandId'], selection.readCommandResult));
  // SES-09: an explicit branch intent (fork / edit-resend / regenerate)
  router.post('/branch-intents', route('editor', ['conversationId', 'branch', 'intent', 'targetTurn'], async (db, v) => {
    // conversationTurns throws plain Errors for its own validation; they are the caller's input, not a fault.
    try { return await recordBranchIntent(db, v); } catch (e) { if (!e.code) refuse('bad_input', e.message); throw e; }
  }));
  // The Changes screen: a conversation's recorded branch intents, or a project's across the conversations in it
  // the actor can see -- each conversation passes the same guard, so a stranger's intent never appears.
  router.post('/branch-intents/list', route(null, ['conversationId', 'projectId'], async (db, v) => {
    if ((v.conversationId === undefined) === (v.projectId === undefined)) refuse('bad_input', 'one_of_conversation_or_project');
    let convs;
    if (v.conversationId !== undefined) {
      await assertConversationAccess(db, v.actorUserId, v.conversationId, 'viewer');
      convs = [v.conversationId];
    } else {
      if (typeof v.projectId !== 'string' || !UUID.test(v.projectId)) refuse('bad_input', 'invalid_project');
      const ids = (await db.query('SELECT id FROM chat_conversations WHERE project_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC NULLS LAST LIMIT 200', [v.projectId])).rows.map((r) => r.id);
      convs = [];
      for (const id of ids) { try { await assertConversationAccess(db, v.actorUserId, id, 'viewer'); convs.push(id); } catch (e) { if (e?.code !== 'not_found') throw e; } }
    }
    if (!convs.length) return { intents: [] };
    const rows = (await db.query(`SELECT i.id, i.conversation_id, c.title, i.branch, i.intent, i.target_turn, i.actor_user_id, i.created_at
      FROM conversation_branch_intents i JOIN chat_conversations c ON c.id=i.conversation_id
      WHERE i.conversation_id = ANY($1::uuid[]) ORDER BY i.created_at DESC LIMIT 200`, [convs])).rows;
    return { intents: rows.map((r) => ({ intentId: r.id, conversationId: r.conversation_id, conversationTitle: r.title, branch: r.branch, intent: r.intent,
      targetTurn: r.target_turn, actorUserId: r.actor_user_id, createdAt: r.created_at.toISOString() })) };
  }));
  return router;
}
