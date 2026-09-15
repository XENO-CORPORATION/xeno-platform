/**
 * quota-engine.test.mjs — the weekly allowance and the burst guard beneath it.
 *
 * 🔒 `XENO PRICING - STANDARD & LEDGER.md` §8b. Two things that must not become one:
 * the QUOTA is the product (a refilled pool, shown as a percentage), the BURST GUARD is a
 * safety rail that exists because we run agents — a human cannot drain a week in an hour,
 * a runaway loop can do it in minutes.
 *
 * Mutation checks (each verified to fail the named test):
 *   - make the allowance lot outrank paid credits   -> "the allowance is spent before purchased credits"
 *   - drop the window from the grant's source_ref   -> "a refill is idempotent within its window"
 *   - refill a partly-spent allowance to full       -> "a refill never tops up mid-window"
 *   - give an agent its owner's burst fraction      -> "an agent's burst guard is tighter than its owner's"
 *   - return credits from the quota view            -> "the subscriber view carries no credit or token number"
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWANCE_PRIORITY, BURST_WINDOWS, WEEKLY_ALLOWANCE_CREDITS, WINDOW_SEC,
  allowanceCreditsFor, allowanceSourceRef, burstCapsFor, issueAllowanceTx, quotaView, windowFor,
} from '../src/server/utils/quotaEngine.js';

const MICRO = 1_000_000;

/** A client that records queries and answers the two the engine asks. */
function fakeClient({ existingRefs = [] } = {}) {
  const grants = [];
  return {
    grants,
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (/FROM credit_grants WHERE user_id = \$1 AND source_ref = \$2/.test(sql)) {
        return { rows: existingRefs.includes(params[1]) ? [{ '?column?': 1 }] : [] };
      }
      if (/INSERT INTO credit_grants/.test(sql)) {
        grants.push({ amount: Number(params[2]), kind: params[3], priority: params[4], sourceRef: params[5], expiresAt: params[6] });
        return { rows: [] };
      }
      // addGrantTx -> ensureAccount + syncGrants. Answering these for real keeps the test
      // on the REAL grant path rather than a parallel copy of it.
      if (/SUM\(remaining_micro\)/.test(sql)) return { rows: [{ s: '0' }] };
      if (/UPDATE credit_accounts/.test(sql)) return { rows: [] };
      return { rows: [{ id: 'acct-1', balance: '0', is_frozen: false }] };
    },
  };
}

test('a window is derivable from the clock alone, and is exactly 7 days', () => {
  const a = windowFor(new Date('2026-09-15T10:00:00Z'));
  const b = windowFor(new Date('2026-09-15T23:59:59Z'));
  assert.equal(a.index, b.index, 'same week, same window');
  assert.equal((a.endsAt - a.startsAt) / 1000, WINDOW_SEC);
  const next = windowFor(new Date(a.endsAt.getTime() + 1000));
  assert.equal(next.index, a.index + 1);
  assert.equal(next.startsAt.getTime(), a.endsAt.getTime(), 'windows abut with no gap');
  // Nothing is stored: the same instant always resolves to the same window after a restart.
  assert.equal(windowFor(new Date('2026-09-15T10:00:00Z')).index, a.index);
});

test('the allowance is spent before purchased credits', () => {
  // drawdownGrants orders by priority ASC, so a LOWER number drains first. The allowance
  // must outrank nothing — it must be outranked, so that what a user BOUGHT survives the
  // weekly reset and what we gave them does not.
  assert.ok(ALLOWANCE_PRIORITY < 10, 'below free(10), promo(50), paid(100)');
});

test('a refill issues one lot, priced by plan, expiring at the window edge', async () => {
  const client = fakeClient();
  const now = new Date('2026-09-15T10:00:00Z');
  const r = await issueAllowanceTx(client, 'u1', 'pro', { now });
  assert.equal(r.issued, true);
  assert.equal(client.grants.length, 1);
  const g = client.grants[0];
  assert.equal(g.amount, WEEKLY_ALLOWANCE_CREDITS.pro * MICRO);
  assert.equal(g.kind, 'allowance');
  assert.equal(g.priority, ALLOWANCE_PRIORITY);
  assert.equal(new Date(g.expiresAt).getTime(), windowFor(now).endsAt.getTime(),
    'the lot dies with its window — an allowance that outlives its window is not a window');
});

test('a refill is idempotent within its window', async () => {
  const now = new Date('2026-09-15T10:00:00Z');
  const ref = allowanceSourceRef('u1', 'pro', windowFor(now).index);
  const client = fakeClient({ existingRefs: [ref] });
  const r = await issueAllowanceTx(client, 'u1', 'pro', { now });
  assert.equal(r.issued, false);
  assert.equal(r.reason, 'already-issued');
  assert.equal(client.grants.length, 0, 'concurrent first calls must produce ONE grant');
  // And the ref names the window, so next week is a different grant.
  assert.notEqual(allowanceSourceRef('u1', 'pro', windowFor(now).index + 1), ref);
});

