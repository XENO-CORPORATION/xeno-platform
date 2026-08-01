/**
 * Credit Ledger v2 — double-entry, idempotent, micro-credit wallet.
 *
 * The canonical spend engine for the XENO unified account (see
 * `XENO ACCOUNT - ARCHITECTURE.md`). ADDITIVE: handles v2-routed spend (new
 * surfaces such as `xeno_post`) writing to the SHARED ledger tables that already
 * exist on live (credit_accounts / credit_transactions / api_usage_logs). It
 * never replaces the legacy `deductCredits` path — each request flows through
 * exactly one writer, so there is no double-count.
 *
 * Invariants:
 *  - Money is integer MICRO-credits (verified live: 1 credit = 1_000_000 µcr).
 *  - Balance changes are row-locked (SELECT … FOR UPDATE) — no oversell.
 *  - Every spend appends a credit_transactions row (the audit trail) AND an
 *    api_usage_logs row tagged with `surface` (the "from where").
 *  - Idempotent: usage on (user, reference_type, reference_id); holds on hold_id.
 *  - A wallet's `owner_kind` is ASSERTED by the caller or PROVEN from `users` —
 *    NEVER inferred. Every primitive takes an optional `ownerKind`; pass it whenever
 *    the subject may not be a user (workspace/org). See ensureAccount.
 *  - Mirrors users.credits = floor(balance_micro / 1e6) so legacy readers stay
 *    consistent during the strangler-fig transition.
 */
import crypto from 'node:crypto';

export const MICRO_PER_CREDIT = 1_000_000;
const REF_TYPE = 'xeno.usage';

/**
 * The wallet OWNER KINDS the ledger recognises. `credit_accounts.user_id` is a bare
 * subject id — it holds a USER id, a WORKSPACE id, or (soon) an ORG id — and
 * `owner_kind` is the only thing that says which. Anything outside this set is a
 * typo, and a typo'd kind would mint a whole new wallet species.
 */
export const OWNER_KINDS = Object.freeze(['user', 'workspace', 'org']);

function normalizeOwnerKind(ownerKind) {
  if (ownerKind === null || ownerKind === undefined) return null;
  if (!OWNER_KINDS.includes(ownerKind)) {
    const e = new Error(`unknown owner_kind '${ownerKind}' (expected one of: ${OWNER_KINDS.join(', ')})`);
    e.code = 'INVALID_OWNER_KIND';
    throw e;
  }
  return ownerKind;
}

/**
 * Ensure the SUBJECT has a credit_accounts wallet; backfill from legacy on first touch.
 *
 * 🔴 A wallet's `owner_kind` may NEVER be inferred. `user_id` is a bare subject id, so
 * this function cannot tell a user id from a workspace/org id by looking at it. It used
 * to omit `owner_kind` from the INSERT and let the column default to 'user' — which
 * meant ANY primitive called with a non-user subject (walletService's pooled workspace
 * billing does exactly that) silently minted a wallet typed `owner_kind='user'`, after
 * which `ensureWorkspaceWallet` throws WALLET_KIND_CONFLICT for that subject FOREVER.
 *
 * Now the kind is either ASSERTED by the caller or PROVEN from the `users` table:
 *   - `ownerKind` given          → create the wallet with exactly that kind;
 *   - no `ownerKind`, users row  → provably a user; legacy `users.credits` seed as before;
 *   - no `ownerKind`, no users row → REFUSE (SUBJECT_KIND_UNKNOWN). Never guess.
 *
 * An EXISTING wallet is always returned as-is (money is never re-typed). A caller whose
 * assertion disagrees with the stored kind gets a loud log, not an exception — the row
 * is already the authority for that subject's balance and failing the spend would turn a
 * bookkeeping discrepancy into an outage.
 */
