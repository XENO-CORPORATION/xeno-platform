/* ──────────────────────────────────────────────────────────────────────
 * XENO Studio unified docs — content model.
 *
 * Mirrors the product-content pattern (src/content/products/): typed data
 * modules in a registry, rendered by a shared template, prerendered for SEO.
 * A doc page's `body` is a markdown string (rendered by DocMarkdown).
 * ────────────────────────────────────────────────────────────────────── */

export interface DocPage {
  /** URL segment under the product, e.g. 'quickstart' → /docs/agent-cli/quickstart */
  slug: string;
  title: string;
  /** One line — used for SEO description, search, and the page subhead. */
  description?: string;
  /** Markdown. Rendered by DocMarkdown (GFM + math + fenced code). */
  body: string;
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

export interface ProductDocs {
  /** Matches the product slug in productCatalog (e.g. 'agent-cli'). */
  slug: string;
  productName: string;
  /** Short line shown on the docs home card + product docs header. */
  tagline?: string;
  /** Exact product/package version this documentation was reconciled against. */
  version?: string;
  /** ISO date of the latest shipped-behavior reconciliation. */
  updated?: string;
  sections: DocSection[];
  /** Optional SEO overrides for the product docs index. */
  seo?: { title?: string; description?: string };
}

/** Flattened page + its context — used by the prerender and the search index. */
export interface DocRoute {
  productSlug: string;
  productName: string;
  sectionTitle: string;
  pageSlug: string;
  title: string;
  description?: string;
  body: string;
}
