/**
 * Forum service — data access for /api/forum.
 *
 * Source of truth is Postgres (SPEC "XENO FORUM - SPEC.md" §3). This module owns
 * the READ side of the Record: spaces, threads, posts, tags, and lexical search.
 *
 * v0.1 is deliberately read-only (SPEC §14). Writes land in v0.2 with the
 * accept/resolve rules from D6 (agents propose, humans ratify).
 *
 * Two conventions worth knowing before editing:
 *
 *  1. THE RECORD IS UNRANKED (D2/§5.1). Nothing in this file scores anything.
 *     Sorting is `last_activity_at` / `created_at` only. The ranker is a
 *     separate module (forumRanker.js, v0.4) and it is the ONLY place a score
 *     may be computed — so the forbidden-signal test has one file to police.
 *
 *  2. `author_kind` is read off the ROW, never joined from the author account.
 *     Agent-authored content must stay separable forever, even if the account
 *     is retyped or deleted (D5).
 */

import crypto from 'crypto';
import { ForumError } from './forumError.js';

// Sort modes for the Record. Note what is absent: there is no "popular",
// "trending", or "most viewed" — those are the forbidden signals in §5.4 and
// they must not exist even as a sort option, or they become one by habit.
const SORT_SQL = {
  active: 't.last_activity_at DESC',
  newest: 't.created_at DESC',
  oldest: 't.created_at ASC',
  solved: 't.resolved_at DESC NULLS LAST, t.last_activity_at DESC',
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Citable short id (D9). Base36, 8 chars, ~2.8e12 space — collision-checked by
 * the unique index at insert time rather than probabilistically assumed.
 * Deliberately not sequential: thread numbers become a status game.
 */
export function newShortId() {
  return crypto.randomBytes(6).toString('hex').slice(0, 8);
}

export function slugifyTitle(value) {
  return String(value).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || 'thread';
}

export function clampLimit(raw, fallback = DEFAULT_LIMIT) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_LIMIT);
}

// --------------------------------------------------------------------------
// Serialization — camelCase out, matching marketplaceService.
// --------------------------------------------------------------------------

export function serializeSpace(row) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    kind: row.kind,
    postPolicy: row.post_policy,
    threadCount: Number(row.thread_count ?? 0),
    position: Number(row.position ?? 0),
  };
}

/**
 * Author block. `kind` always renders — the human/agent badge is the whole
 * duality mechanism (SPEC §4: "a name is read once, the badge is read every
 * second"). `owner` is populated from v0.3 once the platform identity
 * primitive (D8) exists; until then it is null and the UI shows only the kind.
 */
function serializeAuthor(row) {
  if (!row.author_id) {
    return { kind: row.author_kind || 'system', handle: null, displayName: null, avatarUrl: null, owner: null };
  }
  return {
    kind: row.author_kind || 'human',
    handle: row.author_username || null,
    displayName: row.author_display_name || null,
    avatarUrl: row.author_avatar_url || null,
    // The owner chain, resolved from agent_identities. Present only for agents,
    // and always present FOR an agent — an unattributable agent is the failure
    // mode the whole identity model exists to prevent (§4.4).
    owner: row.author_owner_handle
      ? { handle: row.author_owner_handle, displayName: row.author_owner_display_name || null }
      : null,
  };
}

export function serializeThreadSummary(row) {
  return {
    shortId: row.short_id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    space: row.space_slug ? { slug: row.space_slug, name: row.space_name, kind: row.space_kind } : null,
    author: serializeAuthor(row),
    postCount: Number(row.post_count ?? 0),
    isResolved: Boolean(row.resolved_at),
    // Surfaced so the UI can show "unanswered for 6h" — the one place recency
    // is legitimate, because §5.2 makes waiting time a NEED signal, not a
    // freshness signal.
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    resolvedAt: row.resolved_at || null,
    tags: Array.isArray(row.tags) ? row.tags.filter(Boolean) : [],
    source: row.source || null,
    // Binding score and ADVISORY agent signal are returned as separate fields and
    // must stay separate in the UI too — D6: agents surface, humans decide. Summing
    // them would silently give a swarm a vote.
    score: Number(row.score ?? 0),
    advisoryCount: Number(row.advisory_count ?? 0),
    url: `/forum/t/${row.short_id}/${row.slug}`,
  };
}

export function serializePost(row) {
  return {
    id: row.id,
    position: Number(row.position),
    body: row.body,
    author: serializeAuthor(row),
    isAnswer: Boolean(row.is_answer),
    acceptedAt: row.accepted_at || null,
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    source: row.source || null,
    score: Number(row.score ?? 0),
    advisoryCount: Number(row.advisory_count ?? 0),
  };
}

// --------------------------------------------------------------------------
// Reads
// --------------------------------------------------------------------------

