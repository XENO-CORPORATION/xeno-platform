# 04 — Build & Deploy (content + docs)

**Purpose:** how to build the xeno-platform frontend (`npm run build` = Vite build + SEO prerender) and ship a **content/docs** change to production via the current manual on-box deploy — because org GitHub Actions billing is down, deploys are done by hand.

---

## What this file covers (and what it doesn't)

This file is for changes to the **compiled/prerendered** layers of a product page:

- **Landing content** — `src/content/products/<slug>.ts`, its mockups under `src/components/product/mockups/`, and raster assets under `public/product-assets/<slug>/`.
- **Documentation** — `src/content/docs/<slug>.ts` (registered in `src/content/docs/index.ts`).
- **Catalog identity** — `src/lib/productCatalog.ts`.

All three are compiled into the SPA bundle and prerendered to static SEO HTML at build time, so a change to any of them **requires a platform rebuild + deploy**. See `05-landing-and-docs.md` for how to author those modules.

**This file does NOT cover release data.** New versions, installers, and download links live in R2 (`apps/<slug>/releases.json` + `version.json`) and are fetched **live** at page load — publishing a release needs **no platform deploy**. That flow (the `xeno-release` publisher, R2, `Cache-Control: no-cache`) is in **`03-release-data.md`**.

> Rule of thumb: **edited a `.ts`/`.tsx`/mockup/asset in this repo → build + deploy (this file).** **Cut a new product version → publish to R2, no deploy (`03-release-data.md`).**

---

## 1. `npm run build` — what it does

From `package.json`:

```
"build": "vite build && node scripts/prerender-products.mjs",
```

Two phases, in order:

1. **`vite build`** — emits the client SPA into `./dist` (including `dist/index.html`, the shell every prerendered page is built from).
2. **`node scripts/prerender-products.mjs`** — the post-build SEO prerender. Runs **against `./dist`** and **fails hard if `dist/index.html` is missing** (`prerender: dist/index.html missing — run 'vite build' first.` → exit 1), so it only ever runs after a successful Vite build.

A prerender-only convenience script also exists: `"build:prerender": "node scripts/prerender-products.mjs"` (useful for iterating on `<head>` output without a full Vite rebuild — but a real deploy always runs the full `npm run build`).

> There is **no** typecheck or lint gate wired into `build`, and `"test"` is a stub (`echo "Error: no test specified" && exit 1`). The build "passing" means Vite compiled the modules (a stray unescaped backtick in a docs `body` template literal, a bad import, etc. will fail here) **and** the prerender completed. Treat a clean `npm run build` as the gate — see §5.

### What the prerender emits

`scripts/prerender-products.mjs` compiles the catalog + content + docs registries on the fly (esbuild → esm → import) and writes one static `index.html` per route into `dist/<routePath>/index.html`, each with a route-correct `<head>` (title, description, canonical, Open Graph, Twitter, schema.org JSON-LD) injected before `</head>`:

- `product/<slug>` — for every catalog product where `status !== 'coming-soon'`. Title/description come from the content module's `seo{}` when present, else the catalog `name`/`tagline`. Includes `SoftwareApplication` JSON-LD.
- `product/<slug>/download` and `product/<slug>/releases` — only when the product's `delivery` is `desktop` or `cli`.
- `docs` — the unified docs hub.
- `docs/<slug>` — per-product docs index, for each documented product.
- `docs/<slug>/<page>` — every flattened doc page (canonical `https://xenostudio.ai/docs/<slug>/<page>`), with `TechArticle`-style head.
- `products` — the `/products` grid index.
- **`dist/sitemap.xml`** — a `<urlset>` of `/` plus every route above, each stamped with today's `<lastmod>`.
- **`dist/robots.txt`** — preserved (or defaulted to `User-agent: *` / `Allow: /`) and appended with `Sitemap: https://xenostudio.ai/sitemap.xml` if no `Sitemap:` line is present.

Constants baked in: `DIST = 'dist'`, `SITE = 'https://xenostudio.ai'`. Final log line: `prerender: wrote <N> product pages + sitemap.xml (<M> urls) + robots.txt`. On any failure it prints `prerender failed:` and exits 1.

If a registry fails to bundle, the prerender falls back to empty getters (`getProductContent: () => undefined`, `allDocRoutes: () => []`, `allDocProducts: () => []`) rather than crashing — so **confirm your new module actually appears in the output** (see §5), don't just trust a zero-exit.

---

## 2. How the frontend is built & served in production

