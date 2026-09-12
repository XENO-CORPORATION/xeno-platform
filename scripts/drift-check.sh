#!/usr/bin/env sh
#
# drift-check.sh — scheduled production-invariant monitor for the credit ledger.
#
# Runs the credit-mirror-drift contract test INSIDE the live backend container against
# the production DB. READ-ONLY (it only SELECTs to compare the legacy users.credits
# integer mirror against the canonical credit_accounts micro-ledger). Exits non-zero and
# logs the detail when the mirror has drifted — the guard for "the v2 ledger is
# authoritative" (a drift is what caused the false 402 lock-outs; see the api-proxy fix).
#
# Invoked by cron as root (docker exec needs root/docker-group). Hook alerting onto a
# non-zero exit (roadmap Phase 3 — docs/PLATFORM-MODERNIZATION.md).
#
# Usage: sudo sh /mnt/projects/xeno-platform/scripts/drift-check.sh
#
set -eu

LOG="${DRIFT_LOG:-/mnt/projects/xeno-platform/backups/drift-check.log}"
# The backend runs as N replicas, so it has no container_name. Resolve it by
# the compose service label and take the first — any replica has the same
# image and environment, which is all this check reads.
BACKEND="${BACKEND_CONTAINER:-$(docker ps -q --filter "label=com.docker.compose.service=backend" 2>/dev/null | head -1)}"
[ -n "$BACKEND" ] || BACKEND=xenostudio-backend  # pre-scale fallback
TS="$(date '+%Y-%m-%dT%H:%M:%S%z')"

if [ "$(id -u)" -eq 0 ]; then DOCKER="docker"; else DOCKER="sudo docker"; fi

if OUT="$($DOCKER exec "$BACKEND" node tests/credit-mirror-drift.test.mjs 2>&1)"; then
  printf '%s OK   %s\n' "$TS" "$(printf '%s\n' "$OUT" | tail -1)" >>"$LOG"
  exit 0
else
  {
    printf '%s DRIFT-DETECTED — credit mirror diverged from the ledger:\n' "$TS"
    printf '%s\n' "$OUT"
  } >>"$LOG"
  # Non-zero so a wrapping monitor/alert can fire. Do NOT auto-resync here — a drift is a
  # real bug to investigate, not to paper over.
  exit 1
fi
