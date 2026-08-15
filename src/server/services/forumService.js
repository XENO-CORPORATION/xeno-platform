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
    `WITH tsq AS (SELECT plainto_tsquery('english', $1) AS q),
     hits AS (
       SELECT t.id AS thread_id,
              ts_rank(t.search_vector, tsq.q) * 2.0 AS rank,
              NULL::text AS body
         FROM forum_threads t, tsq
        WHERE t.search_vector @@ tsq.q
       UNION ALL
       SELECT p.thread_id,
              ts_rank(p.search_vector, tsq.q) AS rank,
              p.body
         FROM forum_posts p, tsq
        WHERE p.search_vector @@ tsq.q AND p.status = 'visible'
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
            ts_headline('english', COALESCE(b.body, t.title), tsq.q,
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
