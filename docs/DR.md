# Disaster Recovery — xeno-platform Postgres (money ledger)

Runbook for backing up and restoring the production Postgres that holds the XENO
credit ledger (`credit_accounts`, `credit_transactions`, `credit_grants`,
`credit_holds`, `billing_*`, plus auth/workspace tables — **82 tables** total).

> This database is **live money**. Every procedure here is either read-only against
> production (backups) or restores into a **new throwaway database** (`dr_test_*`) or
> a **new cutover database** — never in place. Do not `DROP`/`ALTER` `xenostudio`.

---

## 1. What is backed up, where, retention

| | |
|---|---|
| **Source** | Docker container `xenostudio-postgres` (postgres:15-alpine), database `xenostudio`, on `xeno-platform-001` |
| **Method** | `pg_dump -Fc` (custom format, compressed, selective-restore capable) — **read-only**, does not lock out writers |
| **Script** | `/mnt/projects/xeno-platform/scripts/pg-backup.sh` (source of truth in repo: `scripts/pg-backup.sh`) |
| **Destination** | `/mnt/projects/xeno-platform/backups/xenostudio-YYYYMMDDTHHMMSS.dump` (on-box, local disk) |
| **Log** | `/mnt/projects/xeno-platform/backups/backup.log` (timestamped, appended) |
| **Retention** | Last **14** dumps (override with `BACKUP_KEEP`). Older dumps pruned **only after** a new dump passes verification. |
| **Schedule** | root cron, nightly **03:15** server time (UTC on this box) |
| **Offsite** | **Not yet wired** — rclone is not installed on the box. See §6. Until then, backups are single-site (same disk as the DB). |
| **Size** | ~523 MB per dump today; 14 dumps ≈ 7.3 GB. Box had ~60 GB free at setup. |

### Integrity guarantees built into the backup

- Dump is written to a `*.partial` file, then verified, then atomically renamed — a
  crash never leaves a truncated file that looks like a good dump.
