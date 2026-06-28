# How to publish a release to the website (xenostudio.ai)

> **Give this to the agent in any XENO product repo.** Run it **every time you ship
> a release** — an npm publish, a desktop installer, a new build — so the product's
> page on **xenostudio.ai** reflects it. If you skip this, the website silently
> stays on the old version (this is exactly why agent-cli/sdk npm releases never
> showed up on the site).
>
> **You do NOT need to touch the website's code or redeploy it.** The site reads
> your release data **live**. Publishing the data below = the website is updated.

---

## 0. TL;DR

For most products, a release = **publish/build as usual**, then **update two JSON
files on R2** (`releases.json` + `version.json`) for your product. The easiest way:

```bash
# From the xeno-platform repo (it ships the publisher). slug = your product id.
cd ../xeno-platform   # or wherever xeno-platform is checked out
node scripts/xeno-release.mjs publish \
  --app <slug> --version <X.Y.Z> --date <YYYY-MM-DD> \
  --notes "<one-line or markdown changelog>" \
  [--win <installer.exe>] [--mac <app.dmg>] [--linux <app.AppImage>]
```

Then verify: `https://xenostudio.ai/product/<slug>` shows the new version. Done.

If you can't run the tool, do it **manually** (§4) — same result.

---

## 1. Know your product's identity

Your product has a **slug** — the id used in the URL and on R2. Find it in
`xeno-platform/src/lib/productCatalog.ts`. Examples: `hub`, `pixel`, `motion`,
`sound`, `agent-cli`, `sdk`, `extension`, `rt`, `anima`.

- **If your product is NOT in that catalog**, it has no page yet. Add an entry
  (one line) to `productCatalog.ts`, or ask the platform owner to. Until it's in
  the catalog, the steps below publish data but no page renders it.
- **`delivery` matters** — it decides the call-to-action:
  - `cli` → website shows your **install command** (e.g. `npm i -g @xeno/agent-cli`)
  - `web` → website shows a **Launch** button (no download)
  - `desktop` → website shows **Download** buttons wired to your installers

---

## 2. Prerequisites (one-time)

- **rclone** with an `r2:` remote pointing at the `xeno-hub-releases` bucket.
  Check: `rclone listremotes` → you should see `r2:`. If not, ask the platform
  owner for the R2 credentials / rclone config. (Public read URL base is
  `https://updates.xenostudio.ai`; the bucket path is `apps/<slug>/`.)
- Access to the **xeno-platform** repo (it contains the publisher
  `scripts/xeno-release.mjs`). It's a sibling repo, so usually `../xeno-platform`.

---

## 3. The release, by product type

### A. npm package — CLI / SDK (e.g. agent-cli, sdk)
You ship with `npm publish`. The website doesn't host a binary; it shows your
**install command** (from the catalog) + a **release feed** (changelog). So after
`npm publish`:

```bash
cd ../xeno-platform
node scripts/xeno-release.mjs publish \
  --app agent-cli --version 0.4.0 --date 2026-06-28 \
  --type release \
  --notes "$(cat CHANGELOG-0.4.0.md)"
```

No `--win/--mac/--linux` — npm packages have no installers. This appends a
`releases.json` entry so `/product/agent-cli` and `/product/agent-cli/releases`
show v0.4.0 and its notes. **That's the whole job for a CLI/SDK release.**

### B. Desktop installer — Electron app (Hub, Pixel, Motion, Sound, …)
Build your installers, then publish them + the metadata:

```bash
cd ../xeno-platform
node scripts/xeno-release.mjs publish \
  --app pixel --version 0.6.4 --date 2026-06-28 --type patch \
  --notes-file ../xeno-pixel/CHANGELOG-0.6.4.md \
  --win  "../xeno-pixel/release/XENO Pixel Setup 0.6.4.exe" \
  --mac  "../xeno-pixel/release/XENO-Pixel-0.6.4.dmg" \
  --linux "../xeno-pixel/release/XENO-Pixel-0.6.4.AppImage"
```

The tool computes size + SHA-256, uploads installers to `apps/pixel/v0.6.4/`,
prepends the release to `releases.json`, and regenerates `version.json` (so **XENO
Hub auto-update** picks it up too). The download buttons on the site immediately
point at the new build.

### C. Web app (Image, Video, Audio, …)
The app deploys with your service; there's no download. Optionally publish a
`releases.json` entry (no installers, like §A) if you want a changelog on the
product page. The CTA stays "Launch".

---

## 4. Manual path (no tool / no platform repo)

Same outcome, by hand. Produce/append these two files and upload them.

**`releases.json`** — the canonical, full history. A JSON **array**, newest-first.
Fetch the current one, prepend your new entry, re-upload:

