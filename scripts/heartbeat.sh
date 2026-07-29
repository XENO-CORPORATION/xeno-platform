#!/usr/bin/env bash
# heartbeat.sh — external down-alerting via a dead-man's-switch (Phase-1 exit criterion c).
#
# WHY: nothing off-box knows when xeno-platform-001 dies or /api/ready starts 503-ing. A box-local
# check can't page you when the box itself is down. So instead the box PINGS an external monitor on a
# schedule, and ONLY when the backend is genuinely ready. If the box dies OR the app is unhealthy, the
# pings stop, and the monitor (Healthchecks.io / BetterStack / UptimeRobot "heartbeat" — off-box) fires
# the alert after its grace period. This script is the on-box half; the monitor is the off-box half.
#
# ACTIVATION (one step, operator): create a free heartbeat monitor and put its ping URL, one line, in
#   /mnt/projects/xeno-platform/.heartbeat-url
# Until that file exists and is non-empty, this no-ops (logs a reminder) — safe to install now.
#
# Cron (installed alongside the backup/drift crons): every 5 minutes.
set -uo pipefail

URL_FILE="/mnt/projects/xeno-platform/.heartbeat-url"
READY_URL="http://127.0.0.1:8080/api/ready"
BACKUP_DIR="/mnt/projects/xeno-platform/backups"
# A nightly backup that is more than this old means the backup cron is not working.
# 36h, not 24h, so a single late or slow run does not cry wolf.
BACKUP_MAX_AGE_H=36
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Not-configured used to exit 0 with a line in a log nobody reads, which is
# indistinguishable from working. Say it on stderr too, so cron surfaces it.
if [ ! -s "$URL_FILE" ]; then
  echo "$TS heartbeat: no usable $URL_FILE — external alerting is NOT active" >&2
  echo "$TS heartbeat: create a heartbeat monitor and put its ping URL in $URL_FILE" >&2
  exit 0
fi
HB_URL="$(head -n1 "$URL_FILE" | tr -d '[:space:]')"
[ -n "$HB_URL" ] || { echo "$TS heartbeat: $URL_FILE empty — external alerting NOT active" >&2; exit 0; }

# ── Backup freshness ────────────────────────────────────────────────────────
# On 2026-07-29 the nightly backup was found to have failed EVERY night since
# 2026-07-14: the cron ran, pg-backup.sh was not executable (git had the blob as
# 100644, so a checkout stripped the +x bit), and the only record was
# "Permission denied" appended to a log file nobody reads. Fifteen days with no
# backup of the money ledger, and nothing anywhere said so.
#
# Liveness alone could never have caught that — the box was perfectly healthy.
# So backup staleness is now part of "ready": if the newest dump is too old the
# beat is withheld, and the dead-man's-switch that already exists does the rest.
newest_dump="$(ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | head -n1)"
backup_stale=0
if [ -z "$newest_dump" ]; then
  backup_stale=1
  backup_note="no dump found in $BACKUP_DIR"
else
  age_h=$(( ( $(date +%s) - $(date -r "$newest_dump" +%s) ) / 3600 ))
  if [ "$age_h" -gt "$BACKUP_MAX_AGE_H" ]; then
    backup_stale=1
    backup_note="newest dump is ${age_h}h old (limit ${BACKUP_MAX_AGE_H}h)"
  fi
fi

if [ "$backup_stale" -eq 1 ]; then
  echo "$TS heartbeat: BACKUP STALE — $backup_note" >&2
  if curl -fsS -m 10 -o /dev/null "${HB_URL%/}/fail" 2>/dev/null; then
    echo "$TS heartbeat: backup stale -> signaled /fail"
  else
    echo "$TS heartbeat: backup stale -> withheld ping (dead-man's-switch will trip)"
  fi
  exit 0
fi

# Only ping when the backend is truly ready, so app-down (not only box-down) also stops the beat.
code="$(curl -fsS -m 10 -o /dev/null -w '%{http_code}' "$READY_URL" 2>/dev/null || echo 000)"
if [ "$code" = "200" ]; then
  if curl -fsS -m 10 -o /dev/null "$HB_URL"; then
    echo "$TS heartbeat: ready(200) -> pinged OK"
  else
    echo "$TS heartbeat: ready(200) but ping FAILED (monitor unreachable / network?)"
  fi
else
  # Healthchecks.io supports an explicit failure signal (<url>/fail); for plain heartbeat monitors
  # withholding the ping is itself the failure signal (the dead-man's-switch trips on silence).
  if curl -fsS -m 10 -o /dev/null "${HB_URL%/}/fail" 2>/dev/null; then
    echo "$TS heartbeat: NOT ready ($code) -> signaled /fail"
  else
    echo "$TS heartbeat: NOT ready ($code) -> withheld ping (dead-man's-switch will trip)"
  fi
fi
