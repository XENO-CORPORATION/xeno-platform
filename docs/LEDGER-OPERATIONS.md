# Operating the credit ledger's chain

What the ledger's tamper-evidence is, how to read it, and what to do when it speaks. Why it is built this way:
`docs/decisions/2026-10-30-ledger-chain-v2.md`. Database credentials: `docs/DATABASE-ROLES.md`.

## What exists

| Layer | What it does | Where |
|---|---|---|
| **The chain** | Every row in `credit_transactions`, from any writer, gets the next number and a fingerprint binding the one before. The database does it, so no program can skip, fork or reorder it | trigger `ledger_chain_append`, `src/server/database/migrate-account-v2.js` |
| **Sealed history** | Rows from before the chain are bound into the account's epoch 1 and reported as found. Never rewritten | `ledger_chain_epochs`, attestation `history-sealed` |
| **Hourly audit** | Verifies every account: fingerprints recomputed in Node, numbering, completeness (a row with no fingerprint is found too) | `src/server/services/ledgerChainAudit.js`, on the leader |
| **Outside anchor** | Every hour, every account's newest fingerprint goes into a signed checkpoint, written once to a locked R2 prefix. Someone able to rewrite the whole database can make the chain verify; they cannot make it match the bucket | `src/server/services/ledgerChainAnchor.js`, R2 `xeno-artifacts/ledger-anchors/` |
| **Restricted role** | The app connects as `xeno_app`, which can append but cannot edit the journal or switch the trigger off | `src/server/database/runtime-role.js` |

## The anchor, in detail

- **Where:** the `ledger-anchors/` prefix of the `xeno-artifacts` bucket, under retention lock `ledger-anchors-10y` (Age,
  315,360,000 s: ten years, the German retention period for accounting records). While the rule applies, R2 refuses to
  overwrite or delete an object, whatever key is used. The rule itself is changed only through the Cloudflare API, never
  with the S3 key the app holds. That lock is the wall; a dedicated key on the same server would add nothing to it.
- **Objects:** `ledger-anchors/checkpoints/<12-digit number>.json` (body, its SHA-256, key id, Ed25519 signature) and
  `ledger-anchors/keys/<key id>.json` (the public key). A checkpoint holds account ids and fingerprints, no personal data.
- **Key:** `LEDGER_ANCHOR_PRIVATE_KEY` in the box's `.env` (base64 PKCS#8 DER). The public half is in
  `src/server/data/ledger-anchor-keys.json`, which is the trust list.
- **Unset settings:** nothing is anchored and the log says `anchor not configured`.

The audit compares the chain with the newest checkpoint every hour and with **every** checkpoint at start and daily,
because someone holding the signing key could add a forged newer one but cannot remove an honest older one.

## Reading it

Every pass logs one line:

```
[LedgerChain] audit: 80/80 verified, 0 broken, 3 attested, 0 sealed; anchor checkpoint 14 written
```

```bash
# Check everything from outside the running app. Read-only; exits non-zero on any disagreement.
sudo docker exec <backend> node scripts/verify-ledger-anchors.mjs
```

```sql
-- Latest verdict per account
SELECT DISTINCT ON (account_id) account_id, kind, seq, report, created_at
  FROM ledger_chain_attestations WHERE kind IN ('verified','broken') ORDER BY account_id, created_at DESC;
-- What each account's history held when it was sealed
SELECT account_id, report FROM ledger_chain_attestations WHERE kind = 'history-sealed';
```

`GET /api/v2/ledger/verify` answers for the signed-in person's own account.

## When it says something is wrong

Treat any of these as an incident. Do not "fix" a row: the journal is append-only, and corrections are reversing entries.

| Log or reason | Meaning | Do this |
|---|---|---|
| `entry-hash` | A chained row was changed after it was written | Find the row (`transactionId`, `seq`). Compare with the last backup. Someone with superuser rights did this |
| `sequence-gap` | A chained row was removed | As above; restore the row's facts from backup into the incident record |
| `head-mismatch`, `epoch-hash`, `epoch-link` | The chain's own records were changed | As above |
| `unchained-entries` | A row exists that the trigger did not number: the trigger was off | Check for a rollback window. If it was one, re-seal (below). If not, it is an incident |
| `anchor-mismatch` | The chain verifies but differs from the bucket: **a rewrite, or a restored database.** New checkpoints are blocked until a person acts | Establish which. Restored from backup: acknowledge (below). Otherwise it is an incident |
| `ANCHOR checkpoint-missing-from-bucket`, `checkpoint-signature`, `checkpoint-chain` | The bucket disagrees with itself | Check the Cloudflare audit log for the account |
| `ANCHOR anchor-unreachable` | R2 did not answer | Nothing is lost; the next pass retries. Investigate if it persists |

## Re-seal, after a rollback window

If `trg_credit_txn_chain_append` was dropped (the documented rollback), rows written meanwhile have no fingerprint and
every check reports `unchained-entries`. That is correct. Once the trigger is back, a person may accept those rows:

```bash
cd /mnt/projects/xeno-platform
sudo docker compose --project-name xeno-platform --env-file .env --profile jobs run --rm --no-deps migrate \
  node scripts/ledger-reseal.mjs --account <uuid> --actor "<name>" --reason "<why>"            # dry run
# ...the same with --confirm to do it
```

It opens a new epoch and records who, why and how many rows in a `resealed` attestation. It refuses when the break is
anything other than unchained rows, and earlier epochs are still verified, so it cannot hide an altered entry. The
runtime role cannot execute it.

## Acknowledge, after a restore from backup

A restored database no longer contains heads the bucket anchored, so every check reports `anchor-mismatch` and no new
checkpoint is written. After confirming that is the reason:

```bash
sudo docker exec <backend> node scripts/ledger-anchor-acknowledge.mjs --actor "<name>" --reason "<why>"    # dry run
# ...the same with --confirm to do it
```

This writes a checkpoint carrying who, why and what differed. Nothing is erased: older checkpoints stay in the bucket,
and `verify-ledger-anchors.mjs` prints every acknowledgement forever.

## Rotating the signing key

1. Generate a new key on the box; add its public half to `src/server/data/ledger-anchor-keys.json` next to the old one.
2. Deploy that. Then change `LEDGER_ANCHOR_PRIVATE_KEY` in `.env` and recreate the backend.
3. Keep the old public key: old checkpoints need it to verify.

## Changing the journal's shape

`hash_version` is on every row. A new fingerprint format means a new version and the verifier handling both. Never
recompute existing hashes.

## Rollback

See the decision record. In short: dropping the trigger takes 5 ms and money keeps flowing; rows written meanwhile then
need a re-seal.
