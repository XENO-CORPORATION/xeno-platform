# Deploying the xeno-platform stack

The **codified** deploy for the Docker stack on `xeno-platform-001` (the money backend +
the frontend). It replaces the hand-typed `git archive … | ssh … sudo docker compose build/up`
one-liner that release-guide/04 §3 documented, and — unlike that one-liner — it is **gated,
auto-rolling-back, SHA-tagged, and covers the backend**.

> This is for the **platform stack** (backend/frontend containers). It is **not** the product
> release-to-R2 flow (installers/CLI versions) — that stays in `release-guide/`. And a landing/docs
> content change is just a `frontend` deploy here.

## One command

Chat worker activation is fail-closed during the first deployment. Keep both
`CHAT_INGESTION_ENABLED=0` and `CHAT_SCHEDULER_ENABLED=0` until the database,
embedding runtime, gateway run-key ledger, and `/ready/semantic` probe pass.
Enable ingestion first and recreate `chat-workers`; after the backfill is
healthy, enable scheduling and recreate it again. The health response exposes
the active worker set and both activation booleans, so an unset variable cannot
silently begin claiming durable work.

```bash
node scripts/deploy-platform.mjs <backend|frontend|both> [options]
```

**Default is a DRY-RUN.** It prints exactly what it would do and changes nothing. Add `--execute`
to run it for real.

| Command | What it does |
|---|---|
| `node scripts/deploy-platform.mjs backend` | Dry-run: print the plan, touch nothing. |
| `node scripts/deploy-platform.mjs backend --build-only --execute` | Ship + build a new image, but **do not swap** (running container keeps serving). Zero prod impact — use to validate a build. |
| `node scripts/deploy-platform.mjs frontend --execute` | Real frontend deploy (build-before-swap + healthcheck gate + auto-rollback). |
| `node scripts/deploy-platform.mjs both --execute` | Backend, then frontend (dependency order). |
| `node scripts/deploy-platform.mjs backend --rollback --execute` | **Emergency:** retag `:rollback` → `:latest` and recreate. No build. |
| `… --no-cache` | Bust a stale Docker build layer. |
| `… --allow-dirty` | Skip the clean-worktree guard (deploys HEAD anyway; uncommitted still does not ship). |

## What it guarantees (that the old one-liner did not)

1. **Commit-before-deploy is enforced.** The deploy ships `git archive HEAD` — committed bytes only.
   If the shipped paths have uncommitted changes, it refuses (they would silently not ship). This is
   the fix for the whole class of "I edited a file but the old version deployed" bugs.
2. **Build-before-swap.** `docker compose build` runs while the old container keeps serving. A failed
   build swaps nothing.
3. **Real healthcheck gate.** After the swap it polls the true readiness signal from the box —
   **`/api/ready` for the backend** (which returns 200 only *after* startup migrations succeed; 503
   until), **`/health` for the frontend**. It does not declare success until that endpoint returns 200.
4. **Auto-rollback.** If the healthcheck fails, it retags the pre-build `:rollback` image back to
   `:latest`, recreates, and re-checks — then exits non-zero. The previous image is always preserved
   as `xeno-platform-<svc>:rollback` before each build.
5. **SHA-tagged images.** The built image is tagged `xeno-platform-<svc>:<git-sha>` so "what exactly
   is running" is knowable (`sudo docker images xeno-platform-backend`).
6. **Audit log.** Every deploy appends to `/mnt/projects/xeno-platform/.deploy/deploy.log` on the box.

## How it works (two files)

- **`scripts/deploy-platform.mjs`** — runs on your workstation. Preflight (branch/SHA, clean-worktree
  guard, existence-filter the shipped paths) → `git archive HEAD` to a local tar → `scp` the tar +
  `scripts/remote-deploy.sh` to `/tmp/xeno-deploy` on the box → `ssh … sudo bash remote-deploy.sh`.
  Transport is scp-of-a-tar, not a cross-platform pipe, so it is Windows-safe.
- **`scripts/remote-deploy.sh`** — the on-box half, shipped **fresh every deploy** (never trusted from
  the box). Extract → LF-normalize text only → tag `:rollback` → `compose build` → tag `:<sha>` →
  (swap mode) `up -d --force-recreate` → healthcheck gate → auto-rollback on failure → log.

