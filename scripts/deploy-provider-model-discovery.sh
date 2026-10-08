#!/usr/bin/env bash
# Focused image deployment. Input is a committed archive of this change only.
set -euo pipefail
root=/mnt/projects/xeno-platform
bundle="${1:?bundle directory required}"
revision="${2:?revision required}"
cd "$root"
exec 9>.deploy/provider-model-discovery.lock
flock -n 9
log="$root/.deploy/provider-model-discovery-$revision.log"
exec > >(tee -a "$log") 2>&1
containers=( $(docker ps -q --filter label=com.docker.compose.project=xeno-platform --filter label=com.docker.compose.service=backend) )
[ "${#containers[@]}" -eq 2 ] || { echo 'Expected two backend replicas'; exit 1; }
base=$(docker inspect -f '{{.Image}}' "${containers[0]}")
for container in "${containers[@]}"; do
 [ "$(docker inspect -f '{{.Image}}' "$container")" = "$base" ] || exit 1
 while read -r path expected; do
  actual=$(docker exec "$container" sha256sum "/app/$path" | awk '{print $1}')
  [ "$actual" = "$expected" ] || { echo "Reviewed baseline changed: $path"; exit 1; }
 done < "$bundle/baseline.sha256"
done
parent="xeno-platform-backend:provider-models-parent-$revision"
candidate="xeno-platform-backend:provider-models-$revision"
docker tag "$base" "$parent"
docker build --build-arg "BASE=$parent" --label "org.xeno.provider-models.revision=$revision" -t "$candidate" "$bundle"
docker run --rm --entrypoint node "$candidate" --input-type=module -e "await import('./routes/v2InferenceRoutes.js'); await import('./services/providerModelDiscovery.js'); console.log('CANDIDATE_IMPORT_OK')"
docker run --rm --entrypoint node "$candidate" --test /app/provider-model-discovery.test.mjs
before=$(docker compose config --hash backend 2>/dev/null | awk '{print $2}')
[ "$before" = "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' "${containers[0]}")" ] || { echo 'Compose runtime drift; refusing swap'; exit 1; }
rollback() {
 echo 'Rolling back the backend image'
 docker tag "$base" xeno-platform-backend:latest
 docker compose up -d --no-deps --no-build --force-recreate backend
}
docker tag "$candidate" xeno-platform-backend:latest
if ! docker compose up -d --no-deps --no-build --force-recreate backend; then rollback; exit 1; fi
healthy=0
for _ in $(seq 1 90); do
 count=0
 for container in $(docker compose ps -q backend); do
  state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")
  [ "$state" = healthy ] && count=$((count+1))
 done
 if [ "$count" -eq 2 ] && curl -sf --max-time 5 http://127.0.0.1:8080/api/ready >/dev/null && curl -sf --max-time 5 http://127.0.0.1:8081/api/ready >/dev/null; then healthy=1; break; fi
 sleep 2
done
if [ "$healthy" -ne 1 ]; then rollback; exit 1; fi
echo "PROVIDER_MODEL_DISCOVERY_DEPLOYED $revision"
