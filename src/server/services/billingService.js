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
import { addGrant, getBalanceV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';

const SECRET = process.env.STRIPE_SECRET_KEY || '';
const PUBLISHABLE = process.env.STRIPE_PUBLISHABLE_KEY || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

/** Stripe client — null until a secret key is configured (feature flag). */
const stripe = SECRET ? new Stripe(SECRET) : null;

export function isEnabled() {
  return Boolean(stripe);
}

// ── Catalog ─────────────────────────────────────────────────────────────────
// Each item resolves its Stripe Price id from an env var. An item with no
// configured price is returned as `available: false` (the UI can hide/disable
// it), so partial configuration never 500s.
const CATALOG = [
  { id: 'credits_small',  kind: 'credits',      label: 'Starter',  credits: 1000,  usd: 10,  priceEnv: 'STRIPE_PRICE_CREDITS_SMALL' },
  { id: 'credits_medium', kind: 'credits',      label: 'Plus',     credits: 5500,  usd: 50,  priceEnv: 'STRIPE_PRICE_CREDITS_MEDIUM', badge: 'Best value' },
  { id: 'credits_large',  kind: 'credits',      label: 'Pro pack', credits: 12000, usd: 100, priceEnv: 'STRIPE_PRICE_CREDITS_LARGE' },
  { id: 'pro_monthly',    kind: 'subscription', label: 'Pro (Founding)', plan: 'pro',  credits: 0, usd: 24, interval: 'month', priceEnv: 'STRIPE_PRICE_PRO_MONTHLY' },
  { id: 'team_monthly',   kind: 'subscription', label: 'Team',     plan: 'team', credits: 0, usd: 60,  interval: 'month', priceEnv: 'STRIPE_PRICE_TEAM_MONTHLY' },
  // Per-seat Team (LOCKED strategy: ~€40/seat/mo). Stripe quantity = active seats.
  { id: 'team_seat',      kind: 'subscription', label: 'Team (per seat)', plan: 'team', credits: 0, usd: 40, interval: 'month', perSeat: true, priceEnv: 'STRIPE_PRICE_TEAM_SEAT_MONTHLY' },
];

function resolveItem(raw) {
  const priceId = process.env[raw.priceEnv] || null;
  return { ...raw, priceId, available: Boolean(priceId) };
}

/** Public catalog (never leaks price env NAMES, only ids/labels/availability). */
export function getCatalog() {
  return CATALOG.map(resolveItem).map(({ priceEnv, ...pub }) => pub);
}

export function getConfig() {
  return { enabled: isEnabled(), publishableKey: PUBLISHABLE, catalog: getCatalog() };
}

// ── Plans & entitlements ─────────────────────────────────────────────────────
// Subscriptions gate FEATURES, not credits (see XENO-MONETIZATION-AND-ACCOUNT.md).
// One entitlement source of truth, read by every product. inHouseDailyLimit
// null = unlimited. Tune the specific limits later; the shape is the contract.
const PLAN_ENTITLEMENTS = {
  free: { plan: 'free', watermark: true,  commercial: false, maxResolution: 'standard', priority: false, inHouseDailyLimit: 50,   privateProjects: false, teamSeats: 0 },
  pro:  { plan: 'pro',  watermark: false, commercial: true,  maxResolution: '4k',       priority: true,  inHouseDailyLimit: null, privateProjects: true,  teamSeats: 0 },
  team: { plan: 'team', watermark: false, commercial: true,  maxResolution: '4k',       priority: true,  inHouseDailyLimit: null, privateProjects: true,  teamSeats: 5 },
};

/** Feature entitlements for a plan (defaults to free). */
export function entitlementsFor(plan) {
  return PLAN_ENTITLEMENTS[plan] || PLAN_ENTITLEMENTS.free;
}

const planForItemId = (itemId) => CATALOG.find((i) => i.id === itemId)?.plan || null;
const planForPriceId = (priceId) => CATALOG.map(resolveItem).find((i) => i.priceId && i.priceId === priceId)?.plan || null;

// Stripe subscription statuses that still grant the plan (past_due = grace period).
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

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
export async function createCheckout(pool, user, itemId, { origin }) {
  const item = CATALOG.map(resolveItem).find((i) => i.id === itemId);
  if (!item) { const e = new Error('unknown item'); e.status = 400; throw e; }
  if (!item.available) { const e = new Error(`item "${itemId}" has no configured price (set ${item.priceEnv})`); e.status = 400; throw e; }

  const base = process.env.BILLING_APP_URL || origin || 'https://xenostudio.ai';
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
  const base = process.env.BILLING_APP_URL || origin || 'https://xenostudio.ai';
  const customer = await getOrCreateCustomer(pool, user);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: String(user.id),
    line_items: [{ price: item.priceId, quantity: qty }],
    success_url: `${base}/overview/billing?billing=success&item=team_seat`,
    cancel_url: `${base}/overview/billing?billing=cancel`,
    allow_promotion_codes: true,
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
  const base = process.env.BILLING_APP_URL || origin || 'https://xenostudio.ai';
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

/** Insert the event id; returns true only the FIRST time (idempotency guard). */
async function claimEvent(pool, event, userId) {
  await ensureSchema(pool);
  const r = await pool.query(
    `INSERT INTO billing_events (event_id, type, user_id) VALUES ($1, $2, $3)
     ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    [event.id, event.type, userId ? String(userId) : null],
  );
  return r.rows.length > 0;
}

async function grantCredits(pool, userId, credits, sourceRef) {
  await addGrant(pool, String(userId), {
    amountMicro: Math.round(credits) * MICRO_PER_CREDIT,
    kind: 'paid',
    sourceRef,
  });
}

/**
 * Process a verified Stripe event. Idempotent + defensive: unknown/irrelevant
 * events are acked (return handled:false) so Stripe stops retrying.
 */
export async function handleEvent(pool, event) {
  const obj = event.data.object;
  switch (event.type) {
    // Fires when a Checkout completes — for BOTH subscriptions and one-time packs.
    case 'checkout.session.completed': {
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
        // One-time top-up pack → GRANT credits (from metadata; idempotent).
        const credits = Number(session.metadata?.credits || 0);
        if (credits > 0 && await claimEvent(pool, event, uid)) {
          await grantCredits(pool, uid, credits, `stripe:${event.id}`);
          console.log(`💳 [billing] granted ${credits} credits to user ${uid} (top-up pack ${event.id})`);
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
      if (invoice.subscription) {
        const periodEnd = invoice.period_end ? new Date(invoice.period_end * 1000) : null;
        const cur = await getPlan(pool, uid);
        const plan = cur.plan === 'free' ? 'pro' : cur.plan; // safety if checkout event was missed
        await setPlan(pool, uid, { plan, status: 'active', subId: invoice.subscription, periodEnd });
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
        const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
        await setWorkspacePlan(pool, wsId, { plan: 'team', status: sub.status, subId: sub.id, seats, periodEnd });
        console.log(`💳 [billing] workspace ${wsId} → team status '${sub.status}', ${seats} seats (${event.type})`);
        return { handled: true };
      }
      const uid = await userIdForCustomer(pool, sub.customer);
      if (!uid) return { handled: false, reason: 'no user for customer' };
      const priceId = sub.items?.data?.[0]?.price?.id;
      const plan = planForPriceId(priceId) || 'pro';
      const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
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

    default:
      return { handled: false, reason: `unhandled type ${event.type}` };
  }
}
