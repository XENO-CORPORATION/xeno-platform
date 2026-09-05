import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  API_VERSION, LIVE_ACCOUNT, WEBHOOK_URL, createPosixSecretSink, deriveBillingEvents,
  liveSetupPlan, provisionLiveSetup, validateLiveEnvironment,
} from './lib/stripe-live-setup.mjs';

const env = { STRIPE_SECRET_KEY: 'sk_live_fixture', STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture',
  STRIPE_EXPECTED_ACCOUNT_ID: LIVE_ACCOUNT, STRIPE_EXPECTED_MODE: 'live' };
const catalog = [
  { id: 'pack', kind: 'credits', label: 'Pack', credits: 1000, price: 10, currency: 'eur', priceEnv: 'STRIPE_PRICE_PACK' },
  { id: 'plan', kind: 'subscription', label: 'Plan', credits: 0, price: 24, currency: 'eur', interval: 'month', perSeat: true, priceEnv: 'STRIPE_PRICE_PLAN' },
];
const source = `switch (event.type) {
case 'checkout.session.completed': case 'invoice.paid': case 'invoice.payment_failed':
case 'customer.subscription.created': case 'customer.subscription.updated': case 'customer.subscription.deleted':
case 'charge.refunded': case 'charge.dispute.created': }`;

function fixture() {
  const products = [], prices = [], webhooks = [], portals = [], reads = [], writes = [];
  const page = (rows, args) => {
    const start = args.starting_after ? rows.findIndex(row => row.id === args.starting_after) + 1 : 0;
    return { data: rows.slice(start, start + 1), has_more: start + 1 < rows.length };
  };
  const account = { object: 'account', id: LIVE_ACCOUNT, charges_enabled: true, payouts_enabled: true,
    details_submitted: true, type: 'standard', controller: { type: 'account' }, capabilities: { card_payments: 'active' } };
  const stripe = {
    accounts: { retrieve: async (...args) => { reads.push('account'); assert.equal(args.length, 3); return account; } },
    products: {
      list: async args => { reads.push('products'); return page(products, args); },
      create: async (args, options) => { writes.push(['product', args, options]); const value = { ...args,
        object: 'product', id: `prod_${products.length + 1}`, livemode: true }; products.push(value); return value; },
    },
    prices: {
      list: async args => { reads.push('prices'); return page(prices, args); },
      create: async (args, options) => { writes.push(['price', args, options]); const value = { ...args,
        object: 'price', id: `price_${prices.length + 1}`, active: true, livemode: true,
        type: args.recurring ? 'recurring' : 'one_time', recurring: args.recurring || null,
        custom_unit_amount: null, transform_quantity: null }; prices.push(value); return value; },
    },
    webhookEndpoints: {
      list: async args => { reads.push('webhooks'); return page(webhooks, args); },
      create: async (args, options) => { writes.push(['webhook', args, options]); const stored = { ...args,
        object: 'webhook_endpoint', id: `we_${webhooks.length + 1}`, status: 'enabled', livemode: true };
        webhooks.push(stored); return { ...stored, secret: 'whsec_fixture' }; },
    },
    billingPortal: { configurations: {
      list: async args => { reads.push('portals'); return page(portals, args); },
      create: async (args, options) => { writes.push(['portal', args, options]); const value = { ...args,
        object: 'billing_portal.configuration', id: `bpc_${portals.length + 1}`, active: true, livemode: true };
        portals.push(value); return value; },
    } },
  };
  const run = (overrides = {}) => provisionLiveSetup({ stripe, catalog, billingSource: source, env, ...overrides });
  return { stripe, account, products, prices, webhooks, portals, reads, writes, run };
}

function secretFixture(initial = null) {
  let receipt = initial;
  const calls = [];
  return { path: '/secure/receipt.json', calls,
    inspect: async () => receipt,
    reserve: async value => { calls.push('reserve'); assert.equal(receipt, null); receipt = value; },
    commit: async value => { calls.push('commit'); receipt = value; },
    receipt: () => receipt };
}

