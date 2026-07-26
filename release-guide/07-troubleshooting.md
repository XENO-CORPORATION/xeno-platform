# 07 — Troubleshooting & Guardrails

Purpose: symptom → cause → fix for the failures you will actually hit when publishing a XENO product to R2 and deploying the website, plus the hard guardrails that must never be violated.

This file is portable — it is copied into every XENO product repo. Product-specific values appear as placeholders (`<slug>`, `<app>`, `<version>`); fixed infrastructure values are written out in full (bucket `xeno-hub-releases`, `updates.xenostudio.ai`, `xenostudio.ai`, host `xeno-platform-001`, box path `/mnt/projects/xeno-platform`, container `xenostudio-frontend`). Cross-references point at sibling chapters (e.g. see `03-release-data.md` for the `releases.json` / `version.json` schemas).

---

## 0. First, locate the break (30-second triage)

Before fixing anything, find out *which* layer is failing. A product is four independent layers joined only by its slug (see `01-concepts.md` / `03-release-data.md`): **identity** (catalog), **release data** (R2 feed, read live), **landing content** (compiled), **docs** (compiled). "The page is wrong" means something different for each.

Run these three probes for the slug in question:

```bash
# 1. Is the canonical feed on R2 and non-empty?
curl -s https://updates.xenostudio.ai/apps/<slug>/releases.json | head

# 2. Is the derived latest-stable pointer present?
curl -sI https://updates.xenostudio.ai/apps/<slug>/version.json

# 3. Does the stable download deep-link 302 to a real installer?
curl -sI "https://xenostudio.ai/product/<slug>/download/win"     # expect: HTTP/… 302

# 4. Does the landing page itself load?
curl -sI https://xenostudio.ai/product/<slug>                    # expect: HTTP/… 200
```

Interpretation:

- Probe 1 returns `[]`, `404`, or nothing → **the feed was never written to R2.** This is a *publish* problem, not a website problem. Go to §2 / §8. No deploy will fix it.
- Probe 1 has data but the page is stale/wrong → **content or docs problem** (compiled into the bundle). This needs a *rebuild + deploy*. Go to §3.
- Probe 4 fails with a Cloudflare error page → **the site/host is down.** Go to §5.

Golden rule: **release data (`releases.json` + `version.json`) is read live from R2** — a new version appears with **no** platform deploy. **Landing content and docs are compiled + prerendered** — they *only* change after a rebuild + deploy. Do not deploy to fix a missing feed, and do not re-publish to fix stale content.

---

## 1. Org GitHub Actions billing is down → deploy manually on-box

**Symptom.** CI never runs; the website does not pick up your content/docs change. GitHub shows Actions disabled or a billing error at the org level. Nothing auto-deploys.

**Cause.** The XENO-CORPORATION org's Actions billing is currently down, so the automated content-deploy flow (`PRODUCT-LANDING-SPEC.md` §8.2) does not fire. This is the known "current reality (org Actions billing down → manual)" state — CI is not coming back on its own for this change.

**Fix — deploy the content by hand from the box.** This applies **only** to *content* and *docs* changes (things compiled into the bundle). Release data does **not** use this path (see §2). From `xeno-platform` on branch `landing-redesign-v3`:

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

Notes that matter:

- **`git archive` reads `HEAD`.** Your files must be **committed** first, or they will not be in the tar stream.
- **Build-before-swap.** `docker compose build frontend` builds the new image; the running container is only replaced by `up -d frontend` **after a successful build**. If the build fails, the old container keeps serving — the site never goes dark. Rollback images are tagged `:rollback`.
- **`npm run build` must be clean first.** It runs `vite build` then `scripts/prerender-products.mjs`; the prerender aborts if `dist/index.html` is missing or a docs template literal has a stray backtick. Fix locally before you ship (see `05-landing-and-docs.md` for the backtick-escaping gotcha).
- **Verify visually too**, not just the 200. Headless-screenshot the hero and CTA per `PRODUCT-LANDING-SPEC.md` §9.

