// Synthetic boundaries only. The real catalog, checkout producers and validator run.
import assert from 'node:assert/strict';
import { register } from 'node:module';

const scenario = process.argv[2];
const fixture = globalThis.__checkoutPriceFixture = {
  log: [], gets: [], sql: [], customers: [], sessions: [], portalSessions: [], consumed: [],
  invalidConsent: false, mapped: false, mutation: {}, response: 'valid',
  account: { object: 'account', id: 'acct_fixture' },
};
const sentinel = 'PROVIDER_SECRET_SENTINEL';
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const hooks = `
  export function resolve(s, c, next) {
    if (s === 'stripe') return { url: 'fixture:stripe', shortCircuit: true };
    return next(s, c);
  }
  export function load(url, c, next) {
    if (url === 'fixture:stripe') return { format: 'module', shortCircuit: true,
      source: 'export default globalThis.__checkoutPriceFixture.Stripe;' };
    if (url.endsWith('/services/checkoutConsent.js')) return { format: 'module', shortCircuit: true,
      source: 'export const requireCheckoutConsent = (...args) => globalThis.__checkoutPriceFixture.consent(...args); export const consumeConsent = (...args) => globalThis.__checkoutPriceFixture.consume(...args);' };
    return next(url, c);
  }
`;
register('data:text/javascript,' + encodeURIComponent(hooks), import.meta.url);
fixture.Stripe = class {
  accounts = { retrieveCurrent: async (params, options) => {
    fixture.log.push('account');
    // Outcomes only, never arity — see billingAccountBinding.js for why.
    if (params && Object.keys(params).length) throw new Error('own-account read must not carry params');
    if (options?.maxNetworkRetries !== 0) throw new Error('own-account read must carry the retry override');
    if (fixture.account === 'throw') throw new Error(sentinel);
    return fixture.account;
  } };
  prices = { retrieve: async (id, params, options) => {
    fixture.log.push('price');
    fixture.gets.push({ id, params, options });
    if (fixture.response === 'throw') throw new Error(sentinel);
    if (fixture.response === 'null') return null;
    if (fixture.response === 'hang') return new Promise(() => {});
    if (fixture.response === 'late') return new Promise((_, reject) => nativeSetTimeout(() => reject(new Error(sentinel)), 50));
    const item = fixture.items.find(item => item.priceId === id);
    assert.ok(item, 'service looked up a price outside the configured catalog');
    return {
      id, active: true, livemode: false, unit_amount: Math.round(item.price * 100), currency: item.currency,
      type: item.kind === 'subscription' ? 'recurring' : 'one_time',
      recurring: item.kind === 'subscription' ? { interval: item.interval, interval_count: 1, usage_type: 'licensed' } : null,
      billing_scheme: 'per_unit', custom_unit_amount: null, transform_quantity: null,
      ...fixture.mutation,
    };
  } };
  customers = { create: async params => {
    fixture.log.push('customer'); fixture.customers.push(params); return { id: 'cus_fixture' };
  } };
  checkout = { sessions: { create: async (params, options) => {
    fixture.log.push('checkout'); fixture.sessions.push({ params, options });
    return { id: 'cs_fixture', url: 'https://checkout.example/session' };
  } } };
  billingPortal = { sessions: { create: async params => {
    fixture.log.push('portal'); fixture.portalSessions.push(params);
    return { id: 'bps_fixture', url: 'https://billing.example/session' };
  } } };
};
fixture.consent = async (_pool, owner, item, consent) => {
  fixture.log.push('consent');
  assert.equal(owner, 'owner'); assert.ok(item); assert.equal(consent, 'consent_fixture');
  if (fixture.invalidConsent) throw Object.assign(new Error('consent required'), { status: 400 });
  return consent;
};
fixture.consume = async (_pool, consent, session) => {
  fixture.log.push('consume'); fixture.consumed.push({ consent, session });
};
const pool = { query: async sql => {
  fixture.log.push('sql'); fixture.sql.push(sql);
  if (sql.includes('INSERT INTO billing_customers')) fixture.mapped = true;
  return { rows: sql.includes('SELECT stripe_customer_id') && fixture.mapped ? [{ stripe_customer_id: 'cus_fixture' }] : [] };
} };
pool.connect = async () => ({ release() {}, query: async sql => {
  fixture.log.push('binding');
  if (sql.startsWith('SELECT account_id')) return { rows: [{ account_id: 'acct_fixture', mode: process.env.STRIPE_EXPECTED_MODE }] };
  return { rows: [] };
} });
const billing = await import('../../src/server/services/billingService.js');
fixture.items = billing.getInternalCatalog();
const user = { id: 'owner', email: 'fixture@example.test' };
const options = { origin: 'https://xenostudio.ai', consentId: 'consent_fixture' };
function purchase(id) {
  return id.startsWith('team_')
    ? billing.createWorkspaceSeatCheckout(pool, user, { ...options, workspaceId: 'ws_fixture', seats: 3, itemId: id })
    : billing.createCheckout(pool, user, id, options);
}
function reset() {
  for (const key of ['log', 'gets', 'sql', 'customers', 'sessions', 'portalSessions', 'consumed']) fixture[key] = [];
  fixture.mutation = {}; fixture.response = 'valid'; fixture.mapped = false; fixture.invalidConsent = false;
}
async function refused(id) {
  await assert.rejects(purchase(id), error => {
    assert.equal(error.status, 503);
    assert.equal(error.code, scenario === 'missing' ? 'billing_account_unavailable' : 'billing_price_unavailable');
    assert.equal(error.message, scenario === 'missing' ? 'Billing account is temporarily unavailable. Please try again later.' : 'This purchase is temporarily unavailable. Please try again later.');
    assert.ok(!JSON.stringify(error).includes(sentinel));
    assert.equal(error.cause, undefined);
    return true;
  });
  for (const key of ['sql', 'customers', 'sessions', 'consumed']) assert.equal(fixture[key].length, 0, key);
}

