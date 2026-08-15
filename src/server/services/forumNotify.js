/**
 * XENO Forum — notifications (WP1).
 *
 * The return path. Until this existed the Forum was write-only from the user's
 * point of view: you asked, somebody answered, and you were never told.
 *
 * ── ONE CHOKE POINT ─────────────────────────────────────────────────────────
 *
 * Every notification in the product is created by `notify()` and nothing else.
 * That is deliberate: the rules below (never notify yourself, never notify a
 * service principal, collapse repeats) are only true if there is exactly one
 * place they can be enforced. Two call sites writing INSERTs directly is how
 * "why did I get four emails" becomes unfixable.
 *
 * ── THE FAILURE MODE THIS FILE IS WRITTEN AGAINST ───────────────────────────
 *
 * A notifications table that nothing writes to is the exact defect this
 * codebase has now shipped three times (xeno-workflow's 76 unregistered node
 * types, xeno-tools' never-called `install`, and the Forum's own subscriptions
 * where the ranker scored a signal nothing could write). So the gate that
 * matters is not "does notify() work" — it is "does createPost CALL it".
 * See `scripts/forum-notify.test.mjs`.
 */

/**
 * Create a notification. Returns the row id, or `null` when the notification
 * was deliberately not created — callers must treat null as normal, not as
 * failure.
 *
 * Suppressed, in this order:
 *
 *   1. No recipient. Seeded/system threads have `author_id IS NULL`; there is
 *      nobody to tell.
 *   2. **You caused it yourself.** Replying to your own thread must not notify
 *      you. This is the single most important rule here — self-notification is
 *      how a product trains people to ignore the badge within a day.
 *   3. The recipient is a service principal. No owner, no inbox, no point.
 */
export async function notify(db, { userId, kind, threadId = null, postId = null, actor = null }) {
  if (!userId) return null;
  if (actor && String(actor.id) === String(userId)) return null;

  const { rows: recipient } = await db.query(
    `SELECT u.id, u.role, (a.user_id IS NOT NULL) AS is_agent
       FROM users u LEFT JOIN agent_identities a ON a.user_id = u.id
      WHERE u.id = $1 AND u.is_active = TRUE`,
    [userId],
  );
  if (!recipient.length) return null;
  if (recipient[0].role === 'service') return null;

  const { rows } = await db.query(
    `INSERT INTO forum_notifications (user_id, kind, thread_id, post_id, actor_id, actor_kind)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [userId, kind, threadId, postId, actor?.id ?? null, actor?.kind ?? null],
  );
  // ON CONFLICT fires on the partial unique index for 'accepted' — re-accepting
  // an answer must not re-notify. No row back is a correct, quiet outcome.
  return rows[0]?.id ?? null;
}

/** Unread count for the badge. The hottest query in the product. */
export async function unreadCount(db, userId) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS n FROM forum_notifications WHERE user_id = $1 AND read_at IS NULL',
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * The list. Joins through to the thread so a notification can be RENDERED
 * without a second round trip per row — a notifications panel that N+1s is a
 * notifications panel that gets disabled.
 */
export async function listNotifications(db, userId, { unreadOnly = false, limit = 30 } = {}) {
  const capped = Math.min(100, Math.max(1, Number(limit) || 30));
  const { rows } = await db.query(
    `SELECT n.id, n.kind, n.created_at, n.read_at,
            t.short_id AS thread_short_id, t.slug AS thread_slug, t.title AS thread_title,
            n.post_id,
            n.actor_kind,
            COALESCE(au.display_name, au.username) AS actor_name
       FROM forum_notifications n
       LEFT JOIN forum_threads t ON t.id = n.thread_id
       LEFT JOIN users au       ON au.id = n.actor_id
      WHERE n.user_id = $1 ${unreadOnly ? 'AND n.read_at IS NULL' : ''}
      ORDER BY n.created_at DESC
      LIMIT $2`,
    [userId, capped],
  );

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    createdAt: r.created_at,
    read: Boolean(r.read_at),
    // A deleted actor anonymises rather than vanishing — see the migration's
    // note on ON DELETE SET NULL.
    actor: r.actor_name ? { name: r.actor_name, kind: r.actor_kind } : null,
    thread: r.thread_short_id
      ? { shortId: r.thread_short_id, title: r.thread_title,
          url: `/forum/t/${r.thread_short_id}/${r.thread_slug}` }
      : null,
    postId: r.post_id,
  }));
}

/**
 * Mark read. `ids` omitted means "all", which is what the "mark all read"
 * affordance calls.
 *
 * Always scoped by `user_id` in the WHERE clause — never by id alone. Marking
 * by id without the owner check lets anyone clear anyone's notifications by
 * guessing a uuid, and it would look like it worked.
 */
export async function markRead(db, userId, ids = null) {
  if (Array.isArray(ids) && ids.length === 0) return { updated: 0 };
  const { rowCount } = ids
    ? await db.query(
        `UPDATE forum_notifications SET read_at = NOW()
          WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::uuid[])`,
        [userId, ids],
      )
    : await db.query(
        'UPDATE forum_notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL',
        [userId],
      );
  return { updated: rowCount };
}
