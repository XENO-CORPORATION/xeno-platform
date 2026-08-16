import manifest from './releaseStatus.json';
import exceptionsFile from './releaseExceptions.json';

/* ═══════════════════════════════════════════════════════════════════════════
 * IS THIS PRODUCT ACTUALLY RELEASED?
 *
 * Answered from a MEASUREMENT, not from `productCatalog.status`.
 *
 * That field is a hand-maintained claim, and the probe that generated this
 * manifest found three products marked `coming-soon` while serving real v0.1.0
 * releases (3d, architect, engine). This ecosystem has been bitten by that
 * shape repeatedly — xeno-browser was documented as "Scaffolded v0.0.1" while
 * shipping v0.3.0 — because a claim goes stale silently and a 200 does not.
 *
 * Refresh with: node scripts/probe-release-status.mjs
 * ═══════════════════════════════════════════════════════════════════════════ */

type Entry = {
  released: boolean | null;
  version?: string;
  source: string;
  catalogStatus?: string;
  delivery?: string;
};

const PRODUCTS = (manifest as { products: Record<string, Entry> }).products || {};

export const releaseCheckedAt: string = (manifest as { checkedAt?: string }).checkedAt || '';

/**
 * Products with a published artifact that we deliberately do NOT advertise.
 *
 * Read from the same file the gate reads, so the screen and the test can never
 * disagree about which products are real. 3d, architect and engine all serve
 * genuine v0.1.0 installers whose own release notes describe a UI scaffold
 * with a placeholder viewport — the artifact exists, the product does not, and
 * "Soon" is the honest label. Each entry carries a reason and a retirement
 * condition; see releaseExceptions.json.
 */
const NOT_ADVERTISED = new Set(
  Object.keys((exceptionsFile as { acknowledged?: Record<string, unknown> }).acknowledged || {}),
);

/**
 * Has this product got a real, published release?
 *
 * Three-valued on purpose. `null` means the probe could not reach a channel
 * that applies — xeno-rt ships as a public Rust repo with no R2 feed, so a
 * 404 there proves nothing about it. Collapsing unknown into `false` would let
 * one unreachable feed retire a shipping product from the UI, which is the
 * same class of error as trusting a stale claim, just faster.
 */
export function isReleased(slug: string): boolean | null {
  const e = PRODUCTS[slug];
  return e ? e.released : null;
}

/** The published version, when one was measured. */
export function releasedVersion(slug: string): string | null {
  return PRODUCTS[slug]?.version || null;
}

/**
 * Should the UI mark this product as not-yet-available?
 *
 * MEASUREMENT FIRST, claim as fallback. A confirmed release beats a stale
 * `coming-soon`; a confirmed empty feed beats an optimistic `beta`; and when
 * the measurement is unknown the catalog is all we have, so it is used rather
 * than guessing in either direction.
 */
export function isUnreleased(slug: string, catalogStatus?: string): boolean {
  // A declared exception outranks the measurement. "An installer exists" is
  // not the same claim as "this is a product", and three of ours are shells.
  if (NOT_ADVERTISED.has(slug)) return true;

  const measured = isReleased(slug);
  if (measured === true) return false;
  if (measured === false) return true;
  return catalogStatus === 'coming-soon';
}
