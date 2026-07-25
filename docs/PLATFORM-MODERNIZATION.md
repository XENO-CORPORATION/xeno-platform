# xeno-platform — Production-Readiness & Delivery Modernization

> Principal-level modernization assessment of **xeno-platform** (xenostudio.ai), the cloud OS
> that hosts the marketing site, the metered-inference backend, and the money credit-ledger.
> Written 2026-07-14. Evidence is cited to files/paths; a 6-dimension evidence inventory
> (backend architecture, delivery/CI-CD, testing/quality, observability/ops, security/secrets,
> data/persistence) plus a live production-box inspection back every claim.
>
> This document is the canonical roadmap. It supersedes ad-hoc "what should we harden next"
> conversations. Update it as phases close.

---

## TL;DR

The **application code is in good shape for launch** — money-in is atomic + hash-chained + tested,
auth is fail-fast, entitlements are enforced, rate-limiting is unspoofable (that work shipped over
the last week). **What is NOT production-grade is everything *around* the code**: how it is deployed,
recovered, observed, and reproduced.

The single scariest fact: **the money ledger has zero disaster recovery.** It lives on one local
Docker volume on one host, with no dump, no WAL archiving, no offsite copy, and no tested restore.
A disk or host loss is total, irreversible loss of customer balances and the audit chain. The
**core money/identity schema is not even in the repo** (`credit_accounts`, `credit_transactions`,
`users`, `pricing_tiers`, … have no committed `CREATE TABLE`), so we cannot rebuild the database
from source, and a fresh box does not boot cleanly.

The **deploy is a hand-typed SSH one-liner** from one workstation, un-audited, with no tested
rollback, applied to a money backend by `tar --overwrite`ing files onto the box.

None of this blocks the *code* from being correct. All of it blocks the *platform* from being
something you can safely operate, scale, and sleep behind.

---

## Diagnosis

**Primary discipline:** **Platform / Release Engineering + Site Reliability Engineering (SRE)**,
with **Data-Platform Reliability** as a co-equal primary (the money ledger's DR + schema-as-code
gaps are as severe as the delivery gaps).

**Supporting disciplines:**
- **Backend architecture / modularization** — the `index.js` god-file (5,099 LOC, an ~1,800-LOC
  inline `/api/chat/generate` handler, a ~900-LOC inline WebSocket server). Real debt, but it is
  *working* debt — supporting, not ship-blocking.
- **Security & secrets engineering** — no secret manager, weak live infra credentials, a leaked
  PAT on the box, Docker-socket exposure.
- **QA / test engineering** — no typecheck gate, a big untested route/service surface, the one CI
  gate possibly inert.

**This is NOT:**
- **…a rewrite.** The layered structure (routes/services/utils/middleware, a clean `req.db` seam)
  is sound; this is incremental rearchitecture + operational hardening, not a green-field rebuild.
- **…database administration.** It is *data-platform reliability* (backups/PITR, schema-as-code,
  migration discipline) — the problem is the absence of engineering practice around the data, not
  query tuning or index management.
- **…application feature work.** Every gap here is a "-ility" (reliability, recoverability,
  reproducibility, observability), not a missing feature.

**Initiative name:** *xeno-platform Production-Readiness and Delivery Modernization.*

---

## Transition (FROM → TO, per domain)

