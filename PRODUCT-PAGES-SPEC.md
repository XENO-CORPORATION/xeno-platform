# XENO Product Pages — SPEC (Platform-Level, MANDATORY)

> **Status:** 🔒 Locked v1.0 — 2026-06-27
> **Owner:** xeno-platform (xenostudio.ai)
> **Scope:** The single, mandatory standard for how **every XENO product** is
> presented on xenostudio.ai — its product page, download page, release history,
> stable download links, and the release-data contract products publish to R2.
> Every product (Hub, Pixel, Motion, Sound, Canvas, Docs, Comms, Post, Agent-CLI,
> …) is presented through this system. Products do **not** ship bespoke pages;
> they publish data to the contract below and the platform renders them.

This document is the source of truth. If code and this spec disagree, the code is
wrong. Changes require editing this spec first (and bumping its version).

---

## 0. Why this exists

Today xenostudio.ai has **two parallel, conflicting** product-page systems:

1. **New** — a registry-driven React SPA (`src/lib/productCatalog.ts` +
   `ProductPage`/`ProductReleases`/`ProductReleaseDetail`) at **singular**
   `/product/:slug`. It reads `releases.json` from R2 — **which is never
   published**, so the pages render empty.
2. **Old** — hand/script-generated **static HTML** under `public/products/:slug/`
   (**plural**), reading `version.json` from R2. It has data and SEO, and is what
   actually serves content today.

No redirects connect them; `version.json` (old) and `releases.json` (new) were
never reconciled; the release pipeline only ever writes `version.json`. This spec
ends the duplication: **singular `/product/:slug` is canonical**, `releases.json`
becomes the canonical data (with `version.json` retained as a derived pointer),
and the legacy plural pages are redirected and retired.

---

## 1. Locked decisions (non-negotiable without amending this spec)

| # | Decision |
|---|----------|
| **D1** | **Canonical URL space is singular `/product/:slug`.** The plural `/products/:slug/*` static pages are **deprecated** and **301-redirect** to the canonical pages. The only plural route is `/products` (the index/listing). |
| **D2** | **The product catalog (`src/lib/productCatalog.ts`) is the single source of truth** for product identity, metadata, delivery type, and routing. Adding a product = one catalog entry + its R2 data. No per-product page code. |
| **D3** | **Canonical release data is `releases.json`** (full history array) at `https://updates.xenostudio.ai/apps/:slug/releases.json`. `version.json` is **retained** as a derived "latest stable" pointer (Hub auto-update + fast latest lookups) and MUST equal the latest stable entry in `releases.json`. **Both are published together, every release.** |
| **D4** | **Product pages are SEO-correct via build-time prerendering** of the canonical routes (static HTML emitted per product/release from the catalog). The legacy `public/products/` generator (`add-seo-to-products.js`) is retired once prerender ships. |
| **D5** | **Stable download links are backend 302 redirects** (`/product/:slug/download/:os`) that resolve the current asset from R2 at request time — the link never changes as versions bump. |
| **D6** | `releases.json` carries the **full version history** (newest-first). The product page shows the latest + a few recent; `/releases` shows all. |
| **D7** | **One slug, everywhere.** The catalog `slug` is the URL segment, the R2 folder id, and the product key across Hub, website, and the release pipeline. No aliases except an explicit `r2` override for legacy R2 folders. |

---

## 2. Canonical URL scheme

