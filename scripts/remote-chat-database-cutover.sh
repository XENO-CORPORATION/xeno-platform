#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
umask 077

SHA=""
EXPECTED_DB_IMAGE=""
MODE="cutover"
ROOT="/mnt/projects/xeno-platform"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --sha) SHA="$2"; shift 2 ;;
    --expected-db-image) EXPECTED_DB_IMAGE="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --root) ROOT="$2"; shift 2 ;;
    *) echo "remote-chat-database-cutover: unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "remote-chat-database-cutover: invalid --sha" >&2; exit 2; }
[[ "$EXPECTED_DB_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "remote-chat-database-cutover: invalid --expected-db-image" >&2; exit 2; }
[[ "$ROOT" == /mnt/projects/* ]] || { echo "remote-chat-database-cutover: unsafe --root" >&2; exit 2; }
case "$MODE" in qualify-only|cutover) ;; *) echo "remote-chat-database-cutover: invalid mode" >&2; exit 2 ;; esac

cd "$ROOT"
[ -f .env ] || { echo "remote-chat-database-cutover: missing .env" >&2; exit 1; }
[ "$(stat -c '%a' .env)" = 600 ] || { echo "remote-chat-database-cutover: .env must be mode 600" >&2; exit 1; }
set -a
. ./.env
set +a
[ -n "${POSTGRES_PASSWORD:-}" ] || { echo "remote-chat-database-cutover: POSTGRES_PASSWORD is missing" >&2; exit 1; }

LIVE_IMAGE="$(docker inspect xenostudio-postgres --format '{{.Image}}')"
[ "$LIVE_IMAGE" = "$EXPECTED_DB_IMAGE" ] || { echo "remote-chat-database-cutover: live DB image drift: $LIVE_IMAGE" >&2; exit 1; }

SHORT="${SHA:0:7}"
BACKEND_IMAGE="xeno-platform-backend:$SHORT"
docker image inspect "$BACKEND_IMAGE" >/dev/null || { echo "remote-chat-database-cutover: missing build-only backend image $BACKEND_IMAGE" >&2; exit 1; }
EXPECTED_MIGRATION_VERSIONS="$(docker run --rm --entrypoint sh "$BACKEND_IMAGE" -c \
  "find /app/database/migrations -maxdepth 1 -type f | sed 's#.*/##' | sed -nE 's/^([0-9]{14})[-_].+\\.sql$/\\1/p' | sort -u")"
EXPECTED_MIGRATION_COUNT="$(printf '%s\n' "$EXPECTED_MIGRATION_VERSIONS" | grep -Ec '^[0-9]{14}$')"
[[ "$EXPECTED_MIGRATION_COUNT" =~ ^[1-9][0-9]*$ ]] || {
  echo "remote-chat-database-cutover: candidate image has no discoverable timestamped migrations" >&2
  exit 1
}

PGVECTOR_IMAGE="pgvector/pgvector:0.8.6-pg15-bookworm@sha256:a947c45cdc5906a1bc951f20a8709e321256343ee0f251e4ae00b5e7def4e6da"
PLAIN_IMAGE="postgres:15-alpine@sha256:a2c20749c564b4eb73a77bfda626f8a3cde1bbfae020fb97c616a00cdc1a2181"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_DIR="$ROOT/backups/chat-cutover/$STAMP-$SHORT"
mkdir -p "$EVIDENCE_DIR" "$ROOT/.deploy"
chmod 700 "$ROOT/backups/chat-cutover" "$EVIDENCE_DIR"
LOG="$ROOT/.deploy/chat-database-cutover.log"
log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }

BACKEND_STOPPED=0
CUTOVER_STARTED=0
QUAL_CONTAINER=""
on_exit() {
  local rc=$?
  if [ -n "$QUAL_CONTAINER" ]; then docker stop "$QUAL_CONTAINER" >/dev/null 2>&1 || true; fi
  if [ "$rc" -ne 0 ] && [ "$BACKEND_STOPPED" -eq 1 ] && [ "$CUTOVER_STARTED" -eq 0 ]; then
    docker compose up -d --no-deps backend >/dev/null 2>&1 || true
    log "pre-cutover failure restarted the unchanged backend"
  fi
  exit "$rc"
}
trap on_exit EXIT

backup_database() {
  local output="$1"
  docker exec xenostudio-postgres pg_dump -U postgres -d xenostudio --format=custom --no-owner --no-acl > "$output"
  test -s "$output"
  docker exec -i xenostudio-postgres pg_restore --list < "$output" > "$output.list"
  test -s "$output.list"
  sha256sum "$output" > "$output.sha256"
}

verify_migrations() {
  local container="$1" actual_versions actual_count missing
  actual_versions="$(docker exec "$container" psql -U postgres -d xenostudio -Atc \
    "SELECT version FROM schema_migrations ORDER BY version;")"
  actual_count="$(printf '%s\n' "$actual_versions" | grep -Ec '^[0-9]{14}$')"
  missing="$(comm -23 \
    <(printf '%s\n' "$EXPECTED_MIGRATION_VERSIONS") \
    <(printf '%s\n' "$actual_versions"))"
  if [ -n "$missing" ]; then
    echo "remote-chat-database-cutover: candidate migrations missing from $container" >&2
    printf '%s\n' "$missing" >&2
    return 1
  fi
  [ "$actual_count" -ge "$EXPECTED_MIGRATION_COUNT" ] || {
    echo "remote-chat-database-cutover: migration inventory shrank in $container" >&2
    return 1
  }
}

run_migrations() {
  local network="$1" database_url="$2"
  docker run --rm --network "$network" \
    --env DATABASE_URL="$database_url" \
    --env PGPASSWORD="${PGPASSWORD:-}" \
    --entrypoint node "$BACKEND_IMAGE" \
    --input-type=module -e \
    "import pg from 'pg'; import { runAllMigrations } from './services/migrationRunner.js'; const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}); await runAllMigrations(pool); await pool.end();"
}

wait_postgres() {
  local container="$1"
  for _ in $(seq 1 60); do
    docker exec "$container" pg_isready -U postgres -d xenostudio >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

BASELINE_BACKUP="$EVIDENCE_DIR/production-baseline.dump"
backup_database "$BASELINE_BACKUP"
log "baseline backup captured and listed: $BASELINE_BACKUP"

QUAL_NETWORK="xeno-chat-pgvector-qual-$SHORT-$STAMP"
QUAL_CONTAINER="xeno-chat-pgvector-qual-$SHORT-$STAMP"
QUAL_VOLUME="xeno-chat-pgvector-qual-$SHA-$STAMP"
docker network inspect "$QUAL_NETWORK" >/dev/null 2>&1 || docker network create "$QUAL_NETWORK" >/dev/null
docker volume inspect "$QUAL_VOLUME" >/dev/null 2>&1 || docker volume create --label xeno.verification=chat-pgvector "$QUAL_VOLUME" >/dev/null
docker rm -f "$QUAL_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$QUAL_CONTAINER" --network "$QUAL_NETWORK" --network-alias postgres \
  --volume "$QUAL_VOLUME:/var/lib/postgresql/data" \
  --env POSTGRES_DB=xenostudio --env POSTGRES_USER=postgres --env POSTGRES_HOST_AUTH_METHOD=trust \
  "$PGVECTOR_IMAGE" >/dev/null
wait_postgres "$QUAL_CONTAINER"
docker exec -i "$QUAL_CONTAINER" pg_restore -U postgres -d xenostudio --no-owner --no-acl < "$BASELINE_BACKUP"
run_migrations "$QUAL_NETWORK" 'postgresql://postgres@postgres:5432/xenostudio'
docker exec "$QUAL_CONTAINER" psql -U postgres -d xenostudio -Atc \
  "SELECT extversion FROM pg_extension WHERE extname='vector';" | grep -qx '0.8.6'
verify_migrations "$QUAL_CONTAINER"
docker stop "$QUAL_CONTAINER" >/dev/null
log "production-shaped restore qualification passed; migrations=$EXPECTED_MIGRATION_COUNT retained volume=$QUAL_VOLUME"

if [ "$MODE" = "qualify-only" ]; then
  log "qualify-only complete sha=$SHA"
  exit 0
fi

restore_quiesced_backup() {
  local backup="$1" rollback_volume rollback_container
  rollback_volume="xeno-platform-postgres-rollback-$SHA"
  rollback_container="xenostudio-postgres"
  docker rm -f xenostudio-postgres >/dev/null 2>&1 || true
  docker volume inspect "$rollback_volume" >/dev/null 2>&1 || docker volume create --label xeno.rollback=chat-pgvector "$rollback_volume" >/dev/null
  docker run -d --name "$rollback_container" --network xeno-platform_xenostudio-network --network-alias postgres \
    --volume "$rollback_volume:/var/lib/postgresql/data" \
    --env POSTGRES_DB=xenostudio --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    "$PLAIN_IMAGE" >/dev/null
  wait_postgres "$rollback_container"
  docker exec -i "$rollback_container" pg_restore -U postgres -d xenostudio --clean --if-exists --no-owner --no-acl < "$backup"
  docker compose up -d --no-deps backend
  BACKEND_STOPPED=0
  log "emergency restore is serving from retained rollback volume=$rollback_volume; compose DB is intentionally not reconciled"
}

docker compose stop backend
BACKEND_STOPPED=1
QUIESCED_BACKUP="$EVIDENCE_DIR/production-quiesced.dump"
backup_database "$QUIESCED_BACKUP"
log "quiesced backup captured and listed"

cutover_ok=0
CUTOVER_STARTED=1
if docker compose up -d --no-deps --force-recreate postgres && wait_postgres xenostudio-postgres; then
  DATABASE_URL="postgresql://postgres@postgres:5432/xenostudio"
  if PGPASSWORD="$POSTGRES_PASSWORD" run_migrations xeno-platform_xenostudio-network "$DATABASE_URL" \
      && docker exec xenostudio-postgres psql -U postgres -d xenostudio -Atc "SELECT extversion FROM pg_extension WHERE extname='vector';" | grep -qx '0.8.6' \
      && verify_migrations xenostudio-postgres; then
    cutover_ok=1
  fi
fi

if [ "$cutover_ok" -ne 1 ]; then
  log "cutover failed before API restart; restoring quiesced backup"
  restore_quiesced_backup "$QUIESCED_BACKUP"
  exit 1
fi

docker compose up -d --no-deps backend
BACKEND_STOPPED=0
for _ in $(seq 1 90); do
  code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/ready 2>/dev/null || true)"
  if [ "$code" = 200 ]; then
    log "pgvector cutover healthy sha=$SHA evidence=$EVIDENCE_DIR"
    exit 0
  fi
  sleep 2
done

log "API failed readiness after DB cutover; restoring quiesced backup"
docker compose stop backend || true
restore_quiesced_backup "$QUIESCED_BACKUP"
exit 1
