# Inference routing — VPS deployment runbook

**What ships:** the provider-key vault and per-product routing on this origin.
The write UI is the API portal at `https://api.xenostudio.ai/dashboard/inference`
— not Overview. `/overview/ai-keys` redirects there. Backend **and** a DB
migration live here; the portal BFF proxies the user's Bearer to
`/api/v2/inference/*`.

**Spec:** `XENO INFERENCE ROUTING - SPEC.md` · **Secret handling:**
`XENO CREDENTIAL HYGIENE - PLAYBOOK.md` §8 · **Deploy mechanics:**
`release-guide/04-build-and-deploy.md` (read §3 and §4 — this runbook assumes
them and only adds what is different).

**Branch:** `feat/byok-egress` (platform + gateway)

**Hosts:** `xeno-platform-001` (vault, grants, `/api/ai/chat`) and, when
flipping the flag, `xeno-private-api-001` (gateway grant exchange). Do not
set `SECRET_BOX_KEY` on the API box. Do not flip `BYOK_ENABLED=true` until
`INFERENCE_GRANT_TOKEN` is set on **both** hosts and the grant tests are green.

---

## 0. The two things that make this deploy different

Everything else in `release-guide/04` applies unchanged. These two do not appear
there because no previous content deploy had either property.

**0.1 — 🔴 The migration runs at BACKEND BOOT, and a failure keeps the backend
down.** `src/server/index.js:3769` calls `runAllMigrations(pool)`, which
"rethrows on first failure". There is no separate migrate step to run and check
first: shipping the backend *is* running the migration, and a migration that
throws means `xenostudio-backend` does not come up. The whole API — not this
feature — is down until it is fixed.

That is why §2 stages the migration against a **scratch database first**. It is
also why the backend goes before the frontend: a frontend calling endpoints that
do not exist yet degrades (the page shows "not enabled"); a backend that will not
boot is an outage.

**0.2 — `up -d frontend` can leave a gap.** Documented in `release-guide/04` §3.3
and worth re-reading: on 2026-08-14 it restarted `backend`, timed out waiting for
health, and left `xenostudio-frontend` in state `Created` — **502 for ~12 minutes**,
invisible to `docker ps` (it takes `docker ps -a` to see it). The recovery is a
plain re-run once the dependency is healthy.

---

## 1. Pre-flight — all local, nothing touched on the box

```bash
cd xeno-platform
npm test                      # 371 pass / 0 fail, incl. 25 inference-routing
npm run build                 # vite + prerender must be clean
git log --oneline -1          # must be YOUR commit — see §6
```

Then confirm the box is in the state this runbook assumes:

```bash
ssh xeno-platform-001 'cd /mnt/projects/xeno-platform && sudo docker compose ps'
curl -s https://xenostudio.ai/api/health | jq '.checks.secretbox'
```

**`secretbox` must report `ok`, not merely "present".** The vault has no
foundation without it, and `mismatch` is the dangerous state — the site keeps
serving while every sealed read fails one row at a time (hygiene §R5).

> ⚠️ `SECRET_BOX_KEY` is already set in production and is already protecting
> stored YouTube tokens. **Do not rotate, regenerate or "clean up" that value as
> part of this deploy.** Losing it makes every sealed secret unrecoverable.

---

## 2. Stage the migration against a scratch database FIRST

Because of §0.1, the migration is proven before it can take the API down. This is
hygiene §D1 (*a backup nobody has restored is a hypothesis*) applied to the
forward direction.

