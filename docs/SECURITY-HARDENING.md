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

## 1. Live GitHub PAT embedded in the box git remote — **HIGH, do first**

**What:** The box repo's git remote URLs (`/mnt/projects/xeno-platform/.git/config`) embed a
live `ghp_…` personal access token in plaintext:
`https://ghp_…@github.com/XENO-CORPORATION/xeno-platform.git` (and a second remote to
`emiliancristea/xeno-platform`). Anyone who can read that file (or a leaked backup/`docker
cp` of it) gets push access to both repos.

**Why it matters:** It is a standing credential leak with write access to source. The deploy
pipeline does **not** use the box git remote (it ships `git archive HEAD` from the
workstation — see `docs/DEPLOY.md`), so this token is not even needed on the box.

**Steps (operator — needs GitHub):**
1. **Revoke** the token: GitHub → Settings → Developer settings → Personal access tokens →
   revoke the `ghp_…` token currently on the box.
2. The box git repo is already broken (`No commits yet`, a stray `.git.backup/`) and unused
   by deploys. Either **remove the embedded-token remotes**:
   ```bash
   ssh xeno-platform-001 'cd /mnt/projects/xeno-platform && sudo git remote remove origin; sudo git remote remove emilian-personal'
   ```
   or, if you want the box repo usable, set a **tokenless** remote and authenticate via a
   short-lived credential or a deploy key instead of an inline PAT.
3. If any automation genuinely needs GitHub from the box, mint a **fine-grained** token
   scoped to a single repo + `contents:read`, stored in the box `.env` (not in a git URL).

**Risk:** None to the running stack — nothing serving depends on the box git remote.

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

**Steps — CAREFUL, STAGED (changing a live DB password can lock out the backend):**

Postgres (`POSTGRES_PASSWORD` only takes effect on first-init, so the running role still has
the old password — you must ALTER it, not just change the env):
1. Pick a strong password `NEW`.
2. `ALTER USER` on the live role:
   `ssh box 'sudo docker exec xenostudio-postgres psql -U postgres -c "ALTER USER postgres PASSWORD '\''NEW'\''"'`
3. Update the box `.env`: set `DB_PASSWORD=NEW` **and** `POSTGRES_PASSWORD=NEW` (keep them equal).
4. Recreate the backend so it reconnects: `sudo docker compose up -d --force-recreate backend`
   and confirm `curl 127.0.0.1:8080/api/ready` → 200. (Postgres itself needs no restart.)

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

**Risk:** Medium — a botched DB-password change breaks backend connectivity. Do it in a
maintenance window; keep the old password until `/api/ready` is green on the new one.

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

1. **§1 revoke the box PAT** (fast, zero stack risk, standing write-access leak).
2. **§2 rotate + strip client-exposed provider keys** (fast; verify-then-rotate).
3. **§3 rotate infra credentials + fail-fast compose** (staged, maintenance window).
4. **§4 docker-socket-proxy**, **§5 non-superuser DB role** (Phase 3/4, behind testing).

See `docs/PLATFORM-MODERNIZATION.md` for how these fit the overall roadmap (Phase 4 —
Security & least privilege).