| URL | Page / behavior | Render |
|-----|-----------------|--------|
| `/products` | **Index** — all products as a grid, grouped by category, with status badges. | Prerendered SPA |
| `/product/:slug` | **Product page** — hero, tagline, features, screenshots, latest version + date, primary CTA (Download / Launch / Install), recent releases (last 3–5). | Prerendered SPA |
| `/product/:slug/download` | **Download page** — every OS, every channel (stable/beta), file sizes, checksums, install/auto-update notes, system requirements. | Prerendered SPA |
| `/product/:slug/releases` | **Release history** — the full changelog feed (newest-first), each entry expandable with notes + per-OS download links. | Prerendered SPA |
| `/product/:slug/releases/:version` | **Single release** — one version's notes, type/channel/severity, and downloads. Canonical permalink for "what changed in X.Y.Z". | Prerendered SPA |
| `/product/:slug/docs` | **Docs** — optional. Renders product docs or 302s to the product's docs home if external. | Prerendered SPA / redirect |
| `/product/:slug/privacy` | **Product privacy policy** — optional, present when the content module authors `privacy`. Covers what THAT product does with your data, which for products that read user content (the browser extension) is materially more than the platform policy at `/privacy`. Required by app/web-store submissions, which link this URL. No authored policy → redirect to `/privacy`. | Prerendered SPA / redirect |
| `/product/:slug/download/:os` | **Stable installer redirect** — 302 to the current latest-stable asset on R2. (See §4.) | Backend 302 |
| `/product/:slug/download/:os/:version` | **Pinned installer redirect** — 302 to that version's asset on R2. | Backend 302 |

`:slug` ∈ catalog slugs. `:os` ∈ `win` \| `mac` \| `linux` (aliases `windows`,
`macos`, `osx`, `appimage` normalized). `:version` is a semver string (no `v`
prefix; `v` accepted and stripped).

**Unknown `:slug`** → 404 product page (not a silent redirect to `/`).
**Known slug, missing release data** → page renders with an honest "no public
releases yet" state, never a blank/broken page.

---

## 3. Page specifications

### 3.1 Index — `/products`
- Pull all entries from the catalog. Group by `category`. Sort within a group by a
  `weight` field (optional; falls back to catalog order).
- Each card: name, tagline, status badge (`shipping` / `beta` / `coming-soon`),
  delivery glyph (`web` / `desktop` / `cli`), link to `/product/:slug`.
- `coming-soon` cards are non-interactive (no dead download links).

### 3.2 Product page — `/product/:slug`
- **Hero:** name, tagline, primary CTA by `delivery`:
  - `desktop` → **Download** → `/product/:slug/download`
  - `web` → **Launch** → `launchPath` (e.g. `/auth/:slug`)
  - `cli` → **Install** → copyable `install` command
  - `soon` → disabled "Coming soon"
- **Latest:** version + date from `releases.json[0]` (or `version.json`).
- **Recent releases:** last 3–5 entries, each linking to `/product/:slug/releases/:version`. "View all" → `/product/:slug/releases`.
- Features/screenshots: optional catalog-supplied content blocks.

### 3.3 Download page — `/product/:slug/download`
- For the **latest stable** release: one row per OS with **direct, human-clickable**
  buttons that hit the stable redirect endpoints (`/product/:slug/download/:os`),
  plus file label, size, and SHA-256 (from the asset record).
- **Channels:** if a `beta` channel release is newer, show a secondary "Beta" block.
- **Auto-update note:** desktop products state how updates are delivered (Hub /
  in-app updater reads `version.json`).
- **System requirements** and **previous versions** link (`/product/:slug/releases`).

### 3.4 Release history — `/product/:slug/releases`
- Full `releases.json`, newest-first. Each row: version, date, type badge
  (`release`/`patch`/`hotfix`), channel, severity (critical → highlighted), title,
  expandable notes (Markdown), per-OS downloads. Permalink anchor per version.

### 3.5 Single release — `/product/:slug/releases/:version`
- One entry. Full notes (Markdown), all assets per OS with size + checksum.
- Canonical, shareable permalink (this is the link release announcements use).
- If `:version` not found → 404 with a link to `/product/:slug/releases`.

---

## 4. Stable download links (backend 302)

These give every product **permanent, shareable** download URLs that always point
at the right current file — independent of the version number.

```
GET /product/:slug/download/:os            → 302  latest STABLE asset for :os
GET /product/:slug/download/:os/:version   → 302  that version's asset for :os
GET /product/:slug/download/:os?channel=beta → 302 latest BETA asset for :os
```

