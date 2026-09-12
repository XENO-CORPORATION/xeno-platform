# Disaster Recovery — xeno-platform Postgres (money ledger)

Runbook for backing up and restoring the production Postgres that holds the XENO
credit ledger (`credit_accounts`, `credit_transactions`, `credit_grants`,
`credit_holds`, `billing_*`, plus auth/workspace tables — **82 tables** total).

> This database is **live money**. Every procedure here is either read-only against
> production (backups) or restores into a **new throwaway database** (`dr_test_*`) or
> a **new cutover database** — never in place. Do not `DROP`/`ALTER` `xenostudio`.

---

## 0b. Alerting — two halves, and neither covers the other

Added 2026-09-12. Before this, **nothing on this box notified anybody of
anything.** `heartbeat.sh` was correct, ran every five minutes, and wrote
`external alerting is NOT active` into a log file no human reads. Every control
above it was silent in the same way: a stalled WAL shipper would have been
discovered at restore time.

| layer | where it runs | catches | cannot catch |
|---|---|---|---|
| `dr-alert.sh` (cron `*/15`, **armed**) | inside the VM | box UP, something broken | the box being gone |
| `xeno-host-alert` (timer `*/5`, **armed**) | **the Proxmox host** | guest paused / down / unreachable | the node itself dying |
| `heartbeat.sh` (cron `*/5`, **inert**) | inside the VM | node/site/network gone | anything subtle while it still pings |

🔴 **The middle row is the one that actually fired in anger.** VM 120 was paused
by a storage fault on 2026-09-11 13:14 and nobody was told, because the only
monitor lived inside the VM that was paused. `xeno-host-alert` runs one layer
below the guests on `bnkr-node-001`, so a frozen guest is fully visible — and it
reports NEW pause events even when `xeno-vm-iowatch` already resumed them, since
a money box freezing is worth knowing about even when it self-heals.

⚠️ **Two programs on purpose:** `xeno-vm-iowatch` *acts* (resumes, every 30s),
`xeno-host-alert` *notifies* (never touches a guest, every 5 min). A watchdog
that also mails is a watchdog that a mail timeout can wedge, and that one is the
safety net for 28 VMs.

⚠️ Its Resend key is cached at `/etc/xeno-alert.key` (0600, root) rather than
read from the platform container — **an alerting path that depends on the thing
it monitors is broken by design.**

🔴 **A monitor running on the machine it watches cannot report that machine being
down.** That is why both exist and why the second one is not optional. It needs
one thing: a ping URL from any external heartbeat monitor (Healthchecks.io,
BetterStack, UptimeRobot) written into `.heartbeat-url`. Until then the
"box is gone" case is uncovered.

`dr-alert.sh` checks: WAL backlog, `pg_stat_archiver.failed_count`, nightly dump
age, **physical base backup age**, offsite freshness read back from R2 (so the
whole chain is proven, not just the local end), disk pressure, container health,
and the live site returning 200. Recipient is `.alert-email`; sender is the
already-verified `noreply@xenostudio.ai`.

It mails **only on a change of state**, including an explicit all-clear — a
monitor that mails every 15 minutes is one people filter into a folder, and one
that never says "resolved" leaves you guessing.

**Verified in both directions on install**, which is the only reason to trust it:
healthy → all-clear delivered (HTTP 200); a forced real failure → alert delivered;
the same state repeated → nothing sent; back to healthy → all-clear delivered.

## 0a. The storage substrate underneath this box — measured 2026-09-12

🔴 **This VM pauses under you, and it did yesterday.** `xeno-platform-001` is
VM 120 on `bnkr-node-001`, and its disk
(`smb-vmstore:120/vm-120-disk-0.raw`, 120 GB, **fully allocated, not sparse**)
lives on a CIFS share. When that share stalls, QEMU faults the guest to
`io-error` — **paused, while `qm list` still reports it as `running`.** VM 120
was paused on 2026-09-11 13:14 and recovered only because the
`xeno-vm-iowatch` watchdog resumed it. Estate-wide: **119 resume events across
24 VMs.**

