/**
 * XENO Forum — the bridge from notification EVENTS to notification EMAIL (WP1).
 *
 * 941ce58 added the templates (`forum_answer`, `forum_accepted`, `forum_reply`).
 * 6f6c1e2 added the events. This is the only thing that connects them, and
 * without it both halves are complete and the user still hears nothing — which
 * is precisely the "built, tested, unreachable" shape this codebase has shipped
 * three times.
 *
 * ── WHY A DELAYED SWEEP AND NOT A SEND AT notify() TIME ─────────────────────
 *
 * Because the best notification email is the one you never had to send. If the
 * reader is on the site when the answer lands, they see it, `read_at` is
 * stamped, and mailing them afterwards is pure noise.
 *
 * That is the entire reason `read_at` and `emailed_at` are separate clocks on
 * the row rather than one `notified_at`. The sweep only considers notifications
 * that are still UNREAD and older than a short grace period.
 *
 * ── AT-MOST-ONCE, DELIBERATELY ──────────────────────────────────────────────
 *
 * Rows are CLAIMED (emailed_at stamped) in the same statement that selects
 * them, before any mail is attempted. A crash between claim and send therefore
 * loses that email rather than sending it twice.
 *
 * That trade is chosen, not accidental: the in-app notification still exists
 * and the badge still shows, so a missed email costs a reader a little latency.
 * A DUPLICATED email costs the product its credibility — people who get the
 * same mail twice start filtering the sender, and then no notification works
 * again. `FOR UPDATE SKIP LOCKED` makes it safe to run more than one worker.
 */

import { sendEmail } from './emailService.js';

/**
 * OFF unless explicitly enabled. Mailing real users is an outward-facing act
 * and must be a switch somebody throws, never something that arrives as a side
 * effect of a deploy.
 *
 * Fail-safe in the same shape as `registrationGate.js`: anything that is not
 * the exact string 'true' resolves to disabled.
 */
export function emailsEnabled(env = process.env) {
  return String(env.FORUM_NOTIFICATION_EMAILS ?? '').trim().toLowerCase() === 'true';
}

/** kind → template. A kind with no template is skipped, never guessed at. */
const TEMPLATE_FOR_KIND = {
  answer: 'forum_answer',
  reply: 'forum_reply',
  accepted: 'forum_accepted',
};

const EXCERPT_CHARS = 600;

/**
 * Claim and send. Returns a report — callers (a scheduler, a test, an operator
 * running it by hand) all get the same shape.
 *
 * @param {object} db
 * @param {object} [opts]
 * @param {number} [opts.delayMinutes=3]  grace period for the reader to see it in-app
 * @param {number} [opts.batch=50]        rows claimed per sweep
 * @param {number} [opts.perUser=3]       max emails to one person per sweep
 * @param {function} [opts.send]          the mailer; injected so this is testable
 *   without a live Resend key or a Postgres. The seam is deliberate — a sweep
 *   whose only proof is "it compiles" is how the unreachable-feature bug keeps
 *   happening here.
 * @param {object} [opts.env]             for testing the fail-safe flag
 */
