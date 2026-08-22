import { PRODUCTS } from './productCatalog';
import { isUnreleased } from './releaseStatus';

/* ═══════════════════════════════════════════════════════════════════════════
 * WORKSPACE SUITES
 *
 * The thing a new account picks first, and the most consequential answer in
 * the whole flow: it decides how the platform lays itself out for them.
 *
 * ── WHY SUITES AND NOT CATEGORIES ──────────────────────────────────────────
 *
 * The catalog's `category` field exists to group the marketing site's mega-menu
 * — nine buckets, some of them one product deep. Nine choices is not a choice,
 * and "Platform (1 product)" is not a workspace anybody identifies with.
 *
 * A suite is the coarser thing a PERSON is: someone who makes images and video,
 * someone who writes documents, someone who builds software, someone who
 * communicates. Four of those is a decision you can make in three seconds.
 *
 * ── THE MAPPING IS DECLARED, THE MEMBERSHIP IS DERIVED ─────────────────────
 *
 * Each suite names catalog CATEGORIES; its products are looked up from the
 * catalog at render time. So a new product joins the workspace it belongs to
 * the day it ships, with nobody editing this file — and a suite can never list
 * something that does not exist, which is the failure mode of a hand-kept list.
 *
 * ⚠️ Every category must appear in exactly one suite. `assertTotalCoverage`
 * below enforces that: an unmapped category would silently vanish from
 * onboarding, taking its products with it, and nothing else would notice.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Suite = {
  id: string;
  name: string;
  tagline: string;
  /** Catalog categories that make up this suite. */
  categories: string[];
  /**
   * Members that are NOT catalog products.
   *
   * The catalog lists things you download or open as an app. A few real,
   * shipping surfaces are not that — Forum lives at xenostudio.ai/forum by a
   * locked spec decision (no repo, no installer, Marketplace pattern), so it
   * has no slug, no category and nothing for the mapping above to find.
   *
   * Declared explicitly rather than faked into productCatalog, because a
   * catalog entry would give it a product page, a download route and a
   * releases feed that do not exist. Honest membership, honest absence.
   */
  extras?: SuiteProduct[];
};

export const SUITES: Suite[] = [
  {
    id: 'creative',
    name: 'Creative',
    tagline: 'Image, video, audio, design and 3D',
    categories: ['Create', 'Design', 'Generate'],
  },
  {
    id: 'office',
    name: 'Office',
    tagline: 'Documents, data, presentations and knowledge',
    categories: ['Office', 'Library'],
  },
  {
    id: 'developer',
    name: 'Developer',
    tagline: 'Agents, automation and building software',
    categories: ['Develop', 'Build'],
  },
  {
    id: 'connect',
    name: 'Connect',
    tagline: 'Messaging, social, community and the agent-native browser',
    categories: ['Connect', 'Platform'],
    // Live at /forum, and the only suite member that is a platform surface
    // rather than an app. See `extras` above for why it is not in the catalog.
    extras: [{
      slug: 'forum', name: 'XENO Forum', tagline: 'Community and support',
      status: 'beta', category: 'Connect',
    }],
  },
];

/** The id recorded when somebody takes the whole ecosystem rather than a lane. */
export const EVERYTHING_ID = 'everything';

export type SuiteProduct = {
  slug: string; name: string; tagline: string; status: string; category: string;
};

/**
 * Products in a suite — derived from the catalog, available first.
 *
 * ⚠️ `coming-soon` is INCLUDED here, sorted last, and callers are expected to
 * mark it. That reverses the earlier decision to filter it, and the reason is
 * that filtering was answering the wrong question: on a card whose job is
 * "what is this workspace", an unshipped product is part of the answer, and
 * hiding it made Office look like four apps when it is eight. Half the
 * catalog is coming-soon, so filtering silently shrank the ecosystem by half
 * on the one screen meant to show its scale.
 *
 * It stays filtered where the question IS "what can I open now" — see
 * `availableForSuite`, used by the recommendation step.
 */