🔴 **The fix the workspace `CLAUDE.md` prescribes is ALREADY APPLIED AND DID NOT
WORK.** That file says the cause is a `soft` mount and the durable fix is to
remount `hard`. Measured today, in `/etc/pve/storage.cfg` *and* in
`/proc/mounts`, **`smb-vmstore` is already `hard`** — and the freezes continued
(three VMs inside 17 seconds on 2026-09-11). Anyone reading that entry will
"apply" a fix that is in place. Do not.

**What the kernel actually says**, which names the real cause:

```
CIFS: VFS: \\192.168.2.210 sends on sock ... stuck for 15 seconds   (repeatedly)
CIFS: VFS: \\192.168.2.210 Error -104 sending data on socket to server   (ECONNRESET)
CIFS: VFS: \\192.168.2.210 Error -32  sending data on socket to server   (EPIPE, x many)
CIFS: VFS: \\192.168.2.210 has not responded in 180 seconds. Reconnecting...
```

The server stops reading, then **resets the TCP connection**. `hard` means
"retry a timeout forever"; it does not help when the peer resets the socket —
in-flight I/O fails during the 180-second reconnect, and that is the pause.
**So this was never a mount-option problem and tuning mount options will not
fix it.** The fault is at `192.168.2.210`.

⚠️ **What `.210` is remains genuinely unresolved.** The workspace `CLAUDE.md`
calls it the operator's own Windows workstation sharing `E:\`; `XENO
INFRASTRUCTURE - INVENTORY.md` calls it a NAS appliance with port 445 only.
Probed from the node: **445 open, 22 closed, 3389 closed**, no NetBIOS reply,
anonymous SMB `NT_STATUS_ACCESS_DENIED`. That is consistent with the inventory
and does not confirm either. It cannot be diagnosed remotely — root-causing the
stall needs access to that machine.

### The one lever that removes this box from the blast radius

`local-lvm` on the node has **254 GB free** (832 GB, 69.5% used). VM 120's disk
is 120 GB fully allocated, so `qm move-disk 120 scsi0 local-lvm` — an **online**
move, no downtime — takes the money box off the network share entirely.

⚠️ **It is a real trade, not a free win:** it leaves ~134 GB of thin-pool
headroom shared with the **14 other VMs already on `local-lvm`**, and a full LVM
thin pool is a data-loss hazard rather than an outage. 25 VMs sit on the share;
this moves exactly one. Decide it deliberately.

## 0. Two backups, two different questions — you need BOTH

Added 2026-09-12. Until then this document described only the nightly `pg_dump`,
which meant the recovery point was **up to 24 hours**, and on a box that takes
money that was the largest single gap in the platform.

| | `pg-backup.sh` (nightly 03:15) | `pg-basebackup.sh` (weekly Sun 02:30) + `wal-ship.sh` (every 5 min) |
|---|---|---|
| Kind | **logical** (`pg_dump -Fc`) | **physical** base backup + continuous WAL |
| Answers | "give me yesterday's database" | "give me 10:42:07 this morning" |
| Recovery point | up to 24 h | **~5 minutes** (`archive_timeout=300`) |
| Portable across major versions | yes | no — same PG major only |

🔴 **A `pg_dump` cannot be a PITR restore point.** WAL replays onto a *physical*
copy of the cluster; there is nothing in a logical dump to replay onto. That is
why both exist and why neither is redundant. Deleting either one silently
removes a recovery capability.

### How the pieces fit

```
postgres (archive_mode=on, archive_timeout=300)
  └─ archive_command writes .tmp.<seg> then mv's it   ← atomic: a partial
     into ./wal_archive                                  segment can never ship
        └─ wal-ship.sh (cron */5)  gpg → r2backup:xeno-db-backups/wal/ → rm local
