#!/usr/bin/env sh
#
# secrets-backup.sh — the OTHER half of disaster recovery.
#
# 🔴 THE GAP THIS CLOSES. pg-backup.sh makes the money database recoverable to
# any five-minute point, offsite and encrypted. It does not back up a single
# SECRET — and without STRIPE_*, JWT_ACCESS_SECRET, POSTGRES_PASSWORD and the
# rest, a restored database is a pile of rows no application can open. The data
# was recoverable and the means to use it were single-copy on one VM, which was
# paused by a storage fault the day before this was written.
#
# Same proven path as the database backups: GPG to the DR public key, then
# rclone to R2. The private half is deliberately NOT on any server, so a
# compromised box can write a secrets backup it can never read.
#
# Runs on ANY host; it backs up whatever of the known paths exists there.
#
set -eu

# One choke point for every R2 write in this chain — see scripts/lib/r2-put.sh
# for why a plain `rclone copy` reported failure on 100% of successful uploads.
# shellcheck source=lib/r2-put.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/r2-put.sh"

(set -o pipefail) 2>/dev/null && set -o pipefail || true

R2_REMOTE="${R2_REMOTE:-}"
BACKUP_GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
KEEP="${SECRETS_KEEP:-10}"
HOST="$(hostname)"
WORK="${WORK:-/tmp/xeno-secrets-backup}"
LOGFILE="${LOGFILE:-/var/log/xeno-secrets-backup.log}"

# Everything that holds a credential on any XENO host. A path that does not
# exist here is skipped, so ONE list serves every box and adding a host does not
# mean inventing a new script.
PATHS="${SECRET_PATHS:-/mnt/projects/xeno-platform/.env
/home/bunker/apps/xeno-api-proxy/.env
/etc/xeno-alert.key
/mnt/projects/xeno-platform/secrets}"

log() {
  _ts="$(date '+%Y-%m-%dT%H:%M:%S%z')"
  printf '%s %s\n' "$_ts" "$*" >>"$LOGFILE" 2>/dev/null || printf '%s %s\n' "$_ts" "$*" >&2
  [ -t 1 ] && printf '%s %s\n' "$_ts" "$*" || true
}
fail() { log "ERROR: $*"; exit 1; }

[ -n "$R2_REMOTE" ] || fail "R2_REMOTE unset; a local-only secrets copy is not DR"
[ -n "$BACKUP_GPG_RECIPIENT" ] || fail "BACKUP_GPG_RECIPIENT unset; refusing to upload PLAINTEXT secrets"
command -v gpg >/dev/null 2>&1 || fail "gpg not installed"
command -v rclone >/dev/null 2>&1 || fail "rclone not installed"

STAMP="$(date -u '+%Y%m%dT%H%M%S')"
rm -rf "$WORK"; mkdir -p "$WORK/payload"
chmod 700 "$WORK"

FOUND=0
printf '%s\n' "$PATHS" | while IFS= read -r p; do
  [ -n "$p" ] || continue
  [ -e "$p" ] || continue
  # Flatten the path into a filename so the archive is self-describing about
  # WHERE each file belongs — a restore that does not know the destination is
  # only half a backup.
  flat="$(printf '%s' "$p" | sed 's#^/##; s#/#__#g')"
  if [ -d "$p" ]; then tar cf "$WORK/payload/${flat}.tar" -C "$(dirname "$p")" "$(basename "$p")" 2>/dev/null || true
  else cp -a "$p" "$WORK/payload/$flat" 2>/dev/null || true; fi
  echo "$p" >> "$WORK/payload/MANIFEST.txt"
done
FOUND="$(ls -1 "$WORK/payload" 2>/dev/null | grep -vc '^MANIFEST' || true)"
[ "${FOUND:-0}" -gt 0 ] || fail "no known secret paths present on $HOST — refusing to upload an empty backup"

ARCHIVE="$WORK/secrets-${HOST}-${STAMP}.tar.gz"
tar czf "$ARCHIVE" -C "$WORK" payload
# An archive that exists but cannot be read is the failure mode worth catching
# here rather than at restore time.
gzip -t "$ARCHIVE" 2>>"$LOGFILE" || fail "archive failed its own integrity check"

ENC="${ARCHIVE}.gpg"
gpg --batch --yes --trust-model always --recipient "$BACKUP_GPG_RECIPIENT" \
    --output "$ENC" --encrypt "$ARCHIVE" 2>>"$LOGFILE" || fail "gpg encryption failed"
rm -f "$ARCHIVE"   # never leave the plaintext archive on disk

if r2_put "$ENC" "$R2_REMOTE/secrets/$HOST/" 2>>"$LOGFILE"; then
  log "OK: $FOUND secret path(s) from $HOST -> $R2_REMOTE/secrets/$HOST/ ($(du -h "$ENC" | cut -f1))"
else
  rm -rf "$WORK"; fail "rclone upload failed"
fi

# Retention, offsite. Unlike the database dumps these are small, so keep more.
COUNT="$(rclone lsf "$R2_REMOTE/secrets/$HOST/" 2>/dev/null | grep -c . || true)"
if [ "${COUNT:-0}" -gt "$KEEP" ]; then
  rclone lsf "$R2_REMOTE/secrets/$HOST/" 2>/dev/null | sort | head -n "$((COUNT - KEEP))" | while IFS= read -r old; do
    rclone deletefile "$R2_REMOTE/secrets/$HOST/$old" 2>>"$LOGFILE" && log "rotated out: $old"
  done
fi

rm -rf "$WORK"
log "=== secrets backup complete for $HOST ==="
exit 0
