/**
 * quotaEngine — the weekly allowance a plan carries, and the burst guard beneath it.
 *
 * 🔒 `XENO PRICING - STANDARD & LEDGER.md` §8b. Two ideas, deliberately not one:
 *
 *   QUOTA   the product. A pool of credits refilled every 7 days. The subscriber sees
 *           "62% used · resets Monday 14:20" — never tokens, never a credit number (§8
 *           forbids exposing a token/compute mapping). When it empties there is a DOOR:
 *           buy top-up credits at the plan's own rate. Anthropic's weekly cap has no
 *           door; a user willing to pay is simply refused.
 *
 *   BURST   a safety rail, not a second quota. It exists because WE RUN AGENTS: a human
 *           cannot drain a week in an hour, and a runaway agent loop can do it in
 *           minutes, by accident. It is never shown as a balance — only when it trips,
 *           as "slow down, retry at HH:MM". Lovable's five overlapping expiry rules are
 *           what happens when every limit is surfaced as its own meter.
 *
 * Underneath, both are the ONE ledger in micro-credits. The allowance is a grant lot
 * (`credit_grants`, kind 'allowance', priority 5) that expires at the window boundary;
 * purchased credits are paid lots that never expire. `drawdownGrants` already orders by
 * priority then expiry, so the allowance is spent first and what a user bought is what
 * survives the reset — never the other way round.
 *
 * Why we cannot simply copy Anthropic's numbers: they own the GPUs, so their quota is a
 * CAPACITY decision with near-zero marginal cost. We rent every token, so ours is a
 * MARGIN decision. When `xeno-rt` serves our own weights the pool can grow a lot at the
 * same margin — the mechanism here does not change, only WEEKLY_ALLOWANCE_CREDITS does.
 */

import { addGrantTx, MICRO_PER_CREDIT } from './creditLedgerV2.js';
import { canonicalPlan } from '../services/billingService.js';

/** Plan → credits granted per 7-day window. `null` = no metered allowance (unlimited). */
export const WEEKLY_ALLOWANCE_CREDITS = {
  free: 50,
  pro: 2000,
  team: 3000,
  studio: 8000,
  internal: null,
};

/**
 * The allowance a plan carries — and the one place an UNKNOWN plan is decided.
 *
 * 🔴 It resolves to `free`, never to unmetered. Reading the table directly is fail-OPEN:
 * a typo, a plan added to `effectivePlan`'s RANK and not here, or a null `plan` column all
 * produce `undefined`, and `undefined == null` is TRUE — so the account would be treated
 * exactly like `internal`: no allowance to protect, therefore no burst cap, therefore an
 * unbounded wallet with no guard on it. The safe direction for an unrecognised plan is the
 * smallest allowance we offer, and `internal` stays unmetered because it is WRITTEN as null.
 */
export function allowanceCreditsFor(plan) {
  // Resolve legacy/aliased names FIRST, from billingService's one map. The allowance table
  // is keyed on canonical plans, and `xeno_account_plans.plan` stores the raw value.
  const resolved = canonicalPlan(plan);
  if (Object.prototype.hasOwnProperty.call(WEEKLY_ALLOWANCE_CREDITS, resolved)) {
    return WEEKLY_ALLOWANCE_CREDITS[resolved];
  }
  console.warn('[quota] unknown plan, falling back to free allowance', JSON.stringify({ plan }));
  return WEEKLY_ALLOWANCE_CREDITS.free;
}

/**
 * 🔴 NO AUTOMATIC BURST GUARD. Deliberately empty, and the reasoning is worth keeping.
 *
 * This held `{ windowSec: 5h, fraction: 0.25 }` — a cap derived from the weekly allowance
 * and written to `spend_caps` on every admission. It never reached production because the
 * gateway session measured real accounts first. Three independent faults:
 *
 * 1. 🔒 §8b **D7** is locked: *"Spend caps stay USER-SET."* The write used
 *    `ON CONFLICT DO UPDATE`, so it silently overwrote a limit the user had set on their
 *    own money, on every call.
 * 2. `assertWithinCaps` counts EVERY debit in the window, not allowance spend. A cap sized
 *    off the allowance therefore throttled PURCHASED credits — inverting D3, whose whole
 *    point is that the door out of an exhausted quota is to buy more.
 * 3. Wrong in KIND, not size: the live admin account spends 218,378 credits per 5 hours
 *    against a 2,000-credit weekly pool. No fraction of an allowance describes an account
 *    that does not live on its allowance.
 *
 * The runaway-agent risk that motivated it is real, and it is NOT solved by a guessed
 * constant. It needs a budget the owner sets per agent — a deliberate instruction, not a
 * default. Until that ships, the allowance itself is the bound on what a subscriber
 * consumes for free, and paid spend is not throttled at all.
 *
 * ⚠️ Keep this array EMPTY rather than deleting the export: `burstCapsFor` still answers,
 * and a gate asserts nothing writes `spend_caps` automatically. Re-adding a window here
 * re-introduces all three faults.
 */
export const BURST_WINDOWS = [];

export const ALLOWANCE_GRANT_KIND = 'allowance';
export const ALLOWANCE_PRIORITY = 5; // below free(10)/promo(50)/paid(100): drains FIRST
export const WINDOW_SEC = 7 * 24 * 60 * 60;