| Domain | FROM (today, with evidence) | TO (target) |
|---|---|---|
| **Delivery / deploy** | Hand-typed `git archive HEAD … \| ssh xeno-platform-001 … sudo docker compose build/up` one-liner; images built on the box from a `tar --overwrite`'d worktree; no image tags/registry; no tested rollback; backend deploy entirely undocumented (release-guide covers only `frontend`). | One codified, idempotent deploy command covering **backend + frontend**; SHA-tagged images; build-before-swap; automatic healthcheck gate + auto-rollback; an on-box deploy log. Later: registry + CI-triggered deploy. |
| **Data reproducibility** | Core money/identity tables (`credit_accounts`, `credit_transactions`, `api_usage_logs`, `pricing_tiers`, `external_identity_links`, `users`) have **no committed `CREATE TABLE`** — they exist only because prod was hand-built (`migrate-account-v2.js:5-9` "already exist on live"). Fresh box boot **breaks** on `20260712…-workspace-billing.sql` ALTERing `credit_accounts` before anything creates it. | A committed **baseline migration** that makes the repo the source of truth; a fresh Postgres boots green through the exact startup sequence; the ALTER-before-CREATE bug gone. |
| **Disaster recovery** | **Zero** Postgres backups. `postgres_data` is a single local Docker volume; no `pg_dump`/WAL/PITR/offsite/restore anywhere (`docker-compose.yml:452`). The hash-chained money ledger is single-copy. | Nightly verified `pg_dump` with rotation + a **tested** restore runbook; offsite (R2) copy; Redis AOF snapshot policy. |
| **Observability** | No metrics, no error tracking, no alerting, no log aggregation. Logs are box-local `json-file` only. A down box, a stuck `/api/ready` 503, or a failed money sweeper is **silent** — on-call learns nothing. | External uptime + `/api/ready` alerting (page on down); error tracking (Sentry/GlitchTip); a metrics endpoint + dashboard; dead-man's-switch pings from the cron + hold-sweeper. |
| **Secrets / config** | No committed secrets (verified clean), but weak **live** infra creds — the box `.env` omits `POSTGRES_PASSWORD`/`REDIS_PASSWORD`/`MEILI_MASTER_KEY`/`BROWSERLESS_TOKEN`/`VNC_PW`, so those services run on the committed weak compose defaults. A **live GitHub PAT is embedded in the box git remote URL** (plaintext). Historically-leaked provider keys (OpenRouter/Gemini/CF-tunnel) still valid. Docker socket mounted into 2 services. | Fail-fast on all infra creds (`${VAR:?}`) once `.env` is populated with strong values; a rotation runbook + rotated keys; a docker-socket-proxy in front of the socket. |
| **Testing / quality** | No typecheck gate (`vite build` = esbuild, strips types; `tsc` never invoked though `strict:true`). ~10 of 35 routes/15 services tested; `aiRoutes`, `marketplace*`, `walletService`, `entitlementGate` untested. 5 hermetic auth/authz suites exist but run in **no** CI. The one CI workflow may be billing-disabled. | A `tsc --noEmit` gate; the existing hermetic suites wired to CI; a scheduled ledger-drift invariant check; coverage expanded to the money/auth surface. |
| **Backend architecture** | Partially-modular monolith with a clean `req.db` seam, but `index.js` is a 5,099-LOC god-file holding infra + routing + business logic; the `/api/chat/generate` handler alone is ~1,800 LOC. No repository/data layer (`models/` has 1 file); no validation lib. | Extract the inline handlers into `routes/` + `services/`; introduce a thin data/repository layer and request validation; shrink `index.js` to a composition root. Incremental, behind tests. |

---

## Team (roles this work actually needs)

This is a **solo-founder-plus-AI-agents** org, so the honest output is not a 9-person org chart —
it is the **set of hats** one operator (with AI leverage) must wear, in priority order, and the
seniority floor below which each reliably fails.

| Hat | Market title | Seniority floor | Must-have expertise | Workstreams |
|---|---|---|---|---|
| **Release/Deploy** | Principal Platform / Release Engineer | Senior+ | Docker/Compose, build-before-swap + immutable-artifact discipline, deploy rollback drills, SSH/infra automation, "what exactly is running" reproducibility | Deploy pipeline, image tagging, box-as-source-of-truth |
| **Data reliability** | Staff Data-Platform / DB Reliability Engineer | Senior+ (**hard floor** — money data) | Postgres backup/PITR (`pg_dump`/`pgBackRest`/`wal-g`), migration discipline (versioned, idempotent, reversible), schema-as-code, restore-testing | Baseline schema, DR, migration consolidation |
| **SRE / on-call** | Site Reliability Engineer | Mid–Senior | Alerting/on-call design, uptime + healthcheck monitoring, error tracking, metrics/dashboards, incident runbooks | Observability, alerting, health-gate correctness |
| **Security** | Application Security Engineer | Senior (for the money/authz surface) | Secret management + rotation, least-privilege container/socket hardening, credential-fail-fast, threat modeling a billing system | Secret rotation, compose hardening, socket-proxy |
| **Backend architecture** | Staff Backend Engineer | Senior | Express/Node at scale, decomposing god-files behind tests, API/data-layer design, request validation | `index.js` decomposition, repository layer |
| **QA/test** | Software Engineer in Test | Mid–Senior | Typecheck/CI gating, hermetic integration tests against ephemeral Postgres, coverage strategy for money paths | Typecheck gate, CI wiring, coverage |

**Collapsed reality:** the **Release/Deploy + Data-reliability + SRE** hats are the ones you cannot
skip and cannot fake with junior effort — they are what stands between "the code is correct" and
"the business survives a bad Tuesday." Security is a close fourth (the money surface raises its
floor). Backend-architecture and QA are important but *deferrable* — they make future change safer,
they do not prevent catastrophe.

---

## Roadmap