**Resolution algorithm (backend):**
1. Normalize `:os` (`windows|win→win`, `macos|osx|mac→mac`, `linux|appimage→linux`).
2. Load `releases.json` for `:slug` (cached, see §9). If absent, fall back to
   `version.json`.
3. Pick the target release: `:version` if given, else newest entry matching the
   requested `channel` (default `stable`).
4. Pick `assets[os][0]` (first asset is the primary installer). Build the R2 URL
   (see §5.3). **302** to it with `Cache-Control: no-store` on the redirect itself.
5. Any miss (no slug / no release / no asset for that OS) → **404 JSON**
   `{ error: { code, message } }`, never a redirect to a wrong file.

**Why backend, not a static file:** the URL must stay constant while the target
changes each release. These endpoints live in the Express backend (`src/server`),
not the SPA.

---

## 5. R2 data contracts

Base: `https://updates.xenostudio.ai` (Cloudflare R2, bucket `xeno-hub-releases`).
Per-product root: `apps/:slug/` (or `apps/:r2/` if the catalog sets `r2`).

```
apps/:slug/
├── releases.json          ← CANONICAL full history (newest-first)
├── version.json           ← derived "latest stable" pointer (Hub auto-update)
├── v{X.Y.Z}/
│   ├── {Installer}.exe
│   ├── {Installer}.dmg
│   └── {Installer}.AppImage
└── assets/                ← optional: icons, screenshots referenced by catalog
```

### 5.1 `releases.json` (canonical)
A JSON **array**, newest-first. (A wrapper object `{ "releases": [...] }` is also
accepted by readers for forward-compat, but writers MUST emit a bare array.)

```jsonc
[
  {
    "version": "0.5.1",                 // semver, no leading "v"  (required)
    "date": "2026-06-20",               // ISO date YYYY-MM-DD     (required)
    "latest": true,                     // exactly one stable entry true (optional; derived if absent)
    "type": "patch",                    // "release" | "patch" | "hotfix"  (default "release")
    "channel": "stable",                // "stable" | "beta"               (default "stable")
    "severity": "normal",               // "normal" | "critical"           (default "normal")
    "title": "Context-menu auto-install", // short headline (optional)
    "notes": "## What's new\n- ...",    // Markdown (required, may be short)
    "assets": {                          // at least one OS for downloadable products
      "windows": [
        { "label": "Installer (x64)", "file": "v0.5.1/XENO-HUB Setup 0.5.1.exe",
          "size": 78123456, "sha256": "…" }
      ],
      "mac":   [ { "label": "Apple Silicon", "file": "v0.5.1/XENO-Hub-0.5.1-arm64.dmg", "size": 0, "sha256": "" } ],
      "linux": [ { "label": "AppImage", "file": "v0.5.1/XENO-Hub-0.5.1.AppImage", "size": 0, "sha256": "" } ]
    },
    "minOS": { "windows": "10", "mac": "12.0", "linux": "" }  // optional
  }
]
```

Rules:
- **`file` is a path relative to `apps/:slug/`** (e.g. `v0.5.1/Setup.exe`), never an
  absolute URL. Readers build the absolute URL (§5.3). This keeps the data
  CDN/host-agnostic.
- `size` in bytes, `sha256` lowercase hex. Empty (`0` / `""`) allowed but
  discouraged; the download page shows them when present.
- `assets` omitted entirely ⇒ a non-downloadable product (web/cli) — that's valid.

### 5.2 `version.json` (derived pointer — retained for Hub auto-update)
MUST equal the latest **stable** entry of `releases.json`, flattened to the legacy
shape Hub already reads:

```jsonc
{
  "version": "0.5.1",
  "date": "2026-06-20",
  "windows": "XENO-HUB Setup 0.5.1.exe",   // FILENAME only (Hub joins v{ver}/ itself)
  "mac": "XENO-Hub-0.5.1-arm64.dmg",
  "linux": "XENO-Hub-0.5.1.AppImage",
  "notes": "Context-menu auto-install"
}
```

