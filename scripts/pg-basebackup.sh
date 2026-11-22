#!/usr/bin/env bash
#
# pg-basebackup.sh — the PHYSICAL base backup that point-in-time recovery replays WAL onto.
#
# 🔴 This is NOT a duplicate of pg-backup.sh. That one takes a LOGICAL pg_dump, which restores a database as of the
# moment it ran and cannot have WAL applied to it. Point-in-time recovery needs a physical copy of the cluster plus the
# WAL written since, so the two backups answer different questions and both are required:
#     pg-backup.sh     -> "give me yesterday's database"     (portable, slow to replay)
#     pg-basebackup.sh -> "give me 10:42:07 this morning"    (with wal-ship.sh)
#
# Runs on the box from cron (Sundays), as root. One pipe, encrypted before it touches the disk:
#
#   pg_basebackup -Ft -z -X none  ─┬─►  gzip -t            (the archive is whole: proven while it streams)
#                                  └─►  gpg --encrypt (public key only)  ─►  one ciphertext  ─►  r2_put  ─►  R2 base/
#
# 🔴 WHY -X none (2026-11-22): it was -X fetch, which needs every WAL segment from the backup's start to still exist when
# it ends. At this database's write rate they were recycled first, so every run from 2026-11-08 failed ("requested WAL
# segment … has already been removed") and the newest base backup was 2026-11-02. The WAL is shipped to R2 every five
# minutes (wal-ship.sh), and the proven restore (dr-restore-proof.sh) replays it from there with restore_command, so a
# base backup needs no WAL of its own. Its stamp records the WAL position it starts from.
#
# 🔴 WHY no local copy (2026-11-22): it wrote the tar here and an encrypted copy beside it, and kept two. The cluster grew
# to 23 GB on a 116 GB disk that Postgres also writes to. Now only one ciphertext is held while it uploads, and nothing
# is ever deleted on R2: retention is the bucket's own policy, a person's decision.
#
# On success it writes $BACKUP_DIR/.last-base-ok (time, object, bytes); dr-alert.sh reads it. READ-ONLY on production.
#
set -euo pipefail
# shellcheck source=lib/r2-put.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/r2-put.sh"

BACKUP_DIR="${BACKUP_DIR:-/mnt/projects/xeno-platform/backups}"
PG_CONTAINER="${PG_CONTAINER:-xenostudio-postgres}"
PG_USER="${PG_USER:-postgres}"
R2_REMOTE="${R2_REMOTE:-}"
BACKUP_GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
LOGFILE="${LOGFILE:-$BACKUP_DIR/basebackup.log}"
STAMP_FILE="$BACKUP_DIR/.last-base-ok"
DOCKER="docker"; [ "$(id -u)" -eq 0 ] || DOCKER="sudo docker"

log() {
  local ts; ts="$(date '+%Y-%m-%dT%H:%M:%S%z')"
  printf '%s %s\n' "$ts" "$*" >>"$LOGFILE" 2>/dev/null || printf '%s %s\n' "$ts" "$*" >&2
  [ -t 1 ] && printf '%s %s\n' "$ts" "$*" || true
}
fail() { log "ERROR: $*"; exit 1; }

mkdir -p "$BACKUP_DIR"
[ -n "$R2_REMOTE" ] || fail "R2_REMOTE is not set: a base backup with nowhere to go is not a backup."
[ -n "$BACKUP_GPG_RECIPIENT" ] || fail "BACKUP_GPG_RECIPIENT is not set: refusing to upload a PLAINTEXT base backup."
command -v rclone >/dev/null || fail "rclone is not installed."
command -v gpg >/dev/null || fail "gpg is not installed."
$DOCKER inspect -f '{{.State.Running}}' "$PG_CONTAINER" 2>/dev/null | grep -q true || fail "container '$PG_CONTAINER' is not running."

NAME="base-$(date -u '+%Y%m%dT%H%M%S').tar.gz.gpg"
DEST="${R2_REMOTE%/}/base/${NAME}"
INFLIGHT_DIR="$BACKUP_DIR/.inflight"
INFLIGHT="$INFLIGHT_DIR/$NAME"     # the final name: r2_put's check compares by name
mkdir -p "$INFLIGHT_DIR"; rm -f "$INFLIGHT_DIR"/base-*.tar.gz.gpg   # a crashed earlier run's leftover
WORK="$(mktemp -d)"
log "=== base backup start: container=$PG_CONTAINER -> $DEST (-X none; WAL comes from the archive) ==="

