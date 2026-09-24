/**
 * XENO-WORKFORCE-01 SES-05: "Moving/sharing a conversation is separate from mode/root changes. Show
 * the target audience and included historical content; no silent transfer of private history. Active
 * provider ownership handoff must settle before a scope move."  §11.1 `agent.session.move`:
 * "source, destination/audience, consent revision".
 *
 * Before this module a move was one field on the general conversation update (`PUT
 * /conversations/:id` with `project_id`), next to title and model. It re-parented the conversation
 * into the project -- so every reader of the project could read its whole history -- without saying
 * who that was, what they would see, or waiting for work still running against the conversation.
 *
 * A move is now two steps, and the second is only valid against what the first showed:
 *
 *   previewConversationMove   the DESTINATION AUDIENCE (every principal the project would give read
 *                             access, by the same ReBAC rule the read path uses) and the INCLUDED
 *                             HISTORY (the message count and the range that will become readable),
 *                             plus a `consentRevision` -- a hash over the destination, that audience
 *                             and that history. Nothing changes.
 *   moveConversation          performs the move ONLY IF the consent revision still matches the state
 *                             now. A new reader added to the project, or a new message in the chat,
 *                             since the preview makes the old consent stale and the move is refused --
 *                             so what was consented to is exactly what happens. It also refuses while
 *                             a run is still active against the conversation (the settle rule).
 *
 * The general update no longer accepts `project_id`: a move is its own action (§11.2 "Move
 * conversation" and "Share conversation" are distinct actions).
 */
import crypto from 'crypto';
import { check, writeTuples } from '../utils/authzReBAC.js';
import { requireResourceRelation, userPrincipal, withTransaction } from './chatProjectAuthority.js';

export class ConversationMoveError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const RELATIONS = ['viewer', 'reviewer', 'editor', 'admin', 'owner'];
const MAX_AUDIENCE = 500;

/**
 * Every user who could READ a conversation parented to `projectId`. Computed by asking the same
 * `check` the read path asks, for each principal that holds any relation on the project or on its
 * owning scope -- so the list cannot disagree with who will actually be able to read it.
 */
export async function projectReadAudience(db, projectId) {
  const project = (await db.query('SELECT id, owner_user_id, workspace_id FROM chat_projects WHERE id=$1', [projectId])).rows[0];
  if (!project) return null;
  const candidates = (await db.query(
    `SELECT DISTINCT subject_id FROM relationship_tuples
      WHERE subject_type='user' AND ((object_type='project' AND object_id=$1::text)
         OR (object_type='workspace' AND $2::text IS NOT NULL AND object_id=$2::text))`,
    [String(projectId), project.workspace_id ? String(project.workspace_id) : null],
  )).rows.map((row) => row.subject_id);
  if (project.owner_user_id) candidates.push(String(project.owner_user_id));
  const readers = [];
  for (const userId of [...new Set(candidates)].sort()) {
    if ((await check(db, { object: `project:${projectId}`, relation: 'viewer', subject: `user:${userId}` })).allowed) readers.push(userId);
    if (readers.length > MAX_AUDIENCE) break;
  }
  return readers;
}