```bash
ssh xeno-platform-001

# Backup first — this is the rollback for everything below.
sudo docker exec xenostudio-postgres pg_dump -U postgres xenostudio \
  | gzip > ~/xenostudio-pre-inference-$(date +%Y%m%d-%H%M).sql.gz

# Prove the dump RESTORES, into a scratch db. A dump that has never been
# restored is not a backup.
sudo docker exec xenostudio-postgres psql -U postgres -c 'CREATE DATABASE xeno_migration_check;'
gunzip -c ~/xenostudio-pre-inference-*.sql.gz \
  | sudo docker exec -i xenostudio-postgres psql -U postgres -d xeno_migration_check

# Apply BOTH new migrations to the scratch copy and read the result.
# scp the two files up first. Order is load-bearing — grants FK to credentials.
#
# ⚠ `psql < migration.sql` runs the `-- DOWN` half too and DROPS the tables
# it just created. The boot runner (`runAllMigrations`) splits on `-- DOWN`
# and applies UP only. Scratch must do the same: feed psql the UP half.
python3 - <<'PY'
from pathlib import Path
for name in (
    '20260822110000-inference-routing.sql',
    '20260822120000-inference-grants.sql',
):
    src = Path('/tmp') / name
    text = src.read_text()
    up = text.split('-- DOWN', 1)[0]
    dest = Path(str(src) + '.up')
    dest.write_text(up)
    print(name, 'up_bytes', len(up))
PY
sudo docker exec -i xenostudio-postgres psql -U postgres -d xeno_migration_check \
  < /tmp/20260822110000-inference-routing.sql.up
sudo docker exec -i xenostudio-postgres psql -U postgres -d xeno_migration_check \
  < /tmp/20260822120000-inference-grants.sql.up

# Both tables, both CHECK constraints, both FK behaviours, and the grant table.
sudo docker exec xenostudio-postgres psql -U postgres -d xeno_migration_check \
  -c '\d user_provider_credentials' -c '\d inference_routes' -c '\d inference_grants'
```

**Expected:** `upc_secret_is_sealed`, `ir_byok_needs_credential`, `ON DELETE
CASCADE` to `users`, `ON DELETE RESTRICT` to `user_provider_credentials`,
`inference_grants` with `grant_hash` and **no secret column**.

Only when that is clean:

```bash
sudo docker exec xenostudio-postgres psql -U postgres -c 'DROP DATABASE xeno_migration_check;'
```

---

## 3. Ship the backend

The deploy streams **committed** files (`git archive HEAD`) — uncommitted edits
silently do not ship (`release-guide/04` §3.2).

```bash
git archive --format=tar HEAD \
  src/server/index.js \
  src/server/routes/v2InferenceRoutes.js \
  src/server/routes/inferenceCredentialRoutes.js \
  src/server/routes/inferenceServiceRoutes.js \
  src/server/routes/inferenceGrantAuth.js \
  src/server/routes/aiRoutes.js \
  src/server/services/providerCredentials.js \
  src/server/services/inferenceGrants.js \
  src/server/utils/safeEndpoint.js \
  src/server/utils/xenoChat.js \
  src/server/utils/inferenceMeter.js \
  src/server/utils/requestSurface.js \
  src/server/utils/recordInferenceUsage.js \
  src/server/middleware/requestLogger.js \
  src/server/database/migrations/20260822110000-inference-routing.sql \
  src/server/database/migrations/20260822120000-inference-grants.sql \
| ssh xeno-platform-001 "cd /mnt/projects/xeno-platform && sudo tar xf - --overwrite \
   && find src/server/routes/v2InferenceRoutes.js \
           src/server/routes/inferenceCredentialRoutes.js \
           src/server/routes/inferenceServiceRoutes.js \
           src/server/routes/inferenceGrantAuth.js \
           src/server/routes/aiRoutes.js \
           src/server/services/providerCredentials.js \
           src/server/services/inferenceGrants.js \
           src/server/utils/safeEndpoint.js \
           src/server/utils/xenoChat.js \
           src/server/utils/inferenceMeter.js \
           src/server/utils/requestSurface.js \
           src/server/utils/recordInferenceUsage.js \
           src/server/middleware/requestLogger.js \
           src/server/index.js \
           src/server/database/migrations/20260822110000-inference-routing.sql \
           src/server/database/migrations/20260822120000-inference-grants.sql \
      -exec sudo sed -i 's/\r\$//' {} + \
   && sudo docker compose build backend"
```

CRLF normalisation is required (this repo is developed on win32) and **must
never touch binaries** — the file list above is all text, deliberately explicit
rather than a glob.

**Do not archive-overwrite `docker-compose.yml`.** The box file carries
`REGISTRATION_OPEN_UNTIL` and other lockdown values that are not all in the
repo. After the backend files land, surgically add the grant-token
passthrough if it is missing:

```bash
ssh xeno-platform-001 'cd /mnt/projects/xeno-platform && sudo grep -n INFERENCE_GRANT_TOKEN docker-compose.yml || true'
# If absent, insert next to BYOK_ENABLED — do not replace the file.
```

The repo compose already declares both `BYOK_ENABLED` and
`INFERENCE_GRANT_TOKEN` so a future full deploy has them; that is not
permission to clobber the live file today.

