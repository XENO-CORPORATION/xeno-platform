import { installUsageCreditFixture, optInUsageCredits } from './usage-credit-fixture.mjs';
import { tablesDDL } from './fixtures/schema.mjs';
/**
 * Billing subsystem test (Arch §4.5/§4.6/§4.7): drawdown lots, spend caps, usage.
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55474/t node tests/ledger-billing.test.mjs
 */
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { recordUsageV2, addGrant, setSpendCap, usageSummary, getBalanceV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';

// The session runs UTC because production's does (measured 2026-09-23: `SHOW TimeZone` -> UTC on
// xenostudio-postgres). usageSummary's window relies on it -- see the note above that function in
// creditLedgerV2.js -- and on a machine whose Postgres defaults to a local zone this suite failed
// "usage groupBy surface = 5 credits (undefined)" while production was correct. PGTZ does not reach a
// node-postgres connection; the startup option does.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c TimeZone=UTC' });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const C = (n) => n * MICRO_PER_CREDIT;

const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
`;

async function remaining(userId, kind) {
  const r = await pool.query("SELECT remaining_micro FROM credit_grants WHERE user_id=$1 AND kind=$2", [userId, kind]);
  return Number(r.rows[0]?.remaining_micro ?? -1);
}

async function main() {
  await pool.query(BASE);
  // api_usage_logs from the MIGRATIONS (fixtures/schema.mjs): its shape is production's, incl. `dimensions`.
  await pool.query(tablesDDL('api_usage_logs'));
  await migrateAccountV2(pool);
  await installUsageCreditFixture(pool);
  const u = await pool.query('INSERT INTO users (credits) VALUES (0) RETURNING id');
  const userId = u.rows[0].id;
  await optInUsageCredits(pool, userId);

  // grants: free (priority 10) + paid (priority 100) → 8 credits
  await addGrant(pool, userId, { amountMicro: C(3), kind: 'free' });
  await addGrant(pool, userId, { amountMicro: C(5), kind: 'paid' });
  ok((await getBalanceV2(pool, userId)).availableMicro === C(8), 'balance = 8 (3 free + 5 paid)');

  // debit 2 → drains the FREE lot first (§4.7 free-before-paid)
  await recordUsageV2(pool, userId, { transactionId: 'b1', surface: 'xeno_post', operation: 'ai.caption', costMicro: C(2) });
  ok((await remaining(userId, 'free')) === C(1) && (await remaining(userId, 'paid')) === C(5), 'debit 2 drained free→1, paid untouched');

  // debit 2 → free has only 1, so free→0 then paid→4
  await recordUsageV2(pool, userId, { transactionId: 'b2', surface: 'xeno_post', operation: 'ai.image', costMicro: C(2) });
  ok((await remaining(userId, 'free')) === 0 && (await remaining(userId, 'paid')) === C(4), 'debit 2 drained free→0, paid→4 (lot crossover)');
  ok((await getBalanceV2(pool, userId)).availableMicro === C(4), 'balance now 4');

  // spend cap: 5-credit/hour cap; already spent 4 → a 2-credit debit breaches it
  await setSpendCap(pool, userId, { windowSec: 3600, limitMicro: C(5) });
  let capErr = null;
  try { await recordUsageV2(pool, userId, { transactionId: 'b3', surface: 'xeno_post', operation: 'x', costMicro: C(2) }); } catch (e) { capErr = e.code; }
  ok(capErr === 'SPEND_CAP_EXCEEDED', 'spend cap is a settlement INVARIANT (debit over cap rejected)');
  // a 1-credit debit is within cap (4+1=5)
  const r = await recordUsageV2(pool, userId, { transactionId: 'b4', surface: 'xeno_post', operation: 'ok', costMicro: C(1) });
  ok(r.accepted, 'debit within cap accepted');

  // usage aggregation
  const sum = await usageSummary(pool, userId, { from: new Date(Date.now() - 3600e3), to: new Date(Date.now() + 60e3), groupBy: 'surface' });
  ok(sum.rows.length === 1 && sum.rows[0].key === 'xeno_post' && sum.rows[0].costMicro === C(5), `usage groupBy surface = 5 credits (${sum.rows[0]?.costMicro})`);

  console.log(`\n${fail === 0 ? '✅' : '❌'} ledger-billing: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
