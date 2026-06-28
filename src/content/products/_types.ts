/* ──────────────────────────────────────────────────────────────────────
 * ProductContent — the single typed source for a product's rich landing page.
 * One schema for every product (PRODUCT-LANDING-SPEC §2.1 / L6). Author one
 * module per product at src/content/products/<slug>.ts; the registry (index.ts)
 * exposes getProductContent(slug). Any product without a module falls back to
 * the lean ProductPage (L3). Every section below is optional except hero +
 * features — the template omits whatever is absent (no empty sections, ever).
 * ────────────────────────────────────────────────────────────────────── */

export interface Media {
  /** 'image'/'video' → src is a URL under /product-assets/<slug>/.
   *  'mockup' → src is a built-in mockup component key (see components/product/mockups). */
  type: 'image' | 'video' | 'mockup';
  src: string;
  alt: string;
  poster?: string;        // video poster image
}

export interface FeatureSpotlight {
  eyebrow?: string;
  title: string;
  desc: string;
  bullets?: string[];
  icon?: string;          // lucide icon name (resolved in ProductLanding)
  accent?: string;        // optional CSS gradient for the card background
  media?: Media;          // the visual for this feature (alternates side-to-side)
}

export interface ProductContent {
  slug: string;                                   // MUST match the catalog entry
  hero: {
    headline: string;                             // stronger than the catalog tagline
    sub: string;
    media: Media;                                 // the big hero visual (image/video/mockup)
    badges?: string[];                            // ["Windows", "Free", "End-to-end ready"]
  };
  highlights?: { value: string; label: string }[];
  features: FeatureSpotlight[];                    // ≥1 for a "full" page
  gallery?: Media[];
  useCases?: { title: string; desc: string; icon?: string }[];
  howItWorks?: { step: string; title: string; desc: string }[];
  comparison?: {
    competitor: string;
    rows: { feature: string; xeno: boolean | string; them: boolean | string }[];
  };
  specs?: { label: string; value: string }[];
  faq?: { q: string; a: string }[];
  seo?: { title?: string; description?: string }; // overrides the prerender defaults
}
