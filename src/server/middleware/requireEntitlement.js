/**
 * requireEntitlement — SERVER-SIDE enforcement of the boolean plan levers.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `XENO MONETIZATION - STRATEGY.md` §4 states the free/paid boundary in one line:
 *
 *   "The free/paid boundary is ENFORCEABILITY, not cosmetics. Free is the
 *    standalone local Tool. Paid is the connected server-backed Platform:
 *    cloud sync + multi-device, cross-app workflows, agents, real-time
 *    collaboration, private cloud projects … so the gate is a SERVER-SIDE
 *    entitlement check, not a cosmetic lever."
 *
 * Two of those levers were already real: `maxResolution` (utils/entitlementGate.js,
 * wired into image + video generation in routes/xenoRoutes.js) and
 * `inHouseDailyLimit` (middleware/inHouseDailyLimit.js, wired into aiRoutes).
 *
 * The other FIVE — cloudSync, crossApp, agents, collaboration, privateProjects —
 * existed only in the client TypeScript types, the BillingPage feature list and the
 * UpgradePrompt copy. A repo-wide search for a server-side read of any of them
 * returned nothing. They were advertised on the pricing page, rendered in the UI,
 * and enforced nowhere: any client that simply called the endpoint got the paid
 * feature. This module is the enforcement point, and it is the same shape as the
 * two levers that already worked.
 *
 * ── FAIL CLOSED, DELIBERATELY ───────────────────────────────────────────────
 *
 * This differs from inHouseDailyLimit, which fails OPEN on purpose (a broken
 * counter must never block inference — a fair-use limit is not worth an outage).
 * A capability gate is the opposite trade: failing open hands the paid product to
 * everyone for the duration of the fault, and nobody notices, because the failure
 * mode is silent success.
 *
 * We inherit that choice rather than inventing it — `resolveEntitlements` already
 * returns the FREE tier on any error ("fails CLOSED to free"), so an infrastructure
 * fault degrades to the free plan everywhere in this codebase, consistently.
 *
 * ⚠️ The known cost: during a database fault, paying users are treated as free and
 * denied their own features. That is the accepted trade for a revenue gate, but it
 * means an entitlement outage looks like a billing bug to the customer. Log loudly.
 *
 * ── THE RESPONSE IS DESIGNED FOR THE UI THAT ALREADY EXISTS ─────────────────
 *
 * `components/common/UpgradePrompt.tsx` already accepts a `context` prop of exactly
 * 'cloudSync' | 'crossApp' | 'agents' | 'collaboration' | 'resolution' | 'credits' |
 * 'commercial' | 'general'. The 403 body carries that token, so the client can
 * render the correct upgrade prompt straight from the refusal without a lookup
 * table of its own.
 */
import { entitlementsFor } from '../services/billingService.js';
import { resolveEntitlements } from '../utils/entitlementGate.js';

/**
 * Plans in ascending order of capability. Used to answer "what is the CHEAPEST plan
 * that would grant this?" so the refusal can name a concrete upgrade rather than a
 * generic "upgrade required". `internal` is deliberately absent — it is a staff
 * plan, never something to sell a customer.
 */
/* SELLABLE plans only, cheapest first.
 *
 * 🔴 `free` was on this list and had to come off. It was harmless only while
 * free granted nothing: the loop returns the first plan that GRANTS the
 * capability, so a free tier that grants nothing is never returned. The moment
 * free gained a real in-house allowance (`canUse: true`), every refusal began
 * naming it - telling a user to "upgrade to free", which is both nonsense and
 * an upgrade prompt that cannot be acted on.
 *
 * The rule is the one already written here for `internal`: a plan belongs on
 * this ladder only if it is something we can sell a customer. Free is not, for
 * exactly the same reason a staff plan is not. */
const UPGRADE_LADDER = ['pro', 'team', 'studio'];

/**
 * Capabilities this gate understands, mapped to the UpgradePrompt context token.
 * A capability MUST be listed here to be gateable — an unknown capability name is a
 * programming error and throws at wiring time rather than silently allowing the
 * request, which is how a typo would otherwise become an open door.
 */
