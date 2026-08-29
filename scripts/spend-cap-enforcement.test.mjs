/**
 * Tests for spend-cap enforcement on the HOLD path.
 *
 * THE DEFECT THESE PIN:
 *
 * `assertWithinCaps` existed, was correct, and was called from exactly one place —
 * `recordUsageV2`, the direct-debit path. `holdV2` and `settleHoldV2` never called
 * it. Hosted agent runs bill through hold→settle, so the entire agent spend path
 * ignored spend caps even when one was configured.
 *
 * Second, quieter defect: `assertWithinCaps` summed only SETTLED debits. A hold
 * reserves real money for up to 15 minutes and is invisible to a debit sum until it
 * settles, so N concurrent holds could each pass a cap they jointly exceeded.
 *
 * `XENO MONETIZATION - STRATEGY.md` §9 makes "hard spend caps + alerts" a PUBLIC
 * promise and §10 claims the ledger ships them. Both were true only of one path.
 *
 * These run against a faked pg client rather than a live Postgres so they execute in
 * `npm test` — the existing ledger suites need a database and therefore never run in
 * CI, which is part of why this went unnoticed.
 *
 * Run: node --test scripts/spend-cap-enforcement.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { holdV2 } = await import('../src/server/utils/creditLedgerV2.js');

/**
 * A pg pool stub that answers by SQL shape.
 *
 * @param {object} o
 * @param {bigint|number} o.balance       account balance in micro
 * @param {bigint|number} o.held          micro currently reserved by live holds
 * @param {Array}  o.caps                 [{window_sec, limit_micro}]
 * @param {bigint|number} o.spentInWindow settled debits inside the cap window
 */
