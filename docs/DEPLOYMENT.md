# xeno-platform — Deployment

xeno-platform is a **service**, not a downloadable product. "Releasing" it means deploying
containers to `xeno-platform-001`. This is the entry point for that: which track you are on,
what you need before you can run anything, how the pipeline behaves, and what is currently
waiting to ship.

## Two tracks. Pick the right one.

They are different shapes and use different tooling. Confusing them is the most common
mistake in this repo.

| | **Service track** (this doc) | **Website / product-page track** |
|---|---|---|
| What ships | the `backend` and `frontend` Docker containers | release metadata + installers for *other* XENO products |
| Where it lands | `xeno-platform-001` (Docker + nginx) | Cloudflare R2 (`xeno-hub-releases`) + the pages the frontend serves |
| Tooling | `scripts/deploy-platform.mjs` + `scripts/remote-deploy.sh` | `scripts/xeno-release.mjs`, `scripts/publish-cli-releases.mjs`, `rclone` |
| Canonical doc | **`docs/DEPLOY.md`** — the full command reference | **`release-guide/`** — read every file, in order |
| Triggered by | a code change under `src/server/**` or `src/**` | a new product version, or a landing/docs content change |

**`release-guide/` is canonical for the product-release track and is copied verbatim into the
product repos** (`xeno-hub`, `xeno-pixel`, …) so their agents follow the same process. Do not
improvise release commands; `release-guide/06-release-runbook.md` is the runbook and the
`xeno-product-release` skill wraps it.

The overlap that trips people up: **a landing-page or `/docs` content change is a *frontend*
deploy on the service track** — the content is compiled into the frontend image. It is not an
R2 publish. Conversely, publishing a new xeno-pixel installer touches R2 only and needs no
platform deploy at all, because the product pages read R2 live.

> **`docs/DEPLOY.md` is the command reference for everything below** — every flag, the exact
> semantics of `--build-only`, `--no-deps`, image-vs-schema rollback, and its own
> troubleshooting table. This file does not repeat it. Read `DEPLOY.md` before your first
> deploy; come back here for prerequisites, the gate behaviour, and current state.

---

## ⚠️ Current state: a backend redeploy is pending

**Security fixes are committed but NOT live.** Production runs the pre-fix backend image until
someone runs a backend deploy. Recorded in `XENO CICD - BUILD LOG.md` §3.1 and verifiable from
the commits below.

What the pending redeploy ships:

| Commit | Change | Why it matters |
|---|---|---|
| `fe0e15c` | **axios removed entirely** — the frontend's dependency was dead (zero references); the server used it at exactly two sites (internal JSON POSTs to the python search service) that already imported `node-fetch`, so both moved to a `postJsonToService()` native-fetch helper | removes any exposure to the compromised axios 1.18.x line, and one redundant HTTP client |
| `de3570f` | **`npm audit fix` on the server tree, lock-only** — no change to `src/server/package.json`, only patched transitive resolutions | server vulnerabilities **35 → 8** (0 critical, 1 high, 7 moderate). Cleared **2 critical + 16 high** across `ws`, `express`, `form-data`, `lodash`, `undici`, `engine.io`, `socket.io-parser`, `tar-fs`, `path-to-regexp`, `brace-expansion`, `minimatch`, `picomatch`, `jws`, `protobufjs`, `@xmldom/xmldom`, `basic-ftp`, `@grpc/grpc-js` |

Both land under `src/server/**`, so **`backend` is the service that needs deploying**.

The **remaining 8 vulnerabilities are deliberately unfixed**, not overlooked — they need
breaking major bumps that cannot be integration-verified headlessly on a production billing
backend with a DB-backed test suite:

- `sharp < 0.35.0` (1 high) — inherited libvips CVEs, runtime-reachable via image processing.
  Needs `sharp@0.35.x` plus a native rebuild. **Tested bump required.**
- `uuid < 11.1.1` (7 moderate) — transitive via `bull` / `dockerode` / `googleapis` /
  `node-cron`; the force-fix bumps `node-cron` a major version. Low real-world risk.

To ship the pending work:

```bash
node scripts/deploy-platform.mjs backend                 # dry-run: read the plan
node scripts/deploy-platform.mjs backend --execute       # build → swap → gate → auto-rollback on fail
```

Deploying is an operator decision. **Do not run `--execute` without explicit authorization.**

### Know what is actually running before you deploy

```bash
ssh xeno-platform-001 'sudo tail -30 /mnt/projects/xeno-platform/.deploy/deploy.log'
ssh xeno-platform-001 'sudo docker images xeno-platform-backend --format "{{.Repository}}:{{.Tag}} {{.ID}}"'
```

Every image is tagged with the short git SHA it was built from, and every deploy appends an
audit line — so "what is running" is a fact you can read, not a guess.

### A branch hazard worth knowing

