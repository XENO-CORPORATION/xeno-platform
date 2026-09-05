import { createHash } from 'node:crypto';
import { allPages } from './paid-loop-proof.mjs';
import { priceIssues } from '../../src/server/utils/priceAgreement.js';

export const SANDBOX_ACCOUNT = 'acct_1UBwYiLLJZjl9ISl';
export const API_VERSION = '2025-02-24.acacia';
const MARKER = 'platform-catalog-v1';
const demand = (value, code) => { if (!value) throw new Error(code); };
const validId = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function validateSandbox(env) {
  demand(/^(sk|rk)_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY || ''), 'test_key_required');
  demand(env.STRIPE_EXPECTED_ACCOUNT_ID === SANDBOX_ACCOUNT, 'sandbox_pin_required');
  demand(env.STRIPE_EXPECTED_MODE === 'test', 'test_mode_required');
}

export function catalogPlan(catalog) {
  demand(Array.isArray(catalog) && catalog.length > 0, 'catalog_required');
  const ids = new Set(), envs = new Set();
  const plan = [];
  for (const item of catalog) {
    demand(item && typeof item === 'object', 'invalid_catalog_item');
    demand(item.legacy === undefined || typeof item.legacy === 'boolean', 'invalid_legacy');
    if (item.legacy === true) continue;
    demand(/^[a-z][a-z0-9_]{0,63}$/.test(item.id || '') && !ids.has(item.id), 'invalid_catalog_id');
    demand(/^STRIPE_PRICE_[A-Z0-9_]+$/.test(item.priceEnv || '') && !envs.has(item.priceEnv), 'invalid_catalog_env');
    demand(typeof item.label === 'string' && item.label.trim() && item.label.length <= 150, 'invalid_label');
    demand(item.currency === 'eur' && typeof item.price === 'number' && Number.isFinite(item.price), 'invalid_currency_or_price');
    const amount = Math.round(item.price * 100);
    demand(Number.isSafeInteger(amount) && amount > 0 && Math.abs(item.price * 100 - amount) < 1e-7, 'invalid_minor_amount');
    demand(['credits', 'subscription'].includes(item.kind), 'invalid_kind');
    demand(Number.isSafeInteger(item.credits) && item.credits >= 0, 'invalid_credits');
    demand(item.perSeat === undefined || typeof item.perSeat === 'boolean', 'invalid_seat_flag');
    if (item.kind === 'credits') demand(item.credits > 0 && item.interval == null && !item.perSeat, 'invalid_credit_pack');
    else demand(['month', 'year'].includes(item.interval) && item.credits === 0, 'invalid_subscription');
    ids.add(item.id); envs.add(item.priceEnv);
    const tuple = { id: item.id, name: `XENO ${item.label} (${item.id})`, kind: item.kind,
      currency: item.currency, unit_amount: amount, interval: item.interval || null,
      credits: item.credits, perSeat: item.perSeat === true, tax_behavior: 'inclusive' };
    plan.push({ ...tuple, price: item.price, priceEnv: item.priceEnv, digest: fingerprint(tuple) });
  }
  demand(plan.length > 0, 'empty_catalog');
  return plan.sort((a, b) => a.id.localeCompare(b.id));
}

const metadataFor = item => ({ xenoQualification: MARKER, xenoCatalogId: item.id, xenoTuple: item.digest });
const owned = obj => obj?.metadata?.xenoQualification === MARKER;
function metadataMatches(obj, item) {
  return Object.entries(metadataFor(item)).every(([key, value]) => obj?.metadata?.[key] === value);
}
function assertProduct(product, item) {
  demand(product?.object === 'product' && validId(product.id, 'prod') && product.active === true
    && product.livemode === false && product.name === item.name && metadataMatches(product, item), 'product_mismatch');
}
function assertPrice(price, product, item) {
  demand(price?.object === 'price' && validId(price.id, 'price') && price.livemode === false
    && price.product === product.id && price.tax_behavior === 'inclusive'
    && metadataMatches(price, item) && priceIssues(item, price).length === 0, 'price_mismatch');
}

function reconcile(products, prices, plan) {
  const byId = new Map(plan.map(item => [item.id, { item }]));
  for (const product of products.filter(owned)) {
    const entry = byId.get(product.metadata.xenoCatalogId);
    demand(entry && !entry.product, 'ambiguous_or_unknown_product');
    assertProduct(product, entry.item); entry.product = product;
  }
  for (const price of prices.filter(owned)) {
    const entry = byId.get(price.metadata.xenoCatalogId);
    demand(entry?.product && !entry.price, 'orphan_or_ambiguous_price');
    assertPrice(price, entry.product, entry.item); entry.price = price;
  }
  return [...byId.values()];
}

export async function provisionCatalog({ stripe, catalog, env }) {
  validateSandbox(env);
  const plan = catalogPlan(catalog);
  const account = await stripe.accounts.retrieve();
  demand(account?.object === 'account' && account.id === SANDBOX_ACCOUNT, 'account_mismatch');
  const inventory = async () => reconcile(
    await allPages(args => stripe.products.list(args), {}),
    await allPages(args => stripe.prices.list(args), {}), plan);
  // Validate the complete inventory before the first write, not one item at a time.
  const entries = await inventory();
  const created = { products: 0, prices: 0 };
  for (const entry of entries) {
    const { item } = entry;
    const key = kind => `xeno-qualification:${kind}:${fingerprint([SANDBOX_ACCOUNT, item.id, item.digest])}`;
    if (!entry.product) {
      entry.product = await stripe.products.create({ name: item.name, active: true, metadata: metadataFor(item) }, { idempotencyKey: key('product') });
      assertProduct(entry.product, item); created.products++;
    }
    if (!entry.price) {
      entry.price = await stripe.prices.create({ product: entry.product.id, currency: item.currency,
        unit_amount: item.unit_amount, tax_behavior: 'inclusive', billing_scheme: 'per_unit',
        metadata: metadataFor(item), ...(item.kind === 'subscription'
          ? { recurring: { interval: item.interval, interval_count: 1, usage_type: 'licensed' } } : {}) },
      { idempotencyKey: key('price') });
      assertPrice(entry.price, entry.product, item); created.prices++;
    }
  }
  // Re-read persisted provider objects; successful create responses alone are insufficient.
  const verified = await inventory();
  demand(verified.every(entry => entry.product && entry.price), 'incomplete_catalog');
  return { status: 'verified-catalog-only', account: SANDBOX_ACCOUNT, mode: 'test', created,
    prices: verified.map(({ item, product, price }) => ({ item: item.id, env: item.priceEnv,
      productId: product.id, priceId: price.id, amountMinor: item.unit_amount, currency: item.currency })) };
}
