// NFR-05 (server half): a 10,000-turn conversation must never be mounted
// or serialized all at once. This module is the only turn-read path and it
// offers no full read: every call takes a cursor and a limit, the limit is
// clamped to PAGE_CAP, and pages chain by cursor until nextCursor is null.
// The client-side half (virtualized mounting, interaction timing) is owned
// by the UI and proven there; what the server guarantees — bounded pages,
// stable order, honest totals — is proven here against real PostgreSQL.
export const PAGE_CAP = 200;
export const DEFAULT_PAGE = 50;

function checkedLimit(limit) {
  const n = limit === undefined || limit === null ? DEFAULT_PAGE : Number(limit);
  if (!Number.isInteger(n) || n <= 0) throw new Error('limit must be a positive integer');
  return Math.min(n, PAGE_CAP);
}

function checkedCursor(cursor) {
  if (cursor === undefined || cursor === null) return -1;
  const n = Number(cursor);
  if (!Number.isInteger(n) || n < -1) throw new Error('cursor must be a turn index or null');
  return n;
}

export async function readTurnPage(poolOrClient, { conversationId, branch = 'main', cursor = null, limit = DEFAULT_PAGE }) {
  if (!conversationId) throw new Error('conversationId is required');
  const take = checkedLimit(limit);
  const after = checkedCursor(cursor);
  const lane = String(branch || 'main');
  const { rows } = await poolOrClient.query(
    `SELECT turn_index AS "turnIndex", content_hash AS "contentHash", status, created_at AS "createdAt"
       FROM conversation_turns
      WHERE conversation_id = $1 AND branch = $2 AND turn_index > $3
      ORDER BY turn_index ASC LIMIT $4`,
    [conversationId, lane, after, take + 1],
  );
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return {
    turns: page.map((r) => ({ ...r, turnIndex: Number(r.turnIndex) })),
    nextCursor: hasMore ? Number(page[page.length - 1].turnIndex) : null,
    total: await countTurns(poolOrClient, { conversationId, branch: lane }),
  };
}

export async function countTurns(poolOrClient, { conversationId, branch = 'main' }) {
  if (!conversationId) throw new Error('conversationId is required');
  const { rows } = await poolOrClient.query(
    `SELECT COUNT(*)::int AS total FROM conversation_turns
      WHERE conversation_id = $1 AND branch = $2`,
    [conversationId, String(branch || 'main')],
  );
  return Number(rows[0].total);
}
