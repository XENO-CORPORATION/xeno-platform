/**
 * Tests for requireEntitlement — the SERVER-SIDE gate on the boolean plan levers.
 *
 * WHY THIS TEST IS IN `npm test` AND NOT ALONGSIDE THE OTHER SERVER TESTS:
 * `src/server/tests/*.test.mjs` are run by hand (`node tests/x.test.mjs`). This repo
 * has a documented history of gates that exist but never execute, so a test that
 * proves a revenue gate works belongs in the suite CI actually runs.
 *
 * The five capabilities under test (cloudSync, crossApp, agents, collaboration,
 * privateProjects) were advertised on the pricing page, rendered in BillingPage and
 * UpgradePrompt, and enforced NOWHERE — a repo-wide search for a server-side read of
 * any of them returned nothing. These assertions are what stop that recurring.
 *
 * Run: node --test scripts/entitlement-enforcement.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  requireEntitlement, assertEntitlement, cheapestPlanWith, grants, upgradeRequiredBody,
} from '../src/server/middleware/requireEntitlement.js';

/**
 * A pool stub. Returns a plan row for the plan lookup and nothing for everything
 * else (billingService.ensureSchema issues DDL through the same handle).
 */
function poolWithPlan(plan, status = 'active') {
  return {
    query: async (sql) => {
      if (/FROM xeno_account_plans/i.test(sql)) {
        return { rows: plan ? [{ plan, status, current_period_end: null }] : [] };
      }
      return { rows: [] };
    },
  };
}

/** A pool that always throws — the infrastructure-fault case. */
const brokenPool = { query: async () => { throw new Error('db down'); } };

function fakeRes() {
  const res = { statusCode: null, body: null, ended: false };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.ended = true; return res; };
  return res;
}

async function runMiddleware(mw, { userId = 'u1', db } = {}) {
  const req = { user: userId ? { id: userId } : undefined, db };
  const res = fakeRes();
  let nextCalled = false;
  await mw(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

// ── The upgrade ladder reflects the real catalog, not an assumption ──────────

test('collaboration is a TEAM lever, not Pro', () => {
  // PLAN_ENTITLEMENTS has collaboration:false on pro and true on team. If someone
  // "fixes" pro to include it, the pricing page and this gate must move together.
  assert.equal(cheapestPlanWith('collaboration'), 'team');
});

test('privateProjects and cloudSync are PRO levers', () => {
  assert.equal(cheapestPlanWith('privateProjects'), 'pro');
  assert.equal(cheapestPlanWith('cloudSync'), 'pro');
  assert.equal(cheapestPlanWith('crossApp'), 'pro');
  assert.equal(cheapestPlanWith('agents'), 'pro');
});

test('free grants none of the five platform levers', () => {
  for (const cap of ['cloudSync', 'crossApp', 'agents', 'collaboration', 'privateProjects']) {
    assert.equal(grants({ plan: 'free' }, cap), false, `${cap} must not be free`);
  }
});

// ── A typo must break the boot, never open a door ────────────────────────────

test('an unknown capability throws at WIRING time', () => {
  assert.throws(() => requireEntitlement('cloudSinc'), /unknown capability/);
});

test('an unknown capability throws in the in-route form too', async () => {
  await assert.rejects(
    () => assertEntitlement(poolWithPlan('team'), 'u1', 'nonsense'),
    /unknown capability/,
  );
});

// ── The gate actually refuses ────────────────────────────────────────────────

test('free user is refused a Pro capability with 403', async () => {
  const mw = requireEntitlement('privateProjects');
  const { res, nextCalled } = await runMiddleware(mw, { db: poolWithPlan(null) });
  assert.equal(nextCalled, false, 'must not reach the handler');
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'plan_upgrade_required');
  assert.equal(res.body.currentPlan, 'free');
  assert.equal(res.body.requiredPlan, 'pro');
});

test('pro user is refused a Team capability', async () => {
  const mw = requireEntitlement('collaboration');
  const { res, nextCalled } = await runMiddleware(mw, { db: poolWithPlan('pro') });
  assert.equal(nextCalled, false);
  assert.equal(res.body.requiredPlan, 'team');
});

test('team user passes the collaboration gate', async () => {
  const mw = requireEntitlement('collaboration');
  const { res, nextCalled, req } = await runMiddleware(mw, { db: poolWithPlan('team') });
  assert.equal(nextCalled, true, 'must reach the handler');
  assert.equal(res.statusCode, null, 'must not write a response');
  assert.equal(req.entitlements.plan, 'team', 'resolution is handed downstream');
});

test('an INACTIVE subscription does not grant the capability', async () => {
  // getPlan only honours ACTIVE_STATUSES; a canceled team sub falls back to free.
  const mw = requireEntitlement('collaboration');
  const { nextCalled, res } = await runMiddleware(mw, { db: poolWithPlan('team', 'canceled') });
  assert.equal(nextCalled, false, 'a lapsed sub must not keep the feature');
  assert.equal(res.body.currentPlan, 'free');
});

// ── Fail closed, and do not become a second auth check ───────────────────────

test('a database fault FAILS CLOSED (refuses), it does not leak the feature', async () => {
  const mw = requireEntitlement('privateProjects');
  const { res, nextCalled } = await runMiddleware(mw, { db: brokenPool });
  assert.equal(nextCalled, false, 'an outage must not hand out the paid feature');
  assert.equal(res.statusCode, 403);
});

test('an unauthenticated request passes THROUGH — requireAuth owns 401', async () => {
  // If this gate answered 401/403 for anonymous traffic it would look like a working
  // auth check while being a much weaker one, and a route mounted without requireAuth
  // would appear protected. It must be inert without a user.
  const mw = requireEntitlement('privateProjects');
  const { res, nextCalled } = await runMiddleware(mw, { userId: null, db: poolWithPlan('team') });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

// ── The refusal must drive the UI that already exists ────────────────────────

test('the 403 body carries a context token UpgradePrompt understands', () => {
  // components/common/UpgradePrompt.tsx accepts exactly this union.
  const KNOWN = new Set(['cloudSync', 'crossApp', 'agents', 'collaboration', 'resolution', 'credits', 'commercial', 'general']);
  for (const cap of ['cloudSync', 'crossApp', 'agents', 'collaboration', 'privateProjects', 'commercial']) {
    const body = upgradeRequiredBody(cap, { plan: 'free' });
    assert.ok(KNOWN.has(body.context), `${cap} → '${body.context}' is not a real UpgradePrompt context`);
  }
});

test('the refusal names the capability so a client can act on it', () => {
  const body = upgradeRequiredBody('cloudSync', { plan: 'free' });
  assert.equal(body.capability, 'cloudSync');
  assert.match(body.message, /Pro/);
});