/**
 * The 7-day window a moment falls in, anchored to a fixed epoch so every account's
 * window boundary is derivable — never stored, never drifting, and identical after a
 * restart. Monday 2026-01-05 00:00 UTC.
 */
const EPOCH_MS = Date.UTC(2026, 0, 5);

export function windowFor(now = new Date()) {
  const ms = now instanceof Date ? now.getTime() : Number(now);
  const index = Math.floor((ms - EPOCH_MS) / (WINDOW_SEC * 1000));
  const startsAt = new Date(EPOCH_MS + index * WINDOW_SEC * 1000);
  const endsAt = new Date(EPOCH_MS + (index + 1) * WINDOW_SEC * 1000);
  return { index, startsAt, endsAt };
}

/**
 * The source_ref that makes a refill idempotent: one grant per (user, plan, window).
 *
 * 🔴 The plan is CANONICALISED into the ref. It is the identity of the grant, so an alias
 * must not produce a second one: issued under 'ultra' and read back under 'pro' is a MISS,
 * which reads as 0% used and re-issues a whole second allowance for the same week. Storing
 * the canonical name means renaming a plan row mid-window changes nothing.
 */
export function allowanceSourceRef(userId, plan, windowIndex) {
  return `allowance:${canonicalPlan(plan)}:w${windowIndex}:${userId}`;
}

/**
 * The burst caps a plan implies — currently NONE, because `BURST_WINDOWS` is empty by
 * decision (see above). Kept as the one place that would compute them, so re-introducing
 * a guard is a considered edit in a single file rather than a new mechanism somewhere else.
 */
export function burstCapsFor(plan) {
  const credits = allowanceCreditsFor(plan);
  if (credits == null) return []; // unmetered plan: no allowance to protect
  return BURST_WINDOWS.map(({ windowSec, fraction }) => ({
    windowSec,
    limitMicro: Math.round(credits * MICRO_PER_CREDIT * fraction),
  }));
}

/**
 * Issue this window's allowance, inside the caller's transaction. Idempotent: the
 * `source_ref` names the window, so a double-run, a retry, or two schedulers racing
 * produce ONE grant. Returns what happened, so a caller can report rather than guess.
 *
 * 🔴 It does NOT top up a partially-spent allowance. The allowance IS the window: if a
 * user spent 80% by Wednesday, they have 20% until the reset. Refilling to full mid-window
 * would make "resets Monday" a lie and hand an unbounded budget to anything that loops.
 */
export async function issueAllowanceTx(client, userId, plan, { now = new Date() } = {}) {
  const credits = allowanceCreditsFor(plan);
  if (credits == null) return { issued: false, reason: 'unmetered' };

  const { index, endsAt } = windowFor(now);
  const sourceRef = allowanceSourceRef(userId, plan, index);

  const existing = await client.query(
    'SELECT 1 FROM credit_grants WHERE user_id = $1 AND source_ref = $2',
    [userId, sourceRef],
  );
  if (existing.rows.length > 0) return { issued: false, reason: 'already-issued', windowIndex: index };

  // 🔴 The SELECT above is an optimisation, NOT the idempotency. Ten concurrent first
  // calls at the top of a window all read "no grant" before any of them writes, so the
  // guarantee has to come from `uq_grants_allowance_window` — a partial unique index on
  // (user_id, source_ref). The loser of that race gets 23505 and must report
  // already-issued, exactly as if it had lost by a millisecond on the read: one grant
  // exists, which is the whole contract. Anything else fails an admission check for a
  // user who is entitled to their allowance.
  try {
    await addGrantTx(client, userId, {
      amountMicro: credits * MICRO_PER_CREDIT,
      kind: ALLOWANCE_GRANT_KIND,
      priority: ALLOWANCE_PRIORITY,
      expiresAt: endsAt,
      sourceRef,
    });
  } catch (error) {
    if (error?.code === '23505') return { issued: false, reason: 'already-issued', windowIndex: index };
    throw error;
  }
  return { issued: true, credits, windowIndex: index, expiresAt: endsAt };
}

/**
 * The quota AS THE SUBSCRIBER SEES IT: a percentage and a reset time.
 *
 * 🔴 `creditsRemaining`/`creditsTotal` are returned for SERVER-SIDE callers (the account
 * page's own top-up decision, tests, support) and must not be rendered to a subscriber —
 * §8 keeps the token/compute mapping internal. The route that serves this to a browser
 * strips them; see `ledgerRoutes` /quota.
 */
export function quotaView({ allowanceMicro, remainingMicro, plan, now = new Date() }) {
  const { endsAt } = windowFor(now);
  if (allowanceMicro == null) {
    return { metered: false, plan, resetsAt: endsAt.toISOString(), usedPercent: 0, exhausted: false };
  }
  const total = Math.max(0, Number(allowanceMicro));
  const remaining = Math.min(Math.max(0, Number(remainingMicro)), total);
  const used = total - remaining;
  return {
    metered: true,
    plan,
    usedPercent: total === 0 ? 100 : Math.min(100, Math.round((used / total) * 100)),
    resetsAt: endsAt.toISOString(),
    exhausted: remaining === 0,
    creditsRemaining: remaining / MICRO_PER_CREDIT,
    creditsTotal: total / MICRO_PER_CREDIT,
  };
}