> ⚠️ **Compat:** Hub's existing updater constructs `…/apps/:slug/v{version}/{windows}`.
> Do not break this shape. `version.json` stays. `releases.json` is additive.

### 5.3 Absolute URL construction (readers)
```
fileUrl(slug, release.assets[os][i].file) =
  `${R2_BASE}/apps/${r2 ?? slug}/${file}`
```
The website (`productCatalog.ts`) and the backend redirect endpoint MUST use this
single helper. No other URL shapes.

---

## 6. The product catalog (registry)

`src/lib/productCatalog.ts` — the **single source of truth**. One entry per product.

```ts
export interface Product {
  slug: string;            // URL segment + R2 folder + product key (LOCKED, stable)
  name: string;            // "XENO Hub"
  tagline: string;         // one-liner
  category: string;        // index grouping: Platform | Create | Generate | Agent | Office | …
  status: 'shipping' | 'beta' | 'coming-soon';
  delivery: 'web' | 'desktop' | 'cli' | 'soon';
  weight?: number;         // index sort within category (lower = first)
  r2?: string;             // R2 folder override (legacy only)
  launchPath?: string;     // delivery:web — in-app destination (e.g. '/auth/hub')
  install?: string;        // delivery:cli — install command
  repo?: string;           // GitHub repo (e.g. 'xeno-hub')
  docsUrl?: string;        // /product/:slug/docs target (internal path or external URL)
  hero?: { features?: string[]; screenshots?: string[] }; // optional content blocks
}
```

**Adding a product = one entry here + publishing its R2 data (§7).** Nothing else.

---

## 7. Release publishing pipeline (the missing half — now mandatory)

Every product's release process MUST, on each release, publish to R2:

1. **Upload installers** to `apps/:slug/v{X.Y.Z}/`.
2. **Prepend** the new release object to `apps/:slug/releases.json` (create if absent).
3. **Regenerate** `apps/:slug/version.json` from the latest **stable** entry.
4. Invalidate/avoid CDN cache for the two JSON files (they are `Cache-Control:
   no-cache`; installers are immutable, long-cache).

This is provided as a shared, idempotent publisher so products don't hand-roll it:

```
xeno-release publish \
  --app hub --version 0.5.1 --date 2026-06-20 \
  --channel stable --type patch \
  --notes-file CHANGELOG-0.5.1.md \
  --win  "release/XENO-HUB Setup 0.5.1.exe" \
  --mac  "release/XENO-Hub-0.5.1-arm64.dmg" \
  --linux "release/XENO-Hub-0.5.1.AppImage"
```

The publisher: computes sizes + SHA-256, uploads to `apps/hub/v0.5.1/`, prepends to
`releases.json`, rewrites `version.json`, and (D4) triggers a product-pages
prerender + deploy. **A release is not complete until `releases.json` and
`version.json` are both updated** — this is the CLAUDE.md "release is not complete
until the website reflects the new version" rule, made concrete.

> The publisher's exact home (a script in xeno-platform `scripts/` and/or a reusable
> GitHub Action) is defined in §12. Until it exists, products may publish by hand
> following §5 — but the JSON shapes here are mandatory.

---

## 8. SEO & rendering (D4)

Client-only React renders blank HTML to crawlers; the legacy static pages existed
purely to fix that. We replace them with **build-time prerendering of the canonical
routes**:

- At build, emit static HTML for `/products`, every `/product/:slug`, every
  `/product/:slug/download`, `/product/:slug/releases`, and one
  `/product/:slug/releases/:version` per known release (from the catalog + the R2
  `releases.json` fetched at build time). The SPA hydrates these for interactivity.
- Each prerendered page MUST include: a correct `<title>`, meta description,
  `<link rel="canonical">` to the **singular** URL, Open Graph + Twitter Card, and
  schema.org `SoftwareApplication` structured data (operatingSystem, applicationCategory,
  softwareVersion, downloadUrl, offers).
