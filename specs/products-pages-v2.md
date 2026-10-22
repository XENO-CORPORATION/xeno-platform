# Products pages v2 — owner's XO PRODUCTS handoff (2026-10-22)

Objective: every product page on xenosystem.ai renders the owner's design from
`XO - PRODUCTS.zip` (48 `.dc.html` files), end to end, at its existing address,
with the site's gate, lockdown and download routes unchanged.

## Evidence (KNOWN)

- Designs are runnable dc prototypes on the same runtime as Home v21
  (zip `support.js`, 69,150 bytes; `window.claude` calls: 0 — demos are local).
- Catalog has 38 slugs (`src/lib/productCatalog.ts`). 33 have a design file;
  `sdk`, `acp`, `research`, `use`, `audio` have none.
- 12 designs name things the catalog does not carry: Developers, Company,
  Corpus, Forum, GameDev, Mail, Marketplace, Meet, Places, Polis, Sites, Spectra.
- Two canvas files exist: `XENO Canvas.dc.html` (193k, product page with
  download link) and `xeno-canvas.dc.html` (58k, engine-story page).
- References to normalize: `./support.js` (48), `assets/xeno-mark.svg` (97),
  `https://xenostudio.ai` (51), `https://xenostudio.ai/login` (2),
  `https://xenostudio.ai/product(s)/…` (links), `<Name>.dc.html` cross-links,
  `./image-slot.js` (Pixel, Sites). Real R2/npm/GitHub links stay untouched.
- Product subroutes `/product/<slug>/download|releases|docs|privacy` are React
  routes today and must keep working; only the bare `/product/<slug>` changes.
- Prerender (`scripts/prerender-products.mjs`) writes React product pages to
  `dist/product/<slug>/index.html` on every build.

## Decisions

1. **Fork verbatim, like the homepage.** Each design ships as a static
   document under `public/product-pages/<slug>/index.html`; runtime and assets
   under `public/products-v2/` (runtime patched to vendored React/Babel, no
   CDN). No React transcription of ~45 prototypes.
2. **Addresses.** nginx: exact `/products` → the Products design; bare
   `/product/<slug>` → its design when one exists, else the existing
   prerendered/SPA page. Documents live outside the asset tree so addressing
   one directly still passes the gated `location /`. `/products-v2/` assets
   are `no-cache`, never the 1y immutable rule.
3. **Catalog is not extended.** The 12 non-catalog designs are served at
   `/product/<their slug>` and linked from the Products index, but they do not
   join `productCatalog` (no releases feed, docs or download claims change).
4. **No-design catalog products keep today's page** (`sdk`, `acp`, `research`,
   `use`, `audio`).
5. `XENO Canvas.dc.html` is `canvas`; `xeno-canvas.dc.html` and
   `SuiteLoop.dc.html` (a fragment) are not shipped as pages.
6. **In-app navigation:** `/products` and design-slug `/product/<slug>` routes
   in the SPA hand the browser to nginx (same pattern as Home v21); other
   slugs render as today. The importer generates the slug list both nginx
   tests and the SPA consume (`src/lib/productDesigns.ts`).
7. Design cross-links (`XENO Form.dc.html` etc.) rewrite to `/product/<slug>`;
   `xenostudio.ai` self-links rewrite to this host's paths (`/` and `/login`);
   `xenostudio.ai/product/<slug>/releases` → `/product/<slug>/releases`.

## Acceptance (all mechanically checked)

- `npm run test:products-v2`: every mapped design doc exists, is the v-design
  (its `data-screen-label`/product prop), references no `.dc.html`, no CDN
  runtime, no `xenostudio.ai` self-link; every image/runtime asset it names
  exists; nginx carries the `/products` + bare-slug rules behind the gate;
  `productDesigns.ts` matches the documents on disk.
- `npm run build` clean; `dist/product-pages/…` present.
- Browser: `/products`, three product pages (canvas, pixel, anima) and one
  no-design page (sdk) render from the local build; design demos run with no
  console errors; `/product/canvas/releases` still reaches the React route.
- Live after deploy: gated body checks on xenosystem.ai + xenostudio.ai;
  signed-out `/products` is Coming Soon; a design asset and the SPA asset
  both carry `X-Robots-Tag`.

## Reconciliation after the falsification pass (2026-10-22)

An independent agent attacked this spec against the repo; findings were
adjudicated before shipping:

- **Fixed (blocker):** the Canvas design linked the raw R2 installer
  (`updates.xenostudio.ai/apps/canvas/v0.41.3/…exe`), bypassing the plan gate
  and pinning a stale version. The importer now rewrites raw installer URLs
  to `/product/<slug>/download/win`, and the gate test forbids them.
- **Already held, now pinned by tests:** the filename→slug table lives in the
  importer (not prose); `sound` has the design, `audio` does not; nginx uses
  `^~` for assets with headers re-declared; documents sit outside the asset
  tree; references are absolutized; the importer copies only named files;
  Google Fonts stay (the owner's standard — "no CDN" covers the JS runtime);
  subdomains (`updates.`, `api.`) are never rewritten.
- **Accepted deviation:** the v2 Products index links exactly its 45 designs,
  so `sdk`, `acp`, `research`, `use`, `audio` lose their index entry. Their
  pages keep working at their addresses. Restoring them means editing the
  owner's index design — owner's call, not made here.
- **Accepted deviation:** design pages carry the design's own status and
  download claims (no catalog experimental/unsigned notice), as with the
  Home v21 fork. The one exception enforced is the download gate itself.

## Shared navigation repair (2026-10-22)

The 46-document browser audit found that every imported header had seven
placeholder links and every phone header clipped controls. Every footer also
used placeholder links. The homepage omitted Marketplace, Solutions, Pricing,
Blog and Forum from its main navigation.

The importers now mount one shared header from `scripts/lib/marketing-header.mjs`,
with shared CSS and event handling in `public/site/marketing-header.*`. It retains
the restored floating Products card and hover bridge, adds Marketplace and
Solutions menus plus Docs/Pricing/Blog/Forum, and uses a phone Menu for secondary
destinations. Solutions links target the existing homepage use-case section and
existing product pages; there is no invented `/solutions` route. Footer links
resolve to existing routes, with Features anchored to the first page section.

Acceptance: `npm run test:marketing-navigation` runs the source checks, homepage
browser regression and all 46 documents at desktop/phone widths. Each page must
support the three dropdowns, keyboard entry/Escape, mobile Menu, and native
destinations without placeholder header/footer links, clipped controls or renderer
exceptions. The frontend CI job runs this command. `/site/` stable assets have
no-cache and the same de-index/security headers as the design runtime assets.

Limit: this pass qualifies shared navigation and page startup. It does not qualify
every page's simulated demo, model/backend integration, or product/version claims.
