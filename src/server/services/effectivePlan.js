/**
 * What a person is ENTITLED to, which is not the same as what they PAY for.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
 *
 * Per-seat Team is a WORKSPACE subscription: `setWorkspacePlan()` writes
 * `workspaces.metadata.billing`. Entitlement, meanwhile, was resolved purely from
 * `xeno_account_plans` keyed by user. Nothing mapped one to the other.
 *
 * So buying Team granted the buyer nothing personally. Before the download gate
 * that meant a Team customer quietly missed some platform features. After it, it
 * means they pay and are then refused the software — the worst possible outcome
 * of a successful payment, and it would have fired on the first Team sale.
 *
 * ── THE TWO SEPARATE QUESTIONS, KEPT SEPARATE ───────────────────────────────
 *
 *   getPlan(userId)          "what am I paying for"   → billing page, invoices,
 *                                                       dunning
 *   getEffectivePlan(userId) "what am I entitled to"  → every gate
 *
 * Collapsing them is tempting and wrong in both directions. If the billing page
 * read the effective plan it would tell an employee they are subscribed to Team
 * and offer to cancel a subscription that is not theirs. If a gate read the
 * personal plan it would refuse a licensed member — which is the bug above.
 *
 * ⚠️ Dunning in particular MUST stay personal: `invoice.payment_failed` marks
 * *your* subscription past_due, and resolving that against your employer's plan
 * would silently mark the wrong subscription.
 *
 * ── SEATS ARE ENFORCED AT JOIN, NOT AT USE ──────────────────────────────────
 *
 * 🔴 This is derived from the code, not chosen. `workspaceRoutes.js` refuses an
 * invite with 403 when `used >= limit` (active members + pending invites), so
 * membership is ALREADY seat-bounded at the only moment it can be bounded
 * fairly.
 *
 * Re-checking the cap here would be actively harmful: with no defined ordering
 * over members, an over-limit workspace would revoke an ARBITRARY person's
 * access, and which person could change between two requests. A licence that
 * flickers is worse than one that is occasionally over-granted, and the honest
 * remedy for an over-seated workspace is a billing conversation, not silently
 * locking someone out of software mid-task.
 *
 * Every serious per-seat product works this way: you cannot add beyond your
 * seats, and everyone who is a member is licensed.
 */
import { entitlementsFor, getPlan } from './billingService.js';

const ACTIVE = new Set(['active', 'trialing', 'past_due']);

/**
 * Plan strength. Used ONLY to pick which name to report when someone holds more
 * than one — it is not an entitlement decision, which stays with the table in
 * billingService.
 *
 * `internal` outranks everything because it is the staff plan; a staff member who
 * also sits in a Team workspace should not be reported as a Team subscriber.
 */
const RANK = { free: 0, pro: 1, team: 2, studio: 3, internal: 4 };
const rank = (p) => RANK[p] ?? 0;

/**
 * Workspace plans this user is licensed by.
 *
 * Membership is "holds ANY relation on the workspace", matching
 * `authzReBAC.check(..., 'member', ...)`. That equivalence is asserted by a gate
 * — the two must not drift, because a person who can open a workspace but is not
 * licensed by it (or the reverse) is a bug in whichever direction it points.
 *
 * One indexed query rather than N+1 ReBAC checks: this sits on the hot path of
 * every entitlement lookup in the platform.
 */
export async function workspacePlansFor(pool, userId) {
  try {
    const r = await pool.query(
      `SELECT DISTINCT w.id,
              w.metadata->'billing'->>'plan'   AS plan,
              w.metadata->'billing'->>'status' AS status
         FROM workspaces w
         JOIN relationship_tuples t
           ON t.object_type = 'workspace'
          AND t.object_id   = w.id::text
          AND t.subject_type = 'user'
          AND t.subject_id   = $1
        WHERE w.metadata->'billing'->>'plan' IS NOT NULL`,
      [String(userId)],
    );
    return r.rows
      .filter((x) => x.plan && x.plan !== 'free' && ACTIVE.has(x.status))
      .map((x) => ({ workspaceId: x.id, plan: x.plan, status: x.status }));
  } catch (e) {
    /* 🔴 Fails CLOSED — an empty list, never an assumed licence. A database fault
     * must not invent an entitlement, and the personal plan still resolves
     * normally, so a fault degrades a Team member to their own plan rather than
     * granting anyone something they never bought. */
    console.error('[EffectivePlan] workspace plan lookup failed:', e.message);
    return [];
  }
}

/**
 * The strongest plan this user is entitled to, from any source.
 *
 * Returns the same shape as `getPlan` plus `source` and `via`, so a caller can
 * explain the answer — "you have this because of the Acme workspace" is the
 * difference between a support ticket and a self-serve answer.
 */
export async function getEffectivePlan(pool, userId) {
  const personal = await getPlan(pool, userId);
  const workspaces = await workspacePlansFor(pool, userId);

  let best = { ...personal, source: 'personal', via: null };
  for (const w of workspaces) {
    if (rank(w.plan) > rank(best.plan)) {
      best = {
        plan: w.plan,
        status: w.status,
        /* Deliberately null. A workspace subscription's period end is the
         * WORKSPACE's renewal date and is not this person's to see or act on —
         * surfacing it invites "your plan expires on the 4th" for a date they
         * cannot change. */
        currentPeriodEnd: null,
        source: 'workspace',
        via: w.workspaceId,
      };
    }
  }
  return best;
}

/** Plan + entitlements, resolved from every source. The gate path. */
export async function getEffectiveEntitlements(pool, userId) {
  const p = await getEffectivePlan(pool, userId);
  return { ...p, entitlements: entitlementsFor(p.plan) };
}
