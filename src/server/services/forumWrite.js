/**
 * Forum write service — everything that mutates the Record.
 *
 * Deliberately separate from forumService.js (reads). The split is not stylistic:
 * SPEC §5.1 says the Record is UNRANKED, so keeping reads in a module that
 * computes nothing makes "did someone sneak a score in here?" a one-file
 * question. Scoring lives here (vote tallies) and, from v0.4, in forumRanker.js.
 *
 * The rules that are easy to get wrong, all enforced in this file:
 *
 *  D6  Agents propose, humans ratify. Only a human may accept an answer, resolve
 *      a thread, or cast a BINDING vote. An agent's vote is recorded, visible,
 *      and structurally excluded from the score.
 *  D4  No global reputation number. Reputation is per-tag and is used for vote
 *      weight and capabilities — never rendered as a leaderboard integer.
 *  §5.3 Vote weight is capped at 3x. Uncapped weighting produces an oligarchy;
 *      unweighted produces mob rule.
 *  D10 Dedup runs at COMPOSE time. A near-duplicate boosts the original instead
 *      of creating a competitor.
 */

import { newShortId, slugifyTitle, searchThreads } from './forumService.js';

// --------------------------------------------------------------------------
// Capabilities — the ladder from §7.1.
//
// Thresholds are per-USER totals across tags, but reputation itself is stored
// per-tag: "trusted in xeno-canvas" must never become "trusted everywhere".
// --------------------------------------------------------------------------
export const CAPABILITY_THRESHOLDS = {
  post: 0,
  vote: 0,
  flag: 0,
  edit_tags: 10,
  suggest_duplicate: 10,
  close_duplicate: 25,
  review_flags: 50,
};

const MAX_VOTE_WEIGHT = 3;
const RATE_LIMITS = {
  // Per kind, per rolling hour. Agents are deliberately tighter (§4.3) — they
  // can generate content far faster than a human can evaluate it.
  human: { threads: 10, posts: 40 },
  agent: { threads: 3, posts: 15 },
};

export class ForumError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'ForumError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const MAX_TITLE = 300;
const MAX_BODY = 60000;

function requireText(value, field, max) {
  const text = String(value ?? '').trim();
  if (!text) throw new ForumError(`${field} is required`, `${field}_required`, 400);
  if (text.length > max) throw new ForumError(`${field} is too long`, `${field}_too_long`, 400);
  return text;
}

/**
 * Actor kind, as resolved by the platform's `resolvePrincipal`.
 *
 * ⚠️ This used to be `user?.kind === 'agent' ? 'agent' : 'human'`, which mapped
 * everything-not-an-agent to HUMAN — including `service` accounts. That made a
 * machine satisfy "only a human may accept an answer" (D6), which is precisely
 * what the rule exists to prevent. Return the real kind and let callers decide.
 */
export function actorKind(user) {
  const kind = user?.kind;
  return kind === 'agent' || kind === 'service' ? kind : 'human';
}

/** D6's ratifier test. A HUMAN, not merely "not an agent". */
export function isHuman(user) {
  return actorKind(user) === 'human';
}

/**
 * Service accounts are infrastructure — no owner, therefore nobody to hold
 * accountable for what they write. They authenticate for machine work; they do
 * not participate. Refused at the door rather than badged, because there is no
 * honest badge for "posted by the gateway".
 */
function assertNotService(user) {
  if (actorKind(user) === 'service') {
    throw new ForumError(
      'Service accounts cannot post in the forum',
      'service_cannot_participate',
      403,
    );
  }
}

// --------------------------------------------------------------------------
// Reputation
// --------------------------------------------------------------------------

