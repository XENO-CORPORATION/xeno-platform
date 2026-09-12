#!/usr/bin/env sh
#
# dr-alert.sh — make a failure reach a HUMAN.
#
# Before this existed, nothing on this box notified anybody of anything. The
# heartbeat script was correct, ran every 5 minutes, and logged to a file no one
# reads that it could not alert. PITR, backups and the io-error watchdog were all
# silent in exactly the same way: you would have discovered a stalled WAL shipper
# at restore time, which is the worst possible moment.
#
# 🔴 This covers "the box is UP but something is broken". It CANNOT cover "the box
# is down" — a monitor living on the machine it watches cannot report that machine
# being gone. That half needs the external heartbeat (see heartbeat.sh and
# .heartbeat-url) and the two are deliberately complementary, not redundant.
#
# Alerts only on a CHANGE of state: a new problem, or an all-clear. A monitor that
# mails every 15 minutes forever is a monitor people filter to a folder.
#
set -eu

BASE="${BASE:-/mnt/projects/xeno-platform}"
STATE="${STATE:-$BASE/backups/.alert-state}"
LOGFILE="${LOGFILE:-$BASE/backups/alert.log}"
WAL_DIR="${WAL_DIR:-$BASE/wal_archive}"
R2_REMOTE="${R2_REMOTE:-r2backup:xeno-db-backups}"
WAL_BACKLOG_MB="${WAL_BACKLOG_MB:-2048}"
DISK_PCT="${DISK_PCT:-92}"
DUMP_MAX_H="${DUMP_MAX_H:-26}"
BASE_MAX_D="${BASE_MAX_D:-8}"
SITE_URL="${SITE_URL:-https://xenostudio.ai/}"
ALERT_FROM="${ALERT_FROM:-XENO Platform <noreply@xenostudio.ai>}"
# Recipient: the platform's own admin record, overridable by a one-line file.
ALERT_TO="${ALERT_TO:-}"
[ -z "$ALERT_TO" ] && [ -r "$BASE/.alert-email" ] && ALERT_TO="$(head -1 "$BASE/.alert-email" | tr -d '[:space:]')"

if [ "$(id -u)" -eq 0 ]; then DOCKER="docker"; else DOCKER="sudo docker"; fi
log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >>"$LOGFILE" 2>/dev/null || true; }

PROBLEMS=""
add() { PROBLEMS="${PROBLEMS}- $1
"; }

# 1. WAL shipping stalled -> pg_wal grows behind it -> a full disk STOPS the database.
BL="$(du -sm "$WAL_DIR" 2>/dev/null | cut -f1)"; BL="${BL:-0}"
[ "$BL" -ge "$WAL_BACKLOG_MB" ] && add "WAL archive backlog is ${BL} MB (limit ${WAL_BACKLOG_MB} MB) — offsite shipping is not keeping up."

# 2. Postgres itself failing to archive.
AF="$($DOCKER exec xenostudio-postgres psql -U postgres -tAc 'SELECT failed_count FROM pg_stat_archiver' 2>/dev/null | tr -d ' ')"
[ -n "${AF:-}" ] && [ "$AF" != "0" ] && add "Postgres archiver reports ${AF} FAILED archive attempts — WAL is not reaching the archive."

# 3/4. Backup freshness. An old backup is a silent backup.
NEWEST_DUMP="$(ls -t "$BASE"/backups/*.dump 2>/dev/null | head -1)"
if [ -n "${NEWEST_DUMP:-}" ]; then
  AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$NEWEST_DUMP") ) / 3600 ))
  [ "$AGE_H" -ge "$DUMP_MAX_H" ] && add "Newest nightly dump is ${AGE_H}h old (limit ${DUMP_MAX_H}h)."
else
  add "No nightly dump found at all in $BASE/backups."
fi
NEWEST_BASE="$(ls -t "$BASE"/backups/base/base-*.tar.gz 2>/dev/null | head -1)"
if [ -n "${NEWEST_BASE:-}" ]; then
  AGE_D=$(( ( $(date +%s) - $(stat -c %Y "$NEWEST_BASE") ) / 86400 ))
  [ "$AGE_D" -ge "$BASE_MAX_D" ] && add "Newest PHYSICAL base backup is ${AGE_D}d old (limit ${BASE_MAX_D}d) — PITR has nothing recent to replay onto."
else
  add "No physical base backup found — WAL alone cannot restore anything."
fi

# 5. Prove the OFFSITE chain, not just the local end of it.
LATEST_WAL_AGE="$(rclone lsl "$R2_REMOTE/wal/" 2>/dev/null | sort -k2,3 | tail -1 | awk '{print $2" "$3}')"
if [ -n "${LATEST_WAL_AGE:-}" ]; then
  W=$(( ( $(date +%s) - $(date -d "$LATEST_WAL_AGE" +%s 2>/dev/null || echo 0) ) / 60 ))
  [ "$W" -gt 45 ] && add "Newest WAL segment in R2 is ${W} minutes old — the offsite chain has stalled."
else
  add "Could not list WAL in R2 ($R2_REMOTE/wal/) — offsite copies are unverifiable."
fi

# 6. Disk. The failure that takes the database with it.
D="$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')"
[ -n "${D:-}" ] && [ "$D" -ge "$DISK_PCT" ] && add "Root filesystem is ${D}% full (limit ${DISK_PCT}%)."

# 7. The containers that matter.
# Singleton services still have a container_name and are checked by it. The
# backend does NOT: it runs as N replicas, so compose names them backend-1,
# backend-2, ... and a hardcoded name would silently check nothing.
for c in xenostudio-postgres xenostudio-frontend; do
  st="$($DOCKER inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo missing)"
  case "$st" in healthy|running) ;; *) add "Container $c is '$st'." ;; esac
