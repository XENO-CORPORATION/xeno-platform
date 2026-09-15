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
  WEEKLY_ALLOWANCE_CREDITS, allowanceCreditsFor, allowanceSourceRef, burstCapsFor,
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
export async function ensureQuota(pool, userId, plan, { isAgent = false, now = new Date() } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await issueAllowanceTx(client, userId, plan, { now });
    await syncBurstCapsTx(client, userId, plan, { isAgent });
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
 * Reconcile burst caps to the plan. A cap is a `spend_caps` row keyed on `user_id`, and an
 * AGENT HAS ITS OWN `users` ROW (`agent_identities.user_id` ≠ `owner_user_id`) — so an
 * agent takes a tighter cap by the same mechanism, with no new table and no special case
 * in the ledger. `assertWithinCaps` counts live HOLDS as well as settled debits, which is
 * what makes this hold when an agent fans out ten concurrent calls.
 */
export async function syncBurstCapsTx(client, userId, plan, { isAgent = false } = {}) {
  const caps = burstCapsFor(plan, { isAgent });
  for (const cap of caps) {
    await client.query(
      `INSERT INTO spend_caps (user_id, window_sec, limit_micro) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, window_sec) DO UPDATE SET limit_micro = EXCLUDED.limit_micro`,
      [userId, cap.windowSec, String(cap.limitMicro)],
    );
  }
  return caps;
}

export { WEEKLY_ALLOWANCE_CREDITS };