async function ensureAccount(client, subjectId, ownerKind = null) {
  const asserted = normalizeOwnerKind(ownerKind);
  const found = await client.query(
    'SELECT id, balance, is_frozen, owner_kind FROM credit_accounts WHERE user_id = $1 FOR UPDATE',
    [subjectId],
  );
  if (found.rows.length > 0) {
    const row = found.rows[0];
    if (asserted && row.owner_kind && row.owner_kind !== asserted) {
      console.error(
        `[ledger] OWNER_KIND MISMATCH: wallet ${subjectId} is stored as owner_kind='${row.owner_kind}' `
        + `but the caller asserted '${asserted}' — using the EXISTING wallet (a wallet is never re-typed); `
        + 'this subject needs reconciliation',
      );
    }
    return row;
  }

  // Non-user subject, explicitly asserted: a workspace/org has no `users` row and no
  // legacy whole-credit balance to migrate, so it starts empty.
  if (asserted && asserted !== 'user') {
    const createdOther = await client.query(
      `INSERT INTO credit_accounts (user_id, owner_kind, balance, lifetime_earned, lifetime_spent)
       VALUES ($1, $2, 0, 0, 0)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
       RETURNING id, balance, is_frozen, owner_kind`,
      [subjectId, asserted],
    );
    return createdOther.rows[0];
  }

  // From here the wallet can only be a USER wallet — prove it before creating one.
  const legacy = await client.query('SELECT credits FROM users WHERE id = $1', [subjectId]);
  if (legacy.rows.length === 0 && asserted !== 'user') {
    const e = new Error(
      `refusing to create a credit wallet for subject ${subjectId}: no users row exists and no `
      + 'ownerKind was asserted — the wallet type cannot be inferred',
    );
    e.code = 'SUBJECT_KIND_UNKNOWN';
    throw e;
  }

  // Backfill the new wallet from the legacy whole-credit balance (× 1e6).
  const legacyCredits = legacy.rows[0]?.credits ?? 0;
  const seedMicro = BigInt(Math.max(0, legacyCredits)) * BigInt(MICRO_PER_CREDIT);
  const created = await client.query(
    `INSERT INTO credit_accounts (user_id, owner_kind, balance, lifetime_earned, lifetime_spent)
     VALUES ($1, 'user', $2, $2, 0)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
     RETURNING id, balance, is_frozen, owner_kind`,
    [subjectId, seedMicro.toString()],
  );
  return created.rows[0];
}

/** Sum of active holds (micro) for a user. */
async function activeHoldsMicro(client, userId) {
  // Only NON-EXPIRED holds reserve balance. A hold that outlives its expires_at (e.g. a
  // settle that failed all retries and was "left to expire") must stop locking credits —
  // there is no sweeper voiding rows, so the available-balance math self-heals at expiry.
  const r = await client.query(
    `SELECT COALESCE(SUM(amount_micro - settled_micro), 0)::bigint AS held
       FROM credit_holds WHERE user_id = $1 AND state = 'held' AND expires_at > now()`,
    [userId],
  );
  return BigInt(r.rows[0].held);
}

// ── Drawdown lots (Arch §4.7) ───────────────────────────────────────────────

const KIND_RANK = { free: 0, promo: 1, paid: 2 };

/**
 * Lazily migrate an account to lots: if it has balance but no live grants, seed a
 * single 'paid' lot = balance. Keeps existing accounts working under the new model.
 */
async function syncGrants(client, account, userId) {
  const g = await client.query(
    "SELECT COALESCE(SUM(remaining_micro),0)::bigint s FROM credit_grants WHERE user_id=$1 AND remaining_micro>0 AND (expires_at IS NULL OR expires_at>now())",
    [userId],
  );
  const grantSum = BigInt(g.rows[0].s);
  const balance = BigInt(account.balance);
  if (grantSum === 0n && balance > 0n) {
    await client.query(
      "INSERT INTO credit_grants (user_id, account_id, amount_micro, remaining_micro, kind, priority, source_ref) VALUES ($1,$2,$3,$3,'paid',100,'backfill')",
      [userId, account.id, balance.toString()],
    );
  }
}

/** Σ remaining of unexpired lots. */
async function grantsAvailable(client, userId) {
  const r = await client.query(
    "SELECT COALESCE(SUM(remaining_micro),0)::bigint s FROM credit_grants WHERE user_id=$1 AND remaining_micro>0 AND (expires_at IS NULL OR expires_at>now())",
    [userId],
  );
  return BigInt(r.rows[0].s);
}

/**
 * Draw `costMicro` from lots in §4.7 order. Caller has checked availability.
 * Returns the UNCOVERED remainder (0n when lots fully covered the draw). A
 * non-zero leftover means Σ(lots) < balance — reconciliation drift the caller
 * MUST surface (see reportLotDrift): the balance already moved, so we never
 * throw, but silent leftovers make lot/balance divergence invisible.
 */
async function drawdownGrants(client, userId, costMicro) {
  let need = costMicro;
  const lots = await client.query(
    `SELECT id, remaining_micro, kind FROM credit_grants
      WHERE user_id=$1 AND remaining_micro>0 AND (expires_at IS NULL OR expires_at>now())
      ORDER BY priority ASC, expires_at ASC NULLS LAST, created_at ASC, id ASC
      FOR UPDATE`,
    [userId],
  );
  // Stable tiebreak: free-before-paid within equal priority/expiry.
  const ordered = lots.rows.slice().sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || 0);
  for (const lot of ordered) {
    if (need <= 0n) break;
    const take = BigInt(lot.remaining_micro) < need ? BigInt(lot.remaining_micro) : need;
    await client.query('UPDATE credit_grants SET remaining_micro = remaining_micro - $1 WHERE id = $2', [take.toString(), lot.id]);
    need -= take;
  }
  return need; // 0 if fully covered
}

