import type { ProductContent } from './_types';
import comms from './comms';
import agentCli from './agent-cli';

/* Registry of rich landing-page content modules. A product listed here renders
 * the full ProductLanding; any product NOT here falls back to the lean
 * ProductPage (PRODUCT-LANDING-SPEC L3). Add a product = author its module and
 * import it here. */
const MODULES: ProductContent[] = [comms, agentCli];

const BY_SLUG = new Map(MODULES.map((m) => [m.slug, m]));

export function getProductContent(slug?: string): ProductContent | undefined {
  return slug ? BY_SLUG.get(slug) : undefined;
}

/** Slugs that have a rich landing page (used by the prerender for SEO). */
export const RICH_PRODUCT_SLUGS = MODULES.map((m) => m.slug);

export type { ProductContent } from './_types';
