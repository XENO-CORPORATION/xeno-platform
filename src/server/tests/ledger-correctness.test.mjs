/**
 * Ledger correctness test (Blocker #8): DEF-4 backfill lot drift, DEF-5 reversing
 * refund, and the phantom-hold sweeper (INFRA-7.3).
 *
 *   - DEF-4: granting to a legacy-seeded (users.credits>0, no account) user lots the
 *            seed so Σ(lots) == balance holds (no drift); a later spend draws it fully.
 *   - DEF-5: refundCredits posts a REVERSING entry — restores balance, DECREMENTS
 *            lifetime_spent (not lifetime_earned), adds a neutral paid lot (not promo),
 *            appends a type='refund' journal row, and is idempotent per original txn.
 *   - sweeper: sweepExpiredHolds voids expired 'held' rows, leaves non-expired ones.
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:5432/t node tests/ledger-correctness.test.mjs
 */
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import {
  addGrant, reverseUsage, recordUsageV2, getBalanceV2, verifyChainV2,
  sweepExpiredHolds, MICRO_PER_CREDIT,
} from '../utils/creditLedgerV2.js';
import { refundCredits } from '../utils/creditTransactions.js';

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

const balance = async (uid) => Number((await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1', [uid])).rows[0].balance);
const lots = async (uid) => Number((await pool.query("SELECT COALESCE(SUM(remaining_micro),0)::bigint s FROM credit_grants WHERE user_id=$1", [uid])).rows[0].s);
const counters = async (uid) => { const r = (await pool.query('SELECT lifetime_earned, lifetime_spent FROM credit_accounts WHERE user_id=$1', [uid])).rows[0]; return { earned: Number(r.lifetime_earned), spent: Number(r.lifetime_spent) }; };
const txCount = async (uid, type) => Number((await pool.query('SELECT COUNT(*)::int c FROM credit_transactions WHERE user_id=$1 AND type=$2', [uid, type])).rows[0].c);
const lotKinds = async (uid) => (await pool.query("SELECT kind FROM credit_grants WHERE user_id=$1 ORDER BY created_at", [uid])).rows.map((r) => r.kind);
const legacyUser = async (credits) => (await pool.query('INSERT INTO users (credits) VALUES ($1) RETURNING id', [credits])).rows[0].id;

async function main() {
  await pool.query(BASE);
  await migrateAccountV2(pool);

  // ── DEF-4: legacy-seeded grant does not drift Σ(lots) below balance ─────────
  const u1 = await legacyUser(100);              // legacy: users.credits=100, NO credit_accounts row
  await addGrant(pool, u1, { amountMicro: C(50), kind: 'paid', sourceRef: 'grant-1' });
  ok(await balance(u1) === C(150), 'DEF-4: balance = legacy seed 100 + grant 50 = 150');
  ok(await lots(u1) === C(150), 'DEF-4: Σ(lots) == balance (150) — seed was lotted, no drift');
  // a spend larger than the new grant must draw fully from lots (incl. the seed lot)
  await recordUsageV2(pool, u1, { transactionId: 'spend-1', surface: 's', operation: 'o', costMicro: C(120) });
  ok(await balance(u1) === C(30), 'DEF-4: spent 120 → balance 30');
  ok(await lots(u1) === C(30), 'DEF-4: Σ(lots) still == balance (30) after drawdown');

  // ── DEF-5: refund is a reversing entry, not a promo grant ───────────────────
  const u2 = await legacyUser(0);
  await addGrant(pool, u2, { amountMicro: C(100), kind: 'paid', sourceRef: 'grant-2' });
  await recordUsageV2(pool, u2, { transactionId: 'spend-2', surface: 's', operation: 'o', costMicro: C(40) });
  let c = await counters(u2);
  ok(await balance(u2) === C(60) && c.spent === C(40), 'DEF-5 setup: spent 40 → balance 60, lifetime_spent 40');
  const earnedBefore = c.earned;

  await refundCredits(pool, u2, 40, { transactionId: 'spend-2', operation: 'imggen' });
  c = await counters(u2);
  ok(await balance(u2) === C(100), 'DEF-5: refund restored balance to 100');
  ok(c.spent === 0, 'DEF-5: lifetime_spent DECREMENTED (40 → 0), not left inflated');
  ok(c.earned === earnedBefore, 'DEF-5: lifetime_earned NOT inflated by the refund');
  ok((await lotKinds(u2)).every((k) => k !== 'promo'), 'DEF-5: refund lot is neutral paid (no promo queue-jump)');
  ok(await txCount(u2, 'refund') === 1, 'DEF-5: appended a type=refund reversing journal row');
  ok(await lots(u2) === C(100), 'DEF-5: Σ(lots) == balance (100) after refund');

  // idempotent replay: same original txn ref → no double credit
  await refundCredits(pool, u2, 40, { transactionId: 'spend-2', operation: 'imggen' });
  ok(await balance(u2) === C(100), 'DEF-5: replayed refund is idempotent (balance still 100)');
  ok(await txCount(u2, 'refund') === 1, 'DEF-5: replay added NO second refund journal row');

  // ── Sweeper: void expired held holds, leave non-expired ─────────────────────
  const u3 = await legacyUser(0);
  await addGrant(pool, u3, { amountMicro: C(100), kind: 'paid', sourceRef: 'grant-3' });
  const acctId = (await pool.query('SELECT id FROM credit_accounts WHERE user_id=$1', [u3])).rows[0].id;
  await pool.query(
    `INSERT INTO credit_holds (user_id, account_id, hold_id, surface, operation, amount_micro, expires_at)
     VALUES ($1,$2,'h-expired','s','o',$3, now() - interval '1 hour'),
            ($1,$2,'h-live','s','o',$3, now() + interval '1 hour')`,
    [u3, acctId, C(10).toString()],
  );
  const voided = await sweepExpiredHolds(pool);
  ok(voided >= 1, `sweeper: voided the expired hold (rowCount=${voided})`);
  const st = async (hid) => (await pool.query('SELECT state FROM credit_holds WHERE user_id=$1 AND hold_id=$2', [u3, hid])).rows[0].state;
  ok(await st('h-expired') === 'voided', 'sweeper: expired hold → state voided');
  ok(await st('h-live') === 'held', 'sweeper: non-expired hold left untouched (still held)');

  // ── Chain integrity across grant + spend + refund ───────────────────────────
  ok((await verifyChainV2(pool, u2)).ok, 'chain: verifyChainV2 ok across grant+spend+refund');

  console.log(`\n${fail === 0 ? '✅' : '❌'} ledger-correctness: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
