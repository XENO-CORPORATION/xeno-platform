/**
 * THE PRICE ON THE PAGE MUST BE THE PRICE ON THE CARD.
 *
 * Since the 2026-08-24 download gate a plan is what gets you the software, so
 * "billing is misconfigured" stopped being a revenue problem and became a
 * product-does-not-exist problem.
 *
 * 🔴 The failure worth catching is the QUIET one. `getPublicCatalog()` overlays
 * the live Stripe amount onto the static catalogue so advertised always equals
 * charged. That is correct, and it means a price env pointing at the WRONG
 * Stripe Price does not error and does not visibly mismatch — it silently
 * re-prices the product, consistently, at a number nobody chose. The page and
 * the charge agree perfectly; they just both disagree with the decision.
 *
 * So the comparison has to be against the CATALOGUE (the human record), and it
 * is a pure function precisely so these cases can be tested without conjuring
 * an archived price or a recurring credit pack in a real Stripe dashboard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { priceIssues } from '../src/server/utils/priceAgreement.js';
import { spawnSync } from 'node:child_process';
import { verifyBillingWebhooks } from '../src/server/utils/billingWebhookVerification.js';

const PLAN = { id: 'everything_monthly', kind: 'subscription', price: 39, currency: 'eur', interval: 'month' };
const PACK = { id: 'credits_small', kind: 'credits', price: 10, currency: 'eur' };

const webhookSource = readFileSync('src/server/services/billingService.js', 'utf8');
const endpoint = { id: 'we_test', url: 'https://xenostudio.ai/api/billing/webhook', status: 'enabled', livemode: true, enabled_events: ['*'] };
const verifyWebhooks = (list, extra = {}) => verifyBillingWebhooks({
  stripe: { webhookEndpoints: { list } }, source: webhookSource, expectedUrl: endpoint.url, liveMode: true, ...extra,
});

test('webhook qualification requires the exact enabled application endpoint and mode', async () => {
  const valid = await verifyWebhooks(async () => ({ data: [endpoint], has_more: false }));
  assert.ok(valid.eventCount >= 5);
  for (const replacement of [
    { ...endpoint, status: 'disabled' }, { ...endpoint, livemode: false },
    { ...endpoint, url: 'https://another.example/api/billing/webhook' },
    { ...endpoint, enabled_events: ['checkout.session.completed'] },
  ]) await assert.rejects(verifyWebhooks(async () => ({ data: [replacement], has_more: false })));
});

test('webhook qualification follows pagination instead of accepting the first page', async () => {
  const calls = [];
  const result = await verifyWebhooks(async options => {
    calls.push(options);
    return options.starting_after ? { data: [endpoint], has_more: false }
      : { data: [{ ...endpoint, id: 'we_other', url: 'https://other.example/hook' }], has_more: true };
  });
  assert.equal(result.endpointCount, 1);
  assert.equal(calls[1].starting_after, 'we_other');
});

test('unknown webhook state, derivation failures and stuck pagination refuse readiness', async () => {
  await assert.rejects(verifyWebhooks(async () => { throw new Error('network unavailable'); }));
  await assert.rejects(verifyWebhooks(async () => ({ data: [], has_more: false })));
  await assert.rejects(verifyWebhooks(async () => ({ data: [endpoint] })));
  await assert.rejects(verifyWebhooks(async () => ({ data: [endpoint], has_more: true })));
  await assert.rejects(verifyWebhooks(async () => ({ data: [endpoint], has_more: false }), { source: '' }));
  await assert.rejects(verifyWebhooks(async () => ({ data: [endpoint], has_more: false }), { expectedUrl: 'http://xenostudio.ai/api/billing/webhook' }));
});

test('CLI routes unverifiable webhook coverage to the failing exit path', () => {
  assert.match(script, /warn\('Could not verify billing webhook coverage/);
  assert.match(script, /if \(problems\)[\s\S]*process.exit\(1\)/);
});

const stripePrice = (o = {}) => ({
  active: true, livemode: false, unit_amount: 3900, currency: 'eur', type: 'recurring',
  billing_scheme: 'per_unit', custom_unit_amount: null, transform_quantity: null,
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, ...o,
});

test('annual and per-seat prices preserve one licensed unit per advertised term', () => {
  assert.deepEqual(priceIssues({ ...PLAN, interval: 'year' }, stripePrice({
    recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' },
  })), []);
  assert.deepEqual(priceIssues({ ...PLAN, perSeat: true }, stripePrice()), []);
});

const shapeFailures = [
  ['billing_scheme', { billing_scheme: 'tiered' }],
  ['billing_scheme', { billing_scheme: undefined }],
  ['custom_unit_amount', { custom_unit_amount: { minimum: 100 } }],
  ['transform_quantity', { transform_quantity: { divide_by: 5, round: 'up' } }],
  ['explicitly active', { active: undefined }],
  ['explicitly active', { active: 'true' }],
  ...[3, 0, undefined, '1'].map(interval_count => ['interval_count', {
    recurring: { ...stripePrice().recurring, interval_count },
  }]),
  ...['metered', undefined].map(usage_type => ['usage_type', {
    recurring: { ...stripePrice().recurring, usage_type },
  }]),
];
for (const [diagnostic, mutation] of shapeFailures) {
  test(`refuses isolated price-shape mismatch: ${JSON.stringify(mutation)}`, () => {
    assert.ok(priceIssues(PLAN, stripePrice(mutation)).some(issue => issue.includes(diagnostic)));
  });
}

test('one-time credit packs refuse contradictory or unknown recurring state', () => {
  for (const recurring of [stripePrice().recurring, undefined]) {
    assert.ok(priceIssues(PACK, stripePrice({ unit_amount: 1000, type: 'one_time', recurring }))
      .some(issue => issue.includes('recurring=null')));
  }
});

// Execute the actual CLI with only the catalog/provider import boundaries replaced.
// The real validator and webhook verifier run; synthetic env never inherits keys.
const readyAccount = { object: 'account', id: 'acct_fixture', charges_enabled: true,
  payouts_enabled: true, details_submitted: true,
  requirements: { currently_due: [], past_due: [], pending_verification: [], disabled_reason: null } };
const readyPortal = { object: 'billing_portal.configuration', id: 'bpc_fixture', active: true, livemode: true,
  default_return_url: 'https://xenostudio.ai/overview/billing', features: {
    customer_update: { enabled: true, allowed_updates: ['address', 'email', 'name', 'tax_id'] },
    invoice_history: { enabled: true }, payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
    subscription_update: { enabled: false },
  } };
function runPreflight(price, throwLookup = false, options = {}) {
  const sentinel = 'SYNTHETIC_SECRET_MUST_NOT_LEAK';
  const catalogSource = `export const getInternalCatalog = () => ${JSON.stringify([
    { ...PLAN, priceId: 'price_fixture', priceEnv: 'FIXTURE_PRICE' },
  ])};`;
  const stripeSource = `export default class Stripe {
    constructor(key, options) {
      if (options.apiVersion !== '2025-02-24.acacia') throw new Error('API version must match runtime');
    }
    accounts = { retrieve: async (...args) => {
      console.log('FIXTURE_ACCOUNT_READ');
      if (args.length) throw new Error('must retrieve authenticated account');
      ${options.throwAccount ? `throw new Error(${JSON.stringify(sentinel)});`
        : `return ${JSON.stringify(options.account === undefined ? readyAccount : options.account)};`}
    } };
    prices = { retrieve: async () => { console.log('FIXTURE_PRICE_READ'); ${throwLookup
      ? `throw new Error(${JSON.stringify(sentinel)});`
      : `return ${JSON.stringify(price)};`} } };
    billingPortal = { configurations: { retrieve: async () => { console.log('FIXTURE_PORTAL_READ'); ${options.throwPortal
      ? `throw new Error(${JSON.stringify(sentinel)});`
      : `return ${JSON.stringify(options.portal === undefined ? readyPortal : options.portal)};`} } } };
    webhookEndpoints = { list: async () => { console.log('FIXTURE_WEBHOOK_READ'); return ({ data: [${JSON.stringify({ ...endpoint, livemode: options.env?.STRIPE_EXPECTED_MODE === 'live' })}], has_more: false }); } };
  }`;
  const hooks = `
      export function resolve(specifier, context, next) {
        if (specifier === 'stripe') return { url: 'fixture:stripe', shortCircuit: true };
        return next(specifier, context);
      }
      export function load(url, context, next) {
        if (url === 'fixture:stripe') return { format: 'module', source: ${JSON.stringify(stripeSource)}, shortCircuit: true };
        if (url.endsWith('/services/billingService.js')) return { format: 'module', source: ${JSON.stringify(catalogSource)}, shortCircuit: true };
        return next(url, context);
      }
  `;
  const runner = `
    import { register } from 'node:module';
    register(${JSON.stringify('data:text/javascript,' + encodeURIComponent(hooks))}, import.meta.url);
    await import('./scripts/billing-preflight.mjs');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', runner], {
    encoding: 'utf8', timeout: 15000,
    env: { SYSTEMROOT: process.env.SYSTEMROOT || '', STRIPE_SECRET_KEY: 'sk_test_fixture',
      STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture',
      STRIPE_EXPECTED_ACCOUNT_ID: 'acct_fixture', STRIPE_EXPECTED_MODE: 'test',
      STRIPE_BILLING_PORTAL_CONFIGURATION: '', ...options.env },
  });
  assert.ifError(result.error);
  const output = result.stdout + result.stderr;
  assert.ok(!output.includes(sentinel), 'provider exception content escaped into CLI output');
  return { status: result.status, output };
}

test('CLI requires explicit matching account and key-mode pins before provider reads', () => {
  for (const env of [
    { STRIPE_EXPECTED_ACCOUNT_ID: '' },
    { STRIPE_EXPECTED_ACCOUNT_ID: 'SYNTHETIC_SECRET_MUST_NOT_LEAK' },
    { STRIPE_EXPECTED_MODE: '' }, { STRIPE_EXPECTED_MODE: 'LIVE' },
    { STRIPE_EXPECTED_MODE: 'SYNTHETIC_SECRET_MUST_NOT_LEAK' },
    { STRIPE_EXPECTED_MODE: 'live' },
    { STRIPE_EXPECTED_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_fixture',
      STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture', STRIPE_BILLING_PORTAL_CONFIGURATION: '' },
    { STRIPE_SECRET_KEY: 'sk_live_fixture', STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture' },
    { STRIPE_SECRET_KEY: 'sk_org_fixture' }, { STRIPE_SECRET_KEY: 'sk_test_' },
    { STRIPE_PUBLISHABLE_KEY: '' }, { STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture' },
    { STRIPE_PUBLISHABLE_KEY: 'pk_test_' },
  ]) {
    const result = runPreflight(stripePrice(), false, { env });
    assert.equal(result.status, 1, result.output);
    assert.doesNotMatch(result.output, /FIXTURE_(ACCOUNT|PRICE|WEBHOOK)_READ/);
  }
});

test('CLI fails closed on wrong/unknown account without downstream reads or secret output', () => {
  for (const options of [
    { account: null }, { account: {} }, { account: { ...readyAccount, object: 'customer' } },
    { account: { ...readyAccount, id: 'acct_other' } },
    { account: { ...readyAccount, id: 'SYNTHETIC_SECRET_MUST_NOT_LEAK' } },
    { throwAccount: true },
  ]) {
    const result = runPreflight(stripePrice(), false, options);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /FIXTURE_ACCOUNT_READ/);
    assert.doesNotMatch(result.output, /FIXTURE_(PRICE|WEBHOOK)_READ/);
  }
});

const liveEnv = { STRIPE_EXPECTED_MODE: 'live', STRIPE_SECRET_KEY: 'rk_live_fixture', STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture',
  STRIPE_BILLING_PORTAL_CONFIGURATION: 'bpc_fixture' };
const ownAccount = { ...readyAccount, type: 'standard', controller: { type: 'account' },
  capabilities: { card_payments: 'active' }, requirements: undefined };
test('CLI qualifies nullable own-account capabilities without claiming verification details', () => {
  for (const requirements of [undefined, null]) {
    const result = runPreflight(stripePrice({ livemode: true }), false,
      { env: liveEnv, account: { ...ownAccount, requirements } });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Verification details were not exposed; Dashboard review remains necessary/);
    assert.match(result.output, /FIXTURE_PRICE_READ/);
    assert.match(result.output, /FIXTURE_WEBHOOK_READ/);
  }
  const detailed = runPreflight(stripePrice({ livemode: true }), false, { env: liveEnv });
  assert.equal(detailed.status, 0, detailed.output);
  assert.doesNotMatch(detailed.output, /Verification details were not exposed/);
});

test('nullable exception cannot bypass unknown identity, capability or present requirements', () => {
  const mutations = [
    ...[undefined, 'custom', 'express', 'none'].map(type => ({ ...ownAccount, type })),
    ...[undefined, {}, { type: 'application' }].map(controller => ({ ...ownAccount, controller })),
    ...[undefined, {}, { card_payments: 'pending' }, { card_payments: true }]
      .map(capabilities => ({ ...ownAccount, capabilities })),
    ...['charges_enabled', 'payouts_enabled', 'details_submitted'].flatMap(field =>
      [undefined, false, 'true'].map(value => ({ ...ownAccount, [field]: value }))),
    ...[{}, [], false, '', 'SYNTHETIC_SECRET_MUST_NOT_LEAK',
      { ...readyAccount.requirements, currently_due: ['SYNTHETIC_SECRET_MUST_NOT_LEAK'] },
      { ...readyAccount.requirements, disabled_reason: 'SYNTHETIC_SECRET_MUST_NOT_LEAK' }]
      .map(requirements => ({ ...ownAccount, requirements })),
  ];
  for (const account of mutations) {
    const result = runPreflight(stripePrice({ livemode: true }), false, { env: liveEnv, account });
    assert.equal(result.status, 1, result.output);
    assert.doesNotMatch(result.output, /FIXTURE_(PRICE|WEBHOOK)_READ/);
  }
});

test('CLI supports restricted keys and explicitly qualifies ready live capabilities', () => {
  for (const [price, env] of [[stripePrice(), { STRIPE_SECRET_KEY: 'rk_test_fixture' }],
    [stripePrice({ livemode: true }), liveEnv]]) {
    const result = runPreflight(price, false, { env });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Authenticated account acct_fixture/);
    assert.match(result.output, /Configuration only:/);
  }
});

test('live preflight verifies the exact customer portal policy before prices or webhooks', () => {
  const valid = runPreflight(stripePrice({ livemode: true }), false, { env: liveEnv });
  assert.equal(valid.status, 0, valid.output);
  assert.match(valid.output, /FIXTURE_PORTAL_READ/);
  for (const portal of [null, {}, { ...readyPortal, id: 'bpc_other' }, { ...readyPortal, active: false },
    { ...readyPortal, livemode: false }, { ...readyPortal, default_return_url: 'https://attacker.example/' },
    { ...readyPortal, features: { ...readyPortal.features, subscription_update: { enabled: true } } },
    { ...readyPortal, features: { ...readyPortal.features, subscription_cancel: { enabled: false } } }]) {
    const result = runPreflight(stripePrice({ livemode: true }), false, { env: liveEnv, portal });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /FIXTURE_PORTAL_READ/);
    assert.doesNotMatch(result.output, /FIXTURE_(PRICE|WEBHOOK)_READ/);
  }
  const unavailable = runPreflight(stripePrice({ livemode: true }), false,
    { env: liveEnv, throwPortal: true });
  assert.equal(unavailable.status, 1, unavailable.output);
  assert.doesNotMatch(unavailable.output, /SYNTHETIC_SECRET_MUST_NOT_LEAK|FIXTURE_(PRICE|WEBHOOK)_READ/);
});

test('CLI refuses unconfirmed live capabilities and outstanding or unknown requirements', () => {
  const mutations = [
    ...['charges_enabled', 'payouts_enabled', 'details_submitted'].flatMap(field =>
      [false, undefined, 'true'].map(value => ({ ...readyAccount, [field]: value }))),
    ...['currently_due', 'past_due', 'pending_verification'].flatMap(field =>
      [undefined, ['SYNTHETIC_SECRET_MUST_NOT_LEAK'], ''].map(value => ({ ...readyAccount,
        requirements: { ...readyAccount.requirements, [field]: value } }))),
    ...[undefined, 'SYNTHETIC_SECRET_MUST_NOT_LEAK'].map(disabled_reason => ({ ...readyAccount,
      requirements: { ...readyAccount.requirements, disabled_reason } })),
  ];
  for (const account of mutations) {
    const result = runPreflight(stripePrice({ livemode: true }), false, { env: liveEnv, account });
    assert.equal(result.status, 1, result.output);
    assert.doesNotMatch(result.output, /FIXTURE_(PRICE|WEBHOOK)_READ/);
  }
  const testMode = runPreflight(stripePrice(), false, { account: { object: 'account', id: 'acct_fixture' } });
  assert.equal(testMode.status, 0, testMode.output);
});

test('CLI suppresses malformed provider price fields and refuses unknown or wrong price mode', () => {
  for (const mutation of [
    { currency: 'SYNTHETIC_SECRET_MUST_NOT_LEAK' },
    { recurring: { ...stripePrice().recurring, interval: 'SYNTHETIC_SECRET_MUST_NOT_LEAK' } },
    { unit_amount: 'SYNTHETIC_SECRET_MUST_NOT_LEAK' },
    { livemode: true }, { livemode: undefined },
  ]) {
    const result = runPreflight(stripePrice(mutation));
    assert.equal(result.status, 1, result.output);
  }
});

test('CLI succeeds on valid configuration and fails on each isolated shape mismatch', () => {
  const valid = runPreflight(stripePrice());
  assert.equal(valid.status, 0, valid.output);
  for (const [diagnostic, mutation] of shapeFailures) {
    const failed = runPreflight(stripePrice(mutation));
    assert.equal(failed.status, 1, failed.output);
    assert.ok(failed.output.includes(diagnostic), failed.output);
  }
});

test('CLI price lookup failure refuses readiness without printing the provider error', () => {
  const failed = runPreflight(stripePrice(), true);
  assert.equal(failed.status, 1, failed.output);
  assert.match(failed.output, /FIXTURE_PRICE could not be verified as a Stripe Price/);
});

test('a correctly configured price reports nothing', () => {
  assert.deepEqual(priceIssues(PLAN, stripePrice()), []);
  assert.deepEqual(priceIssues(PACK, stripePrice({ unit_amount: 1000, type: 'one_time', recurring: null })), []);
});

test('a WRONG AMOUNT is caught — the whole reason this exists', () => {
  /* EUR 24 configured against the EUR 39 list item: both the page and the charge
   * would read 24 and agree with each other. Only the catalogue disagrees. */
  const [msg] = priceIssues(PLAN, stripePrice({ unit_amount: 2400 }));
  assert.match(msg, /charges 24\.00 but the catalogue advertises 39\.00/);
});