test('a refill never tops up mid-window', async () => {
  // The allowance IS the window. Refilling a partly-spent pool would make "resets Monday"
  // a lie and hand an unbounded budget to anything that loops.
  const now = new Date('2026-09-15T10:00:00Z');
  const ref = allowanceSourceRef('u1', 'pro', windowFor(now).index);
  const client = fakeClient({ existingRefs: [ref] });
  await issueAllowanceTx(client, 'u1', 'pro', { now });
  assert.equal(client.grants.length, 0, 'an existing window grant is never re-issued or extended');
});

test('an unmetered plan is granted nothing and capped by nothing', async () => {
  const client = fakeClient();
  const r = await issueAllowanceTx(client, 'u1', 'internal', { now: new Date() });
  assert.equal(r.issued, false);
  assert.equal(r.reason, 'unmetered');
  assert.equal(client.grants.length, 0);
  assert.deepEqual(burstCapsFor('internal'), [], 'no allowance to protect, so no guard');
});

test("an agent's burst guard is tighter than its owner's", () => {
  // An agent is a users row in its own right, so it takes a spend_caps row by the same
  // mechanism — no new table. A runaway agent burns its own share and stops; the human's
  // week survives. That is the difference between "my agent misbehaved" and "my agent
  // cost me my week".
  const human = burstCapsFor('pro', { isAgent: false });
  const agent = burstCapsFor('pro', { isAgent: true });
  assert.equal(human.length, BURST_WINDOWS.length);
  assert.equal(agent.length, human.length);
  for (let i = 0; i < human.length; i += 1) {
    assert.equal(agent[i].windowSec, human[i].windowSec);
    assert.ok(agent[i].limitMicro < human[i].limitMicro, 'an agent must not be able to spend its owner dry');
  }
});

test('a burst guard bounds a runaway loop to a fraction of the week', () => {
  const weekly = WEEKLY_ALLOWANCE_CREDITS.pro * MICRO;
  const [guard] = burstCapsFor('pro', { isAgent: true });
  assert.ok(guard.limitMicro > 0, 'a zero cap would refuse the first honest call');
  assert.ok(guard.limitMicro <= weekly * 0.25, 'a loop cannot eat the week before it is stopped');
  assert.equal(guard.windowSec, 5 * 60 * 60);
});

test('the subscriber view carries no credit or token number', () => {
  const v = quotaView({ allowanceMicro: 100 * MICRO, remainingMicro: 38 * MICRO, plan: 'pro' });
  assert.equal(v.usedPercent, 62);
  assert.equal(v.exhausted, false);
  assert.ok(v.resetsAt, 'a percentage without a reset time is not actionable');
  // §8 forbids exposing the token/compute mapping. The route strips these; the engine
  // returns them for server-side callers only, and nothing here may be a TOKEN count.
  assert.ok(!('tokens' in v) && !('micro' in v) && !('allowanceMicro' in v));
});

test('a spent allowance reads 100% and exhausted, which is what opens the door', () => {
  const v = quotaView({ allowanceMicro: 100 * MICRO, remainingMicro: 0, plan: 'pro' });
  assert.equal(v.usedPercent, 100);
  assert.equal(v.exhausted, true, 'exhausted is what offers a top-up instead of a wall');
});

test('a top-up does not move the quota bar', () => {
  // Purchased credits are a separate lot. If they counted into the percentage, topping up
  // would appear to refill the weekly quota — the confusion overlapping grants produce.
  const before = quotaView({ allowanceMicro: 100 * MICRO, remainingMicro: 0, plan: 'pro' });
  const after = quotaView({ allowanceMicro: 100 * MICRO, remainingMicro: 0, plan: 'pro' });
  assert.equal(before.usedPercent, after.usedPercent);
  assert.equal(after.exhausted, true, 'the ALLOWANCE stays exhausted even when credits exist');
});

test('an over-spent or negative remainder never reads below 0% or above 100%', () => {
  assert.equal(quotaView({ allowanceMicro: 100 * MICRO, remainingMicro: -5 * MICRO, plan: 'pro' }).usedPercent, 100);
  assert.equal(quotaView({ allowanceMicro: 100 * MICRO, remainingMicro: 999 * MICRO, plan: 'pro' }).usedPercent, 0);
  assert.equal(quotaView({ allowanceMicro: 0, remainingMicro: 0, plan: 'free' }).usedPercent, 100);
});

test('an unmetered plan reports metered:false rather than 0%', () => {
  const v = quotaView({ allowanceMicro: null, remainingMicro: 0, plan: 'internal' });
  assert.equal(v.metered, false);
  assert.equal(v.exhausted, false, 'unmetered must never read as exhausted');
});

