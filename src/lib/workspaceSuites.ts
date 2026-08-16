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

/** The name to show for a stored choice, including the everything case. */
export function suiteLabel(id: string | null): string {
  if (id === EVERYTHING_ID) return 'the full XENO workspace';
  return SUITES.find((s) => s.id === id)?.name || 'your workspace';
}