async function moveState(db, { userId, conversationId, projectId }) {
  const principal = userPrincipal(userId);
  await requireResourceRelation(db, principal, 'conversation', conversationId, 'admin');
  await requireResourceRelation(db, principal, 'project', projectId, 'editor');
  const conversation = (await db.query(
    `SELECT id, title, project_id FROM chat_conversations WHERE id=$1 AND deleted_at IS NULL`, [conversationId])).rows[0];
  if (!conversation) throw new ConversationMoveError('conversation_not_found', 404, 'Conversation not found.');
  if (conversation.project_id === projectId) throw new ConversationMoveError('already_in_project', 409, 'The conversation is already in that project.');
  if (conversation.project_id) {
    throw new ConversationMoveError('project_detach_forbidden', 409, 'A project conversation cannot be moved out of its project.');
  }
  const audience = await projectReadAudience(db, projectId);
  if (audience.length > MAX_AUDIENCE) {
    throw new ConversationMoveError('audience_too_large', 409, 'That project has too many readers to list; share a copy instead.');
  }
  const history = (await db.query(
    `SELECT count(*)::int AS messages, min(created_at) AS first_at, max(created_at) AS last_at,
            coalesce(max(message_index), -1) AS last_index
       FROM chat_messages WHERE conversation_id=$1`, [conversationId])).rows[0];
  const identities = audience.length ? (await db.query(
    'SELECT id, display_name, username FROM users WHERE id=ANY($1::uuid[]) ORDER BY id', [audience])).rows : [];
  const consentRevision = crypto.createHash('sha256').update(JSON.stringify({
    conversationId, projectId, audience, messages: history.messages, lastIndex: history.last_index,
  })).digest('hex');
  return { conversation, audience, identities, history, consentRevision };
}

/** What a move WOULD do. Changes nothing. */
export async function previewConversationMove(db, { userId, conversationId, projectId }) {
  const state = await moveState(db, { userId, conversationId, projectId });
  return {
    conversationId,
    destination: { type: 'project', id: projectId },
    audience: state.identities.map((row) => ({
      userId: row.id, displayName: row.display_name || row.username || null, isYou: String(row.id) === String(userId),
    })),
    includedHistory: {
      messages: state.history.messages,
      firstAt: state.history.first_at ? new Date(state.history.first_at).toISOString() : null,
      lastAt: state.history.last_at ? new Date(state.history.last_at).toISOString() : null,
      scope: 'entire-conversation',
    },
    consentRevision: state.consentRevision,
  };
}

/** The move itself, only against the consent it was shown, and only once nothing is running. */
export async function moveConversation(pool, { userId, conversationId, projectId, consentRevision }) {
  if (typeof consentRevision !== 'string' || !/^[0-9a-f]{64}$/.test(consentRevision)) {
    throw new ConversationMoveError('consent_required', 400, 'A move needs the consent revision its preview returned.');
  }
  return withTransaction(pool, async (tx) => {
    await tx.query('SELECT id FROM chat_conversations WHERE id=$1 FOR UPDATE', [conversationId]);
    await tx.query('SELECT id FROM chat_projects WHERE id=$1 FOR SHARE', [projectId]);
    const state = await moveState(tx, { userId, conversationId, projectId });
    if (state.consentRevision !== consentRevision) {
      throw new ConversationMoveError('consent_stale', 409,
        'The project audience or the conversation changed since the preview; review the move again.');
    }
    // "Active provider ownership handoff must settle before a scope move": a scheduled run that has
    // been claimed or is executing is writing into this conversation under its current scope.
    const active = (await tx.query(`SELECT count(*)::int AS n FROM chat_scheduled_runs
      WHERE conversation_id=$1 AND status IN ('leased','running','reconciliation_required')`, [conversationId])).rows[0].n;
    if (active > 0) {
      throw new ConversationMoveError('execution_not_settled', 409, 'Work is still running in this conversation; move it once that settles.');
    }
    const moved = (await tx.query(
      `UPDATE chat_conversations SET project_id=$2, owner_user_id=NULL, workspace_id=NULL, updated_at=NOW()
        WHERE id=$1 RETURNING *`, [conversationId, projectId])).rows[0];
    await tx.query(`DELETE FROM relationship_tuples WHERE object_type='conversation' AND object_id=$1
      AND relation IN ('owner','parent')`, [conversationId]);
    await writeTuples(tx, { writes: [{ object: `conversation:${conversationId}`, relation: 'parent', subject: `project:${projectId}` }] });
    return { conversation: moved, audience: state.audience.length, consentRevision };
  });
}

export const MOVE_RELATIONS = RELATIONS;