The container build mirrors your local `npm run build`. From `Dockerfile.frontend` (two-stage):

- **Builder** (`node:20-alpine`): `npm ci --legacy-peer-deps`, copies configs + `public/` + `src/` + **`scripts/`** (the prerender step needs it), then `RUN npm run build` → `/app/dist`.
- **Production** (`nginx:alpine`): `COPY --from=builder /app/dist /usr/share/nginx/html`, applies `nginx/default.conf`, serves on `:80`.

`docker-compose.yml` `frontend` service:

- `container_name: xenostudio-frontend`
- `build.context: .`, `dockerfile: Dockerfile.frontend`
- `ports: "127.0.0.1:4040:80"` — nginx :80 published on host loopback :4040, fronted by the host nginx that terminates `xenostudio.ai`.
- `restart: unless-stopped`, depends on a healthy backend.

The consequence for deploying: **you do not copy `dist/` to the box.** You ship the changed **source** to the box and rebuild the `frontend` image there (`docker compose build frontend`), which re-runs `npm run build` inside the builder stage. Your local `npm run build` is the **pre-flight correctness check**, not the artifact you deploy.

---

## 3. The manual on-box deploy pipeline

> **Current reality:** org GitHub Actions billing is down, so this content deploy is **manual**. When CI is restored this becomes a workflow; until then, run it by hand from your workstation.

Fixed infrastructure values (do not substitute — these are the real ones):

| Thing | Value |
|---|---|
| SSH host alias | `xeno-platform-001` |
| Box path (the `cd` target) | `/mnt/projects/xeno-platform` |
| Compose service | `frontend` |
| Container name | `xenostudio-frontend` |
| Live site | `https://xenostudio.ai` |
| Docker on the box | requires **`sudo`** |
| Branch | `landing-redesign-v3` (confirm the active branch in your repo) |

### Step 3.1 — Build clean, locally

```bash
# from the xeno-platform repo root, on your working branch
npm run build          # vite build + prerender — MUST be clean before you go further
```

Do not proceed on a red build. See §5 for what "clean" means to verify.

### Step 3.2 — Commit the change (REQUIRED before deploy)

```bash
git add <changed files>
git commit -m "…"
```

**This is load-bearing: the deploy streams files with `git archive HEAD …`, which reads only what is committed.** Uncommitted or unstaged edits are invisible to the deploy and will silently NOT ship. Commit first, every time.

### Step 3.3 — Ship it (build-before-swap)

The transfer streams the committed files over SSH, unpacks them on the box, normalizes line endings on **text files only**, then rebuilds and swaps the container:

```bash
git archive --format=tar HEAD <files> | ssh xeno-platform-001 \
  "cd /mnt/projects/xeno-platform && sudo tar xf - --overwrite \
   && find <text files> -exec sudo sed -i 's/\r$//' {} +  \  # normalize CRLF; NEVER sed binaries
   && sudo docker compose build frontend && sudo docker compose up -d frontend"
```

What each piece does:

- `git archive --format=tar HEAD <files>` — packs the **committed** version of the listed paths into a tar stream. Scope `<files>` to what you changed (e.g. `src/content/products/<slug>.ts src/content/products/index.ts src/components/product/mockups/…`).
- `sudo tar xf - --overwrite` — unpacks onto the box at `/mnt/projects/xeno-platform`, replacing existing files. Docker/root-owned files on the box require `sudo`.
- `find <text files> -exec sudo sed -i 's/\r$//' {} +` — strips Windows CR from **text sources only** (this repo is developed on win32, so files arrive with CRLF). **See §4 — this must never touch binaries.**
- `sudo docker compose build frontend` — builds the new image, which re-runs `npm run build` (Vite + prerender) inside the builder stage. **Build-before-swap:** the currently running `xenostudio-frontend` keeps serving throughout this build. If the build fails, nothing is swapped and the old container stays live.
- `sudo docker compose up -d frontend` — swaps in the freshly built image only after a successful build.

### 3.1 🔴 Then SMOKE IT — the deploy is not finished when the container starts

A container that starts is not a deploy that worked. Build-before-swap protects you from a
build that FAILS; it does nothing about a build that SUCCEEDS and ships broken code, which is
the more common outcome because the compiler had no opinion about it.

```bash
npm run smoke:forum          # or the smoke for whatever surface you touched
```

