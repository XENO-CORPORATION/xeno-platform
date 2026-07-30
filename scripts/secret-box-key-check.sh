#!/usr/bin/env bash
#
# secret-box-key-check.sh — keep the five copies of SECRET_BOX_KEY honest.
#
# WHY THIS EXISTS
# ---------------
# The at-rest encryption key is replicated to five locations so that losing any
# one machine does not cost 100 YouTube channels (docs/DR.md §7). Replication
# buys availability and immediately creates a second problem: the copies can
# DRIFT. Rotate the key on xeno-platform-001 and forget the rest, and you are
# left with four confidently wrong files. Restoring one of those during an
# incident does not fail loudly — it re-encrypts live data under the wrong key
# and destroys the originals.
#
# So drift has to be observable, and the sync has to be one command rather than
# five remembered ones.
#
# WHY IT RUNS FROM THE WORKSTATION
# --------------------------------
# No server can do this. The copies deliberately live on hosts that cannot reach
# each other: xeno-private-api-001 is excluded because its :15433 tunnel would
# put the key and the ciphertext on one host, and bnkr-node-001 has no SSH trust
# into the VMs. Granting hosts SSH access to each other would weaken that
# isolation to solve a monitoring problem — the wrong trade. The operator
# workstation already has reach to all five; that is the right place.
#
# SAFETY
#   · --check is the DEFAULT and is strictly read-only.
#   · --sync requires --confirm, and REFUSES if the live key cannot be read.
#   · The key value is never printed. Everything is compared by sha256.
#
# USAGE
#   ./scripts/secret-box-key-check.sh              # compare (read-only)
#   ./scripts/secret-box-key-check.sh --sync --confirm   # push live -> escrows
#
# Run --check after ANY key rotation, and after rebuilding any of these hosts.

set -uo pipefail

MODE=check
CONFIRM=no
for a in "$@"; do
  case "$a" in
    --check)   MODE=check ;;
    --sync)    MODE=sync ;;
    --confirm) CONFIRM=yes ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done

# host | privilege prefix | how to read the key value on that host
# The live copy is an .env LINE (KEY=value); the escrows store that same line
# verbatim, so every reader below yields the identical bytes.
LIVE_HOST="xeno-platform-001"
LIVE_READ='sudo -n grep "^SECRET_BOX_KEY=" /mnt/projects/xeno-platform/.env'

ESCROWS=(
  "xeno-platform-001|sudo -n cat /root/.xeno-secrets/secret-box-key|same box as live (guards .env overwrite)"
  "xeno-mail-001|sudo -n cat /root/.xeno-secrets/xeno-platform-secret-box-key|VM 132 on bnkr-node-001"
  "bnkr-node-001|cat /root/.xeno-secrets/xeno-platform-secret-box-key|the physical host itself"
  "htznr-bnkr-tunnel-001|cat /root/.xeno-secrets/xeno-platform-secret-box-key|HETZNER — the only OFF-SITE copy"
)

hash_of() { # $1 host, $2 read-command -> 16 hex chars, or empty on failure
  ssh -o ConnectTimeout=15 -o BatchMode=yes "$1" "$2 2>/dev/null | sha256sum | cut -c1-16" 2>/dev/null | tail -1
}

echo "SECRET_BOX_KEY custody check — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

LIVE="$(hash_of "$LIVE_HOST" "$LIVE_READ")"
if [ -z "$LIVE" ] || [ "${#LIVE}" -ne 16 ]; then
  echo "REFUSED: cannot read the live key on $LIVE_HOST."
  echo "Nothing was compared or written. Fix access first — a sync against an"
  echo "unreadable live key would happily overwrite good escrows with nothing."
  exit 1
fi
printf "  %-24s %-18s %s\n" "$LIVE_HOST" "$LIVE" "LIVE (.env, source of truth)"

drift=0
unreachable=0
for row in "${ESCROWS[@]}"; do
  IFS='|' read -r host readcmd note <<<"$row"
  h="$(hash_of "$host" "$readcmd")"
  if [ -z "$h" ]; then
    printf "  %-24s %-18s %s\n" "$host" "UNREACHABLE" "$note"
    unreachable=$((unreachable + 1))
  elif [ "$h" = "$LIVE" ]; then
    printf "  %-24s %-18s %s\n" "$host" "$h" "ok — $note"
  else
    printf "  %-24s %-18s %s\n" "$host" "$h" "*** DRIFT *** — $note"
    drift=$((drift + 1))
  fi
done

echo
if [ "$MODE" = check ]; then
  if [ "$drift" -gt 0 ]; then
    echo "$drift cop(ies) DRIFTED from the live key."
    echo
    echo "Do NOT restore a drifted copy onto the platform: re-encrypting live data"
    echo "under a wrong key destroys the originals. Decide which value is correct"
    echo "first — /api/health checks.secretbox tells you whether the LIVE key still"
    echo "opens the stored data. If it does, the live one is right and the escrows"
    echo "are stale: re-run with --sync --confirm."
    exit 1
  fi
  [ "$unreachable" -gt 0 ] && { echo "$unreachable host(s) unreachable — re-run when they are back."; exit 1; }
  echo "All copies match the live key."
  exit 0
fi

# ---- sync ----------------------------------------------------------------
if [ "$CONFIRM" != yes ]; then
  echo "DRY RUN: --sync given without --confirm. Nothing was written."
  echo "Re-run with:  $0 --sync --confirm"
  exit 0
fi

echo "Pushing the live key to every escrow location..."
for row in "${ESCROWS[@]}"; do
  IFS='|' read -r host readcmd note <<<"$row"
  # Derive the destination path and privilege from the read command itself, so
  # the two can never disagree about where a copy lives.
  dest="${readcmd##* }"
  priv=""
  case "$readcmd" in "sudo -n"*) priv="sudo -n" ;; esac
  if ssh -o ConnectTimeout=15 "$LIVE_HOST" "$LIVE_READ" 2>/dev/null \
     | ssh -o ConnectTimeout=15 "$host" "$priv install -d -m 700 \$(dirname $dest) && $priv tee $dest >/dev/null && $priv chmod 600 $dest" 2>/dev/null; then
    new="$(hash_of "$host" "$readcmd")"
    [ "$new" = "$LIVE" ] && printf "  %-24s synced + verified\n" "$host" \
                         || printf "  %-24s WROTE BUT VERIFY FAILED (%s)\n" "$host" "$new"
  else
    printf "  %-24s FAILED to write\n" "$host"
  fi
done
echo
echo "Re-run without --sync to confirm all copies match."
