# XENO Product Landing Pages — SPEC & BUILD REFERENCE

> **Status:** ✅ **v2.1 — Built** (2026-07-05). The template, schema, mockup
> system, accent themes, design standards, **and the unified docs system (§7.5)**
> are **shipped and live**.
> **Reference implementations: XENO Comms** (`/product/comms`) — landing;
> **XENO Agent CLI** (`/product/agent-cli` + `/docs/agent-cli`, 23 pages) —
> landing **+ docs** (the worked example for the docs layer).
> **Owner:** xeno-platform (xenostudio.ai).
> **Builds on:** `PRODUCT-PAGES-SPEC.md` (URLs, `releases.json`, redirects, the
> `xeno-release` publisher, prerender) and `RELEASE-TO-WEBSITE.md` (how a release
> reaches the site). That layer is the *infrastructure*; this is the
> *presentation* layer on top of it.

**To build the next product's full surface (Hub, Image, Motion…), follow §9** —
which now covers landing **and docs**. Everything else here is the contract behind
that checklist. Copy **comms** for the landing and **agent-cli** for the docs — they
are the worked examples every field below is drawn from.

---

## 0. The four layers of a product

Every product is represented on the platform by exactly four things, all joined by
the **slug** (L7). Keeping them separate is what makes this scale:

| Layer | What | Lives in | Changes when |
|---|---|---|---|
| **Identity** | slug, name, tagline, category, status, delivery, repo | `src/lib/productCatalog.ts` (one entry) | product added / re-classified |
| **Release data** | versions, dates, notes, installers | R2 `apps/<slug>/releases.json` (+ `version.json`) | **every release** (auto, via `xeno-release`) |
| **Landing content** | hero, features, use-cases, comparison, FAQ + its mockups | `src/content/products/<slug>.ts`, `src/components/product/mockups/`, `public/product-assets/<slug>/` | marketing/design changes (rare) |
| **Documentation** | guides + reference pages at `/docs/<slug>` | `src/content/docs/<slug>.ts` (registered in `index.ts`) — see **§7.5** | docs authored / updated |

**The URLs a product owns:** `/product/<slug>` (landing) · `/product/<slug>/download`
· `/product/<slug>/releases` · `/docs/<slug>` (docs). They are **cross-linked**: the
landing shows a *Documentation* link when docs exist (§7.5), `/product/<slug>/docs`
redirects to `/docs/<slug>`, and doc pages link back to the product + releases.

**Key consequence:** release data is read **live** (new version/download appears with
**no platform deploy**). *Landing content* **and** *documentation* are compiled +
prerendered, so they need a platform rebuild + deploy (§8).

---

## 1. Locked decisions

