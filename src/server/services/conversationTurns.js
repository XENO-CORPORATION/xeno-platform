import { randomUUID } from 'node:crypto';

// SES-09: conversation recovery. Turns append per branch (main plus crash
// shards) as complete or crashed-partial. Deliberate user intent (abandon
// a polluted branch, rewind to a known-good turn) lives beside them in
// branch intents. resolveRecovery reads the newest valid continuation and
// refuses when the state is genuinely ambiguous; nothing here ever deletes
// or rewrites a completed turn.
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

// Turns append within one conversation+branch in seq order behind an
// advisory lock on that branch. Crash shards are branches named by the
// client ('shard-<attempt>'); they must not collide with main or with the
// live branch they fork from, and completed branches refuse more turns.
export async function appendTurn(poolOrClient, { conversationId, branch = 'main', contentHash, partial = false }) {
  if (!conversationId) throw new Error('conversationId is required');
  if (!contentHash) throw new Error('contentHash is required');
  const lane = String(branch || 'main');
  return withTx(poolOrClient, async (executor) => {
    await ensureConversation(executor, conversationId);
    await executor.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [String(conversationId), lane],
    );
    const abandoned = await executor.query(
      `SELECT 1 FROM conversation_branch_intents
        WHERE conversation_id = $1 AND branch = $2 AND intent = 'abandon'`,
      [conversationId, lane],
    );
    if (abandoned.rowCount > 0) throw new Error(`Branch '${lane}' was abandoned`);
    const seq = await executor.query(
      `SELECT COALESCE(MAX(turn_index), -1) + 1 AS next
         FROM conversation_turns WHERE conversation_id = $1 AND branch = $2`,
      [conversationId, lane],
    );
    const next = Number(seq.rows[0].next);
    const id = randomUUID();
    const { rows } = await executor.query(
      `INSERT INTO conversation_turns (id, conversation_id, branch, turn_index, content_hash, status)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, conversationId, lane, next, contentHash, partial ? 'partial' : 'complete'],
    );
    return rows[0];
  });
}

// Deliberate intent from the conversation owner: abandon a crashed/polluted
// branch wholesale, or rewind the live branch to a completed turn (the
// rewind point must itself be complete — rewinding to a partial turn is a
// no-op refusal, not a silent snap to an earlier turn).
export async function recordBranchIntent(poolOrClient, { conversationId, branch, intent, targetTurn = null, actorUserId }) {
  if (!conversationId) throw new Error('conversationId is required');
  if (!branch) throw new Error('branch is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  if (intent !== 'abandon' && intent !== 'rewind-to') throw new Error('Unknown branch intent');
  if (intent === 'abandon' && targetTurn !== null) throw new Error('abandon takes no target turn');
  if (intent === 'rewind-to' && (targetTurn === null || targetTurn < 0)) {
    throw new Error('rewind-to needs a target turn');
  }
  return withTx(poolOrClient, async (executor) => {
    await ensureConversation(executor, conversationId);
    if (intent === 'rewind-to') {
      const target = await executor.query(
        `SELECT status FROM conversation_turns
          WHERE conversation_id = $1 AND branch = $2 AND turn_index = $3`,
        [conversationId, branch, targetTurn],
      );
      if (target.rowCount === 0) throw new Error('Rewind target turn does not exist');
      if (target.rows[0].status !== 'complete') {
        throw new Error('Rewind target must be a completed turn');
      }
    }
    const id = randomUUID();
    const { rows } = await executor.query(
      `INSERT INTO conversation_branch_intents (id, conversation_id, branch, intent, target_turn, actor_user_id)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, conversationId, branch, intent, targetTurn, actorUserId],
    );
    return rows[0];
  });
}

// Recovery: the newest unambiguous valid continuation. A rewind-to intent
// pins the branch to its target; an abandoned branch is excluded; branches
// whose latest turn is partial are excluded (the crash shard keeps its
// partial turn as evidence, but recovery never resumes from it). Two or
// more live branches with complete heads is ambiguous: refuse and let the
// user abandon one — silently picking newest would hide a fork.
export async function resolveRecovery(poolOrClient, conversationId) {
  const { rows: turns } = await poolOrClient.query(
    `SELECT t.branch, t.turn_index, t.status, t.created_at
       FROM conversation_turns t
       JOIN (SELECT conversation_id, branch, MAX(turn_index) AS head
               FROM conversation_turns WHERE conversation_id = $1
               GROUP BY conversation_id, branch) h
         ON h.conversation_id = t.conversation_id AND h.branch = t.branch
        AND h.head = t.turn_index
      WHERE t.conversation_id = $1`,
    [conversationId],
  );
  const { rows: intents } = await poolOrClient.query(
    `SELECT branch, intent, target_turn, created_at
       FROM conversation_branch_intents WHERE conversation_id = $1
       ORDER BY created_at DESC, id DESC`,
    [conversationId],
  );
  const latest = new Map();
  for (const row of intents) {
    if (!latest.has(row.branch)) latest.set(row.branch, row);
  }
  const heads = [];
  for (const head of turns) {
    const decision = latest.get(head.branch);
    if (decision && decision.intent === 'abandon') continue;
    if (head.status !== 'complete') continue;
    if (decision && decision.intent === 'rewind-to') {
      heads.push({ branch: head.branch, turnIndex: Number(decision.target_turn), rewoundFrom: Number(head.turn_index) });
    } else {
      heads.push({ branch: head.branch, turnIndex: Number(head.turn_index) });
    }
  }
  if (heads.length === 0) {
    return { recovered: false, reason: 'no complete turn on any live branch' };
  }
  if (heads.length > 1) {
    return { recovered: false, reason: 'ambiguous: multiple live branches', branches: heads.map((h) => h.branch).sort() };
  }
  return { recovered: true, ...heads[0] };
}
