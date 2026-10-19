// /api/billing/summary answered 500 for every account ("getEntitlements is not defined"): billingService
// re-exported getEntitlements from accountPlan.js but never imported it for its own use, and no test called
// getSummary. This calls it with an empty database, so a missing binding fails here instead of in production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSummary } from '../src/server/services/billingService.js';

const emptyPool = {
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }),
};

test('getSummary resolves for an account with no plan and no credits', async () => {
  const s = await getSummary(emptyPool, { id: '00000000-0000-0000-0000-000000000001' });
  assert.equal(typeof s.credits, 'number');
  assert.ok('plan' in s && 'entitlements' in s);
});
