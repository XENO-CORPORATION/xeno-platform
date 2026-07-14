#!/usr/bin/env sh
#
# pg-backup.sh — disaster-recovery backup for the xeno-platform production Postgres.
#
# Runs ON the box (xeno-platform-001), invoked by cron as root. Takes a compressed
# custom-format pg_dump of the `xenostudio` money-ledger database out of the
# `xenostudio-postgres` Docker container, verifies its integrity, rotates old dumps,
# and (optionally, if configured) mirrors offsite to Cloudflare R2 via rclone.
#
# READ-ONLY with respect to production: pg_dump never mutates the source database.
#
# Usage:
#   sudo sh /mnt/projects/xeno-platform/scripts/pg-backup.sh
#   sudo BACKUP_KEEP=30 sh .../pg-backup.sh        # keep 30 dumps instead of 14
#   sudo R2_REMOTE=r2:xeno-db-backups sh .../pg-backup.sh   # also push offsite
#
# Environment overrides (all optional, sane defaults below):
#   BACKUP_DIR    where dumps + log live   (default /mnt/projects/xeno-platform/backups)
#   BACKUP_KEEP   how many dumps to retain (default 14)
#   PG_CONTAINER  postgres container name  (default xenostudio-postgres)
#   PG_DB         database to dump         (default xenostudio)
#   PG_USER       postgres role            (default postgres)
#   R2_REMOTE     rclone remote:path for offsite copy (default empty = disabled)
#
set -eu
# pipefail is not in the POSIX sh spec but bash/dash-on-Ubuntu support it; enable if available.
# shellcheck disable=SC3040
(set -o pipefail) 2>/dev/null && set -o pipefail || true

# ---- configuration ---------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-/mnt/projects/xeno-platform/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
PG_CONTAINER="${PG_CONTAINER:-xenostudio-postgres}"
PG_DB="${PG_DB:-xenostudio}"
PG_USER="${PG_USER:-postgres}"
R2_REMOTE="${R2_REMOTE:-}"
LOGFILE="${BACKUP_DIR}/backup.log"

# Use plain `docker` when root (cron), otherwise elevate with sudo for a manual run.
if [ "$(id -u)" -eq 0 ]; then
  DOCKER="docker"
elif command -v sudo >/dev/null 2>&1; then
  DOCKER="sudo docker"
else
  DOCKER="docker"
fi

# ---- logging ---------------------------------------------------------------
# Always append to the logfile; also echo to the terminal when run interactively
# so a cron redirect (>> backup.log 2>&1) does not double-write the same lines.
log() {
  _ts="$(date '+%Y-%m-%dT%H:%M:%S%z')"
  printf '%s %s\n' "$_ts" "$*" >>"$LOGFILE" 2>/dev/null || printf '%s %s\n' "$_ts" "$*" >&2
  if [ -t 1 ]; then
    printf '%s %s\n' "$_ts" "$*"
  fi
}

fail() {
  log "ERROR: $*"
  exit 1
}
trap 'rc=$?; if [ "$rc" -ne 0 ]; then log "ERROR: backup aborted (exit $rc)"; fi' EXIT

# ---- preflight -------------------------------------------------------------
mkdir -p "$BACKUP_DIR"

# Confirm the container is running before we start (clear error beats a cryptic dump failure).
if ! $DOCKER inspect -f '{{.State.Running}}' "$PG_CONTAINER" 2>/dev/null | grep -q true; then
  fail "container '$PG_CONTAINER' is not running; aborting."
fi

STAMP="$(date '+%Y%m%dT%H%M%S')"
OUTFILE="${BACKUP_DIR}/${PG_DB}-${STAMP}.dump"
TMPFILE="${OUTFILE}.partial"

log "=== backup start: db=$PG_DB container=$PG_CONTAINER keep=$BACKUP_KEEP ==="

# ---- dump ------------------------------------------------------------------
# -Fc = custom format (compressed, selective-restore capable). No TTY (-i not needed
# for output-only). Write to a .partial file first so a crash never leaves a
# half-written file that looks like a valid dump to the rotation logic.
if ! $DOCKER exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DB" >"$TMPFILE"; then
  rm -f "$TMPFILE"
  fail "pg_dump failed for database '$PG_DB'."
fi

# ---- verify ----------------------------------------------------------------
# 1) non-empty
if [ ! -s "$TMPFILE" ]; then
  rm -f "$TMPFILE"
  fail "dump is empty."
fi

# 2) pg_restore --list must parse the archive (feed it back through the container's
#    pg_restore over stdin — proves the TOC is intact without touching any database).
if ! $DOCKER exec -i "$PG_CONTAINER" pg_restore --list >/dev/null 2>>"$LOGFILE" <"$TMPFILE"; then
  rm -f "$TMPFILE"
  fail "pg_restore --list could not parse the dump (corrupt archive)."
fi

# Promote the verified dump to its final name only now.
mv "$TMPFILE" "$OUTFILE"
SIZE="$(du -h "$OUTFILE" | cut -f1)"
log "OK: verified dump written -> $OUTFILE ($SIZE)"

# ---- offsite (optional, future-proof) --------------------------------------
# Only attempts when rclone is installed AND R2_REMOTE is set. Its absence is NOT
# an error — local rotated dumps are the current deliverable; offsite is opt-in.
if [ -n "$R2_REMOTE" ]; then
  if command -v rclone >/dev/null 2>&1; then
    if rclone copy "$OUTFILE" "$R2_REMOTE" 2>>"$LOGFILE"; then
      log "OK: offsite copy pushed -> $R2_REMOTE"
    else
      # Do not fail the whole run: the local verified dump already exists.
      log "WARN: rclone copy to '$R2_REMOTE' failed; local dump retained."
    fi
  else
    log "WARN: R2_REMOTE set but rclone not installed; skipping offsite copy."
  fi
fi

# ---- rotate ----------------------------------------------------------------
# Reached only after a fully verified dump (set -e aborts earlier on failure), so
# we never prune history on the strength of a bad backup.
COUNT="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${PG_DB}-*.dump" | wc -l | tr -d ' ')"
if [ "$COUNT" -gt "$BACKUP_KEEP" ]; then
  N_DELETE="$((COUNT - BACKUP_KEEP))"
  log "rotating: $COUNT dumps present, keep=$BACKUP_KEEP, deleting $N_DELETE oldest."
  # Oldest first (timestamped names sort lexically == chronologically).
  find "$BACKUP_DIR" -maxdepth 1 -type f -name "${PG_DB}-*.dump" | sort | head -n "$N_DELETE" | while IFS= read -r old; do
    rm -f "$old" && log "rotated out: $old"
  done
else
  log "rotation: $COUNT dumps present, keep=$BACKUP_KEEP, nothing to delete."
fi

log "=== backup done ==="
exit 0