export async function sendPendingNotificationEmails(db, opts = {}) {
  const { delayMinutes = 3, batch = 50, perUser = 3, send = sendEmail, env = process.env } = opts;

  if (!emailsEnabled(env)) {
    return { enabled: false, claimed: 0, sent: 0, skipped: 0, failed: 0 };
  }

  // Claim and select in ONE statement. Anything less is a race: two workers
  // reading the same rows before either writes will both send.
  const { rows: claimed } = await db.query(
    `WITH due AS (
       SELECT id FROM forum_notifications
        WHERE emailed_at IS NULL
          AND read_at IS NULL
          AND created_at < NOW() - ($1 || ' minutes')::interval
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $2
     )
     UPDATE forum_notifications n
        SET emailed_at = NOW()
       FROM due
      WHERE n.id = due.id
     RETURNING n.id`,
    [String(delayMinutes), batch],
  );

  if (!claimed.length) return { enabled: true, claimed: 0, sent: 0, skipped: 0, failed: 0 };

  const ids = claimed.map((r) => r.id);
  const { rows } = await db.query(
    `SELECT n.id, n.kind, n.post_id,
            u.email, COALESCE(u.display_name, u.username) AS display_name,
            t.title AS thread_title, t.short_id, t.slug,
            COALESCE(au.display_name, au.username) AS actor_name,
            n.actor_kind,
            COALESCE(ou.display_name, ou.username) AS actor_owner,
            COALESCE(ask.display_name, ask.username) AS asker_name,
            p.body AS post_body
       FROM forum_notifications n
       JOIN users u            ON u.id = n.user_id
       LEFT JOIN forum_threads t ON t.id = n.thread_id
       LEFT JOIN forum_posts p   ON p.id = n.post_id
       LEFT JOIN users au        ON au.id = n.actor_id
       LEFT JOIN agent_identities ai ON ai.user_id = n.actor_id
       LEFT JOIN users ou        ON ou.id = ai.owner_user_id
       LEFT JOIN users ask       ON ask.id = t.author_id
      WHERE n.id = ANY($1::uuid[])`,
    [ids],
  );

  const site = process.env.SITE_URL || 'https://xenostudio.ai';
  const perUserSent = new Map();
  let sent = 0; let skipped = 0; let failed = 0;

  for (const r of rows) {
    const template = TEMPLATE_FOR_KIND[r.kind];
    // No email address, no template, or no thread to point at — nothing to send.
    // Already claimed, so it will not be retried; that is correct for a row we
    // can never render.
    if (!template || !r.email || !r.short_id) { skipped += 1; continue; }

    const already = perUserSent.get(r.email) ?? 0;
    if (already >= perUser) { skipped += 1; continue; }

    try {
      await send(db, template, r.email, {
        displayName: r.display_name,
        threadTitle: r.thread_title,
        threadUrl: `${site}/forum/t/${r.short_id}/${r.slug}`,
        authorName: r.actor_name,
        authorKind: r.actor_kind,
        // An agent's OWNER travels with it. SPEC §4.4 — nobody should have to
        // guess whether they are reading a person, and the owner is who is
        // accountable for it.
        authorOwner: r.actor_owner,
        askerName: r.asker_name,
        excerpt: (r.post_body || '').slice(0, EXCERPT_CHARS),
      });
      perUserSent.set(r.email, already + 1);
      sent += 1;
    } catch (err) {
      // Claimed rows are NOT un-claimed on failure — see the at-most-once note
      // at the top. Surface it loudly instead; a silent mail failure is how you
      // discover months later that nobody has been notified.
      console.error(`[ForumNotifyEmail] send failed for ${r.id} (${template}):`, err.message);
      failed += 1;
    }
  }

  return { enabled: true, claimed: ids.length, sent, skipped, failed };
}

/**
 * Start the recurring sweep. Returns a stop function.
 *
 * Deliberately NOT on the Redis-backed JobQueue: this is a periodic scan of one
 * indexed table, it must keep working when Redis is down (the queue degrades to
 * "DB-only" precisely then), and coupling the return path of the Forum to a
 * cache is the kind of dependency you regret at 3am.
 */
export function startNotificationEmailSweep(db, { intervalMs = 120000, ...opts } = {}) {
  if (!emailsEnabled()) {
    console.log('[ForumNotifyEmail] disabled (FORUM_NOTIFICATION_EMAILS is not "true")');
    return () => {};
  }
  const timer = setInterval(() => {
    sendPendingNotificationEmails(db, opts)
      .then((r) => { if (r.sent || r.failed) console.log('[ForumNotifyEmail]', r); })
      .catch((err) => console.error('[ForumNotifyEmail] sweep failed:', err.message));
  }, intervalMs);
  timer.unref?.();
  console.log(`[ForumNotifyEmail] sweep every ${Math.round(intervalMs / 1000)}s`);
  return () => clearInterval(timer);
}
