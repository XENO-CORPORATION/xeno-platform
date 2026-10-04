import { randomUUID } from 'node:crypto';

// RUN-05: child conversations and bounded tool previews. A child opens
// under a parent; returning to the parent marks the link returned and
// touches nothing on the child itself — no mode change, no lease release,
// no cancellation. Only closeChild ends a child. Tool previews truncate
// to PREVIEW_BOUND at write time with an honest truncated flag; collapse
// flips one row's flag and never rewrites transcript content.
export const PREVIEW_BOUND = 4096;

function isPool(poolOrClient) {
  return poolOrClient && typeof poolOrClient.totalCount === 'number';
}

async function withTx(poolOrClient, fn) {
  if (!isPool(poolOrClient)) return fn(poolOrClient);
  const client = await poolOrClient.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function ensureConversation(executor, conversationId) {
  const { rows } = await executor.query(
    'SELECT id FROM chat_conversations WHERE id = $1',
    [conversationId],
  );
  if (rows.length === 0) throw new Error('Conversation not found');
}

export async function openChild(poolOrClient, { parentConversationId, actorUserId, title = 'Child' }) {
  if (!parentConversationId) throw new Error('parentConversationId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  return withTx(poolOrClient, async (executor) => {
    await ensureConversation(executor, parentConversationId);
    const childId = randomUUID();
    await executor.query(
      `INSERT INTO chat_conversations (id, owner_user_id, title) VALUES ($1, $2, $3)`,
      [childId, actorUserId, title],
    );
    const id = randomUUID();
    const { rows } = await executor.query(
      `INSERT INTO child_conversations (id, parent_conversation_id, child_conversation_id, opened_by, state)
        VALUES ($1, $2, $3, $4, 'open') RETURNING *`,
      [id, parentConversationId, childId, actorUserId],
    );
    return rows[0];
  });
}

// Return marks the link returned. Deliberately the ONLY write: the child
// conversation row, its turns and its execution lease are untouched, so the
// child keeps running and can be resumed. Idempotent; closed stays closed.
export async function returnToParent(poolOrClient, { childConversationId }) {
  if (!childConversationId) throw new Error('childConversationId is required');
  return withTx(poolOrClient, async (executor) => {
    const { rows } = await executor.query(
      `SELECT * FROM child_conversations WHERE child_conversation_id = $1`,
      [childConversationId],
    );
    if (rows.length === 0) throw new Error('Child link not found');
    const link = rows[0];
    if (link.state === 'closed') throw new Error('Child is closed');
    if (link.state === 'returned') return link;
    const updated = await executor.query(
      `UPDATE child_conversations SET state = 'returned', returned_at = now()
        WHERE id = $1 RETURNING *`,
      [link.id],
    );
    return updated.rows[0];
  });
}

export async function closeChild(poolOrClient, { childConversationId }) {
  if (!childConversationId) throw new Error('childConversationId is required');
  return withTx(poolOrClient, async (executor) => {
    const { rows } = await executor.query(
      `SELECT * FROM child_conversations WHERE child_conversation_id = $1`,
      [childConversationId],
    );
    if (rows.length === 0) throw new Error('Child link not found');
    const link = rows[0];
    if (link.state === 'closed') throw new Error('Child is closed');
    const updated = await executor.query(
      `UPDATE child_conversations SET state = 'closed', closed_at = now()
        WHERE id = $1 RETURNING *`,
      [link.id],
    );
    return updated.rows[0];
  });
}

export async function readChildLink(poolOrClient, childConversationId) {
  const { rows } = await poolOrClient.query(
    `SELECT * FROM child_conversations WHERE child_conversation_id = $1`,
    [childConversationId],
  );
  if (rows.length === 0) throw new Error('Child link not found');
  return rows[0];
}

export async function storeToolPreview(poolOrClient, { conversationId, toolCallId, output, fullRef }) {
  if (!conversationId) throw new Error('conversationId is required');
  if (!toolCallId) throw new Error('toolCallId is required');
  if (output === undefined || output === null) throw new Error('output is required');
  if (!fullRef) throw new Error('fullRef is required');
  const text = String(output);
  const truncated = text.length > PREVIEW_BOUND;
  const preview = truncated ? text.slice(0, PREVIEW_BOUND) : text;
  return withTx(poolOrClient, async (executor) => {
    await ensureConversation(executor, conversationId);
    const id = randomUUID();
    const { rows } = await executor.query(
      `INSERT INTO tool_previews (id, conversation_id, tool_call_id, preview, truncated, full_ref)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, conversationId, toolCallId, preview, truncated, fullRef],
    );
    return rows[0];
  });
}

// Bounded read: preview bytes plus the locator for the full output. The
// full output is never inlined here — a client that wants it follows
// fullRef through the artifact path that issued it.
export async function readToolPreview(poolOrClient, { conversationId, toolCallId }) {
  const { rows } = await poolOrClient.query(
    `SELECT preview, truncated, full_ref AS "fullRef", collapsed
       FROM tool_previews WHERE conversation_id = $1 AND tool_call_id = $2`,
    [conversationId, toolCallId],
  );
  if (rows.length === 0) throw new Error('Preview not found');
  return rows[0];
}

export async function setPreviewCollapsed(poolOrClient, { conversationId, toolCallId, collapsed }) {
  const { rowCount } = await poolOrClient.query(
    `UPDATE tool_previews SET collapsed = $3
      WHERE conversation_id = $1 AND tool_call_id = $2`,
    [conversationId, toolCallId, Boolean(collapsed)],
  );
  if (rowCount === 0) throw new Error('Preview not found');
}