test('plan derives events, excludes legacy and binds the complete catalog digest', () => {
  const plan = liveSetupPlan([...catalog, { ...catalog[0], legacy: true }], source);
  assert.equal(plan.items.length, 2); assert.equal(plan.items[0].unit_amount, 1000);
  assert.deepEqual(plan.webhook.events, deriveBillingEvents(source));
  assert.equal(plan.webhook.url, WEBHOOK_URL); assert.equal(plan.portal.features.subscription_update.enabled, false);
  assert.notEqual(plan.catalogDigest, liveSetupPlan([{ ...catalog[0], price: 11 }, catalog[1]], source).catalogDigest);
  assert.notEqual(plan.catalogDigest, liveSetupPlan([{ ...catalog[0], priceEnv: 'STRIPE_PRICE_PACK_V2' }, catalog[1]], source).catalogDigest);
  assert.ok(plan.items.every(item => /^[a-f0-9]{64}$/.test(item.digest)));
});

for (const patch of [{ price: -1 }, { price: 0.001 }, { currency: 'usd' }, { kind: 'other' },
  { credits: -1 }, { interval: 'year' }, { perSeat: 'yes' }, { id: '../bad' }, { priceEnv: 'OTHER' }]) {
  test(`malformed catalog refuses before provider access: ${JSON.stringify(patch)}`, async () => {
    const f = fixture(); await assert.rejects(f.run({ catalog: [{ ...catalog[0], ...patch }] }));
    assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  });
}

test('duplicate catalog identity and underived webhook coverage fail closed', () => {
  assert.throws(() => liveSetupPlan([catalog[0], catalog[0]], source));
  assert.throws(() => liveSetupPlan(catalog, "case 'invoice.paid':"));
});

for (const patch of [{ STRIPE_SECRET_KEY: 'sk_test_bad' }, { STRIPE_PUBLISHABLE_KEY: 'pk_test_bad' },
  { STRIPE_EXPECTED_ACCOUNT_ID: 'acct_other' }, { STRIPE_EXPECTED_MODE: 'test' }]) {
  test(`live environment refuses ${Object.keys(patch)[0]} before reads`, async () => {
    const f = fixture(); await assert.rejects(f.run({ env: { ...env, ...patch } }));
    assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  });
}

test('restricted live key is accepted but exact sale-capable account gates writes', async () => {
  validateLiveEnvironment({ ...env, STRIPE_SECRET_KEY: 'rk_live_fixture' });
  const f = fixture(); f.account.charges_enabled = false;
  await assert.rejects(f.run()); assert.deepEqual(f.reads, ['account']); assert.equal(f.writes.length, 0);
});

test('complete four-resource inventory is read before the first write', async () => {
  const f = fixture(); await f.run();
  const firstWrite = f.writes[0]; assert.equal(firstWrite[0], 'product');
  assert.deepEqual(f.reads.slice(0, 5), ['account', 'products', 'prices', 'webhooks', 'portals']);
});

test('catalog and portal create exact live shapes, paginate, reread, and rerun idempotently', async () => {
  const f = fixture(); const first = await f.run();
  assert.deepEqual(first.created, { products: 2, prices: 2, portals: 1, webhooks: 0 });
  assert.deepEqual(Object.keys(first.environment).sort(), ['STRIPE_PRICE_PACK', 'STRIPE_PRICE_PLAN']);
  assert.match(first.portalConfigurationId, /^bpc_/); assert.equal(first.nextStage, 'webhook');
  const priceWrites = f.writes.filter(([kind]) => kind === 'price');
  assert.ok(priceWrites.every(([, value]) => value.currency === 'eur' && value.tax_behavior === 'inclusive' && value.billing_scheme === 'per_unit'));
  assert.deepEqual(priceWrites.find(([, value]) => value.recurring)?.[1].recurring,
    { interval: 'month', interval_count: 1, usage_type: 'licensed' });
  const portal = f.writes.find(([kind]) => kind === 'portal')[1];
  assert.equal(portal.features.subscription_cancel.mode, 'at_period_end'); assert.equal(portal.features.subscription_update.enabled, false);
  const keys = f.writes.map(row => row[2].idempotencyKey); assert.equal(new Set(keys).size, keys.length);
  const count = f.writes.length; const again = await f.run(); assert.equal(f.writes.length, count);
  assert.deepEqual(again.environment, first.environment); assert.deepEqual(again.created, { products: 0, prices: 0, portals: 0, webhooks: 0 });
  assert.ok(f.reads.filter(value => value === 'products').length >= 4, 'paginated initial and final reads were not exercised');
});

