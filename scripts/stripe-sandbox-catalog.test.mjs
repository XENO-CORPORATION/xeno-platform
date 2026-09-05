import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { API_VERSION, SANDBOX_ACCOUNT, catalogPlan, validateSandbox, provisionCatalog } from './lib/stripe-sandbox-catalog.mjs';

const env = { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_EXPECTED_ACCOUNT_ID: SANDBOX_ACCOUNT, STRIPE_EXPECTED_MODE: 'test' };
const catalog = [
  { id: 'pack', kind: 'credits', label: 'Pack', credits: 1000, price: 10, currency: 'eur', priceEnv: 'STRIPE_PRICE_PACK' },
  { id: 'plan', kind: 'subscription', label: 'Plan', credits: 0, price: 24, currency: 'eur', interval: 'month', priceEnv: 'STRIPE_PRICE_PLAN' },
];
function fixture() {
  const products = [], prices = [], writes = [], reads = [];
  const page = (rows, args) => {
    const start = args.starting_after ? rows.findIndex(row => row.id === args.starting_after) + 1 : 0;
    return { data: rows.slice(start, start + 1), has_more: start + 1 < rows.length };
  };
  const stripe = {
    accounts: { retrieve: async (...args) => { assert.equal(args.length, 0); reads.push('account'); return { object: 'account', id: SANDBOX_ACCOUNT }; } },
    products: {
      list: async args => { reads.push('products'); return page(products, args); },
      create: async (args, options) => {
        writes.push(['product', args, options]);
        const obj = { ...args, id: `prod_${products.length + 1}`, object: 'product', livemode: false };
        products.push(obj); return obj;
      },
    },
    prices: {
      list: async args => { reads.push('prices'); return page(prices, args); },
      create: async (args, options) => {
        writes.push(['price', args, options]);
        const obj = { ...args, id: `price_${prices.length + 1}`, object: 'price', active: true, livemode: false,
          type: args.recurring ? 'recurring' : 'one_time', recurring: args.recurring || null,
          custom_unit_amount: null, transform_quantity: null };
        prices.push(obj); return obj;
      },
    },
  };
  return { stripe, products, prices, writes, reads, run: (items = catalog, target = env) => provisionCatalog({ stripe, catalog: items, env: target }) };
}