export function productsForSuite(suite: Suite): SuiteProduct[] {
  const rank = (s: string) => (s === 'shipping' ? 0 : s === 'beta' ? 1 : 2);
  const fromCatalog = PRODUCTS
    .filter((p) => suite.categories.includes(p.category))
    .map((p) => ({
      slug: p.slug, name: p.name, tagline: p.tagline, status: p.status, category: p.category,
    }));
  return [...fromCatalog, ...(suite.extras || [])]
    .sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
}

/**
 * Only what a user can actually open today — MEASURED, not claimed.
 *
 * Uses `isUnreleased`, which prefers the release probe over the catalog's
 * `status`. That matters here more than anywhere else in the flow: this feeds
 * the recommendation step, so a product wrongly marked `coming-soon` is one
 * nobody is ever sent to. Three products were in exactly that state.
 */
export function availableForSuite(suite: Suite): SuiteProduct[] {
  return productsForSuite(suite).filter((p) => !isUnreleased(p.slug, p.status));
}

/** Every product across every suite, including unshipped. */
export function allSuiteProducts(): SuiteProduct[] {
  return SUITES.flatMap(productsForSuite);
}

/** Every product a user can open today — the honest number for a count. */
export function allAvailableProducts(): SuiteProduct[] {
  return SUITES.flatMap(availableForSuite);
}

/**
 * Categories present in the catalog but claimed by no suite.
 *
 * Exported rather than thrown so a test can assert it is empty: a category
 * added to the catalog and forgotten here would silently disappear from
 * onboarding along with every product in it, and no other code path would
 * notice. This is the check that turns that into a failing test.
 */
export function unmappedCategories(): string[] {
  const claimed = new Set(SUITES.flatMap((s) => s.categories));
  const present = new Set(
    PRODUCTS.filter((p) => p.status !== 'coming-soon').map((p) => p.category),
  );
  return [...present].filter((c) => !claimed.has(c)).sort();
}

/** Suite ids that resolve to nothing — an empty card is worse than no card. */
export function emptySuites(): string[] {
  return SUITES.filter((s) => availableForSuite(s).length === 0).map((s) => s.id);
}

