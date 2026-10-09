/**
 * allowance-first-use-database.test.mjs — the weekly allowance's first use, under real concurrency.
 *
 * The allowance is issued lazily: the first request in a window creates it, and several requests can arrive
 * together at the top of a window. The issuance must give exactly one grant however many arrive.
 *
 * Two mechanisms claim that, and both are prose in the source:
 *   - ensureQuota (quotaService.js) serialises the racers with a per-user transaction-scoped advisory lock;
 *   - issueAllowanceTx (quotaEngine.js) is guarded by the partial unique index uq_grants_allowance_window on
 *     (user_id, source_ref), for a caller that reaches it without the lock, and reports the loser already-issued.
 *
 * This file runs both on real PostgreSQL from several connections at once. It is the executed form of those
 * comments, so each claim has a test that can fail.
 *
 * Gated like every workforce proof: TEST_DATABASE_URL must name a disposable loopback database
 * (requireProofDatabase: xeno_qual_<32 hex>). The suite drops nothing; it writes rows for users it creates.
 *
 * Mutation checks (each applied to the source, run, then restored byte-identical):
 *   - rethrow 23505 from issueAllowanceTx instead of reporting already-issued
 *       -> "without the lock, the unique index gives one grant and the losers report already-issued" fails
 *   - remove the advisory lock from ensureQuota
 *       -> the outcome still holds: the unique index serialises the racers. This is why the lock-free test exists:
 *          it shows the outcome does not depend on the lock alone.
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
const { ensureQuota } = await import('../src/server/services/quotaService.js');
const { issueAllowanceTx, windowFor, WEEKLY_ALLOWANCE_CREDITS, ALLOWANCE_GRANT_KIND } = await import('../src/server/utils/quotaEngine.js');
const { MICRO_PER_CREDIT } = await import('../src/server/utils/creditLedgerV2.js');

const PLAN = 'pro';
const RACERS = 12;
const NOW = new Date('2026-10-12T10:00:00Z');
const ALLOWANCE_MICRO = BigInt(WEEKLY_ALLOWANCE_CREDITS[PLAN]) * BigInt(MICRO_PER_CREDIT);

test('the allowance issued by concurrent first calls, against PostgreSQL', { skip: !url, timeout: 600000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: RACERS + 4 });
  t.after(() => pool.end());
  await runAllMigrations(pool);
  await migrateAccountV2(pool);

  async function newUser() {
    const id = randomUUID();
    const name = `allow_${id.slice(0, 8)}`;
    await pool.query(
      'INSERT INTO users (id, username, email, password_hash, display_name, credits, email_verified) VALUES ($1,$2,$3,$4,$2,0,true)',
      [id, name, `${name}@proof.invalid`, 'x'],
    );
    return id;
  }
  async function allowanceGrants(userId) {
    const { rows } = await pool.query(
      'SELECT amount_micro, source_ref FROM credit_grants WHERE user_id = $1 AND kind = $2 ORDER BY source_ref',
      [userId, ALLOWANCE_GRANT_KIND],
    );
    return rows;
  }

  await t.test('twelve concurrent first calls through ensureQuota issue exactly one allowance', async () => {
    const user = await newUser();
    await Promise.all(Array.from({ length: RACERS }, () => ensureQuota(pool, user, PLAN, { now: NOW })));
    const grants = await allowanceGrants(user);
    assert.equal(grants.length, 1, `one allowance grant for the window, got ${grants.length}`);
    assert.equal(BigInt(grants[0].amount_micro), ALLOWANCE_MICRO, 'the grant is the plan allowance, once');
  });

  await t.test('without the lock, the unique index gives one grant and the losers report already-issued', async () => {
    const user = await newUser();
    // Each racer runs issueAllowanceTx in its own transaction with no advisory lock: the database alone decides.
    const clients = await Promise.all(Array.from({ length: RACERS }, () => pool.connect()));
    try {
      // allSettled, not all: a racer that fails must not leave the others running on connections the test is about
      // to release. Every racer finishes before anything is asserted or returned to the pool.
      const settled = await Promise.allSettled(clients.map(async (client) => {
        await client.query('BEGIN');
        let result;
        try {
          result = await issueAllowanceTx(client, user, PLAN, { now: NOW });
        } finally {
          // A loser's transaction is aborted by the unique violation it absorbed. Commit only a real issuance.
          await client.query(result?.issued ? 'COMMIT' : 'ROLLBACK');
        }
        return result;
      }));
      const failed = settled.filter((s) => s.status === 'rejected');
      assert.equal(failed.length, 0, `no racer may fail; ${failed.length} did: ${failed[0]?.reason?.message ?? ''}`);
      const outcomes = settled.map((s) => s.value);
      const issued = outcomes.filter((r) => r.issued);
      assert.equal(issued.length, 1, `exactly one racer issues, got ${issued.length}`);
      assert.ok(
        outcomes.filter((r) => !r.issued).every((r) => r.reason === 'already-issued'),
        'every other racer reports already-issued',
      );
      const grants = await allowanceGrants(user);
      assert.equal(grants.length, 1, `one committed grant, got ${grants.length}`);
    } finally {
      for (const client of clients) client.release();
    }
  });

  await t.test('the next window issues a new allowance, distinct from the first', async () => {
    const user = await newUser();
    await ensureQuota(pool, user, PLAN, { now: NOW });
    const { endsAt } = windowFor(NOW);
    const nextWindow = new Date(endsAt.getTime() + 1000);
    await Promise.all(Array.from({ length: RACERS }, () => ensureQuota(pool, user, PLAN, { now: nextWindow })));
    const grants = await allowanceGrants(user);
    assert.equal(grants.length, 2, `one allowance per window, got ${grants.length}`);
    assert.notEqual(grants[0].source_ref, grants[1].source_ref, 'the two windows have distinct source references');
  });
});