test('a wrong CURRENCY is caught', () => {
  const [msg] = priceIssues(PLAN, stripePrice({ currency: 'usd' }));
  assert.match(msg, /USD.*catalogue says EUR/);
});

test('an ARCHIVED price is caught', () => {
  /* Stripe retrieves an archived price happily, so this presents as a 400 at
   * checkout — after the customer has decided to buy. */
  assert.ok(priceIssues(PLAN, stripePrice({ active: false }))[0].includes('ARCHIVED'));
});

test('a one-time price on a SUBSCRIPTION is caught', () => {
  const [msg] = priceIssues(PLAN, stripePrice({ type: 'one_time', recurring: null }));
  assert.match(msg, /never renew/);
});

test('a MONTHLY price on an annual item is caught', () => {
  /* The one that bills a customer 12x too often for a year of access. */
  const annual = { ...PLAN, id: 'everything_annual', price: 348, interval: 'year' };
  const [msg] = priceIssues(annual, stripePrice({ unit_amount: 34800, recurring: { interval: 'month' } }));
  assert.match(msg, /renews monthly but the catalogue says yearly/);
});

test('a RECURRING price on a credit pack is caught', () => {
  /* The expensive mirror image: a one-off purchase that bills forever. */
  const [msg] = priceIssues(PACK, stripePrice({ unit_amount: 1000 }));
  assert.match(msg, /RECURRING on a credit pack/);
});

