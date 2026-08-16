/**
 * XENO Forum — Loop D, the PUSH half (WP6).
 *
 * The pull half shipped: an agent declares a predicate and polls
 * `GET /api/forum/digest`. That is the right default for an agent session on a
 * workstation, which cannot receive an inbound request. It is the wrong default
 * for the case the loop exists for — a product's dev agent that should be TOLD
 * when its users start hitting something, instead of remembering to ask.
 *
 * ── 🔴 THE DELIVERY ENGINE HAD NO PRODUCERS ─────────────────────────────────
 *
 * `dispatchWebhookEvent` in `routes/webhookRoutes.js` is a complete delivery
 * system: HMAC-SHA256 signing, an SSRF guard on registration, delivery rows,
 * exponential-backoff retry to 5 attempts. A repo-wide search for callers
 * returns NOTHING. The release plan lists it as "built (billing uses it)";
 * billing does not use it, and nor does anything else.
 *
 * That is the eleventh instance of this codebase's signature defect — after
 * xeno-workflow's 76 unregistered node types, xeno-tools' never-called
 * `install`, this Forum's write-only `forum_flags`, its unwritable
 * subscriptions, and the product-page widget mounted on a dispatcher branch
 * nobody renders. So this file is the first producer, and its gates lead with
 * "did a request actually leave" rather than with correctness.
 *
 * ── WHAT GETS PUSHED: A DIGEST, NEVER A FEED ────────────────────────────────
 *
 * §3.2 is explicit and the reasoning is worth keeping: an agent handed a stream
 * of individual threads summarises them badly and repeatedly, and summarises the
 * SAME thread differently on two consecutive runs — so the human reading its
 * reports cannot tell a new problem from a re-description of an old one. Push
 * carries exactly what pull carries, so an agent that switches channels does not
 * get a different product.
 *
 * ── THE FOUR RULES ──────────────────────────────────────────────────────────
 *
 * 1. SEPARATE CLOCK. Push reads and writes `last_push_at`; pull owns
 *    `last_digest_at`. Sharing one would make each channel silently consume the
 *    other's window — see the migration.
 *
 * 2. NEVER PUSH AN EMPTY DIGEST. An agent that receives "nothing happened" on a
 *    schedule learns to ignore the channel, and then the one that matters
 *    arrives into a filter. Same principle as the product-page widget rendering
 *    nothing rather than an empty section: silence is a message, and it is the
 *    correct one.
 *
 * 3. THE CURSOR ADVANCES ONLY IF SOMETHING WAS ENQUEUED. `dispatchWebhookEvent`
 *    returns how many webhooks matched. Zero means this agent has a predicate
 *    but no endpoint registered for `forum.digest` — a pure-pull subscriber.
 *    Burning its window would silently strip content from the poll it is about
 *    to make.
 *
 * 4. ONE RETRY AUTHORITY. The delivery engine owns retries. This sweep must
 *    never re-send on failure: two retry layers multiply, and the agent sees the
 *    same digest five times for one outage. If a push is genuinely lost, pull is
 *    the documented fallback (§3.2) and it is still authoritative.
 */

import { dispatchWebhookEvent } from '../routes/webhookRoutes.js';
import { getDigest } from './forumService.js';

export const DIGEST_EVENT = 'forum.digest';

/** A digest with nothing in any section must not be sent (rule 2). */
export function digestIsEmpty(digest) {
  const s = digest?.sections;
  if (!s) return true;
  return !(s.rising?.length || s.waiting?.length || s.shipped?.length);
}

/**
 * Claim the subscriptions that are due a push.
 *
 * `max_per_hour` is enforced as a SPACING rule — at most one push per
 * `1 hour / max_per_hour` — rather than as a counter over a rolling window.
 * A counter permits an agent to receive its whole hourly allowance in four
 * consecutive seconds and then nothing for an hour, which is the shape that
 * makes a subscriber turn the channel off. Spacing is also stateless: it is
 * derivable from `last_push_at` alone, so there is no second table to keep
 * consistent and nothing to reset when a predicate changes.
 *
 * Rows are locked, NOT stamped, here. Stamping in the select would be
 * at-most-once and would burn the window of every pure-pull subscriber (rule 3);
 * the row lock gives the same protection against a concurrent sweep, and is
 * released either way when the transaction ends.
 */
async function claimDue(client, limit) {
  const { rows } = await client.query(
    `SELECT s.user_id,
            s.last_push_at,
            COALESCE((s.predicate->>'max_per_hour')::int, 4) AS max_per_hour
       FROM forum_subscriptions s
      WHERE s.predicate IS NOT NULL
        AND (
          s.last_push_at IS NULL
          OR NOW() - s.last_push_at
             >= (INTERVAL '1 hour' / GREATEST(COALESCE((s.predicate->>'max_per_hour')::int, 4), 1))
        )
        AND EXISTS (
          SELECT 1 FROM webhooks w
           WHERE w.user_id = s.user_id AND w.is_active = true AND $2 = ANY(w.events)
        )
      ORDER BY s.last_push_at NULLS FIRST
      LIMIT $1
        FOR UPDATE OF s SKIP LOCKED`,
    [limit, DIGEST_EVENT],
  );
  return rows;
}

