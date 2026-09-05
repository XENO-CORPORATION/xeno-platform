import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, truncateSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { billingAccountConfig, verifyBillingAccount } from '../../src/server/utils/billingAccountBinding.js';
import { priceIssues } from '../../src/server/utils/priceAgreement.js';

export const LIVE_ACCOUNT = 'acct_1TwgCrLBe83UKv9x';
export const API_VERSION = '2025-02-24.acacia';
export const WEBHOOK_URL = 'https://xenostudio.ai/api/billing/webhook';
export const PORTAL_RETURN_URL = 'https://xenostudio.ai/overview/billing';
const MARKER = 'platform-live-billing-v1';
const MAX_PAGES = 100;
const WEBHOOK_REPLAY_WINDOW_MS = 60 * 60 * 1000;
const demand = (value, code) => { if (!value) throw new Error(code); };
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);

function canonicalCatalog(catalog) {
  demand(Array.isArray(catalog) && catalog.length > 0, 'catalog_required');
  const ids = new Set(), envs = new Set(), tuples = [];
  for (const item of catalog) {
    demand(item && typeof item === 'object', 'invalid_catalog_item');
    demand(item.legacy === undefined || typeof item.legacy === 'boolean', 'invalid_legacy');
    if (item.legacy === true) continue;
    demand(/^[a-z][a-z0-9_]{0,63}$/.test(item.id || '') && !ids.has(item.id), 'invalid_catalog_id');
    demand(/^STRIPE_PRICE_[A-Z0-9_]+$/.test(item.priceEnv || '') && !envs.has(item.priceEnv), 'invalid_catalog_env');
    demand(typeof item.label === 'string' && item.label.trim() && item.label.length <= 150, 'invalid_label');
    demand(item.currency === 'eur' && Number.isFinite(item.price), 'invalid_currency_or_price');
    const unitAmount = Math.round(item.price * 100);
    demand(Number.isSafeInteger(unitAmount) && unitAmount > 0 && Math.abs(item.price * 100 - unitAmount) < 1e-7, 'invalid_minor_amount');
    demand(['credits', 'subscription'].includes(item.kind), 'invalid_kind');
    demand(Number.isSafeInteger(item.credits) && item.credits >= 0, 'invalid_credits');
    demand(item.perSeat === undefined || typeof item.perSeat === 'boolean', 'invalid_seat_flag');
    if (item.kind === 'credits') demand(item.credits > 0 && item.interval == null && !item.perSeat, 'invalid_credit_pack');
    else demand(['month', 'year'].includes(item.interval) && item.credits === 0, 'invalid_subscription');
    ids.add(item.id); envs.add(item.priceEnv);
    tuples.push({ id: item.id, name: `XENO ${item.label} (${item.id})`, kind: item.kind,
      currency: item.currency, unit_amount: unitAmount, interval: item.interval || null,
      credits: item.credits, perSeat: item.perSeat === true, tax_behavior: 'inclusive',
      price: item.price, priceEnv: item.priceEnv });
  }
  demand(tuples.length > 0, 'empty_catalog');
  return tuples.sort((a, b) => a.id.localeCompare(b.id));
}

export function deriveBillingEvents(source) {
  demand(typeof source === 'string' && source.length > 0, 'billing_source_required');
  const events = [...new Set([...source.matchAll(/case '([a-z_]+\.[a-z_.]+)':/g)].map(match => match[1]))].sort();
  demand(events.length >= 5, 'billing_events_unverified');
  return events;
}

export function liveSetupPlan(catalog, billingSource) {
  const base = canonicalCatalog(catalog);
  const events = deriveBillingEvents(billingSource);
  // The deployment env name is part of the catalog contract: changing it must
  // not silently reuse ownership metadata that points operators at an old key.
  const catalogDigest = fingerprint(base.map(({ price, ...tuple }) => tuple));
  const items = base.map(item => ({ ...item, digest: fingerprint({ account: LIVE_ACCOUNT, catalogDigest,
    id: item.id, kind: item.kind, currency: item.currency, unit_amount: item.unit_amount,
    interval: item.interval, credits: item.credits, perSeat: item.perSeat, tax_behavior: item.tax_behavior }) }));
  return Object.freeze({ account: LIVE_ACCOUNT, mode: 'live', apiVersion: API_VERSION, catalogDigest,
    items, webhook: { url: WEBHOOK_URL, events }, portal: {
      default_return_url: PORTAL_RETURN_URL,
      business_profile: { headline: 'Manage your XENO billing and subscription.',
        privacy_policy_url: 'https://xenostudio.ai/privacy', terms_of_service_url: 'https://xenostudio.ai/terms' },
      features: {
        customer_update: { enabled: true, allowed_updates: ['address', 'email', 'name', 'tax_id'] },
        invoice_history: { enabled: true }, payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none',
          cancellation_reason: { enabled: true, options: ['customer_service', 'low_quality', 'missing_features', 'other', 'switched_service', 'too_complex', 'too_expensive', 'unused'] } },
        subscription_update: { enabled: false },
      },
    } });
}

