// SES-05: moving/sharing a conversation is separate from mode/root changes.
//
// A scope move rebinds ONLY the ownership columns (owner_user_id XOR
// project_id). It never writes mode and never inserts a mode transition --
// the proof asserts both survive byte-for-byte. Every move declares its
// target audience and the exact history count moving with it; a wrong count
// or a mismatched audience is refused, so no private history transfers
// silently. An active provider session grant (SES-02 workdir) must be
// settled via releaseProviderCwd first: the move refuses while the provider
// still owns session storage.
//
// Workspace scopes are refused (workspace_moves_unsupported): like SES-03,
// there is no authorization source for workspace roots, so no workspace move
// can be honestly authorized here. Tracked, not improvised.
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

const scopeOf = (conv) => (conv.owner_user_id !== null
  ? `personal:${conv.owner_user_id}`
  : conv.project_id !== null ? `project:${conv.project_id}` : 'unscoped');

/**
 * Move a conversation to another scope, recording audience + history manifest.
 * to: { kind:'project', projectId } | { kind:'personal', ownerUserId }.
 * audience: { type:'project'|'user', id, historyMessageCount }.
 */
export async function moveConversationScope(poolOrClient, { conversationId, actorUserId, to, audience }) {
  const convId = uuid(conversationId, 'conversation');
  const actor = uuid(actorUserId, 'actor');
  if (!to || (to.kind !== 'project' && to.kind !== 'personal')) bad('bad_input', 'invalid_target');
  const targetProject = to.kind === 'project' ? uuid(to.projectId, 'project') : null;
  const targetOwner = to.kind === 'personal' ? uuid(to.ownerUserId, 'owner') : null;
  return withTx(poolOrClient, async (client) => {
    const conv = (await client.query(
      'SELECT id, mode, owner_user_id, project_id, workspace_id FROM chat_conversations WHERE id=$1 FOR UPDATE',
      [convId],
    )).rows[0];
    if (!conv) bad('not_found', 'conversation_not_found');
    if (conv.workspace_id !== null) bad('denied', 'workspace_moves_unsupported');
    if (targetProject !== null) {
      const live = (await client.query('SELECT id FROM chat_projects WHERE id=$1 AND is_archived=FALSE', [targetProject])).rows[0];
      if (!live) bad('not_found', 'project_not_found');
      if (!(await holdsProject(client, actor, targetProject))) bad('denied', 'move_not_authorized');
    } else if (targetOwner !== actor) {
      bad('denied', 'move_not_authorized');
    }
    if (conv.owner_user_id !== null && conv.owner_user_id !== actor) bad('denied', 'move_not_authorized');
    if (conv.project_id !== null && !(await holdsProject(client, actor, conv.project_id))) bad('denied', 'move_not_authorized');
    const fromScope = scopeOf(conv);
    const toScope = targetProject !== null ? `project:${targetProject}` : `personal:${targetOwner}`;
    if (fromScope === toScope) bad('conflict', 'scope_unchanged');
    const wantType = targetProject !== null ? 'project' : 'user';
    const wantId = targetProject !== null ? targetProject : targetOwner;
    if (!audience || audience.type !== wantType || audience.id !== wantId) bad('bad_input', 'audience_required');
    const count = (await client.query(
      'SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id=$1', [convId])).rows[0].n;
    if (!Number.isInteger(audience.historyMessageCount) || audience.historyMessageCount !== count) {
      bad('conflict', 'history_count_mismatch');
    }
    const active = (await client.query(
      'SELECT conversation_id FROM provider_session_workdirs WHERE conversation_id=$1', [convId])).rows[0];
    if (active) bad('conflict', 'provider_handoff_unsettled');
    if (targetProject !== null) {
      await client.query('UPDATE chat_conversations SET project_id=$2, owner_user_id=NULL WHERE id=$1', [convId, targetProject]);
    } else {
      await client.query('UPDATE chat_conversations SET owner_user_id=$2, project_id=NULL WHERE id=$1', [convId, targetOwner]);
    }
    const row = (await client.query(
      `INSERT INTO conversation_scope_moves(conversation_id,from_scope,to_scope,audience_type,audience_id,history_message_count,moved_by_user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [convId, fromScope, toScope, audience.type, audience.id, count, actor],
    )).rows[0];
    return { moveId: row.id, conversationId: convId, fromScope, toScope,
      audience: { type: audience.type, id: audience.id }, historyMessageCount: count, mode: conv.mode };
  });
}