**Build first, swap separately**, so a failed build never removes a running
container:

```bash
ssh xeno-platform-001 'cd /mnt/projects/xeno-platform && sudo docker compose up -d backend'
ssh xeno-platform-001 'sudo docker logs --tail 40 xenostudio-backend | grep -i migrat'
```

**The migration applied when the log says so and the backend reached healthy.**
If the backend does not come up, go to §7 immediately — this is the outage case.

---

## 4. Ship the frontend

```bash
git archive --format=tar HEAD \
  src/pages/Overview.tsx \
  src/components/overview/OverviewTaskbar.tsx \
| ssh xeno-platform-001 "cd /mnt/projects/xeno-platform && sudo tar xf - --overwrite \
   && find src/pages/Overview.tsx src/components/overview/OverviewTaskbar.tsx \
      -exec sudo sed -i 's/\r\$//' {} + \
   && sudo rm -f src/components/account/InferenceRoutingPage.tsx \
                 src/services/inferenceRoutingService.ts \
   && sudo docker compose build frontend"

ssh xeno-platform-001 'cd /mnt/projects/xeno-platform && sudo docker compose up -d frontend'
ssh xeno-platform-001 'sudo docker ps -a --filter name=xenostudio-frontend'
```

`docker ps -a`, not `docker ps` — per §0.2, the failure mode is a container in
state `Created` that the plain listing does not show at all.

**The Overview files only remove the old write UI and keep the redirect.**
Do not re-add `InferenceRoutingPage.tsx` on the box. Key management is
`https://api.xenostudio.ai/dashboard/inference`.

---

## 5. Turn it on — a separate, reversible act

Deploying code and enabling a feature are two decisions. Keep them two commands.

```bash
# INFERENCE_GRANT_TOKEN must already be on BOTH hosts (platform + gateway).
# Do not flip the flag before that — exchange would 401 and every BYOK
# chat would fail closed (correct) while looking like an outage.
ssh xeno-platform-001
cd /mnt/projects/xeno-platform
sudo grep -q '^BYOK_ENABLED=' .env || echo 'BYOK_ENABLED=true' | sudo tee -a .env
sudo docker compose up -d backend
```

Only the exact string `true` enables it (`BYOK_ENABLED=1` and `TRUE` both leave
it OFF, by design and by test). Reverting is the same edit and the same restart.

---

## 6. Verify OUTCOMES, not exit paths

A command that printed something is not evidence. This workspace has already
reported a **stale HEAD** as a successful push.

```bash
# The tables exist IN PRODUCTION, not just in a migration file.
ssh xeno-platform-001 "sudo docker exec xenostudio-postgres psql -U postgres -d xenostudio \
  -c \"select tablename from pg_tables where tablename in
       ('user_provider_credentials','inference_routes','inference_grants');\""

# The route answers, and the flag reads as intended.
curl -s https://xenostudio.ai/api/v2/inference/providers -H "Authorization: Bearer $TOK" | jq

# Encryption still healthy AFTER the deploy.
curl -s https://xenostudio.ai/api/health | jq '.checks.secretbox'

# The old Overview path still 200s (SPA shell) and redirects in the browser.
# The write UI is the API portal.
curl -sI https://api.xenostudio.ai/dashboard/inference | head
```

Then the end-to-end proof, in the browser, signed in on **api.xenostudio.ai**:
add a key → it is verified with the provider before saving → point one product
at it → reload → the choice persisted → delete the key → **refused** with the
product named (spec D10).

**And the money assertion, which is the whole point:**

```sql
-- Must be zero, forever. A non-zero row means a user was billed for a request
-- they routed to their own key.
SELECT count(*) FROM api_usage_logs
 WHERE request_params->>'path' = 'byok' AND coalesce(actual_cost_micro,0) <> 0;
```

---

## 7. Rollback

| Symptom | Action |
|---|---|
| Backend will not boot after the migration | `sudo docker compose exec postgres psql -U postgres -d xenostudio` → `DROP TABLE inference_grants; DROP TABLE inference_routes; DROP TABLE user_provider_credentials; DELETE FROM schema_migrations WHERE version IN ('20260822110000','20260822120000');` then redeploy the previous `index.js`. The `-- DOWN` sections are exactly this. |
| Feature misbehaving, backend healthy | Set `BYOK_ENABLED=` (empty) and `up -d backend`. Instant, reversible, keeps the tables. **Prefer this** — it is the reason the flag exists. |
| Frontend in state `Created`, site 502 | `sudo docker compose up -d frontend` again once `backend` is healthy (§0.2). |
| Data loss | Restore the §2 dump. It was proven restorable before anything changed. |

