#!/bin/bash
# dr-restore-proof.sh: the restore drill for what is actually in R2. Run it on the operator PC, which holds the
# private key. Plaintext never lands on this PC: it streams to the box, which already holds plain dumps. Touches
# no production data; it restores into an offline throwaway container and removes it.
set -euo pipefail
B=r2:xeno-db-backups
WORK="$(cd "$(dirname "$0")/.." && pwd)/scratchpad/dr-proof"
HOST=xeno-platform-001
rm -rf "$WORK"; mkdir -p "$WORK"; chmod 700 "$WORK"
export GNUPGHOME="$WORK"
cleanup() {
  gpgconf --kill all 2>/dev/null || true
  rm -rf "$WORK"
  ssh $HOST 'sudo docker rm -f -v dr-restore-proof >/dev/null 2>&1; sudo rm -f /mnt/projects/xeno-platform/backups/.proof.dump /mnt/projects/xeno-platform/backups/.proof-base.tar.gz' || true
}
trap cleanup EXIT
grep -m1 '^XENO_DB_BACKUP_GPG_PRIVATE_B64=' "$HOME/.xeno-secrets" | cut -d= -f2- | base64 -d | gpg --batch --quiet --import 2>/dev/null

DUMP=$(rclone lsf "$B" --files-only --max-depth 1 --include 'xenostudio-*.dump.gpg' | sort | tail -1)
BASE=$(rclone lsf "$B/base" --files-only | sort | tail -1)
WAL=$(rclone lsf "$B/wal" --files-only --max-age 20m | sort | tail -1)
echo "R2 newest: dump=$DUMP base=$BASE wal=$WAL"

echo "--- WAL segment decrypts"
rclone cat "$B/wal/$WAL" | gpg --batch --quiet --decrypt 2>/dev/null | wc -c

echo "--- base backup: R2 copy against the local one"
PLAIN_BASE="/mnt/projects/xeno-platform/backups/base/${BASE%.gpg}"
rclone cat "$B/base/$BASE" | gpg --batch --quiet --decrypt 2>/dev/null | ssh $HOST "sudo tee /mnt/projects/xeno-platform/backups/.proof-base.tar.gz >/dev/null"
ssh $HOST "sudo sha256sum /mnt/projects/xeno-platform/backups/.proof-base.tar.gz '$PLAIN_BASE' | awk '{print \$1}' | uniq | wc -l; sudo rm -f /mnt/projects/xeno-platform/backups/.proof-base.tar.gz" | { read n; [ "$n" = 1 ] && echo "base byte-identical" || { echo "BASE DIFFERS"; exit 1; }; }

echo "--- dump: R2 copy against the local one"
PLAIN="/mnt/projects/xeno-platform/backups/${DUMP%.gpg}"
rclone cat "$B/$DUMP" | gpg --batch --quiet --decrypt 2>/dev/null | ssh $HOST "sudo tee /mnt/projects/xeno-platform/backups/.proof.dump >/dev/null"
ssh $HOST "sudo sha256sum /mnt/projects/xeno-platform/backups/.proof.dump '$PLAIN' | awk '{print \$1}' | uniq | wc -l" | { read n; [ "$n" = 1 ] && echo "dump byte-identical" || { echo "DUMP DIFFERS"; exit 1; }; }

echo "--- full restore into a throwaway, offline database"
ssh $HOST 'bash -s' <<'REMOTE'
set -eu
F=/mnt/projects/xeno-platform/backups/.proof.dump
IMG=$(sudo docker inspect xenostudio-postgres --format '{{.Config.Image}}')
sudo docker run -d --name dr-restore-proof --network none --cpus 2 --memory 4g -e POSTGRES_PASSWORD=x -e POSTGRES_DB=restoretest "$IMG" >/dev/null
for i in $(seq 1 60); do sudo docker exec dr-restore-proof pg_isready -U postgres -d restoretest -q && break; sleep 2; done
sudo docker cp "$F" dr-restore-proof:/tmp/d.dump
START=$(date +%s)
set +e
sudo docker exec dr-restore-proof pg_restore -U postgres -d restoretest --no-owner --no-privileges /tmp/d.dump 2>/tmp/dr-restore.err
RC=$?
set -e
echo "pg_restore exit=$RC errors=$(grep -c 'error:' /tmp/dr-restore.err || true) seconds=$(( $(date +%s)-START ))"
head -5 /tmp/dr-restore.err | cut -c1-200
Q="select 'tables',count(*) from information_schema.tables where table_schema='public' union all select 'users',count(*) from users union all select 'credit_transactions',count(*) from credit_transactions union all select 'credit_accounts',count(*) from credit_accounts"
echo "restored:"; sudo docker exec dr-restore-proof psql -U postgres -d restoretest -Atc "$Q"
echo "production now:"; sudo docker exec xenostudio-postgres psql -U postgres -d xenostudio -Atc "$Q"
rm -f /tmp/dr-restore.err
[ "$RC" = 0 ]
REMOTE
echo "PROOF PASSED"
