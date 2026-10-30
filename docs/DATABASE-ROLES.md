# Database roles

Who connects to the platform's Postgres as what, and how the schema changes. Decision and reasoning:
`docs/decisions/2026-10-30-ledger-chain-v2.md`.

## The roles

| Role | Used by | May do |
|---|---|---|
| `postgres` (superuser) | The `migrate` job only. Backups run inside the Postgres container | Everything |
| `xeno_app` | The backend and chat-workers (`DATABASE_URL`, `DB_USER`) | Read and write data. **No schema changes.** Append to `credit_transactions` but not edit it; read the chain's records but not move them; no `ledger_chain_reseal` |
| `xeno_gateway_runtime`, `xeno_portal_runtime`, `xeno_gateway_maintenance`, `xeno_execution_worker`, `xeno_agents_meter`, `xeno_xep_owner` | The API gateway host and its services | Their own narrow grants, unchanged by this |

`src/server/database/runtime-role.js` defines `xeno_app`'s grants. They are re-applied at the end of every migration run,
so a table added by any migration is covered with no second step.

## How the schema changes

1. A change goes in `src/server/database/migrations/` (or `migrate-account-v2.js` for the ledger).
2. `scripts/remote-deploy.sh` runs the **`migrate` job** with the new image before swapping the backend. A failed job stops
   the deploy with the old containers still serving. Migrations stay additive, so those containers are unharmed.
3. The backend starts as `xeno_app`, reads `schema_migrations`, and **refuses to serve** if a migration is pending or the
   ledger's chain trigger is missing or disabled (`assertSchemaReady`, `src/server/services/startupSchema.js`).

The connection's role decides which path runs, not a setting: a superuser connection (local runs, tests) still migrates at
startup, as it always did.

**Never run DDL during a request.** `xeno_app` cannot, tests run as a superuser and would not notice, and it would fail in
production on whichever request reached it. `scripts/no-request-time-ddl.test.mjs` fails the build on it. Three helpers
keep a create-if-missing fallback for bare test databases; each asks `tablesPresent` first, so the app never reaches it.

## Credentials

Both live in the box's `/mnt/projects/xeno-platform/.env`, never in the repo:

- `POSTGRES_PASSWORD`: the superuser. Reaches only the Postgres container and the `migrate` job.
- `XENO_APP_DB_PASSWORD`: the backend and chat-workers.

The role is created `NOLOGIN` by the migration, because a password never belongs in a migration. Login is set once on the box:

```bash
# Sets the password from .env without printing it or placing it on a command line
sudo sh -c 'P=$(grep "^XENO_APP_DB_PASSWORD=" /mnt/projects/xeno-platform/.env | cut -d= -f2-); \
  printf "ALTER ROLE xeno_app LOGIN PASSWORD '"'"'%s'"'"';\n" "$P"' \
  | sudo docker exec -i xenostudio-postgres sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

To rotate: change `.env`, run the same command, recreate the backend and chat-workers.

## Checking it

```bash
sudo docker exec <backend> printenv DB_USER                       # xeno_app
sudo docker exec <backend> sh -c 'printenv | grep -c POSTGRES_PASSWORD'  # 0
```

```sql
SELECT usename, count(*) FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1;
```

Then look for refusals, which are how a missed grant would show up:

```bash
sudo docker logs --since 1h xenostudio-postgres 2>&1 | grep -i "permission denied"
```

## Going back

If the app misbehaves as `xeno_app`, restore the previous compose file and recreate:

```bash
cd /mnt/projects/xeno-platform
sudo cp .deploy/docker-compose.pre-<sha>-backend.yml docker-compose.yml
sudo docker compose --project-name xeno-platform --env-file .env up -d --no-deps --force-recreate backend chat-workers
```

No data changes either way: the role only limits what a connection may do.