test('plan excludes legacy, preserves minor amounts and hashes the immutable tuple', () => {
  const input = [...catalog, { ...catalog[0], legacy: true }];
  const plan = catalogPlan(input);
  assert.equal(plan.length, 2); assert.equal(plan[0].unit_amount, 1000);
  assert.deepEqual(plan, catalogPlan(input));
  assert.notEqual(plan[1].digest, catalogPlan([catalog[0], { ...catalog[1], price: 25 }])[1].digest);
});
for (const patch of [ { price: -1 }, { price: NaN }, { price: 0.001 }, { price: 1e20 },
  { currency: 'usd' }, { kind: 'other' }, { credits: -1 }, { credits: 0 }, { interval: 'month' },
  { id: '../bad' }, { priceEnv: 'OTHER' }, { label: '' }, { perSeat: 'yes' }, { legacy: 'true' } ]) {
  test(`catalog refuses malformed ${JSON.stringify(patch)}`, async () => {
    const f = fixture(); await assert.rejects(f.run([{ ...catalog[0], ...patch }])); assert.equal(f.reads.length, 0);
  });
}
test('catalog refuses duplicate ID/env and invalid subscription terms', () => {
  assert.throws(() => catalogPlan([catalog[0], catalog[0]]));
  assert.throws(() => catalogPlan([catalog[0], { ...catalog[1], priceEnv: catalog[0].priceEnv }]));
  for (const patch of [{ interval: 'week' }, { credits: 10 }]) assert.throws(() => catalogPlan([{ ...catalog[1], ...patch }]));
  assert.throws(() => catalogPlan([]));
});
for (const patch of [ { STRIPE_SECRET_KEY: '' }, { STRIPE_SECRET_KEY: 'sk_live_fixture' },
  { STRIPE_EXPECTED_ACCOUNT_ID: 'acct_other' }, { STRIPE_EXPECTED_MODE: 'live' } ]) {
  test(`target refusal ${Object.keys(patch)[0]} ${Object.values(patch)[0]}`, async () => {
    const f = fixture(); await assert.rejects(f.run(catalog, { ...env, ...patch })); assert.equal(f.reads.length, 0);
  });
}
test('restricted test keys allowed, account response gates all catalog calls', async () => {
  validateSandbox({ ...env, STRIPE_SECRET_KEY: 'rk_test_fixture' });
  const f = fixture(); f.stripe.accounts.retrieve = async () => ({ object: 'account', id: 'acct_other' });
  await assert.rejects(f.run()); assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
});
test('create all, persist inclusive agreement, paginate and rerun without writes', async () => {
  const f = fixture();
  const first = await f.run(); assert.deepEqual(first.created, { products: 2, prices: 2 });
  assert.equal(first.status, 'verified-catalog-only'); assert.equal(f.reads[0], 'account');
  const again = await f.run(); assert.deepEqual(again.created, { products: 0, prices: 0 });
  assert.deepEqual(first.prices, again.prices); assert.equal(f.writes.length, 4);
  assert.equal(new Set(f.writes.map(row => row[2].idempotencyKey)).size, 4);
});
for (const patch of [{ unit_amount: 999 }, { tax_behavior: 'exclusive' }, { livemode: true },
  { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } },
  { transform_quantity: { divide_by: 2 } }, { active: false }, { product: 'prod_other' }]) {
  test(`later existing price mismatch prevents all earlier creates ${JSON.stringify(patch)}`, async () => {
    const f = fixture(); await f.run();
    f.products.shift(); f.prices.shift(); Object.assign(f.prices[0], patch); f.writes.length = 0;
    await assert.rejects(f.run()); assert.equal(f.writes.length, 0);
  });
}
test('changed tuple refuses existing ownership, including credits/seat meaning', async () => {
  const f = fixture(); await f.run(); f.writes.length = 0;
  for (const patch of [{ price: 11 }, { credits: 1100 }, { label: 'Changed' }]) {
    await assert.rejects(f.run([{ ...catalog[0], ...patch }, catalog[1]]));
  }
  await assert.rejects(f.run([catalog[0], { ...catalog[1], perSeat: true }]));
  assert.equal(f.writes.length, 0);
});
for (const corruption of ['duplicate-product', 'duplicate-price', 'orphan-price', 'unknown-owner', 'bad-product']) {
  test(`ownership refuses ${corruption}`, async () => {
    const f = fixture(); await f.run(); f.writes.length = 0;
    if (corruption === 'duplicate-product') f.products.push({ ...f.products[0], id: 'prod_extra' });
    if (corruption === 'duplicate-price') f.prices.push({ ...f.prices[0], id: 'price_extra' });
    if (corruption === 'orphan-price') f.products.shift();
    if (corruption === 'unknown-owner') f.products[0].metadata.xenoCatalogId = 'unknown';
    if (corruption === 'bad-product') f.products[0].livemode = true;
    await assert.rejects(f.run()); assert.equal(f.writes.length, 0);
  });
}
test('unowned resources untouched', async () => {
  const f = fixture(); const foreign = { id: 'prod_foreign', metadata: {} }; f.products.push(foreign);
  await f.run(); assert.deepEqual(f.products[0], foreign);
});
test('pagination corruption refuses before writes', async () => {
  for (const result of [{ data: [], has_more: true }, { data: [] }, { data: [{ id: 'prod_repeat' }], has_more: true }]) {
    const f = fixture(); f.stripe.products.list = async () => result;
    await assert.rejects(f.run()); assert.equal(f.writes.length, 0);
  }
});
test('lost create response stops then retry reconciles persisted objects', async () => {
  const f = fixture(); const create = f.stripe.prices.create;
  f.stripe.prices.create = async (...args) => { await create(...args); throw new Error('provider secret payload'); };
  await assert.rejects(f.run()); assert.equal(f.writes.length, 2);
  f.stripe.prices.create = create;
  const result = await f.run(); assert.deepEqual(result.created, { products: 1, prices: 1 });
  assert.equal(f.products.length, 2); assert.equal(f.prices.length, 2);
});
test('malformed create response stops immediately', async () => {
  const f = fixture(); f.stripe.products.create = async () => ({ id: 'prod_invalid' });
  await assert.rejects(f.run()); assert.equal(f.prices.length, 0);
});
test('idempotency keys stable for identical creates across fresh runs', async () => {
  const a = fixture(), b = fixture(); await a.run(); await b.run();
  assert.deepEqual(a.writes.map(row => row[2]), b.writes.map(row => row[2]));
});
test('API version matches runtime and CLI uses pinned SDK option', () => {
  assert.ok(readFileSync(new URL('../src/server/services/billingService.js', import.meta.url), 'utf8').includes(`apiVersion: '${API_VERSION}'`));
  assert.match(readFileSync(new URL('./stripe-sandbox-catalog.mjs', import.meta.url), 'utf8'), /apiVersion: API_VERSION/);
});
test('CLI rejects unsupported args and live key without echoing it', () => {
  for (const args of [['--bogus'], ['--confirm']]) {
    const child = spawnSync(process.execPath, ['scripts/stripe-sandbox-catalog.mjs', ...args], {
      encoding: 'utf8', env: { ...process.env, ...env, STRIPE_SECRET_KEY: 'sk_live_SENSITIVEFIXTURE', NODE_OPTIONS: '' }, timeout: 20_000 });
    assert.equal(child.status, 1); assert.match(child.stderr, /Provider details suppressed/);
    assert.doesNotMatch(child.stdout + child.stderr, /SENSITIVEFIXTURE/);
  }
});