# ---- room: one compressed copy of the cluster, plus a margin --------------------------------------------------------
# gzip of this cluster is at most its size (it is mostly base64 text, which compresses), so the cluster's size bounds it.
DB_BYTES="$($DOCKER exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -Atc 'SELECT sum(pg_database_size(datname)) FROM pg_database' 2>>"$LOGFILE")" \
  || fail "could not measure the cluster's size"
NEED_KB=$(( DB_BYTES / 1024 + 5 * 1024 * 1024 ))
FREE_KB="$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
[ "$FREE_KB" -ge "$NEED_KB" ] \
  || fail "not enough disk for a base backup: $((FREE_KB / 1048576)) GB free, $((NEED_KB / 1048576)) GB needed (the $((DB_BYTES / 1073741824)) GB cluster + 5 GB). Nothing written."

# ---- the pipe ---------------------------------------------------------------------------------------------------------
# A backup that fails must not keep running: pg_basebackup runs INSIDE the container, and the host side of docker exec
# dying does not stop it (2026-11-21, pg-backup.sh). Its session is named, and the exit trap ends it.
APP="xeno-base-${NAME%.tar.gz.gpg}"
stop_backup() {
  $DOCKER exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -Atc \
    "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE application_name = '$APP'" 2>/dev/null || true
}
trap 'rc=$?; n=$(stop_backup); [ "${n:-0}" = 0 ] || log "stopped $n leftover base backup session(s) named $APP"; rm -rf "$WORK"; rm -f "$INFLIGHT"; [ "$rc" -eq 0 ] || log "ERROR: base backup aborted (exit $rc)"' EXIT

set +e
$DOCKER exec -e PGAPPNAME="$APP" "$PG_CONTAINER" pg_basebackup -U "$PG_USER" -h 127.0.0.1 -D - -Ft -z -X none --checkpoint=fast 2>>"$LOGFILE" \
  | tee >(gzip -t 2>>"$LOGFILE"; echo $? >"$WORK/gzip.rc") \
  | gpg --batch --yes --trust-model always --recipient "$BACKUP_GPG_RECIPIENT" --encrypt --output "$INFLIGHT" 2>>"$LOGFILE"
STATUS=("${PIPESTATUS[@]}")
set -e
sleep 1   # the process substitution writes its result as it exits
GZ_RC="$(cat "$WORK/gzip.rc" 2>/dev/null || echo missing)"
if [ "${STATUS[0]}" -ne 0 ] || [ "${STATUS[1]}" -ne 0 ] || [ "${STATUS[2]}" -ne 0 ] || [ "$GZ_RC" != 0 ]; then
  fail "base backup failed: pg_basebackup=${STATUS[0]} tee=${STATUS[1]} gpg=${STATUS[2]} gzip-test=${GZ_RC}; nothing uploaded, nothing kept."
fi
ENC_BYTES="$(wc -c <"$INFLIGHT" | tr -d '[:space:]')"
[ "$ENC_BYTES" -ge 1048576 ] || fail "encrypted base backup is only $ENC_BYTES bytes; nothing uploaded."
gpg --batch --list-only --list-packets "$INFLIGHT" 2>/dev/null | grep -q 'pubkey enc packet' \
  || fail "the encrypted base backup is not an OpenPGP public-key message; nothing uploaded."

# ---- upload (the proven known-size copy, then a byte-for-byte check) ------------------------------------------------
r2_put "$INFLIGHT" "${R2_REMOTE%/}/base" 2>>"$LOGFILE" \
  || { rclone deletefile "$DEST" 2>/dev/null || true; fail "upload or byte check to $DEST failed; removed."; }
STORED="$(rclone size --json "$DEST" 2>/dev/null | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
[ "$STORED" = "$ENC_BYTES" ] || { rclone deletefile "$DEST" 2>/dev/null || true; fail "stored ${STORED:-missing} bytes against $ENC_BYTES; removed."; }
rm -f "$INFLIGHT"
log "OK: encrypted base backup stored at $DEST ($(numfmt --to=iec "$ENC_BYTES" 2>/dev/null || echo "$ENC_BYTES bytes"); gzip, packet, bytes and size verified; nothing kept here)"
printf '%s %s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$DEST" "$ENC_BYTES" >"$STAMP_FILE"
log "=== base backup done: nothing deleted (retention is the bucket's policy) ==="
