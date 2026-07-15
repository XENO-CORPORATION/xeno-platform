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
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

[ -f "$URL_FILE" ] || { echo "$TS heartbeat: no $URL_FILE yet — external alerting NOT active"; exit 0; }
HB_URL="$(head -n1 "$URL_FILE" | tr -d '[:space:]')"
[ -n "$HB_URL" ] || { echo "$TS heartbeat: $URL_FILE empty — external alerting NOT active"; exit 0; }

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