- **Per-product overrides:** if a product has a landing content module
  (`src/content/products/<slug>.ts` — see `PRODUCT-LANDING-SPEC.md`), its
  `seo{ title, description }` **overrides** the catalog-derived `<title>`/description
  at prerender time. `scripts/prerender-products.mjs` esbuild-compiles the content
  registry alongside the catalog and calls `getProductContent(slug)`; falls back to
  the catalog tagline when absent.
- Emit `/sitemap.xml` covering all canonical product URLs and `/robots.txt`
  allowing them.
- **Retire** `public/products/` and `scripts/add-seo-to-products.js` once prerender
  is live and the §10 redirects are in place.

---

## 9. Caching & performance

| Resource | Cache policy |
|----------|--------------|
| `releases.json`, `version.json` | `Cache-Control: no-cache` (always revalidate); backend may memo-cache **30 s** in-process. |
| Installers `v{ver}/*` | Immutable, `Cache-Control: public, max-age=31536000, immutable`. |
| Prerendered product HTML | Short CDN cache (e.g. 5 min) + revalidate; rebuilt on release. |
| `/product/:slug/download/:os` 302 | `Cache-Control: no-store` (never cache the redirect target). |

The backend keeps a 30-second in-process cache of each `releases.json` to absorb
download-link traffic without hammering R2; a release publish may bust it via a
lightweight cache-bust ping (optional).

---

## 10. Legacy redirects (retire the duplication)

Implemented in **nginx** (static path rules) — see `nginx/default.conf`:

| From (legacy) | To (canonical) | Code |
|---------------|----------------|------|
| `/products` (exact) | *(keep — this is the new index)* | — |
| `/products/:slug` | `/product/:slug` | 301 |
| `/products/:slug/download` | `/product/:slug/download` | 301 |
| `/products/:slug/release-notes` | `/product/:slug/releases` | 301 |
| `/products/:slug/release-notes/:version` | `/product/:slug/releases/:version` | 301 |
| `/products/:slug/docs` *(+ subpaths)* | `/product/:slug/docs` | 301 |
| `/download` | `/product/hub/download` | 301 |
| `/releases/:version` | `/product/hub/releases/:version` | 301 |
| `/product/extension/download` | `/product/extension/download` *(keep; already canonical)* | — |

Redirects MUST preserve query strings. The SPA fallback (`try_files $uri $uri/
/index.html`) stays for canonical client routes.

---

## 11. Routing ownership (where each rule lives)

| Concern | Lives in |
|---------|----------|
| Canonical SPA routes (`/products`, `/product/:slug…`) | `src/App.tsx` (React Router) |
| Page rendering + catalog/R2 reads | `src/pages/Product*.tsx`, `src/lib/productCatalog.ts`, `src/components/product/*` |
| Stable download 302s (`/product/:slug/download/:os[/:version]`) | `src/server/routes/downloadRoutes.js` (Express) |
| Legacy 301 redirects | `nginx/default.conf` |
| Prerender + sitemap | build step (`scripts/prerender-products.*`) wired into `npm run build` |
| Release publishing | `xeno-release` publisher (§7, §12) |

> The Express download route must be registered **before** the SPA fallback so
> `/product/:slug/download/:os` is handled by the backend, while
> `/product/:slug/download` (the page) falls through to the SPA. nginx routes
> `/product/*/download/*` (with an OS segment) to the backend; the bare
> `/product/:slug/download` to the SPA.

---

## 12. Per-product integration contract (what products MUST provide)

For a product to appear correctly on xenostudio.ai, the **product's repo** is
responsible for:

1. **Catalog entry** — add/maintain its `Product` entry in
   `xeno-platform/src/lib/productCatalog.ts` (slug is LOCKED once shipped).
2. **R2 data per release** — publish `apps/:slug/releases.json` (full history) +
   `version.json` (derived) + installers under `v{X.Y.Z}/`, in the exact shapes of
   §5, using the `xeno-release` publisher (§7).
