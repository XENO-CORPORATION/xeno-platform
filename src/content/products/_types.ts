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

/** One block of a per-product privacy policy. `bullets[].term` renders as a bold
 *  lead-in, so "Page content you direct it to work with." reads as a definition
 *  list rather than a wall of prose. */
export interface PrivacySection {
  heading: string;
  body?: string;
  bullets?: { term?: string; text: string }[];
  /** Rendered after the bullets — use for the qualifying sentence that would
   *  otherwise have to be smuggled into the last bullet. */
  footnote?: string;
}

/** A product-specific privacy policy served at /product/<slug>/privacy.
 *
 *  This exists because some products process data the PLATFORM policy at
 *  /privacy does not describe — the browser extension reads page content
 *  through chrome.debugger and can send it to a provider the user chose, which
 *  is exactly the disclosure a web-store review asks for. A store listing needs
 *  a stable public URL for it, so it must be a real prerendered route and not a
 *  markdown file in the product repo.
 *
 *  Author it next to the product's other content and keep it in sync with the
 *  product repo's own PRIVACY.md — that file is what ships to reviewers. */
export interface ProductPrivacy {
  /** ISO date (YYYY-MM-DD). Rendered verbatim; keep it truthful. */
  updated: string;
  intro: string;
  sections: PrivacySection[];
  /** Contact address for privacy questions. */
  contact: string;
}

export interface ProductContent {
  slug: string;                                   // MUST match the catalog entry
  hero: {
    headline: string;                             // stronger than the catalog tagline
    sub: string;
    media: Media;                                 // the big hero visual (image/video/mockup)
    badges?: string[];                            // ["Windows", "Free", "End-to-end ready"]
    note?: string;                                // small honesty line under the CTA
  };
  trust?: string[];                               // slim proof band under the hero (honest, no fake claims)
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
  /** Product-specific privacy policy. When present, /product/<slug>/privacy
   *  becomes a real prerendered page; when absent, that URL redirects to the
   *  platform-wide /privacy so the path is never a dead end. */
  privacy?: ProductPrivacy;
  /** Overrides the hero status pill when the coarse catalog Status overstates
   *  reality (e.g. a 'beta' entry that actually ships as an internal alpha). */
  statusLabel?: string;
  /** Shown as a band on /product/<slug>/download for caveats true of THIS
   *  product only — throwaway account, prerelease data loss, no auto-update.
   *  Do NOT write the experimental/unsigned/SmartScreen posture here: that is
   *  derived from the catalog (`experimentalNotice`) and already rendered above
   *  this block on every download surface. Duplicating it makes the page say the
   *  same thing twice, and leaves a stale copy behind when signing lands. */
  downloadNotice?: string;
  /** Defaults to true. Set false when the shipped package has auto-update
   *  disabled, so the download page stops promising updates it won't deliver. */
  autoUpdates?: boolean;
}