pg-basebackup.sh (cron Sun 02:30)  gpg → r2backup:xeno-db-backups/base/
```

### Restoring to a point in time

Take the newest `base-*.tar.gz` and every WAL segment from that point forward,
then in a scratch cluster (never over production):

```sh
tar xzf base-<stamp>.tar.gz -C $DATA
cat >>$DATA/postgresql.conf <<'CONF'
restore_command = 'cp /pitr_wal/%f %p'
recovery_target_time = '2026-09-12 10:34:02+00'
recovery_target_action = 'promote'
recovery_target_inclusive = false
CONF
touch $DATA/recovery.signal
docker run -d --name pitr-verify -v $DATA:/var/lib/postgresql/data   -v $WAL:/pitr_wal:ro -e POSTGRES_PASSWORD=x <same image> postgres -c archive_mode=off
```

Then verify **selectivity**, not just that it started: a restore that contains
everything proves only that the tar was readable. The 2026-09-12 verification
wrote one row before the target instant and one after, and the recovered cluster
held exactly the first — replay stopped where it was told.

⚠️ **Decryption cannot happen on the box, by design.** `gpg --list-secret-keys`
on `xeno-platform-001` returns **nothing**; only the public half
(`12B1F40D…`) is installed, so a compromised server can write backups it can
never read. A real offsite restore therefore runs wherever the private key is
held, not here. The mechanism above was proven on-box against the *local*
unencrypted artifacts; the encrypted round-trip is proven separately by the
dump restore in §2.

⚠️ **If WAL shipping stalls, `pg_wal` grows behind it and a full disk stops the
database.** `wal-ship.sh` logs `ALERT:` once the local archive passes 2 GB.
`/` on this box runs ~87% full, so that alert has real headroom but not much —
check `backups/wal-ship.log` when investigating any disk-space warning.

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

---

## 7. `SECRET_BOX_KEY` — a restore is no longer sufficient on its own

Since **2026-07-30**, the OAuth tokens in `youtube_channels` are stored encrypted
(AES-256-GCM, `src/server/utils/secretBox.js` — see `docs/SECURITY-HARDENING.md` §6).
That changes what a disaster recovery actually requires:

> **A database restore alone no longer recovers those tokens.** The dump contains
> ciphertext. Without `SECRET_BOX_KEY`, 100 connected YouTube channels are
> unrecoverable and every owner has to reconnect their channel by hand.

**Where the key lives — five copies, and only one of them matters for a real disaster:**

| Host | Path | Physical location |
|---|---|---|
| `xeno-platform-001` | `.env` → `SECRET_BOX_KEY` (live) | VM 120 **on `bnkr-node-001`** |
| `xeno-platform-001` | `/root/.xeno-secrets/secret-box-key` | VM 120 **on `bnkr-node-001`** |
| `xeno-mail-001` | `/root/.xeno-secrets/xeno-platform-secret-box-key` | VM 132 **on `bnkr-node-001`** |
| `bnkr-node-001` | `/root/.xeno-secrets/xeno-platform-secret-box-key` | the physical host |
| `htznr-bnkr-tunnel-001` | `/root/.xeno-secrets/xeno-platform-secret-box-key` | **Hetzner vServer — OFF-SITE** |

All `0600` root-only, all verified byte-identical by hash on 2026-07-30.

> **The topology matters more than the count.** `xeno-platform-001` and `xeno-mail-001`
> are not independent machines — they are VMs 120 and 132 on `bnkr-node-001`, which also
> runs the other 26 VMs in this estate on a single ASUS box behind one Deutsche Telekom
> line. Four of the five copies are therefore on **one physical machine**. They protect
> against a bad `.env` overwrite or a VM rebuild; they do **not** protect against that box
> dying. The Hetzner copy is the only one that survives it — different provider, different
> city, different power and network.

**`xeno-private-api-001` was deliberately excluded.** It holds an SSH tunnel to the
platform Postgres on `127.0.0.1:15433`, so a key copy there would put the key and the
ciphertext it opens on the *same* host — handing a single compromise both halves. Every
host that does hold a copy was checked to have no route to that database, which is what
makes a cleartext key file on them low-value: without the ciphertext, it opens nothing.

> This is replication, not escrow. It protects against **losing** the key, not against a
> host being **read**. A true escrow — the key encrypted under a passphrase only you hold —
> is still the last mile; see the end of this section.

### Keeping the copies honest

Replication creates its own failure mode: rotate the key on `xeno-platform-001` and forget
the rest, and you have four confidently wrong files. Restoring one during an incident does
not fail loudly — it re-encrypts live data under the wrong key and destroys the originals.

```sh
./scripts/secret-box-key-check.sh                    # read-only comparison of all five
./scripts/secret-box-key-check.sh --sync --confirm   # push the live key to every escrow
```

Run the check after **any** key rotation and after rebuilding any of those hosts. It
compares by sha256 and never prints the key. It has to run from the operator workstation:
the copies deliberately live on hosts that cannot reach one another, and granting them SSH
access to each other would weaken that isolation to solve a monitoring problem.

If it reports drift, do **not** restore a drifted copy first. Check
`/api/health` → `checks.secretbox`: if it says `ok`, the live key still opens the data, so
the live one is right and the escrows are merely stale — `--sync --confirm` fixes them.

### The cheap recovery path, and when it expires

The tokens were plaintext until the backfill, so the pre-backfill dump
`backups/xenostudio-20260730T162914.dump` still holds all 100 rows in cleartext —
verified on the day: 100 rows / 200 token values recoverable.

**Retention is 14 nightly dumps (§1), so that dump rolls off around 2026-08-13.** Keeping
it past that date is *not* recommended: it would park 100 live OAuth tokens in cleartext,
which is the exact exposure the encryption removed. The replication above is what replaces
it — let the dump age out.

### Silent-failure alarm (added 2026-07-30)

A **missing** key is loud: `encrypt()` is fail-closed, so the next channel connect throws.
A **wrong** key is silent — nothing throws on write, reads fail one row at a time, and the
first report comes from a customer. So `/api/health` publishes `checks.secretbox`, which
does not merely ask "is a key set" but decrypts real stored values and reports whether they
come back:

| status | meaning |
|---|---|
| `ok` | sampled values decrypted |
| `missing` | no key in the backend env — writes will throw |
| `mismatch` | a key is present but does **not** open the data — the dangerous one |
| `no-data` | nothing sealed yet |
| `unknown` | the check itself failed |

`xeno-watch` on `xeno-mail-001` alerts by mail on any transition into `missing`/`mismatch`
and on recovery. Like `checks.backup`, it deliberately does not affect the overall health
status — a key problem breaks one feature, it is not "the site is down".

> If you ever see `mismatch`: **do not let anything re-encrypt.** Writing under a wrong key
> destroys the originals. Compare the four copies by hash, restore the majority, redeploy,
> then require `failed: 0` from the verification block below.

### Still worth doing: a real off-infrastructure escrow

The four copies are all on machines you operate. To survive losing all of them, encrypt the
key under a passphrase only you know and keep the result anywhere (including a private
repo — the ciphertext is inert without the passphrase). Run this yourself, so the
passphrase never passes through anyone else's hands:

```sh
ssh xeno-platform-001 "sudo grep '^SECRET_BOX_KEY=' /mnt/projects/xeno-platform/.env" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -out xeno-secret-box-key.enc
# prompts for a passphrase; store xeno-secret-box-key.enc wherever you like