done

# Backend replicas, resolved by the compose service label so this works at any
# replica count and survives a rename.
BACKENDS="$($DOCKER ps -q --filter "label=com.docker.compose.service=backend" 2>/dev/null)"
BACKEND_N="$(printf '%s
' "$BACKENDS" | grep -c . || true)"
if [ "${BACKEND_N:-0}" -lt "${EXPECT_BACKENDS:-1}" ]; then
  add "Only ${BACKEND_N:-0} backend replica(s) running, expected ${EXPECT_BACKENDS:-1} — a replica died and nothing restarted it."
fi
for c in $BACKENDS; do
  st="$($DOCKER inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo missing)"
  case "$st" in healthy|running) ;; *) add "Backend replica $(echo "$c" | cut -c1-12) is '$st'." ;; esac
done

# 8. The actual product, from outside the container.
CODE="$(curl -fsS -m 15 -o /dev/null -w '%{http_code}' "$SITE_URL" 2>/dev/null || echo 000)"
[ "$CODE" != "200" ] && add "$SITE_URL returned HTTP ${CODE}."

# 9. SLO burn, read from Prometheus. Prometheus evaluates the rules in
# observability/slo-rules.yml but runs no Alertmanager, so a firing alert would
# reach nobody at all. Rather than stand up a second delivery stack, the firing
# set is folded into the mail path that is already proven to work.
PROM="${PROM_URL:-http://127.0.0.1:9090}"
FIRING="$(curl -fsS -m 10 "$PROM/api/v1/alerts" 2>/dev/null | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for a in d.get("data", {}).get("alerts", []):
    if a.get("state") == "firing":
        l = a.get("labels", {})
        print("%s [%s] %s" % (l.get("alertname", "?"), l.get("severity", "?"),
                              a.get("annotations", {}).get("summary", "")))' 2>/dev/null || true)"
if [ -n "${FIRING:-}" ]; then
  OLDIFS="$IFS"; IFS="$(printf '
_')"; IFS="${IFS%_}"
  for _l in $FIRING; do [ -n "$_l" ] && add "SLO alert firing: $_l"; done
  IFS="$OLDIFS"
fi

# ---- state change detection -------------------------------------------------
NOW_HASH="$(printf '%s' "$PROBLEMS" | md5sum | cut -d' ' -f1)"
WAS_HASH="$(cat "$STATE" 2>/dev/null || echo none)"
[ "$NOW_HASH" = "$WAS_HASH" ] && exit 0
printf '%s' "$NOW_HASH" > "$STATE"

if [ -n "$PROBLEMS" ]; then
  SUBJ="[XENO ALERT] xeno-platform-001: $(printf '%s' "$PROBLEMS" | grep -c '^- ') problem(s)"
  BODY="Detected $(date '+%Y-%m-%d %H:%M:%S %Z') on xeno-platform-001:

${PROBLEMS}
Runbook: docs/DR.md on the box. This monitor runs ON the box, so it cannot tell
you the box is down — that is the external heartbeat's job."
else
  SUBJ="[XENO OK] xeno-platform-001: all clear"
  BODY="All monitored checks passed again at $(date '+%Y-%m-%d %H:%M:%S %Z')."
fi
log "state changed -> ${SUBJ}"

[ -z "$ALERT_TO" ] && { log "ERROR: no recipient (set $BASE/.alert-email); alert NOT sent"; exit 1; }
# Any replica carries the same environment; take the first.
KEY_SRC="$(printf '%s
' "$BACKENDS" | head -1)"
KEY="$([ -n "$KEY_SRC" ] && $DOCKER exec "$KEY_SRC" printenv RESEND_API_KEY 2>/dev/null || true)"
[ -z "${KEY:-}" ] && { log "ERROR: RESEND_API_KEY unavailable; alert NOT sent"; exit 1; }

RESP="$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer ${KEY}" -H 'Content-Type: application/json' \
  --data "$(printf '{"from":%s,"to":[%s],"subject":%s,"text":%s}' \
      "$(printf '%s' "$ALERT_FROM" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" \
      "$(printf '%s' "$ALERT_TO"   | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" \
      "$(printf '%s' "$SUBJ"       | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" \
      "$(printf '%s' "$BODY"       | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")" 2>/dev/null || echo 000)"
unset KEY
case "$RESP" in 2*) log "alert delivered to ${ALERT_TO} (HTTP $RESP)";; *) log "ERROR: Resend returned HTTP ${RESP}; alert NOT delivered";; esac
exit 0