for (const patch of [{ unit_amount: 999 }, { tax_behavior: 'exclusive' }, { livemode: false }, { active: false },
  { billing_scheme: 'tiered' }, { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } },
  { transform_quantity: { divide_by: 2 } }]) {
  test(`existing price mismatch prevents every write: ${JSON.stringify(patch)}`, async () => {
    const f = fixture(); await f.run(); Object.assign(f.prices[1], patch); f.products.shift(); f.prices.shift(); f.writes.length = 0;
    await assert.rejects(f.run()); assert.equal(f.writes.length, 0);
  });
}

for (const corruption of ['duplicate-product', 'stale-product', 'unowned-name', 'unowned-price', 'unowned-webhook', 'unowned-portal']) {
  test(`ownership ambiguity refuses before writes: ${corruption}`, async () => {
    const f = fixture(); await f.run(); f.writes.length = 0;
    if (corruption === 'duplicate-product') f.products.push({ ...f.products[0], id: 'prod_extra' });
    if (corruption === 'stale-product') f.products[0].metadata.xenoCatalogDigest = 'old';
    if (corruption === 'unowned-name') f.products.unshift({ object: 'product', id: 'prod_foreign', name: f.products[0].name, metadata: {} });
    if (corruption === 'unowned-price') f.prices.unshift({ object: 'price', id: 'price_foreign', product: f.products[0].id, metadata: {} });
    if (corruption === 'unowned-webhook') f.webhooks.push({ object: 'webhook_endpoint', id: 'we_foreign', url: WEBHOOK_URL, metadata: {} });
    if (corruption === 'unowned-portal') f.portals.unshift({ object: 'billing_portal.configuration', id: 'bpc_foreign', default_return_url: f.portals[0].default_return_url, metadata: {} });
    await assert.rejects(f.run()); assert.equal(f.writes.length, 0);
  });
}

test('lost catalog create response retains provider state and retry reconciles it', async () => {
  const f = fixture(); const original = f.stripe.prices.create;
  f.stripe.prices.create = async (...args) => { const value = await original(...args); throw new Error(`provider ${value.id} secret`); };
  await assert.rejects(f.run()); assert.equal(f.products.length, 1); assert.equal(f.prices.length, 1);
  f.stripe.prices.create = original; const result = await f.run();
  assert.equal(f.products.length, 2); assert.equal(f.prices.length, 2); assert.equal(result.status, 'VERIFIED');
});

test('lost portal create response retains provider state and retry reconciles it', async () => {
  const f = fixture(); const original = f.stripe.billingPortal.configurations.create;
  f.stripe.billingPortal.configurations.create = async (...args) => { const value = await original(...args); throw new Error(`provider ${value.id} secret`); };
  await assert.rejects(f.run()); assert.equal(f.portals.length, 1);
  f.stripe.billingPortal.configurations.create = original; const count = f.writes.length;
  const result = await f.run(); assert.equal(f.portals.length, 1); assert.equal(f.writes.length, count);
  assert.equal(result.status, 'VERIFIED');
});

test('malformed or stuck pagination refuses before writes', async () => {
  for (const page of [{ data: [], has_more: true }, { data: [] }, { data: [{ id: 'prod_repeat' }], has_more: true }]) {
    const f = fixture(); f.stripe.products.list = async () => page;
    await assert.rejects(f.run()); assert.equal(f.writes.length, 0);
  }
});

test('webhook stage requires completed catalog and portal before reserving secret custody', async () => {
  const f = fixture(), sink = secretFixture();
  await assert.rejects(f.run({ stage: 'webhook', secretSink: sink }));
  assert.deepEqual(sink.calls, []); assert.equal(f.writes.length, 0);
});

test('webhook stage creates exact derived endpoint and keeps signing secret out of result', async () => {
  const f = fixture(); await f.run(); f.writes.length = 0;
  const sink = secretFixture(); const result = await f.run({ stage: 'webhook', secretSink: sink });
  assert.deepEqual(sink.calls, ['reserve', 'commit']); assert.equal(result.created.webhooks, 1);
  assert.doesNotMatch(JSON.stringify(result), /whsec_/); assert.equal(sink.receipt().webhookSecret, 'whsec_fixture');
  const write = f.writes.find(([kind]) => kind === 'webhook');
  assert.deepEqual(write[1].enabled_events, deriveBillingEvents(source)); assert.equal(write[1].connect, false);
  assert.equal(write[1].api_version, API_VERSION); assert.equal(write[1].url, WEBHOOK_URL);
  const count = f.writes.length; const again = await f.run({ stage: 'webhook', secretSink: sink });
  assert.equal(f.writes.length, count); assert.equal(again.created.webhooks, 0);
});

