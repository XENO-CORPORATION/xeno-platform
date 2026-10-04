// VIEW-04: every list row resolves to the same canonical ID across views;
// view switching preserves independent drafts/scroll state and never
// reparents a session. Canonical resolution is one function per cross-view
// hop (a message row resolves to its conversation; a scope-move row resolves
// to its conversation), so every view names the same subject by construction.
// Drafts and scroll offsets live per (user, view key) in their own table:
// switching views reads another row, never rewrites this one, and no code
// path here writes chat_conversations at all -- reparenting is not refused,
// it is unrepresentable.
const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, what = 'id') => {
  if (typeof value !== 'string' || !UUID.test(value)) bad('bad_input', `invalid_${what}`);
  return value;
};

const VIEW_KEY = /^[a-z]+(:[0-9a-f-]{36})?$/;
const viewKey = (value) => {
  if (typeof value !== 'string' || !VIEW_KEY.test(value)) bad('bad_input', 'invalid_view_key');
  return value;
};

async function withTx(poolOrClient, fn) {
  if (typeof poolOrClient.connect === 'function' && typeof poolOrClient.totalCount === 'number') {
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

/** A message-list row resolves to its canonical conversation. */
export async function resolveMessageConversation(poolOrClient, { messageId }) {
  const id = uuid(messageId, 'message');
  return withTx(poolOrClient, async (client) => {
    const row = (await client.query(
      'SELECT conversation_id FROM chat_messages WHERE id=$1', [id])).rows[0];
    if (!row) bad('not_found', 'message_not_found');
    return { messageId: id, conversationId: row.conversation_id };
  });
}

/** A scope-move row resolves to its canonical conversation. */
export async function resolveMoveConversation(poolOrClient, { moveId }) {
  const id = uuid(moveId, 'move');
  return withTx(poolOrClient, async (client) => {
    const row = (await client.query(
      'SELECT conversation_id FROM conversation_scope_moves WHERE id=$1', [id])).rows[0];
    if (!row) bad('not_found', 'move_not_found');
    return { moveId: id, conversationId: row.conversation_id };
  });
}

/** Save this view's draft/scroll. Touches exactly one (user, view) row. */
export async function saveViewState(poolOrClient, { actorUserId, view, draft, scrollOffset }) {
  const actor = uuid(actorUserId, 'actor');
  const key = viewKey(view);
  if (typeof draft !== 'string') bad('bad_input', 'invalid_draft');
  if (!Number.isInteger(scrollOffset) || scrollOffset < 0) bad('bad_input', 'invalid_scroll');
  return withTx(poolOrClient, async (client) => {
    await client.query(
      `INSERT INTO user_view_states(user_id,view_key,draft,scroll_offset,updated_at)
       VALUES($1,$2,$3,$4,now())
       ON CONFLICT (user_id,view_key) DO UPDATE SET draft=$3, scroll_offset=$4, updated_at=now()`,
      [actor, key, draft, scrollOffset],
    );
    return { userId: actor, view: key, draft, scrollOffset };
  });
}

/** Read this view's draft/scroll. Absent views read blank, never another view's state. */
export async function readViewState(poolOrClient, { actorUserId, view }) {
  const actor = uuid(actorUserId, 'actor');
  const key = viewKey(view);
  return withTx(poolOrClient, async (client) => {
    const row = (await client.query(
      'SELECT draft, scroll_offset FROM user_view_states WHERE user_id=$1 AND view_key=$2',
      [actor, key],
    )).rows[0];
    if (!row) return { userId: actor, view: key, draft: '', scrollOffset: 0, present: false };
    return { userId: actor, view: key, draft: row.draft, scrollOffset: row.scroll_offset, present: true };
  });
}
