import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBilling, readBillingReconciliationSnapshot } from './lib/billing-reconciliation.mjs';

const env = { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture',
  STRIPE_EXPECTED_ACCOUNT_ID: 'acct_fixture', STRIPE_EXPECTED_MODE: 'test' };
const blankCounts = { billing_customers: 0, billing_events: 0, billing_charges: 0,
  xeno_account_plans: 0, workspaces: 0, checkout_consents: 0 };
const snapshot = (customers = [], patch = {}) => ({ counts: { ...blankCounts, billing_customers: customers.length, ...patch }, customers, binding: null });
const empty = { object: 'list', data: [], has_more: false };
function provider(overrides = {}) {
  return {
    accounts: { retrieveCurrent: async () => ({ object: 'account', id: 'acct_fixture' }) },
    customers: { retrieve: async id => ({ object: 'customer', id, livemode: false }) },
    subscriptions: { list: async () => empty }, paymentIntents: { list: async () => empty },
    checkout: { sessions: { list: async () => empty } }, ...overrides,
  };
}

test('empty mapped scope is complete but never grants cutover approval', async () => {
  const result = await reconcileBilling({ provider: provider(), env, readSnapshot: async () => snapshot() });
  assert.equal(result.complete, true); assert.equal(result.cutoverApproved, false);
  assert.equal(result.reviewRequired, true); assert.equal(result.scope, 'database-mapped-customers-only');
  assert.equal(result.obligations.unknown, false); assert.equal(result.requests, 2);
  assert.deepEqual(result.issues, []); assert.match(JSON.stringify(result.limitations), /unmapped customers/);
  assert.ok(!JSON.stringify(result).includes('acct_fixture'));
});

test('configuration and authenticated account mismatch fail before DB/provider inventory', async () => {
  let snapshots = 0;
  for (const badEnv of [{ ...env, STRIPE_EXPECTED_MODE: 'live' }, { ...env, STRIPE_EXPECTED_ACCOUNT_ID: '' }]) {
    const result = await reconcileBilling({ provider: provider(), env: badEnv, readSnapshot: async () => { snapshots++; return snapshot(); } });
    assert.equal(result.complete, false); assert.deepEqual(result.issues, ['configuration_invalid']);
  }
  const mismatch = provider({ accounts: { retrieveCurrent: async () => ({ object: 'account', id: 'acct_other' }) } });
  const result = await reconcileBilling({ provider: mismatch, env, readSnapshot: async () => { snapshots++; return snapshot(); } });
  assert.deepEqual(result.issues, ['account_verification_failed']); assert.equal(snapshots, 0);
});

test('DB snapshot errors and malformed legacy state fail closed without provider details', async () => {
  for (const readSnapshot of [async () => { throw new Error('SECRET_SENTINEL'); }, async () => snapshot(['bad']),
    async () => ({ ...snapshot(), binding: undefined }), async () => snapshot([], { billing_events: -1 })]) {
    const result = await reconcileBilling({ provider: provider(), env, readSnapshot });
    assert.equal(result.complete, false); assert.deepEqual(result.issues, ['database_snapshot_failed']);
    assert.ok(!JSON.stringify(result).includes('SECRET_SENTINEL'));
  }
});

test('binding mismatch is a hard stop and legacy rows remain explicitly visible', async () => {
  const result = await reconcileBilling({ provider: provider(), env,
    readSnapshot: async () => ({ ...snapshot([], { billing_events: 3 }), binding: { accountId: 'acct_other', mode: 'test' } }) });
  assert.equal(result.binding, 'mismatched'); assert.equal(result.database.billing_events, 3);
  assert.deepEqual(result.issues, ['database_binding_mismatch']); assert.equal(result.requests, 1);
});

test('all pages are consumed and active obligations are counted', async () => {
  const calls = [];
  const p = provider({
    subscriptions: { list: async params => { calls.push(params); return params.starting_after
      ? { object: 'list', data: [{ object: 'subscription', id: 'sub_2', customer: 'cus_a', livemode: false, status: 'canceled' }], has_more: false }
      : { object: 'list', data: [{ object: 'subscription', id: 'sub_1', customer: 'cus_a', livemode: false, status: 'active' }], has_more: true }; } },
    paymentIntents: { list: async () => ({ object: 'list', data: [{ object: 'payment_intent', id: 'pi_1', customer: 'cus_a', livemode: false, status: 'processing' }], has_more: false }) },
    checkout: { sessions: { list: async () => ({ object: 'list', data: [{ object: 'checkout.session', id: 'cs_1', customer: 'cus_a', livemode: false, status: 'open', payment_status: 'unpaid' }], has_more: false }) } },
  });
  const result = await reconcileBilling({ provider: p, env, readSnapshot: async () => snapshot(['cus_a']) });
  assert.equal(result.complete, true); assert.equal(calls.length, 2); assert.equal(calls[0].status, 'all');
  assert.equal(calls[1].starting_after, 'sub_1');
  assert.deepEqual(result.obligations, { nonterminalSubscriptions: 1, openCheckouts: 1, unsettledPaymentIntents: 1, unknown: false });
});

