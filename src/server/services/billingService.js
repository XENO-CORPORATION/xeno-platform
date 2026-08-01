/**
 * Billing Service — Stripe Checkout ⇄ Credit Ledger (v2)
 *
 * The revenue front door for the XENO platform. Turns real money into credits on
 * the EXISTING hash-chained ledger (`creditLedgerV2.addGrant`) — one-time credit
 * packs and recurring subscriptions. Nothing here replaces the ledger; Stripe is
 * only the payment rail, the ledger stays the source of truth for balances.
 *
 * Design invariants:
 *  - FEATURE-FLAGGED: with no STRIPE_SECRET_KEY the whole surface is disabled and
 *    every endpoint returns 503 — the server still boots and every other product
 *    is unaffected. Drop in keys → live, no code change.
 *  - IDEMPOTENT: Stripe redelivers webhooks. Every credit-granting event is
 *    guarded by `billing_events(event_id PRIMARY KEY)` — a redelivered event is a
 *    no-op, so a customer is never double-credited.
 *  - Subscriptions are credited on `invoice.paid` (covers the first payment AND
 *    every renewal); one-time packs on `checkout.session.completed`. No overlap.
 *  - Catalog is config-driven: each item maps to a Stripe Price via an env var, so
 *    prices/plans are managed in the Stripe dashboard, not in code.
 */