3. **Notes** — supply Markdown release notes per version (`notes`), and a `title`.
4. **Assets** — primary installer first in each OS array; include `size` + `sha256`.
5. **Web products** — set `delivery:'web'` + `launchPath`; no installers needed.
6. **CLI products** — set `delivery:'cli'` + `install`; `releases.json` optional
   (used for changelog only).

A product is **"product-pages compliant"** when: its catalog entry exists, `/product/:slug`
renders with a latest version, `/product/:slug/download/:os` 302s to a working
installer, and `/product/:slug/releases/:version` resolves for its latest release.

**Reference this spec** from the product's own CLAUDE.md/release docs:
> "Product pages, downloads, and release feeds follow
> `xeno-platform/PRODUCT-PAGES-SPEC.md`. Publish `releases.json` + `version.json`
> via `xeno-release publish`."

---

## 13. Implementation roadmap (build order)

1. **Unblock the canonical pages** — write `releases.json` for every shipping
   product to R2 (seed from existing `version.json` + known history). Pages light up.
2. **Backend download deep-links** — `downloadRoutes.js`: `/product/:slug/download/:os[/:version]`
   resolution + 302 (§4), registered before the SPA fallback; nginx routes the OS
   subpath to the backend.
3. **Legacy 301s** — add the §10 rules to `nginx/default.conf`.
4. **Download page** — build `/product/:slug/download` (the SPA page, §3.3) with
   sizes/checksums/channels and buttons hitting the deep-links.
5. **The publisher** — ship `xeno-release publish` (§7): sizes+sha256, upload,
   prepend `releases.json`, regenerate `version.json`, prerender+deploy. Wire into
   the release pipeline; update CLAUDE.md release steps to call it.
6. **Prerender + SEO** — prerender canonical routes, emit sitemap, structured data.
7. **Retire legacy** — delete `public/products/` + `add-seo-to-products.js` once 3 &
   6 are verified live. Confirm all old URLs 301 correctly.

Each step is independently shippable and leaves the site working.

---

## 14. Acceptance criteria (Definition of Done)

- [ ] `/product/:slug`, `/download`, `/releases`, `/releases/:version` render real
      data for every `shipping` product, driven only by the catalog + `releases.json`.
- [ ] `/product/:slug/download/win|mac|linux` 302s to a working installer; pinned
      `/…/:version` works; misses return 404 JSON, never a wrong file.
- [ ] `releases.json` **and** `version.json` are published together on every release;
      Hub auto-update still works unchanged.
- [ ] All legacy `/products/*`, `/download`, `/releases/*` URLs 301 to canonical,
      preserving query strings.
- [ ] Canonical pages are prerendered with correct title/canonical/OG/structured
      data; `/sitemap.xml` lists them.
- [ ] `public/products/` and `add-seo-to-products.js` removed; no dead links.
- [ ] A new product can be launched by adding one catalog entry + running
      `xeno-release publish`, with **no** platform code changes.

---

## 15. Appendix — examples

**Catalog entry (desktop):**
```ts
{ slug: 'hub', name: 'XENO Hub', tagline: 'The desktop launcher for the XENO ecosystem.',
  category: 'Platform', status: 'shipping', delivery: 'desktop', repo: 'xeno-hub' }
```

**Stable links for Hub (never change across versions):**
```
https://xenostudio.ai/product/hub/download/win     → 302 …/apps/hub/v0.5.1/XENO-HUB Setup 0.5.1.exe
https://xenostudio.ai/product/hub/download/mac      → 302 …/apps/hub/v0.5.1/XENO-Hub-0.5.1-arm64.dmg
https://xenostudio.ai/product/hub/releases/0.5.1    → release detail page (permalink)
```

**Legacy → canonical:**
```
https://xenostudio.ai/products/hub/                  → 301 /product/hub
https://xenostudio.ai/products/hub/download          → 301 /product/hub/download
https://xenostudio.ai/products/hub/release-notes     → 301 /product/hub/releases
```

---

*End of SPEC v1.0. Amendments bump the version and update §1 if a locked decision changes.*