const CAPABILITY_CONTEXT = {
  /* The blanket watch/use boundary (product decision, 2026-08-16): an unpaid
   * account may look at everything and run nothing. Distinct from the specific
   * levers below — those refuse ONE paid feature to someone already using the
   * product; this one refuses the product. It maps to the 'general' prompt
   * because there is no single feature to name: the answer is "get a plan". */
  canUse: 'general',

  /* Handing over an installer (owner override, 2026-08-24). Mapped to
   * 'general' rather than a new token because the honest answer to a refused
   * download IS "get a plan" — there is no single feature to name, and a
   * context the UpgradePrompt union does not carry would render nothing. */
  canDownload: 'general',
  cloudSync: 'cloudSync',
  crossApp: 'crossApp',
  agents: 'agents',
  collaboration: 'collaboration',
  privateProjects: 'general',
  commercial: 'commercial',
};

/** The cheapest plan on the ladder whose entitlements grant `capability`. */
export function cheapestPlanWith(capability) {
  for (const plan of UPGRADE_LADDER) {
    if (entitlementsFor(plan)?.[capability]) return plan;
  }
  return null; // nothing on the sellable ladder grants it
}

/** Does this resolved entitlement set grant the capability? */
export function grants(ent, capability) {
  return Boolean(ent?.[capability]);
}

/** The 403 payload for a refused capability (shared by middleware + in-route use). */
export function upgradeRequiredBody(capability, ent) {
  const requiredPlan = cheapestPlanWith(capability);
  return {
    error: 'plan_upgrade_required',
    message: requiredPlan
      ? `This is a ${requiredPlan === 'pro' ? 'Pro' : 'Team'} feature. Your plan (${ent?.plan || 'free'}) does not include it.`
      : 'This feature is not available on your plan.',
    capability,
    // Drives components/common/UpgradePrompt.tsx directly — see header note.
    context: CAPABILITY_CONTEXT[capability] || 'general',
    currentPlan: ent?.plan || 'free',
    requiredPlan,
  };
}

/**
 * Assert a capability for one request. Returns { allowed: true, ent } or
 * { allowed: false, ent, body }. Use this inside a route when the check must happen
 * at a precise point (after validation, before side effects) rather than at mount.
 */
export async function assertEntitlement(db, userId, capability) {
  if (!(capability in CAPABILITY_CONTEXT)) {
    throw new Error(`requireEntitlement: unknown capability '${capability}'`);
  }
  const ent = await resolveEntitlements(db, userId); // fails CLOSED to free
  if (grants(ent, capability)) return { allowed: true, ent };
  return { allowed: false, ent, body: upgradeRequiredBody(capability, ent) };
}

/**
 * Express middleware form. Mount behind auth + db.
 *
 * Unauthenticated requests are passed through UNTOUCHED so this never becomes a
 * second, weaker auth check: `requireAuth` owns 401 and must run first. A route
 * mounting this without auth in front of it is a wiring bug, not something this
 * module papers over — a silent 403-for-everyone would look like a working gate.
 */
export function requireEntitlement(capability) {
  if (!(capability in CAPABILITY_CONTEXT)) {
    // Throw at WIRING time (module load), not per-request: a typo'd capability
    // must break the boot, never quietly allow traffic.
    throw new Error(`requireEntitlement: unknown capability '${capability}'`);
  }
  return async (req, res, next) => {
    const userId = req.user?.id;
    if (!userId || !req.db) return next(); // auth/db middleware own those failures
    try {
      const verdict = await assertEntitlement(req.db, userId, capability);
      if (!verdict.allowed) return res.status(403).json(verdict.body);
      req.entitlements = verdict.ent; // downstream handlers can reuse the resolution
      return next();
    } catch (e) {
      // resolveEntitlements does not throw, so reaching here means something
      // unexpected. Refuse — see the fail-closed note in the header — and say so.
      console.error(`[entitlement] gate failure (failing CLOSED): capability=${capability} user=${userId} error=${String(e?.message || e)}`);
      return res.status(403).json(upgradeRequiredBody(capability, null));
    }
  };
}

export default requireEntitlement;