function fakePool({ balance = 1_000_000_000n, held = 0n, caps = [], spentInWindow = 0n, existingHold = null } = {}) {
  const seen = [];
  const client = {
    query: async (sql, params = []) => {
      seen.push(sql.replace(/\s+/g, ' ').trim().slice(0, 60));
      if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(sql.trim())) return { rows: [] };
      if (/FROM credit_holds WHERE user_id = \$1 AND hold_id/i.test(sql)) return { rows: existingHold ? [existingHold] : [] };
      if (/SELECT id, balance, is_frozen FROM credit_accounts/i.test(sql)) {
        return { rows: [{ id: 'acct-1', balance: String(balance), is_frozen: false }] };
      }
      if (/SUM\(amount_micro - settled_micro\)/i.test(sql)) return { rows: [{ held: String(held) }] };
      if (/FROM spend_caps/i.test(sql)) return { rows: caps };
      if (/FROM credit_transactions/i.test(sql)) return { rows: [{ s: String(spentInWindow) }] };
      if (/INSERT INTO credit_holds/i.test(sql)) {
        return { rows: [{ id: 'h1', hold_id: params[2], amount_micro: params[5], state: 'held', settled_micro: '0' }] };
      }
      if (/UPDATE credit_holds[\s\S]*SET state='held'/i.test(sql)) {
        return { rows: [{ ...existingHold, amount_micro: params[1], state: 'held', settled_micro: '0', expires_at: params[2] }] };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  return { seen, connect: async () => client };
}

const REQ = { holdId: 'hold-1', surface: 'agent', operation: 'run', amountMicro: 60_000_000 }; // 60 credits

// ── The hold path consults caps at all ──────────────────────────────────────

test('holdV2 CONSULTS the spend cap table', async () => {
  // The original defect was not a wrong comparison — it was that this query never ran.
  const pool = fakePool({ caps: [] });
  await holdV2(pool, 'u1', REQ);
  assert.ok(pool.seen.some((s) => /FROM spend_caps/i.test(s)),
    'holdV2 must read spend_caps; before the fix it never did');
});

test('a hold ABOVE the cap is refused', async () => {
  const pool = fakePool({ caps: [{ window_sec: 86400, limit_micro: '50000000' }] }); // 50 credits
  await assert.rejects(
    () => holdV2(pool, 'u1', REQ), // asks for 60
    (e) => e.code === 'SPEND_CAP_EXCEEDED',
  );
});

test('a hold WITHIN the cap succeeds', async () => {
  const pool = fakePool({ caps: [{ window_sec: 86400, limit_micro: '100000000' }] }); // 100 credits
  const r = await holdV2(pool, 'u1', REQ); // asks for 60
  assert.ok(r, 'a hold inside the cap must go through');
});

test('an explicitly retryable operation reopens a voided hold after rechecking balance and caps', async () => {
  const pool = fakePool({
    caps: [{ window_sec: 86400, limit_micro: '100000000' }],
    existingHold: { id: 'h1', hold_id: REQ.holdId, amount_micro: String(REQ.amountMicro), state: 'voided', settled_micro: '0' },
  });
  const result = await holdV2(pool, 'u1', { ...REQ, reopenVoided: true });
  assert.equal(result.state, 'held');
  assert.ok(pool.seen.some((sql) => /UPDATE credit_holds SET state='held'/i.test(sql)));
  assert.ok(pool.seen.some((sql) => /FROM spend_caps/i.test(sql)), 'reopening must not bypass spend caps');
});

// ── Reserved money counts as spent ──────────────────────────────────────────

test('IN-FLIGHT HOLDS count toward the cap', async () => {
  // 100-credit cap, 60 already reserved by a live hold, asking for 60 more.
  // Summing only settled debits would see 0 spent and allow it — the concurrency hole.
  const pool = fakePool({
    balance: 10_000_000_000n,
    held: 60_000_000n,
    caps: [{ window_sec: 86400, limit_micro: '100000000' }],
    spentInWindow: 0n,
  });
  await assert.rejects(
    () => holdV2(pool, 'u1', REQ),
    (e) => e.code === 'SPEND_CAP_EXCEEDED',
    'concurrent holds must not each pass a cap they jointly exceed',
  );
});

test('settled debits ALSO count toward the cap', async () => {
  const pool = fakePool({
    caps: [{ window_sec: 86400, limit_micro: '100000000' }],
    spentInWindow: 60_000_000n, // already spent 60 today
  });
  await assert.rejects(
    () => holdV2(pool, 'u1', REQ), // + 60 = 120 > 100
    (e) => e.code === 'SPEND_CAP_EXCEEDED',
  );
});

test('spent + held + requested is the sum that is tested', async () => {
  // 30 settled + 30 held + 60 requested = 120 > 100. Neither term alone breaches.
  const pool = fakePool({
    balance: 10_000_000_000n,
    held: 30_000_000n,
    caps: [{ window_sec: 86400, limit_micro: '100000000' }],
    spentInWindow: 30_000_000n,
  });
  await assert.rejects(() => holdV2(pool, 'u1', REQ), (e) => e.code === 'SPEND_CAP_EXCEEDED');
});

// ── Not a behaviour change for anyone without a cap ─────────────────────────

test('no configured cap means no enforcement and no extra queries', async () => {
  const pool = fakePool({ caps: [] });
  const r = await holdV2(pool, 'u1', REQ);
  assert.ok(r);
  assert.ok(!pool.seen.some((s) => /FROM credit_transactions/i.test(s)),
    'with no caps we must not run the per-window spend sum at all');
});

test('the tightest of several caps wins', async () => {
  const pool = fakePool({
    caps: [
      { window_sec: 86400, limit_micro: '1000000000' }, // generous daily
      { window_sec: 3600, limit_micro: '10000000' },    // tight hourly: 10 credits
    ],
  });
  await assert.rejects(() => holdV2(pool, 'u1', REQ), (e) => e.code === 'SPEND_CAP_EXCEEDED');
});

// ── Insufficient balance still wins over the cap check ──────────────────────

test('an unaffordable hold is refused for INSUFFICIENT_CREDITS, not the cap', async () => {
  // Ordering matters for the error the caller sees: "you have no money" and "you hit
  // your own limit" are different problems with different fixes.
  const pool = fakePool({ balance: 1_000_000n, caps: [{ window_sec: 86400, limit_micro: '1' }] });
  await assert.rejects(() => holdV2(pool, 'u1', REQ), (e) => e.code === 'INSUFFICIENT_CREDITS');
});
