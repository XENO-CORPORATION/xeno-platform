#!/bin/bash
# dr-restore-proof.sh: the restore drill for what is actually in R2. Run it on the operator PC, which holds the
# private key. Plaintext never lands on this PC: it streams to the box, which already holds plain dumps. Touches
# no production data; it restores into offline throwaway containers and removes them. On a pass it stamps the box,
# and dr-alert.sh mails if that stamp gets old, so a drill that fails or never runs still reaches a person.
set -euo pipefail
B=r2:xeno-db-backups
WORK="$(cd "$(dirname "$0")/.." && pwd)/scratchpad/dr-proof"
HOST=xeno-platform-001
rm -rf "$WORK"; mkdir -p "$WORK"; chmod 700 "$WORK"
export GNUPGHOME="$WORK"
cleanup() {
  gpgconf --kill all 2>/dev/null || true
  rm -rf "$WORK"
  ssh $HOST 'sudo docker rm -f -v dr-restore-proof dr-pitr-proof >/dev/null 2>&1; sudo rm -rf /mnt/projects/xeno-platform/backups/.proof.dump /mnt/projects/xeno-platform/backups/.proof-base.tar.gz /mnt/projects/xeno-platform/backups/.proof-pitr' || true
}
trap cleanup EXIT
FREE_GB=$(ssh $HOST "df -BG --output=avail / | tail -1 | tr -dc 0-9")
[ "$FREE_GB" -ge 15 ] || { echo "only ${FREE_GB} GB free on the box, the drill needs 15"; exit 1; }
grep -m1 '^XENO_DB_BACKUP_GPG_PRIVATE_B64=' "$HOME/.xeno-secrets" | cut -d= -f2- | base64 -d | gpg --batch --quiet --import 2>/dev/null

DUMP=$(rclone lsf "$B" --files-only --max-depth 1 --include 'xenostudio-*.dump.gpg' | sort | tail -1)
BASE=$(rclone lsf "$B/base" --files-only | sort | tail -1)
WAL=$(rclone lsf "$B/wal" --files-only --use-server-modtime --max-age 20m | sort | tail -1)
echo "R2 newest: dump=$DUMP base=$BASE wal=$WAL"

echo "--- WAL segment decrypts"
rclone cat "$B/wal/$WAL" | gpg --batch --quiet --decrypt 2>/dev/null | wc -c

echo "--- base backup: R2 copy against the local one"
PLAIN_BASE="/mnt/projects/xeno-platform/backups/base/${BASE%.gpg}"
rclone cat "$B/base/$BASE" | gpg --batch --quiet --decrypt 2>/dev/null | ssh $HOST "sudo tee /mnt/projects/xeno-platform/backups/.proof-base.tar.gz >/dev/null"
ssh $HOST "sudo sha256sum /mnt/projects/xeno-platform/backups/.proof-base.tar.gz '$PLAIN_BASE' | awk '{print \$1}' | uniq | wc -l" | { read n; [ "$n" = 1 ] && echo "base byte-identical" || { echo "BASE DIFFERS"; exit 1; }; }

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