export async function listSpaces(db) {
  const { rows } = await db.query(
    `SELECT * FROM forum_spaces
      WHERE status = 'active'
      ORDER BY position ASC, name ASC`,
  );
  return rows.map(serializeSpace);
}

/**
 * List threads in the Record.
 *
 * @param {object} opts
 * @param {string} [opts.space]   space slug
 * @param {string} [opts.tag]     "namespace:value", e.g. "product:canvas"
 * @param {string} [opts.status]  thread status filter
 * @param {string} [opts.sort]    active | newest | oldest | solved
 */
export async function listThreads(db, opts = {}) {
  const where = [`t.status NOT IN ('archived', 'deleted')`];
  const params = [];

  if (opts.space) {
    params.push(opts.space);
    where.push(`s.slug = $${params.length}`);
  }
  if (opts.status && ['open', 'resolved', 'duplicate', 'locked'].includes(opts.status)) {
    params.push(opts.status);
    where.push(`t.status = $${params.length}`);
  }
  if (opts.tag) {
    const [namespace, ...rest] = String(opts.tag).split(':');
    const value = rest.join(':');
    if (namespace && value) {
      params.push(namespace, value);
      where.push(`EXISTS (
        SELECT 1 FROM forum_thread_tags tt
          JOIN forum_tags g ON g.id = tt.tag_id
         WHERE tt.thread_id = t.id
           AND g.namespace = $${params.length - 1}
           AND g.value = $${params.length}
      )`);
    }
  }

  const orderBy = SORT_SQL[opts.sort] || SORT_SQL.active;
  const limit = clampLimit(opts.limit);
  const offset = Math.max(0, Number.parseInt(opts.offset, 10) || 0);

  params.push(limit, offset);

  const { rows } = await db.query(
    `SELECT t.*,
            s.slug AS space_slug, s.name AS space_name, s.kind AS space_kind,
            u.username AS author_username,
            u.display_name AS author_display_name,
            u.avatar_url AS author_avatar_url,
            ow.username AS author_owner_handle,
            ow.display_name AS author_owner_display_name,
            COALESCE(
              (SELECT array_agg(g.namespace || ':' || g.value ORDER BY g.namespace, g.value)
                 FROM forum_thread_tags tt
                 JOIN forum_tags g ON g.id = tt.tag_id
                WHERE tt.thread_id = t.id),
              '{}'
            ) AS tags
       FROM forum_threads t
       JOIN forum_spaces s ON s.id = t.space_id
       LEFT JOIN users u ON u.id = t.author_id
       LEFT JOIN agent_identities ai ON ai.user_id = t.author_id
       LEFT JOIN users ow ON ow.id = ai.owner_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return rows.map(serializeThreadSummary);
}

export async function countThreads(db, opts = {}) {
  const where = [`t.status NOT IN ('archived', 'deleted')`];
  const params = [];
  if (opts.space) {
    params.push(opts.space);
    where.push(`s.slug = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM forum_threads t
       JOIN forum_spaces s ON s.id = t.space_id
      WHERE ${where.join(' AND ')}`,
    params,
  );
  return rows[0]?.n ?? 0;
}

/** A thread with its posts. `null` when the short_id does not resolve. */
export async function getThreadByShortId(db, shortId) {
  const { rows } = await db.query(
    `SELECT t.*,
            s.slug AS space_slug, s.name AS space_name, s.kind AS space_kind,
            u.username AS author_username,
            u.display_name AS author_display_name,
            u.avatar_url AS author_avatar_url,
            ow.username AS author_owner_handle,
            ow.display_name AS author_owner_display_name,
            COALESCE(
              (SELECT array_agg(g.namespace || ':' || g.value ORDER BY g.namespace, g.value)
                 FROM forum_thread_tags tt
                 JOIN forum_tags g ON g.id = tt.tag_id
                WHERE tt.thread_id = t.id),
              '{}'
            ) AS tags
       FROM forum_threads t
       JOIN forum_spaces s ON s.id = t.space_id
       LEFT JOIN users u ON u.id = t.author_id
       LEFT JOIN agent_identities ai ON ai.user_id = t.author_id
       LEFT JOIN users ow ON ow.id = ai.owner_user_id
      WHERE t.short_id = $1`,
    [shortId],
  );

  const thread = rows[0];
  if (!thread) return null;

  const { rows: postRows } = await db.query(
    `SELECT p.*,
            u.username AS author_username,
            u.display_name AS author_display_name,
            u.avatar_url AS author_avatar_url
       FROM forum_posts p
       LEFT JOIN users u ON u.id = p.author_id
       LEFT JOIN agent_identities ai ON ai.user_id = p.author_id
       LEFT JOIN users ow ON ow.id = ai.owner_user_id
      WHERE p.thread_id = $1 AND p.status = 'visible'
      ORDER BY p.position ASC`,
    [thread.id],
  );

  return {
    ...serializeThreadSummary(thread),
    promotedTo: thread.promoted_to || null,
    duplicateOf: thread.duplicate_of || null,
    posts: postRows.map(serializePost),
  };
}

/**
 * Lexical search (§5.1).
 *
 * Fuses two vectors — thread titles and post bodies — because a generated
 * tsvector column can only reference its own row. Titles are weighted 2x: a
 * question whose TITLE matches is far more likely to be the same question.
 *
 * Semantic search (pgvector + xeno-rt embeddings) fuses in at v0.4. This half
 * must never regress: people paste exact error strings, and only lexical
 * matching returns those reliably.
 */
export async function searchThreads(db, query, limit = DEFAULT_LIMIT) {
  const q = String(query || '').trim();
  if (!q) return [];

  const { rows } = await db.query(
    `WITH tsq AS (
       SELECT plainto_tsquery('english', $1) AS q_and,
              -- OR of the same terms. plainto_tsquery ANDs, so a four-word
              -- question needs all four words present — which is why every
              -- realistic paraphrase missed. websearch_to_tsquery keeps the
              -- AND for precision; this is the recall tier beneath it.
              replace(plainto_tsquery('english', $1)::text, ' & ', ' | ')::tsquery AS q_or
     ),
     hits AS (
       -- Tier 1: every term present, in the title. Highest precision.
       SELECT t.id AS thread_id,
              ts_rank(t.search_vector, tsq.q_and) * 4.0 AS rank,
              NULL::text AS body
         FROM forum_threads t, tsq
        WHERE tsq.q_and IS NOT NULL AND t.search_vector @@ tsq.q_and
       UNION ALL
       -- Tier 2: every term present, in a post.
       SELECT p.thread_id,
              ts_rank(p.search_vector, tsq.q_and) * 2.0 AS rank,
              p.body
         FROM forum_posts p, tsq
        WHERE tsq.q_and IS NOT NULL AND p.search_vector @@ tsq.q_and AND p.status = 'visible'
       UNION ALL
       -- Tier 3: ANY term present. Recall, ranked below both AND tiers so it
       -- can never outrank an exact match.
       SELECT t.id, ts_rank(t.search_vector, tsq.q_or) * 1.0, NULL::text
         FROM forum_threads t, tsq
        WHERE tsq.q_or IS NOT NULL AND t.search_vector @@ tsq.q_or
       UNION ALL
       SELECT p.thread_id, ts_rank(p.search_vector, tsq.q_or) * 0.6, p.body
         FROM forum_posts p, tsq
        WHERE tsq.q_or IS NOT NULL AND p.search_vector @@ tsq.q_or AND p.status = 'visible'
       UNION ALL
       -- Tier 4: trigram similarity on the TITLE. Catches what stemming
       -- cannot — "colours" vs "colors", typos, partial words. Threshold 0.18
       -- rather than the 0.3 default: a short query against a long title has
       -- a low similarity even when it is obviously the right thread.
       SELECT t.id, similarity(t.title, $1) * 0.9, NULL::text
         FROM forum_threads t
        WHERE similarity(t.title, $1) > 0.18
     ),
     best AS (
       SELECT DISTINCT ON (thread_id) thread_id, rank, body
         FROM hits
        ORDER BY thread_id, rank DESC
     )
     SELECT t.*,
            s.slug AS space_slug, s.name AS space_name, s.kind AS space_kind,
            u.username AS author_username,
            u.display_name AS author_display_name,
            u.avatar_url AS author_avatar_url,
            ow.username AS author_owner_handle,
            ow.display_name AS author_owner_display_name,
            b.rank,
            ts_headline('english', COALESCE(b.body, t.title), COALESCE(tsq.q_and, tsq.q_or),
                        'MaxFragments=1,MaxWords=30,MinWords=12,StartSel=<mark>,StopSel=</mark>') AS excerpt,
            COALESCE(
              (SELECT array_agg(g.namespace || ':' || g.value ORDER BY g.namespace, g.value)
                 FROM forum_thread_tags tt
                 JOIN forum_tags g ON g.id = tt.tag_id
                WHERE tt.thread_id = t.id),
              '{}'
            ) AS tags
       FROM best b
       JOIN forum_threads t ON t.id = b.thread_id
       JOIN forum_spaces s ON s.id = t.space_id
       LEFT JOIN users u ON u.id = t.author_id
       LEFT JOIN agent_identities ai ON ai.user_id = t.author_id
       LEFT JOIN users ow ON ow.id = ai.owner_user_id,
            tsq
      WHERE t.status NOT IN ('archived', 'deleted')
      ORDER BY b.rank DESC, t.last_activity_at DESC
      LIMIT $2`,
    [q, clampLimit(limit)],
  );

  return rows.map((row) => ({
    ...serializeThreadSummary(row),
    excerpt: row.excerpt || null,
  }));
}

export async function listTags(db, opts = {}) {
  const params = [];
  let where = 'thread_count > 0';
  if (opts.namespace && ['product', 'version', 'topic', 'kind'].includes(opts.namespace)) {
    params.push(opts.namespace);
    where += ` AND namespace = $${params.length}`;
  }
  params.push(clampLimit(opts.limit, 60));

  const { rows } = await db.query(
    `SELECT namespace, value, description, thread_count
       FROM forum_tags
      WHERE ${where}
      ORDER BY thread_count DESC, value ASC
      LIMIT $${params.length}`,
    params,
  );

  return rows.map((r) => ({
    tag: `${r.namespace}:${r.value}`,
    namespace: r.namespace,
    value: r.value,
    description: r.description,
    threadCount: Number(r.thread_count ?? 0),
  }));
}

// ==========================================================================
// FEED support (v0.4).
//
// These two functions gather FACTS. They compute no score — ranking lives
// entirely in forumRanker.js so the forbidden-signal gate has one file to
// police (§5.4). Keep it that way.
// ==========================================================================

/**
 * Everything the ranker needs to know about the viewer.
 * Expertise is per-tag and derived from ACCEPTED answers — the same source as
 * the capability ladder, never a global number (D4).
 */
export async function getViewerContext(db, userId) {
  if (!userId) return {};
  const [expertise, subs, recent, impressions] = await Promise.all([
    db.query(
      `SELECT g.namespace || ':' || g.value AS tag, r.accepted_answers
         FROM forum_reputation r JOIN forum_tags g ON g.id = r.tag_id
        WHERE r.user_id = $1 AND r.accepted_answers > 0`, [userId]),
    db.query(
      `SELECT g.namespace || ':' || g.value AS tag
         FROM forum_subscriptions s JOIN forum_tags g ON g.id = s.tag_id
        WHERE s.user_id = $1 AND s.tag_id IS NOT NULL`, [userId]),
    db.query(
      `SELECT DISTINCT g.namespace || ':' || g.value AS tag
         FROM forum_posts p
         JOIN forum_thread_tags tt ON tt.thread_id = p.thread_id
         JOIN forum_tags g ON g.id = tt.tag_id
        WHERE p.author_id = $1 AND p.created_at > NOW() - INTERVAL '30 days'
        LIMIT 40`, [userId]),
    db.query(
      `SELECT thread_id, shown_count, opened FROM forum_impressions WHERE user_id = $1`, [userId]),
  ]);

  const expertiseTags = {};
  for (const r of expertise.rows) expertiseTags[r.tag] = Number(r.accepted_answers);
  const imp = {};
  for (const r of impressions.rows) imp[r.thread_id] = { shownCount: r.shown_count, opened: r.opened };

  return {
    id: userId,
    expertiseTags,
    subscribedTags: subs.rows.map((r) => r.tag),
    recentTags: recent.rows.map((r) => r.tag),
    impressions: imp,
  };
}

/**
 * Candidate pool for the Feed.
 *
 * Bounded deliberately: ranking every thread ever written is neither necessary
 * nor affordable. Unresolved threads are never excluded by age — an old
 * unanswered question is exactly what §5.2 wants surfaced, so the cut is by
 * recency of ACTIVITY, not creation.
 */
export async function getFeedCandidates(db, { limit = 300 } = {}) {
  const { rows } = await db.query(
    `SELECT t.id, t.short_id, t.slug, t.title, t.status, t.author_id, t.author_kind,
            t.post_count, t.score, t.advisory_count, t.created_at, t.last_activity_at,
            t.resolved_at, t.distinct_participants,
            s.slug AS space_slug, s.name AS space_name, s.kind AS space_kind,
            u.username AS author_username, u.display_name AS author_display_name,
            u.avatar_url AS author_avatar_url,
            ow.username AS author_owner_handle, ow.display_name AS author_owner_display_name,
            (SELECT COUNT(*) FROM forum_posts p
              WHERE p.thread_id = t.id AND p.position > 1 AND p.status = 'visible')::int AS answer_count,
            (SELECT length(p.body) FROM forum_posts p
              WHERE p.thread_id = t.id AND p.position = 1)::int AS body_length,
            (SELECT p.body LIKE '%\`\`\`%' FROM forum_posts p
              WHERE p.thread_id = t.id AND p.position = 1) AS has_code_block,
            COALESCE((SELECT array_agg(g.namespace || ':' || g.value ORDER BY g.namespace, g.value)
                        FROM forum_thread_tags tt JOIN forum_tags g ON g.id = tt.tag_id
                       WHERE tt.thread_id = t.id), '{}') AS tags,
            COALESCE((SELECT SUM(r.accepted_answers) FROM forum_reputation r
                       JOIN forum_thread_tags tt2 ON tt2.tag_id = r.tag_id
                      WHERE r.user_id = t.author_id AND tt2.thread_id = t.id), 0)::int AS author_trust
       FROM forum_threads t
       JOIN forum_spaces s ON s.id = t.space_id
       LEFT JOIN users u ON u.id = t.author_id
       LEFT JOIN agent_identities ai ON ai.user_id = t.author_id
       LEFT JOIN users ow ON ow.id = ai.owner_user_id
      WHERE t.status NOT IN ('archived', 'locked', 'deleted')
        AND (t.resolved_at IS NULL OR t.last_activity_at > NOW() - INTERVAL '30 days')
      ORDER BY t.last_activity_at DESC
      LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({
    ...serializeThreadSummary(row),
    id: row.id,
    authorId: row.author_id,
    spaceKind: row.space_kind,
    spaceSlug: row.space_slug,
    answerCount: Number(row.answer_count ?? 0),
    distinctParticipants: Number(row.distinct_participants ?? 0),
    bodyLength: Number(row.body_length ?? 0),
    hasCodeBlock: Boolean(row.has_code_block),
    authorTrust: Number(row.author_trust ?? 0),
  }));
}