| # | Decision |
|---|----------|
| **L1** | Every **shipping / beta** product gets a **full landing page** from a typed content module. **coming-soon** products keep the lean waitlist page until they ship. |
| **L2** | Landing content lives in the **platform repo** (`src/content/products/<slug>.ts` + its mockups), NOT in the product repos. Platform owns presentation; product repos own code + releases. |
| **L3** | The template **degrades gracefully**: any section with no content is omitted; a product with *no* content module falls back to the lean `ProductPage`. No broken/empty sections, ever. |
| **L4** | **Visuals are hand-built UI mockups in JSX/Tailwind** — the real product interface *recreated in code* (crisp, weightless, theme-aware, no asset weight). **Preferred over screenshots and over AI-generated art.** See §4. (AI-generated product imagery was tried and rejected — it reads as fake. Real app captures need a logged-in session we usually can't automate.) |
| **L5** | The **CTA is derived**, never hardcoded: `delivery:desktop` → Download deep-link, `web` → Launch (`launchPath`), `cli` → install command. Version/latest come from `releases.json`. |
| **L6** | One **content schema** (`ProductContent`) for all products. New section types are added to the schema + template once, then available everywhere. |
| **L7** | **Per-product slug is the join key** across all three layers and the URL. |
| **L8** | **Accent color is a runtime CSS variable** (`--acc`), switchable per-user via a hidden **Shift+T** control. Every accent use goes through `.acc-*` utility classes / `rgb(var(--acc))`, never a hardcoded hex. See §5. |
| **L9** | The bar is **Cursor / Devin / Linear**, and the layout follows **NN/g** research (representative product visual, no dead full-screen hero, specific CTAs, minimal motion, honest social proof). See §6. |

---

## 2. Landing-page anatomy

The `ProductLanding` template renders these sections **in order**, each optional
(driven by the content module). A full page = hero + trust + highlights + 3–5
features + gallery + use-cases + how-it-works + (comparison) + (specs) + FAQ +
closing CTA.

1. **Hero** — `Eyebrow` (category) + status pill, serif headline, decorative rule,
   sub, badges, honesty **note**, derived **CTA** + secondary + latest version, and
   the **hero media** (a mockup). `min-h-[80svh]` so the highlights **peek** above
   the fold + a scroll cue (never a dead full-screen block — NN/g §6).
2. **Trust band** — a slim honest proof row (`trust[]`): platform/tech/values. No
   fake logos, testimonials or numbers.
3. **Highlights** — 4 proof points (`{ value, label }`) in a bordered strip.
4. **Feature spotlights** — bento cards (icon + accent gradient) when features have
   no media; alternating image↔text spotlights when they do.
5. **Gallery** — 2–4 media (mockups/images) of the product in use, equal height.
6. **Use cases** — "who it's for" cards (icon + title + desc).
7. **How it works** — 3-step numbered flow.
8. **Comparison** — vs the incumbent, only where honest (list where *they* still win too).
9. **Specs** — OS / account / backend / status strip.
10. **FAQ** — 4–8 `<details>` Q&As.
11. **Closing CTA** — repeat the primary action + `Latest releases` feed.

### 2.1 The `ProductContent` schema (the single source — copy this exactly)

```ts
// src/content/products/_types.ts  (this is the SHIPPED schema)
export interface Media {
  type: 'image' | 'video' | 'mockup';  // 'mockup' → src is a registry key (§4)
  src: string;                          // URL under /product-assets/<slug>/, OR a mockup key
  alt: string;
  poster?: string;
}
export interface FeatureSpotlight {
  eyebrow?: string;
  title: string;
  desc: string;
  bullets?: string[];
  icon?: string;     // lucide icon name (resolved in ProductLanding's ICONS map)
  accent?: string;   // optional CSS gradient for the bento card background
  media?: Media;     // present → alternating spotlight; absent → bento grid
}
export interface ProductContent {
  slug: string;                                   // MUST match the catalog entry
  hero: {
    headline: string;                             // punchier than the catalog tagline
    sub: string;
    media: Media;                                 // usually { type:'mockup', src:'<key>' }
    badges?: string[];
    note?: string;                                // small honesty line under the CTA
  };
  trust?: string[];                               // slim proof band (honest only)
  highlights?: { value: string; label: string }[];
  features: FeatureSpotlight[];                    // ≥1 for a "full" page
  gallery?: Media[];
  useCases?: { title: string; desc: string; icon?: string }[];
  howItWorks?: { step: string; title: string; desc: string }[];
  comparison?: { competitor: string; rows: { feature: string; xeno: boolean | string; them: boolean | string }[] };
  specs?: { label: string; value: string }[];
  faq?: { q: string; a: string }[];
  seo?: { title?: string; description?: string }; // overrides the prerendered <head> (title/description/OG)
}
```

Registry: `src/content/products/index.ts` imports each module and exposes
`getProductContent(slug)`. `ProductPage` dispatches: content present → `ProductLanding`;
absent → lean page (L3).

---

## 3. Authoring the content module

- **Location:** `src/content/products/<slug>.ts`, default-exporting a `ProductContent`.
- **Authoring source:** the product's **real repo** (`../xeno-<name>`) — read its
  README/SPEC/CHANGELOG and its **actual UI components** so copy + mockups are
  accurate, not invented.
- **Copy rules:** concrete + specific, no vague hype, **no fake testimonials or
  numbers**. Keep it honest with `status`: a `beta` product says "Beta / public
  test" and states what's gated — see comms' `hero.note` and the E2EE bullet.
- **Headline:** short, value-first (comms: *"AI that's part of the team."*), not the
  catalog tagline. **Comparison:** include a row where the incumbent still wins —
  it reads as honest, not marketing.

---

## 4. Visuals — hand-built mockups (the default)

The make-or-break input. **Recreate the product's real UI in JSX/Tailwind** as a
mockup component; reference it from content as `{ type:'mockup', src:'<key>' }`.

**Why mockups, not screenshots or AI art (L4):**
- Crisp at any DPI, weigh nothing, always on-brand, and **theme-aware** (recolor
  with the accent). Top SaaS sites (Linear, Stripe) ship exactly this.
- AI-generated product shots read as fake — **don't use them for product UI.**
- Real app captures need a logged-in, populated session (usually not automatable);
  swap them in later if you get them.

**How to build one** (copy `src/components/product/mockups/CommsChat.tsx`):
1. Create `src/components/product/mockups/<Product><View>.tsx` — a static component
   that reproduces the app's real UI (window chrome, panels, real-looking data),
   using the landing-v3 language: near-black panels `#0d0d0f`/`#0a0a0c`, hairline
   `border-white/[0.06-0.08]`, off-white text `#f3efe8`/`#cdc7be`/`#aaa39a`/`#69635b`.
2. **All accent color goes through accent classes** so the theme switch recolors it:
   `acc-fg`, `acc-fg-hi`, `acc-b`, `acc-b06/07/10/12/15/16/20`, `acc-bd`, `acc-bd20/25/30/40`,
   or inline `style={{ background: 'rgb(var(--acc))' }}` (define `const V = 'rgb(var(--acc))'`).
   **Never hardcode a violet hex in a mockup.**
3. Register it in `src/components/product/mockups/index.tsx` → `MOCKUPS['<key>'] = Component`.
4. Reference `{ type:'mockup', src:'<key>' }` from the content module.
- Gallery mockups should be **equal height** — pad the shorter one with more content
  (see `CommsMobile` = a full phone screen, not a stub).
- **Raster assets** (real screenshots/video, OG) still live in
  `public/product-assets/<slug>/` as optimized `.webp`/`.mp4` (≤~250 KB, lazy, `alt`).
  Convert with `magick in.png -resize 1600x -quality 82 out.webp`.

---

## 5. Accent theme system (L8)

One CSS variable recolors the whole page; users pick it with **Shift+T**.

- **Defined in `src/index.css`:** `:root { --acc: <r g b>; --acc-hi: <r g b>; }` plus
  `[data-accent="violet|amber|blue|green"]` overrides, the `.acc-*` utility classes,
  and the switcher keyframes `@keyframes accRise` / `@keyframes accSlideOut`.
- **`ProductLanding`** puts `data-accent={accent}` on the page root, reads the choice
  from `?accent=` / `localStorage`, and renders the **Shift+T switcher** (hidden by
  default; the swatches rise from the bottom-right one-by-one on reveal and slide out
  right on dismiss). `ACCENTS` in `ProductLanding.tsx` is the source of truth for the
  palette; the default for first-time visitors is set there (currently `violet`).
- **New mockups get theming for free** as long as they use the `.acc-*` classes (§4).
- Green is available but **avoid it for messaging products** — it collides with
  online/presence semantics.

---

## 6. Design standards — the bar & the research

**Benchmark:** Cursor, Devin, Linear, Vercel. What makes them look expensive:
a **big, real, grounded product shot** as the centerpiece; a **trust/logo strip**;
**alternating feature sections** (bold headline + one line ↔ large screenshot);
**section-background rhythm** (not one flat black); restrained type with **one
accent**; real **testimonials/stats**; a full-depth page (changelog, pricing, footer).

**NN/g research rules (baked into the template):**
- **Representative content, not decoration** — the hero visual must be the real
  product ([Homepage principles](https://www.nngroup.com/articles/homepage-design-principles/)).
- **No dead full-screen hero** — let the next section peek + a scroll cue, or users
  think the page ends ([Illusion of Completeness](https://www.nngroup.com/articles/illusion-of-completeness/)).
- **Specific CTAs**, not "Get Started"/"Learn More" ([Get Started stops users](https://www.nngroup.com/articles/get-started/)).
- **Minimize animation** (reads as ads) — one-shot, subtle, `prefers-reduced-motion`-safe.
- **Honest social proof** — no fake logos/testimonials/counts.

**Current state vs bar:** the shipped comms page has the template layout + rich
mockups + theme system (a strong "template-grade" page). The **remaining jump to
Cursor/Devin-grade** — a larger grounded hero shot, a trust/logo strip, alternating
feature sections, section rhythm, honest stats — is the next structural pass and is
the standard the P1+ pages should aim for from the start.

---

## 7. Template, fallback & prerender

- `src/pages/ProductLanding.tsx` renders the whole page from `ProductContent`; every
  section is conditional. Uses the v3 `Header`/`Footer`, sticky-footer flex, the
  `Reveal`/`Eyebrow`/`SectionHeading`/`T` primitives (`src/components/landing-v3/primitives.tsx`),
  the derived CTA, and live `fetchReleases`.
- `src/pages/ProductPage.tsx` is the **dispatcher**: `getProductContent(slug)` present
  → `ProductLanding`; else the lean page (L3). Adding a page = adding a content module
  (+ mockups); no routing changes.
- **Prerender** (`scripts/prerender-products.mjs`, runs in `npm run build`) emits static
  SEO HTML per product and now uses the content module's `seo{}` to override the
  `<head>` title/description (falls back to catalog tagline). Media/mockups hydrate
  client-side.

---

## 7.5 Product documentation (the docs layer)

Same **typed-module + registry + dispatcher** shape as landing content, so it scales
the same way. A unified docs system serves every product: hub at `/docs`, product docs
at `/docs/<slug>` → `/docs/<slug>/<page>`. **Reference: `agent-cli` (23 pages).**

**Author = one file + one import:**
1. Create `src/content/docs/<slug>.ts`, default-exporting a `ProductDocs`
   (`{ slug, productName, tagline?, sections: [{ title, pages: [{ slug, title, description?, body }] }], seo? }`).
   `body` is a **markdown string**.
2. Register it in `src/content/docs/index.ts` `MODULES`. **That's it** — routing,
   sidebar nav, on-page TOC (scroll-spy), ⌘K search, prev/next, the landing's
   *Documentation* link, and SEO prerender all pick it up automatically.

**What you get for free** (do not rebuild these): `DocMarkdown` renders GFM + math +
syntax-highlighted code with copy buttons and heading anchors; `DocsLayout` is the
3-pane shell (sidebar + content + TOC + search + mobile drawer); every page is
prerendered to static HTML with `TechArticle` JSON-LD and added to `sitemap.xml`.

**Authoring rules:** source from the product's **real repo** (README/CLAUDE/`docs/` +
command sources) — never invent features. Keep headings plain text (the TOC slugifies
them). Cross-link pages with `/docs/<slug>/<page>`. Curate to a comprehensive set
(agent-cli = ~20), not padding — cut internal dev logs and empty topics.

**⚠️ Gotcha — markdown inside `.ts` template literals:** every backtick in a body
(code fences, inline code) MUST be escaped as `` \` `` (single backslash + backtick).
Writing `` \\\` `` (double) breaks the template literal. If it slips in, byte-replace
`\x5c\x5c\x60` → `\x5c\x60` with Python. Keep `<placeholders>` inside code spans
(`rehype-raw` treats bare `<x>` as HTML). Run `npm run build` — it compiles the module
and will fail loudly on a stray backtick.

Other products currently show a **"coming soon"** card on the `/docs` hub until their
module is authored (`DocsHome.tsx` `COMING_SOON`).

---

## 8. CI/CD — how a page stays in sync

Two independent flows (this separation is the whole point):

**8.1 Release flow (automatic, NO platform deploy).** In the product's repo: build →
`xeno-release publish --app <slug> --version X.Y.Z …` → uploads installers + updates
`releases.json`/`version.json` on R2. The live page reads it on load — new version,
download, notes appear instantly. (See `RELEASE-TO-WEBSITE.md`.)

**8.2 Content flow (platform deploy).** Editing a content module / mockup / asset
needs a rebuild. **Current reality (org Actions billing down → manual):**

```bash
# from xeno-platform, on branch landing-redesign-v3
npm run build                      # vite + prerender — MUST be clean first
git add <changed files> && git commit -m "…"
git archive --format=tar HEAD <files> | ssh xeno-platform-001 \
  "cd /mnt/projects/xeno-platform && sudo tar xf - --overwrite \
   && find <text files> -exec sudo sed -i 's/\r$//' {} +  \  # normalize CRLF; NEVER sed binaries
   && sudo docker compose build frontend && sudo docker compose up -d frontend"
# verify: curl -sI https://xenostudio.ai/product/<slug>  → 200
```

Build-before-swap (the old container stays if the build fails); rollback images are
tagged `:rollback`. Verify each deploy with a headless screenshot (see §9).

**8.3 Responsibilities:** product repo owns the catalog entry + releases + accurate
design input; platform owns the content module + mockups + template + prerender + deploy.

---

## 9. Build the NEXT product page — step by step

1. **Catalog** (`src/lib/productCatalog.ts`): entry exists and is correct
   (`status: shipping|beta`, `delivery`, `repo`, `launchPath`/`install`).
2. **Release data** (desktop/cli): `releases.json` + `version.json` on R2 (via
   `xeno-release`); `/product/<slug>/download/<os>` 302s to a real installer.
3. **Mockups**: build 1 hero + 1–2 gallery mockups in `components/product/mockups/`
   from the real app UI (§4), accent-aware, register them in `index.tsx`.
4. **Content module**: author `src/content/products/<slug>.ts` from the real repo —
   hero (mockup media + note), trust, highlights, ≥3 features, gallery, use-cases,
   how-it-works, comparison (honest), specs, faq, seo. Register in `index.ts`.
5. **Docs** (`src/content/docs/<slug>.ts` + register in `index.ts`, §7.5): author a
   comprehensive doc set from the product's real repo. Sidebar / TOC / search / SEO /
   the landing's *Documentation* link all come free. Skip only for products with no
   docs yet (they show a "coming soon" card on the hub).
6. **Build clean** (`npm run build`) — fix TS/lint; confirm prerender emits the landing
   with correct `<head>` from `seo`, and the doc pages under `dist/docs/<slug>/`.
7. **Deploy** (§8.2) and **verify visually**: headless-screenshot the hero + scroll
   the page (below), check the download/launch CTA, toggle Shift+T through all accents,
   and open `/docs/<slug>` (sidebar + a page render + prev/next). Fix imbalances
   (equal-height gallery, hero spacing, peeking highlights).
8. **Product-grade** = the landing reads like a real product page (the §6 bar) **and**
   the docs are live and cross-linked from the landing.

**Screenshot-verify** (no Chrome extension needed):
```bash
edge --headless --window-size=1600,1000 --virtual-time-budget=10000 \
  --screenshot=out.png "https://xenostudio.ai/product/<slug>?accent=amber"
# tall page: --window-size=1400,10000 then `magick out.png -crop WxH+X+Y +repage crop.png`
```

---

## 10. Rollout plan

| Phase | Products | Status / notes |
|---|---|---|
| **P0 — Reference** | **Comms** | ✅ **Done & landing-complete.** Template, schema, mockup system, accent themes, design standards all built against it. Copy it. |
| **P1 — Shipping flagships** | Hub, Image, Video, Audio | Next. Hub = desktop mockup; the web apps = "Launch" CTA + easy real screenshots. Aim for the §6 Cursor/Devin bar from the start. |
| **P2 — Creative betas** | Pixel, Motion, Sound, 3D-Gen | Reuse the template + comparison tables (vs Photoshop / Premiere / Audition …). |
| **P3 — Dev & agents** | Agent-CLI, SDK, RT, Anima, Extension | Code/terminal-forward mockups. **Anima needs a catalog fix** — it's still `slug: 'swarm'`; repoint to `anima`/`xeno-anima`. |
| **—** | Everything `coming-soon` | Lean waitlist page; promote when they ship. |

---

## 11. Canonical reference files (read these)

| Concern | File |
|---|---|
| Rich template | `src/pages/ProductLanding.tsx` |
| Dispatcher / lean fallback | `src/pages/ProductPage.tsx` |
| Schema | `src/content/products/_types.ts` |
| Registry | `src/content/products/index.ts` |
| **Reference content module** | `src/content/products/comms.ts` |
| Mockups + registry | `src/components/product/mockups/{CommsChat,CommsAgentActions,CommsMobile,index}.tsx` |
| Accent vars / classes / keyframes | `src/index.css` (`--acc`, `.acc-*`, `[data-accent]`, `@keyframes accRise/accSlideOut`) |
| Design-system primitives | `src/components/landing-v3/primitives.tsx` (`Reveal`, `Eyebrow`, `SectionHeading`, `T`) |
| Prerender / SEO (landing **+ docs**) | `scripts/prerender-products.mjs` |
| **Docs system** (model + registry) | `src/content/docs/{_types,index}.ts` |
| **Reference docs module** | `src/content/docs/agent-cli.ts` |
| Docs renderer + 3-pane layout | `src/components/docs/{DocMarkdown,DocsLayout,DocsSidebar,TableOfContents,DocsSearch,toc}` |
| Docs pages (hub + product) | `src/pages/{DocsHome,ProductDocs}.tsx` |
| Release → site | `RELEASE-TO-WEBSITE.md`, `PRODUCT-PAGES-SPEC.md` |

---

*v2.1 — the template, accent system, **and unified docs system** are built.
**comms** is the landing contract; **agent-cli** is the docs contract. Build the next
product's full surface (landing + docs) by following §9.*
