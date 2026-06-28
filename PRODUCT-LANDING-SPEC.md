# XENO Product Landing Pages & Onboarding — SPEC

> **Status:** 🔒 Draft v1.0 — 2026-06-28
> **Owner:** xeno-platform (xenostudio.ai)
> **Builds on:** `PRODUCT-PAGES-SPEC.md` (URLs, `releases.json`, redirects, the
> publisher, prerender). That spec is the *infrastructure*; this spec is the
> *presentation + per-product onboarding + CI/CD* layer on top of it.

This document defines **one repeatable system** for giving every XENO product a
real landing page, wiring each product into the platform, and keeping the page in
sync with the product's releases automatically. Adding a product's page = author
one content module + drop in assets; everything else (URL, version, download,
SEO, sitemap) is already handled by `PRODUCT-PAGES-SPEC.md`.

---

## 0. The three layers of a product

Every product is represented on the platform by exactly three things. Keeping them
separate is what makes this scale:

| Layer | What | Lives in | Changes when |
|---|---|---|---|
| **Identity** | slug, name, tagline, category, status, delivery, repo | `src/lib/productCatalog.ts` (one entry) | product is added / re-classified |
| **Release data** | versions, dates, notes, installers (per OS) | R2 `apps/<slug>/releases.json` (+ `version.json`) | **every release** (auto, via `xeno-release`) |
| **Landing content** | hero, features, screenshots, use-cases, comparison, FAQ | `src/content/products/<slug>.ts` + `public/product-assets/<slug>/` | marketing/design changes (rare) |

**Key consequence:** release data is read **live** by the page, so a new version /
download appears **without any platform change**. Only *marketing content* edits
require a platform rebuild + deploy. (See §6.)

---

## 1. Locked decisions

| # | Decision |
|---|----------|
| **L1** | Every **shipping / beta** product gets a **full landing page** rendered from a typed content module. **coming-soon** products keep the lean waitlist page until they ship. |
| **L2** | Landing content lives in the **platform repo** at `src/content/products/<slug>.ts` (typed `ProductContent`), NOT in the product repos. The platform owns presentation; product repos own code + releases. |
| **L3** | The rich template **degrades gracefully**: any section with no content is omitted; a product with *no* content module falls back to today's lean `ProductPage`. No broken/empty sections, ever. |
| **L4** | Visuals are **generated from each product's real app design** (we have every product repo locally) — UI mockups via the xeno-image pipeline for desktop apps, real browser captures for web apps — kept on-brand and stored in `public/product-assets/<slug>/` as optimized `.webp`/`.mp4`. |
| **L5** | The **CTA is derived**, never hardcoded: `delivery:desktop` → Download (deep-link), `web` → Launch (`launchPath`), `cli` → install command. Version/latest come from `releases.json`. |
| **L6** | One **content schema** (`ProductContent`) for all products. New section types are added to the schema + template once, then available to every product. |
| **L7** | **Per-product slug is the join key** across all three layers and the URL (`PRODUCT-PAGES-SPEC.md` D7). |

---

## 2. Landing-page anatomy

The template renders these sections **in order**, each optional (driven by the
content module). A shipping product typically uses hero + highlights + 3–5 feature
spotlights + gallery + use-cases + (comparison) + (specs) + FAQ + closing CTA.

1. **Hero** — eyebrow (category), headline, sub, hero media (screenshot/looping
   video), derived CTA + secondary "All versions", status pill + latest version.
2. **Highlights bar** — 3–4 proof points (`{ value, label }`): "20+ models",
   "Win · macOS · Linux", "Free to start".
3. **Feature spotlights** — alternating image↔text blocks; each: eyebrow, title,
   description, bullets, and a screenshot of that feature.
4. **Gallery** — 3–6 screenshots / short clips of the product in use.
5. **Use cases** — "who it's for" / "what you can do" cards.
6. **How it works** — 3-step flow (download/launch → do the thing → ship).
7. **Comparison** — "Pixel vs Photoshop", "Motion vs Premiere" feature table
   (only where it's honest + flattering).
8. **Specs / what's included** — desktop: OS, size, requirements (from
   `releases.json` assets); web/cli: capabilities.
9. **FAQ** — 4–8 Q&As.
10. **Closing CTA** — repeat the primary action + link to `/product/<slug>/releases`.

### 2.1 The `ProductContent` schema (single source for the page)