**This is not optional and it is not a formality.** On 2026-08-16 a search change renamed a
CTE column and updated every reference inside the block that was rewritten. One reference sat
forty lines outside it. The build succeeded, the container started healthy, and every search
on the site answered `column tsq.q does not exist` — live search went from finding 2 of 6
realistic phrasings to finding 0. Nothing in the unit suite could have caught it: those gates
read source for structure, and a stale column name is a RUNTIME error.

Worse, the pre-deploy verification had passed. It ran the rewritten query as a **standalone
fragment**, which never contained the projection that broke. **A fragment cannot fail on a
reference it does not contain** — so a green pre-deploy check is not evidence the deployed
thing works.

What the smoke must assert, and why each half matters:

| check | why "not 200" is not enough |
|---|---|
| a known query returns RESULTS | a broken query can parse, match nothing, and answer `200 []` — which looks perfectly healthy |
| gated routes return **401 specifically** | 401 = mounted and refused; 500 = mounted and broken. Both are "not 200", and only one is correct |
| the envelope, not just the status | this API answers some errors `200 {success:false}` |

⚠️ **An SPA answers 200 for paths that do not exist**, so a status-code check against a
frontend route proves nothing at all — verify by BODY. Already documented for the extension
privacy page; it recurs because a 200 feels like an answer.

If the smoke fails, the site is currently serving the broken build. There is no automatic
rollback: fix forward or redeploy the previous commit, and do it before anything else.

> ⚠️ **"Build-before-swap" protects the BUILD, not the SWAP.** `up -d frontend` also brings up
> whatever `frontend` depends on, then waits for it to report healthy. If that wait times out,
> compose aborts — **after the old frontend is already gone**. This happened on 2026-08-14: the
> command restarted `backend`, gave up with `dependency failed to start: container
> xenostudio-backend is unhealthy`, and left `xenostudio-frontend` in state `Created`. The site
> served **502 for ~12 minutes**, and `docker ps` showed no frontend at all — you have to run
> `docker ps -a` to even see it existed.
>
> The recovery is a plain re-run of `sudo docker compose up -d frontend` once the dependency is
> healthy, which is exactly why it is easy to miss: nothing is broken, the deploy just stopped
> half-way and the gap stays open until somebody looks.
>
> **So a deploy is not finished when the command exits 0.** Always finish with:
>
> ```bash
> sudo docker ps --filter name=xenostudio-frontend --format '{{.Status}}'   # expect: Up …
> curl -s -o /dev/null -w '%{http_code}\n' https://xenostudio.ai/           # expect: 200
> ```
>
> This matters more when the build runs detached (see §3.5): the *launcher* exits 0 while the
> real work continues, so its exit code says nothing at all about the outcome.

### Step 3.5 — Long builds: run detached, then poll

The Vite build on the box takes well over 10 minutes, which outruns some SSH/tool timeouts. If
the connection dies mid-build the remote command dies with it, leaving the deploy half-applied.
Run it detached and poll for a completion marker instead:

```bash
ssh xeno-platform-001 "cd /mnt/projects/xeno-platform && sudo rm -f /tmp/xeno-deploy.log && \
  sudo setsid nohup bash -c 'docker compose build frontend && docker compose up -d frontend \
  && echo XENO_DEPLOY_DONE' > /tmp/xeno-deploy.log 2>&1 < /dev/null & echo LAUNCHED"

# then poll — and treat the ABSENCE of the marker as failure, not as "still going"
ssh xeno-platform-001 "sudo grep -c XENO_DEPLOY_DONE /tmp/xeno-deploy.log; sudo tail -3 /tmp/xeno-deploy.log"
```

Then run the two verification commands above. The marker only proves the compose command
finished; only the HTTP check proves the site is serving.

### Step 3.4 — Purging a stale `dist` (operator override)

If a cached Docker layer is serving stale output (e.g. an asset changed but the build reused a cached `dist`), force a clean rebuild:

```bash
sudo docker compose build --no-cache frontend && sudo docker compose up -d frontend
```

> Note: `--no-cache` here is a **Docker build flag** and is an operator technique — it is **not** part of the spec's §8.2 command block (the spec's build step is plain `sudo docker compose build frontend`). Do not confuse it with the R2 `Cache-Control: no-cache` header on `releases.json`/`version.json`, which is an unrelated CDN-caching concern covered in `03-release-data.md`. Reach for `--no-cache` only when you suspect a stale cached layer.

---

## 4. ⚠️ CRLF normalization: TEXT files ONLY, never binaries

The repo is edited on Windows, so files land on the Linux box with CRLF line endings. The `sed -i 's/\r$//'` step strips them **before the Docker build**. It must be scoped to text sources and **must exclude every binary asset**:

