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
// SES-04: Agent->Chat occurs at a safe execution boundary. The move refuses
// while the actor has active operations (prepared workspace intents, held
// run reservations) unless every one is explicitly dispositioned -- and a
// 'settled' claim is VERIFIED terminal, never trusted: the host must have
// stopped/settled first. Parked and failed dispositions require a note (user-
// visible effects explicitly parked, failures named). The handoff records the
// relinquished root (copied from the recorded Chat->Agent move), the full
// disposition map, and the restored read-only posture. Capability revocation
// itself is host-enforced; this record is the contract the host answers to.
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

/** Active operations of an actor: prepared intents + held run reservations. */
async function activeOperations(client, actor) {
  const intents = (await client.query(
    `SELECT client_id, operation_id::text AS operation_id FROM account_workspace_operations
     WHERE actor_user_id=$1 AND state='prepared' ORDER BY 1, 2`,
    [actor],
  )).rows.map((r) => ({ kind: 'intent', key: `${r.client_id}/${r.operation_id}` }));
  const holds = (await client.query(
    `SELECT a.id::text AS id FROM workforce_run_admissions a
     JOIN workforce_run_funding f ON f.admission_id=a.id
     JOIN credit_holds h ON h.id=f.hold_row_id
     WHERE a.actor_user_id=$1 AND h.state='held' ORDER BY 1`,
    [actor],
  )).rows.map((r) => ({ kind: 'admission', key: r.id }));
  return [...intents, ...holds];
}

async function isSettled(client, actor, op) {
  if (op.kind === 'intent') {
    const [clientId, operationId] = op.key.split('/');
    const row = (await client.query(
      'SELECT state FROM account_workspace_operations WHERE actor_user_id=$1 AND client_id=$2 AND operation_id=$3',
      [actor, clientId, operationId],
    )).rows[0];
    return !!row && row.state !== 'prepared';
  }
  const row = (await client.query(
    `SELECT h.state FROM workforce_run_funding f JOIN credit_holds h ON h.id=f.hold_row_id
     WHERE f.admission_id=$1`,
    [op.key],
  )).rows[0];
  return !!row && row.state !== 'held';
}

/**
 * Move an agent-mode conversation back to chat at a safe execution boundary.
 * dispositions: [{ kind:'intent'|'admission', key, action:'settled'|'parked'|'failed', note? }]
 * covering EVERY active op of the actor; parked/failed require a note.
 */
export async function transitionToChat(poolOrClient, { conversationId, actorUserId, dispositions = [] }) {
  const convId = uuid(conversationId, 'conversation');
  const actor = uuid(actorUserId, 'actor');
  if (!Array.isArray(dispositions)) bad('bad_input', 'invalid_dispositions');
  return withTx(poolOrClient, async (client) => {
    const conv = (await client.query(
      'SELECT id, mode, owner_user_id, project_id FROM chat_conversations WHERE id=$1 FOR UPDATE',
      [convId],
    )).rows[0];
    if (!conv) bad('not_found', 'conversation_not_found');
    if (conv.mode !== 'agent') bad('conflict', 'mode_not_agent');
    if (conv.owner_user_id !== null && conv.owner_user_id !== actor) bad('denied', 'handoff_not_authorized');
    if (conv.project_id !== null && !(await holdsProject(client, actor, conv.project_id))) bad('denied', 'handoff_not_authorized');
    const prior = (await client.query(
      `SELECT root_kind, root_project_id FROM conversation_mode_transitions
       WHERE conversation_id=$1 AND from_mode='chat' AND to_mode='agent' ORDER BY created_at DESC LIMIT 1`,
      [convId],
    )).rows[0];
    if (!prior) bad('conflict', 'no_recorded_root');
    const active = await activeOperations(client, actor);
    const byKey = new Map(active.map((op) => [`${op.kind}:${op.key}`, op]));
    const seen = new Set();
    for (const d of dispositions) {
      if (!d || (d.kind !== 'intent' && d.kind !== 'admission') || typeof d.key !== 'string') bad('bad_input', 'invalid_dispositions');
      if (d.action !== 'settled' && d.action !== 'parked' && d.action !== 'failed') bad('bad_input', 'invalid_disposition_action');
      const id = `${d.kind}:${d.key}`;
      if (!byKey.has(id) || seen.has(id)) bad('conflict', 'disposition_unknown_or_duplicate');
      seen.add(id);
      if ((d.action === 'parked' || d.action === 'failed') && (typeof d.note !== 'string' || !d.note.trim())) {
        bad('bad_input', d.action === 'parked' ? 'park_note_required' : 'failure_reason_required');
      }
      if (d.action === 'settled' && !(await isSettled(client, actor, byKey.get(id)))) bad('conflict', 'settle_not_verified');
    }
    const uncovered = active.filter((op) => !seen.has(`${op.kind}:${op.key}`));
    if (uncovered.length > 0) {
      throw Object.assign(new Error('active_operations'), { code: 'conflict',
        details: { uncovered: uncovered.map((op) => ({ kind: op.kind, key: op.key })) } });
    }
    const handoff = {
      dispositions: dispositions.map((d) => ({ kind: d.kind, key: d.key, action: d.action, ...(d.note ? { note: d.note } : {}) })),
      activeOpsAtHandoff: active.length,
      relinquishedRoot: { kind: prior.root_kind, ...(prior.root_project_id ? { projectId: prior.root_project_id } : {}) },
      restoredPosture: 'read-only',
    };
    const row = (await client.query(
      `INSERT INTO conversation_mode_transitions(conversation_id,from_mode,to_mode,root_kind,root_project_id,authorized_by_user_id,pending_state)
       VALUES($1,'agent','chat',$2,$3,$4,$5) RETURNING id, created_at`,
      [convId, prior.root_kind, prior.root_project_id, actor, JSON.stringify(handoff)],
    )).rows[0];
    await client.query("UPDATE chat_conversations SET mode='chat' WHERE id=$1", [convId]);
    return { transitionId: row.id, conversationId: convId, fromMode: 'agent', toMode: 'chat', handoff };
  });
}
