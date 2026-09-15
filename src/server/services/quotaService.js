/**
 * quotaService — issues the weekly allowance and keeps the burst guards in sync.
 *
 * 🔒 `XENO PRICING - STANDARD & LEDGER.md` §8b. The mechanics live in
 * `utils/quotaEngine.js` (pure, testable); this is the part that touches the database.
 *
 * 🔴 REFILL IS LAZY, NOT A CRON — and that is the design, not a shortcut.
 * A scheduled sweep over every account has three failure modes we have already paid for
 * elsewhere: it silently stops (the Forum's `inbox.scan` deadlocked for 48 days and kept
 * logging success), it must be re-run by hand after an outage, and it grants to accounts
 * that will never call us — 4 of 227 accounts have ever generated anything. Issuing on
 * FIRST USE of a window means the allowance exists exactly when it is needed, a missed
 * window is impossible, and an idle account costs one row that is never written.
 *
 * Idempotency is what makes that safe: the grant's `source_ref` names the window, so ten
 * concurrent requests at the top of the hour produce ONE grant.
 */

import {
  WEEKLY_ALLOWANCE_CREDITS, allowanceCreditsFor, allowanceSourceRef,
  issueAllowanceTx, quotaView, windowFor,
} from '../utils/quotaEngine.js';
import { allowanceSnapshot } from '../utils/creditLedgerV2.js';

/**
 * Ensure the caller's allowance for the CURRENT window exists, and that their burst caps
 * match their plan. Call before admission on any metered path; it is cheap (one indexed
 * lookup) on the common path where the grant already exists.
 *
 * Returns the quota view, so a caller that wants to show it does not query twice.
 */
export async function ensureQuota(pool, userId, plan, { now = new Date() } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await issueAllowanceTx(client, userId, plan, { now });
    await client.query('COMMIT');
    if (result.issued) {
      console.log('[quota] allowance issued', JSON.stringify({
        user_id: userId, plan, window: result.windowIndex, credits: result.credits,
      }));
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return readQuota(pool, userId, plan, { now });
}

/**
 * Read the quota without issuing anything — for a page that displays it. An account that
 * has not used the window yet correctly reads 0% against its full allowance, because
 * `quotaView` falls back to the plan's size when no lot exists.
 */
export async function readQuota(pool, userId, plan, { now = new Date() } = {}) {
  const credits = allowanceCreditsFor(plan);
  if (credits == null) return quotaView({ allowanceMicro: null, remainingMicro: 0, plan, now });

  const { index } = windowFor(now);
  const snap = await allowanceSnapshot(pool, userId, allowanceSourceRef(userId, plan, index));
  const granted = snap.allowanceMicro || credits * 1_000_000;
  const remaining = snap.allowanceMicro ? snap.allowanceRemainingMicro : granted;
  return {
    ...quotaView({ allowanceMicro: granted, remainingMicro: remaining, plan, now }),
    purchasedCredits: snap.purchasedRemainingMicro / 1_000_000,
  };
}

/**
 * 🔴 REMOVED, DELIBERATELY: nothing writes `spend_caps` automatically any more.
 *
 * An earlier version of this file wrote a burst cap on every admission, sized as a
 * fraction of the weekly allowance. Three things were wrong with it, and the gateway
 * session caught them by measuring real accounts before the deploy:
 *
 * 1. 🔒 It violates §8b **D7**, which is locked: *"Spend caps stay USER-SET."* A cap is
 *    the user's own instruction about their own money. Writing one for them — with
 *    `ON CONFLICT DO UPDATE` — silently overwrote a limit they had set through
 *    `POST /api/v2/ledger/spend-caps`, on every single call. A control that edits the
 *    user's own setting is not a safety rail.
 * 2. `assertWithinCaps` counts EVERY debit in the window, not allowance spend, so a cap
 *    derived from the allowance throttled purchased credits too. That inverts the §8b D3
 *    promise: the door out of an exhausted quota is to buy credits, and this refused the
 *    people who had.
 * 3. The size was not merely wrong, it was wrong in KIND. Measured on the live admin
 *    account: 218,378 credits in five hours against a 2,000-credit weekly pool — 109x the
 *    entire allowance per window. An account spending that way does not live on its
 *    allowance at all, so no fraction of the allowance can describe it.
 *
 * The runaway-agent risk is real and is NOT addressed by a guessed number. It belongs to
 * a budget the owner sets (per-agent, deliberately), plus the plan allowance itself, which
 * already bounds what a subscriber consumes for free. Until that exists, this stays absent
 * rather than shipping a throttle nobody asked for: an unasked-for limit that refuses paid
 * traffic is worse than no limit, because the failure is invisible until a customer is
 * turned away.
 */

export { WEEKLY_ALLOWANCE_CREDITS };
