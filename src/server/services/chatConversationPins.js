/**
 * Per-user conversation pins (the sidebar's "Pinned" block), the same rule as project pins
 * (services/chatProjectPins.js).
 *
 * A pin is a USER preference, not a conversation attribute: a shared conversation is pinned by each person who
 * wants it. Pinning needs at least viewer on the conversation; reads re-check viewer, so a revoked share hides
 * the pin. Unpinning never needs access: a person can always clear their own row.
 */
import { UUID_RE } from '../utils/workspaceContext.js';
import { ChatAuthorizationError, requireResourceRelation, userPrincipal, withTransaction } from './chatProjectAuthority.js';

const lock = (client, userId) => client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`chat_conversation_pins:${userId}`]);

/** Idempotent: pinning an already-pinned conversation keeps its position. Appends at the end. */
export async function pinConversation(db, userId, conversationId) {
  if (!UUID_RE.test(String(conversationId || ''))) throw new ChatAuthorizationError('conversation id must be a UUID', 'invalid_id');
  await requireResourceRelation(db, userPrincipal(userId), 'conversation', conversationId, 'viewer');
  return withTransaction(db, async (client) => {
    await lock(client, userId);
    const { rows } = await client.query(
      `INSERT INTO chat_conversation_pins (user_id, conversation_id, position)
       SELECT $1::uuid, c.id, COALESCE((SELECT MAX(position) + 1 FROM chat_conversation_pins WHERE user_id = $1::uuid), 0)
       FROM chat_conversations c WHERE c.id = $2::uuid AND c.deleted_at IS NULL
       ON CONFLICT (user_id, conversation_id) DO NOTHING
       RETURNING position`,
      [userId, conversationId],
    );
    if (rows.length) return { pinned: true, pin_position: rows[0].position };
    const existing = await client.query('SELECT position FROM chat_conversation_pins WHERE user_id = $1 AND conversation_id = $2', [userId, conversationId]);
    if (!existing.rows.length) throw new ChatAuthorizationError();
    return { pinned: true, pin_position: existing.rows[0].position };
  });
}

/** Idempotent; deliberately no access check. */
export async function unpinConversation(db, userId, conversationId) {
  userPrincipal(userId);
  if (!UUID_RE.test(String(conversationId || ''))) throw new ChatAuthorizationError('conversation id must be a UUID', 'invalid_id');
  await db.query('DELETE FROM chat_conversation_pins WHERE user_id = $1 AND conversation_id = $2', [userId, conversationId]);
  return { pinned: false, pin_position: null };
}
