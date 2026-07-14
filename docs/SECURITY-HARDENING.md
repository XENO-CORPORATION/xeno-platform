# xeno-platform — Security Hardening Runbook

Operator-coordinated hardening for the production box (`xeno-platform-001`). These items
**cannot** be closed from application code alone — they need a credential revoked in a
provider dashboard, or a live-credential rotation staged carefully so the running stack
doesn't lose connectivity. Each item below is severity-ranked with *why it matters*, the
*exact steps*, and the *coordination risk*.

> No secret values appear in this file. Where a credential is named, it is by env-var name
> or location only. Committed code is clean (`git ls-files` has no key material); every
> exposure below is in **box-side** state (the box `.env`, the box git remote) or a
> historical leak — not in the repo.

---

## 1. Live GitHub PAT — git-config leak CLOSED; `.env` copy awaits replacement

**What:** A live `ghp_…` classic PAT was embedded in the box git remotes AND is the backend's
`.env` `GITHUB_TOKEN`. Footprint found (2026-07-14): `/mnt/projects/xeno-platform/.git/config`
(two remotes: `origin`→XENO-CORPORATION/xeno-platform, `emilian-personal`→emiliancristea/…) and
`.env` (`GITHUB_TOKEN` = the **same** value). `.git.backup/config` was clean.

**Blast radius (important):** the PAT is **not** unused — `services/extensionReleaseService.js`
sends it as `Authorization: Bearer $GITHUB_TOKEN` to list releases of the **private**
`XENO-CORPORATION/xeno-extension` repo (powers `/api/download/extension/releases`). Verified the
token currently works (lists stable/beta/preview). So it cannot simply be deleted — it needs a
replacement before revocation, or the extension-download feature breaks.

**DONE (2026-07-14) — the token is now used NOWHERE; revoke is a zero-risk one-click:**
1. **Git-config leak closed:** `emilian-personal` remote removed, `origin` set to tokenless
   `https://github.com/XENO-CORPORATION/xeno-platform.git`; `.git/config` has no `ghp_`.
2. **GitHub dependency eliminated (the ideal end-state, shipped early):** `extensionReleaseService.js`
   now reads a PUBLIC R2 feed (`updates.xenostudio.ai/apps/extension/releases.json`, published by
   `scripts/publish-extension-releases.mjs` using local `gh` auth) instead of the GitHub API. The
   release assets are mirrored to R2 — so anonymous downloads now WORK (they didn't before, private
   URL). Verified live: backend serves stable/beta/preview from R2.
3. **`GITHUB_TOKEN` removed from the box `.env`** and backend recreated — verified the container has
   no `GITHUB_TOKEN` and the extension feature still works. The PAT now backs nothing.

**REMAINING (operator — 1 click):**
- **Revoke the old classic PAT** (prefix `ghp_ycvK…`) → GitHub → Settings → Developer settings →
  Personal access tokens (classic) → Delete. Nothing depends on it, so this is zero-risk.
- **Delete the box backup** that still holds the old token once revoked:
  `ssh xeno-platform-001 'sudo rm -f /mnt/projects/xeno-platform/.env.bak-20260714-pat'` (created
  as an integrity safety net during the `.env` edit; harmless once the token is revoked).

**Risk:** None — the token is unused; revoking it cannot break anything.

---

## 2. Historically-leaked provider keys + client-prefixed keys in the box `.env` — **HIGH**

**What:** The box `.env` still contains client-prefixed provider keys
(`VITE_OPENAI_API_KEY`, `VITE_OPENROUTER_API_KEY`, `VITE_GEMINI_API_KEY`,
`NEXT_PUBLIC_TOPAZ_LABS_API_KEY`) plus the server `OPENROUTER_API_KEY` / `OPENAI_API_KEY` /
`GOOGLE_API_KEY`. Memory records prior leaks of OpenRouter/Gemini and a Cloudflare tunnel
token to the frontend bundle (`platform-client-key-exposure`, `platform-cloudflare-topology`).

