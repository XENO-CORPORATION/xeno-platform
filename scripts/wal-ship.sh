#!/usr/bin/env sh
#
# wal-ship.sh — move archived WAL segments offsite, encrypted.
#
# Postgres archives completed WAL segments into WAL_DIR (see docker-compose.yml:
# archive_command writes .tmp.<name> then mv's it, so anything without a dot
# prefix is COMPLETE — a partial file can never be shipped).
#
# This runs on the box from cron. For each segment: encrypt to the DR public key,
# upload to R2, and only then delete the local copy. A failed upload keeps the
# raw segment for the next run; it is never deleted on a path that did not
# confirm the upload.
#
# 🔴 WAL is useless without a base backup to replay onto — pg-basebackup.sh is
# the other half. Neither alone is PITR.
#
set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail || true

WAL_DIR="${WAL_DIR:-/mnt/projects/xeno-platform/wal_archive}"
R2_REMOTE="${R2_REMOTE:-}"
BACKUP_GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
LOGFILE="${LOGFILE:-/mnt/projects/xeno-platform/backups/wal-ship.log}"
# Loud alert threshold: if the archive backs up past this, shipping is broken and
# pg_wal will grow behind it. Postgres wedges when the DISK fills, not when this
# trips, so this is an early warning with room to act.
WARN_MB="${WARN_MB:-2048}"

log() {
  _ts="$(date '+%Y-%m-%dT%H:%M:%S%z')"
  printf '%s %s\n' "$_ts" "$*" >>"$LOGFILE" 2>/dev/null || printf '%s %s\n' "$_ts" "$*" >&2
  [ -t 1 ] && printf '%s %s\n' "$_ts" "$*" || true
}

[ -d "$WAL_DIR" ] || { log "ERROR: WAL_DIR $WAL_DIR does not exist"; exit 1; }
if [ -z "$R2_REMOTE" ]; then log "ERROR: R2_REMOTE unset; refusing to run (local-only WAL is not DR)"; exit 1; fi
if [ -z "$BACKUP_GPG_RECIPIENT" ]; then log "ERROR: BACKUP_GPG_RECIPIENT unset; refusing to upload PLAINTEXT WAL"; exit 1; fi
command -v rclone >/dev/null 2>&1 || { log "ERROR: rclone not installed"; exit 1; }
command -v gpg    >/dev/null 2>&1 || { log "ERROR: gpg not installed"; exit 1; }

SHIPPED=0; FAILED=0
for f in "$WAL_DIR"/*; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  case "$base" in .*) continue ;; esac          # .tmp.* = mid-copy, skip
  case "$base" in *.gpg) rm -f "$f"; continue ;; # stale encrypt from a crashed run
  esac

  enc="${f}.gpg"
  rm -f "$enc"
  if ! gpg --batch --yes --trust-model always --recipient "$BACKUP_GPG_RECIPIENT" \
           --output "$enc" --encrypt "$f" 2>>"$LOGFILE"; then
    log "WARN: gpg failed for $base; retaining raw segment"
    rm -f "$enc"; FAILED=$((FAILED+1)); continue
  fi

  if rclone copy "$enc" "$R2_REMOTE/wal/" 2>>"$LOGFILE"; then
    rm -f "$f" "$enc"
    SHIPPED=$((SHIPPED+1))
  else
    log "WARN: rclone copy failed for $base; retaining raw segment for the next run"
    rm -f "$enc"; FAILED=$((FAILED+1))
  fi
done

BACKLOG_MB="$(du -sm "$WAL_DIR" 2>/dev/null | cut -f1)"
if [ -n "${BACKLOG_MB:-}" ] && [ "$BACKLOG_MB" -ge "$WARN_MB" ]; then
  log "ALERT: WAL archive backlog is ${BACKLOG_MB} MB (>= ${WARN_MB} MB). Shipping is not keeping up; pg_wal will grow behind it."
fi

[ "$SHIPPED" -gt 0 ] || [ "$FAILED" -gt 0 ] && log "shipped=$SHIPPED failed=$FAILED backlog=${BACKLOG_MB:-?}MB" || true
exit 0
