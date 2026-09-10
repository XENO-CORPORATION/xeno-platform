/**
 * Which products have documentation — the LIST, with none of the prose.
 *
 * `./index.ts` answers the same question, but answering it costs ~500 KB: it
 * imports all sixteen content modules so that `getProductDocs(slug)` can return
 * the whole document. `ProductLanding` only ever asked whether the answer was
 * undefined — one boolean, to decide whether to render a "Documentation" link —
 * and that single `!!` pulled every word of every product's docs into the
 * bundle that serves /product/<slug>, which is the most-visited route on the
 * site and is prerendered for crawlers.
 *
 * The leading underscore is this directory's existing convention for a module
 * that is NOT a product's documentation — the same signal `_types.ts` carries,
 * and the one `scripts/product-docs.test.mjs` reads when it decides which files
 * to hold to the docs contract. Without it, a helper here is parsed as a docs
 * module and fails for having no pages.
 *
 * This module has no imports at all, so importing it costs the array below.
 *
 * 🔴 It is a HAND-MAINTAINED COPY of a derived fact, which is the shape that
 * rots. `scripts/docs-slug-registry.test.mjs` compares it against the real
 * `MODULES` registry in `./index.ts` in both directions and fails on any
 * difference, so adding a product to one and not the other is a red build
 * rather than a silently missing link. Do not "simplify" this by re-exporting
 * `DOCUMENTED_SLUGS` from `./index.ts` — that reinstates the import it exists
 * to avoid, and nothing would fail to tell you.
 */
export const DOCUMENTED_SLUGS: readonly string[] = [
  'agent',
  'agent-cli',
  'hub',
  'sdk',
  'acp',
  'pixel',
  'motion',
  'comms',
  'canvas',
  'rt',
  'post',
  'sound',
  'workflow',
  'architect',
  'form',
  'engine',
];

/** Does this product have a docs section at /docs/<slug>? */
export function hasProductDocs(slug?: string): boolean {
  return !!slug && DOCUMENTED_SLUGS.includes(slug);
}