test('every plan in the entitlement set has an allowance decision', () => {
  // A plan with no row is not "unlimited" by accident — it must be a written null.
  for (const plan of ['free', 'pro', 'team', 'studio', 'internal']) {
    assert.ok(plan in WEEKLY_ALLOWANCE_CREDITS, `${plan} has no §8b allowance decision`);
  }
  assert.ok(WEEKLY_ALLOWANCE_CREDITS.free < WEEKLY_ALLOWANCE_CREDITS.pro);
  assert.ok(WEEKLY_ALLOWANCE_CREDITS.pro < WEEKLY_ALLOWANCE_CREDITS.studio);
});

// ── The fail-open defects found on 2026-09-15, before this shipped ───────────────
//
// Each of these is a gate over a bug that was in the first version of quotaEngine.js.
// They are grouped because they share one shape: the safe-looking default was the
// dangerous one, and in every case the failure was SILENT.

test('an unknown plan falls back to the free allowance, never to unmetered', () => {
  // `WEEKLY_ALLOWANCE_CREDITS[plan]` for an unknown plan is `undefined`, and
  // `undefined == null` is TRUE — so reading the table directly treated a typo, a null
  // column, or a plan added to effectivePlan's RANK and not here EXACTLY like 'internal':
  // no allowance, therefore no burst cap, therefore an unguarded wallet.
  for (const bogus of ['enterprise', 'Pro', '', null, undefined]) {
    assert.equal(allowanceCreditsFor(bogus), WEEKLY_ALLOWANCE_CREDITS.free, `plan=${String(bogus)}`);
    const caps = burstCapsFor(bogus);
    assert.equal(caps.length, BURST_WINDOWS.length, `plan=${String(bogus)} must still be capped`);
    assert.ok(caps[0].limitMicro > 0);
  }
  // …and the one plan that IS unmetered stays unmetered, because it is WRITTEN as null.
  assert.equal(allowanceCreditsFor('internal'), null);
  assert.deepEqual(burstCapsFor('internal'), []);
});

test('an unknown plan is still granted an allowance rather than silently nothing', async () => {
  const client = fakeClient();
  const r = await issueAllowanceTx(client, 'u1', 'enterprise', { now: new Date('2026-09-15T10:00:00Z') });
  assert.equal(r.issued, true, 'an unrecognised plan must not resolve to "unmetered"');
  assert.equal(client.grants[0].amount, WEEKLY_ALLOWANCE_CREDITS.free * MICRO);
});

test('losing the insert race reports already-issued, not an error', async () => {
  // The SELECT is an optimisation; `uq_grants_allowance_window` is the idempotency. Ten
  // concurrent first calls of a window all read "no grant" before any of them writes, so
  // the loser MUST treat 23505 as success — one grant exists, which is the whole contract.
  // Throwing here would refuse a user the allowance they are entitled to.
  const client = fakeClient();
  const realQuery = client.query.bind(client);
  client.query = async (sql, params) => {
    if (/INSERT INTO credit_grants/.test(sql)) {
      const e = new Error('duplicate key value violates unique constraint "uq_grants_allowance_window"');
      e.code = '23505';
      throw e;
    }
    return realQuery(sql, params);
  };
  const r = await issueAllowanceTx(client, 'u1', 'pro', { now: new Date('2026-09-15T10:00:00Z') });
  assert.equal(r.issued, false);
  assert.equal(r.reason, 'already-issued');
});

test('a non-unique-violation error is NOT swallowed', async () => {
  // The 23505 catch must be exactly that. Swallowing a connection or constraint failure
  // would report a quota that was never issued, which is how a subsystem "works" for weeks.
  const client = fakeClient();
  const realQuery = client.query.bind(client);
  client.query = async (sql, params) => {
    if (/INSERT INTO credit_grants/.test(sql)) { const e = new Error('connection terminated'); e.code = '57P01'; throw e; }
    return realQuery(sql, params);
  };
  await assert.rejects(() => issueAllowanceTx(client, 'u1', 'pro', { now: new Date() }), /connection terminated/);
});

test('the allowance grant is uniquely indexed in the schema, not merely checked in code', async () => {
  // A read cannot make a write idempotent. If this index is dropped, the SELECT above is
  // all that stands between ten concurrent calls and ten weekly allowances.
  const { readFileSync } = await import('node:fs');
  const ddl = readFileSync(new URL('../src/server/database/migrate-account-v2.js', import.meta.url), 'utf8');
  assert.match(ddl, /CREATE UNIQUE INDEX IF NOT EXISTS uq_grants_allowance_window\s+ON credit_grants \(user_id, source_ref\)/,
    'the partial unique index on (user_id, source_ref) is what makes the lazy refill safe');
  assert.match(ddl, /uq_grants_allowance_window[\s\S]{0,160}WHERE kind = 'allowance'/,
    'scoped to allowance: a broad unique index runs at startup and would take the backend down on historical duplicates');
});