/** Record what the Feed showed and why, for seen-decay and D11 auditability. */
export async function recordImpressions(db, userId, items, ranker) {
  if (!userId || !items.length) return;
  const ids = items.map((i) => i.id);
  const reasons = items.map((i) => (i.reasons || []).join(','));
  await db.query(
    `INSERT INTO forum_impressions (user_id, thread_id, shown_count, reason_codes, ranker)
     SELECT $1, x.tid::uuid, 1, string_to_array(x.rc, ','), $4
       FROM unnest($2::text[], $3::text[]) AS x(tid, rc)
     ON CONFLICT (user_id, thread_id) DO UPDATE
       SET shown_count = forum_impressions.shown_count + 1,
           reason_codes = EXCLUDED.reason_codes,
           ranker = EXCLUDED.ranker,
           last_shown = NOW()`,
    [userId, ids, reasons, ranker],
  );
}

/** Mark a thread opened — the strongest anti-nag signal we have. */
export async function markOpened(db, userId, threadId) {
  if (!userId) return;
  await db.query(
    `INSERT INTO forum_impressions (user_id, thread_id, opened) VALUES ($1, $2, TRUE)
     ON CONFLICT (user_id, thread_id) DO UPDATE SET opened = TRUE, last_shown = NOW()`,
    [userId, threadId],
  );
}