Paths shipped per service:
- **backend** → `src/server`, `Dockerfile.backend` (the only inputs `Dockerfile.backend` COPYs).
- **frontend** → `src`, `public`, `scripts`, `index.html`, `Dockerfile.frontend`, `nginx`, and the
  build configs (`package*.json`, `vite`/`tsconfig`/`tailwind`/`postcss`), existence-filtered.

## Important semantics

### Chat pgvector database cutover

The Chat semantic schema changes the PostgreSQL image and therefore is not a
normal backend-container swap. Build the exact backend candidate first, then use
the separate dry-run-first database gate:

```powershell
node scripts/deploy-platform.mjs backend --build-only
node scripts/deploy-chat-database.mjs --expected-db-image <observed-sha256>
```

Execution requires the same commands with `--execute` after release approval.
The database gate validates the observed live image, takes and lists a custom
format backup, restores it into an isolated pinned pgvector/PostgreSQL 15
volume, runs the exact candidate migration runner, and verifies pgvector 0.8.6
plus every migration. Production cutover stops the API writer, takes a second
quiesced backup, recreates PostgreSQL, migrates, and only then starts the API.
On failure it restores the quiesced backup into a separate retained old-image
volume. Qualification volumes and backups are not deleted by the script.

- **Image rollback ≠ schema rollback.** Auto-rollback restores the previous *image*, not the database.
  Startup migrations are **forward-only, additive, and idempotent** by design (`runStartupMigrations`
  in `src/server/index.js`; the versioned runner in `services/migrationRunner.js`), so the previous
  image tolerates a schema that a newer migration already advanced. If a deploy's migration is *not*
  additive-safe, do not rely on image rollback — plan a data migration.
- **Swaps use `--no-deps`.** `up -d --no-deps --force-recreate <svc>` recreates ONLY the targeted
  service — a frontend deploy never touches the money backend, and vice-versa. (Without `--no-deps`,
  compose reconciles dependencies whose `:latest` image has drifted from their running container, which
  would recreate the backend during a frontend deploy — see the build-only note below.)
- **`--build-only` advances `:latest`.** It builds and tags `:latest` + `:<sha>` but does not recreate
  the container, so `:latest` will be one build ahead of what is running. The next real deploy rebuilds
  anyway; this is harmless when the built SHA equals the running code. Don't run a bare
  `docker compose up -d` (without `--no-deps`) after a build-only unless you intend to swap in that image.
- **Untracked box state is safe.** `git archive` excludes gitignored files, so the box `.env`,
  `backups/`, volumes, and `.deploy/` are never overwritten.

## Verify a deploy

```bash
curl -sI https://xenostudio.ai/api/status          # backend via the site → 200
curl -sI https://xenostudio.ai/                    # frontend → 200
ssh xeno-platform-001 'sudo tail -20 /mnt/projects/xeno-platform/.deploy/deploy.log'
ssh xeno-platform-001 'sudo docker images xeno-platform-backend --format "{{.Repository}}:{{.Tag}} {{.ID}}"'
```

## Troubleshooting

- **"Uncommitted changes under … paths"** — commit them (the deploy ships HEAD). This is intentional.
- **Build fails** — nothing swapped; the old container is still serving. Fix locally, rebuild.
- **Healthcheck fails after swap** — the script already auto-rolled-back to `:rollback`. Check the
  deploy log; the previous image is live again. Investigate `/api/ready` (backend) — a failing startup
  migration keeps it at 503 and the container restart-loops.
- **Stale build layer** — add `--no-cache`.
- **Emergency, right now** — `node scripts/deploy-platform.mjs <svc> --rollback --execute`.

## Known follow-ups (see docs/PLATFORM-MODERNIZATION.md)

- The backend build context transfers the whole repo dir (~360 MB) because the compose context is `.`;
  tightening `.dockerignore` would speed builds. Not correctness-affecting.
- No image **registry** yet — images live only on the box. A registry + CI-triggered deploy is Phase 2.
