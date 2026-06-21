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
 *  - Mirrors users.credits = floor(balance_micro / 1e6) so legacy readers stay
 *    consistent during the strangler-fig transition.
 */
import crypto from 'node:crypto';

export const MICRO_PER_CREDIT = 1_000_000;
const REF_TYPE = 'xeno.usage';

/** Ensure the user has a credit_accounts wallet; backfill from legacy on first touch. */
async function ensureAccount(client, userId) {
  const found = await client.query(
    'SELECT id, balance, is_frozen FROM credit_accounts WHERE user_id = $1 FOR UPDATE',
    [userId],
  );
  if (found.rows.length > 0) return found.rows[0];

  // Backfill the new wallet from the legacy whole-credit balance (× 1e6).
  const legacy = await client.query('SELECT credits FROM users WHERE id = $1', [userId]);
  const legacyCredits = legacy.rows[0]?.credits ?? 0;
  const seedMicro = BigInt(Math.max(0, legacyCredits)) * BigInt(MICRO_PER_CREDIT);
  const created = await client.query(
    `INSERT INTO credit_accounts (user_id, balance, lifetime_earned, lifetime_spent)
     VALUES ($1, $2, $2, 0)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
     RETURNING id, balance, is_frozen`,
    [userId, seedMicro.toString()],
  );
  return created.rows[0];
}