# to read it back later:
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in xeno-secret-box-key.enc
```

Verify the file decrypts **before** you rely on it. A passphrase you cannot reproduce is
the same as no backup.

### Verifying the key still matches the data

Non-destructive, prints no secret — confirms the running backend can still decrypt:

```sh
sudo docker exec xenostudio-backend node --input-type=module -e '
const {decrypt,isEncrypted}=await import("/app/utils/secretBox.js");
const pg=(await import("pg")).default;
const c=new pg.Client({connectionString:process.env.DATABASE_URL}); await c.connect();
const {rows}=await c.query("select access_token,refresh_token from youtube_channels");
let ok=0,bad=0;
for(const r of rows) for(const v of [r.access_token,r.refresh_token]) {
  if(!v||!isEncrypted(v)) continue;
  try { decrypt(v); ok++; } catch { bad++; }
}
console.log("decrypt ok:",ok," failed:",bad); await c.end();'
```

`failed: 0` means the key in the container matches the stored ciphertext. Any non-zero
`failed` means the environment holds the **wrong** key — stop and restore the right one
before writing anything, because re-encrypting under a wrong key destroys the originals.

### After a restore, or when moving the box

1. Restore the database as in §2.
2. Ensure `SECRET_BOX_KEY` is present in `.env` **and** passed through in
   `docker-compose.yml` (it is, in the `backend` service — do not drop it).
3. Run the verification block above; require `failed: 0`.
4. Only then let traffic in. If the key is missing, `encrypt()` throws by design, so
   channel connection fails loudly instead of silently reverting to plaintext.

---

## Offsite database backup — 2026-09-11

**Before this date no dump had ever left the box.** Nightly `pg-backup.sh` has run
since 2026-07-14 and produces verified local dumps, but `R2_REMOTE` was unset and
rclone was not installed, so all 14 restore points sat on the same disk as the
database — a CIFS share on the operator's workstation, and that host's own volume
is at 83%. One disk loss took the database and every backup of it together.

### What is in place now

| | |
|---|---|
| Bucket | `xeno-db-backups` (Cloudflare R2, WEUR) — **private**, managed public domain disabled and verified |
| Encryption | GPG 4096-bit RSA, fingerprint `12B1F40DEC4D7172AC76E395E0C0668AFE3DCE5C` |
| Public half | imported on `xeno-platform-001` (encrypt only) |
| Private half | `~/.xeno-secrets` → `XENO_DB_BACKUP_GPG_PRIVATE_B64` on the operator workstation. **Never on the server.** |
| Script | `scripts/pg-backup.sh` encrypts before upload; refuses to upload plaintext |

🔴 **The box cannot decrypt its own backups, by design.** `gpg --list-secret-keys`
on `xeno-platform-001` must stay EMPTY. A compromised server therefore cannot read
its own history, and losing the server does not lose the ability to restore.

⚠️ **The private key must ALSO be in a password manager.** `~/.xeno-secrets` is one
machine and is explicitly not a backup. If that workstation dies and the key exists
nowhere else, every offsite backup becomes unreadable — a worse failure than having
no offsite backup at all, because it looks safe.

### 🔴 Restoring needs pgvector

Found by doing it: a stock `postgres:15` fails the restore with **2,607 errors**,
starting `extension "vector" is not available`. Production runs
`pgvector/pgvector:0.8.6-pg15-bookworm`. Restore into that image, or the backup is
useless at the exact moment it is needed.

### The restore, proven 2026-09-11 (not asserted)

```bash
# 1. decrypt, on a machine that has the PRIVATE key — never on the server
export GNUPGHOME=$(mktemp -d); chmod 700 "$GNUPGHOME"
grep -m1 '^XENO_DB_BACKUP_GPG_PRIVATE_B64=' ~/.xeno-secrets | cut -d= -f2- \
  | base64 -d | gpg --batch --quiet --import