**Why it matters:** `VITE_`/`NEXT_PUBLIC_` prefixes are the ones a bundler inlines into the
**client** bundle. The inference rework (this project's earlier work) already routes all
inference through the authed, metered backend and the compose frontend build declares
"NON-SECRET build args only" — but a leaked key stays valid until rotated, and a stray
`import.meta.env.VITE_*` reference would re-expose it.

**Steps (operator — needs provider dashboards):**
1. **Verify** no client code still reads them:
   ```bash
   grep -rn "VITE_OPENAI_API_KEY\|VITE_OPENROUTER_API_KEY\|VITE_GEMINI_API_KEY\|NEXT_PUBLIC_TOPAZ" src public
   ```
   (Expect: none in shipped client paths. `public/env-config.js` must not carry real values.)
2. **Rotate** every key that was ever client-exposed: OpenAI, OpenRouter, Google/Gemini,
   Topaz, and the Cloudflare tunnel token — in each provider's console.
3. **Remove** the `VITE_`/`NEXT_PUBLIC_` provider keys from the box `.env` entirely (the
   backend uses the unprefixed server keys via `api.xenostudio.ai`; the client needs none).
4. Rebuild + redeploy the frontend so any cached bundle is replaced
   (`node scripts/deploy-platform.mjs frontend --execute`).

**Risk:** Low if step 1 confirms no client references; the backend inference path is
unaffected (it uses the server-side keys / the api-proxy).

---

## 3. Weak infra credentials running on committed defaults — **HIGH, coordinated**

**What:** `docker-compose.yml` provides fallback defaults for infra creds
(`POSTGRES_PASSWORD:-xenostudio_secure_2024`, `REDIS_PASSWORD:-xenostudio_redis_secure_2024`,
`MEILI_MASTER_KEY:-…`, `BROWSERLESS_TOKEN:-…`, `VNC_PW:-…`). The box `.env` sets **none** of
these (it sets `DB_PASSWORD` = the same default so the backend can connect), so the live
Postgres/Redis/Meili/Browserless/VNC are all running on the **weak, committed** values.

**Why it matters:** These values are in git history — anyone reading the repo knows the prod
DB password. Loopback-only port binding (`127.0.0.1:*`) is the only thing limiting blast
radius; a single SSRF/RCE or a second co-located service changes that.

**STATUS (2026-07-14): ALL FIVE infra creds ROTATED + verified. `POSTGRES_PASSWORD` DONE.**
The 4 *contained* creds rotated to strong 24-byte values in the box `.env` (never printed):
`REDIS_PASSWORD` + `MEILI_MASTER_KEY` verified live (redis+backend `/api/ready` 200; meili
authenticates with the new key); `BROWSERLESS_TOKEN` + `VNC_PW` set (their services aren't running
on this box, so they apply if/when those start). **`POSTGRES_PASSWORD` rotated to a strong 24-byte
value and proven effective** — the old default `xenostudio_secure_2024` is now **rejected** on
every password-enforced path (see the verification below). No weak-default strings remain in the
box `.env` (platform or api-proxy). The done-record + the two non-obvious lessons this rotation
taught are below.

### 3a. Postgres rotation — DONE (2026-07-14), how it was actually done + verified

What ran:
1. `ALTER USER postgres PASSWORD '<NEW>'` on the live role (`sudo docker exec xenostudio-postgres
   psql -U postgres -c …`; `<NEW>` = `openssl rand -hex 24`, never printed).
2. Platform box `.env`: `POSTGRES_PASSWORD=<NEW>` **and** `DB_PASSWORD=<NEW>` (kept equal). Compose
   derives the backend's `DB_PASSWORD` **and** `DATABASE_URL` from `${POSTGRES_PASSWORD}`
   (`docker-compose.yml:81,83`), so `POSTGRES_PASSWORD` is the single source of truth; the `.env`
   `DB_PASSWORD` line is vestigial (nothing does `${DB_PASSWORD}`) but was aligned so no dead
   default string lingers.
3. Backend recreated (`docker compose up -d --no-deps --force-recreate backend`) → `/api/ready` 200.
4. **api-proxy** (`xeno-private-api-001`) `.env`: `PLATFORM_DATABASE_URL` password → `<NEW>`;
   `pm2 restart xeno-api-proxy` → `platformPool` reads the ledger (`select count(*) from
   credit_accounts` → OK), no `28P01` after restart.

**⚠️ LESSON 1 — verify over the SCRAM path, NOT loopback.** `pg_hba.conf` in this image is
`host 127.0.0.1/32 trust` + `host ::1/128 trust` + `host all all all scram-sha-256`. So any
`docker exec … psql host=127.0.0.1` (or `-h localhost`) hits **trust** — it accepts **any**
password (even garbage), which makes an "old password still works?" check a **false positive**.
The real consumers arrive with a **docker-subnet** `client_addr` (backend over the compose net;
api-proxy tunnel via the docker gateway) → the `scram-sha-256` line → password **is** enforced. To
prove a rotation took, connect to the container's **docker IP** (e.g. `172.20.0.x`), not loopback:
`sudo docker exec xenostudio-postgres env PGPASSWORD=<old> psql -h <container-docker-ip> -U postgres
-d xenostudio -c 'select 1'` must **fail** with `28P01`.

**⚠️ LESSON 2 — the api-proxy reaches the ledger via `PLATFORM_DATABASE_URL`, NOT `DATABASE_URL`.**
On `xeno-private-api-001`, `server.js:268` builds `platformPool` from **`PLATFORM_DATABASE_URL`**
(`…@127.0.0.1:15433/xenostudio`, the SSH tunnel to the platform ledger — the money path).
`DATABASE_URL` there is a **different, local** DB (`…@localhost:5432/xeno_platform`) with its **own**
password (untouched by this rotation; its local Postgres enforces passwords too — it is **not**
trust). The first rotation edited `DATABASE_URL` (a no-op — it never held the old default) and left
`PLATFORM_DATABASE_URL` on the old password → `platformPool` threw `28P01` for ~13 min
(18:45→18:58) until fixed. **Always rotate `PLATFORM_DATABASE_URL` for the ledger; confirm with a
real `credit_accounts` query, not just `select 1`.** Follow-up candidate: the api box's local
`xeno_platform` DB is a separate password-enforced credential of unknown strength — assess/rotate
it independently.

### 3b. Reference — the per-service rotation recipes (for the next cred)

Redis (`--requirepass` is set from `REDIS_PASSWORD` at container start):
1. Set `REDIS_PASSWORD=NEW` and update `REDIS_URL=redis://:NEW@redis:6379` in `.env`.
2. `sudo docker compose up -d --force-recreate redis backend` and verify health.

Meili / Browserless / VNC: set `MEILI_MASTER_KEY` / `BROWSERLESS_TOKEN` / `VNC_PW` in `.env`,
recreate those services (+ backend for Browserless/Meili if it holds the value).

**Then** flip the compose defaults to **fail-fast** so a missing secret can never silently
run a weak default again (mirrors the existing `JWT_SECRET` fail-fast):
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}
REDIS_PASSWORD:    ${REDIS_PASSWORD:?REDIS_PASSWORD required}
MEILI_MASTER_KEY:  ${MEILI_MASTER_KEY:?MEILI_MASTER_KEY required}
BROWSERLESS_TOKEN: ${BROWSERLESS_TOKEN:?BROWSERLESS_TOKEN required}
VNC_PW:            ${VNC_PW:?VNC_PW required}
```
> Do this flip **only after** `.env` is fully populated — otherwise `docker compose` refuses
> to start. Deploy the compose change like any other (commit + rebuild is not needed for
> compose; `sudo docker compose up -d` picks it up).

**Risk (historical):** Medium — a botched DB-password change breaks backend connectivity. The
2026-07-14 rotation hit exactly that (Lesson 2) for ~13 min on the api-proxy money path before it
was corrected and verified. For the **next** cred rotation, keep the old password recoverable until
`/api/ready` (backend) AND a real `credit_accounts` query (api-proxy `platformPool`) are both green
on the new one.

**Remaining (optional hardening, non-urgent):** flip the compose defaults to `${VAR:?…}` fail-fast
(below). Now lower-value since the weak defaults no longer authenticate anyway (the roles hold the
new passwords), but it still turns a missing-secret misconfig into a loud failure instead of a
silent fallback.

---

## 4. Docker socket bind-mounted into two services — **MEDIUM, Phase 4**

**What:** `/var/run/docker.sock` is mounted into `backend` and `xenorun`
(`docker-compose.yml:148,289`) for container provisioning. A code-exec bug in either service
is **host-root-equivalent** (the Docker API can start a privileged container).

**Steps:** Put a **docker-socket-proxy** (e.g. `tecnativa/docker-socket-proxy`) in front of
the socket, exposing only the specific endpoints each service needs (containers create/start
for `xenorun`; whatever `backend` actually calls), and mount the **proxy** rather than the
raw socket. Deny by default; allow the minimum.

**Risk:** Medium — requires knowing exactly which Docker API calls each service makes; test
in staging or behind a feature flag.

---

## 5. App connects to Postgres as superuser — **MEDIUM, Phase 3/4 (defense-in-depth)**

**What:** The backend connects as `postgres` (superuser). The append-only ledger trigger
(`credit_transactions` INSERT-only) is therefore bypassable by the app itself — the money
guarantee rests on the app never issuing an UPDATE/DELETE, not on the DB forbidding it.

**Steps:** Create a non-superuser role (`xeno_app`) with `SELECT/INSERT` on ledger tables and
no `UPDATE/DELETE` on `credit_transactions`; point the backend at it. This makes the
append-only invariant enforced by Postgres, not just by convention.

**Risk:** Medium — must audit every write the app performs so the grant is complete; a missing
grant surfaces as a runtime failure. Stage it.

---

## Priority order

1. **§1 revoke the box PAT** — code-side DONE (token backs nothing); operator: 1-click revoke + rm the `-pat` backup.
2. **§2 rotate + strip client-exposed provider keys** (fast; verify-then-rotate) — operator, still open.
3. **§3 rotate infra credentials** — ✅ **DONE + verified** (all five, incl. `POSTGRES_PASSWORD`). Optional: fail-fast compose flip.
4. **§4 docker-socket-proxy**, **§5 non-superuser DB role** (Phase 3/4, behind testing).
5. **New (from §3a Lesson 2):** assess/rotate the api box's local `xeno_platform` DB credential (separate, password-enforced).

See `docs/PLATFORM-MODERNIZATION.md` for how these fit the overall roadmap (Phase 4 —
Security & least privilege).