import Stripe from 'stripe';
import { siteOrigin } from '../config/hosts.js';
import { addGrantTx, clawbackTx, getBalanceV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';

const SECRET = process.env.STRIPE_SECRET_KEY || '';
const PUBLISHABLE = process.env.STRIPE_PUBLISHABLE_KEY || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

/**
 * Stripe client — null until a secret key is configured (feature flag).
 * apiVersion is PINNED so outbound-call response shapes are deterministic and match
 * the SDK-bundled version this code's field reads target (rather than drifting with
 * the account's dashboard default). Webhook payload shape is governed by the webhook
 * ENDPOINT's version, which can be newer — so the handlers ALSO read version-fragile
 * fields defensively (see subIdFromInvoice/periodEndFrom* below). maxNetworkRetries
 * makes the outbound refund/charge lookups resilient to transient errors.
 */
const stripe = SECRET ? new Stripe(SECRET, { apiVersion: '2025-02-24.acacia', maxNetworkRetries: 2 }) : null;

export function isEnabled() {
  return Boolean(stripe);
}

// ── Catalog ─────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for prices. The frontend fetches this (via /api/billing/
// config) and renders from it — no hardcoded price literals — so the ADVERTISED price
// always equals the CHARGED price. `price` is the display amount in `CURRENCY`; the
// authoritative charge is the Stripe Price resolved from `priceEnv` (which MUST be
// created at the same amount/currency in the Stripe dashboard). An item with no
// configured price is returned `available: false` so partial config never 500s.
// Currency is EUR (EU entity + Impressum + Stripe VAT); LOCKED tiers: Free €0 /
// Pro €24 / Team €40-per-seat / Enterprise custom. Credit packs €10/€50/€100.
const CURRENCY = (process.env.BILLING_CURRENCY || 'eur').toLowerCase();
const CATALOG = [
  { id: 'credits_small',  kind: 'credits',      label: 'Starter',  credits: 1000,  price: 10,  priceEnv: 'STRIPE_PRICE_CREDITS_SMALL' },
  { id: 'credits_medium', kind: 'credits',      label: 'Plus',     credits: 5500,  price: 50,  priceEnv: 'STRIPE_PRICE_CREDITS_MEDIUM', badge: 'Best value' },
  { id: 'credits_large',  kind: 'credits',      label: 'Pro pack', credits: 12000, price: 100, priceEnv: 'STRIPE_PRICE_CREDITS_LARGE' },
  { id: 'pro_monthly',    kind: 'subscription', label: 'Pro',      plan: 'pro',  credits: 0, price: 24, interval: 'month', priceEnv: 'STRIPE_PRICE_PRO_MONTHLY' },
  // Team is PER-SEAT (LOCKED strategy: €40/seat/mo). Stripe quantity = active seats.
  { id: 'team_seat',      kind: 'subscription', label: 'Team', plan: 'team', credits: 0, price: 40, interval: 'month', perSeat: true, priceEnv: 'STRIPE_PRICE_TEAM_SEAT_MONTHLY' },
  // Legacy flat-rate Team — kept readable for any pre-existing subscription, NOT offered
  // publicly (unconfigured priceEnv → available:false; the UI points Team → team_seat).
  { id: 'team_monthly',   kind: 'subscription', label: 'Team (legacy flat)', plan: 'team', credits: 0, price: 60, interval: 'month', priceEnv: 'STRIPE_PRICE_TEAM_MONTHLY' },
];

function resolveItem(raw) {
  const priceId = process.env[raw.priceEnv] || null;
  return { ...raw, priceId, available: Boolean(priceId) };
}

/** Public catalog (never leaks price env NAMES, only ids/labels/availability). The `price`
 *  here is the STATIC fallback; the live path (getPublicCatalog) overlays the real Stripe
 *  amount so advertised == charged. */
export function getCatalog() {
  return CATALOG.map(resolveItem).map(({ priceEnv, ...pub }) => ({ ...pub, currency: CURRENCY }));
}

// Live-price cache: priceId → { amount, currency, at }. TTL-bounded so the public /config
// endpoint does not call Stripe on every render. Overlaying the real Stripe unit_amount is
// what actually GUARANTEES advertised == charged — the static CATALOG `price` is only a
// fallback (used when Stripe is off, the price is unconfigured, or the lookup errors).
const _priceCache = new Map();
const PRICE_TTL_MS = 5 * 60 * 1000;
async function livePriceFor(priceId) {
  if (!stripe || !priceId) return null;
  const hit = _priceCache.get(priceId);
  if (hit && (Date.now() - hit.at) < PRICE_TTL_MS) return hit;
  try {
    const p = await stripe.prices.retrieve(priceId);
    const rec = { amount: p.unit_amount != null ? p.unit_amount / 100 : null, currency: (p.currency || CURRENCY).toLowerCase(), at: Date.now() };
    _priceCache.set(priceId, rec);
    return rec;
  } catch { return null; }
}

/** Public catalog with LIVE Stripe prices overlaid onto the static fallback. */
export async function getPublicCatalog() {
  return Promise.all(CATALOG.map(resolveItem).map(async ({ priceEnv, ...pub }) => {
    if (stripe && pub.priceId) {
      const live = await livePriceFor(pub.priceId);
      if (live && live.amount != null) return { ...pub, price: live.amount, currency: live.currency };
    }
    return { ...pub, currency: CURRENCY };
  }));
}

export async function getConfig() {
  return { enabled: isEnabled(), publishableKey: PUBLISHABLE, currency: CURRENCY, catalog: await getPublicCatalog() };
}

// ── Plans & entitlements (v2) ────────────────────────────────────────────────
// Subscriptions gate FEATURES, not credits (see XENO-MONETIZATION-AND-ACCOUNT.md).
// v2 model: the free/paid boundary is ENFORCEABILITY, not cosmetics. Free = the
// standalone local Tool (clean output, NO watermark, full-res LOCAL export, BYOK +
// in-house xeno-rt fair-use). Paid (Pro/Team) = the connected server-backed Platform
// (cloud sync, cross-app, agents, collaboration, managed-premium priority, teams).
// Enforcement is 100% SERVER-SIDE. One entitlement source of truth, read by every
// product. inHouseDailyLimit null = unlimited. `maxResolution` now ONLY gates
// SERVER-SIDE managed generation (capDimensions in entitlementGate) — it is NOT a
// local-export gate.
// deprecated (v2): watermarking retired; always false — never gate on this.
const PLAN_ENTITLEMENTS = {
  free: { plan: 'free', commercial: false, maxResolution: 'standard', priority: false, inHouseDailyLimit: 50,   privateProjects: false, teamSeats: 0, cloudSync: false, crossApp: false, agents: false, collaboration: false, watermark: false },
  pro:  { plan: 'pro',  commercial: true,  maxResolution: '4k',       priority: true,  inHouseDailyLimit: null, privateProjects: true,  teamSeats: 0, cloudSync: true,  crossApp: true,  agents: true,  collaboration: false, watermark: false },
  team: { plan: 'team', commercial: true,  maxResolution: '4k',       priority: true,  inHouseDailyLimit: null, privateProjects: true,  teamSeats: 5, cloudSync: true,  crossApp: true,  agents: true,  collaboration: true,  watermark: false },
  // Staff / internal-service accounts (prod has real users with plan='internal').
  // NOT sellable — never in the CATALOG. All platform features enabled so internal
  // tooling and service accounts are never gated as free-tier. teamSeats 0: an
  // internal account is not itself a team container.
  internal: { plan: 'internal', commercial: true, maxResolution: '4k', priority: true, inHouseDailyLimit: null, privateProjects: true, teamSeats: 0, cloudSync: true, crossApp: true, agents: true, collaboration: true, watermark: false },
};

// Legacy/stray plan names seen in prod that must NOT silently fall back to free.
// ultra → pro is a PROPOSED mapping (legacy 'ultra' subscribers get pro
// entitlements) — pending user ratification; adjust here if a different target
// tier is decided.
const PLAN_ALIASES = { ultra: 'pro' };

/** Feature entitlements for a plan (aliases resolved; defaults to free). */
export function entitlementsFor(plan) {
  const resolved = PLAN_ALIASES[plan] || plan;
  return PLAN_ENTITLEMENTS[resolved] || PLAN_ENTITLEMENTS.free;
}

const planForItemId = (itemId) => CATALOG.find((i) => i.id === itemId)?.plan || null;
const planForPriceId = (priceId) => CATALOG.map(resolveItem).find((i) => i.priceId && i.priceId === priceId)?.plan || null;

// Stripe subscription statuses that still grant the plan (past_due = grace period).
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

// Webhook payloads are shaped by the ENDPOINT's Stripe API version, which can be
// NEWER than the pinned SDK. Read version-fragile fields from BOTH the legacy
// top-level location and the newer nested location so renewals / period tracking
// never silently break when the account moves to a newer API version.
const subIdFromInvoice = (inv) => inv.subscription || inv.parent?.subscription_details?.subscription || null;
const periodEndFromInvoice = (inv) => {
  const secs = inv.period_end || inv.lines?.data?.[0]?.period?.end || null;
  return secs ? new Date(secs * 1000) : null;
};
const periodEndFromSub = (sub) => {
  const secs = sub.current_period_end || sub.items?.data?.[0]?.current_period_end || null;
  return secs ? new Date(secs * 1000) : null;
};

/** Upsert the user's subscription/plan row (idempotent). */
async function setPlan(pool, userId, { plan, status, subId = null, periodEnd = null }) {
  await ensureSchema(pool);
  await pool.query(
    `INSERT INTO xeno_account_plans (user_id, plan, status, stripe_subscription_id, current_period_end, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (user_id) DO UPDATE SET
       plan = EXCLUDED.plan,
       status = EXCLUDED.status,
       stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, xeno_account_plans.stripe_subscription_id),
       current_period_end = COALESCE(EXCLUDED.current_period_end, xeno_account_plans.current_period_end),
       updated_at = now()`,
    [String(userId), plan, status, subId, periodEnd],
  );
}

/** The user's effective plan (active sub → its plan; otherwise free). */
export async function getPlan(pool, userId) {
  await ensureSchema(pool);
  const r = await pool.query(
    'SELECT plan, status, current_period_end FROM xeno_account_plans WHERE user_id = $1',
    [String(userId)],
  );
  const row = r.rows[0];
  if (row && ACTIVE_STATUSES.has(row.status)) {
    return { plan: row.plan, status: row.status, currentPeriodEnd: row.current_period_end };
  }
  return { plan: 'free', status: row?.status || 'none', currentPeriodEnd: row?.current_period_end || null };
}

/** Plan + full feature entitlements for a user — the entitlement API every product reads. */
export async function getEntitlements(pool, userId) {
  const p = await getPlan(pool, userId);
  return { ...p, entitlements: entitlementsFor(p.plan) };
}

// ── Schema (idempotent, lazy) ────────────────────────────────────────────────
let schemaPromise = null;
function ensureSchema(pool) {
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS billing_customers (
        user_id            text PRIMARY KEY,
        stripe_customer_id text UNIQUE NOT NULL,
        created_at         timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS billing_events (
        event_id   text PRIMARY KEY,
        type       text,
        user_id    text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      -- Maps a settled charge (payment_intent) → the credits it granted, so a later
      -- refund/dispute can claw back the right amount. refunded_micro tracks the
      -- cumulative clawback so partial + repeated refunds never over/under-reverse.
      CREATE TABLE IF NOT EXISTS billing_charges (
        payment_intent text PRIMARY KEY,
        user_id        text NOT NULL,
        credits_micro  bigint NOT NULL,
        refunded_micro bigint NOT NULL DEFAULT 0,
        event_id       text,
        created_at     timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS xeno_account_plans (
        user_id                text PRIMARY KEY,
        plan                   text NOT NULL DEFAULT 'free',
        status                 text,
        stripe_subscription_id text,
        current_period_end     timestamptz,
        updated_at             timestamptz NOT NULL DEFAULT now()
      );
    `).catch((e) => { schemaPromise = null; throw e; });
  }
  return schemaPromise;
}

// ── Customers ────────────────────────────────────────────────────────────────
async function getOrCreateCustomer(pool, user) {
  await ensureSchema(pool);
  const uid = String(user.id);
  const found = await pool.query('SELECT stripe_customer_id FROM billing_customers WHERE user_id = $1', [uid]);
  if (found.rows[0]?.stripe_customer_id) return found.rows[0].stripe_customer_id;

  const customer = await stripe.customers.create({
    email: user.email || undefined,
    name: user.display_name || user.username || undefined,
    metadata: { xenoUserId: uid },
  });
  // ON CONFLICT: a racing request may have inserted first — keep the winner.
  await pool.query(
    `INSERT INTO billing_customers (user_id, stripe_customer_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [uid, customer.id],
  );
  const row = await pool.query('SELECT stripe_customer_id FROM billing_customers WHERE user_id = $1', [uid]);
  return row.rows[0].stripe_customer_id;
}

async function userIdForCustomer(pool, customerId) {
  const r = await pool.query('SELECT user_id FROM billing_customers WHERE stripe_customer_id = $1', [customerId]);
  return r.rows[0]?.user_id || null;
}

// ── Checkout ─────────────────────────────────────────────────────────────────
// EU VAT: auto-calculate + collect tax at checkout. Requires Stripe Tax to be enabled
// in the dashboard (with tax registrations); gated so an un-provisioned account can still
// take payments. Set
// STRIPE_AUTOMATIC_TAX to enable. billing address + tax-id collection are required for
// correct B2C/B2B (reverse-charge) VAT.
// OPT-IN (default OFF): Stripe REJECTS automatic_tax.enabled=true unless Stripe Tax is fully
// provisioned (origin address + registrations), so defaulting ON would break 100% of checkout
// the moment live keys are added. Turn on AFTER configuring Stripe Tax. (Go-live checklist item.)
const TAX_ENABLED = process.env.STRIPE_AUTOMATIC_TAX === 'true';
function taxCheckoutFields() {
  if (!TAX_ENABLED) return {};
  return {
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    customer_update: { address: 'auto', name: 'auto' },
  };
}

export async function createCheckout(pool, user, itemId, { origin }) {
  const item = CATALOG.map(resolveItem).find((i) => i.id === itemId);
  if (!item) { const e = new Error('unknown item'); e.status = 400; throw e; }
  if (!item.available) { const e = new Error(`item "${itemId}" has no configured price (set ${item.priceEnv})`); e.status = 400; throw e; }

  const base = process.env.BILLING_APP_URL || origin || siteOrigin();
  const successUrl = `${base}/overview/billing?billing=success&item=${item.id}`;
  const cancelUrl = `${base}/overview/billing?billing=cancel`;
  const customer = await getOrCreateCustomer(pool, user);

  const session = await stripe.checkout.sessions.create({
    mode: item.kind === 'subscription' ? 'subscription' : 'payment',
    customer,
    client_reference_id: String(user.id),
    line_items: [{ price: item.priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    ...taxCheckoutFields(),
    // Metadata rides on the session (and, for one-time, is what the webhook reads
    // to know how many credits to grant).
    metadata: { xenoUserId: String(user.id), itemId: item.id, credits: String(item.credits), kind: item.kind },
  });
  return { url: session.url, id: session.id };
}

/**
 * Per-seat Team subscription for a WORKSPACE. quantity = seats; the workspace id
 * rides on BOTH the session metadata (for checkout.session.completed) and the
 * subscription metadata (for renewal/quantity-change events).
 */
export async function createWorkspaceSeatCheckout(pool, user, { workspaceId, seats, origin }) {
  const item = CATALOG.map(resolveItem).find((i) => i.id === 'team_seat');
  if (!item?.available) { const e = new Error('team seat price not configured (set STRIPE_PRICE_TEAM_SEAT_MONTHLY)'); e.status = 400; throw e; }
  const qty = Math.max(1, Math.floor(Number(seats) || 1));
  const base = process.env.BILLING_APP_URL || origin || siteOrigin();
  const customer = await getOrCreateCustomer(pool, user);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: String(user.id),
    line_items: [{ price: item.priceId, quantity: qty }],
    success_url: `${base}/overview/billing?billing=success&item=team_seat`,
    cancel_url: `${base}/overview/billing?billing=cancel`,
    allow_promotion_codes: true,
    ...taxCheckoutFields(),
    subscription_data: { metadata: { xenoWorkspaceId: String(workspaceId), seats: String(qty) } },
    metadata: { xenoUserId: String(user.id), itemId: 'team_seat', kind: 'subscription', xenoWorkspaceId: String(workspaceId), seats: String(qty) },
  });
  return { url: session.url, id: session.id };
}

/** Persist a workspace's team plan + seat limit into workspaces.metadata.billing (merge). */
async function setWorkspacePlan(pool, workspaceId, { plan, status, subId = null, seats = null, periodEnd = null }) {
  const patch = { plan, status };
  if (subId) patch.stripe_subscription_id = subId;
  if (seats != null) patch.seat_limit = Number(seats);
  if (periodEnd) patch.current_period_end = periodEnd;
  await pool.query(
    "UPDATE workspaces SET metadata = jsonb_set(COALESCE(metadata,'{}'::jsonb), '{billing}', COALESCE(metadata->'billing','{}'::jsonb) || $1::jsonb, true), updated_at = now() WHERE id = $2",
    [JSON.stringify(patch), String(workspaceId)],
  );
}

/** Stripe billing portal (manage/cancel subscription, update card). */
export async function createPortal(pool, user, { origin }) {
  await ensureSchema(pool);
  const uid = String(user.id);
  const found = await pool.query('SELECT stripe_customer_id FROM billing_customers WHERE user_id = $1', [uid]);
  const customer = found.rows[0]?.stripe_customer_id;
  if (!customer) { const e = new Error('no billing customer yet'); e.status = 404; throw e; }
  const base = process.env.BILLING_APP_URL || origin || siteOrigin();
  const portal = await stripe.billingPortal.sessions.create({ customer, return_url: `${base}/overview/billing` });
  return { url: portal.url };
}

export async function getSummary(pool, user) {
  const balance = await getBalanceV2(pool, String(user.id));
  const ent = await getEntitlements(pool, user.id);
  return {
    enabled: isEnabled(),
    credits: Math.floor((balance.availableMicro || 0) / MICRO_PER_CREDIT),
    balance,
    plan: ent.plan,
    status: ent.status,
    currentPeriodEnd: ent.currentPeriodEnd,
    entitlements: ent.entitlements,
  };
}

// ── Webhook ──────────────────────────────────────────────────────────────────
export function constructEvent(rawBody, signature) {
  if (!WEBHOOK_SECRET) { const e = new Error('STRIPE_WEBHOOK_SECRET not set'); e.status = 500; throw e; }
  return stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
}

/** Claim the event id on an EXISTING tx client; true only the FIRST time (idempotency). */
async function claimEventTx(client, event, userId) {
  const r = await client.query(
    `INSERT INTO billing_events (event_id, type, user_id) VALUES ($1, $2, $3)
     ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    [event.id, event.type, userId ? String(userId) : null],
  );
  return r.rows.length > 0;
}

/**
 * ATOMIC money-in: claim the event AND grant the credits AND record the charge
 * mapping in ONE transaction. If any step fails the whole thing rolls back — so a
 * crash / DB blip never leaves an event "claimed" without the credits (Stripe's
 * retry then re-runs cleanly). Idempotent: a redelivered event no-ops on the
 * billing_events PK, and the grant is independently guarded by uq_credit_txn_ref.
 */
async function grantCreditsForEvent(pool, event, userId, credits, session) {
  await ensureSchema(pool);
  const amountMicro = Math.round(credits) * MICRO_PER_CREDIT;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (await claimEventTx(client, event, userId)) {
      // Stripe subjects are always real users (the checkout session's platform user).
      await addGrantTx(client, String(userId), {
        amountMicro, kind: 'paid', sourceRef: `stripe:${event.id}`, ownerKind: 'user',
      });
      const pi = session?.payment_intent ? String(session.payment_intent) : null;
      if (pi) {
        await client.query(
          `INSERT INTO billing_charges (payment_intent, user_id, credits_micro, event_id)
           VALUES ($1,$2,$3,$4) ON CONFLICT (payment_intent) DO NOTHING`,
          [pi, String(userId), String(amountMicro), event.id],
        );
      }
      console.log(`💳 [billing] granted ${credits} credits to user ${userId} (top-up ${event.id})`);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}

/**
 * Claw back credits for a Stripe refund/dispute in ONE transaction, idempotent on
 * the Stripe event id. Uses billing_charges (payment_intent → granted credits) to
 * cap the reversal and track cumulative refunded_micro, so partial + repeated
 * refunds never over- or under-claw. Optionally freezes the account (dispute).
 */
async function clawbackForCharge(pool, event, { paymentIntent, targetRefundMicro, freeze = false }) {
  await ensureSchema(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await claimEventTx(client, event, null))) { await client.query('COMMIT'); return { handled: true, duplicate: true }; }
    const row = (await client.query(
      'SELECT user_id, credits_micro, refunded_micro FROM billing_charges WHERE payment_intent=$1 FOR UPDATE',
      [paymentIntent],
    )).rows[0];
    if (!row) { await client.query('COMMIT'); return { handled: true, reason: 'no charge mapping' }; }
    const target = Math.min(Number(targetRefundMicro), Number(row.credits_micro));
    const delta = target - Number(row.refunded_micro);
    if (delta > 0) {
      const r = await clawbackTx(client, String(row.user_id), delta, {
        refType: 'stripe.refund', refId: event.id, description: `refund ${event.type}`,
        metadata: { paymentIntent, eventType: event.type },
        ownerKind: 'user', // billing_charges.user_id is always a platform user
      });
      await client.query('UPDATE billing_charges SET refunded_micro=$1 WHERE payment_intent=$2', [String(target), paymentIntent]);
      if (r.shortfallMicro > 0) console.warn(`⚠️ [billing] refund shortfall ${r.shortfallMicro}µcr (already spent) user ${row.user_id} (${event.id})`);
    }
    if (freeze) {
      await client.query('UPDATE credit_accounts SET is_frozen=true, updated_at=now() WHERE user_id=$1', [String(row.user_id)]);
      // Release any in-flight reservations so a pending settle can't spend clawed-back credits.
      await client.query("UPDATE credit_holds SET state='voided', updated_at=now() WHERE user_id=$1 AND state='held'", [String(row.user_id)]);
    }
    await client.query('COMMIT');
    console.log(`💳 [billing] clawed back ${Math.max(0, delta)}µcr from user ${row.user_id} (${event.type} ${event.id}${freeze ? ', frozen' : ''})`);
    return { handled: true };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}

/** Resolve a dispute's payment_intent (present directly in recent API; else via the charge). */
async function resolveDisputePI(dispute) {
  if (dispute.payment_intent) return String(dispute.payment_intent);
  if (dispute.charge) {
    try { const ch = await stripe.charges.retrieve(String(dispute.charge)); return ch.payment_intent ? String(ch.payment_intent) : null; }
    catch { return null; }
  }
  return null;
}

/**
 * Process a verified Stripe event. Idempotent + defensive: unknown/irrelevant
 * events are acked (return handled:false) so Stripe stops retrying.
 */
export async function handleEvent(pool, event) {
  const obj = event.data.object;
  switch (event.type) {
    // Fires when a Checkout completes — for BOTH subscriptions and one-time packs.
    // async_payment_succeeded covers delayed-settlement methods (the session can
    // complete UNPAID and settle later); it's always a payment-mode grant.
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = obj;
      const uid = session.metadata?.xenoUserId || session.client_reference_id;
      // Persist the customer↔user mapping (needed for renewal/lifecycle events).
      if (session.customer && uid) {
        await pool.query(
          `INSERT INTO billing_customers (user_id, stripe_customer_id) VALUES ($1,$2)
           ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id`,
          [String(uid), String(session.customer)],
        ).catch(() => {});
      }
      if (!uid) return { handled: false, reason: 'no uid on session' };

      if (session.mode === 'subscription') {
        const wsId = session.metadata?.xenoWorkspaceId;
        if (wsId) {
          // Per-seat Team subscription → set the WORKSPACE plan + seat limit.
          const seats = Number(session.metadata?.seats || 1);
          await setWorkspacePlan(pool, wsId, { plan: 'team', status: 'active', subId: session.subscription || null, seats });
          console.log(`💳 [billing] workspace ${wsId} → team plan, ${seats} seats (checkout ${event.id})`);
        } else {
          // Personal subscription → set the user PLAN (from the item metadata; no credit grant).
          const plan = planForItemId(session.metadata?.itemId) || 'pro';
          await setPlan(pool, uid, { plan, status: 'active', subId: session.subscription || null });
          console.log(`💳 [billing] user ${uid} → plan '${plan}' (checkout ${event.id})`);
        }
      } else if (session.mode === 'payment') {
        // One-time top-up pack → GRANT credits (atomic claim+grant, idempotent).
        // Grant on any SETTLED session: 'paid' (card / async-settled) or
        // 'no_payment_required' ($0, e.g. a 100%-off promo code). Defer ONLY a
        // genuinely 'unpaid' async-pending session to async_payment_succeeded.
        const credits = Number(session.metadata?.credits || 0);
        if (credits > 0 && session.payment_status !== 'unpaid') {
          await grantCreditsForEvent(pool, event, uid, credits, session);
        }
      }
      return { handled: true };
    }

    // Subscription paid (first payment + every renewal) → keep plan active, refresh period.
    // NOTE: subscriptions do NOT grant credits — credits are separate top-ups only.
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const invoice = obj;
      const uid = await userIdForCustomer(pool, invoice.customer);
      if (!uid) return { handled: false, reason: 'no user for customer' };
      const subId = subIdFromInvoice(invoice);
      if (subId) {
        const periodEnd = periodEndFromInvoice(invoice);
        const cur = await getPlan(pool, uid);
        const plan = cur.plan === 'free' ? 'pro' : cur.plan; // safety if checkout event was missed
        await setPlan(pool, uid, { plan, status: 'active', subId, periodEnd });
      }
      return { handled: true };
    }

    // Subscription created/changed (upgrade, downgrade, cancel-at-period-end) → sync plan/status.
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = obj;
      const wsId = sub.metadata?.xenoWorkspaceId;
      if (wsId) {
        // Workspace per-seat sub → sync plan/status + seat quantity (add/remove-seat proration).
        const seats = sub.items?.data?.[0]?.quantity ?? Number(sub.metadata?.seats || 1);
        const periodEnd = periodEndFromSub(sub);
        await setWorkspacePlan(pool, wsId, { plan: 'team', status: sub.status, subId: sub.id, seats, periodEnd });
        console.log(`💳 [billing] workspace ${wsId} → team status '${sub.status}', ${seats} seats (${event.type})`);
        return { handled: true };
      }
      const uid = await userIdForCustomer(pool, sub.customer);
      if (!uid) return { handled: false, reason: 'no user for customer' };
      const priceId = sub.items?.data?.[0]?.price?.id;
      const plan = planForPriceId(priceId) || 'pro';
      const periodEnd = periodEndFromSub(sub);
      await setPlan(pool, uid, { plan, status: sub.status, subId: sub.id, periodEnd });
      console.log(`💳 [billing] user ${uid} → plan '${plan}' status '${sub.status}' (sub ${event.type})`);
      return { handled: true };
    }

    // Subscription ended → downgrade to free.
    case 'customer.subscription.deleted': {
      const sub = obj;
      const wsId = sub.metadata?.xenoWorkspaceId;
      if (wsId) {
        await setWorkspacePlan(pool, wsId, { plan: 'free', status: 'canceled', subId: sub.id });
        console.log(`💳 [billing] workspace ${wsId} → free (subscription canceled)`);
        return { handled: true };
      }
      const uid = await userIdForCustomer(pool, sub.customer);
      if (!uid) return { handled: false, reason: 'no user for customer' };
      await setPlan(pool, uid, { plan: 'free', status: 'canceled', subId: sub.id });
      console.log(`💳 [billing] user ${uid} → free (subscription canceled)`);
      return { handled: true };
    }

    // Payment failed → mark past_due (Stripe retries; grace period keeps plan for now).
    case 'invoice.payment_failed': {
      const invoice = obj;
      const uid = await userIdForCustomer(pool, invoice.customer);
      if (!uid) return { handled: false, reason: 'no user for customer' };
      const cur = await getPlan(pool, uid);
      await setPlan(pool, uid, { plan: cur.plan, status: 'past_due', subId: invoice.subscription || null });
      return { handled: true };
    }

    // Refund → claw back the proportional credits (idempotent on the event id).
    case 'charge.refunded': {
      await ensureSchema(pool);
      const charge = obj;
      const pi = charge.payment_intent ? String(charge.payment_intent) : null;
      if (!pi) return { handled: false, reason: 'no payment_intent on charge' };
      const amount = Number(charge.amount || 0);
      const refunded = Number(charge.amount_refunded || 0);
      if (amount <= 0 || refunded <= 0) return { handled: true };
      const mapped = (await pool.query('SELECT credits_micro FROM billing_charges WHERE payment_intent=$1', [pi])).rows[0];
      if (!mapped) return { handled: true, reason: 'no charge mapping' };
      const targetRefundMicro = Math.round(Number(mapped.credits_micro) * (refunded / amount));
      return await clawbackForCharge(pool, event, { paymentIntent: pi, targetRefundMicro });
    }

    // Dispute opened → freeze the account (stop further spend during the dispute).
    case 'charge.dispute.created': {
      await ensureSchema(pool);
      const pi = await resolveDisputePI(obj);
      if (pi) {
        // Resolve the owner first, then freeze via a parameterized uuid predicate
        // (a text subquery would be `uuid = text`, which Postgres rejects at plan time).
        const owner = (await pool.query('SELECT user_id FROM billing_charges WHERE payment_intent=$1', [pi])).rows[0];
        if (owner) await pool.query('UPDATE credit_accounts SET is_frozen=true, updated_at=now() WHERE user_id=$1', [String(owner.user_id)]);
      }
      return { handled: true };
    }

    // Chargeback funds pulled → claw back the FULL grant + keep the account frozen.
    case 'charge.dispute.funds_withdrawn': {
      await ensureSchema(pool);
      const pi = await resolveDisputePI(obj);
      if (!pi) return { handled: false, reason: 'no payment_intent on dispute' };
      const mapped = (await pool.query('SELECT credits_micro FROM billing_charges WHERE payment_intent=$1', [pi])).rows[0];
      if (!mapped) return { handled: true, reason: 'no charge mapping' };
      return await clawbackForCharge(pool, event, { paymentIntent: pi, targetRefundMicro: Number(mapped.credits_micro), freeze: true });
    }

    default:
      return { handled: false, reason: `unhandled type ${event.type}` };
  }
}