/**
 * Everything a person has taken part in (WP5).
 *
 * Not "threads you authored" — that is the easy query and the wrong one. If you
 * answered a question three weeks ago and want to find it again, it was never
 * yours to begin with, and a list of what you STARTED will never contain it.
 * So this unions threads you authored with threads you posted in, and says
 * which it was.
 *
 * Deleted content is excluded on both sides: a tombstone you can still find in
 * your own history is a delete that did not take.
 */
export async function listMyActivity(db, userId, { limit = 40 } = {}) {
  const capped = Math.min(100, Math.max(1, Number(limit) || 40));
  const { rows } = await db.query(
    `SELECT t.*, s.slug AS space_slug, s.name AS space_name, s.kind AS space_kind,
            (t.author_id = $1) AS authored,
            (SELECT COUNT(*) FROM forum_posts p
              WHERE p.thread_id = t.id AND p.author_id = $1 AND p.status = 'visible'
                AND p.position > 1) AS my_replies,
            (SELECT array_agg(g.namespace || ':' || g.value ORDER BY g.namespace, g.value)
               FROM forum_thread_tags tt JOIN forum_tags g ON g.id = tt.tag_id
              WHERE tt.thread_id = t.id) AS tags
       FROM forum_threads t
       JOIN forum_spaces s ON s.id = t.space_id
      WHERE t.status NOT IN ('archived', 'deleted')
        AND (
          t.author_id = $1
          OR EXISTS (SELECT 1 FROM forum_posts p
                      WHERE p.thread_id = t.id AND p.author_id = $1
                        AND p.status = 'visible' AND p.position > 1)
        )
      ORDER BY t.last_activity_at DESC
      LIMIT $2`,
    [userId, capped],
  );

  return rows.map((r) => ({
    ...serializeThreadSummary(r),
    // Why it is in YOUR list — the same explain-yourself rule the Feed follows
    // (D11). "You asked this" and "you answered this" are different memories,
    // and a list that flattens them is harder to scan than one that does not.
    mine: r.authored ? 'asked' : 'answered',
    myReplies: Number(r.my_replies || 0),
  }));
}

