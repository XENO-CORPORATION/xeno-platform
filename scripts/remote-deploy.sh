#!/usr/bin/env bash
#
# remote-deploy.sh — the ON-BOX half of the xeno-platform deploy pipeline.
#
# This runs on xeno-platform-001 (as root, via `sudo bash`), invoked by the
# workstation orchestrator `scripts/deploy-platform.mjs`. It is shipped fresh on
# every deploy (never trusted from the box), so editing it in the repo is the way
# to change deploy behavior — there is no hidden copy on the box.
#
# Responsibilities (build-BEFORE-swap; the running container keeps serving until a
# new image is proven built):
#   1. Extract the git-archive tar of HEAD into the box worktree.
#   2. Normalize CRLF on text sources only (never binaries).
#   3. Tag the current :latest image as :rollback (last-good) before building.
#   4. `docker compose build <service>` — old container still serving.
#   5. Tag the freshly built image with the deploy SHA (so "what's running" is knowable).
#   6. In swap mode: `up -d --force-recreate`, then GATE on a real healthcheck.
#   7. On healthcheck failure: auto-rollback to :rollback and re-check. Exit non-zero.
#   8. Append an audit line to .deploy/deploy.log.
#
# It is intentionally defensive: `set -euo pipefail`, every docker call is real,
# and it never touches the untracked box state (.env, backups/, volumes).
#
# Usage:
#   sudo bash remote-deploy.sh --service backend|frontend --sha <sha> \
#        --tar /tmp/xeno-deploy/deploy-<sha>.tar --mode swap|build-only \
#        [--root /mnt/projects/xeno-platform] [--no-cache]
#
set -euo pipefail

SERVICE=""
SHA=""
TAR=""
MODE="swap"
ROOT="/mnt/projects/xeno-platform"
NOCACHE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --service) SERVICE="$2"; shift 2 ;;
    --sha)     SHA="$2"; shift 2 ;;
    --tar)     TAR="$2"; shift 2 ;;
    --mode)    MODE="$2"; shift 2 ;;
    --root)    ROOT="$2"; shift 2 ;;
    --no-cache) NOCACHE="--no-cache"; shift 1 ;;
    *) echo "remote-deploy: unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -n "$SERVICE" ] || { echo "remote-deploy: --service required" >&2; exit 2; }
[ -n "$SHA" ]     || { echo "remote-deploy: --sha required" >&2; exit 2; }
[ -n "$TAR" ]     || { echo "remote-deploy: --tar required" >&2; exit 2; }
case "$SERVICE" in backend|frontend) ;; *) echo "remote-deploy: --service must be backend|frontend" >&2; exit 2 ;; esac
case "$MODE" in swap|build-only) ;; *) echo "remote-deploy: --mode must be swap|build-only" >&2; exit 2 ;; esac
[ -f "$TAR" ] || { echo "remote-deploy: tar not found: $TAR" >&2; exit 2; }

cd "$ROOT"
mkdir -p .deploy
LOG="$ROOT/.deploy/deploy.log"
IMAGE="xeno-platform-$SERVICE"

log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }

# docker compose v2 (plugin) vs v1 — prefer the plugin form used on this box.
dc() { docker compose "$@"; }

# Health endpoints, curled from the box loopback (the true readiness signal).
#  backend : /api/ready returns 200 only AFTER startup migrations succeed (503 until).
#  frontend: nginx /health returns 200 when the SPA is served.
health_url() {
  case "$SERVICE" in
    backend)  echo "http://127.0.0.1:8080/api/ready" ;;
    frontend) echo "http://127.0.0.1:4040/health" ;;
  esac
}

poll_health() {
  local url tries code
  url="$(health_url)"
  tries="$1"
  for _ in $(seq 1 "$tries"); do
    code="$(curl -fsS -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
    if [ "$code" = "200" ]; then return 0; fi
    sleep 2
  done
  echo "remote-deploy: health poll timed out ($url last=$code)" >&2
  return 1
}

log "=== deploy start service=$SERVICE sha=$SHA mode=$MODE nocache=${NOCACHE:-no} ==="

# --- 1. Extract HEAD tar into the worktree ---------------------------------
tar xf "$TAR" --overwrite
log "extracted $TAR into $ROOT"

# --- 2. CRLF normalize text sources only (NEVER binaries) ------------------
# git archive on this repo emits LF blobs (core.autocrlf=true), so this is a
# no-op safety net; scoped to code dirs + text extensions, public/ binaries excluded.
for d in src scripts nginx; do
  [ -d "$d" ] || continue
  find "$d" -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' \
       -o -name '*.cjs' -o -name '*.json' -o -name '*.css' -o -name '*.html' -o -name '*.md' \
       -o -name '*.sql' -o -name '*.sh' -o -name '*.conf' -o -name '*.yml' -o -name '*.yaml' \) \
    -exec sed -i 's/\r$//' {} +
done
log "normalized line endings (text only)"