echo "--- point-in-time recovery: that base plus WAL from R2, stopped at a chosen second"
ssh $HOST 'sudo docker rm -f -v dr-restore-proof >/dev/null 2>&1; sudo rm -f /mnt/projects/xeno-platform/backups/.proof.dump'
P=/mnt/projects/xeno-platform/backups/.proof-pitr
START=$(ssh $HOST "sudo tar xzOf /mnt/projects/xeno-platform/backups/.proof-base.tar.gz backup_label" | sed -n 's/^START WAL LOCATION.*(file \([0-9A-F]*\)).*/\1/p')
[ -n "$START" ] || { echo "no start segment in the base backup"; exit 1; }
mapfile -t SEGS < <(rclone lsjson "$B/wal" --files-only --use-server-modtime --no-mimetype | node -e '
  const rows = JSON.parse(require("fs").readFileSync(0, "utf8"));
  for (const r of rows) if (/^[0-9A-F]{24}\.gpg$/.test(r.Name)) console.log(r.Name + "|" + Math.floor(Date.parse(r.ModTime) / 1000));
' | sort | awk -F'|' -v s="$START" '$1 >= s')
# Stop at about 60 segments so a late-in-the-week drill doesn't fetch 30 GB. The 7 after it hold a commit past the target.
N=${#SEGS[@]}
[ "$N" -ge 20 ] || { echo "only $N WAL segments since the base backup"; exit 1; }
IDX=$(( N - 8 < 60 ? N - 8 : 60 ))
T_EPOCH=${SEGS[$IDX]#*|}
S=${BASE#base-}
BASE_EPOCH=$(date -u -d "${S:0:8} ${S:9:2}:${S:11:2}:${S:13:2}" +%s)
[ $(( T_EPOCH - BASE_EPOCH )) -ge 1800 ] || { echo "target is too close to the base backup"; exit 1; }
T=$(date -u -d "@$T_EPOCH" +%Y-%m-%dT%H:%M:%S+00)
echo "base starts at $START, target $T, fetching $(( IDX + 8 )) of $N segments"
ssh $HOST "sudo mkdir -p $P/wal $P/data"
for ROW in "${SEGS[@]:0:$(( IDX + 8 ))}"; do
  NAME=${ROW%%|*}; NAME=${NAME%.gpg}
  rclone cat "$B/wal/$NAME.gpg" | gpg --batch --quiet --decrypt 2>/dev/null | ssh $HOST "sudo tee $P/wal/$NAME >/dev/null"
done
ssh $HOST "P='$P' T='$T' bash -s" <<'REMOTE'
set -eu
PITR_Q() { sudo docker exec dr-pitr-proof psql -U postgres -d xenostudio -Atc "$1"; }
PROD_Q() { sudo docker exec xenostudio-postgres psql -U postgres -d xenostudio -Atc "$1"; }
BAD=$(sudo find "$P/wal" -type f ! -size 16777216c | wc -l)
[ "$BAD" = 0 ] || { echo "$BAD WAL segments have the wrong size"; exit 1; }
sudo tar xzf /mnt/projects/xeno-platform/backups/.proof-base.tar.gz -C "$P/data"
sudo rm -f /mnt/projects/xeno-platform/backups/.proof-base.tar.gz
sudo touch "$P/data/recovery.signal"
sudo chown -R 999:999 "$P/data" "$P/wal"; sudo chmod 700 "$P/data"
IMG=$(sudo docker inspect xenostudio-postgres --format '{{.Config.Image}}')
sudo docker run -d --name dr-pitr-proof --network none --cpus 2 --memory 4g \
  -v "$P/data:/var/lib/postgresql/data" -v "$P/wal:/pitr_wal:ro" "$IMG" postgres \
  -c archive_mode=off -c "listen_addresses=" -c "restore_command=cp /pitr_wal/%f %p" \
  -c "recovery_target_time=$T" -c recovery_target_action=promote -c recovery_target_inclusive=false >/dev/null
START=$(date +%s); OPEN=
for i in $(seq 1 360); do
  [ "$(sudo docker inspect -f '{{.State.Running}}' dr-pitr-proof)" = true ] || break
  if [ "$(PITR_Q 'select pg_is_in_recovery()' 2>/dev/null || true)" = f ]; then OPEN=1; break; fi
  sleep 5
done
if [ -z "$OPEN" ]; then echo "recovery did not finish:"; sudo docker logs --tail 15 dr-pitr-proof 2>&1 | cut -c1-200; exit 1; fi
STOP=$(sudo docker logs dr-pitr-proof 2>&1 | grep -m1 'recovery stopping before' || true)
[ -n "$STOP" ] || { echo "recovery never reached the target"; exit 1; }
echo "$STOP" | cut -c1-160
echo "replay took $(( $(date +%s)-START )) s"
TS="('$T'::timestamptz at time zone 'UTC')"
AFTER=$(PITR_Q "select count(*) from credit_transactions where created_at > $TS")
BEFORE=$(PITR_Q "select count(*) from credit_transactions where created_at <= $TS")
PROD_AFTER=$(PROD_Q "select count(*) from credit_transactions where created_at > $TS")
PROD_BEFORE=$(PROD_Q "select count(*) from credit_transactions where created_at <= $TS")
LAST=$(PITR_Q "select id||'|'||entry_hash from credit_transactions where entry_hash is not null order by created_at desc, id desc limit 1")
PROD_HASH=$(PROD_Q "select entry_hash from credit_transactions where id='${LAST%%|*}'")
echo "ledger rows up to the target: restored $BEFORE, production $PROD_BEFORE"
echo "ledger rows after the target: restored $AFTER, production $PROD_AFTER"
[ "$PROD_AFTER" -gt 0 ] || { echo "production has nothing after the target, so this proves nothing"; exit 1; }
[ "$AFTER" = 0 ] || { echo "replay went past the target"; exit 1; }
MISSING=$(( PROD_BEFORE - BEFORE ))
[ "$MISSING" -ge 0 ] && [ "$MISSING" -le 20 ] || { echo "restored ledger differs by $MISSING rows"; exit 1; }
[ "${LAST#*|}" = "$PROD_HASH" ] || { echo "last restored ledger row differs from production"; exit 1; }
echo "last restored ledger row matches production"
REMOTE

ssh $HOST "sudo touch /mnt/projects/xeno-platform/backups/.last-restore-proof"
echo "PROOF PASSED"