/**
 * The public moderation log (§7.2, §11).
 *
 * "If the thesis is openness, moderation is where it is tested." A forum that
 * removes things silently is asking to be trusted; one that publishes what it
 * removed and why is showing its work.
 *
 * ── WHAT IS IN IT, AND WHAT IS DELIBERATELY NOT ─────────────────────────────
 *
 * 🔴 ACTIONS TAKEN, NEVER ACCUSATIONS MADE. Dismissed flags do not appear.
 * Publishing them would create a permanent public record that a named person
 * was reported for "abuse" and cleared — which is a worse outcome for an
 * innocent author than the report ever was, and it turns the log into a weapon:
 * anyone could put a neighbour in the public record just by reporting them.
 * A dismissal is visible to the reviewer, and to nobody else.
 *
 * 🔴 NEVER THE REPORTER. A flag is an accusation; naming the accuser publicly
 * makes reporting an act of open conflict, and the people most in need of the
 * report button are the ones least able to afford that.
 *
 * 🔴 NEVER THE REMOVED CONTENT. Republishing what was hidden defeats hiding it,
 * and would make the log the most reliable place to find exactly the material
 * moderation exists to remove.
 *
 * What remains is the accountable part: something was removed, from where, by
 * which moderator, when, and under which reason category. Enough to audit a
 * moderator; not enough to relitigate a victim.
 *
 * Public — no auth. A log only staff can read is not a public log.
 */
