#!/usr/bin/env bash
#
# pg-backup.sh — nightly disaster-recovery backup of the production Postgres, STREAMED to R2.
#
# Runs ON the box (xeno-platform-001), by root's cron. One pipe, no file on this disk:
#
#   pg_dump -Fc (compressed)  ─┬─►  pg_restore --list   (the archive parses: proven while it streams)
#                              └─►  gpg --encrypt (public key only)  ─►  one ciphertext file  ─►  r2_put  ─►  R2
#
# 🔴 Why streamed (owner, 2026-11-21: the backups failed for a week because the box filled up): the old script wrote
# the dump, then an encrypted copy beside it, then kept 3 dumps — about 4× the dump's size on a 116 GB disk holding a
# 23 GB database. When the disk filled, pg_dump and gpg both died with "no space left on device", from 2026-11-17 on,
# and the last offsite copy was 11-14. Now the plaintext never touches the disk, only one ciphertext is held while it
# uploads (deleted on every exit), and retention lives on R2.
#
# 🔴 THE BOX HOLDS ONLY THE PUBLIC KEY. It encrypts its own backups and cannot read them back: a compromised server cannot
# decrypt its history, and losing the box does not lose the ability to restore (the private half is in the operator's
# ~/.xeno-secrets and a password manager). `gpg --list-secret-keys` on this host must stay EMPTY. Nothing is ever
# uploaded in plaintext: without R2_REMOTE and BACKUP_GPG_RECIPIENT the script refuses to run.
#
# On success it writes $BACKUP_DIR/.last-backup-ok (time, object, bytes); dr-alert.sh mails if that goes stale, so a
# failed night reaches a person. READ-ONLY on production: pg_dump never changes the database.
#
# Usage (as root's cron does):
#   BACKUP_KEEP=14 R2_REMOTE=r2backup:xeno-db-backups BACKUP_GPG_RECIPIENT=<fpr> pg-backup.sh
#
# Environment:
#   R2_REMOTE             rclone remote:path (REQUIRED)
#   BACKUP_GPG_RECIPIENT  key fingerprint to encrypt TO (REQUIRED)
#   BACKUP_KEEP           nightly objects kept on R2 (default 14; older nightly objects are deleted after a good run)
#   BACKUP_DIR            where the log and the success stamp live (default /mnt/projects/xeno-platform/backups)
#   PG_CONTAINER, PG_DB, PG_USER   (defaults xenostudio-postgres, xenostudio, postgres)
#
set -euo pipefail
# shellcheck source=lib/r2-put.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/r2-put.sh"

BACKUP_DIR="${BACKUP_DIR:-/mnt/projects/xeno-platform/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
PG_CONTAINER="${PG_CONTAINER:-xenostudio-postgres}"
PG_DB="${PG_DB:-xenostudio}"
PG_USER="${PG_USER:-postgres}"
R2_REMOTE="${R2_REMOTE:-}"
BACKUP_GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
LOGFILE="${BACKUP_DIR}/backup.log"
STAMP_FILE="${BACKUP_DIR}/.last-backup-ok"
DOCKER="docker"; [ "$(id -u)" -eq 0 ] || DOCKER="sudo docker"

log() {
  local ts; ts="$(date '+%Y-%m-%dT%H:%M:%S%z')"
  printf '%s %s\n' "$ts" "$*" >>"$LOGFILE" 2>/dev/null || printf '%s %s\n' "$ts" "$*" >&2
  [ -t 1 ] && printf '%s %s\n' "$ts" "$*" || true
}
fail() { log "ERROR: $*"; exit 1; }
WORK="$(mktemp -d)"
trap 'rc=$?; rm -rf "$WORK"; [ "$rc" -eq 0 ] || log "ERROR: backup aborted (exit $rc)"' EXIT