/** Sum of active holds (micro) for a user. */
async function activeHoldsMicro(client, userId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(amount_micro - settled_micro), 0)::bigint AS held
       FROM credit_holds WHERE user_id = $1 AND state = 'held'`,
    [userId],
  );
  return BigInt(r.rows[0].held);
}

/** Mirror the new authoritative balance down to legacy users.credits (whole). */
async function mirrorLegacy(client, userId, balanceMicro) {
  const whole = balanceMicro / BigInt(MICRO_PER_CREDIT); // floor for BigInt division
  await client.query('UPDATE users SET credits = $1 WHERE id = $2', [whole.toString(), userId]);
}

/** Posted / pending / available balance (micro). */
export async function getBalanceV2(pool, userId) {
  const client = await pool.connect();
  try {
    const acct = await client.query('SELECT balance FROM credit_accounts WHERE user_id = $1', [userId]);
    if (acct.rows.length === 0) {
      // No wallet yet → derive from legacy so reads work before first spend.
      const legacy = await client.query('SELECT credits FROM users WHERE id = $1', [userId]);
      const micro = BigInt(Math.max(0, legacy.rows[0]?.credits ?? 0)) * BigInt(MICRO_PER_CREDIT);
      return balanceView(micro, 0n);
    }
    const posted = BigInt(acct.rows[0].balance);
    const held = await activeHoldsMicro(client, userId);
    return balanceView(posted, held);
  } finally {
    client.release();
  }
}

function balanceView(postedMicro, heldMicro) {
  const available = postedMicro - heldMicro;
  return {
    postedMicro: Number(postedMicro),
    pendingMicro: Number(postedMicro), // posted incl. holds reservation view
    availableMicro: Number(available < 0n ? 0n : available),
    currency: 'credits',
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
  try {
    await client.query('BEGIN');

    // Idempotency: replayed event → no-op.
    const dupe = await client.query(
      'SELECT 1 FROM credit_transactions WHERE user_id = $1 AND reference_type = $2 AND reference_id = $3',
      [userId, REF_TYPE, event.transactionId],
    );
    if (dupe.rows.length > 0) {
      await client.query('COMMIT');
      const bal = await getBalanceV2(pool, userId);
      return { accepted: true, duplicate: true, costMicro: Number(costMicro), transactionId: event.transactionId, balance: bal };
    }

    const acct = await ensureAccount(client, userId);
    if (acct.is_frozen) {
      await client.query('ROLLBACK');
      const err = new Error('account frozen');
      err.code = 'ACCOUNT_FROZEN';
      throw err;
    }
    const balance = BigInt(acct.balance);
    const held = await activeHoldsMicro(client, userId);
    if (balance - held < costMicro) {
      await client.query('ROLLBACK');
      const err = new Error('insufficient credits');
      err.code = 'INSUFFICIENT_CREDITS';
      throw err;
    }

    const newBalance = balance - costMicro;
    await client.query(
      'UPDATE credit_accounts SET balance = $1, lifetime_spent = lifetime_spent + $2, updated_at = now() WHERE id = $3',
      [newBalance.toString(), costMicro.toString(), acct.id],
    );
    await client.query(
      `INSERT INTO credit_transactions
         (user_id, account_id, type, amount, balance_after, reference_type, reference_id, description, metadata)
       VALUES ($1, $2, 'debit', $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        userId, acct.id, (-costMicro).toString(), newBalance.toString(), REF_TYPE, event.transactionId,
        `${event.surface}:${event.operation}`,
        JSON.stringify({ surface: event.surface, operation: event.operation, model: event.model ?? null, ...event.dimensions }),
      ],
    );
    await insertUsageLog(client, userId, event, costMicro);
    await mirrorLegacy(client, userId, newBalance);

    await client.query('COMMIT');
    return {
      accepted: true,
      duplicate: false,
      costMicro: Number(costMicro),
      transactionId: event.transactionId,
      balance: balanceView(newBalance, held),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Reserve credits (phase 1). Idempotent on holdId. Throws INSUFFICIENT_CREDITS. */
export async function holdV2(pool, userId, req) {
  const amountMicro = BigInt(Math.max(1, Math.round(req.amountMicro)));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM credit_holds WHERE user_id = $1 AND hold_id = $2', [userId, req.holdId]);
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return holdView(existing.rows[0], await getBalanceV2(pool, userId));
    }
    const acct = await ensureAccount(client, userId);
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
    return holdView(row.rows[0], balanceView(balance, held + amountMicro));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Settle a hold for the actual cost (phase 2). Posting < held restores the rest. */
export async function settleHoldV2(pool, userId, holdId, actualCostMicro) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const h = await client.query("SELECT * FROM credit_holds WHERE user_id=$1 AND hold_id=$2 FOR UPDATE", [userId, holdId]);
    if (h.rows.length === 0) { await client.query('ROLLBACK'); const e = new Error('hold not found'); e.code='NOT_FOUND'; throw e; }
    const hold = h.rows[0];
    if (hold.state !== 'held') { // idempotent: already settled/voided
      await client.query('COMMIT');
      return holdView(hold, await getBalanceV2(pool, userId));
    }
    const actual = BigInt(Math.min(Math.max(0, Math.round(actualCostMicro)), Number(hold.amount_micro)));
    const acct = await ensureAccount(client, userId);
    const newBalance = BigInt(acct.balance) - actual;
    await client.query('UPDATE credit_accounts SET balance=$1, lifetime_spent=lifetime_spent+$2, updated_at=now() WHERE id=$3',
      [newBalance.toString(), actual.toString(), acct.id]);
    await client.query("UPDATE credit_holds SET state='settled', settled_micro=$1, updated_at=now() WHERE id=$2",
      [actual.toString(), hold.id]);
    await client.query(
      `INSERT INTO credit_transactions (user_id, account_id, type, amount, balance_after, reference_type, reference_id, description, metadata)
       VALUES ($1,$2,'debit',$3,$4,'xeno.hold',$5,$6,$7::jsonb)`,
      [userId, acct.id, (-actual).toString(), newBalance.toString(), holdId, `${hold.surface}:${hold.operation}`,
       JSON.stringify({ surface: hold.surface, operation: hold.operation, holdId })]);
    await insertUsageLog(client, userId, { surface: hold.surface, operation: hold.operation, transactionId: holdId }, actual);
    await mirrorLegacy(client, userId, newBalance);
    await client.query('COMMIT');
    const updated = await client.query('SELECT * FROM credit_holds WHERE id=$1', [hold.id]);
    return holdView(updated.rows[0], await getBalanceV2(pool, userId));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Release a hold without charging. Idempotent. */
export async function voidHoldV2(pool, userId, holdId) {
  const client = await pool.connect();
  try {
    await client.query("UPDATE credit_holds SET state='voided', updated_at=now() WHERE user_id=$1 AND hold_id=$2 AND state='held'",
      [userId, holdId]);
    const row = await client.query('SELECT * FROM credit_holds WHERE user_id=$1 AND hold_id=$2', [userId, holdId]);
    if (row.rows.length === 0) { const e = new Error('hold not found'); e.code='NOT_FOUND'; throw e; }
    return holdView(row.rows[0], await getBalanceV2(pool, userId));
  } finally {
    client.release();
  }
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