**Reach for the flag before the migration rollback.** Dropping tables that may
already hold customer credentials is destructive; turning the flag off is not.

---

## 8. Do not undo the lockdown

`xenostudio.ai` is deliberately de-indexed and signup is gated
(`REGISTRATION_OPEN_UNTIL=2026-08-28`, set in the **box's** `docker-compose.yml`,
not the repo's). This deploy ships a repo `docker-compose.yml` — **confirm the
box's registration and noindex state survives it**, per
`release-guide/skill/SKILL.md` §0.5 and the `xeno-secure-website` skill.

```bash
curl -sI https://xenostudio.ai | grep -i x-robots-tag     # must still be noindex
ssh xeno-platform-001 'cd /mnt/projects/xeno-platform && sudo grep REGISTRATION_OPEN_UNTIL docker-compose.yml'
```

> ⚠️ The box's `docker-compose.yml` has historically carried values that were
> never committed. **Diff before overwriting it**, and never `git reset --hard`
> the box to catch it up — that is the exact move that would have unset
> `LEDGER_V2_ENABLED` on the system that meters money.

Never wall `/api/` — the OIDC provider lives at `/api/oauth2/*` and blocking it
breaks sign-in for every shipped product.

---

## 9. What this deploy does NOT do

Stated so nobody reports it as a regression:

- **BYOK does not serve until `BYOK_ENABLED=true` AND `INFERENCE_GRANT_TOKEN`
  is set on platform and gateway.** Flag off is still today's `400
  byok_unavailable`. That is fail-closed, not a missing feature.
- **Do not set `SECRET_BOX_KEY` on `xeno-private-api-001`.** Grant exchange
  is the hop. Spec §6.1.
- **Products that never send `X-Xeno-Surface` still stamp `legacy:xeno_api`.**
  Per-product numbers become real as each product adopts the account SDK.
- **10 of 14 products have never signed in**, so most rows will read "never
  signed in". That is accurate, not a bug.

---

## 10. `xeno-private-api-001` — grant exchange (P3)

Ship `byokEgress.js` + the `server.js` / `package.json` wiring. Do not set
`SECRET_BOX_KEY` on this box. Do not set `PLATFORM_DATABASE_URL` as part of
the same change.

```bash
# From the xeno-api-proxy checkout, after the commit is on the branch:
scp byokEgress.js server.js package.json xeno-private-api-001:/tmp/byok-egress/
# Then on the box, copy into the running tree (measure the path first —
# historically /home/bunker/apps/xeno-api-proxy) and
#   pm2 restart xeno-api-proxy --update-env
# only AFTER INFERENCE_GRANT_TOKEN is in that tree's .env.
```

`INFERENCE_GRANT_TOKEN` must be the **same value** as on `xeno-platform-001`.
Install it from a one-line file, never by interpolating the value into an
ssh command that a log will capture.

---

## 11. What this still does not do

P3 grant exchange is this deploy. These remain:

| Work | Host | Phase |
|---|---|---|
| Tracking view in `xeno-api-platform/portal` | `xeno-private-api-001` | **P5** |
| `surface` carrying the real `client_id` instead of the `legacy:xeno_api` bucket | both | **P4** (header exists; products still have to send it) |

**🔴 The one rule to carry into P3.** `xeno-api-proxy` already contains code for
a direct pooled connection to the platform Postgres (`PLATFORM_DATABASE_URL`),
and it is **not configured in production** — verified: the running process has 90
environment variables and none of them is that one, nor `SECRET_BOX_KEY`, which
is **absent from the whole box**.

So the fastest P3 is to set both and let the gateway `SELECT secret_encrypted`
and decrypt it in place. **Refuse that.** It puts the decryption key for every
customer's provider credential on a second host, makes the secret readable in two
services, and replaces a logged, bounded, revocable grant exchange with an
unlogged `SELECT`. `SECRET_BOX_KEY` never leaves `xeno-platform-001`.

`PLATFORM_DATABASE_URL` on the gateway may be legitimate on its own, for usage
recording — that is what the dormant pool is for. **The two must never be enabled
as one change.** Spec §6.1.