mkdir -p "$BACKUP_DIR"
[ -n "$R2_REMOTE" ] || fail "R2_REMOTE is not set: a backup with nowhere to go is not a backup."
[ -n "$BACKUP_GPG_RECIPIENT" ] || fail "BACKUP_GPG_RECIPIENT is not set: refusing to upload a PLAINTEXT dump."
command -v rclone >/dev/null || fail "rclone is not installed."
command -v gpg >/dev/null || fail "gpg is not installed."
[[ "$BACKUP_KEEP" =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_KEEP must be a positive number."
$DOCKER inspect -f '{{.State.Running}}' "$PG_CONTAINER" 2>/dev/null | grep -q true || fail "container '$PG_CONTAINER' is not running."

NAME="${PG_DB}-$(date -u '+%Y%m%dT%H%M%S').dump.gpg"
DEST="${R2_REMOTE%/}/${NAME}"
INFLIGHT_DIR="${BACKUP_DIR}/.inflight"
INFLIGHT="${INFLIGHT_DIR}/${NAME}"   # the final name: r2_put's check compares by name
mkdir -p "$INFLIGHT_DIR"; rm -f "$INFLIGHT_DIR"/*.dump.gpg   # a crashed earlier run's leftover
log "=== backup start: db=$PG_DB -> $DEST keep=$BACKUP_KEEP (encrypted in the pipe; no plaintext on disk) ==="

# ---- the pipe --------------------------------------------------------------------------------------------------------
# pg_dump -Fc is encrypted INSIDE the pipe, so the plaintext never touches this disk. tee also feeds pg_restore --list
# (proves the archive's table of contents parses). Only the ciphertext is written here, once, and deleted on every exit.
# Why a file at all: this box's rclone (1.60) cannot stream an unknown-size upload to R2 (measured 2026-11-21: every
# `rclone rcat` variant answered NotImplemented), while the known-size copy + byte check below is proven. Peak disk is
# one encrypted copy, against the old scheme's plaintext dump + ciphertext + three kept dumps.
# Every stage's exit status is checked (PIPESTATUS), so a dump cut short can never upload as if whole.
# The `cat >/dev/null` is load-bearing: pg_restore --list reads only the table of contents at the head of the stream
# and exits, and without a reader tee meets a closed pipe and pg_dump dies of SIGPIPE (exit 141, measured 2026-11-21).
# 🔴 A dump that fails must not keep running. pg_dump runs INSIDE the container, and when the host side of `docker exec`
# dies the process in the container does not: on 2026-11-21 two failed runs left two full pg_dumps reading production
# for 30 minutes, each holding an open snapshot (which holds back VACUUM and blocks a migration's DDL), writing to
# nobody. So each run names its database session (PGAPPNAME) and, on any exit, ends whatever session still has that name.
APP="xeno-backup-${NAME%.dump.gpg}"
stop_dump() {
  $DOCKER exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -Atc \
    "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE application_name = '$APP'" 2>/dev/null || true
}
trap 'rc=$?; n=$(stop_dump); [ "${n:-0}" = 0 ] || log "stopped $n leftover pg_dump session(s) named $APP"; rm -rf "$WORK"; rm -f "$INFLIGHT"; [ "$rc" -eq 0 ] || log "ERROR: backup aborted (exit $rc)"' EXIT
set +e
$DOCKER exec -e PGAPPNAME="$APP" "$PG_CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DB" 2>>"$LOGFILE" \
  | tee >($DOCKER exec -i "$PG_CONTAINER" pg_restore --list >/dev/null 2>>"$LOGFILE"; echo $? >"$WORK/list.rc"; cat >/dev/null) \
  | gpg --batch --yes --trust-model always --recipient "$BACKUP_GPG_RECIPIENT" --encrypt --output "$INFLIGHT" 2>>"$LOGFILE"
STATUS=("${PIPESTATUS[@]}")
set -e
sleep 1   # the process substitution writes its result as it exits
LIST_RC="$(cat "$WORK/list.rc" 2>/dev/null || echo missing)"
if [ "${STATUS[0]}" -ne 0 ] || [ "${STATUS[1]}" -ne 0 ] || [ "${STATUS[2]}" -ne 0 ] || [ "$LIST_RC" != 0 ]; then
  fail "dump failed: pg_dump=${STATUS[0]} tee=${STATUS[1]} gpg=${STATUS[2]} pg_restore-list=${LIST_RC}; nothing uploaded, nothing kept."
fi
ENC_BYTES="$(wc -c <"$INFLIGHT" | tr -d '[:space:]')"
[ "$ENC_BYTES" -ge 1048576 ] || fail "encrypted dump is only $ENC_BYTES bytes; nothing uploaded."
# --list-only parses the packets WITHOUT decrypting (this host has no secret key): it must be a public-key message.
gpg --batch --list-only --list-packets "$INFLIGHT" 2>/dev/null | grep -q 'pubkey enc packet' \
  || fail "the encrypted dump is not an OpenPGP public-key message; nothing uploaded."

# ---- upload (the proven known-size copy, then a byte-for-byte check) --------------------------------------------------
r2_put "$INFLIGHT" "${R2_REMOTE%/}" 2>>"$LOGFILE" \
  || { rclone deletefile "$DEST" 2>/dev/null || true; fail "upload or byte check to $DEST failed; removed."; }
STORED="$(rclone size --json "$DEST" 2>/dev/null | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
[ "$STORED" = "$ENC_BYTES" ] || { rclone deletefile "$DEST" 2>/dev/null || true; fail "stored ${STORED:-missing} bytes against $ENC_BYTES; removed."; }
rm -f "$INFLIGHT"
SIZE_H="$(numfmt --to=iec "$ENC_BYTES" 2>/dev/null || echo "$ENC_BYTES bytes")"
log "OK: encrypted backup stored at $DEST ($SIZE_H; archive parsed; packet, bytes and size verified; nothing kept here)"
printf '%s %s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$DEST" "$ENC_BYTES" >"$STAMP_FILE"

# ---- retention on R2 ---------------------------------------------------------------------------------------------------
# Only this script's own nightly objects (<db>-YYYYMMDDTHHMMSS.dump.gpg) are counted and pruned, and only after a good
# run. Anything else in the bucket (re-keyed copies, base backups, WAL) is never touched here.
mapfile -t NIGHTLY < <(rclone lsf --max-depth 1 --files-only "$R2_REMOTE" 2>/dev/null \
  | grep -E "^${PG_DB}-[0-9]{8}T[0-9]{6}\.dump\.gpg$" | sort)
COUNT=${#NIGHTLY[@]}
if [ "$COUNT" -gt "$BACKUP_KEEP" ]; then
  for old in "${NIGHTLY[@]:0:$((COUNT - BACKUP_KEEP))}"; do
    rclone deletefile "${R2_REMOTE%/}/$old" 2>>"$LOGFILE" && log "rotated out of R2: $old"
  done
fi
log "=== backup done: $COUNT nightly object(s) on R2 before rotation, keep=$BACKUP_KEEP ==="