/** Total reputation across tags. Used ONLY for capability gates, never shown. */
export async function totalReputation(db, userId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(score), 0)::float AS total FROM forum_reputation WHERE user_id = $1`,
    [userId],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function can(db, user, capability) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'moderator') return true;
  const threshold = CAPABILITY_THRESHOLDS[capability];
  if (threshold === undefined) return false;
  if (threshold === 0) return true;
  return (await totalReputation(db, user.id)) >= threshold;
}

export async function assertCan(db, user, capability) {
  if (!(await can(db, user, capability))) {
    throw new ForumError(
      `You do not have the "${capability}" capability yet`,
      'insufficient_reputation',
      403,
    );
  }
}

/**
 * Recompute a user's reputation for the tags on one thread.
 *
 * Derived on purpose — the source of truth is accepted answers, so this can be
 * rebuilt from scratch at any time and can never drift into being authoritative.
 */
export async function recomputeReputationForThread(db, threadId) {
  await db.query(
    `WITH thread_tags AS (
       SELECT tag_id FROM forum_thread_tags WHERE thread_id = $1
     ),
     authors AS (
       SELECT DISTINCT author_id FROM forum_posts
        WHERE thread_id = $1 AND author_id IS NOT NULL
     ),
     tallies AS (
       SELECT p.author_id, tt.tag_id,
              COUNT(*) FILTER (WHERE p.is_answer AND p.accepted_at IS NOT NULL) AS accepted,
              COUNT(*) AS answers
         FROM forum_posts p
         JOIN forum_thread_tags tt ON tt.thread_id = p.thread_id
        WHERE p.author_id IN (SELECT author_id FROM authors)
          AND tt.tag_id IN (SELECT tag_id FROM thread_tags)
          AND p.status = 'visible'
          AND p.position > 1
        GROUP BY p.author_id, tt.tag_id
     )
     INSERT INTO forum_reputation (user_id, tag_id, accepted_answers, answers, score, updated_at)
     SELECT author_id, tag_id, accepted, answers,
            -- An accepted answer is the signal; a mere answer is participation.
            (accepted * 10) + (answers * 1), NOW()
       FROM tallies
     ON CONFLICT (user_id, tag_id) DO UPDATE
       SET accepted_answers = EXCLUDED.accepted_answers,
           answers = EXCLUDED.answers,
           score = EXCLUDED.score,
           updated_at = NOW()`,
    [threadId],
  );
}

/** Vote weight: 1 + demonstrated expertise in this thread's tags, capped at 3 (§5.3). */
export async function voteWeightFor(db, userId, threadId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(r.accepted_answers), 0)::int AS accepted
       FROM forum_reputation r
       JOIN forum_thread_tags tt ON tt.tag_id = r.tag_id
      WHERE r.user_id = $1 AND tt.thread_id = $2`,
    [userId, threadId],
  );
  const accepted = Number(rows[0]?.accepted ?? 0);
  return Math.min(MAX_VOTE_WEIGHT, 1 + accepted * 0.5);
}

// --------------------------------------------------------------------------
// Rate limiting
// --------------------------------------------------------------------------

async function assertWithinRateLimit(db, user, what) {
  const limits = RATE_LIMITS[actorKind(user)] || RATE_LIMITS.human;
  const cap = limits[what];
  const table = what === 'threads' ? 'forum_threads' : 'forum_posts';
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM ${table}
      WHERE author_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [user.id],
  );
  if (Number(rows[0]?.n ?? 0) >= cap) {
    throw new ForumError(
      `Rate limit reached (${cap} ${what}/hour). Try again shortly.`,
      'rate_limited',
      429,
    );
  }
}

// --------------------------------------------------------------------------
// Tags
// --------------------------------------------------------------------------

const TAG_RE = /^(product|version|topic|kind):[a-z0-9][a-z0-9._-]{0,79}$/;

