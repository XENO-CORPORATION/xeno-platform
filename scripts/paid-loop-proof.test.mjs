import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { modeFor, validateTarget, allPages, quietDependencies, runProof } from './lib/paid-loop-proof.mjs';

const env = { NODE_ENV: 'test', STRIPE_SECRET_KEY: 'sk_test_fixture', XENO_PAID_LOOP_RUN_ID: 'a'.repeat(32),
  DB_NAME: `xeno_paid_loop_${'a'.repeat(32)}`, DB_HOST: '127.0.0.1', DB_PORT: '5432',
  DB_USER: 'fixture', DB_PASSWORD: 'fixture', STRIPE_PRICE_PRO_MONTHLY: 'price_fixture', BILLING_APP_URL: 'http://localhost:5183',
  XENO_PAID_LOOP_WEBHOOK_URL: 'https://isolated-test.example/api/billing/webhook' };
const webhookSource = readFileSync(new URL('../src/server/services/billingService.js', import.meta.url), 'utf8');
const config = validateTarget(env);
const secret = 'secret-sentinel-do-not-print';

test('offline plan requires no credentials/dependencies; exact CLI arguments only', () => {
  assert.equal(modeFor([]), 'plan'); assert.equal(modeFor(['--confirm']), 'confirm');
  for (const args of [['--confim'], ['--confirm', '--confirm'], ['--confirm=true']]) assert.throws(() => modeFor(args));
  const child = spawnSync(process.execPath, ['scripts/paid-loop-proof.mjs'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT }, timeout: 10_000, windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).status, 'UNEXECUTED');
  for (const args of [['--confirm'], ['--wrong']]) {
    const refused = spawnSync(process.execPath, ['scripts/paid-loop-proof.mjs', ...args], {
      encoding: 'utf8', env: { ...process.env, STRIPE_SECRET_KEY: secret, DB_PASSWORD: secret }, timeout: 10_000, windowsHide: true });
    assert.equal(refused.status, 1); assert.ok(!`${refused.stdout}${refused.stderr}`.includes(secret));
  }
});

test('test-only exact target guard rejects missing, live, shared, remote and override configurations', () => {
  assert.ok(validateTarget({ ...env, STRIPE_SECRET_KEY: 'rk_test_fixture' }));
  for (const key of Object.keys(env)) assert.throws(() => validateTarget({ ...env, [key]: '' }), key);
  for (const [key, value] of [
    ['STRIPE_SECRET_KEY', 'sk_live_secret'], ['STRIPE_SECRET_KEY', 'rk_live_secret'], ['STRIPE_SECRET_KEY', 'unknown'],
    ['STRIPE_SECRET_KEY', 'sk_test_x\n'], ['NODE_ENV', 'production'], ['DB_NAME', 'xeno_ui_local_qual'],
    ['DB_HOST', 'localhost'], ['DB_HOST', '0.0.0.0'], ['DB_PORT', '0'], ['DB_PORT', '65536'], ['DB_PORT', '1.5'],
    ['DATABASE_URL', 'postgres://production'], ['PGHOST', 'remote'], ['PGSERVICE', 'production'],
    ['NODE_OPTIONS', '--import=unsafe'], ['BILLING_APP_URL', 'https://xenostudio.ai'],
    ['BILLING_APP_URL', 'http://user:secret@localhost'], ['BILLING_APP_URL', 'http://localhost/?next=remote'],
    ['XENO_PAID_LOOP_RUN_ID', 'b'.repeat(32)],
    ['XENO_PAID_LOOP_WEBHOOK_URL', 'https://xenostudio.ai/api/billing/webhook'],
    ['XENO_PAID_LOOP_WEBHOOK_URL', 'http://isolated-test.example/api/billing/webhook'],
  ]) assert.throws(() => validateTarget({ ...env, [key]: value }), `${key}:${value}`);
});