The deploy ships **`git archive HEAD`** — whatever branch is checked out on your workstation.
The repository's GitHub default branch is `main`, and `main` **does not contain the deploy
tooling, the CI workflows, or the security fixes above** (they live on the integration line,
`landing-redesign-v3`, which is ~60 commits ahead). Deploying from a `main` checkout would
therefore ship an older backend. **Check `git log --oneline -1` and the branch name printed in
the deploy banner before you pass `--execute`** — the tool prints both, deliberately.

---

## Operator prerequisites

Everything below is a prerequisite a human must have satisfied. An agent cannot self-serve
any of it.

| Requirement | Detail |
|---|---|
| **SSH access** | a working `xeno-platform-001` host alias (`ssh xeno-platform-001`). The orchestrator shells out to `ssh` and `scp` with that alias — it does not accept a password or an inline key |
| **`sudo` on the box** | `remote-deploy.sh` runs as root: `docker`, `docker compose`, image tagging, and writing `.deploy/deploy.log` |
| **Docker + compose v2 on the box** | the script calls `docker compose` (plugin form) |
| **The box worktree** | `/mnt/projects/xeno-platform` (override with `--root`). The tar is extracted over it |
| **A clean local worktree** | for the paths being shipped — enforced, not advisory (see below) |
| **Local tools** | `git`, `ssh`, `scp`, Node ≥ 18. Windows-friendly by design: transport is scp-of-a-tar, never a cross-platform pipe |
| **`rclone` with the `r2:` remote** | *product-release track only* — not needed to deploy the service |

Secrets are **not** part of a deploy. The box `.env`, `backups/`, Docker volumes, and
`.deploy/` are untracked, and `git archive` excludes gitignored files, so a deploy can never
overwrite them. Nothing in this pipeline transports a credential.

---

## What gets built

Two independent images from two Dockerfiles in the repo root. Only the service you name is
touched — the compose file on the box defines roughly a dozen services (`postgres`, `redis`,
`xeno-search`, `xenorun`, `latex`, `meilisearch`, `browserless`, …) and the swap uses
`--no-deps` so none of them are recreated as a side effect.

### `Dockerfile.backend` → `xeno-platform-backend`

Single-stage `node:20-alpine`. Installs ffmpeg, ImageMagick, python3 + yt-dlp, and
`dumb-init`; creates a non-root `appuser:appgroup` (1001) **before** any `COPY --chown` and
runs as it; installs `--omit=dev` from `src/server/package*.json`; copies `src/server/`;
pre-creates the upload/conversion/download directories. Exposes **8080**, `ENTRYPOINT
["dumb-init","--"]` for correct signal handling, and a `HEALTHCHECK` that polls
`/api/ready`.

Shipped paths: `src/server`, `Dockerfile.backend` — the only inputs the Dockerfile `COPY`s.

### `Dockerfile.frontend` → `xeno-platform-frontend`

Two-stage: `node:20-alpine` builder → `nginx:alpine`. The builder takes **non-secret** Vite
build args only (`VITE_API_URL`, `VITE_WS_URL`, `VITE_ENABLE_SITE_GATE`,
`VITE_SITE_PASSWORD`) — provider API keys are never baked into the frontend image; all
inference routes through the authed, metered backend. It runs `npm ci --legacy-peer-deps`,
copies configs → `public/` → `src/` → `scripts/` (the build runs
`scripts/prerender-products.mjs` for SEO), then `npm run build`. The nginx stage serves
`/usr/share/nginx/html`, raises `client_max_body_size` to 500M, and installs
`nginx/default.conf`. Published on the box as `127.0.0.1:4040:80`.

Shipped paths: `src`, `public`, `scripts`, `index.html`, `Dockerfile.frontend`, `nginx`,
`package*.json`, and the vite/tsconfig/tailwind/postcss configs — existence-filtered against
HEAD.

---

## How the pipeline behaves

```
workstation                                    xeno-platform-001
───────────                                    ─────────────────
preflight: branch + SHA, clean-worktree guard,
           existence-filter the shipped paths
git archive HEAD  ──►  deploy-<sha>.tar
scp tar + scripts/remote-deploy.sh  ──────────►  /tmp/xeno-deploy/
ssh sudo bash remote-deploy.sh ───────────────►  1. extract tar over the worktree
                                                 2. CRLF-normalize text sources only
                                                 3. tag :latest -> :rollback   (last-good)
                                                 4. docker compose build <svc> (old container still serving)
                                                 5. tag the new image :<sha>
                                                 6. [swap] up -d --no-deps --force-recreate
                                                 7. poll the health endpoint
                                                 8. on failure: retag :rollback -> :latest,
                                                    recreate, re-poll, exit non-zero
                                                 9. append to .deploy/deploy.log
```

Five properties are worth internalising:

1. **Dry-run is the default.** Without `--execute` the tool prints the numbered plan and exits
   0. Nothing is packed, shipped, or built.