```jsonc
[
  {
    "version": "0.6.4",                 // semver, no leading "v"  (required)
    "date": "2026-06-28",               // YYYY-MM-DD              (required)
    "latest": true,                     // the newest STABLE entry = true
    "type": "patch",                    // "release" | "patch" | "hotfix"
    "channel": "stable",                // "stable" | "beta"
    "notes": "## What's new\n- …",      // markdown (required)
    "assets": {                          // OMIT entirely for npm/web releases
      "windows": [ { "label": "Windows (x64)", "file": "v0.6.4/XENO Pixel Setup 0.6.4.exe", "size": 78123456, "sha256": "…" } ],
      "mac":     [ { "label": "macOS", "file": "v0.6.4/XENO-Pixel-0.6.4.dmg", "size": 0, "sha256": "" } ],
      "linux":   [ { "label": "Linux (AppImage)", "file": "v0.6.4/XENO-Pixel-0.6.4.AppImage", "size": 0, "sha256": "" } ]
    }
  }
  /* …older entries follow… */
]
```
> `file` is **relative to `apps/<slug>/`** (e.g. `v0.6.4/Setup.exe`) — never an
> absolute URL. Only the latest **stable** entry has `"latest": true`.

**`version.json`** — the derived "latest stable" pointer XENO Hub reads. MUST match
the latest stable `releases.json` entry, flattened to **filenames only**:

```jsonc
{
  "version": "0.6.4",
  "date": "2026-06-28",
  "windows": "XENO Pixel Setup 0.6.4.exe",   // filename only (Hub adds v0.6.4/)
  "mac": "XENO-Pixel-0.6.4.dmg",
  "linux": "XENO-Pixel-0.6.4.AppImage",
  "notes": "Short summary"
}
```
For npm/web (no installers) `version.json` just carries `version`/`date`/`notes`.

**Upload** (installers first, then the two JSON files with no-cache):
```bash
rclone copy "release/XENO Pixel Setup 0.6.4.exe" r2:xeno-hub-releases/apps/pixel/v0.6.4/
rclone copyto releases.json r2:xeno-hub-releases/apps/pixel/releases.json --header-upload "Cache-Control: no-cache"
rclone copyto version.json  r2:xeno-hub-releases/apps/pixel/version.json  --header-upload "Cache-Control: no-cache"
```

---

## 5. Verify (always do this)

```bash
curl -s  https://updates.xenostudio.ai/apps/<slug>/releases.json | head      # your new entry is first
curl -sI https://updates.xenostudio.ai/apps/<slug>/version.json              # 200
# desktop only — the stable download link must 302 to your installer:
curl -sI "https://xenostudio.ai/product/<slug>/download/win"
```
Then open `https://xenostudio.ai/product/<slug>` — it should show the new version,
date, and (desktop) working download buttons. **No platform deploy is needed** —
the page reads `releases.json` live.

---

## 6. What you own vs the platform team

| You (product agent) | Platform team (xeno-platform) |
|---|---|
| Publish releases (this doc) — `releases.json` + `version.json` + installers | The product **landing page content** (hero, features, screenshots) in `src/content/products/<slug>.ts` |
| Keep your **catalog entry** correct (slug, delivery, install/launch, repo) | The page template, SEO/prerender, deploy |

Versions, downloads and changelogs update **automatically** from your release data.
Marketing copy/screenshots are the platform team's job — flag them when your
product changes meaningfully (see `PRODUCT-LANDING-SPEC.md`).

---

## 7. Rules (don't break these)

1. **slug** = the catalog id, the R2 folder, the URL — identical everywhere.
2. **semver**, no leading `v`. Dates `YYYY-MM-DD`.
3. **Always publish BOTH** `releases.json` and `version.json` together. A release is
   not done until both are updated (this is the "website reflects the release" rule).
4. **Never overwrite** an existing `vX.Y.Z/` installer — versions are immutable.
   Bump the version instead.
5. `releases.json` is the **full history** — prepend, don't replace.
6. **Exactly one** stable entry has `"latest": true`.
7. Installers cache forever; the two JSON files are `Cache-Control: no-cache`.

---

## 8. FAQ

- **"I only did `npm publish`. What now?"** → Run §3.A. One command. The site's
  release feed for your product updates; nothing else needed.
- **"My product isn't on the site at all."** → It's missing a **catalog entry**
  (§1). Add it or ask the platform owner.
- **"Do I need to rebuild/redeploy the website?"** → **No.** Only the JSON on R2.
- **"Where's the publisher?"** → `xeno-platform/scripts/xeno-release.mjs`. Run
  `node scripts/xeno-release.mjs` with no args for usage.
- **"No `r2:` remote?"** → Get the rclone/R2 config from the platform owner (§2).

---

*Canonical formats live in `xeno-platform/PRODUCT-PAGES-SPEC.md` (§5, §7). This is
the operational how-to; that's the contract.*