```ts
// src/content/products/_types.ts
export interface Media { type: 'image' | 'video'; src: string; alt: string; poster?: string }

export interface FeatureSpotlight {
  eyebrow?: string;
  title: string;
  desc: string;
  bullets?: string[];
  media?: Media;            // the screenshot for this feature
}

export interface ProductContent {
  slug: string;                                   // MUST match the catalog entry
  hero: {
    headline: string;                             // stronger than the catalog tagline
    sub: string;
    media: Media;                                 // the big hero visual
    badges?: string[];                            // ["Windows", "Free", "Offline"]
  };
  highlights?: { value: string; label: string }[];
  features: FeatureSpotlight[];                    // ≥1 for a "full" page
  gallery?: Media[];
  useCases?: { title: string; desc: string }[];
  howItWorks?: { step: string; title: string; desc: string }[];
  comparison?: {
    competitor: string;                           // "Adobe Photoshop"
    rows: { feature: string; xeno: boolean | string; them: boolean | string }[];
  };
  specs?: { label: string; value: string }[];
  faq?: { q: string; a: string }[];
  seo?: { title?: string; description?: string }; // overrides the prerender defaults
}
```

Registry: `src/content/products/index.ts` exports `getProductContent(slug): ProductContent | undefined`. The rich template uses it; `undefined` → lean fallback (L3).

---

## 3. Per-product content module

- **Location:** `src/content/products/<slug>.ts`, default-exporting a `ProductContent`.
- **Authoring source:** the product's **real repo** (`../xeno-<name>`) — read its
  README/SPEC/CHANGELOG, its actual UI components, and its feature set so the copy
  and screenshots are accurate, not invented.
