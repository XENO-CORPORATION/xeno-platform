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

const PLAN = { id: 'everything_monthly', kind: 'subscription', price: 39, currency: 'eur', interval: 'month' };
const PACK = { id: 'credits_small', kind: 'credits', price: 10, currency: 'eur' };

const stripePrice = (o = {}) => ({
  active: true, unit_amount: 3900, currency: 'eur', type: 'recurring', recurring: { interval: 'month' }, ...o,
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