2. **Commit-before-deploy is enforced.** If any *shipped path* is dirty, the deploy **refuses**
   — because `git archive HEAD` would silently omit those edits. `--allow-dirty` bypasses the
   refusal but still deploys HEAD, and says so. This is the fix for the whole class of "I
   edited a file but the old version deployed" bugs.
3. **Build before swap.** The build runs while the old container keeps serving. A failed build
   swaps nothing.
4. **The healthcheck gate is a real readiness signal, polled from the box loopback.**
   - backend → `http://127.0.0.1:8080/api/ready`, **90 attempts × 2 s**. That endpoint returns
     503 until every startup migration has succeeded, so the gate genuinely waits for
     migrations rather than for a port to open.
   - frontend → `http://127.0.0.1:4040/health`, **30 attempts × 2 s**.
5. **Auto-rollback is automatic and verified.** On gate failure the script retags
   `:rollback` → `:latest`, recreates, and **polls health again** — logging either
   `ROLLED BACK … and healthy again` or `ROLLBACK also unhealthy — MANUAL INTERVENTION
   NEEDED`, then exits non-zero either way. It never reports success it did not observe.

`remote-deploy.sh` is shipped **fresh on every deploy** and never trusted from the box, so
editing it in this repo is the only way to change deploy behaviour — there is no hidden copy
on the server.

### Rolling back manually

```bash
node scripts/deploy-platform.mjs backend --rollback --execute
```

No build, no tar: it retags `:rollback` → `:latest` and recreates the container. `DEPLOY.md`
covers the semantics; the one to hold onto is that **image rollback is not schema rollback**.
Startup migrations are forward-only, additive, and idempotent by design, so the previous image
tolerates a schema a newer migration already advanced — but if a deploy's migration is *not*
additive-safe, image rollback will not save you. Plan a data migration instead.

`--rollback` only reaches back **one** build: `:rollback` is overwritten by each new deploy.
To go further back, retag a specific SHA by hand (`docker tag xeno-platform-backend:<sha>
xeno-platform-backend:latest`) — that is what the SHA tags are for.

### Verifying

```bash
curl -sI https://xenostudio.ai/api/status     # backend via the site → 200
curl -sI https://xenostudio.ai/               # frontend → 200
ssh xeno-platform-001 'sudo tail -20 /mnt/projects/xeno-platform/.deploy/deploy.log'
```

---

## CI

Two workflows gate the server paths, and **both are green on the integration line** (latest
run 2026-07-22 on `landing-redesign-v3`):

| Workflow | Trigger | What it proves |
|---|---|---|
| `money-tests.yml` | pushes touching `creditLedgerV2.js`, `creditTransactions.js`, `inferenceMeter.js`, `watermark.js`, `billingService.js`, `walletService.js`, `billingRoutes.js`, `migrate-account-v2.js`, `tests/**`; any `src/server/**` PR; dispatch | the double-entry ledger, hash-chained journal, atomic money-in, refund/clawback, and the metered media hold→settle path — anything that can mis-charge a customer |
| `core-tests.yml` | the auth-core equivalents (`authzReBAC.js`, `oidcProvider.js`, `gdprErasure.js`, `xenoChat.js`, `entitlementGate.js`, …) | ReBAC authorization, the OIDC provider, GDPR erasure, account recovery, AI tool-passthrough, entitlement gating |

Both spin up a real `postgres:15-alpine` service container and run **each suite in a freshly
created database**, self-seeded via `migrate-account-v2` — the same isolation used when running
them by hand on the box. The suite lists are explicit, so you can run any of them locally with
any `DATABASE_URL`:

- money — `ledger-v2`, `ledger-chain`, `ledger-billing`, `ledger-correctness`,
  `billing-money-in`, `media-metering`, `wallet-service`
- core (DB-backed) — `authz-v2`, `oidc-v2`, `erasure`, `account-recovery`
- core (no DB) — `ai-tools-passthrough`, `entitlement-gate`

`core-tests.yml` also carries a **`typecheck-advisory`** job marked
`continue-on-error: true`: `strict: true` was never actually enforced (vite/esbuild strip
types), so the fallout is unknown and this surfaces errors without red-walling every PR. It is
advisory **by design** — do not read a green tick there as a passing typecheck.

Neither workflow gates the deploy. The deploy tool does not consult CI; the healthcheck gate is
the only automatic safety net at deploy time. Check CI yourself before shipping.

## Related

- **`docs/DEPLOY.md`** — the full command reference for this pipeline. Read it first.
- **`release-guide/`** — canonical for the product-release / website track.
- `docs/DR.md` — disaster recovery. `docs/SECURITY-HARDENING.md`, `docs/PLATFORM-MODERNIZATION.md`
  (known follow-ups: no image registry yet; the backend build context transfers the whole repo
  dir because the compose context is `.`).
- `INFRASTRUCTURE.md`, `GO-LIVE-PUNCHLIST.md`, `BILLING-SETUP.md`.
- `../XENO CICD - BUILD LOG.md` §3.1 — the supply-chain work described above.