test('deleted and missing mapped customers remain unknown even when child lists are empty', async () => {
  const missing = Object.assign(new Error('private provider text'), { code: 'resource_missing' });
  let n = 0;
  const p = provider({ customers: { retrieve: async id => { n++; if (id === 'cus_missing') throw missing;
    return { object: 'customer', id, deleted: true }; } } });
  const result = await reconcileBilling({ provider: p, env, readSnapshot: async () => snapshot(['cus_deleted', 'cus_missing']) });
  assert.deepEqual(result.customers, { mapped: 2, retrieved: 0, missing: 1, deleted: 1, unknown: 0 });
  assert.equal(result.complete, false); assert.equal(result.obligations.unknown, true);
  assert.ok(result.issues.includes('customer_deleted')); assert.ok(result.issues.includes('customer_missing'));
  assert.ok(!JSON.stringify(result).includes('private provider text')); assert.equal(n, 2);
});

test('list errors, malformed pages, unknown status, duplicates and wrong mode all fail closed', async t => {
  const badPages = [
    async () => { throw new Error('SECRET_SENTINEL'); },
    async () => ({ object: 'list', data: [], has_more: true }),
    async () => ({ object: 'list', data: [{ object: 'subscription', id: 'sub_1', customer: 'cus_a', livemode: false, status: 'brand_new' }], has_more: false }),
    async () => ({ object: 'list', data: [{ object: 'subscription', id: 'sub_1', customer: 'cus_a', livemode: true, status: 'active' }], has_more: false }),
    async () => ({ object: 'list', data: [
      { object: 'subscription', id: 'sub_1', customer: 'cus_a', livemode: false, status: 'active' },
      { object: 'subscription', id: 'sub_1', customer: 'cus_a', livemode: false, status: 'active' }], has_more: false }),
  ];
  for (const list of badPages) await t.test('invalid provider response', async () => {
    const result = await reconcileBilling({ provider: provider({ subscriptions: { list } }), env, readSnapshot: async () => snapshot(['cus_a']) });
    assert.equal(result.complete, false); assert.ok(result.issues.includes('subscriptions_inventory_failed'));
    assert.equal(result.obligations.unknown, true); assert.ok(!JSON.stringify(result).includes('SECRET_SENTINEL'));
  });
});

test('page and global request caps refuse apparently successful partial inventories', async () => {
  const more = { object: 'list', data: [{ object: 'subscription', id: 'sub_1', customer: 'cus_a', livemode: false, status: 'active' }], has_more: true };
  const pageLimited = await reconcileBilling({ provider: provider({ subscriptions: { list: async () => more } }), env,
    readSnapshot: async () => snapshot(['cus_a']), maxPages: 1 });
  assert.ok(pageLimited.issues.includes('page_limit')); assert.equal(pageLimited.complete, false);
  const requestLimited = await reconcileBilling({ provider: provider(), env, readSnapshot: async () => snapshot(['cus_a']), maxRequests: 2 });
  assert.ok(requestLimited.issues.includes('request_limit')); assert.equal(requestLimited.obligations.unknown, true);
});

test('final account drift refuses completeness', async () => {
  let calls = 0;
  const p = provider({ accounts: { retrieveCurrent: async () => ({ object: 'account', id: ++calls === 1 ? 'acct_fixture' : 'acct_other' }) } });
  const result = await reconcileBilling({ provider: p, env, readSnapshot: async () => snapshot() });
  assert.deepEqual(result.issues, ['final_account_verification_failed']); assert.equal(result.complete, false);
});

test('PostgreSQL adapter uses repeatable-read read-only transaction, fixed tables and rollback', async () => {
  const queries = [];
  const client = { query: async (sql, params) => {
    queries.push([sql, params]);
    if (sql.startsWith('SELECT to_regclass')) return { rows: [{ relation: params[0] === 'billing_customers' ? 'billing_customers' : null }] };
    if (sql.startsWith('SELECT count')) return { rows: [{ count: '1' }] };
    if (sql.startsWith('SELECT stripe_customer')) return { rows: [{ stripe_customer_id: 'cus_a' }] };
    return { rows: [] };
  } };
  const result = await readBillingReconciliationSnapshot(client);
  assert.deepEqual(result, { counts: { ...blankCounts, billing_customers: 1 }, customers: ['cus_a'], binding: null });
  assert.equal(queries[0][0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(queries.at(-1)[0], 'ROLLBACK');
  assert.ok(queries.some(([sql]) => sql.includes("statement_timeout = '10s'")));
});

test('PostgreSQL adapter rejects malformed counts and still rolls back', async () => {
  const queries = [];
  const client = { query: async (sql, params) => { queries.push(sql);
    if (sql.startsWith('SELECT to_regclass')) return { rows: [{ relation: params[0] }] };
    if (sql.startsWith('SELECT count')) return { rows: [{ count: 'NaN' }] }; return { rows: [] }; } };
  await assert.rejects(readBillingReconciliationSnapshot(client), { code: 'database_snapshot_failed' });
  assert.equal(queries.at(-1), 'ROLLBACK');
});