See `04-build-and-deploy.md` for the full content-deploy procedure this abbreviates.

---

## 2. Releases / downloads page is EMPTY for a CLI product

**Symptom.** A CLI/SDK product (e.g. `agent-cli`) shows nothing on `https://xenostudio.ai/product/<slug>/releases` — no versions, no install line — even though the package is on npm.

**Cause.** The website reads the **R2 feed**, not npm. `fetchReleases()` fetches `https://updates.xenostudio.ai/apps/<slug>/releases.json` and returns `[]` on any error or 404. CLI products have no installer, so the desktop publisher (`xeno-release.mjs`) is not what fills them — and if nobody ran the CLI publisher, **`releases.json` was never written**. The page is empty because the feed does not exist, not because npm is missing anything.

**Fix — write the feed with the CLI publisher.** It derives the whole feed from real data (versions + dates from the npm registry ∩ notes from the CLI's own `RELEASE_NOTES` map) and uploads it to R2:

```bash
node scripts/publish-cli-releases.mjs \
  --app agent-cli \
  --pkg @xeno-corporation/xeno-agent-cli \
  --notes ../xeno-agent-cli/apps/xeno-agent-cli/src/commands/release-notes.ts \
  [--out dist-feed] [--dry-run]
```

- `--app` = the R2 folder / product slug. `--pkg` = the npm package name. `--notes` = path to the CLI's `release-notes.ts` (the `RELEASE_NOTES` object is parsed textually, not executed).
- The feed is the **intersection** of versions that are both published on npm and carry release notes — so a version with no notes (or notes with no npm publish) simply won't appear. If the page is missing a *specific* version, confirm it exists in **both** places.
- Uploads both `releases.json` and `version.json` with `Cache-Control: no-cache`, so the fix is visible on next page load — **no site deploy required.**
- Do a `--dry-run` first to see the exact `rclone` commands before anything is written.

Verify:

```bash
curl -s https://updates.xenostudio.ai/apps/<slug>/releases.json | head
```

Alternative: per `RELEASE-TO-WEBSITE.md` §3.A, a CLI release can also be published via `node scripts/xeno-release.mjs publish --app <slug> --version <X.Y.Z> --date <YYYY-MM-DD> --type release --notes "…"` with no `--win/--mac/--linux`. `publish-cli-releases.mjs` is the automated alternative that derives the whole feed from npm. See `03-release-data.md` (§6) for when to use which.

---

## 3. Frontend not updating after a deploy

**Symptom.** You built and deployed, `curl` returns 200, but the browser still shows the old content — old copy, old mockup, missing docs page.

**Cause.** Usually a stale Docker build layer or a stale `dist`: the frontend image is a two-stage build (`Dockerfile.frontend`) that runs `npm run build` inside the builder and copies `/app/dist` into nginx. If Docker reuses a cached layer, the new `dist` never gets rebuilt and the old bundle ships. (Second most common cause: you edited content but forgot it's *compiled* — an un-rebuilt content/docs change simply isn't in the bundle; see §0.)

**Fix — force a clean rebuild and swap the container:**

```bash
ssh xeno-platform-001 "cd /mnt/projects/xeno-platform \
  && sudo docker compose build --no-cache frontend \
  && sudo docker compose up -d frontend"
```

`--no-cache` discards cached layers so `npm run build` re-runs and emits a fresh `dist`. Then verify:

```bash
curl -sI https://xenostudio.ai/product/<slug>            # 200
curl -sI https://xenostudio.ai/product/<slug>/download/win   # 302 (desktop)
```

Caveat (accuracy): `sudo docker compose build --no-cache frontend` is an **operator override**, not a quoted line from `PRODUCT-LANDING-SPEC.md` §8.2 — the spec's deploy step is plain `sudo docker compose build frontend`. The literal string `--no-cache` in the spec docs refers to the R2 `Cache-Control: no-cache` **header** on JSON uploads, an unrelated concept. Use `--no-cache` on the Docker build only when you suspect a stale cached layer; otherwise the plain build is correct and faster. Confirm the current spec wording in `PRODUCT-LANDING-SPEC.md` §8.2 before treating it as canonical.

Still stale after a `--no-cache` build? Then the browser or an edge cache is holding the old asset — hard-reload / check with `curl` (which bypasses the browser cache) rather than rebuilding again.

---

## 4. CRLF corrupting files after `sed` (the "NEVER sed binaries" rule)

**Symptom.** After a deploy that ran the CRLF-normalization step, a page's images are broken, a font won't load, or a video won't play — but text and markup are fine. The build may have "succeeded" with a silently corrupted asset.

**Cause.** The repo is developed on Windows (win32), so files carry CRLF line endings; the deploy normalizes them to LF with `find <text files> -exec sudo sed -i 's/\r$//' {} +` before the Docker build. If that `find` glob is scoped too broadly and includes a **binary** asset — a `.webp`, `.png`, `.mp4`, `.woff` — then `sed` strips every `0x0D` byte inside the file, permanently corrupting it. `\r` is a real byte in a binary; removing it destroys the file.

**Fix / prevention.**

- **Only `sed` text sources.** Scope `<text files>` to `.ts`, `.tsx`, `.css`, `.html`, `.md`, `.mjs`, `.json` and explicitly **exclude** binary assets. Raster/media assets live in `public/product-assets/<slug>/` as `.webp` / `.mp4` — they must **never** pass through `sed`. The command in the deploy block carries this exact reminder inline: `# normalize CRLF; NEVER sed binaries`.
- **If an asset is already corrupted:** it cannot be repaired by re-running `sed`. Restore the original from git (`git checkout -- <file>`), re-transfer only the text files, and re-deploy. Regenerate optimized rasters from source if needed (`magick in.png -resize 1600x -quality 82 out.webp`, per `PRODUCT-LANDING-SPEC.md` §4).
- **Rule of thumb:** transfer binaries as bytes; only ever line-ending-normalize things a human types. See `04-build-and-deploy.md` for the correctly-scoped `find` invocation.

---

## 5. Site down / Cloudflare error 1033 (or 521/522/523)

**Symptom.** `https://xenostudio.ai` returns a Cloudflare error page (1033 "Argo Tunnel error", or a 52x origin-unreachable). Every product page is down at once — this is not slug-specific.

**Cause.** Cloudflare cannot reach the origin. The most common reason is simply that **the VM (`xeno-platform-001`) is not running** (or its tunnel / the host nginx / the `xenostudio-frontend` container is down). This is an infrastructure/origin problem, not a content or feed problem — nothing you publish or deploy will help until the origin is back.

**Fix — confirm the origin is up, from the outside in.**

1. **Is the VM reachable at all?**
   ```bash
   ssh xeno-platform-001 "echo ok"
   ```
   No response → the VM is down or unreachable. Bring the VM back up via your cloud/hypervisor console. This is the 1033 root cause in the majority of cases.
2. **Is the frontend container running?**
   ```bash
   ssh xeno-platform-001 "cd /mnt/projects/xeno-platform && sudo docker compose ps"
   ```
   If `xenostudio-frontend` (or `xenostudio-backend`) is not `Up`, start it:
   ```bash
   ssh xeno-platform-001 "cd /mnt/projects/xeno-platform && sudo docker compose up -d frontend"
   ```
3. **Re-verify** from outside once the container reports healthy:
   ```bash
   curl -sI https://xenostudio.ai/product/<slug>   # expect 200
   ```

Do **not** start "fixing" content, feeds, or DNS while the box is down — that is chasing the wrong layer. Get the VM and the container back first, then re-check.

---

## 6. A leaked GitHub PAT in a repo remote

**Symptom.** A git remote URL contains an embedded token, e.g. `https://ghp_XXXX…@github.com/XENO-CORPORATION/<repo>.git`, or a token appears committed in a file / script / CI config.

**Cause.** A Personal Access Token was baked into a remote or committed. Anyone with read access to that config now holds live credentials.

**Fix — treat it as compromised, do not use it.**

- **Never use the leaked token** for any operation, and never echo, log, paste, or otherwise exfiltrate it (including into these notes or a PR).
- **Tell the user to rotate it immediately** — revoke the PAT in GitHub → Settings → Developer settings → Personal access tokens, and issue a fresh one. A token in a remote URL must be assumed public.
- **Remove it from the config.** Reset the remote to a tokenless URL and authenticate the supported way instead:
  ```bash
  git remote set-url origin https://github.com/XENO-CORPORATION/<repo>.git   # or the SSH URL
  gh auth status                                                             # gh is authenticated for the org
  ```
- If the token was ever **committed** (not just in local `.git/config`), rotating is mandatory — history rewrites do not un-leak a pushed secret.

This is a guardrail, not a preference: a leaked credential is rotated, never reused.

---

## 7. GUARDRAIL — never kill processes by image name

**Rule.** Do **not** kill processes by executable/image name. No blanket `Stop-Process -Name`, `taskkill /IM`, or `pkill <name>` — especially not `node.exe`, `claude.exe`, `python.exe`, `ffmpeg.exe`, `codex.exe`. A name filter destroys the user's **other** running work — live editor sessions, unrelated jobs, other agents — not just the thing you launched.

**Why it's here.** This bites during releases: a background build, an `rclone` upload, an `ssh` deploy, or a stuck `npm run build` looks like "just kill node." Killing by name has already wiped out every live Claude Code session in one sweep. It is unacceptable and hard to recover from.

**How to stop something you started.**

- Capture the **PID at launch time** and only ever kill that specific PID (or its exact process tree from that PID). When you run a background job, record its PID.
- To stop a job you own, stop the exact launcher/pipe you own by its recorded PID — never a name filter.
- If a process leaks and you **don't** have its exact PID, **do not sweep by name.** Tell the user which processes are lingering and let them decide, or filter by an unambiguous property (the exact command line of the run you launched) **and confirm with the user** before killing anything shared.
- When in doubt, leave it alone and ask.

---

## 8. npm-published but the website shows nothing

**Symptom.** `npm publish` succeeded — the version is live on the npm registry — but `https://xenostudio.ai/product/<slug>` (and its `/releases` page) shows nothing new, or is empty.

**Cause.** **The feed on R2 was never written.** Publishing to npm does not touch R2. The website never reads npm directly — it reads `https://updates.xenostudio.ai/apps/<slug>/releases.json`. Until a publisher writes that feed, the site has nothing to show. This is the same root cause as §2, reached from the other direction: npm is done, R2 is not.

**Fix — write the R2 feed.** For a CLI/npm product, run the CLI publisher (it reads npm + the CLI's notes and writes both JSON files to R2):

```bash
node scripts/publish-cli-releases.mjs --app <slug> --pkg <npm-package> --notes <path-to>/release-notes.ts [--install "npm install <npm-package>"]
```

Then confirm the feed exists and the page reflects it (no deploy needed — the JSON carries `Cache-Control: no-cache` and is read live):

```bash
curl -s https://updates.xenostudio.ai/apps/<slug>/releases.json | head
curl -sI https://updates.xenostudio.ai/apps/<slug>/version.json
```

Remember: **a release is not complete until the R2 feed is updated.** For desktop products the equivalent step is `node scripts/xeno-release.mjs publish …`, which uploads the installer and writes **both** `releases.json` (canonical history) and `version.json` (derived latest-stable pointer). If either JSON is missing, the site or Hub will look empty/stale even though the artifact shipped. See `03-release-data.md` for the schemas and the publisher details (§6).

---

## 9. The publisher refused: gate problem codes

**Symptom.** `node scripts/xeno-release.mjs publish …` prints `✖ RELEASE REFUSED` (or `THE RELEASE IS BROKEN`) with one or more bracketed codes and exits non-zero.

**Cause.** One of the five fail-closed gates said no. Gates 1–4 run **before the first byte is uploaded**, so a refusal there means **nothing reached R2** and the previous release is untouched. Gate 5 runs *after* upload, so a failure there means the objects are live but the auto-update chain does not resolve — that one must be fixed, not ignored.

**Exit codes:**

| Exit | Gate | State of R2 |
|---|---|---|
| `2` | FEED (pre-upload feed verification) | Nothing uploaded. |
| `3` | LIVE (post-upload chain verification) | Uploaded, but the update chain is broken. |
| `4` | SECRET or COVERAGE | Nothing uploaded. |
| `1` | Anything else (bad flags, missing file, unexpected error) | Nothing uploaded. |

### 9.1 `FEED_*` — the updater feed did not verify (exit 2, nothing uploaded)

**The one distinction that decides everything: rewrite or rebuild.** If the feed names a file we are not uploading but its **sha512 matches** a file we *are* uploading, the bytes are correct and only the name is wrong → **rewrite the feed**. If the name matches but the **sha512 differs**, the feed describes a different build → **rebuild**. Never hand-edit a checksum to make a gate pass.

| Code | Cause | Fix |
|---|---|---|
| `FEED_REF_MISSING_VERSION_PREFIX` | A bare filename in a `slug-root` feed. It resolves to `apps/<slug>/<file>`, which does not exist → 404. | **Rewrite** the ref to `v<version>/<file>`. No rebuild. |
| `FEED_REF_WRONG_PREFIX` | A `slug-root` feed ref carries some prefix other than `v<version>/`. | **Rewrite** the ref to `v<version>/<file>`. No rebuild. |
| `FEED_REF_UNEXPECTED_PREFIX` | A prefixed ref inside a `v<version>/` feed. It resolves to `v<version>/v<version>/<file>` — a double prefix → 404. | **Rewrite** the ref to the bare filename. No rebuild. |
| `FEED_FILENAME_MISMATCH` | The feed names a file that is not being uploaded, **but its sha512 matches one that is**. The bytes are correct; only the name is wrong. This is the real motion/workflow defect: the feed said `XENO-Motion-Setup-0.3.4.exe`, the artifact was `XENO Motion Setup 0.3.4.exe`. | **REWRITE the feed** to the artifact's actual filename. **No rebuild.** |
| `FEED_CHECKSUM_MISMATCH` | The referenced filename matches, but the feed's `sha512` does not match the artifact's bytes — the feed describes a **different build**. | **REBUILD** and re-run the publisher. Never hand-edit the checksum. |
| `FEED_SIZE_MISMATCH` | The feed's declared `size` differs from the artifact's size. Same meaning as a checksum mismatch: two different builds. | **Rebuild.** |
| `FEED_VERSION_MISMATCH` | The feed's `version:` line is not the version being published — the feed came from another build. | **Rebuild.** Do not edit the version line. |
| `FEED_REF_UNRESOLVABLE` | The feed references a file that is neither among the uploads by name **nor** by sha512. Feed and artifacts come from different builds. | **Rebuild.** |
| `FEED_NO_REFS` | The feed references no installer at all — electron-builder emitted an empty feed. | **Rebuild.** |
| `FEED_MISSING` | No channel feed (`latest.yml` / `beta.yml` / `…-mac.yml` / `…-linux.yml`) was found next to the installer. electron-builder only emits it when a `generic` publish provider is configured. | Add `publish.provider: generic` + `publish.url` to the product's `electron-builder.yml` and rebuild, or pass `--artifact-dir` if the feed is elsewhere. |

Notes that matter:

- The feed filename is derived from the **semver prerelease tag**, not from `--channel`: `0.6.4` → `latest.yml`, `0.1.0-beta.1` → `beta.yml`, `1.0.0-rc.1` → `rc.yml`. A stable-named file found for a prerelease is republished under the derived name; the reverse never happens.
- `--allow-no-updater-feed` downgrades this gate to a warning. It is **only** for slugs with no in-app updater (CLI/library products). Using it on a desktop product ships a release whose installed clients can never be fixed remotely.
- Re-run with `--dry-run` to iterate: gates 1–4 run for real against the local artifacts and upload nothing.

### 9.2 `LIVE_*` — published, but the update chain does not resolve (exit 3)

After a real publish, the publisher re-fetches the feed it just uploaded, resolves every ref exactly as electron-updater does, and issues a ranged `GET` expecting `206` with a matching size. These codes mean the objects are **already on R2** and something is wrong with them.

| Code | Cause | Fix |
|---|---|---|
| `LIVE_FEED_UNREACHABLE` | The feed we just uploaded returns non-2xx, or the fetch failed. The upload did not land at that key. | Check `--updater-url` / `--updater-layout`, confirm the object exists on R2, re-publish. In-app auto-update is **dead** until this returns 200. |
| `LIVE_FEED_VERSION_MISMATCH` | The live feed advertises a different version than the one just published — a stale feed is being served. | Clients will not see this release. Re-upload the feed and re-verify. |
| `LIVE_FEED_CONTENT_DRIFT` | The feed served from R2 is not byte-identical to what this run uploaded. | Usually a stale CDN copy — confirm the upload carried `Cache-Control: no-cache`, then re-check. If it persists, another publish overwrote the key. |
| `LIVE_INSTALLER_404` | A ref in the feed resolves to a URL that 404s. **The classic dead-updater signature.** | Either the feed's filename is wrong (compare with what landed in `v<version>/` → §9.1 `FEED_FILENAME_MISMATCH`) or the installer never uploaded. **THE RELEASE IS BROKEN** — fix before announcing. |
| `LIVE_INSTALLER_BAD_STATUS` | The ranged `GET` returned something other than `206`/`200`. | Investigate the object on R2 before announcing the release. |
| `LIVE_SIZE_MISMATCH` | The object serving under that key is a different size than what this publish uploaded — a **different build** is live at that URL. | Installers are immutable: do not overwrite. Cut a new version. |
| `LIVE_INSTALLER_UNREACHABLE` | The ranged `GET` threw (network/DNS/origin). | The feed advertises an installer that cannot be fetched; auto-update fails for every client. Re-check R2 and `updates.xenostudio.ai`. |

---

## 10. The publisher refuses with a secret finding

**Symptom.** `✖ SECRET GATE — refusing to upload <path>`, a redacted finding (`<4 chars>… len=… fp=…`) with the pattern id and the entry it was found in, exit code **4**. Nothing was uploaded.

**Cause.** The **artifact bytes** carry a secret-shaped string. The scan runs inside the uploader (`scripts/lib/r2-upload.mjs`), unpacking `.zip`/`.tgz`/`.tar`/`.asar` containers and the adjacent `*-unpacked/` tree — including `resources/app.asar` — so a key bundled into JS inside a ZIP is visible to it even though a scan of the compressed bytes would not see it.

**Fix — rebuild the artifact. Removing the secret from source is not enough.**

- A pre-built artifact keeps whatever was compiled into it. The 2026-07 incident is exactly this shape: built 2026-03-13, source fixed 2026-07-10, uploaded 2026-07-14 — a live platform key reached the CDN while the repo's own CI guardrail was green, because the publish path never touches CI.
- **Rebuild from clean source**, confirm the finding is gone (`--dry-run` runs this gate for real and uploads nothing), then publish.
- **Never** print, paste, or echo the matched value — the tool reports a 4-character preview and a SHA-256 fingerprint precisely so occurrences can be correlated without exposing the secret. If it is a real credential, rotate it (see §6).
- If the match is a genuine **false positive**, narrow the pattern in `scripts/lib/secret-patterns.json` (or add a more specific one via `$XENO_SECRET_PATTERNS`) — do not bypass the gate. There is no flag that disables it.

**Related refusal — `✖ COVERAGE GATE` (also exit 4).** The artifact is an opaque installer (NSIS `.exe`, `.dmg`, `.AppImage`) whose compressed payload could not be opened, so a clean scan would be a false assurance. Fix, in order of preference: (1) publish from the packager output directory so the adjacent unpacked tree (`release/win-unpacked/`, `mac/<App>.app`, `linux-unpacked/`) sits next to the installer — it contains `resources/app.asar`, which **is** scanned; (2) if the payload genuinely cannot be opened, re-run with `--allow-unscannable-payload` and record why in the release notes. An unscanned payload is how the extension leak shipped.

---

## 11. GUARDRAIL — `seed-releases.mjs` flattens release history

**Symptom.** A product's `/releases` page suddenly shows **one** version where it previously listed the full history, and `https://updates.xenostudio.ai/apps/<slug>/releases.json` is a one-element array.

**Cause.** `scripts/seed-releases.mjs` **replaces** `releases.json` with a single synthesized latest-stable entry. It is a one-off bootstrap for a product that has a `version.json` but no history yet — not a republish tool. R2 has no object versioning and there is no server-side copy, so a flattened history is **gone**. On 2026-07-26 a bare `import()` of that module — no arguments, no intent to publish — executed it against the default slug list (`hub pixel motion sound`) and wiped four histories irreversibly.

**Fix / prevention.**

- **Publish with `xeno-release.mjs`, which prepends.** `seed-releases.mjs` is never the right tool for a new version. See `03-release-data.md` §6 vs §8.
- The script is now **plan-only by default** (`--confirm` required to write), **inert on `import()`** (it only runs as a process entry point), and it **refuses any slug whose `releases.json` already holds more than one entry** (escape hatch: `--force-flatten`). If you see that refusal, it is doing its job — do not force past it.
- **If a history was already flattened**, it cannot be recovered from R2. Rebuild `releases.json` by hand from the product's `CHANGELOG` + the installers still present under `apps/<slug>/v*/`, and upload it once with the normal publisher path. Verify with `curl -s https://updates.xenostudio.ai/apps/<slug>/releases.json | head`.

---

## Quick reference — which failures need a deploy vs. a publish

| You changed / observed | Layer | Action | Deploy? |
|---|---|---|---|
| New version / installer / notes not showing | Release data (R2 feed) | Run the publisher (`xeno-release.mjs` desktop · `publish-cli-releases.mjs` CLI) | **No** — read live |
| CLI `/releases` page empty (§2, §8) | Release data (R2 feed) | `publish-cli-releases.mjs` | **No** |
| Landing copy / hero / mockup wrong | Landing content (compiled) | Edit module → `npm run build` → deploy (§1) | **Yes** |
| Docs page missing / wrong | Docs (compiled) | Edit module → `npm run build` → deploy (§1) | **Yes** |
| Deployed but page still old (§3) | Build cache / stale dist | `docker compose build --no-cache frontend` → `up -d frontend` | **Yes** (rebuild) |
| Whole site returns Cloudflare error (§5) | Origin / VM down | Bring `xeno-platform-001` + `xenostudio-frontend` back up | n/a |
| Publisher refused, exit 2, `FEED_*` (§9.1) | Updater feed vs. artifacts | sha512 matches → **rewrite the feed**; sha512 differs → **rebuild**. Nothing was uploaded. | **No** |
| Published, exit 3, `LIVE_*` (§9.2) | Feed on R2 does not resolve to an installer | Fix the feed / re-upload the installer **before announcing** | **No** |
| Publisher refused, exit 4, secret or coverage (§10) | Secret in the **artifact bytes**, or an unscannable payload | **Rebuild the artifact** (a source fix alone does not clean it) | **No** |
| `/releases` history collapsed to one entry (§11) | `seed-releases.mjs` flattened `releases.json` | Rebuild the history by hand — R2 has no versioning. Publish with `xeno-release.mjs`, which prepends. | **No** |

When a symptom isn't listed here and you resolve it, append it to this file (symptom → cause → fix) so the next agent doesn't rediscover it.
