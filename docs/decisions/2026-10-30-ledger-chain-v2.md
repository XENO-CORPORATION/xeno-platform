# Ledger chain v2 — the database is the sequencer (2026-10-30)

**Owner:** "the ledger hash chain is mandatory to have right? building it now" (2026-10-30).

## What was wrong (measured on production, 2026-10-30, read-only)

`credit_transactions` carried a per-account hash chain built in the application (`insertLedgerEntry`): each writer
read "the newest row by `created_at`" and hashed onto it. Of 80 accounts, one chain was broken — the owner's
(374,404 rows):

| finding | count | cause |
|---|---|---|
| rows never hashed | 147,769 (39%) | the gateway INSERTed `usage_debit` rows directly, 2026-04-21 → 2026-09-15 |
| forks (two rows naming one predecessor) | 358 rows in 290 groups, all 2026-09 | concurrent writers read the same newest row |
| adjacent order inversions | ~240 | `now()` is a transaction's START; fixed for new rows 2026-09-28 (`812db689`) |
| the reported "break at entry 105" | one of them | an inversion — the row's own hash is correct |

No row was altered: every hashed row's hash matches its own stored predecessor. The chain could not prove that,
though, which is the only thing a chain is for. Three design gaps made that possible and would make it possible again:
the chain was opt-in per writer, ordered by time rather than by a sequence, and never checked.

## Is it mandatory?

The **immutability** of the journal is (GoBD / § 146(4) AO: a booked entry may not be changed so that its original
content is no longer recognisable; corrections are new entries). A hash chain is how that is *proven* rather than
asserted, and it is what the architecture (Arch §5) promises. The DB already refused UPDATE/DELETE
(`trg_credit_txn_immutable`); the app connects as a superuser, so the trigger alone proves nothing to anyone who
could disable it.

## Benchmark

- **Certificate Transparency (RFC 9162)** — one sequencer assigns order; an append-only Merkle log; signed tree heads
  published so third parties can verify consistency. *Broke:* logs that failed to incorporate entries in time were
  disqualified — completeness is checked, not assumed.
- **AWS CloudTrail log-file integrity** — hourly digests, each binding the previous digest, signed, stored apart from
  the logs. *Broke:* integrity was opt-in per trail; unvalidated trails proved nothing.
- **Amazon QLDB** — journal with a hash chain and digests. *Broke:* end of support 2025-07; AWS points customers to
  Aurora PostgreSQL. A ledger feature belongs in the database we already run, not a special product.
- **TigerBeetle** — every operation gets its position from one serial order; checksums chain the log.
- **Double-entry bookkeeping (bound, pre-numbered ledger pages)** — the sequence number is what makes a removed page
  visible; corrections are reversing entries; the books are closed and opened, never rewritten.

The standard they converge on: (1) one sequencer per chain, (2) every entry covered, (3) unambiguous encoding of
the material fields, (4) append-only, (5) checked continuously, (6) checkpoints anchored outside the writer's reach,
(7) history sealed at a cut-over, never rewritten.

## The decision

- A `BEFORE INSERT` trigger on `credit_transactions` (`ledger_chain_append`, `database/migrate-account-v2.js`)
  assigns `chain_seq` under a per-account head row lock (`ledger_chain_heads`), sets `prev_hash` to the head, sets
  `created_at` from commit order, and computes `entry_hash` — for **every** writer. `UNIQUE (account_id, chain_epoch,
  chain_seq)` makes a fork impossible.
- Hash v2: SHA-256 over length-prefixed material fields (account, epoch, seq, prev, user, type, amount,
  balance_after, reference type/id, time). No description or metadata: no free text in the chain, so erasure never
  has to touch it.
- **History is sealed, not rewritten.** The first v2 entry on an account opens epoch 1, whose hash binds the last
  v1 hash and the count of every earlier row. The verifier reports v1 history as found (`legacy`).
- `verifyAccountChain` recomputes everything in Node, independent of the SQL functions, and checks
  **completeness**: every row on the account is either sealed history or a chained entry, so a row inserted with
  the trigger disabled is found even though it carries no hash.
- An hourly leader job (`services/ledgerChainAudit.js`) verifies every account and appends `verified` / `broken` /
  `history-sealed` / `resealed` attestations (append-only).
- Checkpoints anchored outside the database, and the app running without the superuser: see the addendum below.

## Blast radius

Writers of `credit_transactions`: `insertLedgerEntry` (15 call sites, one function), the portal's
`opening_balance` insert (xeno-api-platform), and any future one — all chained by the trigger with no change.
Readers of `prev_hash` / `entry_hash`: `verifyChainV2` and `/api/v2/ledger/verify` only (no UI). Columns and tables
are additive.

## Rollback

`DROP TRIGGER trg_credit_txn_chain_append ON credit_transactions` returns to unchained inserts (the app no longer
computes v1 hashes, so rows written meanwhile carry none). The new columns and tables can stay; nothing reads them
but the verifier. Executed on a copy of production's journal, 2026-10-30: the drop takes 5 ms and money keeps flowing.

A row written during a rollback stays reported as `unchained-entries` after the trigger returns: the verifier is right,
the row is outside the chain. A person accepts such rows with a re-seal (`docs/LEDGER-OPERATIONS.md`).

Going back on the database role changes no data: restore the previous compose file (`docs/DATABASE-ROLES.md`).

