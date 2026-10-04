// SES-07: CLI, GUI, Hub embed and provider TUI adapters retain a single
// authoritative session/event lineage and one execution-owner lease. Every
// tool, notification and provider command lands as a sequenced structured
// event, visible through the lineage read -- adapters differ in presentation,
// never in business data. Execution events (tool/notification/provider-
// command) append only under a live lease held by the appending adapter and
// actor. Terminal ANSI is presentation: it is refused inside payloads and
// preserved verbatim inside the presentation field.
const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, what = 'id') => {
  if (typeof value !== 'string' || !UUID.test(value)) bad('bad_input', `invalid_${what}`);
  return value;
};

const ADAPTERS = ['cli', 'gui', 'hub', 'provider-tui'];
const KINDS = ['tool', 'notification', 'provider-command', 'note', 'state'];
const EXECUTION_KINDS = ['tool', 'notification', 'provider-command'];
export const MAX_LEASE_TTL_SECONDS = 3600;

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

const hasAnsi = (value) => {
  if (typeof value === 'string') return value.includes('\x1b');
  if (Array.isArray(value)) return value.some(hasAnsi);
  if (value && typeof value === 'object') return Object.values(value).some(hasAnsi);
  return false;
};

/** Acquire (or extend, as holder) the conversation's single execution lease. */
export async function acquireExecutionLease(poolOrClient, { actorUserId, conversationId, adapter, ttlSeconds }) {
  const actor = uuid(actorUserId, 'actor');
  const conv = uuid(conversationId, 'conversation');
  if (!ADAPTERS.includes(adapter)) bad('bad_input', 'invalid_adapter');
  const ttl = ttlSeconds == null ? 600 : ttlSeconds;
  if (!Number.isInteger(ttl) || ttl <= 0) bad('bad_input', 'invalid_ttl');
  if (ttl > MAX_LEASE_TTL_SECONDS) bad('bad_input', 'lease_ttl_exceeded');
  return withTx(poolOrClient, async (client) => {
    const exists = (await client.query('SELECT id FROM chat_conversations WHERE id=$1', [conv])).rows[0];
    if (!exists) bad('not_found', 'conversation_not_found');
    const live = (await client.query(
      'SELECT holder_adapter, holder_user_id FROM session_execution_leases WHERE conversation_id=$1 AND expires_at > now()',
      [conv],
    )).rows[0];
    if (live && (live.holder_adapter !== adapter || live.holder_user_id !== actor)) {
      bad('conflict', 'lease_held');
    }
    const expires = new Date(Date.now() + ttl * 1000);
    await client.query(
      `INSERT INTO session_execution_leases(conversation_id,holder_adapter,holder_user_id,expires_at)
       VALUES($1,$2,$3,$4)
       ON CONFLICT (conversation_id) DO UPDATE SET holder_adapter=$2, holder_user_id=$3, expires_at=$4`,
      [conv, adapter, actor, expires.toISOString()],
    );
    return { conversationId: conv, holderAdapter: adapter, holderUserId: actor, expiresAt: expires.toISOString() };
  });
}

export async function releaseExecutionLease(poolOrClient, { actorUserId, conversationId, adapter }) {
  const actor = uuid(actorUserId, 'actor');
  const conv = uuid(conversationId, 'conversation');
  if (!ADAPTERS.includes(adapter)) bad('bad_input', 'invalid_adapter');
  return withTx(poolOrClient, async (client) => {
    const live = (await client.query(
      'SELECT holder_adapter, holder_user_id FROM session_execution_leases WHERE conversation_id=$1', [conv])).rows[0];
    if (!live) return { conversationId: conv, released: false };
    if (live.holder_adapter !== adapter || live.holder_user_id !== actor) bad('denied', 'release_not_authorized');
    await client.query('DELETE FROM session_execution_leases WHERE conversation_id=$1', [conv]);
    return { conversationId: conv, released: true };
  });
}

/**
 * Append a lineage event. Execution kinds require the caller's live lease;
 * payloads must be ANSI-free; sequence numbers are assigned under a
 * per-conversation lock so the lineage is total per session.
 */
export async function appendSessionEvent(poolOrClient, { actorUserId, conversationId, adapter, kind, payload, presentation }) {
  const actor = uuid(actorUserId, 'actor');
  const conv = uuid(conversationId, 'conversation');
  if (!ADAPTERS.includes(adapter)) bad('bad_input', 'invalid_adapter');
  if (!KINDS.includes(kind)) bad('bad_input', 'invalid_kind');
  if (payload === undefined) bad('bad_input', 'invalid_payload');
  if (hasAnsi(payload)) bad('bad_input', 'ansi_in_payload');
  if (presentation !== undefined && presentation !== null && typeof presentation !== 'string') {
    bad('bad_input', 'invalid_presentation');
  }
  return withTx(poolOrClient, async (client) => {
    const exists = (await client.query('SELECT id FROM chat_conversations WHERE id=$1', [conv])).rows[0];
    if (!exists) bad('not_found', 'conversation_not_found');
    if (EXECUTION_KINDS.includes(kind)) {
      const live = (await client.query(
        'SELECT holder_adapter, holder_user_id FROM session_execution_leases WHERE conversation_id=$1 AND expires_at > now()',
        [conv],
      )).rows[0];
      if (!live || live.holder_adapter !== adapter || live.holder_user_id !== actor) {
        bad('denied', 'lease_not_held');
      }
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`session-lineage:${conv}`]);
    const seq = Number((await client.query(
      'SELECT coalesce(max(seq),0)+1 AS n FROM session_event_lineage WHERE conversation_id=$1', [conv])).rows[0].n);
    const row = (await client.query(
      `INSERT INTO session_event_lineage(conversation_id,seq,adapter,kind,payload,presentation,actor_user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [conv, seq, adapter, kind, JSON.stringify(payload), presentation == null ? null : presentation, actor],
    )).rows[0];
    return { eventId: row.id, conversationId: conv, seq, adapter, kind };
  });
}

/** Read the authoritative lineage: every adapter's events, one order. */
export async function readSessionLineage(poolOrClient, { conversationId }) {
  const conv = uuid(conversationId, 'conversation');
  return withTx(poolOrClient, async (client) => {
    const rows = (await client.query(
      `SELECT seq, adapter, kind, payload, presentation, actor_user_id
       FROM session_event_lineage WHERE conversation_id=$1 ORDER BY seq`, [conv])).rows;
    return rows.map((r) => ({ seq: Number(r.seq), adapter: r.adapter, kind: r.kind,
      payload: r.payload, presentation: r.presentation, actorUserId: r.actor_user_id }));
  });
}
