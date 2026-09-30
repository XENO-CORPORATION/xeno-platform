// Account plan reads and entitlement policy; no payment-provider client is loaded.
import { ensureSchema } from './billingSchema.js';

// ── Plans & entitlements (v2) ────────────────────────────────────────────────
// Subscriptions gate FEATURES, not credits (see XENO-MONETIZATION-AND-ACCOUNT.md).
// v2 model: the free/paid boundary is ENFORCEABILITY, not cosmetics. Free = the
// standalone local Tool (clean output, NO watermark, full-res LOCAL export, BYOK +
// in-house xeno-rt fair-use). Paid (Pro/Team) = the connected server-backed Platform
// (cloud sync, cross-app, agents, collaboration, managed-premium priority, teams).
// Enforcement is 100% SERVER-SIDE. One entitlement source of truth, read by every
// product. inHouseDailyLimit null = unlimited. `maxResolution` now ONLY gates
// SERVER-SIDE managed generation (capDimensions in entitlementGate) — it is NOT a
// local-export gate.
// deprecated (v2): watermarking retired; always false — never gate on this.
/* ── `canUse` — the watch/use boundary ──────────────────────────────────────
 *
 * LOCKED 2026-08-16 by product decision: an account that has not paid may LOOK
 * at everything and RUN nothing. Browsing the workspace, reading docs, opening
 * the forum, watching a demo and reading the catalog all stay open; anything
 * that consumes compute, writes a project, or launches an app requires a plan.
 *
 * It is a FIRST-CLASS FLAG, not something inferred from `inHouseDailyLimit`.
 * A numeric quota answers "how much", and every call site that wants to know
 * "may they act at all" then has to re-derive the answer from it — which is
 * how one endpoint ends up reading `> 0`, another `!== null`, and a third
 * forgetting to check. One boolean has one meaning.
 *
 * ⚠️ BLAST RADIUS — this is a change to a SHIPPED entitlement contract, not a
 * new field nobody reads. Free accounts that could previously run 50 in-house
 * generations a day can now run none. That is the intended product change, and
 * it is one line to revert if it proves wrong.
 * ─────────────────────────────────────────────────────────────────────────── */
const PLAN_ENTITLEMENTS = {
  /* ── FREE — the local Tool, and it genuinely runs ────────────────────────
   * `canUse: true` with a real daily quota, NOT `canUse: false`.
   *
   * It was briefly false. Three reasons it is back, all from
   * `XENO PRICING - STANDARD & LEDGER.md`:
   *   1. In-house inference has near-zero marginal COGS, so withholding it
   *      saves electricity and costs us the only cheap activation device we
   *      have. Of 227 accounts, 4 ever generated an image and 0 ever uploaded
   *      a file - the problem was never free users consuming too much.
   *   2. It contradicted the public "BYOK everywhere, never locked to our
   *      inference" commitment: a user with their own paid provider key could
   *      not use XENO at all.
   *   3. It was unenforceable in the direction it claimed. The apps are
   *      downloadable installers; local editing never consults this table. A
   *      gate that cannot reach the case it advertises is worse than none.
   *
   * The quota is enforced for real by middleware/inHouseDailyLimit.js. The
   * paid boundary is the LAYER-2 flags below - cloudSync, crossApp, agents,
   * privateProjects, collaboration - which a local binary genuinely cannot
   * fake, plus `commercial`, which is a licence rather than a switch.
   *
   * ── canDownload: false — AN OWNER OVERRIDE OF THE LOCKED LAYER-1 RULE ─────
   *
   * `XENO PRICING - STANDARD & LEDGER.md` puts the apps in Layer 1 at EUR 0.
   * The account owner overrode that on 2026-08-24: an installer now requires a
   * signed-in account AND an active paid plan. The standard's Layer 2/3 lines
   * are untouched; this adds a distribution gate above them.
   *
   * It does NOT contradict `canUse: true` above, and the difference is the
   * whole design:
   *
   *   canUse       - can this account call OUR SERVERS. Says nothing about a
   *                  binary already on a laptop, and cannot: local editing
   *                  never reaches this table.
   *   canDownload  - may we HAND OVER the bytes. That one we do control,
   *                  because every installer comes from our CDN.
   *
   * So a free account keeps the fair-use API it always had, and an app it
   * already installed keeps working. What it cannot do is obtain a new one.
   *
   * ⚠️ This flag is only as true as its weakest door. A public R2 object is
   * still a download, so gating the website alone would be theatre - see
   * routes/productDownloadRoutes.js and the grant work behind it. Do not
   * describe downloads as "closed" on the strength of this line alone. */
  free:   { plan: 'free',   canUse: true,  canDownload: false, commercial: false, maxResolution: 'standard', priority: false, inHouseDailyLimit: 50,   privateProjects: false, teamSeats: 0,  cloudSync: false, crossApp: false, agents: false, collaboration: false, watermark: false },

  /* Everything. `crossApp` is the Layer-3 differentiator and the reason this
   * tier exists - an agent that spans 26 applications is the one capability
   * neither an app vendor nor a model vendor can assemble. */
  pro:    { plan: 'pro',    canUse: true,  canDownload: true,  commercial: true,  maxResolution: '4k',       priority: true,  inHouseDailyLimit: null, privateProjects: true,  teamSeats: 0,  cloudSync: true,  crossApp: true,  agents: true,  collaboration: false, watermark: false },
  /* Team seats are purchased as Stripe quantity; the live limit is stored on
   * the workspace, so the static entitlement must not invent an included five. */
  team:   { plan: 'team',   canUse: true,  canDownload: true,  commercial: true,  maxResolution: '4k',       priority: true,  inHouseDailyLimit: null, privateProjects: true,  teamSeats: 0,  cloudSync: true,  crossApp: true,  agents: true,  collaboration: true,  watermark: false },
  studio: { plan: 'studio', canUse: true,  canDownload: true,  commercial: true,  maxResolution: '4k',       priority: true,  inHouseDailyLimit: null, privateProjects: true,  teamSeats: 25, cloudSync: true,  crossApp: true,  agents: true,  collaboration: true,  watermark: false },

  // Staff / internal-service accounts (prod has real users with plan='internal').
  // NOT sellable - never in the CATALOG. All platform features enabled so internal
  // tooling and service accounts are never gated as free-tier. teamSeats 0: an
  // internal account is not itself a team container.
  internal: { plan: 'internal', canUse: true, canDownload: true,  commercial: true, maxResolution: '4k', priority: true, inHouseDailyLimit: null, privateProjects: true, teamSeats: 0, cloudSync: true, crossApp: true, agents: true, collaboration: true, watermark: false },
};