export function validateLiveEnvironment(env) {
  demand(env?.STRIPE_EXPECTED_ACCOUNT_ID === LIVE_ACCOUNT, 'live_account_pin_required');
  demand(env?.STRIPE_EXPECTED_MODE === 'live', 'live_mode_required');
  demand(/^(sk|rk)_live_[A-Za-z0-9]+$/.test(env?.STRIPE_SECRET_KEY || ''), 'live_secret_key_required');
  demand(/^pk_live_[A-Za-z0-9]+$/.test(env?.STRIPE_PUBLISHABLE_KEY || ''), 'live_publishable_key_required');
  return billingAccountConfig(env);
}

async function allPages(list) {
  const rows = [], seen = new Set();
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await list({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    demand(Array.isArray(result?.data) && typeof result.has_more === 'boolean', 'malformed_provider_page');
    rows.push(...result.data);
    if (!result.has_more) return rows;
    cursor = result.data.at(-1)?.id;
    demand(cursor && !seen.has(cursor), 'provider_pagination_stuck');
    seen.add(cursor);
  }
  throw new Error('provider_pagination_limit');
}

const baseMetadata = plan => ({ xenoLiveSetup: MARKER, xenoAccount: LIVE_ACCOUNT, xenoCatalogDigest: plan.catalogDigest });
const itemMetadata = (plan, item) => ({ ...baseMetadata(plan), xenoCatalogId: item.id, xenoTuple: item.digest });
const owned = object => object?.metadata?.xenoLiveSetup === MARKER;
const metadataMatches = (object, expected) => Object.entries(expected).every(([key, value]) => object?.metadata?.[key] === value);
const sameArray = (left, right) => Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);

function assertProduct(product, plan, item) {
  demand(product?.object === 'product' && validId(product.id, 'prod') && product.active === true
    && product.livemode === true && product.name === item.name && metadataMatches(product, itemMetadata(plan, item)), 'product_mismatch');
}
function assertPrice(price, product, plan, item) {
  demand(price?.object === 'price' && validId(price.id, 'price') && price.livemode === true
    && price.product === product.id && price.tax_behavior === 'inclusive'
    && metadataMatches(price, itemMetadata(plan, item)) && priceIssues(item, price).length === 0, 'price_mismatch');
}
function assertWebhook(endpoint, plan) {
  demand(endpoint?.object === 'webhook_endpoint' && validId(endpoint.id, 'we') && endpoint.status === 'enabled'
    && endpoint.livemode === true && endpoint.connect === false && endpoint.url === plan.webhook.url
    && endpoint.api_version === API_VERSION && metadataMatches(endpoint, baseMetadata(plan))
    && sameArray([...endpoint.enabled_events].sort(), [...plan.webhook.events].sort()), 'webhook_mismatch');
}
function assertPortal(config, plan) {
  const f = config?.features;
  demand(config?.object === 'billing_portal.configuration' && validId(config.id, 'bpc') && config.active === true
    && config.livemode === true && config.default_return_url === plan.portal.default_return_url
    && metadataMatches(config, baseMetadata(plan))
    && config.business_profile?.headline === plan.portal.business_profile.headline
    && config.business_profile?.privacy_policy_url === plan.portal.business_profile.privacy_policy_url
    && config.business_profile?.terms_of_service_url === plan.portal.business_profile.terms_of_service_url
    && f?.customer_update?.enabled === true
    && sameArray(f.customer_update.allowed_updates, plan.portal.features.customer_update.allowed_updates)
    && f?.invoice_history?.enabled === true && f?.payment_method_update?.enabled === true
    && f?.subscription_cancel?.enabled === true && f.subscription_cancel.mode === 'at_period_end'
    && f.subscription_cancel.proration_behavior === 'none'
    && f.subscription_cancel.cancellation_reason?.enabled === true
    && sameArray(f.subscription_cancel.cancellation_reason.options, plan.portal.features.subscription_cancel.cancellation_reason.options)
    && f?.subscription_update?.enabled === false, 'portal_mismatch');
}

async function readInventory(stripe) {
  const [products, prices, webhooks, portals] = await Promise.all([
    allPages(args => stripe.products.list(args)), allPages(args => stripe.prices.list(args)),
    allPages(args => stripe.webhookEndpoints.list(args)), allPages(args => stripe.billingPortal.configurations.list(args)),
  ]);
  return { products, prices, webhooks, portals };
}

