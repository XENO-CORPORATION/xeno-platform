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
# 🔴 ROOM, measured (2026-11-22): the drill restores a whole copy of the cluster on the box Postgres runs on. The
# backups are streamed straight into each restore (no file on the box) and the two restores run one after the other,
# so the peak is one restored cluster. It needs that much plus 10 GB, from the live size, or it refuses.
DB_GB=$(ssh $HOST "sudo docker exec xenostudio-postgres psql -U postgres -d postgres -Atc 'SELECT ceil(sum(pg_database_size(datname))/1073741824.0) FROM pg_database'")
FREE_GB=$(ssh $HOST "df -BG --output=avail / | tail -1 | tr -dc 0-9")
[ "$FREE_GB" -ge $(( DB_GB + 10 )) ] || { echo "only ${FREE_GB} GB free on the box; a restored ${DB_GB} GB cluster needs $(( DB_GB + 10 ))"; exit 1; }
grep -m1 '^XENO_DB_BACKUP_GPG_PRIVATE_B64=' "$HOME/.xeno-secrets" | cut -d= -f2- | base64 -d | gpg --batch --quiet --import 2>/dev/null

DUMP=$(rclone lsf "$B" --files-only --max-depth 1 --include 'xenostudio-*.dump.gpg' | sort | tail -1)
BASE=$(rclone lsf "$B/base" --files-only | sort | tail -1)
WAL=$(rclone lsf "$B/wal" --files-only --use-server-modtime --max-age 20m | sort | tail -1)
echo "R2 newest: dump=$DUMP base=$BASE wal=$WAL"

echo "--- WAL segment decrypts"
rclone cat "$B/wal/$WAL" | gpg --batch --quiet --decrypt 2>/dev/null | wc -c

# The box keeps no copy of either backup (2026-11-22: both are encrypted in the pipe and nothing is kept locally), so
# there is no local file to compare with. The proof is stronger: each R2 object is decrypted here and streamed straight
# into a restore on the box; a truncated or altered object fails the restore, and the restored rows are compared with
# production's.
# SKIP_DUMP=1 runs only the point-in-time half (to repeat it after the dump half has passed); a full drill runs both
if [ "${SKIP_DUMP:-}" = 1 ]; then echo "--- dump restore SKIPPED (SKIP_DUMP=1)"; else
echo "--- full restore of the newest dump into a throwaway, offline database (streamed from R2, no file on the box)"
ssh $HOST 'bash -s' <<'REMOTE'
set -eu
IMG=$(sudo docker inspect xenostudio-postgres --format '{{.Config.Image}}')
sudo docker run -d --name dr-restore-proof --network none --cpus 2 --memory 4g -e POSTGRES_PASSWORD=x -e POSTGRES_DB=restoretest "$IMG" >/dev/null
for i in $(seq 1 60); do sudo docker exec dr-restore-proof pg_isready -U postgres -d restoretest -q && break; sleep 2; done
REMOTE
START_S=$(date +%s)
set +e
rclone cat "$B/$DUMP" | gpg --batch --quiet --decrypt 2>/dev/null \
  | ssh $HOST "sudo docker exec -i dr-restore-proof pg_restore -U postgres -d restoretest --no-owner --no-privileges 2>/tmp/dr-restore.err"
ST=("${PIPESTATUS[@]}")
set -e
# every stage counts: a download or decryption cut short must fail the drill, not pass as a smaller restore
RC=$(( ST[0] != 0 ? 90 : ST[1] != 0 ? 91 : ST[2] ))
echo "stream: rclone=${ST[0]} gpg=${ST[1]} restore=${ST[2]}"
ssh $HOST "RC='$RC' START_S='$START_S' bash -s" <<'REMOTE'
set -eu
echo "pg_restore exit=$RC errors=$(grep -c 'error:' /tmp/dr-restore.err || true) seconds=$(( $(date +%s)-START_S ))"
head -5 /tmp/dr-restore.err | cut -c1-200
Q="select 'tables',count(*) from information_schema.tables where table_schema='public' union all select 'users',count(*) from users union all select 'credit_transactions',count(*) from credit_transactions union all select 'credit_accounts',count(*) from credit_accounts"
echo "restored:"; sudo docker exec dr-restore-proof psql -U postgres -d restoretest -Atc "$Q"
echo "production now:"; sudo docker exec xenostudio-postgres psql -U postgres -d xenostudio -Atc "$Q"
rm -f /tmp/dr-restore.err
[ "$RC" = 0 ]
REMOTE
fi

echo "--- point-in-time recovery: that base plus WAL from R2, stopped at a chosen second"
ssh $HOST 'sudo docker rm -f -v dr-restore-proof >/dev/null 2>&1'   # the dump's restored copy goes first: one at a time
P=/mnt/projects/xeno-platform/backups/.proof-pitr
# the base backup, decrypted here and unpacked straight into the recovery directory on the box (no tar file there)
ssh $HOST "sudo rm -rf $P && sudo mkdir -p $P/wal $P/data"
set +e
rclone cat "$B/base/$BASE" | gpg --batch --quiet --decrypt 2>/dev/null | ssh $HOST "sudo tar xzf - -C $P/data"
BST=("${PIPESTATUS[@]}")
set -e
[ "${BST[0]}" = 0 ] && [ "${BST[1]}" = 0 ] && [ "${BST[2]}" = 0 ] || { echo "base backup stream failed: rclone=${BST[0]} gpg=${BST[1]} tar=${BST[2]}"; exit 1; }
echo "base backup $BASE unpacked"
START=$(ssh $HOST "sudo cat $P/data/backup_label" | sed -n 's/^START WAL LOCATION.*(file \([0-9A-F]*\)).*/\1/p')
[ -n "$START" ] || { echo "no start segment in the base backup"; exit 1; }
# The listing goes to a FILE, then node reads it: node reading a multi-megabyte stdin pipe on Windows closed the pipe early
# (2026-11-22: "write /dev/stdout: The pipe is being closed", 21k segments, an empty list), so the drill saw no WAL.
rclone lsjson "$B/wal" --files-only --use-server-modtime --no-mimetype > "$WORK/wal.json"
mapfile -t SEGS < <(node -e '
  const rows = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const r of rows) if (/^[0-9A-F]{24}\.gpg$/.test(r.Name)) console.log(r.Name + "|" + Math.floor(Date.parse(r.ModTime) / 1000));
' "$WORK/wal.json" | sort | awk -F'|' -v s="$START" '$1 >= s')
echo "WAL listed: $(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).length)' "$WORK/wal.json") objects, ${#SEGS[@]} since the base"
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

if [ "${SKIP_DUMP:-}" = 1 ]; then echo "POINT-IN-TIME HALF PASSED (no stamp: the dump half was skipped, so this is not a full drill)"; exit 0; fi
ssh $HOST "sudo touch /mnt/projects/xeno-platform/backups/.last-restore-proof"
echo "PROOF PASSED"