/**
 * LOUD observability for lot/balance drift (never throws — the money already
 * moved; this makes the divergence visible for reconciliation instead of
 * silently discarding the uncovered remainder).
 */
function reportLotDrift(op, { userId, accountId = null, requestedMicro, leftoverMicro }) {
  if (leftoverMicro > 0n) {
    console.error(
      `[ledger] LOT DRIFT: ${op} drawdown under-covered — user=${userId} account=${accountId} `
      + `requested=${requestedMicro}µcr uncovered=${leftoverMicro}µcr (Σ(lots) < balance; needs reconciliation)`,
    );
  }
}

/**
 * Add a grant onto an EXISTING transaction (the caller owns BEGIN/COMMIT), so
 * money-IN can be composed atomically with the caller's own writes (e.g. a Stripe
 * event claim). Appends the tamper-evident journal row so a deposit is auditable —
 * not just a lot + balance bump — and, when sourceRef is set, is idempotent via
 * uq_credit_txn_ref: a replayed grant with the same ref hits the unique index and
 * rolls the caller's transaction back. Returns { accountId, amountMicro, newBalanceMicro }.
 */
export async function addGrantTx(client, userId, {
  amountMicro, kind = 'paid', priority, expiresAt = null, sourceRef = null, ownerKind = null,
}) {
  const amt = BigInt(Math.max(1, Math.round(amountMicro)));
  const prio = priority ?? (kind === 'free' ? 10 : kind === 'promo' ? 50 : 100);
  // `ownerKind` types a wallet this call may CREATE (workspace/org subjects have no
  // users row); omit it only when the subject is provably a user.
  const acct = await ensureAccount(client, userId, ownerKind); // SELECT … FOR UPDATE locks the account (race-free hash chain)
  // DEF-4: if ensureAccount just backfilled a legacy seed balance (balance>0 but no lots),
  // lot that seed FIRST so Σ(lots) == balance holds continuously. Without this, the seed is
  // spendable-from-balance but has no lot, so it drifts permanently below balance (and a
  // later spend can't draw it down). No-op once the account already has lots.
  await syncGrants(client, acct, userId);
  await client.query(
    'INSERT INTO credit_grants (user_id, account_id, amount_micro, remaining_micro, kind, priority, source_ref, expires_at) VALUES ($1,$2,$3,$3,$4,$5,$6,$7)',
    [userId, acct.id, amt.toString(), kind, prio, sourceRef, expiresAt],
  );
  const newBalance = BigInt(acct.balance) + amt;
  await client.query('UPDATE credit_accounts SET balance=$1, lifetime_earned=lifetime_earned+$2, updated_at=now() WHERE id=$3',
    [newBalance.toString(), amt.toString(), acct.id]);
  // Auditable money-IN: append the hash-chained journal row (positive credit).
  await insertLedgerEntry(client, {
    userId, accountId: acct.id, type: 'credit', amount: amt.toString(), balanceAfter: newBalance.toString(),
    refType: 'xeno.grant', refId: sourceRef,
    description: `grant:${kind}`,
    metadata: JSON.stringify({ kind, sourceRef }),
  });
  await mirrorLegacy(client, userId, newBalance);
  return { accountId: acct.id, amountMicro: Number(amt), newBalanceMicro: newBalance, isFrozen: Boolean(acct.is_frozen) };
}