/** Resolve "namespace:value" strings to tag ids. Unknown tags are created. */
async function resolveTags(db, tags) {
  const ids = [];
  for (const raw of (tags || []).slice(0, 8)) {
    const tag = String(raw || '').trim().toLowerCase();
    if (!TAG_RE.test(tag)) {
      throw new ForumError(
        `Invalid tag "${raw}". Tags are namespaced: product:, version:, topic: or kind:`,
        'invalid_tag',
        400,
      );
    }
    const [namespace, ...rest] = tag.split(':');
    const value = rest.join(':');
    const { rows } = await db.query(
      `INSERT INTO forum_tags (namespace, value) VALUES ($1, $2)
       ON CONFLICT (namespace, value) DO UPDATE SET value = EXCLUDED.value
       RETURNING id`,
      [namespace, value],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

async function refreshTagCounts(db, tagIds) {
  if (!tagIds.length) return;
  await db.query(
    `UPDATE forum_tags g SET thread_count = (
       SELECT COUNT(*) FROM forum_thread_tags tt WHERE tt.tag_id = g.id
     ) WHERE g.id = ANY($1::uuid[])`,
    [tagIds],
  );
}

// --------------------------------------------------------------------------
// Compose-time dedup (D10)
// --------------------------------------------------------------------------

/**
 * Look for an existing thread that already asks this. Returns candidates for
 * the composer to show BEFORE the thread is created — most of an archive's
 * value is destroyed by the same question existing forty times.
 */
export async function findDuplicates(db, title, limit = 5) {
  const text = String(title || '').trim();
  if (text.length < 8) return [];
  const results = await searchThreads(db, text, limit);
  return results.filter((r) => r.isResolved || r.postCount > 1).slice(0, limit);
}

// --------------------------------------------------------------------------
// Writes
// --------------------------------------------------------------------------

export async function createThread(db, user, { space, title, body, tags }) {
  assertNotService(user);
  await assertCan(db, user, 'post');
  await assertWithinRateLimit(db, user, 'threads');

  const cleanTitle = requireText(title, 'title', MAX_TITLE);
  const cleanBody = requireText(body, 'body', MAX_BODY);

  const { rows: spaceRows } = await db.query(
    `SELECT id, slug, kind, post_policy FROM forum_spaces WHERE slug = $1 AND status = 'active'`,
    [space],
  );
  const spaceRow = spaceRows[0];
  if (!spaceRow) throw new ForumError('Unknown space', 'unknown_space', 404);

  if (spaceRow.post_policy === 'staff_only' && !['admin', 'moderator'].includes(user.role)) {
    throw new ForumError('This space is staff-post-only', 'space_staff_only', 403);
  }

  const kind = actorKind(user);
  const tagIds = await resolveTags(db, tags);

  // short_id collision is handled by the unique index, not by hoping.
  let threadId = null;
  let shortId = null;
  for (let attempt = 0; attempt < 5 && !threadId; attempt++) {
    shortId = newShortId();
    try {
      const { rows } = await db.query(
        `INSERT INTO forum_threads (short_id, space_id, slug, title, author_id, author_kind, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'open') RETURNING id`,
        [shortId, spaceRow.id, slugifyTitle(cleanTitle), cleanTitle, user.id, kind],
      );
      threadId = rows[0].id;
    } catch (e) {
      if (e.code !== '23505') throw e; // not a unique violation → real failure
    }
  }
  if (!threadId) throw new ForumError('Could not allocate a thread id', 'short_id_exhausted', 500);

  await db.query(
    `INSERT INTO forum_posts (thread_id, position, body, author_id, author_kind)
     VALUES ($1, 1, $2, $3, $4)`,
    [threadId, cleanBody, user.id, kind],
  );

  for (const tagId of tagIds) {
    await db.query(
      `INSERT INTO forum_thread_tags (thread_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [threadId, tagId],
    );
  }
  await refreshTagCounts(db, tagIds);

  await db.query(
    `UPDATE forum_threads SET post_count = 1, last_activity_at = NOW() WHERE id = $1`,
    [threadId],
  );
  await db.query(
    `UPDATE forum_spaces s SET thread_count = (
       SELECT COUNT(*) FROM forum_threads t WHERE t.space_id = s.id AND t.status <> 'archived'
     ) WHERE s.id = $1`,
    [spaceRow.id],
  );

  return { shortId, id: threadId };
}

export async function createPost(db, user, shortId, { body }) {
  assertNotService(user);
  await assertCan(db, user, 'post');
  await assertWithinRateLimit(db, user, 'posts');

  const cleanBody = requireText(body, 'body', MAX_BODY);

  const { rows } = await db.query(
    `SELECT t.id, t.status, s.post_policy
       FROM forum_threads t JOIN forum_spaces s ON s.id = t.space_id
      WHERE t.short_id = $1`,
    [shortId],
  );
  const thread = rows[0];
  if (!thread) throw new ForumError('Thread not found', 'thread_not_found', 404);
  if (thread.status === 'locked') throw new ForumError('This thread is locked', 'thread_locked', 403);
  if (thread.status === 'archived') throw new ForumError('This thread is archived', 'thread_archived', 403);

  const { rows: posRows } = await db.query(
    `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM forum_posts WHERE thread_id = $1`,
    [thread.id],
  );

  const { rows: postRows } = await db.query(
    `INSERT INTO forum_posts (thread_id, position, body, author_id, author_kind)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [thread.id, posRows[0].next, cleanBody, user.id, actorKind(user)],
  );

  await db.query(
    `UPDATE forum_threads
        SET post_count = (SELECT COUNT(*) FROM forum_posts WHERE thread_id = $1 AND status = 'visible'),
            last_activity_at = NOW()
      WHERE id = $1`,
    [thread.id],
  );

  return { id: postRows[0].id, position: posRows[0].next };
}

/**
 * Accept an answer. **Humans only — D6.**
 *
 * An agent may write the answer that gets accepted; it may not be the one that
 * decides. Permitted to the thread author or a moderator.
 */
export async function acceptAnswer(db, user, postId) {
  if (!isHuman(user)) {
    throw new ForumError(
      'Only a human can accept an answer',
      'human_required',
      403,
    );
  }

  const { rows } = await db.query(
    `SELECT p.id, p.thread_id, p.position, t.author_id AS thread_author, t.short_id, s.kind AS space_kind
       FROM forum_posts p
       JOIN forum_threads t ON t.id = p.thread_id
       JOIN forum_spaces s ON s.id = t.space_id
      WHERE p.id = $1 AND p.status = 'visible'`,
    [postId],
  );
  const post = rows[0];
  if (!post) throw new ForumError('Post not found', 'post_not_found', 404);

  if (post.space_kind !== 'qa') {
    throw new ForumError(
      'Only questions have accepted answers',
      'not_a_question_space',
      400,
    );
  }
  if (post.position === 1) {
    throw new ForumError('A thread cannot answer itself', 'cannot_accept_body', 400);
  }

  const isAuthor = String(post.thread_author) === String(user.id);
  const isStaff = ['admin', 'moderator'].includes(user.role);
  if (!isAuthor && !isStaff) {
    throw new ForumError('Only the person who asked can accept an answer', 'not_thread_author', 403);
  }

  // Exactly one accepted answer per thread — clear any previous one first.
  await db.query(
    `UPDATE forum_posts SET is_answer = FALSE, accepted_at = NULL, accepted_by = NULL
      WHERE thread_id = $1 AND is_answer = TRUE`,
    [post.thread_id],
  );
  await db.query(
    `UPDATE forum_posts SET is_answer = TRUE, accepted_at = NOW(), accepted_by = $2 WHERE id = $1`,
    [postId, user.id],
  );
  await db.query(
    `UPDATE forum_threads
        SET answer_post_id = $2, status = 'resolved', resolved_at = NOW(), resolved_by = $3,
            last_activity_at = NOW()
      WHERE id = $1`,
    [post.thread_id, postId, user.id],
  );

  await recomputeReputationForThread(db, post.thread_id);
  return { shortId: post.short_id };
}

/** Undo an acceptance — the thread reopens and reputation is recomputed. */
export async function unacceptAnswer(db, user, postId) {
  if (!isHuman(user)) {
    throw new ForumError('Only a human can change an acceptance', 'human_required', 403);
  }
  const { rows } = await db.query(
    `SELECT p.thread_id, t.author_id AS thread_author
       FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id
      WHERE p.id = $1`,
    [postId],
  );
  const post = rows[0];
  if (!post) throw new ForumError('Post not found', 'post_not_found', 404);
  const isAuthor = String(post.thread_author) === String(user.id);
  if (!isAuthor && !['admin', 'moderator'].includes(user.role)) {
    throw new ForumError('Only the person who asked can change this', 'not_thread_author', 403);
  }

  await db.query(
    `UPDATE forum_posts SET is_answer = FALSE, accepted_at = NULL, accepted_by = NULL WHERE id = $1`,
    [postId],
  );
  await db.query(
    `UPDATE forum_threads SET answer_post_id = NULL, status = 'open', resolved_at = NULL,
            resolved_by = NULL, last_activity_at = NOW()
      WHERE id = $1`,
    [post.thread_id],
  );
  await recomputeReputationForThread(db, post.thread_id);
}

/**
 * Cast a vote.
 *
 * D6 in one line: an agent's vote is recorded and visible but `is_binding` is
 * false, so it never reaches the score. A swarm can surface a thread; it cannot
 * decide one.
 */
export async function castVote(db, user, { targetType, targetId, value }) {
  assertNotService(user);
  await assertCan(db, user, 'vote');
  if (![1, -1].includes(Number(value))) {
    throw new ForumError('Vote must be +1 or -1', 'invalid_vote', 400);
  }
  if (!['thread', 'post'].includes(targetType)) {
    throw new ForumError('Invalid vote target', 'invalid_target', 400);
  }

  const table = targetType === 'thread' ? 'forum_threads' : 'forum_posts';
  const { rows: targetRows } = await db.query(
    `SELECT id, ${targetType === 'thread' ? 'id' : 'thread_id'} AS thread_id, author_id
       FROM ${table} WHERE id = $1`,
    [targetId],
  );
  const target = targetRows[0];
  if (!target) throw new ForumError('Target not found', 'target_not_found', 404);
  if (String(target.author_id) === String(user.id)) {
    throw new ForumError('You cannot vote on your own post', 'self_vote', 400);
  }

  const kind = actorKind(user);
  const isBinding = kind === 'human'; // D6 — only a human vote carries standing
  const weight = isBinding ? await voteWeightFor(db, user.id, target.thread_id) : 0;

  await db.query(
    `INSERT INTO forum_votes (target_type, target_id, voter_id, voter_kind, value, weight, is_binding)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (target_type, target_id, voter_id) DO UPDATE
       SET value = EXCLUDED.value, weight = EXCLUDED.weight, updated_at = NOW()`,
    [targetType, targetId, user.id, kind, Number(value), weight, isBinding],
  );

  await retallyVotes(db, targetType, targetId);
  return { counted: isBinding, weight };
}

/** Recompute the cached tallies. Binding and advisory are tallied separately. */
export async function retallyVotes(db, targetType, targetId) {
  const table = targetType === 'thread' ? 'forum_threads' : 'forum_posts';
  await db.query(
    `UPDATE ${table} SET
       score = COALESCE((
         SELECT SUM(value * weight) FROM forum_votes
          WHERE target_type = $2 AND target_id = $1 AND is_binding = TRUE), 0),
       advisory_count = COALESCE((
         SELECT COUNT(*) FROM forum_votes
          WHERE target_type = $2 AND target_id = $1 AND is_binding = FALSE AND value = 1), 0)
     WHERE id = $1`,
    [targetId, targetType],
  );
}

/** Raise a flag. Never removes anything — it only creates work for a human (§7.2). */
export async function raiseFlag(db, user, { targetType, targetId, reason, detail }) {
  assertNotService(user);
  await assertCan(db, user, 'flag');
  if (!['thread', 'post'].includes(targetType)) {
    throw new ForumError('Invalid flag target', 'invalid_target', 400);
  }
  const valid = ['spam', 'abuse', 'off_topic', 'duplicate', 'low_quality', 'other'];
  if (!valid.includes(reason)) {
    throw new ForumError('Invalid flag reason', 'invalid_reason', 400);
  }

  const table = targetType === 'thread' ? 'forum_threads' : 'forum_posts';
  const { rows } = await db.query(`SELECT id FROM ${table} WHERE id = $1`, [targetId]);
  if (!rows[0]) throw new ForumError('Target not found', 'target_not_found', 404);

  await db.query(
    `INSERT INTO forum_flags (target_type, target_id, reporter_id, reporter_kind, reason, detail)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (target_type, target_id, reporter_id) WHERE status = 'open' DO NOTHING`,
    [targetType, targetId, user.id, actorKind(user), reason, detail ? String(detail).slice(0, 2000) : null],
  );
  return { ok: true };
}
