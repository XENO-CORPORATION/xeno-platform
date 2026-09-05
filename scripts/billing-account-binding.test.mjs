import { test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { billingAccountConfig, verifyBillingAccount, canonicalBillingEvent, requireBillingDatabaseBinding, boundedBillingRead } from '../src/server/utils/billingAccountBinding.js';
import { installBillingProviderFixture, boundBillingPool } from './fixtures/billing-provider-fixture.mjs';

const env = { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture',
  STRIPE_EXPECTED_ACCOUNT_ID: 'acct_fixture', STRIPE_EXPECTED_MODE: 'test' };
const config = billingAccountConfig(env);
const fail = { code: 'billing_account_unavailable', status: 503 };
const account = { object: 'account', id: 'acct_fixture' };
const providerFor = response => ({ accounts: { retrieve: async () => response } });
const live = billingAccountConfig({ ...env, STRIPE_SECRET_KEY: 'rk_live_fixture', STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture', STRIPE_EXPECTED_MODE: 'live' });
const ready = { ...account, charges_enabled: true, payouts_enabled: true, details_submitted: true,
  type: 'standard', controller: { type: 'account' }, capabilities: { card_payments: 'active' } };

test('explicit pins and secret/publishable mode are mandatory; failures never echo inputs', () => {
  for (const key of Object.keys(env)) {
    for (const value of ['', 'SECRET_SENTINEL', null]) assert.throws(() => billingAccountConfig({ ...env, [key]: value }), fail);
  }
  for (const patch of [{ STRIPE_SECRET_KEY: 'sk_live_fixture' }, { STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture' },
    { STRIPE_EXPECTED_MODE: 'LIVE' }, { STRIPE_SECRET_KEY: 'sk_org_fixture' }, { STRIPE_EXPECTED_ACCOUNT_ID: 'acct_fixture\n' }]) {
    assert.throws(() => billingAccountConfig({ ...env, ...patch }), error => error.code === fail.code && !error.message.includes('SENTINEL'));
  }
  assert.equal(billingAccountConfig({ ...env, STRIPE_SECRET_KEY: 'rk_test_fixture' }).mode, 'test');
});

test('authenticated account request uses current-account endpoint and real SDK request options', async () => {
  const provider = new Stripe('sk_test_fixture');
  provider.accounts._makeRequest = async (method, path, params, options) => {
    assert.equal(method, 'GET'); assert.equal(path, '/v1/account'); assert.deepEqual(params, {});
    assert.deepEqual(options, { timeout: 10000, maxNetworkRetries: 0 }); return account;
  };
  await verifyBillingAccount(provider, config);
});

test('fresh account identity refuses unknown/mismatch/exception on every call', async () => {
  for (const response of [null, {}, { ...account, object: 'customer' }, { ...account, id: 'acct_other' }]) {
    await assert.rejects(verifyBillingAccount(providerFor(response), config), fail);
  }
  let calls = 0;
  const provider = { accounts: { retrieve: async () => { calls++; if (calls > 1) throw new Error('SECRET_SENTINEL'); return account; } } };
  await verifyBillingAccount(provider, config);
  await assert.rejects(verifyBillingAccount(provider, config), error => error.code === fail.code && !error.message.includes('SENTINEL') && error.cause === undefined);
  assert.equal(calls, 2);
});

test('live sale capabilities fail closed but do not block identity-only reconciliation', async () => {
  assert.equal((await verifyBillingAccount(providerFor(ready), live, { sale: true })).verificationNotExposed, true);
  const completeRequirements = { disabled_reason: null, currently_due: [], past_due: [], pending_verification: [] };
  assert.equal((await verifyBillingAccount(providerFor({ ...ready, requirements: completeRequirements }), live, { sale: true })).verificationNotExposed, false);
  for (const patch of [{ charges_enabled: false }, { payouts_enabled: null }, { details_submitted: 'true' },
    { type: 'custom' }, { controller: null }, { capabilities: {} }, { requirements: [] }, { requirements: {} },
    { requirements: { ...completeRequirements, currently_due: ['document'] } }]) {
    await assert.rejects(verifyBillingAccount(providerFor({ ...ready, ...patch }), live, { sale: true }), fail);
    await verifyBillingAccount(providerFor({ ...ready, ...patch }), live);
  }
});

test('provider deadline is bounded and late rejection is consumed', async () => {
  const native = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => native(fn, ms === 10000 ? 5 : ms);
  try {
    await assert.rejects(boundedBillingRead(() => new Promise(() => {})), fail);
    await assert.rejects(boundedBillingRead(() => new Promise((_, reject) => native(() => reject(new Error('SECRET_SENTINEL')), 15))), fail);
    await new Promise(resolve => native(resolve, 30));
  } finally { globalThis.setTimeout = native; }
});

test('webhooks require strict mode/context and canonical pinned-client identity', async () => {
  const event = { object: 'event', id: 'evt_fixture', type: 'checkout.session.completed', livemode: false, data: { object: { mode: 'payment' } } };
  let reads = 0;
  const provider = { events: { retrieve: async (id, params, options) => { reads++; assert.equal(id, event.id); assert.deepEqual(params, {}); assert.equal(options.timeout, 10000); return { ...event, data: { object: { canonical: true } } }; } } };
  for (const patch of [{ object: undefined }, { livemode: true }, { livemode: undefined }, { account: 'acct_other' },
    { account: '' }, { context: 'acct_fixture' }, { id: 'evt_fixture\n' }, { data: { object: { livemode: true } } }]) {
    await assert.rejects(canonicalBillingEvent(provider, config, { ...event, ...patch }), fail);
  }
  assert.equal(reads, 0);
  assert.deepEqual((await canonicalBillingEvent(provider, config, event)).data.object, { canonical: true });
  for (const patch of [{ id: 'evt_other' }, { type: 'charge.refunded' }, { livemode: true }, { account: 'acct_other' }, { data: null }]) {
    await assert.rejects(canonicalBillingEvent({ events: { retrieve: async () => ({ ...event, ...patch }) } }, config, event), fail);
  }
  await assert.rejects(canonicalBillingEvent({ events: { retrieve: async () => { throw new Error('SECRET_SENTINEL'); } } }, config, event), fail);
});

// State-bearing transaction fixture. The real SQL concurrency case is also run
// inside billing-money-in against its dedicated local PostgreSQL database.
function database({ binding = null, legacy = null, malformed = false, timeout = null } = {}) {
  const state = { binding, inserts: 0, commits: 0, rollbacks: 0, released: 0, inventory: [], sql: [] };
  let lock = Promise.resolve();
  const pool = { connect: async () => {
    let unlock, pending;
    return { release() { state.released++; }, async query(sql, args) {
      state.sql.push(sql);
      if (["SET LOCAL lock_timeout = '10s'", "SET LOCAL statement_timeout = '10s'"].includes(sql)) return { rows: [] };
      if ((timeout === 'lock' && sql.startsWith('SELECT pg_advisory')) || (timeout === 'query' && sql.startsWith('SELECT account_id'))) {
        throw Object.assign(new Error('SECRET_SENTINEL'), { code: timeout === 'lock' ? '55P03' : '57014' });
      }
      if (sql === 'BEGIN' || sql.startsWith('CREATE TABLE')) return { rows: [] };
      if (sql.startsWith('SELECT pg_advisory')) { const prior = lock; lock = new Promise(resolve => { unlock = resolve; }); await prior; return { rows: [] }; }
      if (sql.startsWith('SELECT account_id')) return { rows: state.binding ? [state.binding] : [] };
      if (sql.startsWith('SELECT to_regclass')) { state.inventory.push(args[0]); return { rows: [{ relation: args[0] }] }; }
      if (sql.startsWith('SELECT 1 FROM')) { if (malformed) throw new Error('SECRET_SENTINEL'); return { rows: sql.includes(`FROM ${legacy} `) ? [{}] : [] }; }
      if (sql.startsWith('INSERT INTO billing_account_binding')) { pending = { account_id: args[0], mode: args[1] }; return { rows: [] }; }
      if (sql === 'COMMIT') { if (pending) { state.binding = pending; state.inserts++; } state.commits++; unlock?.(); return { rows: [] }; }
      if (sql === 'ROLLBACK') { state.rollbacks++; unlock?.(); return { rows: [] }; }
      throw new Error('Unexpected SQL');
    } };
  } };
  return { state, pool };
}

test('initial database binding is serialized and matching calls never adopt another account', async () => {
  const { state, pool } = database();
  await Promise.all(Array.from({ length: 8 }, () => requireBillingDatabaseBinding(pool, config)));
  assert.equal(state.inserts, 1); assert.equal(state.commits, 8); assert.equal(state.released, 8);
  for (const other of [{ ...config, accountId: 'acct_other' }, { ...config, mode: 'live' }]) {
    await assert.rejects(requireBillingDatabaseBinding(pool, other), fail);
  }
  assert.deepEqual(state.binding, { account_id: config.accountId, mode: config.mode }); assert.equal(state.rollbacks, 2);
});

test('database lock/query deadlines precede the lock and timeout always rolls back/releases', async () => {
  for (const timeout of ['lock', 'query']) {
    const { pool, state } = database({ timeout });
    await assert.rejects(requireBillingDatabaseBinding(pool, config), error => error.code === fail.code && !error.message.includes('SENTINEL') && !error.cause);
    assert.deepEqual(state.sql.slice(0, 3), ['BEGIN', "SET LOCAL lock_timeout = '10s'", "SET LOCAL statement_timeout = '10s'"]);
    assert.ok(state.sql[3].startsWith('SELECT pg_advisory'));
    assert.equal(state.sql.at(-1), 'ROLLBACK');
    assert.equal(state.rollbacks, 1); assert.equal(state.released, 1);
    assert.equal(state.commits, 0); assert.equal(state.inserts, 0); assert.equal(state.binding, null);
    assert.equal(state.sql.some(sql => /^SET (?!LOCAL)/.test(sql)), false);
  }
});

test('each legacy mapping class and unknown schema refuses unbound adoption', async () => {
  for (const legacy of ['billing_customers', 'billing_events', 'billing_charges', 'xeno_account_plans', 'workspaces', 'checkout_consents']) {
    const { pool, state } = database({ legacy });
    await assert.rejects(requireBillingDatabaseBinding(pool, config), fail);
    assert.equal(state.inserts, 0); assert.equal(state.binding, null); assert.equal(state.rollbacks, 1);
  }
  const { pool, state } = database({ malformed: true });
  await assert.rejects(requireBillingDatabaseBinding(pool, config), fail); assert.equal(state.inserts, 0);
});

Object.assign(process.env, env);
const fixture = installBillingProviderFixture();
const billing = await import('../src/server/services/billingService.js');
test('actual webhook service rejects foreign/unknown events before connecting to its database', async () => {
  const pool = { connect: async () => { throw new Error('Unexpected database access'); }, query: async () => { throw new Error('Unexpected mutation'); } };
  const event = fixture.event('evt_service', 'checkout.session.completed', { payment_status: 'paid' });
  for (const patch of [{ livemode: true }, { context: 'acct_other' }, { id: 'evt_foreign' }]) {
    await assert.rejects(billing.handleEvent(pool, { ...event, ...patch }), fail);
  }
  fixture.account.id = 'acct_other';
  await assert.rejects(billing.handleEvent(pool, event), fail); fixture.account.id = 'acct_fixture';
});

test('actual webhook service processes canonical provider content, not signed envelope metadata', async () => {
  const event = fixture.event('evt_canonical', 'checkout.session.completed', { payment_status: 'unpaid' });
  const envelope = { ...event, data: { object: { payment_status: 'paid', mode: 'payment', customer: 'cus_attacker', metadata: { credits: 1000000 } } } };
  assert.deepEqual(await billing.handleEvent(boundBillingPool(), envelope), { handled: true, reason: 'payment not settled' });
});
