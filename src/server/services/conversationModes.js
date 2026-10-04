// SES-03: Chat->Agent requires an explicit authorized root.
//
// A conversation in mode 'chat' moves to mode 'agent' only with a named,
// actor-held root: either a project (the actor holds owner or editor on it
// via the ReBAC tuples) or the conversation's own SES-02 session-isolated
// workdir (which must already be provisioned). The move inserts a transition
// row -- from/to, root, authorizer, pending-state snapshot -- and flips the
// mode, atomically. Nothing pending is cleared: messages, workdirs and
// conversation state survive byte-for-byte; the snapshot proves it.
//
// Coherence rules (all refused loudly, never defaulted):
// - bound conversations honor their binding: a project-bound chat cannot
//   transition under a session root (that would shadow the binding) nor
//   under a different project.
// - workspace-bound chats are refused: workspace membership has no
//   authorization source to check against, so no workspace root can be
//   honestly authorized here (tracked, not improvised).
// - Agent->Chat (stop/settle active operations first) is SES-04's move and
//   is not implemented here.
import { check } from '../utils/authzReBAC.js';

const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const uuid = (value, what = 'id') => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) bad('bad_input', `invalid_${what}`);
  return value;
};

async function withTx(poolOrClient, fn) {
  if (typeof poolOrClient.connect === 'function') {
    const client = await poolOrClient.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return fn(poolOrClient);
}

async function holdsProject(client, userId, projectId) {
  for (const relation of ['owner', 'editor']) {
    if ((await check(client, { object: `project:${projectId}`, relation, subject: `user:${userId}` })).allowed) return true;
  }
  return false;
}

/** Move a chat-mode conversation to agent mode under an explicit root. */
export async function transitionToAgent(poolOrClient, { conversationId, actorUserId, root }) {
  const convId = uuid(conversationId, 'conversation');
  const actor = uuid(actorUserId, 'actor');
  if (!root || typeof root !== 'object' || Array.isArray(root)) bad('bad_input', 'authorized_root_required');
  if (root.kind !== 'project' && root.kind !== 'session-isolated') bad('bad_input', 'authorized_root_required');
  const rootProjectId = root.kind === 'project' ? uuid(root.projectId, 'project') : null;
  return withTx(poolOrClient, async (client) => {
    const conv = (await client.query(
      'SELECT id, mode, owner_user_id, project_id, workspace_id, updated_at FROM chat_conversations WHERE id=$1 FOR UPDATE',
      [convId],
    )).rows[0];
    if (!conv) bad('not_found', 'conversation_not_found');
    if (conv.mode !== 'chat') bad('conflict', 'mode_already_agent');
    if (conv.workspace_id !== null) bad('denied', 'workspace_roots_unsupported');
    if (conv.project_id !== null) {
      if (root.kind !== 'project' || rootProjectId !== conv.project_id) bad('denied', 'root_binding_mismatch');
    }
    if (root.kind === 'project') {
      const project = (await client.query('SELECT id FROM chat_projects WHERE id=$1', [rootProjectId])).rows[0];
      if (!project) bad('not_found', 'project_not_found');
      if (!(await holdsProject(client, actor, rootProjectId))) bad('denied', 'root_not_authorized');
    } else {
      const grant = (await client.query('SELECT scope FROM provider_session_workdirs WHERE conversation_id=$1', [convId])).rows[0];
      if (!grant || grant.scope !== 'session-isolated') bad('conflict', 'session_root_not_provisioned');
    }
    const messages = (await client.query('SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id=$1', [convId])).rows[0].n;
    const pending = { messageCount: messages, conversationUpdatedAt: conv.updated_at instanceof Date ? conv.updated_at.toISOString() : String(conv.updated_at) };
    const row = (await client.query(
      `INSERT INTO conversation_mode_transitions(conversation_id,from_mode,to_mode,root_kind,root_project_id,authorized_by_user_id,pending_state)
       VALUES($1,'chat','agent',$2,$3,$4,$5) RETURNING id, created_at`,
      [convId, root.kind, rootProjectId, actor, JSON.stringify(pending)],
    )).rows[0];
    await client.query("UPDATE chat_conversations SET mode='agent' WHERE id=$1", [convId]);
    return { transitionId: row.id, conversationId: convId, fromMode: 'chat', toMode: 'agent', rootKind: root.kind, rootProjectId, pendingState: pending };
  });
}