test('CLI transport must be explicit and target the exact loopback app origin', () => {
  const cli = { ...env, XENO_PAID_LOOP_TRANSPORT: 'stripe-cli', XENO_PAID_LOOP_WEBHOOK_URL: 'http://localhost:5183/api/billing/webhook' };
  assert.equal(validateTarget(cli).transport, 'stripe-cli');
  for (const patch of [{ XENO_PAID_LOOP_TRANSPORT: 'unknown' }, { XENO_PAID_LOOP_TRANSPORT: '' },
    { XENO_PAID_LOOP_WEBHOOK_URL: 'http://localhost:5184/api/billing/webhook' },
    { XENO_PAID_LOOP_WEBHOOK_URL: 'https://external.example/api/billing/webhook' }]) assert.throws(() => validateTarget({ ...cli, ...patch }));
});

function fixture(options = {}) {
  const events = [], customers = [], sessions = [], subscriptions = [], clocks = [], receipts = [];
  let canceled = false, checkoutCalls = 0, endCount = 0;
  const explode = () => { throw new Error(secret); };
  const pool = {
    async query(sql, params) {
      events.push(sql);
      if (sql.includes('current_database')) return { rows: [{ name: config.database, comment: options.wrongOwner ? 'wrong' : config.comment }] };
      if (sql.includes('INSERT INTO users')) return { rows: [{ id: 42 }] };
      if (sql.includes('INSERT INTO billing_customers')) return { rows: [] };
      if (sql.includes('swallowed')) explode();
      if (sql.includes('FROM checkout_consents')) return { rows: [{ checkout_session_id: options.wrongBinding ? 'cs_test_wrong' : 'cs_test_one', consumed_at: 'now' }] };
      if (sql.includes('FROM billing_customers')) return { rows: [{ stripe_customer_id: 'cus_one' }] };
      if (sql.includes('FROM xeno_account_plans')) return { rows: options.noPlan ? [] : [{ plan: canceled ? 'free' : 'pro', status: canceled ? 'canceled' : 'active', stripe_subscription_id: options.wrongPlanSubscription ? 'sub_other' : 'sub_one', current_period_end: new Date((subscriptions[0]?.current_period_end || 0) * 1000) }] };
      throw new Error('unexpected SQL');
    },
    async end() { endCount++; if (options.closeFailure) explode(); },
  };
  const stripe = {
    webhookEndpoints: { async list() { return { data: options.noEndpoints ? [] : [{ id: 'we_one', status: 'enabled', livemode: false,
      url: options.sharedWebhook ? 'https://xenostudio.ai/api/billing/webhook' : config.webhookUrl, enabled_events: ['*'] }], has_more: false }; } },
    customers: {
      async list({ email, test_clock }) { if (options.discoveryFailure && customers.length) explode(); return { data: customers.filter(c => !c.deleted && (!email || c.email === email) && (test_clock ? c.test_clock === test_clock : !c.test_clock)), has_more: false }; },
      async create(payload) { const customer = { id: 'cus_one', livemode: false, ...payload }; customers.push(customer); if (options.lostClockCustomer) explode(); return customer; },
      async retrieve(id) { return customers.find(c => c.id === id); },
      async update() { events.push('customer-update'); },
      async del(id) { events.push('customer-delete'); if (options.deleteFailure) explode(); if (!options.deleteNoop) customers.find(c => c.id === id).deleted = true; },
    },
    paymentMethods: { async attach() { return { id: 'pm_one' }; } },
    checkout: { sessions: {
      async list() { return { data: options.omittedSession ? [] : sessions, has_more: false }; },
      async retrieve(id) { return sessions.find(s => s.id === id); },
      async expire(id) { events.push('session-expire'); if (options.expireFailure) explode(); if (!options.expireNoop) sessions.find(s => s.id === id).status = 'expired'; },
    } },
    subscriptions: {
      async create(payload) {
        events.push('subscription-create'); assert.equal(payload.metadata.xenoUserId, '42');
        subscriptions.push({ id: 'sub_one', customer: 'cus_one', status: 'active', livemode: false,
          test_clock: clocks[0]?.id, current_period_end: clocks[0] ? clocks[0].frozen_time + 86400 : undefined, latest_invoice: 'in_before' });
        if (options.lostSubscriptionResponse) explode();
        return subscriptions[0];
      },
      async list() { return { data: subscriptions, has_more: false }; },
      async retrieve(id) { return subscriptions.find(s => s.id === id); },
      async cancel(id) { events.push('subscription-cancel'); if (options.cancelFailure) explode(); subscriptions.find(s => s.id === id).status = 'canceled'; canceled = true; },
    },
    testHelpers: { testClocks: {
      async create(payload) { const clock = { id: 'clock_one', livemode: false, status: 'ready', ...payload }; clocks.push(clock); if (options.lostClockResponse) explode(); return clock; },
      async retrieve(id) { return clocks.find(c => c.id === id); },
      async list() { return { data: clocks, has_more: false }; },
      async advance(id, { frozen_time }) { clocks.find(c => c.id === id).frozen_time = frozen_time; subscriptions[0].current_period_end += 30 * 86400;
        subscriptions[0].latest_invoice = 'in_after'; receipts.push({ id: 'evt_one', objectId: 'in_after', type: 'invoice.paid', reconciled: true }); },
      async del(id) { events.push('clock-delete'); if (options.clockDeleteNoop) return { id, deleted: false }; clocks.find(c => c.id === id).deleted = true; return { id, deleted: true }; },
    } },
    invoices: { retrieve: async () => ({ id: 'in_after', customer: 'cus_one', subscription: 'sub_one', livemode: false,
      currency: 'eur', status: 'paid', amount_paid: 2400, billing_reason: 'subscription_cycle' }) },
  };
  const services = {
    async recordConsent(db) { if (options.swallowedQuery) await db.query('swallowed').catch(() => {}); return 'consent-one'; },
    async createCheckout(db, user, item, supplied) {
      checkoutCalls++;
      assert.equal(item, 'pro_monthly');
      if (checkoutCalls === 1) throw Object.assign(new Error(secret), { code: options.wrongRefusal ? 'consent_unavailable' : 'consent_required' });
      assert.deepEqual(supplied, { consentId: 'consent-one', origin: config.origin });
      if (!options.renewal) customers.push({ id: 'cus_one', email: user.email, metadata: { xenoUserId: options.foreignOwner ? '99' : '42' }, livemode: options.liveCustomer || false });
      sessions.push({ id: 'cs_test_one', customer: 'cus_one', livemode: false, status: 'open' });
      if (options.lostCheckoutResponse) explode();
      return { id: 'cs_test_one', url: options.badUrl || 'https://checkout.stripe.com/c/pay/cs_test_one' };
    },
    async getEffectiveEntitlements() { return { entitlements: { canDownload: canceled && options.undefinedClosed ? undefined : !canceled } }; },
  };
  return { async run() { return runProof({ config: options.cli ? { ...config, transport: 'stripe-cli' } : config, pool, stripe, services, webhookSource,
    cliReady: options.cliReady, renewal: options.renewal, receipts, pollMs: 0, intervalMs: 0 }); },
    events, customers, subscriptions, sessions, clocks, endCount: () => endCount };
}