- **Safe to `sed`:** `.ts`, `.tsx`, `.css`, `.html`, `.md`, `.mjs`, `.json`, and similar text sources.
- **NEVER `sed`:** `.webp`, `.png`, `.jpg`, `.mp4`, `.woff`/`.woff2`, `.exe`, or any other binary. Running `sed 's/\r$//'` on a binary rewrites any `0x0D` bytes and **corrupts the file** (a mangled `.webp` hero image, a broken font, an unusable installer).

Raster/video assets live under `public/product-assets/<slug>/` as `.webp`/`.mp4`. When your change includes such assets, keep them out of the `<text files>` find expression entirely — e.g. constrain `find` to your text paths, or filter by extension (`find <dir> -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.html' -o -name '*.md' -o -name '*.mjs' -o -name '*.json' \) -exec sudo sed -i 's/\r$//' {} +`) so binaries are never matched.

**Summary: sed the text, never the `.webp`/binaries.**

---

## 5. Build-clean gate — what to verify locally

Before committing/deploying, confirm `npm run build` is genuinely clean:

- **Vite compiled** with no errors. A stray unescaped backtick in a docs `body` template literal, a broken import, or a type-level module error fails here — this is the safety net for the markdown-in-`.ts` gotcha (see `05-landing-and-docs.md`).
- **The prerender emitted your route.** Check the final log count and inspect the output:
  - Landing: `dist/product/<slug>/index.html` exists and its `<head>` reflects your `seo{}` (title/description/OG).
  - Docs: `dist/docs/<slug>/index.html` and `dist/docs/<slug>/<page>/index.html` exist for the pages you authored.
  - Remember the prerender falls back to empty getters if a registry fails to bundle — so a passing build with your page **missing** from `dist/` means the module didn't register. Fix the registry import before deploying.

---

## 6. Rollback

The deploy is **build-before-swap**: a failed `docker compose build frontend` leaves the previous `xenostudio-frontend` container serving untouched, so a broken build is self-protecting.

For a bad build that already swapped in, rollback images are tagged **`:rollback`** — re-point the `frontend` service at the `:rollback` image and `sudo docker compose up -d frontend`. Confirm the exact rollback tag/retag procedure on the box before relying on it (`confirm in the box's docker image list / compose overrides`).

---

## 7. Verify the deploy

Two checks, always:

**7.1 HTTP status — expect `200`:**

```bash
curl -sI https://xenostudio.ai/product/<slug>            # landing → 200
curl -sI https://xenostudio.ai/docs/<slug>               # docs (if you shipped docs) → 200
```

(Release-data links like `/product/<slug>/download/win` are verified in `03-release-data.md` — they are served live from R2 and don't depend on this deploy.)

**7.2 Visual — headless Edge screenshot:**

```bash
edge --headless --window-size=1600,1000 --virtual-time-budget=10000 \
  --screenshot=out.png "https://xenostudio.ai/product/<slug>?accent=amber"
# tall page: --window-size=1400,10000 then crop, e.g.:
#   magick out.png -crop WxH+X+Y +repage crop.png
```

Screenshot the hero, scroll the page, confirm the download/launch CTA renders, toggle **Shift+T** through the accents, and open `/docs/<slug>`. A green `curl` plus a correct screenshot is the definition of done for a content/docs deploy.

---

## 8. Critical warnings (recap)

1. **Commit BEFORE deploy.** `git archive HEAD` only sees committed files; uncommitted edits silently do not ship (§3.2).
2. **CRLF `sed` targets TEXT files ONLY — never binaries.** A `sed` over a `.webp`/`.png`/`.mp4`/`.woff`/`.exe` corrupts it (§4).
3. **`npm run build` must be clean before deploy** — Vite + prerender both green, and your route present in `dist/` (§5).
4. **Docker on the box needs `sudo`** — `sudo tar`, `sudo sed`, `sudo docker compose …` (§3).
5. **This is a content/docs deploy, not a release.** For new versions/downloads use the R2 publisher — no deploy — per `03-release-data.md`.
6. **`--no-cache` is an operator override** for a stale build layer (a Docker flag), unrelated to the R2 `Cache-Control: no-cache` header (§3.4).

---

### Related files in this guide

- `05-landing-and-docs.md` — authoring landing content + docs modules (the files you edit before deploying here).
- `03-release-data.md` — the `xeno-release` R2 publisher, `releases.json`/`version.json`, and why release data needs **no** deploy.
