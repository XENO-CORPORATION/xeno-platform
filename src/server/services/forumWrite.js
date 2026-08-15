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
// WP1 — the return path. Every notification in the product is created through
// this one function; see the choke-point note in forumNotify.js.
import { notify } from './forumNotify.js';

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

  // Asking a question subscribes you to it. The author would get the 'answer'
  // notification regardless, but the subscription is what the mute toggle acts
  // on — without a row there is nothing for "stop notifying me" to write to.
  await autoSubscribeThread(db, user.id, threadId).catch(() => {});

  // A thread BODY can name people too — "@alice you hit this last week". There
  // is no reply fan-out to dedup against here, because nobody is subscribed to
  // a thread that did not exist a moment ago.
  await notifyMentions(db, {
    body: cleanBody,
    threadId,
    postId: null,
    actor: { id: user.id, kind: actorKind(user) },
    threadAuthorId: user.id,
  }).catch(() => {});

  return { shortId, id: threadId };
}

export async function createPost(db, user, shortId, { body }) {
  assertNotService(user);
  await assertCan(db, user, 'post');
  await assertWithinRateLimit(db, user, 'posts');

  const cleanBody = requireText(body, 'body', MAX_BODY);

  const { rows } = await db.query(
    `SELECT t.id, t.status, t.author_id, s.post_policy
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

  // ── The return path (WP1) ────────────────────────────────────────────────
  //
  // Deliberately NOT awaited-and-thrown: a notification that fails must never
  // lose the post. The post is the user's work; the notification is ours.
  const actor = { id: user.id, kind: actorKind(user) };

  // Posting subscribes you to the thread — but never un-mutes an explicit mute.
  await autoSubscribeThread(db, user.id, thread.id).catch(() => {});

  // 1. The person who asked. `notify` suppresses self-notification, so
  //    answering your own thread is silently a no-op and needs no check here.
  await notify(db, {
    userId: thread.author_id,
    kind: 'answer',
    threadId: thread.id,
    postId: postRows[0].id,
    actor,
  }).catch(() => {});

  // 2. Anyone named by @handle. Done BEFORE the reply fan-out so the people it
  //    reached can be excluded from it — being mentioned by name in a thread you
  //    also follow is one notification, not two, and the mention is the more
  //    specific of the pair, so it wins.
  const mentioned = await notifyMentions(db, {
    body: cleanBody,
    threadId: thread.id,
    postId: postRows[0].id,
    actor,
    threadAuthorId: thread.author_id,
  }).catch(() => []);

  // 3. Everyone else following the thread. The thread author is excluded in
  //    SQL rather than deduped afterwards — they get the richer 'answer'
  //    notification and must not receive two rows for one post.
  await threadReplyRecipients(db, thread.id, {
    exceptUserId: user.id,
    threadAuthorId: thread.author_id,
  })
    .then((ids) => Promise.all(
      ids
        .filter((uid) => !mentioned.includes(uid))
        .map((uid) => notify(db, {
          userId: uid, kind: 'reply', threadId: thread.id, postId: postRows[0].id, actor,
        })),
    ))
    .catch(() => {});

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
    `SELECT p.id, p.thread_id, p.position, p.author_id AS answer_author,
            t.author_id AS thread_author, t.short_id, s.kind AS space_kind
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

  // ── The return path (WP1) ────────────────────────────────────────────────
  // Tell whoever wrote the answer. This is the single most motivating message
  // the product can send — it is the only one that says the work was USED.
  //
  // The partial unique index makes it once-only: accept → unaccept → re-accept
  // does not re-notify. A notification you can farm is a notification people
  // learn to ignore.
  await notify(db, {
    userId: post.answer_author,
    kind: 'accepted',
    threadId: post.thread_id,
    postId,
    actor: { id: user.id, kind: actorKind(user) },
  }).catch(() => {});

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

// --------------------------------------------------------------------------
// Subscriptions — the fit signal the ranker was already scoring
// --------------------------------------------------------------------------

/**
 * 🔴 These exist because the read side shipped without them.
 *
 * `forum_subscriptions` was created by the v0.4 migration, `getViewerContext`
 * JOINed it on every feed request, and the ranker awarded +0.5 fit for
 * `you_follow_this_topic` — but NOTHING in the application could ever write a
 * row. So the JOIN could only ever return zero, the reason string could never
 * fire, and `my-topics` ("Topics you follow") was offered in the UI and
 * returned an empty list for every user, permanently.
 *
 * The unit suite was green throughout because it hands the ranker a
 * `viewer.subscribedTags` fixture directly — a value the running application
 * had no way to produce. That is the same shape as xeno-workflow's 76 node
 * types (defined, barrel-exported, fully unit-tested, reachable from nothing)
 * and xeno-tools' `install` IPC that no code path ever called. Unit coverage
 * says the pieces are correct; it never says they are connected.
 *
 * Only TAG subscriptions are implemented. The table also carries space_id,
 * thread_id and predicate, but the ranker consumes only tags — building the
 * other three now would add three more unreachable paths while fixing one.
 */

/**
 * Following a tag must NOT create it.
 *
 * `resolveTags` deliberately upserts, which is right when authoring a thread:
 * you are asserting the tag applies. Following is the opposite — it is a
 * statement about an existing conversation. If follow could create, anyone
 * could mint arbitrary rows in `forum_tags` (and pollute the tag namespace
 * every composer autocompletes against) simply by following things that do not
 * exist. So this looks up, and refuses when there is nothing to follow.
 */
async function findTagId(db, raw) {
  const tag = String(raw || '').trim().toLowerCase();
  if (!TAG_RE.test(tag)) {
    throw new ForumError(
      `Invalid tag "${raw}". Tags are namespaced: product:, version:, topic: or kind:`,
      'invalid_tag',
      400,
    );
  }
  const [namespace, ...rest] = tag.split(':');
  const { rows } = await db.query(
    'SELECT id FROM forum_tags WHERE namespace = $1 AND value = $2',
    [namespace, rest.join(':')],
  );
  if (!rows.length) {
    throw new ForumError(`No such tag "${tag}".`, 'unknown_tag', 404);
  }
  return rows[0].id;
}

/** Tags this user follows, as `namespace:value` — the shape the ranker reads. */
export async function listSubscriptions(db, userId) {
  const { rows } = await db.query(
    `SELECT g.namespace || ':' || g.value AS tag
       FROM forum_subscriptions s JOIN forum_tags g ON g.id = s.tag_id
      WHERE s.user_id = $1 AND s.tag_id IS NOT NULL
      ORDER BY tag`,
    [userId],
  );
  return rows.map((r) => r.tag);
}

/**
 * Follow a tag. Idempotent — following twice is not an error, it is the same
 * intent expressed twice, and the partial unique index enforces that at the
 * database rather than in a read-then-write race.
 *
 * Agents may subscribe. The migration says so in as many words: "agents
 * subscribe rather than scroll", which is the whole reason the table carries a
 * `predicate` column. Service principals may not — same rule as posting: no
 * owner means nobody to hold responsible.
 *
 * No capability gate. Following is a private preference, not a public act; it
 * changes only what YOU are shown, so there is nothing to earn first.
 */
export async function subscribeTag(db, user, tag) {
  assertNotService(user);
  const tagId = await findTagId(db, tag);
  await db.query(
    `INSERT INTO forum_subscriptions (user_id, tag_id) VALUES ($1, $2)
     ON CONFLICT (user_id, tag_id) WHERE tag_id IS NOT NULL DO NOTHING`,
    [user.id, tagId],
  );
  return { ok: true, following: true };
}

/** Unfollow. Also idempotent — unfollowing what you do not follow is a no-op. */
export async function unsubscribeTag(db, user, tag) {
  assertNotService(user);
  const tagId = await findTagId(db, tag);
  await db.query(
    'DELETE FROM forum_subscriptions WHERE user_id = $1 AND tag_id = $2',
    [user.id, tagId],
  );
  return { ok: true, following: false };
}

// --------------------------------------------------------------------------
// Thread subscriptions — who hears "someone replied" (WP1)
// --------------------------------------------------------------------------

/**
 * Posting in a thread subscribes you to it.
 *
 * Idempotent at the DATABASE (partial unique index), not by a read-then-write
 * check — two replies landing together would otherwise both see "not
 * subscribed" and insert.
 *
 * 🔴 Critically, ON CONFLICT DO NOTHING means this can never UN-MUTE. Someone
 * who explicitly muted a thread and then posts in it again stays muted. That is
 * the whole reason mute is a flag rather than a deleted row: the auto-subscribe
 * cannot distinguish "never subscribed" from "asked to stop", so the explicit
 * choice has to be the one that persists.
 */
export async function autoSubscribeThread(db, userId, threadId) {
  if (!userId || !threadId) return;
  await db.query(
    `INSERT INTO forum_subscriptions (user_id, thread_id) VALUES ($1, $2)
     ON CONFLICT (user_id, thread_id) WHERE thread_id IS NOT NULL DO NOTHING`,
    [userId, threadId],
  );
}

/** Explicit follow/mute from the UI. Upserts, so it can always un-mute. */
export async function setThreadSubscription(db, user, shortId, subscribed) {
  assertNotService(user);
  const { rows } = await db.query('SELECT id FROM forum_threads WHERE short_id = $1', [shortId]);
  if (!rows.length) throw new ForumError('Thread not found', 'thread_not_found', 404);

  await db.query(
    `INSERT INTO forum_subscriptions (user_id, thread_id, muted) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, thread_id) WHERE thread_id IS NOT NULL
     DO UPDATE SET muted = EXCLUDED.muted`,
    [user.id, rows[0].id, !subscribed],
  );
  return { ok: true, subscribed: Boolean(subscribed) };
}

/** Is this reader following the thread? Drives the UI toggle. */
export async function threadSubscription(db, userId, threadId) {
  if (!userId) return { subscribed: false };
  const { rows } = await db.query(
    'SELECT muted FROM forum_subscriptions WHERE user_id = $1 AND thread_id = $2',
    [userId, threadId],
  );
  return { subscribed: rows.length ? !rows[0].muted : false };
}

/**
 * Everyone who should hear about a new post, EXCLUDING:
 *   - the person who wrote it (you know what you just did), and
 *   - the thread author, who gets the richer 'answer' notification instead and
 *     must not receive both for one post.
 *
 * Muted rows are filtered in SQL rather than in JS, so a large thread does not
 * pull every subscriber into memory to discard most of them.
 */
export async function threadReplyRecipients(db, threadId, { exceptUserId, threadAuthorId }) {
  const { rows } = await db.query(
    `SELECT s.user_id
       FROM forum_subscriptions s
      WHERE s.thread_id = $1
        AND s.muted = FALSE
        AND s.user_id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        AND s.user_id <> COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [threadId, exceptUserId ?? null, threadAuthorId ?? null],
  );
  return rows.map((r) => r.user_id);
}

/**
 * Subscription state by the PUBLIC id.
 *
 * ⚠️ Exists because the obvious version was wrong. The thread detail route has
 * a serialized thread, and `serializeThreadSummary` deliberately exposes only
 * `shortId` — the citable identifier (D9) — never the internal uuid. Reading
 * `thread.id` there yields undefined, the lookup matches nothing, and the follow
 * toggle renders "not following" for everyone, forever, while every test passes.
 *
 * One query rather than resolving the id first: a toggle is not worth two round
 * trips, and the join is on an indexed unique column.
 */
export async function threadSubscriptionByShortId(db, userId, shortId) {
  if (!userId || !shortId) return { subscribed: false };
  const { rows } = await db.query(
    `SELECT s.muted
       FROM forum_subscriptions s
       JOIN forum_threads t ON t.id = s.thread_id
      WHERE s.user_id = $1 AND t.short_id = $2`,
    [userId, shortId],
  );
  return { subscribed: rows.length ? !rows[0].muted : false };
}

// --------------------------------------------------------------------------
// Mentions (WP1) — the last notification kind
// --------------------------------------------------------------------------

/** No thread can notify more than this many people by @-name. */
export const MAX_MENTIONS = 10;

/**
 * Pull `@handle` mentions out of a markdown body.
 *
 * Pure and exported so it can be tested for real rather than by reading source.
 * Matching is deliberately PERMISSIVE and validation happens against the
 * database — a handle that matches nobody simply notifies nobody, which is a
 * far better failure than a strict regex that silently drops a legitimate
 * mention because of a dot.
 *
 * Three things it must not do, each of which is a bug someone ships:
 *
 *   1. **Match email addresses.** `ask foo@example.com` contains `@example`.
 *      The lookbehind requires the `@` not follow a word character, which is
 *      what an email guarantees it does.
 *   2. **Match inside code.** A shell snippet full of `user@host`, or a docs
 *      example using `@tag`, must not page real people. Fenced blocks and
 *      inline code are stripped BEFORE matching — you cannot fix this with a
 *      cleverer regex, because the text is legitimate everywhere else.
 *   3. **Let one post notify everybody.** Capped, and deduped case-insensitively
 *      so `@alice @Alice` is one person, not two notifications.
 */
export function parseMentions(body) {
  const text = String(body || '')
    .replace(/```[\s\S]*?```/g, ' ')   // fenced blocks
    .replace(/~~~[\s\S]*?~~~/g, ' ')   // the other fence
    .replace(/`[^`\n]*`/g, ' ');       // inline code

  const found = new Map();             // lowercased handle -> original
  const re = /(?<![\w@])@([a-z0-9][a-z0-9._-]{1,30}[a-z0-9])/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const handle = m[1].toLowerCase();
    if (!found.has(handle)) found.set(handle, handle);
    if (found.size >= MAX_MENTIONS) break;
  }
  return [...found.keys()];
}

/**
 * Resolve mentioned handles to real users and notify them.
 *
 * Returns the user ids notified, so the caller can exclude them from the reply
 * fan-out. A person mentioned BY NAME in a post they also happen to follow must
 * get one notification, not two — and the mention is the more specific of the
 * pair, so it wins.
 *
 * Suppressed here rather than in notify(): the thread author is excluded because
 * they already receive the richer 'answer'.
 */
export async function notifyMentions(db, { body, threadId, postId, actor, threadAuthorId }) {
  const handles = parseMentions(body);
  if (!handles.length) return [];

  const { rows } = await db.query(
    `SELECT id FROM users
      WHERE lower(username) = ANY($1::text[])
        AND is_active = TRUE
        AND id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        AND id <> COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [handles, actor?.id ?? null, threadAuthorId ?? null],
  );

  const notified = [];
  for (const r of rows) {
    const id = await notify(db, {
      userId: r.id, kind: 'mention', threadId, postId, actor,
    });
    if (id) notified.push(r.id);
  }
  return notified;
}

// --------------------------------------------------------------------------
// Edit and delete (WP2) — the write side of columns that already existed
// --------------------------------------------------------------------------
//
// `forum_posts.status IN ('visible','hidden','deleted')` and `edited_at` have
// been in the schema since the first migration. `edited_at` is even serialized
// by forumService and typed in ForumThread.tsx — the read side is complete top
// to bottom, and nothing has ever written either column. Sixth instance of that
// shape in this codebase.

/**
 * Edit your own post.
 *
 * 🔴 EVERY EDIT IS MARKED, WITH NO GRACE PERIOD. Discourse and friends hide
 * edits made in the first few minutes, which is friendlier and wrong here: the
 * Record is permanent and public (§5.1), and its value to the next reader — and
 * to an agent citing it — rests on it not having been quietly rewritten.
 *
 * This matters most for an ACCEPTED answer. Without a visible marker, anyone
 * could earn an acceptance and then replace the text with something else, and
 * the archive would show a vouched-for answer nobody actually vouched for.
 * `edited_at` already flowed to the client; it just never had a value.
 *
 * Moderators may edit too (§7.2). The row records WHO, so a moderator edit is
 * never mistaken for the author changing their mind.
 */
export async function editPost(db, user, postId, { body }) {
  assertNotService(user);
  const cleanBody = requireText(body, 'body', MAX_BODY);

  const { rows } = await db.query(
    `SELECT p.id, p.author_id, p.status, p.thread_id, t.status AS thread_status
       FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id
      WHERE p.id = $1`,
    [postId],
  );
  const post = rows[0];
  if (!post || post.status === 'deleted') {
    throw new ForumError('Post not found', 'post_not_found', 404);
  }
  if (post.thread_status === 'locked') {
    throw new ForumError('This thread is locked', 'thread_locked', 403);
  }

  const isAuthor = String(post.author_id) === String(user.id);
  const isStaff = ['admin', 'moderator'].includes(user.role);
  if (!isAuthor && !isStaff) {
    throw new ForumError('You can only edit your own posts', 'not_post_author', 403);
  }

  await db.query(
    `UPDATE forum_posts
        SET body = $2, edited_at = NOW(), edited_by = $3
      WHERE id = $1`,
    [postId, cleanBody, user.id],
  );
  return { ok: true, editedAt: new Date().toISOString() };
}

/**
 * Delete your own post.
 *
 * SOFT delete — the row survives, the CONTENT does not.
 *
 * Both halves are deliberate. Removing the row outright would renumber
 * positions and orphan the replies that quote it, so a thread reads as if the
 * conversation never made sense. Keeping the body would mean "delete" leaves
 * your words in the database, which is not what the word means to the person
 * clicking it — and it is the difference between a soft delete and a lie.
 *
 * So: the row becomes a tombstone, the text is gone, and reads already filter
 * `status = 'visible'` so it disappears everywhere without touching a query.
 *
 * ⚠️ Deleting the ACCEPTED answer REOPENS the thread. Leaving `answer_post_id`
 * pointing at a tombstone would show a resolved question whose resolution is
 * blank — worse than an open one, because it stops anyone answering it.
 */
export async function deletePost(db, user, postId) {
  assertNotService(user);

  const { rows } = await db.query(
    `SELECT p.id, p.author_id, p.position, p.status, p.thread_id, p.is_answer
       FROM forum_posts p WHERE p.id = $1`,
    [postId],
  );
  const post = rows[0];
  if (!post || post.status === 'deleted') {
    throw new ForumError('Post not found', 'post_not_found', 404);
  }

  const isAuthor = String(post.author_id) === String(user.id);
  const isStaff = ['admin', 'moderator'].includes(user.role);
  if (!isAuthor && !isStaff) {
    throw new ForumError('You can only delete your own posts', 'not_post_author', 403);
  }

  // Position 1 IS the question. Deleting it would leave a thread of answers to
  // nothing. Refused explicitly rather than half-done — see the note in the
  // release plan: thread deletion is its own change, and this is the honest
  // boundary until it lands.
  if (post.position === 1) {
    throw new ForumError(
      'This is the original post. Deleting it would remove the whole thread — that is not available yet.',
      'cannot_delete_first_post',
      400,
    );
  }

  await db.query(
    `UPDATE forum_posts
        SET status = 'deleted', body = '', deleted_at = NOW(), deleted_by = $2,
            is_answer = FALSE, accepted_at = NULL, accepted_by = NULL
      WHERE id = $1`,
    [postId, user.id],
  );

  if (post.is_answer) {
    await db.query(
      `UPDATE forum_threads
          SET answer_post_id = NULL, status = 'open', resolved_at = NULL, resolved_by = NULL
        WHERE id = $1`,
      [post.thread_id],
    );
    await recomputeReputationForThread(db, post.thread_id);
  }

  await db.query(
    `UPDATE forum_threads
        SET post_count = (SELECT COUNT(*) FROM forum_posts WHERE thread_id = $1 AND status = 'visible'),
            last_activity_at = NOW()
      WHERE id = $1`,
    [post.thread_id],
  );

  return { ok: true, deleted: true, reopenedThread: Boolean(post.is_answer) };
}

// --------------------------------------------------------------------------
// GDPR erasure — the forum's half (WP2)
// --------------------------------------------------------------------------

/**
 * Remove a subject's authored forum CONTENT.
 *
 * `utils/gdprErasure.js` already tombstones the identity: it scrubs the `users`
 * row to an id-derived sentinel and kills every session and token. What it
 * cannot know about is the free text — a post body is authored by the subject
 * and routinely contains their own personal data ("I'm at Acme, mail me at
 * …"). Anonymising the byline while leaving the sentence "my number is …"
 * published is not erasure.
 *
 * ⚠️ It is also why erasure could not simply DELETE the user row and lean on
 * the `SET NULL` foreign keys: SET NULL removes the LINK, never the TEXT. The
 * FK design is right — it protects other people's threads from collapsing when
 * one participant leaves — but it is not an erasure mechanism.
 *
 * ── WHAT IS DELIBERATELY KEPT ───────────────────────────────────────────────
 *
 * Other people's posts, including the answers to a question this subject asked.
 * Those are third-party content, and erasing them on one person's request would
 * destroy data belonging to people who did not ask for anything. So a thread
 * whose question is erased becomes a tombstone that still carries its answers:
 * the asker is gone, the knowledge stays.
 *
 * Takes a CLIENT, not a pool — it must run inside the erasure transaction, so a
 * failure here rolls back the identity tombstone too rather than reporting a
 * half-erased subject as erased.
 */
export async function eraseForumContent(client, userId) {
  // Bodies first. status='deleted' + body='' is exactly what deletePost does,
  // and because search_vector is GENERATED ALWAYS from body, this drops every
  // one of them out of the full-text index with no separate reindex.
  const posts = await client.query(
    `UPDATE forum_posts
        SET status = 'deleted', body = '', deleted_at = NOW(),
            is_answer = FALSE, accepted_at = NULL, accepted_by = NULL
      WHERE author_id = $1 AND status <> 'deleted'`,
    [userId],
  );

  // Titles are free text too, and a title is the most-indexed sentence in the
  // product — it is what search matches and what every card shows.
  const threads = await client.query(
    `UPDATE forum_threads
        SET title = '[removed]'
      WHERE author_id = $1 AND title <> '[removed]'`,
    [userId],
  );

  // A thread whose accepted answer was written by the subject must not keep
  // pointing at a blanked post; it reopens, exactly as deletePost does.
  await client.query(
    `UPDATE forum_threads t
        SET answer_post_id = NULL, status = 'open', resolved_at = NULL, resolved_by = NULL
      WHERE t.answer_post_id IN (SELECT id FROM forum_posts WHERE author_id = $1)`,
    [userId],
  );

  // Counts are recomputed from what is still visible, or every thread the
  // subject replied to keeps claiming replies that are no longer there.
  await client.query(
    `UPDATE forum_threads t
        SET post_count = (SELECT COUNT(*) FROM forum_posts p
                           WHERE p.thread_id = t.id AND p.status = 'visible')
      WHERE t.id IN (SELECT DISTINCT thread_id FROM forum_posts WHERE author_id = $1)`,
    [userId],
  );

  return { postsErased: posts.rowCount, threadsErased: threads.rowCount };
}

/**
 * Delete a thread you started.
 *
 * ── THE SHAPE DEPENDS ON WHETHER ANYONE ELSE SPOKE ──────────────────────────
 *
 * A thread is not only yours the moment somebody answers it. Their answer is
 * their work, and it is usually the reason the thread has any value to the next
 * reader. So:
 *
 *   nobody else posted  ->  the thread goes. Nothing is lost but your own words.
 *   somebody answered   ->  the thread REMAINS as a tombstone: title '[removed]',
 *                           your question blanked, their answers untouched.
 *
 * The second branch is the one that matters. "Delete" that also erases three
 * other people's answers is a deletion of their data on your request, and it is
 * how an archive gets quietly hollowed out by whoever happens to have asked.
 *
 * This is the same rule eraseForumContent follows, and deliberately so — one
 * idea, applied in both places, rather than two policies that drift.
 */
export async function deleteThread(db, user, shortId) {
  assertNotService(user);

  const { rows } = await db.query(
    `SELECT id, author_id, status FROM forum_threads WHERE short_id = $1`,
    [String(shortId || '').toLowerCase()],
  );
  const thread = rows[0];
  if (!thread || thread.status === 'deleted') {
    throw new ForumError('Thread not found', 'thread_not_found', 404);
  }

  const isAuthor = String(thread.author_id) === String(user.id);
  const isStaff = ['admin', 'moderator'].includes(user.role);
  if (!isAuthor && !isStaff) {
    throw new ForumError('You can only delete your own threads', 'not_thread_author', 403);
  }

  // "Anyone else" means a VISIBLE post by a different author. A reply the author
  // already deleted must not keep their thread alive as a tombstone forever.
  const { rows: others } = await db.query(
    `SELECT COUNT(*)::int AS n FROM forum_posts
      WHERE thread_id = $1 AND status = 'visible' AND position > 1
        AND author_id IS DISTINCT FROM $2`,
    [thread.id, thread.author_id],
  );
  const hasOtherVoices = Number(others[0]?.n ?? 0) > 0;

  // The author's own content goes either way: the question body and the title.
  await db.query(
    `UPDATE forum_posts SET body = '', status = 'deleted', deleted_at = NOW(), deleted_by = $2
      WHERE thread_id = $1 AND position = 1`,
    [thread.id, user.id],
  );
  await db.query(
    `UPDATE forum_threads
        SET title = '[removed]', deleted_at = NOW(), deleted_by = $2,
            status = CASE WHEN $3::boolean THEN status ELSE 'deleted' END
      WHERE id = $1`,
    [thread.id, user.id, hasOtherVoices],
  );

  return { ok: true, deleted: true, keptForAnswers: hasOtherVoices };
}
