import { installUsageCreditFixture, optInUsageCredits } from './usage-credit-fixture.mjs';
import { tablesDDL } from './fixtures/schema.mjs';
/**
 * Parity test for the holdV2 / holdV2Tx split (ordinary additive refactor).
 *
 * `holdV2Tx(client, userId, req)` is the canonical holdV2 TRANSACTION BODY, factored out
 * so a caller that already owns a transaction can compose a hold into it atomically
 * instead of opening a second, independent one. `holdV2(pool, userId, req)` is unchanged
 * in its PUBLIC behavior: it still opens its own connection+transaction, now delegating
 * the body to holdV2Tx, then commits/rolls back, releases, and (only afterward, on its
 * own connection) reads the post-release balance exactly as before.
 *
 * This file proves:
 *  1. holdV2Tx issues no BEGIN/COMMIT/ROLLBACK itself — transaction control stays with
 *     whoever owns the client.
 *  2. holdV2 and a caller-owned transaction wrapping holdV2Tx produce the SAME hold row
 *     for the same request (parity).
 *  3. A caller that ROLLS BACK after a successful holdV2Tx call leaves no credit_holds
 *     row and no credit_hold_funding rows — the hold never happened.
 *  4. A caller that COMMITS after holdV2Tx retains the hold (row + funding + reserved
 *     balance), same as the old inline holdV2 body always did.
 *  5. Error codes are unchanged and thrown identically by both call styles:
 *     INSUFFICIENT_CREDITS, ACCOUNT_FROZEN, RESTRICTED_ACCOUNT, SPEND_CAP_EXCEEDED.
 *  6. Idempotent replay (existingRow) still works through holdV2Tx directly.
 *
 * Deliberately NOT covered here (pre-existing behavior, out of scope for this refactor):
 * rounding of req.amountMicro, reopenVoided semantics beyond the happy/refusal paths
 * already pinned in scripts/spend-cap-enforcement.test.mjs, and settle/void (untouched).
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55455/t node src/server/tests/ledger-hold-tx-parity.test.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import {
  addGrant, getBalanceV2, setFrozen, setSpendCap, holdV2, holdV2Tx, MICRO_PER_CREDIT,
} from '../utils/creditLedgerV2.js';

const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const database = connectionString && new URL(connectionString);
assert(database && ['127.0.0.1', 'localhost'].includes(database.hostname)
  && /^\/(?:xeno_qual_[a-f0-9]{32}|xeno_payment_ledger_hold_tx_parity)$/.test(database.pathname),
  'Use a disposable local xeno_qual database or the ledger-hold-tx-parity money-suite database');
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000 });
let pass = 0;
const ok = (c, m) => { assert(c, m); pass++; console.log(`  ✓ ${m}`); };
const C = (n) => n * MICRO_PER_CREDIT;

// owner_kind declared directly (as ledger-audit-fixes.test.mjs does) so RESTRICTED_ACCOUNT
// is reachable without depending on which migration happens to add the column.
const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, owner_kind varchar(16) DEFAULT 'user', balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
`;

const newUser = async (creditsAmount = 0) => {
  const id = (await pool.query('INSERT INTO users (credits) VALUES ($1) RETURNING id', [creditsAmount])).rows[0].id;
  await optInUsageCredits(pool, id);
  return id;
};
const grant = (uid, credits) => addGrant(pool, uid, { amountMicro: C(credits), kind: 'paid', sourceRef: `seed:${uid}:${credits}` });
const holdCount = async (uid, holdId) => Number((await pool.query('SELECT count(*)::int n FROM credit_holds WHERE user_id=$1 AND hold_id=$2', [uid, holdId])).rows[0].n);
const fundingCountFor = async (holdRowId) => Number((await pool.query('SELECT count(*)::int n FROM credit_hold_funding WHERE hold_row_id=$1', [holdRowId])).rows[0].n);
const codeOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.code; } };

// A real client whose BEGIN/COMMIT/ROLLBACK strings are recorded, so we can assert
// holdV2Tx never issues one itself — it must be transaction-control-free.
async function trackedClient() {
  const client = await pool.connect();
  const seen = [];
  return { client: {
    query: (text, params) => { if (typeof text === 'string') seen.push(text.trim()); return client.query(text, params); },
    release: () => client.release(),
  }, seen };
}

async function main() {
  await pool.query(BASE);
  await pool.query(tablesDDL('api_usage_logs'));
  await migrateAccountV2(pool);
  await installUsageCreditFixture(pool);
  console.log('✓ migration applied');

  // ── 1+2: holdV2Tx issues no transaction control, and parity vs the public holdV2 ──
  {
    const uA = await newUser();
    await grant(uA, 100);
    const rPublic = await holdV2(pool, uA, { holdId: 'parity-1', amountMicro: C(10), surface: 's', operation: 'o' });
    ok(rPublic.state === 'held' && rPublic.amountMicro === C(10), 'holdV2 (public): hold created for 10');

    const uB = await newUser();
    await grant(uB, 100);
    const { client, seen } = await trackedClient();
    await client.query('BEGIN');
    const beforeBody = seen.length;
    const outcome = await holdV2Tx(client, uB, { holdId: 'parity-1', amountMicro: C(10), surface: 's', operation: 'o' });
    const bodyQueries = seen.slice(beforeBody);
    await client.query('COMMIT');
    client.release();
    ok(!bodyQueries.some((s) => /^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)),
      'holdV2Tx itself issued no BEGIN/COMMIT/ROLLBACK (caller controls transaction boundaries)');
    ok(outcome.row?.state === 'held' && Number(outcome.row.amount_micro) === C(10) && outcome.row.hold_id === 'parity-1',
      'holdV2Tx (caller-owned tx): produced the SAME row shape/amount as the public holdV2 for an identical request');
    ok(outcome.amountMicro === BigInt(C(10)) && typeof outcome.balance === 'bigint' && typeof outcome.held === 'bigint',
      'holdV2Tx returns the normalized outcome (row + amountMicro + pre-hold balance/held) the public wrapper needs');

    const balA = await getBalanceV2(pool, uA);
    const balB = await getBalanceV2(pool, uB);
    ok(balA.availableMicro === balB.availableMicro && balA.availableMicro === C(90),
      'both paths reserve identically: available 90 for both users after a 10-credit hold');
  }

  // ── 3: caller ROLLBACK after a successful holdV2Tx leaves no hold / no funding ──
  {
    const u = await newUser();
    await grant(u, 100);
    const { client } = await trackedClient();
    await client.query('BEGIN');
    const outcome = await holdV2Tx(client, u, { holdId: 'rollback-1', amountMicro: C(20), surface: 's', operation: 'o' });
    const rowId = outcome.row.id;
    await client.query('ROLLBACK'); // simulates some OTHER step in the caller's composed transaction failing
    client.release();
    ok(await holdCount(u, 'rollback-1') === 0, 'caller ROLLBACK: no credit_holds row survives');
    ok(await fundingCountFor(rowId) === 0, 'caller ROLLBACK: no credit_hold_funding rows survive (id captured before rollback)');
    ok((await getBalanceV2(pool, u)).availableMicro === C(100), 'caller ROLLBACK: full balance untouched (the hold never happened)');
  }

  // ── 4: caller COMMIT retains the hold (row + funding + reserved balance) ──
  {
    const u = await newUser();
    await grant(u, 100);
    const { client } = await trackedClient();
    await client.query('BEGIN');
    const outcome = await holdV2Tx(client, u, { holdId: 'commit-1', amountMicro: C(30), surface: 's', operation: 'o' });
    const rowId = outcome.row.id;
    await client.query('COMMIT');
    client.release();
    ok(await holdCount(u, 'commit-1') === 1, 'caller COMMIT: exactly one credit_holds row retained');
    ok((await fundingCountFor(rowId)) >= 1, 'caller COMMIT: funding rows retained');
    ok((await getBalanceV2(pool, u)).availableMicro === C(70), 'caller COMMIT: reservation persists (available 70)');
  }

  // ── 5: error codes unchanged, and identical between holdV2 and holdV2Tx ──
  {
    // INSUFFICIENT_CREDITS
    const u1 = await newUser(); await grant(u1, 5);
    const u2 = await newUser(); await grant(u2, 5);
    const cPublic = await codeOf(() => holdV2(pool, u1, { holdId: 'insuff-1', amountMicro: C(50), surface: 's', operation: 'o' }));
    const { client: c2 } = await trackedClient();
    await c2.query('BEGIN');
    const cTx = await codeOf(async () => holdV2Tx(c2, u2, { holdId: 'insuff-1', amountMicro: C(50), surface: 's', operation: 'o' }));
    await c2.query('ROLLBACK'); c2.release();
    ok(cPublic === 'INSUFFICIENT_CREDITS' && cTx === 'INSUFFICIENT_CREDITS', `INSUFFICIENT_CREDITS unchanged on both paths (public=${cPublic}, tx=${cTx})`);
    ok(await holdCount(u1, 'insuff-1') === 0 && await holdCount(u2, 'insuff-1') === 0, 'rejected holds leave no rows on either path');

    // ACCOUNT_FROZEN
    const u3 = await newUser(); await grant(u3, 100); await setFrozen(pool, u3, true);
    const cFrozen = await codeOf(() => holdV2(pool, u3, { holdId: 'frozen-1', amountMicro: C(10), surface: 's', operation: 'o' }));
    const { client: c3 } = await trackedClient();
    await c3.query('BEGIN');
    const cFrozenTx = await codeOf(() => holdV2Tx(c3, u3, { holdId: 'frozen-1', amountMicro: C(10), surface: 's', operation: 'o' }));
    await c3.query('ROLLBACK'); c3.release();
    ok(cFrozen === 'ACCOUNT_FROZEN' && cFrozenTx === cFrozen, 'ACCOUNT_FROZEN unchanged on both paths');
    await setFrozen(pool, u3, false);

    // RESTRICTED_ACCOUNT — requireOrdinaryWallet refuses a non-{user,workspace} owner_kind.
    const u4 = await newUser();
    await pool.query("INSERT INTO credit_accounts (user_id, owner_kind, balance) VALUES ($1,'project_pool',$2)", [u4, C(100).toString()]);
    const cRestrictedPublic = await codeOf(() => holdV2(pool, u4, { holdId: 'restricted-1', amountMicro: C(10), surface: 's', operation: 'o' }));
    const { client: c4 } = await trackedClient();
    await c4.query('BEGIN');
    const cRestrictedTx = await codeOf(async () => holdV2Tx(c4, u4, { holdId: 'restricted-1', amountMicro: C(10), surface: 's', operation: 'o' }));
    await c4.query('ROLLBACK'); c4.release();
    ok(cRestrictedPublic === 'RESTRICTED_ACCOUNT' && cRestrictedTx === 'RESTRICTED_ACCOUNT',
      `RESTRICTED_ACCOUNT unchanged on both paths (public=${cRestrictedPublic}, tx=${cRestrictedTx})`);

    // SPEND_CAP_EXCEEDED
    const u5 = await newUser(); await grant(u5, 1000);
    await setSpendCap(pool, u5, { windowSec: 86400, limitMicro: C(50) });
    const cCap = await codeOf(() => holdV2(pool, u5, { holdId: 'cap-1', amountMicro: C(60), surface: 's', operation: 'o' }));
    const { client: c5 } = await trackedClient();
    await c5.query('BEGIN');
    const cCapTx = await codeOf(() => holdV2Tx(c5, u5, { holdId: 'cap-1', amountMicro: C(60), surface: 's', operation: 'o' }));
    await c5.query('ROLLBACK'); c5.release();
    ok(cCap === 'SPEND_CAP_EXCEEDED' && cCapTx === cCap, 'SPEND_CAP_EXCEEDED unchanged on both paths');
    ok(await holdCount(u5, 'cap-1') === 0, 'cap-exceeded hold leaves no row');
  }

  // ── 6: idempotent replay (existingRow branch) still works through holdV2Tx directly ──
  {
    const u = await newUser();
    await grant(u, 100);
    await holdV2(pool, u, { holdId: 'idem-1', amountMicro: C(10), surface: 's', operation: 'o' });
    const { client } = await trackedClient();
    await client.query('BEGIN');
    const replay = await holdV2Tx(client, u, { holdId: 'idem-1', amountMicro: C(999), surface: 's', operation: 'o' }); // amount ignored on replay, as before
    await client.query('COMMIT');
    client.release();
    ok(replay.existingRow?.hold_id === 'idem-1' && Number(replay.existingRow.amount_micro) === C(10),
      'holdV2Tx replay returns the original existingRow unchanged (legacy idempotency semantics preserved, not altered here)');
    ok(await holdCount(u, 'idem-1') === 1, 'replay created no second row');
    // max:1 makes a balance read before releasing the transaction client fail.
    const publicReplay = await holdV2(pool, u, { holdId: 'idem-1', amountMicro: C(999), surface: 's', operation: 'o' });
    ok(publicReplay.amountMicro === C(10), 'public replay preserves original amount and reads balance after releasing its client');
  }

  console.log(`\nledger-hold-tx-parity: ${pass} passed`);
  await pool.end();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