test('renewal uses a new clock, observes exact period delivery, then cleans up verified fixtures', async () => {
  const f = fixture({ renewal: true }), report = await f.run();
  assert.equal(report.status, 'passed-service-loop-only', JSON.stringify(report));
  assert.ok(report.passed.includes('renewal_period_delivered')); assert.ok(report.passed.includes('clock_cleanup_verified'));
  assert.ok(!report.notExercised.includes('Renewal')); assert.ok(f.customers[0].deleted); assert.ok(f.clocks[0].deleted);
});
test('renewal lost-create responses recover only owned clock/customer; cleanup no-op fails', async () => {
  for (const option of ['lostClockResponse', 'lostClockCustomer', 'clockDeleteNoop', 'deleteFailure']) {
    const f = fixture({ renewal: true, [option]: true }), report = await f.run();
    assert.equal(report.status, 'failed');
    if (option.startsWith('lost')) assert.ok(f.clocks[0].deleted, JSON.stringify(report));
    if (option === 'lostClockCustomer') assert.ok(f.customers[0].deleted);
    if (option === 'deleteFailure') assert.ok(!f.events.includes('clock-delete'));
    assert.doesNotMatch(JSON.stringify(report), /secret-sentinel/);
  }
});

test('service loop binds exact consent, verifies external cleanup, and retains DB evidence', async () => {
  const f = fixture(), report = await f.run();
  assert.equal(report.status, 'passed-service-loop-only', JSON.stringify(report));
  assert.equal(report.databaseRetained, true);
  assert.ok(report.notExercised.includes('Hosted Checkout completion'));
  assert.equal(f.sessions[0].status, 'expired'); assert.equal(f.subscriptions[0].status, 'canceled');
  assert.equal(f.customers[0].deleted, true); assert.equal(f.endCount(), 1);
  assert.ok(!f.events.some(sql => /DELETE FROM|DROP /i.test(sql)));
});

