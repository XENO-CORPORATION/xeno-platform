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
#   BACKUP_GPG_RECIPIENT
#                 GPG key id/fingerprint to encrypt TO before upload. REQUIRED
#                 whenever R2_REMOTE is set — without it the offsite copy is
#                 skipped rather than sent in the clear.
#
set -eu

# One choke point for every R2 write in this chain — see scripts/lib/r2-put.sh
# for why a plain `rclone copy` reported failure on 100% of successful uploads.
# shellcheck source=lib/r2-put.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/r2-put.sh"

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
BACKUP_GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
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

# ---- offsite ---------------------------------------------------------------
# A dump carries password hashes, email addresses and the whole credit ledger, so
# it is ENCRYPTED BEFORE IT LEAVES THIS MACHINE. Never upload $OUTFILE itself.
#
# 🔴 THE BOX HOLDS ONLY THE PUBLIC KEY. It can encrypt its own backups and cannot
# read them back. Two properties fall out of that, and both are the point:
#   - a compromised server cannot decrypt its own history, and
#   - losing this box does not lose the ability to restore, because the private
#     half lives in the operator's ~/.xeno-secrets (and a password manager),
#     never here. `gpg --list-secret-keys` on this host must stay EMPTY.
#
# Encryption is REQUIRED once BACKUP_GPG_RECIPIENT is set: if gpg is missing or
# the encrypt fails we skip the upload rather than fall back to plaintext. A
# backup that quietly ships unencrypted is worse than one that does not ship.
if [ -n "$R2_REMOTE" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    log "WARN: R2_REMOTE set but rclone not installed; skipping offsite copy."
  elif [ -z "$BACKUP_GPG_RECIPIENT" ]; then
    log "WARN: R2_REMOTE set but BACKUP_GPG_RECIPIENT is not; refusing to upload a PLAINTEXT dump."
  elif ! command -v gpg >/dev/null 2>&1; then
    log "WARN: BACKUP_GPG_RECIPIENT set but gpg is missing; refusing to upload a PLAINTEXT dump."
  else
    ENCFILE="${OUTFILE}.gpg"
    if gpg --batch --yes --trust-model always            --recipient "$BACKUP_GPG_RECIPIENT"            --output "$ENCFILE" --encrypt "$OUTFILE" 2>>"$LOGFILE"; then
      # Refuse to ship something that is not actually an OpenPGP message — a
      # zero-byte or truncated artifact would upload happily and restore never.
      #
      # 🔴 --list-only IS LOAD-BEARING. Plain `--list-packets` ATTEMPTS DECRYPTION,
      # so on this host — which by design holds no secret key — it always exits 2
      # and the guard could never pass. That is worse than no guard: it refused a
      # perfectly good 693 MB artifact on 2026-09-11 and would have silently kept
      # every backup onsite forever while logging a plausible warning.
      # `--list-only` parses the packet structure WITHOUT decrypting: exit 0, and
      # it still proves a pubkey-encrypted session packet is present.
      #
      # Size is checked too: a truncated upload is the failure mode that looks
      # most like success. The dump is already compressed, so the ciphertext is
      # within a few percent of it; half is a generous floor that still catches
      # a stream cut short.
      ENC_OK=0
      if [ -s "$ENCFILE" ]          && gpg --batch --list-only --list-packets "$ENCFILE" 2>/dev/null | grep -q 'pubkey enc packet'; then
        PLAIN_SZ=$(wc -c <"$OUTFILE"); ENC_SZ=$(wc -c <"$ENCFILE")
        if [ "$ENC_SZ" -gt $(( PLAIN_SZ / 2 )) ]; then ENC_OK=1
        else log "WARN: ciphertext is $ENC_SZ bytes against a $PLAIN_SZ byte dump — truncated?"; fi
      fi
      if [ "$ENC_OK" -eq 1 ]; then
        if r2_put "$ENCFILE" "$R2_REMOTE" 2>>"$LOGFILE"; then
          log "OK: encrypted offsite copy pushed -> $R2_REMOTE ($(du -h "$ENCFILE" | cut -f1))"
        else
          log "WARN: R2 put/verify to '$R2_REMOTE' failed; local dump retained."
        fi
      else
        log "WARN: encrypted artifact failed its own sanity check; NOT uploading."
      fi
      rm -f "$ENCFILE"
    else
      log "WARN: gpg encryption failed; NOT uploading (refusing plaintext)."
      rm -f "$ENCFILE"
    fi
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