gpg --batch --decrypt xenostudio-<stamp>.dump.gpg > restore.dump

# 2. restore into a PRODUCTION-SHAPED postgres (pgvector, matching major version)
docker run -d --name restore-proof -e POSTGRES_PASSWORD=x -e POSTGRES_DB=restoretest \
  pgvector/pgvector:0.8.6-pg15-bookworm
docker cp restore.dump restore-proof:/tmp/d.dump
docker exec restore-proof pg_restore -U postgres -d restoretest \
  --no-owner --no-privileges /tmp/d.dump      # expect exit 0, zero stderr

# 3. tear down and SHRED the plaintext — it is a production database
docker rm -f restore-proof && shred -u restore.dump
```

Result on 2026-09-11 against the real 693 MB dump: **exit 0, zero errors**, and
point-in-time row counts **identical** to production for `users`,
`credit_accounts` and `credit_transactions`. The only tables absent were the two
created hours *after* that dump was taken.

### ⏸ The one step that is operator-only

The offsite copy cannot run until `xeno-platform-001` has an R2 credential scoped
to `xeno-db-backups`. Creating an R2 API token is a dashboard action — the
Cloudflare API token here can manage buckets but cannot mint S3 credentials.

🔴 **Do NOT reuse the existing account credential.** It can write to
`xeno-hub-releases`, whose moving pointers (`version.json`, `releases.json`,
`latest*.yml`) have **no object versioning** — a compromised box with that key
could destroy the release channel irrecoverably (ABSOLUTE RULE §2b). Scope the new
token to this one bucket, Object Read & Write.

Then, on the box:

```
# in /mnt/projects/xeno-platform/.env  (and nowhere world-readable)
R2_REMOTE=r2backup:xeno-db-backups
BACKUP_GPG_RECIPIENT=12B1F40DEC4D7172AC76E395E0C0668AFE3DCE5C
# plus an rclone remote `r2backup` (type s3, provider Cloudflare) with the scoped key
```

Verify by running the script once by hand and reading `backups/backup.log` for
`OK: encrypted offsite copy pushed`, then confirm the object is actually in the
bucket — a log line is not the same as an object.