# The backend runs as appuser (uid/gid 1001), but these paths are bind-mounted
# from the host. Image-layer chown in Dockerfile.backend cannot affect them.
# `tar xf` also reapplies archive ownership to tracked directories on every
# deploy, so ownership must be repaired after extraction and before the swap.
# A combined backend+frontend deploy extracts the same archive once per service;
# therefore the frontend pass can reset these directories to root after the
# backend pass repaired them. Run this gate for every service invocation.
# Keep the list identical to the writable backend bind mounts in compose; the
# read-only backups mount and docker socket are deliberately excluded.
WRITABLE_MOUNTS=(
  src/server/uploads
  src/server/sam2-uploads
  src/server/storage
  conversions
  storage/videos
  storage/thumbnails
  storage/assets
)
for mount_path in "${WRITABLE_MOUNTS[@]}"; do
  install -d -m 2770 -o 1001 -g 1001 "$mount_path"
  chown -R 1001:1001 "$mount_path"
  chmod 2770 "$mount_path"
done
log "prepared ${#WRITABLE_MOUNTS[@]} writable backend bind mounts for uid/gid 1001"

# --- 3. Tag current image as :rollback (last-good) -------------------------
if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
  PREV_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE:latest")"
  docker tag "$IMAGE:latest" "$IMAGE:rollback"
  log "tagged current $IMAGE ($PREV_ID) -> :rollback"
else
  PREV_ID=""
  log "no existing $IMAGE:latest to snapshot (first build?)"
fi

# --- 4. Build (build-before-swap — old container keeps serving) ------------
log "building $SERVICE ..."
dc build $NOCACHE "$SERVICE"
docker tag "$IMAGE:latest" "$IMAGE:$SHA" || true
NEW_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE:latest" 2>/dev/null || echo unknown)"
log "built $SERVICE -> $IMAGE:latest ($NEW_ID), also tagged :$SHA"

# A Docker build can succeed while a stale on-box node_modules tree copied late
# in the Dockerfile silently replaces the graph installed by `npm ci`. Prove the
# production graph inside the actual image before it is ever swapped into service.
if [ "$SERVICE" = "backend" ]; then
  DEPENDENCY_LOG="$(mktemp)"
  if ! docker run --rm --entrypoint npm "$IMAGE:latest" ls --omit=dev >"$DEPENDENCY_LOG" 2>&1; then
    cat "$DEPENDENCY_LOG" >&2
    rm -f "$DEPENDENCY_LOG"
    log "production dependency graph FAILED inside $IMAGE:latest — refusing swap"
    if docker image inspect "$IMAGE:rollback" >/dev/null 2>&1; then
      docker tag "$IMAGE:rollback" "$IMAGE:latest"
      log "restored $IMAGE:latest to :rollback after pre-swap gate failure"
    fi
    exit 1
  fi
  rm -f "$DEPENDENCY_LOG"
  log "production dependency graph PASSED inside $IMAGE:latest"
fi

if [ "$MODE" = "build-only" ]; then
  # Preserve the candidate under :$SHA, but put :latest back on the last-good
  # image. Otherwise the next deploy snapshots the unserved candidate as
  # :rollback and silently destroys the actual rollback point before swapping.
  if [ -n "$PREV_ID" ] && docker image inspect "$IMAGE:rollback" >/dev/null 2>&1; then
    docker tag "$IMAGE:rollback" "$IMAGE:latest"
    log "build-only mode: restored $IMAGE:latest to the last-good :rollback image"
  fi
  log "build-only mode: NOT swapping. Candidate remains tagged :$SHA; running container is untouched."
  log "=== deploy end (build-only) service=$SERVICE sha=$SHA OK ==="
  exit 0
fi

# --- 5. Swap ---------------------------------------------------------------
log "swapping in new $SERVICE container ..."
dc up -d --no-deps --force-recreate "$SERVICE"

# --- 6. Healthcheck gate ---------------------------------------------------
# backend waits through migrations, so give it longer.
if [ "$SERVICE" = "backend" ]; then TRIES=90; else TRIES=30; fi
if poll_health "$TRIES"; then
  log "healthcheck PASSED ($(health_url))"
  log "=== deploy end service=$SERVICE sha=$SHA OK ==="
  exit 0
fi

# --- 7. Auto-rollback ------------------------------------------------------
log "healthcheck FAILED — auto-rolling back $SERVICE"
if docker image inspect "$IMAGE:rollback" >/dev/null 2>&1; then
  docker tag "$IMAGE:rollback" "$IMAGE:latest"
  dc up -d --no-deps --force-recreate "$SERVICE"
  if poll_health "$TRIES"; then
    log "ROLLED BACK to :rollback and healthy again. Deploy of $SHA FAILED."
  else
    log "ROLLBACK also unhealthy — MANUAL INTERVENTION NEEDED. service=$SERVICE"
  fi
else
  log "no :rollback image available — cannot auto-rollback. service=$SERVICE"
fi
log "=== deploy end service=$SERVICE sha=$SHA FAILED ==="
# NOTE: image rollback does NOT roll back schema migrations (they are forward-only,
# additive + idempotent by design). See docs/DEPLOY.md.
exit 1