if (scenario === 'valid') {
  for (const id of ['credits_small', 'pro_monthly', 'pro_annual', 'team_seat', 'team_annual']) {
    reset();
    assert.deepEqual(await purchase(id), { id: 'cs_fixture', url: 'https://checkout.example/session' });
    assert.deepEqual(fixture.log.slice(0, 3), ['consent', 'account', 'price']);
    assert.ok(fixture.log.indexOf('binding') > fixture.log.indexOf('price'));
    assert.equal(fixture.gets.length, 1);
    assert.deepEqual(fixture.gets[0].options, { timeout: 10000, maxNetworkRetries: 0 });
    const item = fixture.items.find(item => item.id === id);
    assert.equal(fixture.gets[0].id, item.priceId);
    assert.equal(fixture.customers.length, 1);
    assert.equal(fixture.sessions.length, 1);
    const { params, options: request } = fixture.sessions[0];
    assert.deepEqual(params.line_items, [{ price: item.priceId, quantity: item.perSeat ? 3 : 1 }]);
    assert.equal(params.mode, item.kind === 'subscription' ? 'subscription' : 'payment');
    assert.equal(params.metadata.xenoUserId, user.id);
    assert.equal(params.metadata.itemId, id);
    assert.equal(params.metadata.xenoConsentId, options.consentId);
    if (item.perSeat) {
      assert.equal(params.metadata.xenoWorkspaceId, 'ws_fixture');
      assert.equal(params.subscription_data.metadata.xenoWorkspaceId, 'ws_fixture');
      assert.equal(params.metadata.seats, '3');
    }
    assert.equal(new URL(params.success_url).origin, options.origin);
    assert.equal(new URL(params.cancel_url).origin, options.origin);
    // Merchant of record. The withdrawal notice is a statement about OUR contract
    // with the buyer, so it may only ride on a session where we are the seller —
    // Stripe's Managed Payments default makes Stripe the seller and rejects the
    // notice outright (live, 2026-09-11). Both halves, together, on every item.
    assert.deepEqual(params.managed_payments, { enabled: false }, `${id}: we must be the merchant of record`);
    assert.match(params.custom_text?.terms_of_service_acceptance?.message ?? '', /right of withdrawal/, `${id}: withdrawal notice`);
    assert.deepEqual(request, { idempotencyKey: 'xeno-checkout:consent_fixture' });
    assert.deepEqual(fixture.consumed, [{ consent: 'consent_fixture', session: 'cs_fixture' }]);
  }
} else if (scenario === 'reject') {
  for (const id of ['pro_monthly', 'team_seat', 'credits_small']) {
    for (const mutation of [
      { active: false }, { active: undefined }, { currency: 'usd' }, { unit_amount: 1 },
      { livemode: true }, { livemode: undefined },
      { billing_scheme: 'tiered' }, { custom_unit_amount: { minimum: 1 } },
      { transform_quantity: { divide_by: 5, round: 'up' } },
      { type: 'unknown' }, { recurring: { interval: 'month', interval_count: 3, usage_type: 'licensed' } },
      { recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } },
    ]) {
      reset(); fixture.mutation = mutation; await refused(id);
      assert.deepEqual(fixture.log, ['consent', 'account', 'price']);
    }
    for (const response of ['throw', 'null']) {
      reset(); fixture.response = response; await refused(id);
    }
  }
} else if (scenario === 'cache') {
  await billing.getPublicCatalog(); // Prime the real display-price cache.
  reset(); fixture.mutation = { active: false };
  await refused('pro_monthly');
  assert.equal(fixture.gets.length, 1);
  reset(); await purchase('pro_monthly');
  fixture.gets = []; fixture.sql = []; fixture.customers = []; fixture.sessions = []; fixture.consumed = [];
  fixture.response = 'throw'; await refused('pro_monthly');
  assert.equal(fixture.gets.length, 1, 'a prior successful purchase cannot authorize another attempt');
} else if (scenario === 'consent') {
  for (const id of ['pro_monthly', 'team_seat']) {
    reset(); fixture.invalidConsent = true;
    await assert.rejects(purchase(id), { status: 400 });
    assert.deepEqual(fixture.log, ['consent']);
  }
} else if (scenario === 'missing') {
  assert.equal(billing.isEnabled(), false);
  await refused('pro_monthly');
  assert.deepEqual(fixture.log, ['consent']);
} else if (scenario === 'account') {
  for (const value of [null, {}, { object: 'account', id: 'acct_wrong' }, 'throw']) {
    fixture.account = value;
    for (const operation of [() => purchase('pro_monthly'), () => purchase('team_seat'),
      () => billing.createPortal(pool, user, options), () => billing.getCheckoutStatus(pool, user, 'cs_test_fixture')]) {
      reset();
      await assert.rejects(operation(), { status: 503, code: 'billing_account_unavailable' });
      assert.equal(fixture.log.filter(value => value === 'account').length, 1);
      assert.equal(fixture.log.includes('binding'), false);
      for (const key of ['gets', 'sql', 'customers', 'sessions', 'portalSessions', 'consumed']) assert.equal(fixture[key].length, 0, key);
    }
  }
} else if (scenario === 'portal') {
  fixture.mapped = true;
  assert.deepEqual(await billing.createPortal(pool, user, options), { url: 'https://billing.example/session' });
  assert.deepEqual(fixture.portalSessions, [{
    customer: 'cus_fixture', return_url: 'https://xenostudio.ai/overview/billing', configuration: 'bpc_fixture',
  }]);
  reset(); fixture.mapped = true; delete process.env.STRIPE_BILLING_PORTAL_CONFIGURATION;
  await assert.rejects(billing.createPortal(pool, user, options), { status: 503, code: 'billing_account_unavailable' });
  assert.deepEqual(fixture.portalSessions, []);
} else if (scenario === 'offers') {
  for (const id of ['everything_monthly', 'team_monthly']) {
    reset();
    await assert.rejects(billing.createCheckout(pool, user, id, options), { status: 409, code: 'price_not_offered' });
    assert.deepEqual(fixture.log, []);
  }
  reset();
  await assert.rejects(billing.createCheckout(pool, user, 'team_seat', options), { status: 400, code: 'workspace_required' });
  assert.deepEqual(fixture.log, []);
  process.env.XENO_FOUNDING_PRICING = 'closed';
  await assert.rejects(purchase('pro_monthly'), { status: 409, code: 'price_not_offered' });
  assert.deepEqual(fixture.log, []);
  await purchase('everything_monthly');
  assert.equal(fixture.sessions.length, 1);
} else if (scenario === 'deadline') {
  const unhandled = [];
  process.on('unhandledRejection', error => unhandled.push(error));
  let deadlines = 0, cleared = 0;
  globalThis.setTimeout = (fn, ms, ...args) => {
    assert.equal(ms, 10000); deadlines++;
    return nativeSetTimeout(fn, 10, ...args);
  };
  globalThis.clearTimeout = timer => { cleared++; nativeClearTimeout(timer); };
  try {
    for (const response of ['hang', 'late']) {
      reset(); fixture.response = response;
      await refused('pro_monthly');
    }
    await new Promise(resolve => nativeSetTimeout(resolve, 80));
    assert.equal(deadlines, 4); assert.equal(cleared, 4);
    assert.deepEqual(unhandled, []);
    assert.equal(fixture.sessions.length, 0);
  } finally {
    globalThis.setTimeout = nativeSetTimeout; globalThis.clearTimeout = nativeClearTimeout;
  }
} else throw new Error('unknown scenario');
console.log(`PASS ${scenario}`);