/* 🔴 NOT HERE YET: the EUR 9 single-app and EUR 19 single-suite rungs.
 *
 * They are locked in the pricing ladder and they are NOT implementable today,
 * because nothing tells this API which application a request came from -
 * `api_usage_logs.surface` carries one value for 99.95% of rows. Without app
 * identity, `app` and `suite` would resolve to byte-identical entitlements and
 * we would be charging EUR 19 for exactly what EUR 9 buys.
 *
 * Shipping them anyway is the failure this codebase keeps recording: a thing
 * that is built, priced and advertised while nothing connects it. The exit
 * condition is app identity on the request, then a scope on the plan row.
 * Until then the ladder ships as Free / Everything / Team / Studio. */
/* Legacy/stray plan names seen in prod that must NOT silently fall back to free.
 *
 * ultra → pro is RATIFIED (2026-08-22, by the account owner). It is exactly one
 * live row and it is the operator's own account, so this grants nobody anything
 * they were not already using — which is the only reason keeping it is cheap.
 *
 * ⚠️ An alias is a decision that outlives whoever made it, so the direction
 * matters: the fallback below is `free`, meaning a plan name nobody recognises
 * gets the FREE tier and a typo cannot mint a paid account. An alias is the
 * deliberate exception to that, one name at a time. Do not turn this into a
 * permissive prefix/regex match — the value of the map is that every entry was
 * looked at. */
export const PLAN_ALIASES = { ultra: 'pro' };

/**
 * Resolve a stored plan name to its canonical form. Exported because EVERY consumer of a
 * plan name must resolve the same way, and a second copy of this map is how two of them
 * come to disagree — which is exactly what happened: `quotaEngine` keyed its allowance
 * table on the raw `xeno_account_plans.plan` value, so the one live `ultra` row (the
 * operator's own account, running the agents) resolved to no entry, fell back to `free`,
 * and would have been capped at 50 credits a week against a ~460-credit Opus call.
 *
 * 🔴 Note what the fallback does NOT do: it does not resolve unknown names to anything
 * generous. An unrecognised plan stays unrecognised here and the CALLER decides — every
 * caller's fallback is `free`, so a typo cannot mint a paid account. The alias map is the
 * deliberate exception, one looked-at name at a time; never make it a prefix or regex.
 */
export function canonicalPlan(plan) {
  return PLAN_ALIASES[plan] || plan;
}

/** Feature entitlements for a plan (aliases resolved; defaults to free). */
export function entitlementsFor(plan) {
  const resolved = canonicalPlan(plan);
  return PLAN_ENTITLEMENTS[resolved] || PLAN_ENTITLEMENTS.free;
}

// Stripe subscription statuses that still grant the plan (past_due = grace period).
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

/** The user's effective plan (active sub → its plan; otherwise free). */
export async function getPlan(pool, userId) {
  if (!pool.previewReadOnly) await ensureSchema(pool);
  const r = await pool.query(
    'SELECT plan, status, current_period_end FROM xeno_account_plans WHERE user_id = $1',
    [String(userId)],
  );
  const row = r.rows[0];
  if (row && ACTIVE_STATUSES.has(row.status)) {
    return { plan: row.plan, status: row.status, currentPeriodEnd: row.current_period_end };
  }
  return { plan: 'free', status: row?.status || 'none', currentPeriodEnd: row?.current_period_end || null };
}

/** Plan + full feature entitlements for a user — the entitlement API every product reads. */
export async function getEntitlements(pool, userId) {
  const p = await getPlan(pool, userId);
  return { ...p, entitlements: entitlementsFor(p.plan) };
}