function reconcile(plan, inventory) {
  const entries = new Map(plan.items.map(item => [item.id, { item }]));
  const intendedNames = new Set(plan.items.map(item => item.name));
  const ownedProductIds = new Set(inventory.products.filter(owned).map(product => product.id));
  for (const product of inventory.products) {
    if (!owned(product)) { demand(!intendedNames.has(product.name), 'ambiguous_unowned_product'); continue; }
    demand(metadataMatches(product, baseMetadata(plan)), 'foreign_or_stale_owned_product');
    const entry = entries.get(product.metadata.xenoCatalogId);
    demand(entry && !entry.product, 'ambiguous_or_unknown_product');
    assertProduct(product, plan, entry.item); entry.product = product;
  }
  for (const price of inventory.prices) {
    if (!owned(price)) { demand(!ownedProductIds.has(typeof price.product === 'string' ? price.product : price.product?.id), 'unowned_price_on_owned_product'); continue; }
    demand(metadataMatches(price, baseMetadata(plan)), 'foreign_or_stale_owned_price');
    const entry = entries.get(price.metadata.xenoCatalogId);
    demand(entry?.product && !entry.price, 'orphan_or_ambiguous_price');
    assertPrice(price, entry.product, plan, entry.item); entry.price = price;
  }
  let webhook;
  for (const endpoint of inventory.webhooks) {
    if (!owned(endpoint)) { demand(endpoint.url !== plan.webhook.url, 'ambiguous_unowned_webhook'); continue; }
    demand(metadataMatches(endpoint, baseMetadata(plan)) && !webhook, 'foreign_stale_or_ambiguous_webhook');
    assertWebhook(endpoint, plan); webhook = endpoint;
  }
  let portal;
  for (const config of inventory.portals) {
    if (!owned(config)) {
      demand(config.default_return_url !== plan.portal.default_return_url, 'ambiguous_unowned_portal');
      continue;
    }
    demand(metadataMatches(config, baseMetadata(plan)) && !portal, 'foreign_stale_or_ambiguous_portal');
    assertPortal(config, plan); portal = config;
  }
  return { entries: [...entries.values()], webhook, portal };
}

function idempotencyKey(plan, kind, id = '') {
  return `xeno-live:${kind}:${fingerprint([LIVE_ACCOUNT, plan.catalogDigest, id])}`;
}

function productParams(plan, item) {
  return { name: item.name, active: true, metadata: itemMetadata(plan, item) };
}
function priceParams(plan, item, productId) {
  return { product: productId, currency: item.currency, unit_amount: item.unit_amount,
    tax_behavior: 'inclusive', billing_scheme: 'per_unit', metadata: itemMetadata(plan, item),
    ...(item.kind === 'subscription' ? { recurring: { interval: item.interval, interval_count: 1, usage_type: 'licensed' } } : {}) };
}
function webhookParams(plan) {
  return { url: plan.webhook.url, enabled_events: plan.webhook.events, api_version: API_VERSION,
    connect: false, description: 'XENO production billing lifecycle', metadata: baseMetadata(plan) };
}
function portalParams(plan) { return { ...plan.portal, metadata: baseMetadata(plan) }; }

function safeResult(plan, state, created, extra = {}) {
  return { status: 'VERIFIED', account: LIVE_ACCOUNT, mode: 'live', catalogDigest: plan.catalogDigest, created,
    environment: Object.fromEntries(state.entries.map(({ item, price }) => [item.priceEnv, price?.id || null])),
    portalConfigurationId: state.portal?.id || null, webhookEndpointId: state.webhook?.id || null, ...extra };
}