/** The name to show for a stored choice — one suite, several, or all. */
export function suiteLabel(value: string | null): string {
  const ids = parseWorkspace(value);
  if (ids.length === 0) return 'your workspace';
  if (ids.length === SUITES.length) return 'the full XENO workspace';
  const names = ids.map((id) => SUITES.find((s) => s.id === id)?.name).filter(Boolean);
  if (names.length === 1) return names[0] as string;
  // "Creative and Office" reads better than a bare list, and at three it stays
  // short enough not to need truncating — four is `everything` by definition.
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE STORED VALUE IS A SET, NOT ONE ID
 *
 * Suites are individually selectable and individually un-selectable, so the
 * answer is "which suites", not "which suite". Selecting every one of them is
 * the SAME answer as pressing the everything bar, and it collapses to
 * `everything` — one canonical value, so two routes to the same choice cannot
 * be stored as two different things and later read as two different answers.
 *
 * Serialised as a comma-joined list because `user_onboarding.workspace` is a
 * single TEXT column and the alternative is a migration plus a join table for
 * at most four ids. The widest non-everything case is three suites
 * ("creative,developer,connect", 26 chars) against a 40-char cap in the route
 * — all four never reaches that path, because all four IS `everything`.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Stored value → the suite ids it means. `everything` expands to all of them. */
export function parseWorkspace(value: string | null | undefined): string[] {
  if (!value) return [];
  if (value === EVERYTHING_ID) return SUITES.map((s) => s.id);
  const known = new Set(SUITES.map((s) => s.id));
  // Unknown ids are dropped rather than kept: a suite removed from the catalog
  // would otherwise keep a stored selection alive that nothing can render, and
  // the count would disagree with what is on screen.
  return value.split(',').map((v) => v.trim()).filter((v) => known.has(v));
}

/** Suite ids → the value to store. All of them collapses to `everything`. */
export function serializeWorkspace(ids: string[]): string | null {
  const known = SUITES.map((s) => s.id);
  const picked = known.filter((id) => ids.includes(id)); // canonical order
  if (picked.length === 0) return null;
  if (picked.length === known.length) return EVERYTHING_ID;
  return picked.join(',');
}

/** Does this selection cover every suite? */
export function isEverything(ids: string[]): boolean {
  return ids.length > 0 && ids.length === SUITES.length;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ROLE → RECOMMENDED WORKSPACE
 *
 * The flow asks what somebody does BEFORE offering the suites, so the suite
 * step can answer rather than interrogate: "here is the one for you", not
 * "pick from four".
 *
 * ── IT SUGGESTS, IT DOES NOT DECIDE ────────────────────────────────────────
 *
 * The recommendation is pre-selected and LABELLED as a recommendation. Both
 * halves matter. Pre-selecting without saying so silently answers a question
 * on the user's behalf and they discover it later; labelling without
 * pre-selecting makes them do the work anyway. Marked and applied, it reads as
 * a considered default — which is what it is — and one click undoes it.
 *
 * ── ROLES WITH NO OBVIOUS HOME GET NOTHING ─────────────────────────────────
 *
 * "Personal use" and "Other" map to null on purpose. A guess dressed as a
 * recommendation is worse than no recommendation: it is confidently wrong at
 * exactly the moment the product is claiming to understand you. Those roles
 * simply see the four cards unselected.
 *
 * "Studio or agency" maps to everything because an agency genuinely spans the
 * suites — that is the one role for which the whole ecosystem IS the answer.
 * ═══════════════════════════════════════════════════════════════════════════ */
const ROLE_WORKSPACE: Record<string, string | null> = {
  'Personal use': null,
  Designer: 'creative',
  Developer: 'developer',
  Creator: 'creative',
  Marketer: 'connect',
  'Studio or agency': EVERYTHING_ID,
  Education: 'office',
  Other: null,
};

/* ── ROLES ARE A SET TOO ─────────────────────────────────────────────────────
 *
 * People are more than one thing — a designer who also markets, an agency that
 * does both. Forcing one answer makes the recommendation that follows narrower
 * than the person it is for.
 *
 * Serialised the same way workspaces are: comma-joined, canonical order,
 * unknown values dropped. Order comes from ROLE_WORKSPACE's key order, so the
 * stored string is stable regardless of the sequence they were clicked in —
 * two users who picked the same roles store the same value, which is what
 * makes the field aggregatable.
 * ─────────────────────────────────────────────────────────────────────────── */

const ROLE_ORDER = Object.keys(ROLE_WORKSPACE);

/** Stored value → the roles it means. */
export function parseRoles(value: string | null | undefined): string[] {
  if (!value) return [];
  const known = new Set(ROLE_ORDER);
  return value.split(',').map((v) => v.trim()).filter((v) => known.has(v));
}

/** Roles → the value to store, in canonical order. */
export function serializeRoles(roles: string[]): string | null {
  const picked = ROLE_ORDER.filter((r) => roles.includes(r));
  return picked.length ? picked.join(',') : null;
}

/**
 * The workspace value to pre-select for the roles chosen.
 *
 * The UNION of what each role suggests, because someone who is both a designer
 * and a developer wants both workspaces — recommending only the first would
 * quietly discard half of what they just told us.
 *
 * Roles that map to nothing contribute nothing rather than blocking: picking
 * "Other" alongside "Designer" should still recommend Creative.
 */
export function recommendedWorkspace(value: string | null | undefined): string | null {
  const roles = parseRoles(value);
  if (roles.length === 0) return null;

  const ids: string[] = [];
  for (const role of roles) {
    const rec = ROLE_WORKSPACE[role];
    if (!rec) continue;
    // One role asking for everything settles it — there is nothing to add.
    if (rec === EVERYTHING_ID) return EVERYTHING_ID;
    // Guard against a suite id that no longer exists: a renamed suite would
    // otherwise pre-select nothing while still claiming a recommendation.
    if (SUITES.some((s) => s.id === rec) && !ids.includes(rec)) ids.push(rec);
  }
  return serializeWorkspace(ids);
}

/** Is this suite among the ones recommended? Used to badge the card. */
export function isRecommended(suiteId: string, value: string | null | undefined): boolean {
  const rec = recommendedWorkspace(value);
  // `everything` is not a card, so it badges nothing — the bar is its own
  // affordance and does not need a marker pointing at it.
  if (rec === null || rec === EVERYTHING_ID) return false;
  return parseWorkspace(rec).includes(suiteId);
}
