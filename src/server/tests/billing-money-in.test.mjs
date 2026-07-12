/**
 * Money-in atomicity + auditability + refund/dispute test (Blocker #2).
 * Exercises billingService.handleEvent end-to-end against a real ledger:
 *   - one-time credit grant is atomic (claim+grant in one tx) and idempotent
 *   - a grant appends a hash-chained credit_transactions row (auditable money-in)
 *   - a failure mid-grant rolls back the event claim (no money-taken-no-credits)
 *   - refunds claw back proportionally, cumulatively, and idempotently
 *   - disputes claw back fully and freeze the account
 *   - the hash chain stays valid across credit + debit + refund
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:5432/t node tests/billing-money-in.test.mjs
 */
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { handleEvent } from '../services/billingService.js';
import { getBalanceV2, verifyChainV2, recordUsageV2, holdV2, settleHoldV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const C = (n) => n * MICRO_PER_CREDIT;

const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS api_usage_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, surface varchar(64), operation varchar(128), model varchar(128), provider varchar(64), actual_cost_micro bigint, estimated_cost_micro bigint, input_tokens int DEFAULT 0, output_tokens int DEFAULT 0, status varchar(16), request_id varchar(128), endpoint text, method varchar(8), created_at timestamptz DEFAULT now());
`;

const evt = (id, type, object) => ({ id, type, data: { object } });
const paidSession = (uid, credits, pi) => ({
  mode: 'payment', payment_status: 'paid', customer: 'cus_1', client_reference_id: uid, payment_intent: pi,
  metadata: { xenoUserId: uid, credits: String(credits), itemId: 'credits_small', kind: 'credits' },
});
const balance = async (uid) => (await getBalanceV2(pool, uid)).availableMicro;
const frozen = async (uid) => (await pool.query('SELECT is_frozen FROM credit_accounts WHERE user_id=$1', [uid])).rows[0]?.is_frozen;
const txCount = async (uid, type) => Number((await pool.query('SELECT COUNT(*)::int c FROM credit_transactions WHERE user_id=$1 AND type=$2', [uid, type])).rows[0].c);
const eventCount = async (id) => Number((await pool.query('SELECT COUNT(*)::int c FROM billing_events WHERE event_id=$1', [id])).rows[0].c);
const newUser = async () => (await pool.query('INSERT INTO users (credits) VALUES (0) RETURNING id')).rows[0].id;

async function main() {
  await pool.query(BASE);
  await migrateAccountV2(pool);

  // ── 1. Grant is atomic + auditable + idempotent ────────────────────────────
  const u1 = await newUser();
  await handleEvent(pool, evt('evt_grant_1', 'checkout.session.completed', paidSession(u1, 1000, 'pi_1')));
  ok(await balance(u1) === C(1000), 'grant: balance = 1000 credits');
  ok(await txCount(u1, 'credit') === 1, 'grant: appended ONE credit_transactions journal row (auditable money-in)');
  ok(await eventCount('evt_grant_1') === 1, 'grant: billing_events claim recorded');
  const charge = (await pool.query('SELECT credits_micro, refunded_micro FROM billing_charges WHERE payment_intent=$1', ['pi_1'])).rows[0];
  ok(charge && Number(charge.credits_micro) === C(1000), 'grant: billing_charges mapped pi → 1000 credits');

  // replay the SAME event → no double credit, no second journal row
  await handleEvent(pool, evt('evt_grant_1', 'checkout.session.completed', paidSession(u1, 1000, 'pi_1')));
  ok(await balance(u1) === C(1000), 'replay: balance still 1000 (idempotent)');
  ok(await txCount(u1, 'credit') === 1, 'replay: still ONE credit journal row');

  // ── 2. Atomicity: a grant that fails mid-tx rolls back the event claim ──────
  // Pre-insert a conflicting ledger ref so addGrantTx's insertLedgerEntry hits
  // uq_credit_txn_ref and throws AFTER claimEventTx has inserted billing_events.
  const acctId = (await pool.query('SELECT id FROM credit_accounts WHERE user_id=$1', [u1])).rows[0].id;
  await pool.query(
    `INSERT INTO credit_transactions (user_id, account_id, type, amount, balance_after, reference_type, reference_id)
     VALUES ($1,$2,'credit',0,0,'xeno.grant','stripe:evt_atomic')`,
    [u1, acctId],
  );
  const balBefore = await balance(u1);
  let threw = false;
  try {
    await handleEvent(pool, evt('evt_atomic', 'checkout.session.completed', paidSession(u1, 500, 'pi_atomic')));
  } catch { threw = true; }
  ok(threw, 'atomicity: grant collision throws (surfaces as 500 → Stripe retries)');
  ok(await eventCount('evt_atomic') === 0, 'atomicity: event claim ROLLED BACK (not marked processed) — money-taken-no-credits impossible');
  ok(await balance(u1) === balBefore, 'atomicity: balance unchanged after the failed grant');

  // ── 3. Refund clawback: proportional, cumulative, idempotent ───────────────
  const u2 = await newUser();
  await handleEvent(pool, evt('evt_grant_2', 'checkout.session.completed', paidSession(u2, 1000, 'pi_2')));
  ok(await balance(u2) === C(1000), 'refund-setup: u2 granted 1000');

  // partial refund: 400 of 1000 cents refunded → claw 40% = 400 credits
  await handleEvent(pool, evt('evt_ref_a', 'charge.refunded', { payment_intent: 'pi_2', amount: 1000, amount_refunded: 400 }));
  ok(await balance(u2) === C(600), 'refund: partial 40% clawed → balance 600');
  ok(await txCount(u2, 'refund') === 1, 'refund: appended a reversing journal row');

  // replay the SAME refund event → no double clawback
  await handleEvent(pool, evt('evt_ref_a', 'charge.refunded', { payment_intent: 'pi_2', amount: 1000, amount_refunded: 400 }));
  ok(await balance(u2) === C(600), 'refund: replay is idempotent (still 600)');

  // second refund event, now cumulative full (1000/1000) → claw the remaining 600
  await handleEvent(pool, evt('evt_ref_b', 'charge.refunded', { payment_intent: 'pi_2', amount: 1000, amount_refunded: 1000 }));
  ok(await balance(u2) === 0, 'refund: cumulative full refund → balance 0');
  const chg2 = (await pool.query('SELECT refunded_micro FROM billing_charges WHERE payment_intent=$1', ['pi_2'])).rows[0];
  ok(Number(chg2.refunded_micro) === C(1000), 'refund: refunded_micro tracked cumulative = 1000');

  // ── 4. Refund shortfall: already-spent credits can't be over-clawed ────────
  const u3 = await newUser();
  await handleEvent(pool, evt('evt_grant_3', 'checkout.session.completed', paidSession(u3, 1000, 'pi_3')));
  await recordUsageV2(pool, u3, { transactionId: 'spend1', surface: 's', operation: 'o', costMicro: C(700) });
  ok(await balance(u3) === C(300), 'shortfall-setup: spent 700, balance 300');
  await handleEvent(pool, evt('evt_ref_c', 'charge.refunded', { payment_intent: 'pi_3', amount: 1000, amount_refunded: 1000 }));
  ok(await balance(u3) === 0, 'shortfall: full refund claws only the remaining 300 (clamped at 0, not negative)');

  // ── 5. Dispute: full clawback + account frozen ─────────────────────────────
  const u4 = await newUser();
  await handleEvent(pool, evt('evt_grant_4', 'checkout.session.completed', paidSession(u4, 1000, 'pi_4')));
  await handleEvent(pool, evt('evt_disp', 'charge.dispute.funds_withdrawn', { payment_intent: 'pi_4', amount: 1000 }));
  ok(await balance(u4) === 0, 'dispute: full grant clawed back → balance 0');
  ok(await frozen(u4) === true, 'dispute: account frozen (spend blocked)');

  // ── 6. Hash chain stays valid across credit + debit + refund ───────────────
  const chain = await verifyChainV2(pool, u2);
  ok(chain.ok, `chain: verifyChainV2 ok across grant+refunds (entries=${chain.entries})`);
  const chain3 = await verifyChainV2(pool, u3);
  ok(chain3.ok, `chain: verifyChainV2 ok across grant+debit+refund (entries=${chain3.entries})`);

  // ── 7. Dispute OPENED (created) → freeze without throwing (uuid=text regression) ──
  const u5 = await newUser();
  await handleEvent(pool, evt('evt_grant_5', 'checkout.session.completed', paidSession(u5, 1000, 'pi_5')));
  await handleEvent(pool, evt('evt_disp_open', 'charge.dispute.created', { payment_intent: 'pi_5', charge: 'ch_5' }));
  ok(await frozen(u5) === true, 'dispute.created: account frozen (no uuid=text plan error)');

  // ── 8. Clawback with an in-flight hold never drives the balance negative ────
  const u6 = await newUser();
  await handleEvent(pool, evt('evt_grant_6', 'checkout.session.completed', paidSession(u6, 1000, 'pi_6')));
  await holdV2(pool, u6, { holdId: 'h1', amountMicro: C(800), surface: 's', operation: 'o' });
  await handleEvent(pool, evt('evt_ref_hold', 'charge.refunded', { payment_intent: 'pi_6', amount: 1000, amount_refunded: 1000 }));
  ok(await balance(u6) === 0, 'hold+refund: posted balance clawed to 0');
  await settleHoldV2(pool, u6, 'h1', C(800)); // settle the pre-existing hold AFTER the clawback
  const rawBal = Number((await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1', [u6])).rows[0].balance);
  const legacyBal = Number((await pool.query('SELECT credits FROM users WHERE id=$1', [u6])).rows[0].credits);
  ok(rawBal >= 0 && legacyBal >= 0, `hold-settle after clawback: balance stays >= 0 (raw=${rawBal}, legacy=${legacyBal})`);

  // ── 9. $0 / 100%-off promo pack (no_payment_required) still grants ─────────
  const u7 = await newUser();
  const compSession = { ...paidSession(u7, 500, null), payment_status: 'no_payment_required', payment_intent: null };
  await handleEvent(pool, evt('evt_comp', 'checkout.session.completed', compSession));
  ok(await balance(u7) === C(500), 'promo: 100%-off pack grants credits (payment_status=no_payment_required)');

  console.log(`\n${fail === 0 ? '✅' : '❌'} billing-money-in: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