test('lost webhook response is retryable only through the same recent idempotency key', async () => {
  const f = fixture(); await f.run(); const sink = secretFixture(); const original = f.stripe.webhookEndpoints.create;
  let first = true, persisted;
  f.stripe.webhookEndpoints.create = async (...args) => {
    if (first) { first = false; persisted = await original(...args); throw new Error('lost response'); }
    f.writes.push(['webhook-replay', args[0], args[1]]); return persisted;
  };
  await assert.rejects(f.run({ stage: 'webhook', secretSink: sink, now: () => 1000 }));
  const result = await f.run({ stage: 'webhook', secretSink: sink, now: () => 2000 });
  assert.equal(result.webhookEndpointId, f.webhooks[0].id); assert.equal(sink.receipt().status, 'complete');
  const webhookKeys = f.writes.filter(row => row[0].startsWith('webhook')).map(row => row[2].idempotencyKey);
  assert.equal(new Set(webhookKeys).size, 1);
});

test('stale pending webhook receipt refuses another provider write', async () => {
  const f = fixture(); await f.run(); const plan = liveSetupPlan(catalog, source);
  const params = f.stripe.webhookEndpoints.create;
  await params({ url: plan.webhook.url, enabled_events: plan.webhook.events, api_version: API_VERSION, connect: false,
    description: 'XENO production billing lifecycle', metadata: { xenoLiveSetup: 'platform-live-billing-v1', xenoAccount: LIVE_ACCOUNT, xenoCatalogDigest: plan.catalogDigest } }, {});
  f.writes.length = 0;
  const sink = secretFixture({ status: 'pending', account: LIVE_ACCOUNT, catalogDigest: plan.catalogDigest, startedAt: 0 });
  await assert.rejects(f.run({ stage: 'webhook', secretSink: sink, now: () => 3_700_001 })); assert.equal(f.writes.length, 0);
});

test('wrong endpoint coverage or mode blocks the webhook stage without writes', async () => {
  const f = fixture(); await f.run(); const sink = secretFixture();
  await f.run({ stage: 'webhook', secretSink: sink }); f.writes.length = 0; f.webhooks[0].enabled_events.pop();
  await assert.rejects(f.run({ stage: 'webhook', secretSink: sink })); assert.equal(f.writes.length, 0);
});

test('POSIX-only secret sink refuses Windows before touching a file', () => {
  assert.throws(() => createPosixSecretSink('C:\\secure\\receipt.json', { platform: 'win32' }), /owner_only/);
});

test('CLI defaults to offline plan and never prints a supplied secret', () => {
  const plan = spawnSync(process.execPath, ['scripts/stripe-live-setup.mjs'], { encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, STRIPE_SECRET_KEY: 'sk_live_SENSITIVE', NODE_OPTIONS: '' } });
  assert.equal(plan.status, 0, plan.stderr); assert.equal(JSON.parse(plan.stdout).status, 'UNEXECUTED');
  assert.doesNotMatch(plan.stdout + plan.stderr, /SENSITIVE/);
  const refused = spawnSync(process.execPath, ['scripts/stripe-live-setup.mjs', '--bogus'], { encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, STRIPE_SECRET_KEY: 'sk_live_SENSITIVE', NODE_OPTIONS: '' } });
  assert.equal(refused.status, 1); assert.match(refused.stderr, /secrets suppressed/); assert.doesNotMatch(refused.stdout + refused.stderr, /SENSITIVE/);
});

test('CLI and runtime pin the same Stripe API version', () => {
  assert.ok(readFileSync(new URL('../src/server/services/billingService.js', import.meta.url), 'utf8').includes(`apiVersion: '${API_VERSION}'`));
  assert.match(readFileSync(new URL('./stripe-live-setup.mjs', import.meta.url), 'utf8'), /apiVersion: API_VERSION/);
});
