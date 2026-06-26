/**
 * Self-contained integration test for the ledger hash chain (Arch §5).
 * Creates the minimal live-shaped base tables, then exercises debit + hold/settle
 * and verifies the per-account chain detects tampering.
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55471/t node tests/ledger-chain.test.mjs
 */
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { recordUsageV2, holdV2, settleHoldV2, verifyChainV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance bigint DEFAULT 0,
  lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32),
  amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128),
  description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, surface varchar(64), operation varchar(128),
  model varchar(128), provider varchar(64), actual_cost_micro bigint, estimated_cost_micro bigint,
  input_tokens int DEFAULT 0, output_tokens int DEFAULT 0, status varchar(16), request_id varchar(128),
  endpoint text, method varchar(8), created_at timestamptz DEFAULT now());
`;

async function main() {
  await pool.query(BASE);
  await migrateAccountV2(pool); // adds credit_holds + (guarded) hash columns / index
  const u = await pool.query('INSERT INTO users (credits) VALUES (100) RETURNING id');
  const userId = u.rows[0].id;

  // 1. two debits + a hold/settle → 4 chained entries
  await recordUsageV2(pool, userId, { transactionId: 'txn-1', surface: 'xeno_post', operation: 'ai.caption', costMicro: 5 * MICRO_PER_CREDIT });
  await recordUsageV2(pool, userId, { transactionId: 'txn-2', surface: 'xeno_post', operation: 'ai.image', costMicro: 3 * MICRO_PER_CREDIT });
  const h = await holdV2(pool, userId, { surface: 'xeno_post', holdId: 'hold-1', amountMicro: 4 * MICRO_PER_CREDIT, operation: 'ai.video' });
  ok(h.state === 'held', 'hold created');
  await settleHoldV2(pool, userId, 'hold-1', 2 * MICRO_PER_CREDIT);

  // 2. every journal row carries entry_hash + prev_hash
  const rows = await pool.query('SELECT entry_hash, prev_hash FROM credit_transactions WHERE user_id=$1 AND entry_hash IS NOT NULL', [userId]);
  ok(rows.rows.length === 3 && rows.rows.every(r => r.entry_hash && r.prev_hash), `3 chained entries, all hashed (${rows.rows.length})`);

  // 3. chain verifies intact
  const v1 = await verifyChainV2(pool, userId);
  ok(v1.ok && v1.entries === 3, `chain intact: ok=${v1.ok}, entries=${v1.entries}`);

  // 4a. DB-level append-only (§4.2): a normal UPDATE is blocked by the trigger.
  let blocked = null;
  try { await pool.query("UPDATE credit_transactions SET amount = amount - 1 WHERE user_id=$1 AND reference_id='txn-1'", [userId]); }
  catch (e) { blocked = e.message; }
  ok(/append-only/.test(blocked || ''), 'DB trigger BLOCKS update on credit_transactions (append-only)');

  // 4b. Defense in depth: even if the trigger is bypassed, the hash chain catches it.
  await pool.query("SET session_replication_role = 'replica'");
  await pool.query("UPDATE credit_transactions SET amount = amount - 1000000 WHERE user_id=$1 AND reference_id='txn-1'", [userId]);
  await pool.query("SET session_replication_role = 'origin'");
  const v2 = await verifyChainV2(pool, userId);
  ok(!v2.ok && v2.transactionId === 'txn-1', `tamper (trigger bypassed) DETECTED by hash chain at txn-1`);

  console.log(`\n${fail === 0 ? '✅' : '❌'} ledger-chain: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
