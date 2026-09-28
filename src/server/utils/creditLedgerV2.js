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
import { dimensionsJson } from './usageDimensions.js';
import { pricePinnedChatUsage } from './creditCosts.js';
import { allocateFunding, allocateContributionFunding, quarantinedGrantIds, saveHoldFunding, consumeFunding, readHoldFunding } from './usageCreditFunding.js';

export const MICRO_PER_CREDIT = 1_000_000;
const REF_TYPE = 'xeno.usage';

/** Ordinary ledger operations may address only ordinary wallets. A pool UUID is not a spend grant.
 * Reading the row as JSON preserves compatibility with legacy schemas predating owner_kind.
 * There is deliberately no caller-supplied flag that bypasses this boundary. */
async function requireOrdinaryWallet(client, userId) {
  const { rows } = await client.query("SELECT to_jsonb(a)->>'owner_kind' AS owner_kind FROM credit_accounts a WHERE user_id=$1", [userId]);
  const kind = rows[0]?.owner_kind;
  if (kind != null && !['user', 'workspace'].includes(kind)) {
    throw Object.assign(new Error('Restricted ledger account requires its allocation authority'), { code: 'RESTRICTED_ACCOUNT' });
  }
}

/** Ensure the user has a credit_accounts wallet; backfill from legacy on first touch. */
async function ensureAccount(client, userId) {
  const found = await client.query(
    'SELECT id, balance, is_frozen FROM credit_accounts WHERE user_id = $1 FOR UPDATE',
    [userId],
  );
  if (found.rows.length > 0) {
    await requireOrdinaryWallet(client, userId);
    return found.rows[0];
  }

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
  await requireOrdinaryWallet(client, userId);
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
  const quarantined = new Set(await quarantinedGrantIds(client, userId));
  const lots = await client.query(
    `SELECT id, remaining_micro, kind FROM credit_grants
      WHERE user_id=$1 AND remaining_micro>0 AND (expires_at IS NULL OR expires_at>now())
      ORDER BY priority ASC, expires_at ASC NULLS LAST, created_at ASC, id ASC
      FOR UPDATE`,
    [userId],
  );
  // SQL defines the complete drawdown order. A second sort by kind overrides
  // priority and expiry, spending paid lots before allowance lots despite priority 5.
  // Grant kind is descriptive; priority, expiry and FIFO determine consumption.
  for (const lot of lots.rows) {
    if (need <= 0n) break;
    if (quarantined.has(lot.id)) continue;
    const take = BigInt(lot.remaining_micro) < need ? BigInt(lot.remaining_micro) : need;
    await client.query('UPDATE credit_grants SET remaining_micro = remaining_micro - $1 WHERE id = $2', [take.toString(), lot.id]);
    need -= take;
  }
  // A quarantined balance is not an available funding source. In particular the
  // legacy overrun path must roll back rather than debit it while reporting drift.
  if (need > 0n && quarantined.size) {
    throw Object.assign(new Error('Available non-quarantined lots do not cover this debit'), { code: 'FUNDING_CONFLICT' });
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
export async function addGrantTx(client, userId, { amountMicro, kind = 'paid', priority, expiresAt = null, sourceRef = null }) {
  const amt = BigInt(Math.max(1, Math.round(amountMicro)));
  const prio = priority ?? (kind === 'free' ? 10 : kind === 'promo' ? 50 : 100);
  const acct = await ensureAccount(client, userId); // SELECT … FOR UPDATE locks the account (race-free hash chain)
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

/** Called while the payment's billing_charges row is locked. Once value has moved
 * into a contribution, generic clawback must not substitute unrelated wallet lots.
 * Quarantine keeps the origin unspendable and records the unreconciled liability;
 * it never cancels an existing provider commitment or claims a loss was funded. */
export async function quarantineContributedOriginTx(client, { paymentIntent, eventId, reason, liabilityMicro }) {
  const present=(await client.query("SELECT to_regclass('workforce_funding_origin_quarantine') AS relation")).rows[0]?.relation;
  if(!present) return false; // installations/tests before the additive funding migration
  const origin=(await client.query(`SELECT o.grant_id FROM credit_grant_payment_origins o
    WHERE o.payment_intent=$1 AND EXISTS (SELECT 1 FROM workforce_contribution_lots l WHERE l.origin_grant_id=o.grant_id)`,[paymentIntent])).rows[0];
  if(!origin) return false;
  // Serialize quarantine with every ordinary debit and pool transfer. The payment
  // row is already locked by the caller; take affected accounts in the same order
  // as contribution allocation before changing eligibility.
  await client.query(`SELECT a.id FROM credit_accounts a WHERE a.id IN (
    SELECT g.account_id FROM credit_grants g WHERE g.id=$1
    UNION SELECT p.account_id FROM workforce_contribution_lots l
      JOIN workforce_funding_contributions c ON c.id=l.contribution_id
      JOIN workforce_funding_pools p ON p.campaign_id=c.campaign_id AND p.milestone_id=c.milestone_id
      WHERE l.origin_grant_id=$1
    ) ORDER BY a.user_id FOR UPDATE OF a`,[origin.grant_id]);
  await client.query(`INSERT INTO workforce_funding_origin_quarantine(event_id,payment_intent,grant_id,reason,liability_micro)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id) DO NOTHING`,[eventId,paymentIntent,origin.grant_id,reason,String(liabilityMicro)]);
  return true;
}

/** Move a pending, consent-bound contribution into its restricted ledger account.
 * The caller owns BEGIN/COMMIT and must insert the pending contribution on that same
 * client. No generic account-kind bypass is exposed: endpoints, amount and provenance
 * are derived from the durable contribution and pool rows, not caller-supplied balances.
 * The service commits the confirmation and this movement together or rolls both back. */
export async function fundContributionTx(client, contributionId) {
  const c = (await client.query(`SELECT c.*,p.id AS pool_id,p.account_id AS pool_account_id
    FROM workforce_funding_contributions c JOIN workforce_funding_pools p
      ON p.campaign_id=c.campaign_id AND p.milestone_id=c.milestone_id
    WHERE c.id=$1 FOR UPDATE OF c`, [contributionId])).rows[0];
  if (!c || c.state !== 'pending') throw Object.assign(new Error('Pending contribution required'), { code: 'CONTRIBUTION_NOT_PENDING' });
  if ((await client.query('SELECT 1 FROM workforce_contribution_lots WHERE contribution_id=$1', [c.id])).rowCount) {
    throw Object.assign(new Error('Contribution already funded'), { code: 'CONTRIBUTION_ALREADY_FUNDED' });
  }
  const selected = await allocateContributionFunding(client, c.contributor_user_id, String(c.amount_micro), { destinationOwnerId: c.pool_id });
  const dest = (await client.query('SELECT id,balance FROM credit_accounts WHERE user_id=$1', [c.pool_id])).rows[0];
  if (dest.id !== c.pool_account_id) throw Object.assign(new Error('Pool account mismatch'), { code: 'CONTRIBUTION_DESTINATION_UNAVAILABLE' });
  for (const lot of selected.allocations) {
    const moved = (await client.query(`WITH source AS (
      UPDATE credit_grants SET remaining_micro=remaining_micro-$2
      WHERE id=$1 AND user_id=$3 AND account_id=$4 AND remaining_micro >= $2
      RETURNING priority,expires_at
    ) INSERT INTO credit_grants(user_id,account_id,amount_micro,remaining_micro,kind,priority,source_ref,expires_at)
      SELECT $5,$6,$2,$2,'contribution',priority,$7,expires_at FROM source RETURNING id`,
    [lot.grantId,lot.amountMicro,c.contributor_user_id,selected.accountId,c.pool_id,dest.id,`contribution:${c.id}:${lot.grantId}`])).rows[0];
    if (!moved) throw Object.assign(new Error('Contribution lot moved concurrently'), { code: 'FUNDING_CONFLICT' });
    await client.query(`INSERT INTO workforce_contribution_lots
      (contribution_id,origin_grant_id,pool_grant_id,amount_micro,origin_kind,origin_expires_at)
      SELECT $1,$2,$3,$4,'paid',expires_at FROM credit_grants WHERE id=$2`, [c.id,lot.grantId,moved.id,lot.amountMicro]);
  }
  const source = (await client.query('UPDATE credit_accounts SET balance=balance-$1,updated_at=now() WHERE id=$2 RETURNING balance',
    [c.amount_micro,selected.accountId])).rows[0];
  const destination = (await client.query('UPDATE credit_accounts SET balance=balance+$1,updated_at=now() WHERE id=$2 RETURNING balance',
    [c.amount_micro,dest.id])).rows[0];
  const metadata = JSON.stringify({ contributionId:c.id,projectPoolId:c.pool_id,milestoneId:c.milestone_id,termsVersion:c.terms_version });
  await insertLedgerEntry(client, { userId:c.contributor_user_id,accountId:selected.accountId,type:'transfer',
    amount:String(-BigInt(c.amount_micro)),balanceAfter:String(source.balance),refType:'xeno.contribution',refId:c.id,
    description:'project contribution out',metadata });
  await insertLedgerEntry(client, { userId:c.pool_id,accountId:dest.id,type:'transfer',amount:String(c.amount_micro),
    balanceAfter:String(destination.balance),refType:'xeno.contribution',refId:c.id,description:'project contribution in',metadata });
  await mirrorLegacy(client, c.contributor_user_id, BigInt(source.balance));
  return { poolId:c.pool_id,amountMicro:String(c.amount_micro),lotCount:selected.allocations.length };
}

/** Return only the contribution's unspent, unreserved lots to their original grant rows.
 * No replacement 'paid' grant is minted: original expiry/priority/origin survive byte-for-byte.
 * Unknown commitments block return; the clock alone cannot prove provider settlement. */
export async function returnContributionTx(client, contributionId, actorUserId) {
  const c=(await client.query(`SELECT c.*,p.id AS pool_id,p.account_id AS pool_account_id
    FROM workforce_funding_contributions c JOIN workforce_funding_pools p
      ON p.campaign_id=c.campaign_id AND p.milestone_id=c.milestone_id
    WHERE c.id=$1 AND c.contributor_user_id=$2 FOR UPDATE OF c`,[contributionId,actorUserId])).rows[0];
  if(!c) throw Object.assign(new Error('Contribution not found'),{code:'CONTRIBUTION_NOT_FOUND'});
  const prior=(await client.query('SELECT * FROM workforce_funding_returns WHERE contribution_id=$1',[c.id])).rows[0];
  if(prior) return {amountMicro:String(prior.amount_micro),expiredMicro:String(prior.expired_micro),replayed:true};
  if(c.state!=='confirmed') throw Object.assign(new Error('Contribution cannot be returned'),{code:'CONTRIBUTION_NOT_RETURNABLE'});
  const charges=(await client.query(`SELECT b.payment_intent,b.refunded_micro FROM billing_charges b
    JOIN credit_grant_payment_origins o ON o.payment_intent=b.payment_intent
    JOIN workforce_contribution_lots l ON l.origin_grant_id=o.grant_id
    WHERE l.contribution_id=$1 ORDER BY b.payment_intent FOR UPDATE OF b`,[c.id])).rows;
  const quarantined=(await client.query(`SELECT 1 FROM workforce_funding_origin_quarantine q
    JOIN workforce_contribution_lots l ON l.origin_grant_id=q.grant_id WHERE l.contribution_id=$1`,[c.id])).rowCount;
  if(quarantined || !charges.length || charges.some(b=>BigInt(b.refunded_micro)>0n)) throw Object.assign(new Error('Contribution origin requires reconciliation'),{code:'CONTRIBUTION_ORIGIN_QUARANTINED'});
  const accounts=(await client.query('SELECT id,user_id,balance,is_frozen,owner_kind FROM credit_accounts WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR UPDATE',
    [[c.pool_id,c.contributor_user_id].sort()])).rows;
  const source=accounts.find(a=>a.user_id===c.pool_id),destination=accounts.find(a=>a.user_id===c.contributor_user_id);
  if(!source || !destination || source.owner_kind!=='project_pool' || destination.owner_kind!=='user'
    || source.is_frozen || destination.is_frozen) throw Object.assign(new Error('Return account unavailable'),{code:'CONTRIBUTION_ACCOUNT_UNAVAILABLE'});
  if((await client.query("SELECT 1 FROM credit_holds WHERE user_id=$1 AND state='held'",[c.pool_id])).rowCount) {
    throw Object.assign(new Error('Pool commitments must settle before return'),{code:'CONTRIBUTION_RESERVED'});
  }
  const lots=(await client.query(`SELECT l.*,g.remaining_micro,(g.expires_at<=now()) AS expired
    FROM workforce_contribution_lots l JOIN credit_grants g ON g.id=l.pool_grant_id
    WHERE l.contribution_id=$1 ORDER BY g.id FOR UPDATE OF g`,[c.id])).rows;
  let total=0n,expired=0n;
  for(const lot of lots){const n=BigInt(lot.remaining_micro);total+=n;if(lot.expired)expired+=n;}
  if(total>BigInt(c.amount_micro)||BigInt(source.balance)<total) throw Object.assign(new Error('Contribution accounting mismatch'),{code:'FUNDING_CONFLICT'});
  await client.query('INSERT INTO workforce_funding_returns(contribution_id,returned_by_user_id,amount_micro,expired_micro) VALUES($1,$2,$3,$4)',
    [c.id,actorUserId,String(total),String(expired)]);
  for(const lot of lots){
    if(BigInt(lot.remaining_micro)===0n)continue;
    const restored=await client.query(`UPDATE credit_grants SET remaining_micro=remaining_micro+$1
      WHERE id=$2 AND user_id=$3 AND remaining_micro+$1<=amount_micro RETURNING id`,[lot.remaining_micro,lot.origin_grant_id,c.contributor_user_id]);
    if(restored.rowCount!==1) throw Object.assign(new Error('Original contribution lot unavailable'),{code:'FUNDING_CONFLICT'});
    await client.query('UPDATE credit_grants SET remaining_micro=0 WHERE id=$1',[lot.pool_grant_id]);
    await client.query('INSERT INTO workforce_funding_return_lots(contribution_id,pool_grant_id,origin_grant_id,amount_micro) VALUES($1,$2,$3,$4)',
      [c.id,lot.pool_grant_id,lot.origin_grant_id,lot.remaining_micro]);
  }
  // Expired value is retained as lineage, never revived into the spendable balance.
  // Otherwise syncGrants could backfill an expired-only wallet into a fresh paid lot.
  const spendable=total-expired;
  const sourceAfter=BigInt(source.balance)-total,destAfter=BigInt(destination.balance)+spendable;
  await client.query('UPDATE credit_accounts SET balance=$1,updated_at=now() WHERE id=$2',[String(sourceAfter),source.id]);
  await client.query('UPDATE credit_accounts SET balance=$1,updated_at=now() WHERE id=$2',[String(destAfter),destination.id]);
  const metadata=JSON.stringify({contributionId:c.id,reversesReferenceType:'xeno.contribution',expiredMicro:String(expired)});
  await insertLedgerEntry(client,{userId:c.pool_id,accountId:source.id,type:'transfer',amount:String(-total),balanceAfter:String(sourceAfter),
    refType:'xeno.contribution.return',refId:c.id,description:'project contribution return out',metadata});
  await insertLedgerEntry(client,{userId:c.contributor_user_id,accountId:destination.id,type:'transfer',amount:String(spendable),balanceAfter:String(destAfter),
    refType:'xeno.contribution.return',refId:c.id,description:'project contribution return in',metadata});
  await mirrorLegacy(client,c.contributor_user_id,destAfter);
  await client.query("UPDATE workforce_funding_contributions SET state='return_pending',updated_at=now() WHERE id=$1",[c.id]);
  await client.query("UPDATE workforce_funding_contributions SET state='returned',updated_at=now() WHERE id=$1",[c.id]);
  return {amountMicro:String(total),expiredMicro:String(expired),replayed:false};
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
export async function clawbackTx(client, userId, micro, { refType = 'xeno.refund', refId = null, description = 'clawback', metadata = null } = {}) {
  const want = BigInt(Math.max(0, Math.round(micro)));
  const acct = await ensureAccount(client, userId);
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
export async function reverseUsageTx(client, userId, micro, { refId = null, description = 'refund' } = {}) {
  const amt = BigInt(Math.max(1, Math.round(micro)));
  const acct = await ensureAccount(client, userId);
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
  await requireOrdinaryWallet(pool, userId);
  await pool.query('UPDATE credit_accounts SET is_frozen=$1, updated_at=now() WHERE user_id=$2', [Boolean(frozen), userId]);
}

// ── Spend caps (Arch §4.6) ──────────────────────────────────────────────────

export async function setSpendCap(pool, userId, { windowSec, limitMicro }) {
  await requireOrdinaryWallet(pool, userId);
  await pool.query(
    `INSERT INTO spend_caps (user_id, window_sec, limit_micro) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, window_sec) DO UPDATE SET limit_micro=EXCLUDED.limit_micro`,
    [userId, windowSec, BigInt(Math.max(0, Math.round(limitMicro))).toString()],
  );
  return { ok: true };
}

/**
 * Throw SPEND_CAP_EXCEEDED if committing costMicro now would breach any window cap.
 *
 * "Spent" is settled debits in the window PLUS everything currently reserved by a
 * live hold. Counting only settled debits was a real hole: a hold reserves money for
 * up to its expiry (default 15 min) and is invisible to a debit sum until it settles,
 * so N concurrent holds could each pass a cap they jointly blew through. Money that
 * is reserved is money that is going to be spent.
 *
 * The settle transition is clean — settleHoldV2 flips state 'held'→'settled' and
 * inserts the debit row in ONE transaction, so an amount is counted by the hold term
 * or the debit term, never both and never neither.
 *
 * Callers must invoke this BEFORE inserting their own hold row, so the amount under
 * test is not also present in the reserved term.
 */
async function assertWithinCaps(client, userId, costMicro) {
  const caps = await client.query('SELECT window_sec, limit_micro FROM spend_caps WHERE user_id=$1', [userId]);
  if (caps.rows.length === 0) return; // no cap configured → nothing to enforce
  const heldMicro = await activeHoldsMicro(client, userId);
  for (const cap of caps.rows) {
    const spent = await client.query(
      `SELECT COALESCE(SUM(-amount),0)::bigint s FROM credit_transactions
        WHERE user_id=$1 AND type='debit' AND created_at > now() - ($2 || ' seconds')::interval`,
      [userId, cap.window_sec],
    );
    if (BigInt(spent.rows[0].s) + heldMicro + costMicro > BigInt(cap.limit_micro)) {
      const e = new Error(`spend cap exceeded (${cap.window_sec}s window)`);
      e.code = 'SPEND_CAP_EXCEEDED';
      throw e;
    }
  }
}

/**
 * The whole-credit value to mirror into legacy `users.credits`, SATURATED to int4.
 *
 * 🔴 `users.credits` is a Postgres `integer`. The ledger is bigint end to end and is
 * the authority; this column is only a derived mirror for legacy readers. Writing a
 * balance above 2,147,483,647 credits into it threw 22003 INSIDE the money
 * transaction, so the grant or spend itself failed. Reproduced 2026-09-13 on the live
 * image: a 2,000,000,000-credit promo grant to an account holding 999,999,999 died
 * with `value "2999999999" is out of range for type integer`.
 *
 * Why saturate rather than widen the column: node-postgres returns `integer` as a
 * Number and `bigint` as a STRING, so a wider type would silently turn
 * `row.credits + n` into string concatenation in every reader — here and in the API
 * gateway, which reads this column directly. Widening is a coordinated migration.
 * A saturated mirror only ever understates a balance legacy readers should not be
 * trusting anyway; a thrown mirror refused the money.
 */
export const LEGACY_CREDITS_MAX = 2147483647n;
export const LEGACY_CREDITS_MIN = -2147483648n;
export function legacyMirrorCredits(balanceMicro) {
  const whole = BigInt(balanceMicro) / BigInt(MICRO_PER_CREDIT); // truncating BigInt division, as before
  if (whole > LEGACY_CREDITS_MAX) return LEGACY_CREDITS_MAX;
  if (whole < LEGACY_CREDITS_MIN) return LEGACY_CREDITS_MIN;
  return whole;
}

/** Mirror the new authoritative balance down to legacy users.credits (whole, saturated). */
async function mirrorLegacy(client, userId, balanceMicro) {
  const whole = legacyMirrorCredits(balanceMicro);
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
    // now() is the transaction START, not its serialization order. A transaction
    // that began first can acquire the account lock last; repeated writes in one
    // transaction also share now(). Keep the existing journal order strictly advancing
    // under that account lock, including a backwards wall-clock adjustment.
    `INSERT INTO credit_transactions
       (user_id, account_id, type, amount, balance_after, reference_type, reference_id, description, metadata, prev_hash, entry_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,
       GREATEST(clock_timestamp() AT TIME ZONE 'UTC',
         (SELECT max(created_at)+interval '1 microsecond' FROM credit_transactions WHERE account_id=$2)))`,
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
// 🔴 `api_usage_logs.created_at` is `timestamp WITHOUT time zone` (baseline), filled by
// now() under the DB session's zone — UTC in production. A JS Date bound straight
// against it is read as a wall clock in the CALLER's zone with the offset discarded,
// so a +02:00 client asked for "the last hour" got a window two hours in the future
// and an empty summary. Correct in production only because both processes run UTC.
// Cast the bound to timestamptz first, then to the UTC wall clock the column holds.
// Found 2026-09-17 when the ledger fixtures took the column's real type.
export async function usageSummary(pool, userId, { from, to, groupBy = 'surface' }) {
  const col = { surface: 'surface', operation: 'operation', model: 'model', provider: 'provider' }[groupBy] || 'surface';
  const r = await pool.query(
    `SELECT ${col} AS key, COUNT(*)::int AS events,
            COALESCE(SUM(actual_cost_micro),0)::bigint AS cost_micro,
            COALESCE(SUM(input_tokens),0)::bigint  AS input_tokens,
            COALESCE(SUM(output_tokens),0)::bigint AS output_tokens
       FROM api_usage_logs
      WHERE user_id=$1
        AND created_at >= ($2::timestamptz AT TIME ZONE 'UTC')
        AND created_at <  ($3::timestamptz AT TIME ZONE 'UTC')
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
/**
 * Split the live balance into THIS WINDOW'S ALLOWANCE and everything else.
 *
 * The quota a subscriber sees is the allowance half; purchased credits are the door that
 * opens when it empties (§8b D3), and they must never be counted into the percentage —
 * a user who tops up would otherwise watch their quota bar refill, which is exactly the
 * confusion Lovable's overlapping grants produce.
 *
 * `allowanceMicro` is the lot's ORIGINAL size and `allowanceRemainingMicro` what is left,
 * so the percentage is computed against what was granted rather than against a balance
 * that a top-up changes.
 */
export async function allowanceSnapshot(pool, userId, sourceRef) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(amount_micro)    FILTER (WHERE source_ref = $2), 0)::bigint AS granted,
       COALESCE(SUM(remaining_micro) FILTER (WHERE source_ref = $2), 0)::bigint AS remaining,
       COALESCE(SUM(remaining_micro) FILTER (WHERE source_ref IS DISTINCT FROM $2
                 AND (expires_at IS NULL OR expires_at > now())), 0)::bigint      AS other
     FROM credit_grants
     WHERE user_id = $1 AND remaining_micro >= 0`,
    [userId, sourceRef],
  );
  const r = rows[0] || {};
  return {
    allowanceMicro: Number(r.granted || 0),
    allowanceRemainingMicro: Number(r.remaining || 0),
    purchasedRemainingMicro: Number(r.other || 0),
  };
}

export async function recordUsageV2(pool, userId, event) {
  const costMicro = BigInt(Math.max(0, Math.round(event.costMicro ?? 0)));
  const client = await pool.connect();
  let outcome; // { duplicate:true } | { duplicate:false, newBalance, held }
  try {
    await client.query('BEGIN');
    await requireOrdinaryWallet(client, userId);

    // Idempotency: replayed event → no-op.
    // 🔴 A replay reports what the ORIGINAL debit charged, read from its journal entry -- never
    // the replaying request's costMicro. The earlier version echoed the request, so a retry that
    // arrived with a different amount under the same transactionId was told it had been charged
    // that amount while the ledger held the first one: a receipt that disagreed with the journal.
    const dupe = await client.query(
      'SELECT amount FROM credit_transactions WHERE user_id = $1 AND reference_type = $2 AND reference_id = $3',
      [userId, REF_TYPE, event.transactionId],
    );
    if (dupe.rows.length > 0) {
      await client.query('COMMIT');
      outcome = { duplicate: true, chargedMicro: -BigInt(dupe.rows[0].amount) };
    } else {
      const acct = await ensureAccount(client, userId);
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

      const funding = await allocateFunding(client, userId, costMicro);
      await consumeFunding(client, funding, costMicro);
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
    return { accepted: true, duplicate: true, costMicro: Number(outcome.chargedMicro), transactionId: event.transactionId, balance: bal };
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
    await requireOrdinaryWallet(client, userId);
    const existing = await client.query('SELECT * FROM credit_holds WHERE user_id = $1 AND hold_id = $2 FOR UPDATE', [userId, req.holdId]);
    if (existing.rows.length > 0 && req.reopenVoided === true && existing.rows[0].state === 'voided') {
      const acct = await ensureAccount(client, userId);
      const balance = BigInt(acct.balance);
      const held = await activeHoldsMicro(client, userId);
      if (acct.is_frozen || balance - held < amountMicro) {
        await client.query('ROLLBACK');
        const err = new Error('insufficient credits');
        err.code = acct.is_frozen ? 'ACCOUNT_FROZEN' : 'INSUFFICIENT_CREDITS';
        throw err;
      }
      await assertWithinCaps(client, userId, amountMicro);
      await syncGrants(client, acct, userId);
      const funding = await allocateFunding(client, userId, amountMicro);
      const expiresAt = new Date(Date.now() + (req.expiresInSeconds ?? 900) * 1000);
      const reopened = await client.query(
        `UPDATE credit_holds
         SET state='held', amount_micro=$2, settled_micro=0, expires_at=$3, updated_at=now()
         WHERE id=$1 AND state='voided'
         RETURNING *`,
        [existing.rows[0].id, amountMicro.toString(), expiresAt.toISOString()],
      );
      if (!reopened.rows[0]) throw Object.assign(new Error('voided hold could not be reopened'), { code: 'HOLD_REOPEN_CONFLICT' });
      await saveHoldFunding(client, reopened.rows[0].id, funding);
      await client.query('COMMIT');
      outcome = { row: reopened.rows[0], balance, held, isFrozen: Boolean(acct.is_frozen) };
    } else if (existing.rows.length > 0) {
      await client.query('COMMIT');
      outcome = { existingRow: existing.rows[0] };
    } else {
      const acct = await ensureAccount(client, userId);
      const balance = BigInt(acct.balance);
      const held = await activeHoldsMicro(client, userId);
      if (acct.is_frozen || balance - held < amountMicro) {
        await client.query('ROLLBACK');
        const err = new Error('insufficient credits');
        err.code = acct.is_frozen ? 'ACCOUNT_FROZEN' : 'INSUFFICIENT_CREDITS';
        throw err;
      }
      // Spend-cap invariant (§4.6), enforced at HOLD time — the only point where
      // refusing means anything. Refusing at settle would be theatre: the compute has
      // already run and the provider has already billed us, so the choice there is
      // "charge the customer" or "eat the cost", never "don't spend". Gate the
      // reservation and every settle that follows is in-budget by construction.
      //
      // This ran nowhere before: recordUsageV2 checked caps, holdV2 and settleHoldV2
      // did not — so the hold path, which is how hosted agent runs bill, ignored caps
      // entirely even when one was set.
      await assertWithinCaps(client, userId, amountMicro);
      await syncGrants(client, acct, userId);
      const funding = await allocateFunding(client, userId, amountMicro);
      const expiresAt = new Date(Date.now() + (req.expiresInSeconds ?? 900) * 1000);
      const row = await client.query(
        `INSERT INTO credit_holds (user_id, account_id, hold_id, surface, operation, amount_micro, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [userId, acct.id, req.holdId, req.surface, req.operation, amountMicro.toString(), expiresAt.toISOString()],
      );
      await saveHoldFunding(client, row.rows[0].id, funding);
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
/**
 * @param {object} [usage] what the settle measured — { model, provider, inputTokens,
 *   outputTokens, dimensions }. Before 2026-09-17 the settle's usage row carried
 *   surface + operation only: model NULL, 0 tokens, for every held call. The
 *   caller had the numbers (it priced the settle from them) and they were dropped
 *   one line before the write. Optional, because legacy callers settle by amount.
 */
/** The most a settle may exceed its reservation before it is treated as a defect (×held). */
export const OVERRUN_CEILING = 200n;

export async function settleHoldV2(pool, userId, holdId, actualCostMicro, usage = {}) {
  const client = await pool.connect();
  let finalRow;
  try {
    await client.query('BEGIN');
    await requireOrdinaryWallet(client, userId);
    const h = await client.query("SELECT * FROM credit_holds WHERE user_id=$1 AND hold_id=$2 FOR UPDATE", [userId, holdId]);
    if (h.rows.length === 0) { await client.query('ROLLBACK'); const e = new Error('hold not found'); e.code='NOT_FOUND'; throw e; }
    const hold = h.rows[0];
    if (hold.state !== 'held') { // idempotent: already settled/voided
      await client.query('COMMIT');
      finalRow = hold;
    } else {
      // 🔴 THE HOLD IS AN ADMISSION RESERVATION, NOT A PRICE CAP. Until 2026-09-17 the
      // charge was clamped to the held amount, on the design assumption that the hold
      // was a true worst case (max_tokens as output). It is not: a reasoning model
      // spends reasoning tokens max_tokens does not bound, and the gateway's own
      // system prompt adds ~640 input tokens the caller never sent. Dogfooding measured
      // a call priced at 1.14 credits settling for 0.05 — the hold — a 96% under-bill on
      // every reasoning call. Charge what was actually used, bounded only by what the
      // account holds (below).
      const held = BigInt(hold.amount_micro);
      // An UNMEASURED settle charges the reserved worst case — the hold — never more.
      // (The old sentinel for this, MAX_SAFE_INTEGER, drained a whole account once the
      // clamp below it was removed; the intent is now a flag, not a magic number.)
      let requested = usage.chargeHeld ? held : BigInt(Math.max(0, Math.round(actualCostMicro)));
      // 🔴 A priced actual far beyond the reservation is a DEFECT, not usage. A harness
      // prompt or reasoning can legitimately exceed the estimate by tens of times; nothing
      // legitimate exceeds it by hundreds. Charge the hold, record it, and shout.
      if (requested > held * OVERRUN_CEILING) {
        console.error(`[ledger] SETTLE OVERRUN CEILING: hold ${holdId} held=${held} priced=${requested} (> ${OVERRUN_CEILING}×) — charging the hold; the caller's usage is wrong`);
        usage = { ...usage, dimensions: { ...(usage.dimensions || {}), settle_ceiling_hit: true } };
        requested = held;
      }
      const acct = await ensureAccount(client, userId);
      await syncGrants(client, acct, userId);
      // Never drive the balance negative: a refund/dispute clawback can reduce the posted
      // balance below this hold's reservation while the operation was in flight, and an
      // overrun past the hold may exceed what is left. Charge only what's still there.
      const posted = BigInt(acct.balance);
      const avail = posted < 0n ? 0n : posted;
      const actual = requested < avail ? requested : avail;
      const overrun = actual > held ? actual - held : 0n;
      if (actual > 0n) {
        const reservedPart = actual - overrun;
        const funding = await readHoldFunding(client, hold.id);
        if (funding.length) {
          await consumeFunding(client, funding, reservedPart);
        }
        else {
          // Pre-migration holds were already admitted under the old policy. Finish
          // them without retroactively applying the new default-off consent.
          const leftover = await drawdownGrants(client, userId, reservedPart);
          reportLotDrift('settleHoldV2', { userId, accountId: acct.id, requestedMicro: reservedPart, leftoverMicro: leftover });
        }
        if (overrun > 0n) {
          // The part past the reservation was never allocated to lots; draw it now, in
          // the same priority order a fresh charge would use.
          const leftover = await drawdownGrants(client, userId, overrun);
          reportLotDrift('settleHoldV2:overrun', { userId, accountId: acct.id, requestedMicro: overrun, leftoverMicro: leftover });
        }
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
        metadata: JSON.stringify({ surface: hold.surface, operation: hold.operation, holdId, model: usage.model ?? null, heldMicro: held.toString(), pricedMicro: requested.toString(), overrunMicro: overrun.toString(), ...(usage.dimensions || {}) }),
      });
      await insertUsageLog(client, userId, {
        surface: hold.surface, operation: hold.operation, transactionId: holdId,
        model: usage.model ?? null, provider: usage.provider ?? null,
        inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0,
        dimensions: usage.dimensions,
      }, actual);
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

/**
 * Keep a RUNNING reservation committed: move a held hold's expiry forward. XENO-WORKFORCE-01 FUND-09:
 * "Do not release a reservation merely because a lease/HTTP request expired. Running or uncertain
 * provider work remains committed until its settlement/cancellation is proved ... Existing generic
 * expiring holds require a qualified run-backed extension." This is that extension.
 *
 * Why it is needed, measured 2026-09-23: a run that outlives its hold's TTL has its reservation
 * voided by sweepExpiredHolds on time alone; the credits are then spendable elsewhere, and the run's
 * eventual settle no-ops on the voided hold and reports success -- the run is free and its credits
 * are spent twice. The holder calls this while the work is alive, so the hold never lapses under it.
 *
 * Deliberately narrow:
 *   - it only ever moves expires_at FORWARD, never back, and never past MAX_HOLD_EXTENSION_SECONDS
 *     from now -- an extension is a heartbeat, not a way to make a hold permanent;
 *   - it never changes the amount, the funding lots, the payer or the state;
 *   - it refuses a hold that is no longer 'held' (settled, voided) with HOLD_NOT_ACTIVE, and one whose
 *     expiry has ALREADY passed with HOLD_EXPIRED. An expired hold may have been swept, and its credits
 *     re-spent; reviving it would re-reserve value that is no longer there. The holder must stop, or
 *     settle what it consumed -- settle still charges actual usage against the account.
 * Idempotent in effect: extending twice to the same horizon leaves one expiry.
 */
export const MAX_HOLD_EXTENSION_SECONDS = 3600;
export async function extendHoldV2(pool, userId, holdId, extendBySeconds) {
  await requireOrdinaryWallet(pool, userId);
  const seconds = Math.floor(Number(extendBySeconds));
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_HOLD_EXTENSION_SECONDS) {
    const e = new Error(`extendBySeconds must be an integer from 1 to ${MAX_HOLD_EXTENSION_SECONDS}`);
    e.code = 'BAD_REQUEST'; throw e;
  }
  const r = await pool.query(
    `UPDATE credit_holds
        SET expires_at = GREATEST(expires_at, now() + ($3 || ' seconds')::interval), updated_at = now()
      WHERE user_id = $1 AND hold_id = $2 AND state = 'held' AND expires_at > now()
      RETURNING *`,
    [userId, holdId, String(seconds)],
  );
  if (r.rows[0]) return { ...holdView(r.rows[0], await getBalanceV2(pool, userId)), expiresAt: r.rows[0].expires_at };
  const row = (await pool.query('SELECT state, expires_at FROM credit_holds WHERE user_id=$1 AND hold_id=$2', [userId, holdId])).rows[0];
  if (!row) { const e = new Error('hold not found'); e.code = 'NOT_FOUND'; throw e; }
  const e = new Error(row.state !== 'held' ? `hold is ${row.state}` : 'hold has already expired');
  e.code = row.state !== 'held' ? 'HOLD_NOT_ACTIVE' : 'HOLD_EXPIRED';
  throw e;
}

/** Release a hold without charging. Idempotent. */
export async function voidHoldV2(pool, userId, holdId) {
  await requireOrdinaryWallet(pool, userId);
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
             AND NOT EXISTS (SELECT 1 FROM credit_accounts a WHERE a.user_id=credit_holds.user_id
               AND COALESCE(to_jsonb(a)->>'owner_kind','user') NOT IN ('user','workspace'))
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
  // `dimensions` is the closed routing/attribution vocabulary (utils/usageDimensions.js);
  // the ledger entry's metadata carries the same facts, this is the queryable copy.
  await client.query(
    `INSERT INTO api_usage_logs
       (user_id, surface, operation, model, provider, actual_cost_micro, estimated_cost_micro,
        input_tokens, output_tokens, status, request_id, endpoint, method, dimensions, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,'ok',$9,$10,'POST',$11::jsonb, now())`,
    [
      userId, event.surface, event.operation, event.model ?? null, event.provider ?? null,
      costMicro.toString(), event.inputTokens ?? 0, event.outputTokens ?? 0, event.transactionId,
      `/api/v2/ledger/usage:${event.operation}`, dimensionsJson(event.dimensions),
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

/** Final pooled-run settlement. Only a service-authenticated, aggregate terminal
 * receipt may call this; a user/run result or timeout is never usage evidence.
 * Payer, tariff and hold come from the retained admission. No generic bypass. */
export async function settleProjectRunV2(pool, receipt) {
  const bad=code=>Object.assign(new Error(code),{code});
  const keys=['admissionId','eventId','providerRequestId','provider','model','inputTokens','outputTokens','measured','allWorkTerminal'];
  if(!receipt||Array.isArray(receipt)||Object.keys(receipt).some(k=>!keys.includes(k))
    ||!(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(receipt.admissionId??''))
    ||!(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(receipt.eventId??''))
    ||receipt.measured!==true||receipt.allWorkTerminal!==true)throw bad('BAD_REQUEST');
  for(const [key,max] of [['providerRequestId',200],['provider',50],['model',100]]) {
    const v=receipt[key];if(typeof v!=='string'||!v.trim()||v!==v.trim()||Buffer.byteLength(v)>max||v.includes('\0'))throw bad('BAD_REQUEST');
  }
  const count=v=>{if(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)return String(v);
    if(typeof v==='string'&&/^(0|[1-9][0-9]{0,17})$/.test(v))return v;throw bad('BAD_REQUEST');};
  const inputTokens=count(receipt.inputTokens),outputTokens=count(receipt.outputTokens);
  const input={admissionId:receipt.admissionId.toLowerCase(),eventId:receipt.eventId,providerRequestId:receipt.providerRequestId,
    provider:receipt.provider,model:receipt.model,inputTokens,outputTokens,measured:true,allWorkTerminal:true};
  const hash=crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const view=(r,replayed)=>({admissionId:r.root_admission_id,eventId:r.event_id,state:r.state,
    pricedMicro:String(r.priced_micro),chargedMicro:String(r.charged_micro),liabilityMicro:String(r.liability_micro),priceVersion:r.price_version,replayed});
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout='2s'");
    const a=(await db.query(`SELECT a.*,f.pool_id,f.hold_row_id,b.price_snapshot,b.price_version
      FROM workforce_run_admissions a JOIN workforce_run_funding f ON f.admission_id=a.id
      JOIN workforce_funding_budgets b ON b.id=f.budget_id WHERE a.id=$1 AND a.parent_admission_id IS NULL`,[input.admissionId])).rows[0];
    if(!a||a.payer_kind!=='project_pool')throw bad('NOT_FOUND');
    // Same sequence as release/lease. Revoked authority does not invalidate a
    // real receipt for already-performed work; it only stops new work.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`run-authority:${a.id}`]);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`funding-budget:${a.pool_id}`]);
    const prior=(await db.query('SELECT * FROM workforce_funding_settlements WHERE root_admission_id=$1 OR event_id=$2',[a.id,input.eventId])).rows[0];
    if(prior){if(prior.request_hash!==hash)throw bad('CONFLICT');await db.query('COMMIT');return view(prior,true);}
    if(a.price_snapshot?.model!==input.model)throw bad('CONFLICT');
    const priced=BigInt(pricePinnedChatUsage(a.price_snapshot,{inputTokens,outputTokens}));
    const account=(await db.query('SELECT * FROM credit_accounts WHERE user_id=$1 FOR UPDATE',[a.payer_user_id])).rows[0];
    if(!account||account.owner_kind!=='project_pool')throw bad('RESTRICTED_ACCOUNT');
    const h=(await db.query('SELECT * FROM credit_holds WHERE id=$1 FOR UPDATE',[a.hold_row_id])).rows[0];
    if(!h||h.account_id!==account.id||h.state!=='held')throw bad('HOLD_NOT_ACTIVE');
    const funding=await readHoldFunding(db,h.id),reserved=BigInt(h.amount_micro);
    if(funding.reduce((n,x)=>n+BigInt(x.amountMicro),0n)!==reserved)throw bad('FUNDING_CONFLICT');
    const quarantined=new Set(await quarantinedGrantIds(db,a.payer_user_id));
    const available=funding.filter(f=>!quarantined.has(f.grantId));
    let canCharge=available.reduce((n,x)=>n+BigInt(x.amountMicro),0n);
    if(account.is_frozen)canCharge=0n;
    const balance=BigInt(account.balance);if(canCharge>balance)canCharge=balance>0n?balance:0n;
    const charged=priced<canCharge?priced:canCharge,liability=priced-charged;
    // Never allocate fresh lots to cover an overrun, even if the pool has money.
    if(charged>0n)await consumeFunding(db,available,charged);
    const next=balance-charged;
    await db.query('UPDATE credit_accounts SET balance=$1,lifetime_spent=lifetime_spent+$2,updated_at=clock_timestamp() WHERE id=$3',
      [String(next),String(charged),account.id]);
    await db.query("UPDATE credit_holds SET state='settled',settled_micro=$1,updated_at=clock_timestamp() WHERE id=$2",[String(charged),h.id]);
    await insertLedgerEntry(db,{userId:a.payer_user_id,accountId:account.id,type:'debit',amount:String(-charged),balanceAfter:String(next),
      refType:'xeno.hold',refId:h.hold_id,description:'workforce:run',metadata:JSON.stringify({admissionId:a.id,eventId:input.eventId,
        providerRequestId:input.providerRequestId,priceVersion:a.price_version,pricedMicro:String(priced),liabilityMicro:String(liability)})});
    await insertUsageLog(db,a.payer_user_id,{surface:'workforce',operation:'run',transactionId:a.id,model:input.model,provider:input.provider,
      inputTokens,outputTokens,dimensions:{usage_source:'provider'}},charged);
    const result=(await db.query(`INSERT INTO workforce_funding_settlements(root_admission_id,event_id,provider_request_id,request_hash,
      provider,model,price_version,input_tokens,output_tokens,priced_micro,charged_micro,liability_micro,state,all_work_terminal)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true) RETURNING *`,[a.id,input.eventId,input.providerRequestId,hash,
      input.provider,input.model,a.price_version,inputTokens,outputTokens,String(priced),String(charged),String(liability),liability>0n?'reconciliation_required':'settled'])).rows[0];
    await db.query('COMMIT');return view(result,false);
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

/** Stable deterministic id helper for callers without one (rarely needed). */
export function deterministicTxnId(...parts) {
  return crypto.createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 32);
}
