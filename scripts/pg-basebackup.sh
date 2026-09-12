#!/usr/bin/env sh
#
# pg-basebackup.sh — the PHYSICAL base backup that PITR replays WAL onto.
#
# 🔴 This is NOT a duplicate of pg-backup.sh. That one takes a LOGICAL pg_dump,
# which restores a database as of the moment it ran and cannot have WAL applied
# to it. Point-in-time recovery needs a physical copy of the cluster plus the
# WAL written since — so the two backups answer different questions and both
# are required:
#     pg-backup.sh     -> "give me yesterday's database"     (portable, slow to replay)
#     pg-basebackup.sh -> "give me 10:42:07 this morning"    (with wal-ship.sh)
#
# Runs on the box from cron, as root.
#
set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail || true

BASE_DIR="${BASE_DIR:-/mnt/projects/xeno-platform/backups/base}"
PG_CONTAINER="${PG_CONTAINER:-xenostudio-postgres}"
PG_USER="${PG_USER:-postgres}"
R2_REMOTE="${R2_REMOTE:-}"
BACKUP_GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
BASE_KEEP="${BASE_KEEP:-2}"
LOGFILE="${LOGFILE:-/mnt/projects/xeno-platform/backups/basebackup.log}"

if [ "$(id -u)" -eq 0 ]; then DOCKER="docker"; else DOCKER="sudo docker"; fi

log() {
  _ts="$(date '+%Y-%m-%dT%H:%M:%S%z')"
  printf '%s %s\n' "$_ts" "$*" >>"$LOGFILE" 2>/dev/null || printf '%s %s\n' "$_ts" "$*" >&2
  [ -t 1 ] && printf '%s %s\n' "$_ts" "$*" || true
}
fail() { log "ERROR: $*"; exit 1; }
trap 'rc=$?; [ "$rc" -ne 0 ] && log "ERROR: base backup aborted (exit $rc)" || true' EXIT

mkdir -p "$BASE_DIR"
$DOCKER inspect -f '{{.State.Running}}' "$PG_CONTAINER" 2>/dev/null | grep -q true \
  || fail "container '$PG_CONTAINER' is not running"

STAMP="$(date -u '+%Y%m%dT%H%M%S')"
OUT="$BASE_DIR/base-${STAMP}.tar.gz"

log "=== base backup start: container=$PG_CONTAINER keep=$BASE_KEEP ==="

# -Ft -z -Xf: tar, gzip, and FETCH the WAL needed to make the backup consistent
# into the tar itself, so the base is self-sufficient even if a segment has not
# shipped yet. --checkpoint=fast so we do not wait on a spread checkpoint.
# Streams to stdout -> straight to the host file; nothing large lands in the container.
if ! $DOCKER exec "$PG_CONTAINER" pg_basebackup \
      -U "$PG_USER" -h 127.0.0.1 -D - -Ft -z -Xfetch --checkpoint=fast 2>>"$LOGFILE" >"$OUT"; then
  rm -f "$OUT"; fail "pg_basebackup failed"
fi

SIZE="$(du -h "$OUT" | cut -f1)"
# Integrity: gzip -t reads the whole stream. A truncated base backup that still
# "exists" is the failure mode worth catching here, not at restore time.
gzip -t "$OUT" 2>>"$LOGFILE" || { rm -f "$OUT"; fail "base backup failed gzip integrity check"; }
log "OK: base backup written $OUT ($SIZE), gzip integrity verified"

if [ -n "$R2_REMOTE" ]; then
  if [ -z "$BACKUP_GPG_RECIPIENT" ]; then
    log "WARN: R2_REMOTE set but BACKUP_GPG_RECIPIENT is not; refusing to upload a PLAINTEXT base backup."
  elif ! command -v rclone >/dev/null 2>&1; then
    log "WARN: R2_REMOTE set but rclone not installed; skipping offsite copy."
  else
    ENC="${OUT}.gpg"
    if gpg --batch --yes --trust-model always --recipient "$BACKUP_GPG_RECIPIENT" \
           --output "$ENC" --encrypt "$OUT" 2>>"$LOGFILE" \
       && rclone copy "$ENC" "$R2_REMOTE/base/" 2>>"$LOGFILE"; then
      log "OK: encrypted base backup pushed -> $R2_REMOTE/base/ ($(du -h "$ENC" | cut -f1))"
    else
      log "WARN: offsite push failed; local base backup retained."
    fi
    rm -f "$ENC"
  fi
fi

COUNT="$(ls -1 "$BASE_DIR"/base-*.tar.gz 2>/dev/null | wc -l)"
if [ "$COUNT" -gt "$BASE_KEEP" ]; then
  ls -1t "$BASE_DIR"/base-*.tar.gz | tail -n "$((COUNT - BASE_KEEP))" | while read -r old; do
    rm -f "$old" && log "rotated out: $old"
  done
fi
log "=== base backup complete ==="
exit 0