/**
 * One sweep. Returns a summary; never throws for a single subscriber's failure.
 */
export async function pushPendingDigests(db, { limit = 25 } = {}) {
  const client = await db.connect();
  let due = [];
  const result = { due: 0, pushed: 0, empty: 0, noEndpoint: 0, failed: 0 };

  try {
    await client.query('BEGIN');
    due = await claimDue(client, limit);
    result.due = due.length;

    for (const sub of due) {
      try {
        // `advanceCursor: false` — the pull channel's clock is not ours to move.
        const digest = await getDigest(client, sub.user_id, {
          since: sub.last_push_at ? new Date(sub.last_push_at).toISOString() : undefined,
          advanceCursor: false,
        });

        if (digestIsEmpty(digest)) {
          result.empty += 1;
          continue; // rule 2 — and the cursor stays put, so the window accumulates
        }

        // ⚠️ THE POOL, NOT `client`, AND THIS IS NOT A STYLE CHOICE.
        //
        // `dispatchWebhookEvent` inserts the delivery row and then fires the
        // actual HTTP request FIRE-AND-FORGET — `deliverWebhook(...).catch()`.
        // That continuation records the response code minutes later, long after
        // this transaction has committed and the client has been returned to the
        // pool. Handing it `client` means those writes land on a connection that
        // belongs to somebody else's query by then.
        //
        // It is also correct on its own terms: a delivery attempt is a fact that
        // happened, and it must not disappear because the sweep's bookkeeping
        // rolled back.
        const matched = await dispatchWebhookEvent(
          db,
          DIGEST_EVENT,
          { digest, deliveredAt: new Date().toISOString() },
          sub.user_id,
        );

        if (!matched) {
          // rule 3 — a predicate with no endpoint is a pure-pull subscriber.
          //
          // ⚠️ UNREACHABLE BY CONSTRUCTION, AND KEPT ANYWAY. `claimDue` already
          // requires an active webhook for this event, with the identical
          // filter the dispatcher uses, so `matched` is ≥1 on every ordinary
          // path. What is left is the race: the endpoint being deactivated
          // between the claim and the dispatch.
          //
          // Mutation-checking is how this was learned — replacing this
          // condition with `if (false)` changed NOTHING observable, because the
          // sweep that was supposed to exercise it never got past the claim
          // filter. So the proof's "no endpoint" case tests the CLAIM, not this
          // guard, and the honest statement is that this branch is defence
          // against a race and is not covered.
          result.noEndpoint += 1;
          continue;
        }

        await client.query(
          'UPDATE forum_subscriptions SET last_push_at = NOW() WHERE user_id = $1 AND predicate IS NOT NULL',
          [sub.user_id],
        );
        result.pushed += 1;
      } catch (err) {
        // One subscriber's bad predicate must not stop the sweep for everyone
        // else. Its cursor is untouched, so the next sweep retries it — that is
        // the sweep's own cadence, not a second retry layer (rule 4).
        result.failed += 1;
        console.error(`[ForumWebhookPush] ${sub.user_id}:`, err.message);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return result;
}

/**
 * Start the recurring sweep. Returns a stop function.
 *
 * Deliberately NOT on the Redis-backed JobQueue, for the same reason as the
 * notification-email sweep: this is a periodic scan of one indexed table, it has
 * to keep working when Redis is down, and coupling the Forum's outbound path to
 * a cache is a dependency you regret at 3am.
 *
 * ⚠️ No feature flag, unlike the email sweep — and the asymmetry is deliberate.
 * Mailing a person is an outward-facing act that needs somebody to throw a
 * switch. Delivering to a URL that a signed-in account explicitly registered,
 * for an event it explicitly subscribed to, is that account's own decision
 * already made. A flag here would gate a consent that was given twice.
 */
export function startWebhookPushSweep(db, { intervalMs = 300000, ...opts } = {}) {
  const timer = setInterval(() => {
    pushPendingDigests(db, opts)
      .then((r) => { if (r.pushed || r.failed) console.log('[ForumWebhookPush]', r); })
      .catch((err) => console.error('[ForumWebhookPush] sweep failed:', err.message));
  }, intervalMs);
  timer.unref?.();
  console.log(`[ForumWebhookPush] sweep every ${Math.round(intervalMs / 1000)}s`);
  return () => clearInterval(timer);
}
