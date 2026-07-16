/**
 * Account read-views — shared aggregators behind the account/dashboard/billing
 * read endpoints (accountRoutes, dashboardRoutes, billingRoutes). Pure reads over
 * the EXISTING hardened data: the v2 credit ledger (credit_accounts / credit_
 * transactions), the plan table (xeno_account_plans via billingService.getPlan),
 * and ReBAC workspace membership (relationship_tuples). No new money schema.
 *
 * Money amounts in the ledger are stored in MICRO credits; every value exposed
 * here is whole credits (floored) so the UI shows human numbers.
 */
import { getBalanceV2, MICRO_PER_CREDIT } from './creditLedgerV2.js';
import { getPlan, getCatalog } from '../services/billingService.js';

const whole = (m) => Math.floor(Number(m || 0) / MICRO_PER_CREDIT);

/** Credit view for a subject (whole credits + lifetimes + frozen). */
export async function creditsView(db, userId) {
  const acct = (await db.query(
    'SELECT balance, lifetime_earned, lifetime_spent, is_frozen FROM credit_accounts WHERE user_id = $1',
    [userId],
  )).rows[0] || {};
  // getBalanceV2 gives the authoritative available balance (and lazily seeds the
  // row from the legacy mirror if the account has none yet).
  let availableMicro = acct.balance ?? 0;
  try { const b = await getBalanceV2(db, userId); availableMicro = b.availableMicro ?? availableMicro; } catch { /* fall back to the row */ }
  return {
    balance: whole(availableMicro),
    lifetime_earned: whole(acct.lifetime_earned),
    lifetime_spent: whole(acct.lifetime_spent),
    // Subscriptions gate FEATURES, not monthly credits (locked monetization model),
    // so there is no monthly refresh; credits are one-time top-ups.
    monthly_allowance: 0,
    allowance_reset_date: null,
    is_frozen: !!acct.is_frozen,
  };
}

/** The user's active subscription as the frontend BillingOverview shape, or null. */
export async function subscriptionView(db, userId) {
  const plan = await getPlan(db, userId); // ensures the plan table exists
  if (!plan || plan.plan === 'free') return null;
  const item = getCatalog().find((i) => i.kind === 'subscription' && i.plan === plan.plan);
  let subId = plan.plan;
  try {
    const r = await db.query('SELECT stripe_subscription_id FROM xeno_account_plans WHERE user_id = $1', [String(userId)]);
    subId = r.rows[0]?.stripe_subscription_id || plan.plan;
  } catch { /* keep the plan name as a stable id */ }
  return {
    id: subId,
    plan_name: item?.label || plan.plan,
    status: plan.status,
    monthly_price: item?.price ?? 0,
    next_billing_date: plan.currentPeriodEnd || null,
  };
}

/** Count of ACTIVE workspaces the user is a member of (ReBAC tuples). */
export async function workspaceCount(db, userId) {
  const r = await db.query(
    `SELECT COUNT(DISTINCT w.id)::int AS n
       FROM workspaces w
       JOIN relationship_tuples rt
         ON rt.object_type = 'workspace' AND rt.object_id = w.id::text
        AND rt.subject_type = 'user' AND rt.subject_id = $1
      WHERE w.status = 'active'`,
    [userId],
  );
  return r.rows[0]?.n || 0;
}

export { whole as wholeCredits };