export async function listModerationLog(db, { limit = 50 } = {}) {
  const capped = Math.min(200, Math.max(1, Number(limit) || 50));
  const { rows } = await db.query(
    `SELECT f.id, f.target_type, f.reason, f.resolved_at,
            COALESCE(mu.display_name, mu.username) AS moderator,
            t.short_id AS thread_short_id, t.slug AS thread_slug, t.title AS thread_title,
            p.position AS post_position,
            CASE WHEN f.target_type = 'post' THEN p.status ELSE t.status END AS target_status
       FROM forum_flags f
       LEFT JOIN users mu ON mu.id = f.resolved_by
       LEFT JOIN forum_posts p   ON f.target_type = 'post' AND p.id = f.target_id
       LEFT JOIN forum_threads t ON t.id = COALESCE(p.thread_id,
                                     CASE WHEN f.target_type = 'thread' THEN f.target_id END)
      WHERE f.status = 'actioned'
      ORDER BY f.resolved_at DESC
      LIMIT $1`,
    [capped],
  );

  // One decision per target, not one row per report. Three people reporting the
  // same post produced three flag rows and ONE moderator decision; listing it
  // three times would misrepresent both the volume of moderation and the
  // amount of trouble a single author caused.
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = `${r.target_type}:${r.thread_short_id}:${r.post_position ?? 'thread'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      at: r.resolved_at,
      what: r.target_type,
      // 'hidden' vs 'locked' vs the author's own 'deleted' are different facts.
      // The log states which, because "removed" flattens a moderator decision
      // and a retraction into one word.
      outcome: r.target_status,
      reason: r.reason,
      moderator: r.moderator || 'a moderator',
      thread: r.thread_short_id
        ? { shortId: r.thread_short_id, title: r.thread_title,
            url: `/forum/t/${r.thread_short_id}/${r.thread_slug}` }
        : null,
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Loop D — the digest (WP6)
// --------------------------------------------------------------------------

/**
 * What an agent is allowed to declare.
 *
 * Narrow on purpose. A predicate that can express anything is a query language,
 * and a query language on a polling endpoint is a way to make the database do
 * arbitrary work on request. These four fields answer the question SPEC §6.2
 * poses — "what do you care about, and how much do you want" — and nothing else.
 */
export function normalizePredicate(input) {
  const p = input && typeof input === 'object' ? input : {};
  const out = {};

  const space = String(p.space || '').trim().toLowerCase();
  if (space && /^[a-z][a-z0-9-]{0,31}$/.test(space)) out.space = space;

  const tags = Array.isArray(p.tags) ? p.tags : [];
  const clean = tags
    .map((t) => String(t || '').trim().toLowerCase())
    .filter((t) => /^(product|version|topic|kind):[a-z0-9][a-z0-9._-]{0,79}$/.test(t))
    .slice(0, 8);
  if (clean.length) out.tags = clean;

  if (['unanswered', 'any'].includes(p.status)) out.status = p.status;

  // CLAMPED, not merely validated. An agent asking for 10000 an hour is either
  // confused or hostile, and either way the server should answer the sane
  // version of the question rather than refuse and leave it unsubscribed.
  const n = Number(p.max_per_hour);
  out.max_per_hour = Number.isFinite(n) ? Math.min(60, Math.max(1, Math.floor(n))) : 4;

  return out;
}

/**
 * Register (or replace) a standing query.
 *
 * SPEC §6.2 — "agents subscribe; they do not scroll." ONE row per subscriber:
 * three overlapping predicates would deliver the same thread three times with
 * no way for the agent to notice it had.
 */
export async function setPredicate(db, userId, predicate) {
  const p = normalizePredicate(predicate);
  await db.query(
    `INSERT INTO forum_subscriptions (user_id, predicate) VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id) WHERE predicate IS NOT NULL
     DO UPDATE SET predicate = EXCLUDED.predicate`,
    [userId, JSON.stringify(p)],
  );
  return p;
}

export async function getPredicate(db, userId) {
  const { rows } = await db.query(
    'SELECT predicate, last_digest_at FROM forum_subscriptions WHERE user_id = $1 AND predicate IS NOT NULL',
    [userId],
  );
  return rows[0] ? { predicate: rows[0].predicate, lastDigestAt: rows[0].last_digest_at } : null;
}

/**
 * The digest.
 *
 * 🔴 AGGREGATED, NOT A FEED. An agent handed a stream of individual threads
 * summarises them badly and repeatedly — and worse, summarises the SAME thread
 * differently on two consecutive runs, so a human reading its reports cannot
 * tell a new problem from a re-description of an old one. The digest is
 * pre-grouped and pre-ranked so the agent's job is to ACT on a finding, never
 * to decide what the findings are.
 *
 * Three sections, each answering a question a product session actually asks:
 *
 *   rising   what are people hitting, by DISTINCT REPORTERS, and is it getting
 *            worse? The delta is the point — "7 people, up from 2" is a
 *            decision; "7 people" is a number.
 *   waiting  what has gone unanswered too long — the queue a dev agent can
 *            actually clear.
 *   shipped  what was marked fixed since last time, from Loop C's write-back.
 *            Without it an agent re-reports things the team already fixed,
 *            which is exactly how a digest destroys its own credibility.
 *
 * ── `channel` — ONE parameter, because the two behaviours are not independent ─
 *
 * Computing the digest both CONSULTS and STAMPS `last_digest_at`. Both belong to
 * the PULL channel: the webhook push has its own clock (`last_push_at`), and a
 * push that advanced the pull cursor would consume a window the agent's next
 * poll was about to ask for — the poll would succeed, return nothing, and
 * nothing would report the loss.
 *
 * These started as two flags (`enforceRate`, `advanceCursor`) and were collapsed
 * because three of the four combinations are wrong, and one is a trap: enforcing
 * against a clock you never advance means the FIRST call sets the clock and
 * every later call is refused forever. A parameter whose invalid settings are
 * unrepresentable beats two booleans and a comment.
 *
 *   channel: 'pull'  consults and stamps last_digest_at  (REST, MCP, any client)
 *   channel: 'push'  touches neither — the sweep owns last_push_at
 *
 * 🔴 THE RATE LIMIT LIVES HERE, NOT IN THE ROUTE. It used to be in the REST
 * handler, which meant the MCP `forum_digest` tool — used by exactly the agents
 * `max_per_hour` exists to restrain — bypassed it completely by choosing the
 * other surface. The route's own comment warns that a second code path is how
 * two surfaces drift; it had already happened one function below. Enforcing in
 * the service makes every present and future surface inherit the rule.
 */
export async function getDigest(db, userId, { since, channel = 'pull' } = {}) {
  const isPull = channel !== 'push';
  const sub = await getPredicate(db, userId);
  if (!sub) return { subscribed: false, sections: null };

  const p = sub.predicate || {};

  // 429 with a retry time, never a silent empty digest: an agent handed `{}`
  // learns nothing and polls again immediately, which is precisely the
  // behaviour the limit exists to stop.
  if (isPull && sub.lastDigestAt && p.max_per_hour) {
    const minGapMs = 3600000 / Number(p.max_per_hour);
    const waited = Date.now() - new Date(sub.lastDigestAt).getTime();
    if (waited < minGapMs) {
      throw new ForumError(
        'Digest requested faster than the predicate allows',
        'digest_rate_limited',
        429,
        { retryAfterSeconds: Math.ceil((minGapMs - waited) / 1000) },
      );
    }
  }
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const space = p.space || null;

  const parsed = since ? new Date(since) : null;
  const valid = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  // Clamped to 30 days. A digest is a "what changed" report; a window wide
  // enough to include everything is just the corpus again, and an agent asking
  // for five years of history on a poll endpoint is asking the database to do
  // arbitrary work.
  const windowStart = valid && (Date.now() - valid.getTime()) < 30 * 864e5
    ? valid
    : new Date(Date.now() - 7 * 864e5);

  const tagList = tags.length ? tags : null;

  /*
   * 🔴 PARAMETERS ARE NUMBERED PER QUERY, NOT SHARED ACROSS ALL THREE.
   *
   * The first version passed one `[window, tags, space]` array to all three
   * statements. `waiting` is deliberately STATE-based — "still open, still
   * unanswered", with no time bound — so it never referenced $1, and Postgres
   * cannot infer the type of a parameter a statement does not use:
   *
   *     error: could not determine data type of parameter $1
   *
   * Every digest call threw. It went unnoticed because `forum_subscriptions`
   * held zero predicates until this feature existed, so the endpoint had never
   * once run with a real subscriber — the query was correct in isolation and
   * unreachable in practice, which is this codebase's signature failure.
   *
   * Each filter now takes its own placeholder index and each statement passes
   * exactly the parameters it uses.
   */
  const tagFilter = (i) => `(
      $${i}::text[] IS NULL OR EXISTS (
        SELECT 1 FROM forum_thread_tags tt JOIN forum_tags g ON g.id = tt.tag_id
         WHERE tt.thread_id = t.id AND (g.namespace || ':' || g.value) = ANY($${i}::text[])
      ))`;
  const spaceFilter = (i) => `($${i}::text IS NULL OR s.slug = $${i}::text)`;
  const alive = "t.status NOT IN ('archived', 'deleted')";

  const [rising, waiting, shipped] = await Promise.all([
    // DISTINCT REPORTERS, never reply count — breadth of impact, not volume of
    // argument (§5.2). The prior-window count is what makes it a trend.
    db.query(
      `SELECT t.short_id, t.title, t.slug,
              COUNT(DISTINCT p.author_id) FILTER (WHERE p.created_at >= $1) AS reporters_now,
              COUNT(DISTINCT p.author_id) FILTER (WHERE p.created_at <  $1) AS reporters_before
         FROM forum_threads t
         JOIN forum_spaces s ON s.id = t.space_id
         LEFT JOIN forum_posts p ON p.thread_id = t.id AND p.status = 'visible'
        WHERE ${alive} AND s.kind = 'feedback' AND ${tagFilter(2)} AND ${spaceFilter(3)}
        GROUP BY t.id, t.short_id, t.title, t.slug
       HAVING COUNT(DISTINCT p.author_id) FILTER (WHERE p.created_at >= $1) > 0
        ORDER BY 4 DESC, 5 DESC LIMIT 10`,
      [windowStart.toISOString(), tagList, space],
    ),
    db.query(
      `SELECT t.short_id, t.title, t.slug, t.created_at,
              EXTRACT(EPOCH FROM (NOW() - t.last_activity_at))/3600 AS hours_quiet
         FROM forum_threads t
         JOIN forum_spaces s ON s.id = t.space_id
        WHERE ${alive} AND t.status = 'open' AND t.answer_post_id IS NULL
          AND t.fixed_in_version IS NULL
          AND ${tagFilter(1)} AND ${spaceFilter(2)}
        ORDER BY t.last_activity_at ASC LIMIT 10`,
      // No window: "waiting" is a STATE, not a change. A thread that went quiet
      // three weeks ago is more overdue than one that went quiet yesterday, and
      // dropping it out of the digest because it is old is precisely backwards.
      [tagList, space],
    ),
    db.query(
      `SELECT t.short_id, t.title, t.slug, t.fixed_in_version, t.fixed_at
         FROM forum_threads t
         JOIN forum_spaces s ON s.id = t.space_id
        WHERE ${alive} AND t.fixed_at >= $1::timestamptz AND ${tagFilter(2)} AND ${spaceFilter(3)}
        ORDER BY t.fixed_at DESC LIMIT 10`,
      [windowStart.toISOString(), tagList, space],
    ),
  ]);

  const url = (r) => `/forum/t/${r.short_id}/${r.slug}`;

  if (isPull) {
    await db.query(
      'UPDATE forum_subscriptions SET last_digest_at = NOW() WHERE user_id = $1 AND predicate IS NOT NULL',
      [userId],
    );
  }

  return {
    subscribed: true,
    predicate: p,
    since: windowStart.toISOString(),
    sections: {
      rising: rising.rows.map((r) => ({
        shortId: r.short_id, title: r.title, url: url(r),
        reporters: Number(r.reporters_now),
        wasReporters: Number(r.reporters_before),
        // STATED, not left for the reader to subtract. An agent that has to
        // compute the delta will sometimes compute it wrong, and a wrong trend
        // is worse than no trend.
        rising: Number(r.reporters_now) > Number(r.reporters_before),
      })),
      waiting: waiting.rows.map((r) => ({
        shortId: r.short_id, title: r.title, url: url(r),
        hoursQuiet: Math.round(Number(r.hours_quiet)),
      })),
      shipped: shipped.rows.map((r) => ({
        shortId: r.short_id, title: r.title, url: url(r),
        fixedIn: r.fixed_in_version, fixedAt: r.fixed_at,
      })),
    },
  };
}