test('CLI proof requires readiness and zero enabled endpoints, preserves ingress gap', async () => {
  for (const options of [{ cli: true, noEndpoints: true }, { cli: true, cliReady: true }]) {
    const f = fixture(options); assert.equal((await f.run()).status, 'failed');
    assert.ok(!f.events.some(sql => sql.includes('INSERT')));
  }
  const report = await fixture({ cli: true, cliReady: true, noEndpoints: true }).run();
  assert.equal(report.status, 'passed-service-loop-only');
  assert.ok(report.notExercised.includes('Public webhook endpoint delivery'));
  assert.ok(!report.passed.includes('isolated_webhook_coverage'));
});

for (const option of ['wrongOwner', 'wrongRefusal', 'wrongBinding', 'foreignOwner', 'liveCustomer', 'wrongPlanSubscription',
  'noPlan', 'undefinedClosed', 'swallowedQuery', 'closeFailure', 'discoveryFailure', 'deleteFailure',
  'deleteNoop', 'expireFailure', 'expireNoop', 'cancelFailure', 'lostSubscriptionResponse', 'lostCheckoutResponse', 'sharedWebhook', 'omittedSession']) {
  test(`failure cannot pass: ${option}`, async () => {
    const f = fixture({ [option]: true }), report = await f.run();
    assert.equal(report.status, 'failed'); assert.ok(report.failures.length > 0);
    assert.ok(!JSON.stringify(report).includes(secret)); assert.equal(f.endCount(), 1);
    if (option === 'wrongOwner') assert.equal(f.events.length, 1);
    if (option === 'sharedWebhook') assert.ok(!f.events.some(sql => sql.includes('INSERT')));
    if (['wrongBinding', 'wrongRefusal', 'foreignOwner', 'liveCustomer', 'lostCheckoutResponse'].includes(option)) assert.ok(!f.events.includes('subscription-create'));
    if (['foreignOwner', 'liveCustomer'].includes(option)) assert.ok(!f.events.includes('customer-delete'));
    if (option === 'lostSubscriptionResponse') assert.equal(f.subscriptions[0].status, 'canceled');
    if (option === 'lostCheckoutResponse') assert.equal(f.sessions[0].status, 'expired');
  });
}

test('checkout URL must be exactly the HTTPS provider origin', async () => {
  for (const badUrl of ['https://checkout.stripe.com.evil.example/pay', 'http://checkout.stripe.com/pay', 'https://checkout.stripe.com@evil.example/pay', 'invalid']) {
    const f = fixture({ badUrl }); assert.equal((await f.run()).status, 'failed');
    assert.ok(!f.events.includes('subscription-create'));
  }
});

test('all list pages visited and malformed/stuck pagination refused', async () => {
  const calls = [];
  const rows = await allPages(async args => { calls.push(args); return args.starting_after
    ? { data: [{ id: 'two' }], has_more: false } : { data: [{ id: 'one' }], has_more: true }; }, { customer: 'cus_one' });
  assert.equal(rows.length, 2); assert.equal(calls[1].starting_after, 'one');
  for (const page of [{ data: [] }, { data: [], has_more: true }, { data: [{ id: 'same' }], has_more: true }]) {
    await assert.rejects(allPages(async () => page, {}));
  }
});

test('dependency console errors are counted without leaking and console is always restored', async () => {
  const original = console.error;
  const captured = await quietDependencies(async () => { console.error(secret); console.warn(secret); return 'result'; });
  assert.deepEqual(captured, { result: 'result', errors: 1 }); assert.equal(console.error, original);
  await assert.rejects(quietDependencies(async () => { throw new Error(secret); }));
  assert.equal(console.error, original);
});