## Proof

On a copy of production's `credit_accounts` + `credit_transactions` (384,517 rows, 80 accounts), 2026-10-30:

| step | result |
|---|---|
| migration | 335 ms; idempotent re-run 8 ms |
| first write on the largest account, sealing 374,452 rows | 199 ms |
| later writes | 8 ms; 50 concurrent in 359 ms |
| verify + legacy report on that account | 1.1 s; 52 chained, balance matches |
| legacy report | 226,683 hashed, 147,769 never hashed, 358 forking rows, 0 bad hashes |
| a write on each of the other 79, then the audit | 80 of 80 verified in 1.6 s |

Mutation-checked: removing the trigger, the completeness check, the sequence check or the hash recomputation each
fails `ledger-chain.test.mjs`.

## Not done yet (and what would make us revisit)

All three gaps recorded here on the first day were closed the same day (below). What remains:

- **The window between checkpoints.** A rewrite made and undone within the hour leaves no trace in the bucket; a rewrite
  that stays is found on the next pass. Revisit if the hour proves too long.
- **Who can still reach everything.** Root on the box holds the superuser password and the signing key; a Cloudflare
  administrator can remove the lock. Neither can do it unseen: the bucket's objects and Cloudflare's audit log are outside
  that box. Revisit before anyone beyond the owner holds either.
- **The signing key is on the box.** It proves a checkpoint came from us; the lock is what makes it permanent. A KMS would
  stop a stolen key signing forged checkpoints, and the full walk already catches those.
- Revisit if write volume on one account makes the head row a hot spot (it is one row lock per append, the same lock
  the account balance already takes).

## Addendum, same day: the remaining gaps closed

Owner, 2026-10-30: "lets address the remaining ones right and then document everything".

**The outside anchor.** Every hour, every head goes into a checkpoint bound to the previous one, signed with Ed25519, and
written once to `xeno-artifacts/ledger-anchors/` under a ten-year R2 retention lock. A dedicated bucket and key were the
first design; the prefix replaced them because a second key on the same server adds nothing, while the lock is what no R2
key can get past. Three decisions came out of testing it against attacks:

- A disagreement **blocks new checkpoints**. The first version wrote a new checkpoint carrying the rewritten head on the
  next pass, which would have laundered the rewrite. A test built to catch that found it.
- The outside check compares **every** checkpoint, not the newest, so someone holding the signing key cannot hide a
  rewrite behind a forged newer one. The audit does this at start and daily.
- A restore from backup is a real reason for heads to vanish, so a person can **acknowledge** it. It stays in the bucket
  and is printed by every later check.

**The restricted role.** The app connected as `postgres`, so the same credential that served a request could disable the
trigger. Backend and chat-workers now connect as `xeno_app`: data only, append-only on the journal, no DDL. That forced two
changes worth stating:

- 49 statements in 7 runtime files changed the schema during requests, including `ALTER TABLE users` on the login
  path. They moved to migration `20261102200000-request-time-schema.sql`, and `scripts/no-request-time-ddl.test.mjs` refuses
  new ones.
- Migrations became a separate job run before the swap (the pattern of every leader with a production database). The role
  decides what startup does, not a setting, and the app refuses to serve an unmigrated schema or a disabled chain.

It shipped in two deploys so that an automatic rollback lands on an image that already understands the new startup.

**The re-seal.** A person can accept rows written with the trigger off, naming who and why. Earlier epochs are still
verified, so it cannot cover an altered entry.

**Defects found on the way, all fixed:**

| Found | How | Effect if shipped |
|---|---|---|
| The trigger needed privileges the gateway and portal roles lack | Reading the role list | Their inserts into the journal would fail. Live briefly, between the first deploy and the fix; nothing had tried |
| New checkpoints laundered a rewrite | A test written for that attack | The rewrite would stop being detected after one pass |
| R2 answers 409, not 412, on a locked key | Trying to overwrite checkpoint 1 on production | Every checkpoint after the first would have failed |
| The old verifier hashed every row with the owner's id | Reading callers | False breaks on accounts with pool transfers |

**Proof, on production unless stated:**

| Claim | Evidence |
|---|---|
| The app runs as the restricted role | `printenv DB_USER` = `xeno_app` in backend and workers; `POSTGRES_PASSWORD` absent; healthchecks passed; no permission errors in the database log |
| It cannot undo the chain | With the real credential: refused to disable the trigger, update the journal, set `session_replication_role` |
| It works as that role, before the switch | On a copy of production's schema: ready, signup, login, 15 reads, a conversation written, no database errors |
| A checkpoint cannot be replaced | Overwriting checkpoint 1 with the app's key: `409 ObjectLockedByBucketPolicy` |
| A consistent rewrite is caught | `ledger-chain.test.mjs`: the rewritten chain verifies on its own, and the anchor reports `anchor-mismatch` |
| Tests | ledger-chain 60/60, money 21/21, core 50/50 (`erasure` green again), gates 210/210 |
| The tests can fail | 8 further mutations (anchoring over a mismatch, newest-only walk, no signature check, audit ignoring the anchor, no definer rights, writable journal, open re-seal, re-seal without a reason), each caught |

Operations: `docs/LEDGER-OPERATIONS.md`, `docs/DATABASE-ROLES.md`.