- **Copy rules:** concrete + specific ("non-destructive layers, 100+ brushes,
  ONNX upscaling"), no vague hype, no fake testimonials or numbers.
- **Keep it honest with status:** `beta` products say "Beta" and set expectations;
  don't claim parity that isn't there.

---

## 4. Visuals

The make-or-break input. One consistent pipeline (L4):

| Product type | How visuals are produced |
|---|---|
| **Web apps** (Image, Video, Audio, 3D-Gen) | Capture **real screenshots** of the running app (browser), crop/clean, export `.webp`. |
| **Desktop apps** (Hub, Pixel, Motion, Sound) | If real screenshots exist, use them. Otherwise generate **UI mockups** with the xeno-image pipeline, prompted from the product's **actual design** (its components/theme in `../xeno-<name>`), so the mockup matches the real app. |
| **CLI / SDK** (Agent-CLI, SDK) | Terminal/code snippets rendered as styled `<pre>` blocks + a hero "terminal" mock; no fake GUI. |
| **Hero art / section backgrounds** | AI-generated, on the XENO dark/violet palette. |

- **Storage:** `public/product-assets/<slug>/` → served at
  `/product-assets/<slug>/hero.webp` etc. Versioned with the platform repo.
- **Format/perf:** `.webp` (images) / `.mp4` + poster (clips); target ≤200 KB per
  image, lazy-load below the fold; always set `alt`.
- **Open Graph:** the hero image doubles as the page's `og:image`
  (`PRODUCT-PAGES-SPEC.md` §8 prerender picks it up via `seo`).

---

## 5. The rich template + fallback

- New component `ProductLanding` (renders from `ProductContent`) replaces the body
  of `ProductPage` **when** `getProductContent(slug)` returns content; otherwise the
  existing lean `ProductPage` body renders (L3).
- Both share the v3 `Header`/`Footer`, the sticky-footer flex layout, the derived
  CTA (`downloadLink`/`launchPath`/install), and the live `fetchReleases` data.
- The template is **prerendered** per product (`PRODUCT-PAGES-SPEC.md` §8) so the
  landing pages are SEO-complete (title, description, OG = hero, JSON-LD).

---

## 6. CI/CD — how a page stays in sync

Two independent flows; this separation is the whole point.

### 6.1 Release flow (automatic, NO platform deploy)
On a product release, in the **product's repo / pipeline**:
1. Build installers.
2. `xeno-release publish --app <slug> --version X.Y.Z …` → uploads installers +
   updates `releases.json` + `version.json` on R2 (`PRODUCT-PAGES-SPEC.md` §7).
3. **Done.** The live landing page reads `releases.json` on load, so the new
   version, date, notes, and download instantly appear — **no platform change**.
   Hub auto-update reads `version.json` the same way.

### 6.2 Content flow (platform deploy)
When marketing/design changes (new screenshots, new feature copy):
1. Edit `src/content/products/<slug>.ts` + drop assets in `public/product-assets/<slug>/`.
2. Commit to the platform repo.
3. **Build + deploy** the platform: `npm run build` (vite + prerender) → publish
   `dist` (regenerates that product's prerendered HTML + sitemap).

### 6.3 Pipelines
- **Ideal (target):**
  - *Product repos:* a release GitHub Action that runs `xeno-release publish` on
    tag push (so 6.1 is automatic).
  - *Platform:* a deploy GitHub Action on push to the deploy branch that builds +
    prerenders + ships `dist` (so 6.2 is automatic).
- **Current reality (documented):** org Actions billing is down, so deploys are
  **manual** — build locally, `git archive` changed files to
  `/mnt/projects/xeno-platform`, `docker compose build frontend && up -d`
  (build-before-swap, rollback images tagged). Releases are published by running
  `xeno-release` by hand. This SPEC's separation means **patch releases need zero
  manual platform work** — only content changes do.

### 6.4 Responsibilities
| Who | Owns |
|---|---|
| **Product repo** | catalog entry kept current; publishing releases via `xeno-release`; providing accurate features/design for the content module |
| **Platform** | the `ProductContent` module + assets; the rich template; prerender + deploy |

---

## 7. Per-product onboarding checklist

To stand up a product's landing page:
- [ ] **Catalog** entry exists + correct (`status`, `delivery`, `repo`, `launchPath`/`install`).
- [ ] **Release data** on R2: `releases.json` + `version.json` published (via `xeno-release`); `/product/<slug>/download/<os>` 302s to a real installer.
- [ ] **Content module** `src/content/products/<slug>.ts` authored from the real repo (hero + ≥3 feature spotlights + use-cases + FAQ).
- [ ] **Assets** in `public/product-assets/<slug>/` (hero + per-feature screenshots), optimized, `alt` set.
- [ ] **Comparison/specs** added where relevant.
- [ ] Build clean; prerender emits the page with correct SEO (title/canonical/OG=hero/JSON-LD).
- [ ] Deployed + verified: `/product/<slug>` renders the full landing page, CTA works, releases feed populated.

"**Landing-complete**" = the checklist passes and the page reads like a real product landing page, not a template.

---

## 8. Rollout plan

| Phase | Products | Notes |
|---|---|---|
| **P0 — Reference** | **Pixel** | Build `ProductLanding` + the schema + the asset pipeline against Pixel (very visual, beta). Lock the design. |
| **P1 — Shipping flagships** | Hub, Image, Video, Audio | Hub = platform entry point; the web apps = "Launch" CTA + easy real screenshots. |
| **P2 — Creative betas** | Motion, Sound, 3D-Gen | Reuse the template + comparison tables (vs Premiere / Audition / etc.). |
| **P3 — Dev & agents** | Agent-CLI, SDK, RT, Anima, Extension | Code/terminal-forward variants; Anima needs a **catalog entry** (currently listed as legacy "swarm" — rename/repoint to `anima`). |
| **—** | Everything `coming-soon` | Stay on the lean waitlist page; promote to a full page when they ship. |

> Note: the catalog currently has `slug: 'swarm'` ("XENO Swarm"); per the
> ecosystem it was renamed **Anima** (`xeno-anima`). Fix the catalog entry as part
> of P3 (or sooner) so the slug/repo are correct.

---

## 9. Appendix — example content module (shape)

```ts
// src/content/products/pixel.ts
import type { ProductContent } from './_types';

const pixel: ProductContent = {
  slug: 'pixel',
  hero: {
    headline: 'AI-native image editing, end to end',
    sub: 'Layers, brushes, masks and selection like a pro editor — plus generation, upscaling and background removal running locally.',
    media: { type: 'image', src: '/product-assets/pixel/hero.webp', alt: 'XENO Pixel editing a photo with layers' },
    badges: ['Windows', 'Beta', 'Local AI'],
  },
  highlights: [
    { value: '100+', label: 'Brushes & presets' },
    { value: 'Non-destructive', label: 'Layer pipeline' },
    { value: 'On-device', label: 'AI (ONNX)' },
  ],
  features: [
    { eyebrow: 'EDIT', title: 'A real layer engine',
      desc: 'Non-destructive layers, masks, blend modes and adjustment layers.',
      bullets: ['Masks & clipping', 'Blend modes', 'Smart objects'],
      media: { type: 'image', src: '/product-assets/pixel/layers.webp', alt: 'Layers panel' } },
    // …more spotlights…
  ],
  comparison: {
    competitor: 'Adobe Photoshop',
    rows: [
      { feature: 'Local AI generation', xeno: true, them: false },
      { feature: 'One-time / credits', xeno: 'Credits', them: 'Subscription' },
    ],
  },
  faq: [{ q: 'Is it free?', a: 'Pixel is in beta and free to try during the beta.' }],
};
export default pixel;
```

---

*End of SPEC v1.0. The `ProductLanding` template + schema land in P0; this doc is
the contract every product page is built to.*