/** Add a grant (credit top-up / promo / free allotment). Opens its own transaction. */
export async function addGrant(pool, userId, opts) {
  const client = await pool.connect();
  let r;
  try {
    await client.query('BEGIN');
    r = await addGrantTx(client, userId, opts);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  // Pool re-entrancy guard: this read checks out a SECOND connection, so it must
  // run AFTER client.release() — doing it while still holding the client makes
  // every call need 2 connections and deadlocks the pool at max concurrency.
  const held = await activeHoldsMicro(pool, userId).catch(() => 0n);
  return { granted: true, amountMicro: r.amountMicro, kind: opts.kind || 'paid', balance: balanceView(r.newBalanceMicro, held, r.isFrozen) };
}

/**
 * Claw back credits (refund / dispute reversal) onto an EXISTING transaction.
 * Reduces the balance by up to `micro` (never below zero — already-spent credits
 * are a real loss, reported as shortfall), draws the reversal out of remaining
 * lots, and appends a reversing journal entry (negative amount, type 'refund').
 * Idempotent via uq_credit_txn_ref when refId is set. Returns
 * { clawedMicro, requestedMicro, shortfallMicro, newBalanceMicro }.
 *
 * SIGN CONVENTION (ledger-wide, LOCKED): `credit_transactions.amount` is the
 * SIGNED BALANCE DELTA — positive when the balance goes UP, negative when it
 * goes DOWN — so `balance_after = previous balance_after + amount` holds for
 * every row (debit −, grant +, clawback −, usage-reversal +). Type 'refund'
 * therefore carries BOTH signs (a Stripe clawback takes money OUT: negative;
 * a failed-debit reversal puts money back IN: positive) — consumers must read
 * the SIGN (or metadata.direction), never assume type ⇒ sign. verifyChainV2
 * hashes amount as an opaque string and assertWithinCaps only sums
 * type='debit', so both are sign-agnostic. metadata.direction disambiguates
 * ('clawback' = money-out, 'reversal' = money-in) for type-level aggregation.
 */
export async function clawbackTx(client, userId, micro, {
  refType = 'xeno.refund', refId = null, description = 'clawback', metadata = null, ownerKind = null,
} = {}) {
  const want = BigInt(Math.max(0, Math.round(micro)));
  const acct = await ensureAccount(client, userId, ownerKind);
  const balance = BigInt(acct.balance);
  const clawed = want < balance ? want : balance; // clamp at zero
  if (clawed > 0n) {
    const leftover = await drawdownGrants(client, userId, clawed);
    reportLotDrift('clawbackTx', { userId, accountId: acct.id, requestedMicro: clawed, leftoverMicro: leftover });
  }
  const newBalance = balance - clawed;
  await client.query('UPDATE credit_accounts SET balance=$1, updated_at=now() WHERE id=$2', [newBalance.toString(), acct.id]);
  await insertLedgerEntry(client, {
    // amount is the signed balance delta (see sign convention above): clawback
    // takes money OUT → negative. metadata.direction marks it explicitly.
    userId, accountId: acct.id, type: 'refund', amount: (-clawed).toString(), balanceAfter: newBalance.toString(),
    refType, refId, description,
    metadata: JSON.stringify({ direction: 'clawback', requestedMicro: Number(want), ...(metadata || {}) }),
  });
  await mirrorLegacy(client, userId, newBalance);
  return { clawedMicro: Number(clawed), requestedMicro: Number(want), shortfallMicro: Number(want - clawed), newBalanceMicro: newBalance };
}

/** Claw back credits, opening its own transaction. */
export async function clawback(pool, userId, micro, opts = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await clawbackTx(client, userId, micro, opts);
    await client.query('COMMIT');
    return r;
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}

/**
 * Reverse a just-failed debit — money back IN to the user (a generation was charged
 * up front, then the provider/watermark failed). Unlike addGrant this is a REVERSING
 * entry, not a new deposit (DEF-5): it restores balance, DECREMENTS lifetime_spent
 * (a refund un-does a spend; it is NOT lifetime_earned), re-credits a NEUTRAL paid-
 * priority lot so drawdown order is unchanged (vs the old kind:'promo', which jumped
 * the queue and inflated lifetime_earned), and appends a type='refund' journal row
 * keyed to the original debit's txn via refType 'xeno.refund' — distinct from the
 * debit's 'xeno.usage' so it never collides with the original, while uq_credit_txn_ref
 * still makes a REPLAYED refund (same refId) a no-op. Full-fidelity restoration of the
 * exact drawn lots needs a drawdown-detail schema (money-schema go/no-go); this interim
 * form fixes the counter/priority/idempotency defects. On the caller's transaction.
 *
 * SIGN CONVENTION: amount = signed balance delta (see clawbackTx). A usage
 * reversal puts money back IN → POSITIVE amount (balance_after = balance + amt).
 * This is intentionally the opposite sign of clawbackTx under the same type
 * 'refund': the sign carries direction, metadata.direction labels it.
 */
export async function reverseUsageTx(client, userId, micro, { refId = null, description = 'refund', ownerKind = null } = {}) {
  const amt = BigInt(Math.max(1, Math.round(micro)));
  const acct = await ensureAccount(client, userId, ownerKind);
  await syncGrants(client, acct, userId); // keep Σ(lots)==balance before re-crediting
  await client.query(
    "INSERT INTO credit_grants (user_id, account_id, amount_micro, remaining_micro, kind, priority, source_ref) VALUES ($1,$2,$3,$3,'paid',100,$4)",
    [userId, acct.id, amt.toString(), refId ? `refund:${refId}` : 'refund'],
  );
  const newBalance = BigInt(acct.balance) + amt;
  await client.query(
    'UPDATE credit_accounts SET balance=$1, lifetime_spent=GREATEST(0, lifetime_spent-$2), updated_at=now() WHERE id=$3',
    [newBalance.toString(), amt.toString(), acct.id],
  );
  await insertLedgerEntry(client, {
    userId, accountId: acct.id, type: 'refund', amount: amt.toString(), balanceAfter: newBalance.toString(),
    refType: 'xeno.refund', refId,
    description,
    metadata: JSON.stringify({ direction: 'reversal', reversal: true, refId }),
  });
  await mirrorLegacy(client, userId, newBalance);
  return { reversedMicro: Number(amt), newBalanceMicro: newBalance, isFrozen: Boolean(acct.is_frozen) };
}

/** Reverse a failed debit, opening its own transaction. */
export async function reverseUsage(pool, userId, micro, opts = {}) {
  const client = await pool.connect();
  let r;
  try {
    await client.query('BEGIN');
    r = await reverseUsageTx(client, userId, micro, opts);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  // Pool re-entrancy guard: pool read AFTER release (see addGrant).
  const held = await activeHoldsMicro(pool, userId).catch(() => 0n);
  return { success: true, reversedMicro: r.reversedMicro, balance: balanceView(r.newBalanceMicro, held, r.isFrozen) };
}

/** Freeze / unfreeze an account (dispute response — stops further spend). */
export async function setFrozen(pool, userId, frozen) {
  await pool.query('UPDATE credit_accounts SET is_frozen=$1, updated_at=now() WHERE user_id=$2', [Boolean(frozen), userId]);
}

// ── Spend caps (Arch §4.6) ──────────────────────────────────────────────────

export async function setSpendCap(pool, userId, { windowSec, limitMicro }) {
  await pool.query(
    `INSERT INTO spend_caps (user_id, window_sec, limit_micro) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, window_sec) DO UPDATE SET limit_micro=EXCLUDED.limit_micro`,
    [userId, windowSec, BigInt(Math.max(0, Math.round(limitMicro))).toString()],
  );
  return { ok: true };
}

/** Throw SPEND_CAP_EXCEEDED if posting costMicro now would breach any window cap. */
async function assertWithinCaps(client, userId, costMicro) {
  const caps = await client.query('SELECT window_sec, limit_micro FROM spend_caps WHERE user_id=$1', [userId]);
  for (const cap of caps.rows) {
    const spent = await client.query(
      `SELECT COALESCE(SUM(-amount),0)::bigint s FROM credit_transactions
        WHERE user_id=$1 AND type='debit' AND created_at > now() - ($2 || ' seconds')::interval`,
      [userId, cap.window_sec],
    );
    if (BigInt(spent.rows[0].s) + costMicro > BigInt(cap.limit_micro)) {
      const e = new Error(`spend cap exceeded (${cap.window_sec}s window)`);
      e.code = 'SPEND_CAP_EXCEEDED';
      throw e;
    }
  }
}

/** Mirror the new authoritative balance down to legacy users.credits (whole). */
async function mirrorLegacy(client, userId, balanceMicro) {
  const whole = balanceMicro / BigInt(MICRO_PER_CREDIT); // floor for BigInt division
  await client.query('UPDATE users SET credits = $1 WHERE id = $2', [whole.toString(), userId]);
}

const GENESIS = 'GENESIS';
function chainHash(prevHash, e) {
  return crypto.createHash('sha256')
    .update([prevHash, e.userId, e.type, e.amount, e.balanceAfter, e.refType, e.refId].join('|'))
    .digest('hex');
}

/**
 * Append a journal entry with a per-account hash chain (Arch §5, CloudTrail
 * pattern): entry_hash = SHA256(prev_hash ‖ user ‖ type ‖ amount ‖ balance_after
 * ‖ ref). Altering or deleting any past row breaks every subsequent hash → the
 * money journal is tamper-evident. Runs inside the caller's account-locked
 * transaction (credit_accounts FOR UPDATE), so the prev-hash read is race-free.
 */
async function insertLedgerEntry(client, e) {
  const prev = await client.query(
    'SELECT entry_hash FROM credit_transactions WHERE account_id=$1 AND entry_hash IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1',
    [e.accountId],
  );
  const prevHash = prev.rows[0]?.entry_hash || GENESIS;
  const entryHash = chainHash(prevHash, e);
  await client.query(
    `INSERT INTO credit_transactions
       (user_id, account_id, type, amount, balance_after, reference_type, reference_id, description, metadata, prev_hash, entry_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
    [e.userId, e.accountId, e.type, e.amount, e.balanceAfter, e.refType, e.refId, e.description, e.metadata, prevHash, entryHash],
  );
  return entryHash;
}

/** Walk a user's journal, recompute the chain, report the first break (Arch §5). */
export async function verifyChainV2(pool, userId) {
  const acct = await pool.query('SELECT id FROM credit_accounts WHERE user_id=$1', [userId]);
  if (acct.rows.length === 0) return { ok: true, entries: 0 };
  const rows = (await pool.query(
    `SELECT type, amount, balance_after, reference_type, reference_id, prev_hash, entry_hash
       FROM credit_transactions WHERE account_id=$1 AND entry_hash IS NOT NULL
       ORDER BY created_at ASC, id ASC`,
    [acct.rows[0].id],
  )).rows;
  let prevHash = GENESIS;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const expect = chainHash(prevHash, {
      userId, type: r.type, amount: r.amount, balanceAfter: r.balance_after, refType: r.reference_type, refId: r.reference_id,
    });
    if (r.prev_hash !== prevHash || r.entry_hash !== expect) {
      return { ok: false, entries: rows.length, brokenAt: i, transactionId: r.reference_id };
    }
    prevHash = r.entry_hash;
  }
  return { ok: true, entries: rows.length, head: prevHash };
}

/**
 * Unified usage aggregation (Arch §4.5/§7 "where/what" view). groupBy is a
 * dimension (surface/operation/model/provider) — no platform conditionals.
 */
export async function usageSummary(pool, userId, { from, to, groupBy = 'surface' }) {
  const col = { surface: 'surface', operation: 'operation', model: 'model', provider: 'provider' }[groupBy] || 'surface';
  const r = await pool.query(
    `SELECT ${col} AS key, COUNT(*)::int AS events,
            COALESCE(SUM(actual_cost_micro),0)::bigint AS cost_micro,
            COALESCE(SUM(input_tokens),0)::bigint  AS input_tokens,
            COALESCE(SUM(output_tokens),0)::bigint AS output_tokens
       FROM api_usage_logs
      WHERE user_id=$1 AND created_at >= $2 AND created_at < $3
      GROUP BY ${col} ORDER BY cost_micro DESC`,
    [userId, from, to],
  );
  return {
    from, to, groupBy,
    rows: r.rows.map((x) => ({
      key: x.key, events: x.events, costMicro: Number(x.cost_micro),
      inputTokens: Number(x.input_tokens), outputTokens: Number(x.output_tokens),
    })),
  };
}

/** Posted / pending / available balance (micro) + freeze state. */
export async function getBalanceV2(pool, userId) {
  const client = await pool.connect();
  try {
    const acct = await client.query('SELECT balance, is_frozen FROM credit_accounts WHERE user_id = $1', [userId]);
    if (acct.rows.length === 0) {
      // No wallet yet → derive from legacy so reads work before first spend.
      const legacy = await client.query('SELECT credits FROM users WHERE id = $1', [userId]);
      const micro = BigInt(Math.max(0, legacy.rows[0]?.credits ?? 0)) * BigInt(MICRO_PER_CREDIT);
      return balanceView(micro, 0n, false);
    }
    const posted = BigInt(acct.rows[0].balance);
    const held = await activeHoldsMicro(client, userId);
    return balanceView(posted, held, acct.rows[0].is_frozen);
  } finally {
    client.release();
  }
}

function balanceView(postedMicro, heldMicro, isFrozen = false) {
  const available = postedMicro - heldMicro;
  return {
    postedMicro: Number(postedMicro),
    pendingMicro: Number(postedMicro), // posted incl. holds reservation view
    availableMicro: Number(available < 0n ? 0n : available),
    currency: 'credits',
    is_frozen: Boolean(isFrozen),
    asOf: new Date().toISOString(),
  };
}

/**
 * Direct usage debit (idempotent on transactionId). Returns
 * { accepted, duplicate, costMicro, transactionId, balance }.
 */
export async function recordUsageV2(pool, userId, event) {
  const costMicro = BigInt(Math.max(0, Math.round(event.costMicro ?? 0)));
  const client = await pool.connect();
  let outcome; // { duplicate:true } | { duplicate:false, newBalance, held }
  try {
    await client.query('BEGIN');

    // Idempotency: replayed event → no-op.
    const dupe = await client.query(
      'SELECT 1 FROM credit_transactions WHERE user_id = $1 AND reference_type = $2 AND reference_id = $3',
      [userId, REF_TYPE, event.transactionId],
    );
    if (dupe.rows.length > 0) {
      await client.query('COMMIT');
      outcome = { duplicate: true };
    } else {
      const acct = await ensureAccount(client, userId, event.ownerKind ?? null);
      if (acct.is_frozen) {
        await client.query('ROLLBACK');
        const err = new Error('account frozen');
        err.code = 'ACCOUNT_FROZEN';
        throw err;
      }
      await syncGrants(client, acct, userId);          // lazily migrate to lots (§4.7)
      await assertWithinCaps(client, userId, costMicro); // spend-cap invariant (§4.6)
      const balance = BigInt(acct.balance);
      const held = await activeHoldsMicro(client, userId);
      if (balance - held < costMicro) {
        await client.query('ROLLBACK');
        const err = new Error('insufficient credits');
        err.code = 'INSUFFICIENT_CREDITS';
        throw err;
      }

      const leftover = await drawdownGrants(client, userId, costMicro);  // draw from lots in §4.7 order
      reportLotDrift('recordUsageV2', { userId, accountId: acct.id, requestedMicro: costMicro, leftoverMicro: leftover });
      const newBalance = balance - costMicro;
      await client.query(
        'UPDATE credit_accounts SET balance = $1, lifetime_spent = lifetime_spent + $2, updated_at = now() WHERE id = $3',
        [newBalance.toString(), costMicro.toString(), acct.id],
      );
      await insertLedgerEntry(client, {
        userId, accountId: acct.id, type: 'debit', amount: (-costMicro).toString(), balanceAfter: newBalance.toString(),
        refType: REF_TYPE, refId: event.transactionId,
        description: `${event.surface}:${event.operation}`,
        metadata: JSON.stringify({ surface: event.surface, operation: event.operation, model: event.model ?? null, ...event.dimensions }),
      });
      await insertUsageLog(client, userId, event, costMicro);
      await mirrorLegacy(client, userId, newBalance);

      await client.query('COMMIT');
      outcome = { duplicate: false, newBalance, held };
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (outcome.duplicate) {
    // Pool re-entrancy guard: getBalanceV2 checks out its OWN connection, so it
    // must run only after client.release() (above) — never while a client is held.
    const bal = await getBalanceV2(pool, userId);
    return { accepted: true, duplicate: true, costMicro: Number(costMicro), transactionId: event.transactionId, balance: bal };
  }
  return {
    accepted: true,
    duplicate: false,
    costMicro: Number(costMicro),
    transactionId: event.transactionId,
    balance: balanceView(outcome.newBalance, outcome.held),
  };
}

/** Reserve credits (phase 1). Idempotent on holdId. Throws INSUFFICIENT_CREDITS. */
export async function holdV2(pool, userId, req) {
  const amountMicro = BigInt(Math.max(1, Math.round(req.amountMicro)));
  const client = await pool.connect();
  let outcome; // { existingRow } | { row, balance, held, isFrozen }
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM credit_holds WHERE user_id = $1 AND hold_id = $2', [userId, req.holdId]);
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      outcome = { existingRow: existing.rows[0] };
    } else {
      const acct = await ensureAccount(client, userId, req.ownerKind ?? null);
      const balance = BigInt(acct.balance);
      const held = await activeHoldsMicro(client, userId);
      if (acct.is_frozen || balance - held < amountMicro) {
        await client.query('ROLLBACK');
        const err = new Error('insufficient credits');
        err.code = acct.is_frozen ? 'ACCOUNT_FROZEN' : 'INSUFFICIENT_CREDITS';
        throw err;
      }
      const expiresAt = new Date(Date.now() + (req.expiresInSeconds ?? 900) * 1000);
      const row = await client.query(
        `INSERT INTO credit_holds (user_id, account_id, hold_id, surface, operation, amount_micro, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [userId, acct.id, req.holdId, req.surface, req.operation, amountMicro.toString(), expiresAt.toISOString()],
      );
      await client.query('COMMIT');
      outcome = { row: row.rows[0], balance, held, isFrozen: Boolean(acct.is_frozen) };
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (outcome.existingRow) {
    // Pool re-entrancy guard: getBalanceV2 needs its own connection → AFTER release.
    return holdView(outcome.existingRow, await getBalanceV2(pool, userId));
  }
  return holdView(outcome.row, balanceView(outcome.balance, outcome.held + amountMicro, outcome.isFrozen));
}

/** Settle a hold for the actual cost (phase 2). Posting < held restores the rest. */
export async function settleHoldV2(pool, userId, holdId, actualCostMicro, { ownerKind = null } = {}) {
  const client = await pool.connect();
  let finalRow;
  try {
    await client.query('BEGIN');
    const h = await client.query("SELECT * FROM credit_holds WHERE user_id=$1 AND hold_id=$2 FOR UPDATE", [userId, holdId]);
    if (h.rows.length === 0) { await client.query('ROLLBACK'); const e = new Error('hold not found'); e.code='NOT_FOUND'; throw e; }
    const hold = h.rows[0];
    if (hold.state !== 'held') { // idempotent: already settled/voided
      await client.query('COMMIT');
      finalRow = hold;
    } else {
      const requested = BigInt(Math.min(Math.max(0, Math.round(actualCostMicro)), Number(hold.amount_micro)));
      // A settle only reaches here when the hold EXISTS, which means holdV2 already
      // created the wallet — ensureAccount returns the existing row. `ownerKind` is
      // threaded anyway so the degenerate "hold without wallet" case still refuses
      // to guess rather than minting a mis-typed wallet.
      const acct = await ensureAccount(client, userId, ownerKind);
      await syncGrants(client, acct, userId);
      // Never drive the balance negative: a refund/dispute clawback can reduce the posted
      // balance below this hold's reservation while the operation was in flight. Charge only
      // what's still available (the rest was already returned to the customer).
      const posted = BigInt(acct.balance);
      const avail = posted < 0n ? 0n : posted;
      const actual = requested < avail ? requested : avail;
      if (actual > 0n) {
        const leftover = await drawdownGrants(client, userId, actual); // draw from lots (§4.7)
        reportLotDrift('settleHoldV2', { userId, accountId: acct.id, requestedMicro: actual, leftoverMicro: leftover });
      }
      const newBalance = posted - actual;
      await client.query('UPDATE credit_accounts SET balance=$1, lifetime_spent=lifetime_spent+$2, updated_at=now() WHERE id=$3',
        [newBalance.toString(), actual.toString(), acct.id]);
      await client.query("UPDATE credit_holds SET state='settled', settled_micro=$1, updated_at=now() WHERE id=$2",
        [actual.toString(), hold.id]);
      await insertLedgerEntry(client, {
        userId, accountId: acct.id, type: 'debit', amount: (-actual).toString(), balanceAfter: newBalance.toString(),
        refType: 'xeno.hold', refId: holdId,
        description: `${hold.surface}:${hold.operation}`,
        metadata: JSON.stringify({ surface: hold.surface, operation: hold.operation, holdId }),
      });
      await insertUsageLog(client, userId, { surface: hold.surface, operation: hold.operation, transactionId: holdId }, actual);
      await mirrorLegacy(client, userId, newBalance);
      await client.query('COMMIT');
      const updated = await client.query('SELECT * FROM credit_holds WHERE id=$1', [hold.id]);
      finalRow = updated.rows[0];
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  // Pool re-entrancy guard: getBalanceV2 checks out its own connection → only
  // after client.release(), or the pool deadlocks at max concurrency.
  return holdView(finalRow, await getBalanceV2(pool, userId));
}

/** Release a hold without charging. Idempotent. */
export async function voidHoldV2(pool, userId, holdId) {
  // No transaction needed (single idempotent UPDATE + read) — run directly on the
  // pool so we never hold a client while getBalanceV2 checks out a second one
  // (pool re-entrancy guard).
  await pool.query("UPDATE credit_holds SET state='voided', updated_at=now() WHERE user_id=$1 AND hold_id=$2 AND state='held'",
    [userId, holdId]);
  const row = await pool.query('SELECT * FROM credit_holds WHERE user_id=$1 AND hold_id=$2', [userId, holdId]);
  if (row.rows.length === 0) { const e = new Error('hold not found'); e.code='NOT_FOUND'; throw e; }
  return holdView(row.rows[0], await getBalanceV2(pool, userId));
}

/**
 * Void holds whose expiry has passed but were never settled/voided (phantom holds).
 * getBalanceV2/holdV2 already IGNORE expired holds (activeHoldsMicro filters
 * expires_at > now), so the available-balance math self-heals — but without this job
 * the rows accumulate forever in state='held'. This bounds the table and makes the
 * state truthful. Idempotent; FOR UPDATE SKIP LOCKED so it never contends with a live
 * settle. Returns the number of holds voided. (Blocker #7 INFRA-7.3.)
 */
export async function sweepExpiredHolds(pool, { batchLimit = 1000 } = {}) {
  const res = await pool.query(
    `UPDATE credit_holds SET state='voided', updated_at=now()
       WHERE id IN (
         SELECT id FROM credit_holds
           WHERE state='held' AND expires_at <= now()
           ORDER BY expires_at ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED
       )`,
    [batchLimit],
  );
  return res.rowCount;
}

async function insertUsageLog(client, userId, event, costMicro) {
  // api_usage_logs requires NOT NULL: user_id, endpoint, method, status.
  // The v2 ledger route is the "endpoint" that incurred the cost; method = POST.
  await client.query(
    `INSERT INTO api_usage_logs
       (user_id, surface, operation, model, provider, actual_cost_micro, estimated_cost_micro,
        input_tokens, output_tokens, status, request_id, endpoint, method, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,'ok',$9,$10,'POST', now())`,
    [
      userId, event.surface, event.operation, event.model ?? null, event.provider ?? null,
      costMicro.toString(), event.inputTokens ?? 0, event.outputTokens ?? 0, event.transactionId,
      `/api/v2/ledger/usage:${event.operation}`,
    ],
  );
}

function holdView(row, balance) {
  return {
    holdId: row.hold_id,
    state: row.state,
    amountMicro: Number(row.amount_micro),
    settledMicro: Number(row.settled_micro ?? 0),
    balance,
  };
}

/** Stable deterministic id helper for callers without one (rarely needed). */
export function deterministicTxnId(...parts) {
  return crypto.createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 32);
}
