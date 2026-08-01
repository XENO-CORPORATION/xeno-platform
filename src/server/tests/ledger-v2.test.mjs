/**
 * Integration test for Credit Ledger v2 against a real Postgres.
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55455/t node tests/ledger-v2.test.mjs
 *
 * Verifies the billing-critical invariants: debit + idempotency, two-phase
 * holds with partial-settle restore, oversell prevention, and the legacy mirror.
 */
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import {
  getBalanceV2,
  recordUsageV2,
  holdV2,
  settleHoldV2,
  voidHoldV2,
  MICRO_PER_CREDIT,
} from '../utils/creditLedgerV2.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; console.log(`  ✓ ${msg}`); }
  else { fail += 1; console.log(`  ✗ ${msg}`); }
}

async function legacyCredits(userId) {
  const r = await pool.query('SELECT credits FROM users WHERE id=$1', [userId]);
  return Number(r.rows[0].credits);
}

// Base ledger tables migrateAccountV2 augments (already present on live; created
// here so the test is runnable against a fresh throwaway DB).
const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, owner_kind varchar(16) NOT NULL DEFAULT 'user', balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS api_usage_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, surface varchar(64), operation varchar(128), model varchar(128), provider varchar(64), actual_cost_micro bigint, estimated_cost_micro bigint, input_tokens int DEFAULT 0, output_tokens int DEFAULT 0, status varchar(16), request_id varchar(128), endpoint text, method varchar(8), created_at timestamptz DEFAULT now());
`;

async function main() {
  await pool.query(BASE);
  await migrateAccountV2(pool);
  console.log('✓ migration applied');

  // Seed a user with 100 legacy credits.
  const u = await pool.query('INSERT INTO users (credits) VALUES (100) RETURNING id');
  const userId = u.rows[0].id;

  // 1. Balance derives from legacy before any wallet exists.
  let bal = await getBalanceV2(pool, userId);
  ok(bal.availableMicro === 100 * MICRO_PER_CREDIT, `derived balance = 100 credits (${bal.availableMicro} µcr)`);

  // 2. Direct usage debit of 5 credits.
  const r1 = await recordUsageV2(pool, userId, {
    transactionId: 'txn-aaaa-0001', surface: 'xeno_post', operation: 'ai.caption',
    model: 'claude-opus-4-8', costMicro: 5 * MICRO_PER_CREDIT,
  });
  ok(r1.duplicate === false && r1.balance.availableMicro === 95 * MICRO_PER_CREDIT, 'debit 5 → 95 available');
  ok((await legacyCredits(userId)) === 95, 'legacy users.credits mirrored → 95');

  // 3. Idempotency: same transactionId does NOT double-charge.
  const r2 = await recordUsageV2(pool, userId, {
    transactionId: 'txn-aaaa-0001', surface: 'xeno_post', operation: 'ai.caption', costMicro: 5 * MICRO_PER_CREDIT,
  });
  ok(r2.duplicate === true && r2.balance.availableMicro === 95 * MICRO_PER_CREDIT, 'replay is duplicate no-op (still 95)');

  // 4. audit + usage rows written with surface.
  const txns = await pool.query("SELECT count(*)::int n FROM credit_transactions WHERE user_id=$1", [userId]);
  const logs = await pool.query("SELECT count(*)::int n, max(surface) s FROM api_usage_logs WHERE user_id=$1", [userId]);
  ok(txns.rows[0].n === 1, 'exactly one credit_transactions row (not two)');
  ok(logs.rows[0].n === 1 && logs.rows[0].s === 'xeno_post', 'usage log tagged surface=xeno_post');

  // 5. Two-phase hold: reserve 10 → available 85.
  const h = await holdV2(pool, userId, { holdId: 'hold-bbbb-0001', amountMicro: 10 * MICRO_PER_CREDIT, surface: 'xeno_post', operation: 'ai.image' });
  ok(h.state === 'held', 'hold created');
  bal = await getBalanceV2(pool, userId);
  ok(bal.availableMicro === 85 * MICRO_PER_CREDIT, 'available reflects hold → 85');

  // 6. Settle for 4 (< 10 held) → restores 6; posted 95-4=91.
  const s = await settleHoldV2(pool, userId, 'hold-bbbb-0001', 4 * MICRO_PER_CREDIT);
  ok(s.state === 'settled' && s.settledMicro === 4 * MICRO_PER_CREDIT, 'settled for 4 (partial)');
  bal = await getBalanceV2(pool, userId);
  ok(bal.postedMicro === 91 * MICRO_PER_CREDIT && bal.availableMicro === 91 * MICRO_PER_CREDIT, 'posted=available=91 (6 restored)');
  ok((await legacyCredits(userId)) === 91, 'legacy mirrored → 91');

  // 7. Oversell prevention.
  let threw = null;
  try {
    await recordUsageV2(pool, userId, { transactionId: 'txn-aaaa-0002', surface: 'xeno_post', operation: 'big', costMicro: 200 * MICRO_PER_CREDIT });
  } catch (e) { threw = e.code; }
  ok(threw === 'INSUFFICIENT_CREDITS', 'oversell rejected (INSUFFICIENT_CREDITS)');
  ok((await getBalanceV2(pool, userId)).availableMicro === 91 * MICRO_PER_CREDIT, 'balance unchanged after rejected spend');

  // 8. Void a hold → no charge.
  await holdV2(pool, userId, { holdId: 'hold-bbbb-0002', amountMicro: 20 * MICRO_PER_CREDIT, surface: 'xeno_post', operation: 'x' });
  ok((await getBalanceV2(pool, userId)).availableMicro === 71 * MICRO_PER_CREDIT, 'second hold reserves → 71');
  const v = await voidHoldV2(pool, userId, 'hold-bbbb-0002');
  ok(v.state === 'voided' && (await getBalanceV2(pool, userId)).availableMicro === 91 * MICRO_PER_CREDIT, 'void restores → 91');

  console.log(`\n${fail === 0 ? '✅' : '❌'} ledger-v2: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