### Phase 1 — Stop the bleeding *(this week)*
**Goal:** make the platform recoverable, reproducible, and safely deployable. No catastrophe should
be one disk/host/typo away.
- **Deliverables:** codified deploy pipeline (backend+frontend, SHA-tagged, build-before-swap,
  healthcheck-gated, auto-rollback) + `docs/DEPLOY.md`; baseline schema migration (repo reproduces
  the DB, fresh-boot bug fixed); nightly verified `pg_dump` + rotation + **tested** restore
  (`docs/DR.md`); external uptime/`/api/ready` alerting; hermetic auth/authz suites wired to CI +
  a typecheck gate; a security-hardening runbook (rotate the box PAT + leaked keys; coordinated
  infra-credential rotation plan).
- **Active hats:** Release/Deploy, Data-reliability, SRE, Security.
- **Exit criterion:** (a) a documented one-command deploy with a drilled rollback; (b) a proven
  restore from last night's backup into a scratch DB with matching row counts; (c) a page fires
  when the box is down; (d) a fresh Postgres boots green from the repo.

### Phase 2 — Contracts & gates *(2–4 weeks)*
**Goal:** make regressions and drift *impossible to merge/deploy silently*.
- **Deliverables:** confirm/enable the CI gate (or self-hosted runner) so money-tests + core-tests
  actually run on every push; expand coverage to `aiRoutes`/`marketplace*`/`walletService`/
  `entitlementGate`; consolidate the three migration mechanisms into one versioned path (fold
  `migrateAccountV2` + the loose `*-schema.sql` + `migrate-auth-v2` into versioned migrations);
  switch the container healthcheck from `/api/status` to `/api/ready`; `unhandledRejection` fail-fast.
- **Active hats:** QA/test, Data-reliability, SRE.
- **Exit criterion:** red build blocks deploy; one migration path; healthcheck reflects true readiness.

### Phase 3 — Observability & error tracking *(3–6 weeks)*
**Goal:** see production without SSHing.
- **Deliverables:** Sentry/GlitchTip error tracking with release+user correlation; a `/metrics`
  endpoint (prom-client) + a dashboard (request/error rate, latency p50/p95/p99, DB-pool saturation,
  Redis memory, ledger throughput, sweeper/cron success); centralized log shipping.
- **Active hats:** SRE.
- **Exit criterion:** an incident is diagnosable from dashboards + traces, not raw logs.

### Phase 4 — Security & least privilege *(coordinated)*
**Goal:** close the credential + privilege-escalation surface.
- **Deliverables:** rotate all weak/leaked creds; move infra secrets to `${VAR:?}` fail-fast; a
  secret manager (SOPS/Doppler/Vault) or at least an encrypted, access-logged `.env`; a
  docker-socket-proxy in front of the two socket mounts; a non-superuser DB role for the app so the
  append-only ledger trigger is defense-in-depth.
- **Active hats:** Security, Data-reliability.
- **Exit criterion:** no service boots on a default credential; a backend RCE is not host-root.

### Phase 5 — Architecture & scale *(ongoing, behind tests)*
**Goal:** make the codebase safe to change at speed.
- **Deliverables:** extract the inline `/api/chat/generate` handler + the WebSocket server out of
  `index.js` into `routes/`+`services/`; introduce a thin repository/data layer; add request
  validation (zod); shrink `index.js` to a composition root; retire the lossy `users.credits` mirror
  (ledger-consolidation Phase 4).
- **Active hats:** Backend architecture, QA/test.
- **Exit criterion:** `index.js` < ~500 LOC; new endpoints ship with a service + a test by default.

---

## First 3 actions this week

1. **Backups + tested restore for the money ledger** — nightly `pg_dump -Fc` with rotation and a
   *proven* restore (round-trip into a scratch DB, row counts match). This is the highest-severity
   gap: today a host loss is unrecoverable. *(In progress.)*
2. **Baseline schema migration** — snapshot the live schema, commit it so the repo reproduces the DB
   and a fresh box boots green (fixing the ALTER-before-CREATE bug). *(In progress.)*
3. **Codified deploy pipeline** — replace the hand-typed one-liner with a versioned,
   healthcheck-gated, auto-rollback deploy for backend + frontend, plus `docs/DEPLOY.md`. This is the
   tool every subsequent change ships through. *(In progress.)*

Parallel, operator-owned (cannot be done from code — flagged, with runbooks):
- **Rotate the GitHub PAT embedded in the box git remote URL** (grants push to
  `XENO-CORPORATION/xeno-platform` + `emiliancristea/xeno-platform`) and the historically-leaked
  provider keys.
- **Populate the box `.env`** with strong `POSTGRES_PASSWORD`/`REDIS_PASSWORD`/`MEILI_MASTER_KEY`/
  `BROWSERLESS_TOKEN`/`VNC_PW`, then flip compose to `${VAR:?}` fail-fast (coordinated — changing a
  live DB password is a careful, staged operation; see `docs/SECURITY-HARDENING.md`).