- Verification = **non-empty** AND `pg_restore --list` parses the archive TOC
  (feeds the dump back through the container's `pg_restore` over stdin; touches no DB).
- On any failure the script **exits non-zero and does NOT rotate**, so a bad backup
  can never delete good history.

---

## 2. Restore procedure (the real thing — cutover)

Restore is done into a **new database**, verified, then cut over by renaming. The
old database is renamed aside (kept), never dropped, so a bad restore is reversible.

All commands run on `xeno-platform-001`. `docker` needs `sudo` on this box.

```sh
# 0. Pick the dump to restore (newest is first).
DUMP=$(sudo ls -1t /mnt/projects/xeno-platform/backups/xenostudio-*.dump | head -1)
echo "restoring: $DUMP"

# 1. Copy the dump into the container.
sudo docker cp "$DUMP" xenostudio-postgres:/tmp/restore.dump

# 2. Create a fresh target database and restore into it.
sudo docker exec xenostudio-postgres psql -U postgres -c "CREATE DATABASE xenostudio_restore"
sudo docker exec xenostudio-postgres \
  pg_restore -U postgres -d xenostudio_restore --no-owner --no-privileges /tmp/restore.dump

# 3. VERIFY before cutover — table count + ledger row counts must look right.
sudo docker exec xenostudio-postgres psql -U postgres -d xenostudio_restore -tAc \
  "SELECT count(*) AS tables FROM information_schema.tables WHERE table_schema='public'"
for t in credit_transactions credit_accounts credit_grants credit_holds users; do
  sudo docker exec xenostudio-postgres psql -U postgres -d xenostudio_restore -tAc \
    "SELECT '$t='||count(*) FROM $t"
done
```

### Cutover (only after verification passes)

Stop the apps that write to the DB first (so no writes are lost mid-swap), then swap
by rename. Postgres cannot rename a database that has open connections, so terminate
them first.

```sh
# Stop backend writers (adjust to the compose services that hold DB connections).
cd /mnt/projects/xeno-platform && sudo docker compose stop backend api || true

# Terminate remaining connections to the live DB, then rename old aside + new in.
sudo docker exec xenostudio-postgres psql -U postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('xenostudio','xenostudio_restore') AND pid <> pg_backend_pid()"
sudo docker exec xenostudio-postgres psql -U postgres -c \
  "ALTER DATABASE xenostudio RENAME TO xenostudio_old_$(date +%Y%m%d%H%M%S)"
sudo docker exec xenostudio-postgres psql -U postgres -c \
  "ALTER DATABASE xenostudio_restore RENAME TO xenostudio"

# Restart writers, smoke-test, then (only once happy) drop the old DB.
cd /mnt/projects/xeno-platform && sudo docker compose start backend api
# sudo docker exec xenostudio-postgres psql -U postgres -c "DROP DATABASE xenostudio_old_XXXXXXXX"
```

If anything looks wrong after cutover, reverse it: rename `xenostudio` back to
`xenostudio_restore` and `xenostudio_old_*` back to `xenostudio`.

---

## 3. Test-restore (safe, non-destructive — do this regularly)

Proves a dump is genuinely restorable without touching production. Restores into a
throwaway `dr_test_*` DB, compares row counts against prod, then drops it.

```sh
DUMP=$(sudo ls -1t /mnt/projects/xeno-platform/backups/xenostudio-*.dump | head -1)
sudo docker cp "$DUMP" xenostudio-postgres:/tmp/dr_restore.dump
sudo docker exec xenostudio-postgres psql -U postgres -c "DROP DATABASE IF EXISTS dr_test_restore"
sudo docker exec xenostudio-postgres psql -U postgres -c "CREATE DATABASE dr_test_restore"
sudo docker exec xenostudio-postgres \
  pg_restore -U postgres -d dr_test_restore --no-owner --no-privileges /tmp/dr_restore.dump

# Compare prod vs restored — every row count MUST match.
for t in credit_transactions credit_accounts credit_grants credit_holds users; do
  a=$(sudo docker exec xenostudio-postgres psql -U postgres -d xenostudio      -tAc "SELECT count(*) FROM $t")
  b=$(sudo docker exec xenostudio-postgres psql -U postgres -d dr_test_restore -tAc "SELECT count(*) FROM $t")
  [ "$a" = "$b" ] && echo "$t: MATCH ($a)" || echo "$t: *** MISMATCH prod=$a restore=$b ***"
done

# Teardown — always drop the throwaway DB and remove the in-container copy.
sudo docker exec xenostudio-postgres psql -U postgres -c "DROP DATABASE dr_test_restore"
sudo docker exec xenostudio-postgres rm -f /tmp/dr_restore.dump
```

**Last verified round-trip (2026-07-14):** all six metrics matched prod exactly —
`public_tables=82`, `credit_transactions=129494`, `credit_accounts=20`,
`credit_grants=6`, `credit_holds=13`, `users=154`.

---

## 4. The installed cron

Installed in the **root** crontab (`sudo crontab -l`):

```cron
# XENO DR: nightly Postgres money-ledger backup
15 3 * * * /mnt/projects/xeno-platform/scripts/pg-backup.sh >> /mnt/projects/xeno-platform/backups/backup.log 2>&1
```

The `cron` daemon (`/usr/sbin/cron`, `systemctl is-active cron` → `active`) runs it.
The script self-logs to `backup.log`; the redirect is a safety net that also captures
any unexpected stderr. Runs as root, so it calls `docker` directly (no sudo needed).

To change retention or add offsite, edit the environment on the cron line, e.g.:

```cron
15 3 * * * BACKUP_KEEP=30 R2_REMOTE=r2:xeno-db-backups /mnt/projects/xeno-platform/scripts/pg-backup.sh >> /mnt/projects/xeno-platform/backups/backup.log 2>&1
```

### systemd-timer alternative (if cron is ever removed)

```ini
# /etc/systemd/system/xeno-pg-backup.service
[Service]
Type=oneshot
ExecStart=/mnt/projects/xeno-platform/scripts/pg-backup.sh

# /etc/systemd/system/xeno-pg-backup.timer
[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
[Install]
WantedBy=timers.target
```
`sudo systemctl enable --now xeno-pg-backup.timer` then `systemctl list-timers | grep pg-backup`.

---

## 5. Monitoring / what "healthy" looks like

- `sudo tail backup.log` should show a nightly `OK: verified dump written` + `backup done`.
- A run that fails logs `ERROR:` and exits non-zero **without** rotating — the previous
  night's good dumps are preserved.
- Alerting is not yet wired. Minimum manual check: once a week, confirm the newest
  dump's date in `/mnt/projects/xeno-platform/backups/` is < 24h old and run the §3
  test-restore.

---

## 6. OPERATOR FOLLOW-UP — enable offsite (Cloudflare R2)

**Current gap:** dumps live on the **same disk as the database**. A disk/host loss
takes both. The backup script is already offsite-ready but disabled because `rclone`
is not installed. To close the gap:

1. **Install rclone on the box**

   ```sh
   sudo -v ; curl https://rclone.org/install.sh | sudo bash
   rclone version
   ```

2. **Configure an R2 remote** named `r2` (S3-compatible). Use an R2 API token scoped
   to a dedicated backups bucket (e.g. `xeno-db-backups`), not the releases bucket.

   ```sh
   rclone config
   # n) new remote -> name: r2 -> storage: s3 -> provider: Cloudflare
   # access_key_id / secret_access_key = R2 token pair
   # endpoint = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   ```
   Verify: `rclone lsd r2:` and `rclone mkdir r2:xeno-db-backups`.

3. **Set `R2_REMOTE` on the cron line** so each nightly dump is mirrored offsite:

   ```cron
   15 3 * * * R2_REMOTE=r2:xeno-db-backups /mnt/projects/xeno-platform/scripts/pg-backup.sh >> /mnt/projects/xeno-platform/backups/backup.log 2>&1
   ```

   The script pushes with `rclone copy` **after** local verification. If rclone is
   missing or the push fails, it logs a `WARN` and keeps the local dump — offsite is
   best-effort and never fails the backup.

4. **(Recommended) R2 lifecycle + retention.** The script rotates the *local* copies
   (keep 14). It does **not** delete anything on R2, so set an R2 bucket lifecycle rule
   (e.g. expire objects after 90 days) so offsite storage doesn't grow unbounded.

5. **(Recommended) Restore drill from R2.** Once offsite is live, periodically
   `rclone copy r2:xeno-db-backups/<file> /tmp/` and run the §3 test-restore on it, to
   prove the *offsite* copy is restorable, not just the local one.