export async function provisionLiveSetup({ stripe, catalog, billingSource, env, stage = 'catalog-portal', secretSink, now = () => Date.now() }) {
  demand(['catalog-portal', 'webhook'].includes(stage), 'invalid_stage');
  const config = validateLiveEnvironment(env);
  const plan = liveSetupPlan(catalog, billingSource);
  const accountEvidence = await verifyBillingAccount(stripe, config, { sale: true });
  let state = reconcile(plan, await readInventory(stripe));
  const created = { products: 0, prices: 0, portals: 0, webhooks: 0 };

  if (stage === 'catalog-portal') {
    for (const entry of state.entries) {
      if (!entry.product) {
        entry.product = await stripe.products.create(productParams(plan, entry.item), { idempotencyKey: idempotencyKey(plan, 'product', entry.item.id) });
        assertProduct(entry.product, plan, entry.item); created.products++;
      }
      if (!entry.price) {
        entry.price = await stripe.prices.create(priceParams(plan, entry.item, entry.product.id), { idempotencyKey: idempotencyKey(plan, 'price', entry.item.id) });
        assertPrice(entry.price, entry.product, plan, entry.item); created.prices++;
      }
    }
    if (!state.portal) {
      state.portal = await stripe.billingPortal.configurations.create(portalParams(plan), { idempotencyKey: idempotencyKey(plan, 'portal', fingerprint(plan.portal)) });
      assertPortal(state.portal, plan); created.portals++;
    }
    state = reconcile(plan, await readInventory(stripe));
    demand(state.entries.every(entry => entry.product && entry.price) && state.portal, 'catalog_or_portal_incomplete');
    return safeResult(plan, state, created, { accountVerificationNotExposed: accountEvidence.verificationNotExposed,
      nextStage: 'webhook' });
  }

  demand(secretSink && typeof secretSink.inspect === 'function' && typeof secretSink.reserve === 'function'
    && typeof secretSink.commit === 'function', 'secure_secret_sink_required');
  demand(state.entries.every(entry => entry.product && entry.price) && state.portal, 'catalog_portal_prerequisite');
  const receipt = await secretSink.inspect({ account: LIVE_ACCOUNT, catalogDigest: plan.catalogDigest });
  if (state.webhook && receipt?.status === 'complete') {
    demand(receipt.account === LIVE_ACCOUNT && receipt.catalogDigest === plan.catalogDigest
      && receipt.endpointId === state.webhook.id && /^whsec_[A-Za-z0-9]+$/.test(receipt.webhookSecret || ''), 'webhook_receipt_mismatch');
  } else {
    if (state.webhook) {
      demand(receipt?.status === 'pending' && receipt.account === LIVE_ACCOUNT && receipt.catalogDigest === plan.catalogDigest
        && Number.isSafeInteger(receipt.startedAt) && now() - receipt.startedAt >= 0
        && now() - receipt.startedAt <= WEBHOOK_REPLAY_WINDOW_MS, 'webhook_secret_unrecoverable');
    } else {
      demand(receipt == null, 'unexpected_secret_receipt');
      await secretSink.reserve({ status: 'pending', account: LIVE_ACCOUNT, catalogDigest: plan.catalogDigest, startedAt: now() });
    }
    const endpoint = await stripe.webhookEndpoints.create(webhookParams(plan), { idempotencyKey: idempotencyKey(plan, 'webhook', fingerprint(plan.webhook)) });
    assertWebhook(endpoint, plan);
    demand(/^whsec_[A-Za-z0-9]+$/.test(endpoint.secret || ''), 'webhook_secret_missing');
    if (state.webhook) demand(endpoint.id === state.webhook.id, 'webhook_replay_diverged');
    await secretSink.commit({ status: 'complete', account: LIVE_ACCOUNT, catalogDigest: plan.catalogDigest,
      endpointId: endpoint.id, webhookSecret: endpoint.secret });
    created.webhooks = state.webhook ? 0 : 1;
  }
  state = reconcile(plan, await readInventory(stripe));
  demand(state.webhook, 'webhook_incomplete');
  const finalReceipt = await secretSink.inspect({ account: LIVE_ACCOUNT, catalogDigest: plan.catalogDigest });
  demand(finalReceipt?.status === 'complete' && finalReceipt.endpointId === state.webhook.id, 'webhook_receipt_incomplete');
  return safeResult(plan, state, created, { accountVerificationNotExposed: accountEvidence.verificationNotExposed,
    webhookSecretFile: secretSink.path || 'secure-sink' });
}

export function createPosixSecretSink(file, { platform = process.platform } = {}) {
  demand(platform !== 'win32', 'owner_only_secret_file_requires_posix');
  demand(typeof file === 'string' && isAbsolute(file), 'absolute_secret_output_required');
  const target = resolve(file), parent = dirname(target);
  demand(realpathSync(parent) === parent && !lstatSync(parent).isSymbolicLink(), 'secret_parent_must_be_real');
  let fd = null;
  const read = () => {
    if (!existsSync(target)) return null;
    const stat = lstatSync(target);
    demand(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'secret_file_not_owner_only');
    const parsed = JSON.parse(readFileSync(target, 'utf8'));
    demand(parsed && typeof parsed === 'object', 'invalid_secret_receipt');
    return parsed;
  };
  return {
    path: target,
    inspect: async () => read(),
    reserve: async receipt => {
      demand(!existsSync(target), 'secret_output_exists');
      fd = openSync(target, 'wx', 0o600);
      demand(fstatSync(fd).isFile() && (fstatSync(fd).mode & 0o077) === 0, 'secret_file_not_owner_only');
      writeFileSync(fd, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8' }); fsyncSync(fd);
    },
    commit: async receipt => {
      if (fd === null) {
        demand(read()?.status === 'pending', 'secret_sink_not_reserved');
        fd = openSync(target, 'r+');
        demand(fstatSync(fd).isFile() && (fstatSync(fd).mode & 0o077) === 0, 'secret_file_not_owner_only');
      }
      truncateSync(fd, 0); writeFileSync(fd, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8' }); fsyncSync(fd);
      closeSync(fd); fd = null;
    },
  };
}
