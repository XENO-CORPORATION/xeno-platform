/**
 * admission-lease-database.test.mjs — the admission lease against real PostgreSQL.
 *
 * Decision: XENO ADMISSION - LEASE DECISION.md §3 and §6. The grant is decided inside the hold transaction, under
 * the account's row lock, so two requests on one account cannot both be granted the same funds. This file proves
 * that with concurrent holds, and proves the cases the pure rule cannot see: the funding a plan reads, the spend
 * cap that binds first, the overflow switch, a replay, and a fixed hold that must be unchanged.
 *
 * Gated like every workforce proof: TEST_DATABASE_URL must name a disposable database (requireProofDatabase).
 *
 * Mutation checks (each verified to fail the named test):
 *   - decide the grant outside the transaction (read balance first) -> "concurrent leased holds never over-grant"
 *   - ignore the spend cap headroom in the lease                    -> "a spend cap binds the lease before funding"
 *   - count a held lot twice (skip the reserved subtraction)        -> "a replayed hold does not reserve twice"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';

const url = process.env.TEST_DATABASE_URL;
if (url) requireProofDatabase(url);

const { runAllMigrations } = await import('../src/server/services/migrationRunner.js');
const { migrateAccountV2 } = await import('../src/server/database/migrate-account-v2.js');
const ledger = await import('../src/server/utils/creditLedgerV2.js');
const { ALLOWANCE_PRIORITY } = await import('../src/server/utils/quotaEngine.js');
const { grantedOutputTokensForAmount } = await import('../src/server/utils/admissionLease.js');

const MODEL = 'gpt-6.1-sol';
const INPUT = 13_600;
const REQUESTED = 32_000;
const CREDIT = 1_000_000;
const C = (credits) => credits * CREDIT;
const lease = { model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED };
const future = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);

test('the lease against PostgreSQL: free, Pro, floor, overflow, cap, replay and concurrency', { skip: !url, timeout: 300000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  t.after(() => pool.end());
  await runAllMigrations(pool);
  await migrateAccountV2(pool);

  async function newUser() {
    const handle = `lease_${randomUUID().slice(0, 12)}`;
    const { rows } = await pool.query(
      'INSERT INTO users (username, email, password_hash, display_name, credits) VALUES ($1,$2,$3,$1,$4) RETURNING id',
      [handle, `${handle}@lease.invalid`, 'fixture-not-a-login', 0],
    );
    return rows[0].id;
  }
  const allowance = (userId, credits) => ledger.addGrant(pool, userId, {
    amountMicro: C(credits), kind: 'allowance', priority: ALLOWANCE_PRIORITY, expiresAt: future(),
    sourceRef: `lease-test:allowance:${randomUUID()}`,
  });
  const paid = (userId, credits) => ledger.addGrant(pool, userId, {
    amountMicro: C(credits), kind: 'paid', priority: 100, expiresAt: null, sourceRef: `lease-test:paid:${randomUUID()}`,
  });
  const holdRows = async (userId, holdId) => Number((await pool.query(
    'SELECT count(*)::int n FROM credit_holds WHERE user_id=$1 AND hold_id=$2', [userId, holdId])).rows[0].n);

  await t.test('a free account (50 credits) is granted the 11,375 tokens it can fund, and reserves exactly that', async () => {
    const userId = await newUser();
    await allowance(userId, 50);
    const view = await ledger.holdV2(pool, userId, { holdId: `free-${randomUUID()}`, lease, surface: 'lease-test', operation: 'chat.completion' });
    assert.equal(view.amountMicro, C(50), 'the reservation is the 50 credits the account holds');
    assert.equal(grantedOutputTokensForAmount({ amountMicro: view.amountMicro, model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED }), 11_375);
    assert.equal(view.balance.availableMicro, 0, 'nothing is left to spend until the hold resolves');
  });

  await t.test('a Pro account (2,000 credits) keeps the full ceiling at the 116-credit reservation', async () => {
    const userId = await newUser();
    await allowance(userId, 2_000);
    const view = await ledger.holdV2(pool, userId, { holdId: `pro-${randomUUID()}`, lease, surface: 'lease-test', operation: 'chat.completion' });
    assert.equal(view.amountMicro, C(116));
    assert.equal(grantedOutputTokensForAmount({ amountMicro: view.amountMicro, model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED }), REQUESTED);
  });

  await t.test('below the floor the hold is refused with QUOTA_EXCEEDED and writes no hold row', async () => {
    const userId = await newUser();
    await allowance(userId, 20);
    const holdId = `floor-${randomUUID()}`;
    await assert.rejects(
      () => ledger.holdV2(pool, userId, { holdId, lease, surface: 'lease-test', operation: 'chat.completion' }),
      { code: 'QUOTA_EXCEEDED' },
    );
    assert.equal(await holdRows(userId, holdId), 0, 'no reservation exists for a refused request');
  });

  await t.test('with usage credits ON, a short wallet is refused as INSUFFICIENT_CREDITS, the code it has always had', async () => {
    const userId = await newUser();
    await pool.query('INSERT INTO usage_credit_preferences (user_id, enabled) VALUES ($1, true)', [userId]);
    await paid(userId, 20);
    await assert.rejects(
      () => ledger.holdV2(pool, userId, { holdId: `overflow-${randomUUID()}`, lease, surface: 'lease-test', operation: 'chat.completion' }),
      { code: 'INSUFFICIENT_CREDITS' },
    );
  });

  await t.test('with usage credits OFF, paid credits are not spendable, so the grant comes from the allowance only', async () => {
    const userId = await newUser();
    await paid(userId, 2_000);
    await assert.rejects(
      () => ledger.holdV2(pool, userId, { holdId: `off-${randomUUID()}`, lease, surface: 'lease-test', operation: 'chat.completion' }),
      { code: 'QUOTA_EXCEEDED' },
    );
  });

  await t.test('a spend cap binds the grant: the reply is capped to what the cap leaves, and a cap below the floor refuses', async () => {
    // A 50-credit cap leaves room for the free ceiling, so the grant is shaped by the cap, not refused by it.
    const shaped = await newUser();
    await allowance(shaped, 2_000);
    await ledger.setSpendCap(pool, shaped, { windowSec: 3600, limitMicro: C(50) });
    const view = await ledger.holdV2(pool, shaped, { holdId: `cap-${randomUUID()}`, lease, surface: 'lease-test', operation: 'chat.completion' });
    assert.equal(view.amountMicro, C(50), 'the cap leaves 50 credits, so the reservation is 50 credits');
    assert.equal(grantedOutputTokensForAmount({ amountMicro: view.amountMicro, model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED }), 11_375);
    // A cap that cannot fund the floor refuses, and names the cap as the reason.
    const refused = await newUser();
    await allowance(refused, 2_000);
    await ledger.setSpendCap(pool, refused, { windowSec: 3600, limitMicro: C(10) });
    await assert.rejects(
      () => ledger.holdV2(pool, refused, { holdId: `cap-low-${randomUUID()}`, lease, surface: 'lease-test', operation: 'chat.completion' }),
      { code: 'SPEND_CAP_EXCEEDED' },
    );
  });

  await t.test('a replayed hold returns the reservation it already made, and reserves nothing twice', async () => {
    const userId = await newUser();
    await allowance(userId, 50);
    const holdId = `replay-${randomUUID()}`;
    const first = await ledger.holdV2(pool, userId, { holdId, lease, surface: 'lease-test', operation: 'chat.completion' });
    const second = await ledger.holdV2(pool, userId, { holdId, lease, surface: 'lease-test', operation: 'chat.completion' });
    assert.equal(second.amountMicro, first.amountMicro);
    assert.equal(await holdRows(userId, holdId), 1);
    // The balance view carries posted and available; what is held is the difference between them.
    assert.equal(second.balance.postedMicro - second.balance.availableMicro, first.amountMicro, 'the account holds the reservation once');
  });

  await t.test('a fixed hold is unchanged: it reserves exactly its amount, or refuses for INSUFFICIENT_CREDITS', async () => {
    const userId = await newUser();
    await allowance(userId, 5);
    const view = await ledger.holdV2(pool, userId, { holdId: `fixed-${randomUUID()}`, amountMicro: C(1), surface: 'lease-test', operation: 'consent' });
    assert.equal(view.amountMicro, C(1));
    await assert.rejects(
      () => ledger.holdV2(pool, userId, { holdId: `fixed-big-${randomUUID()}`, amountMicro: C(100), surface: 'lease-test', operation: 'consent' }),
      { code: 'INSUFFICIENT_CREDITS' },
    );
  });

  await t.test('concurrent leased holds on one free account never over-grant', async () => {
    const userId = await newUser();
    await allowance(userId, 50);
    const attempts = Array.from({ length: 40 }, () => ledger.holdV2(pool, userId, {
      holdId: `race-${randomUUID()}`, lease, surface: 'lease-test', operation: 'chat.completion',
    }).then((view) => ({ ok: true, view }), (error) => ({ ok: false, code: error.code })));
    const results = await Promise.all(attempts);
    const granted = results.filter((r) => r.ok);
    const refused = results.filter((r) => !r.ok);
    assert.equal(granted.length, 1, 'exactly one request can take the account\'s 50 credits');
    assert.ok(refused.every((r) => r.code === 'QUOTA_EXCEEDED'), 'every other request is refused for the same reason');
    const reservedMicro = granted.reduce((sum, r) => sum + r.view.amountMicro, 0);
    assert.ok(reservedMicro <= C(50), `reserved ${reservedMicro} µcr exceeds the 50 credits held`);
    const { rows } = await pool.query(
      "SELECT COALESCE(SUM(amount_micro),0)::bigint held FROM credit_holds WHERE user_id=$1 AND state='held'", [userId]);
    assert.equal(Number(rows[0].held), reservedMicro, 'the ledger records exactly the reservation that was granted');
  });
});