test('a missing price is a problem, not a crash', () => {
  assert.deepEqual(priceIssues(PLAN, null), ['does not resolve to a Stripe Price']);
});

/* ── The script around it ────────────────────────────────────────────────── */

const script = readFileSync('scripts/billing-preflight.mjs', 'utf8');

test('the preflight never writes — to Stripe or to us', () => {
  /* An operator runs this against LIVE keys to check a config. It must be
   * impossible for that to change anything. */
  for (const write of ['prices.create', 'products.create', 'subscriptions.create', 'INSERT', 'UPDATE ', 'DELETE']) {
    assert.ok(!script.includes(write), `billing-preflight performs a write (${write}) — it must be read-only`);
  }
  assert.ok(script.includes('prices.retrieve'), 'the preflight stopped verifying prices against Stripe');
});

test('the preflight never prints a secret', () => {
  /* Printing a key to prove it is set is how a live token leaked in this
   * workspace on 2026-08-19. Report a LENGTH, never a value. */
  assert.ok(script.includes('const state = (v) => (v ? `set (${v.length} chars)` : \'MISSING\');'),
    'the env reporter no longer reports a length — check it does not print the value');
  for (const leak of ['${KEY}', '${WEBHOOK}', '${PUB}', 'console.log(KEY', 'console.log(WEBHOOK']) {
    assert.ok(!script.includes(leak), `billing-preflight interpolates a secret (${leak}) into its output`);
  }
});

test('the preflight does not restate the catalogue', () => {
  /* A second price list is the drift billingService is built to prevent. */
  assert.ok(script.includes('getInternalCatalog'), 'the preflight no longer reads the real catalogue');
  assert.ok(!/STRIPE_PRICE_[A-Z_]+/.test(script),
    'the preflight hardcodes price env names — it must derive them from CATALOG');
});

test('a missing webhook secret is called out as the worst state', () => {
  /* Keys set + webhook missing is the one combination that charges a customer
   * and never grants the plan. It must not read like a minor warning. */
  assert.ok(script.includes('STRIPE_WEBHOOK_SECRET'), 'the preflight does not check the webhook secret');
  assert.ok(/charged and stays locked out/.test(script),
    'the webhook warning no longer says what actually happens to the customer');
});
