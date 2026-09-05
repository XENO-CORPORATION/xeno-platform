#!/usr/bin/env node
/**
 * Prove the Stripe configuration is correct BEFORE a real customer finds out.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * Since 2026-08-24 a plan is not a nice-to-have: `canDownload` means nobody can
 * install a XENO app without one. So "billing works" stopped being a revenue
 * question and became the difference between having a product and not.
 *
 * The failure this exists to catch is not "Stripe is off" — that is loud and
 * obvious (`/api/billing/config` reports enabled:false). It is the QUIET one:
 * a price env pointing at a Stripe Price whose amount, currency, interval or
 * recurrence does not match what the site advertises. The page renders, the
 * button works, checkout opens — and charges the wrong number. billingService
 * already overlays the live Stripe amount for exactly this reason, which means
 * a mismatch does not error, it silently RE-PRICES the product.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 *
 * Read-only. Every Stripe call is a GET. It writes nothing, to Stripe or to us.
 *
 *   node scripts/billing-preflight.mjs
 *
 * Run it inside the backend container, where the env actually lives:
 *   sudo docker cp scripts/billing-preflight.mjs xenostudio-backend:/app/
 *   sudo docker exec xenostudio-backend node /app/billing-preflight.mjs
 *
 * Requires STRIPE_EXPECTED_ACCOUNT_ID and STRIPE_EXPECTED_MODE=test|live.
 * Exit 0 = pinned account/mode, configured prices and endpoint coverage agree.
 * Not proof of delivered events, secret matching, tax or completed payments.
 * Exit 1 = something is wrong, or nothing is configured at all.
 */
/* The catalogue lives in one place and this script must not restate it. Where
 * that place SITS depends on where the script runs: from the repo it is
 * src/server/services/, and inside the backend container /app IS src/server, so
 * there is no scripts/ dir to be relative to. Try both rather than making the
 * operator care — the same footgun already cost a cycle on grant-internal-plan. */
import { readFileSync } from 'node:fs';

let getInternalCatalog;
for (const p of ['../src/server/services/billingService.js', './services/billingService.js', '/app/services/billingService.js']) {
  try { ({ getInternalCatalog } = await import(p)); break; } catch { /* try the next layout */ }
}
let priceIssues;
for (const p of ['../src/server/utils/priceAgreement.js', './utils/priceAgreement.js', '/app/utils/priceAgreement.js']) {
  try { ({ priceIssues } = await import(p)); break; } catch { /* try the next layout */ }
}
let verifyBillingWebhooks;
for (const p of ['../src/server/utils/billingWebhookVerification.js', './utils/billingWebhookVerification.js', '/app/utils/billingWebhookVerification.js']) {
  try { ({ verifyBillingWebhooks } = await import(p)); break; } catch { /* try the next layout */ }
}
if (!getInternalCatalog || !priceIssues || !verifyBillingWebhooks) {
  console.error('Could not load billingService.js from any known layout.');
  console.error('Run this from the repo root, or from /app inside xenostudio-backend.');
  process.exit(2);
}

const KEY = process.env.STRIPE_SECRET_KEY || '';
const WEBHOOK = process.env.STRIPE_WEBHOOK_SECRET || '';
const PUB = process.env.STRIPE_PUBLISHABLE_KEY || '';
const EXPECTED_ACCOUNT = process.env.STRIPE_EXPECTED_ACCOUNT_ID || '';
const EXPECTED_MODE = process.env.STRIPE_EXPECTED_MODE || '';
const PORTAL_CONFIG = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION || '';

/* Never print a secret to prove it is set. `${v:-…}` expands to the VALUE when
 * set — the trap that leaked a live token in this workspace on 2026-08-19. */
const state = (v) => (v ? `set (${v.length} chars)` : 'MISSING');
const mode = /^(sk|rk)_live_[A-Za-z0-9]+$/.test(KEY) ? 'LIVE'
  : /^(sk|rk)_test_[A-Za-z0-9]+$/.test(KEY) ? 'TEST' : 'unknown';

console.log('XENO billing preflight');
console.log('─'.repeat(72));
console.log(`  STRIPE_SECRET_KEY        ${state(KEY)}${KEY ? `  → ${mode} mode` : ''}`);
console.log(`  STRIPE_PUBLISHABLE_KEY   ${state(PUB)}`);
console.log(`  STRIPE_WEBHOOK_SECRET    ${state(WEBHOOK)}`);
console.log(`  STRIPE_BILLING_PORTAL_CONFIGURATION ${PORTAL_CONFIG ? 'set' : 'MISSING'}`);
console.log(`  BILLING_CURRENCY         ${process.env.BILLING_CURRENCY || 'eur (default)'}`);
console.log(`  XENO_FOUNDING_PRICING    ${process.env.XENO_FOUNDING_PRICING || 'open (default)'}`);
console.log('');

let problems = 0;
const warn = (m) => { problems++; console.log(`  ✗ ${m}`); };

if (!KEY) {
  warn('STRIPE_SECRET_KEY is not set — checkout is disabled and NOBODY CAN BUY A PLAN.');
  warn('Since the download gate, that also means nobody can install a XENO app.');
}
if (!WEBHOOK) {
  warn('STRIPE_WEBHOOK_SECRET is not set — payments would succeed and NEVER GRANT A PLAN.');
  warn('This is the worst state to ship: the customer is charged and stays locked out.');
}
if (KEY && mode === 'unknown') warn('STRIPE_SECRET_KEY must be an account-level secret or restricted test/live key.');
if (!/^acct_[A-Za-z0-9]+$/.test(EXPECTED_ACCOUNT)) warn('STRIPE_EXPECTED_ACCOUNT_ID must explicitly identify the intended account.');
if (!['test', 'live'].includes(EXPECTED_MODE)) warn('STRIPE_EXPECTED_MODE must explicitly be test or live.');
if (mode.toLowerCase() !== EXPECTED_MODE) warn('Secret key mode does not match STRIPE_EXPECTED_MODE.');
if (!new RegExp(`^pk_${['test', 'live'].includes(EXPECTED_MODE) ? EXPECTED_MODE : 'invalid'}_[A-Za-z0-9]+$`).test(PUB)) {
  warn('Publishable key is missing, malformed or does not match STRIPE_EXPECTED_MODE.');
}
if (EXPECTED_MODE === 'live' && !/^bpc_[A-Za-z0-9]+$/.test(PORTAL_CONFIG)) {
  warn('STRIPE_BILLING_PORTAL_CONFIGURATION must pin the reviewed live portal policy.');
}
// Refuse before any provider request, including when caller supplied malformed pins.
if (problems) {
  console.log('Billing account configuration is NOT ready; no provider requests made.');
  process.exit(1);
}

const catalog = getInternalCatalog();
const unconfigured = catalog.filter((i) => !i.priceId && !i.legacy);
const configured = catalog.filter((i) => i.priceId);

console.log(`Catalogue: ${catalog.length} items — ${configured.length} configured, ${unconfigured.length} not (excluding legacy)`);
console.log('─'.repeat(72));

for (const i of unconfigured) {
  console.log(`  ·  ${i.id.padEnd(20)} ${i.priceEnv.padEnd(34)} not set → hidden from the site`);
}

/* A plan nobody can buy is the one that matters: without at least one purchasable
 * subscription, every refused download is a dead end. */
const sellable = configured.filter((i) => i.kind === 'subscription' && !i.legacy);
if (!sellable.length) {
  warn('No subscription price is configured — every refused download leads nowhere.');
}

if (KEY && configured.length) {
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(KEY, { apiVersion: '2025-02-24.acacia', timeout: 15000, maxNetworkRetries: 1 });
  try {
    // No ID argument: verify the account the KEY belongs to, not a connected account.
    const account = await stripe.accounts.retrieve();
    // Stripe's own-account response may omit nullable verification details.
    // This is limited capability evidence, never a claim of completed KYC.
    const verificationNotExposed = account?.requirements == null;
    const ownStandardAccount = account?.type === 'standard'
      && account?.controller?.type === 'account'
      && account?.capabilities?.card_payments === 'active';
    const requirementsReady = verificationNotExposed ? ownStandardAccount
      : typeof account.requirements === 'object' && !Array.isArray(account.requirements)
        && account.requirements.disabled_reason === null
        && ['currently_due', 'past_due', 'pending_verification'].every(field =>
          Array.isArray(account.requirements[field]) && account.requirements[field].length === 0);
    if (account?.object !== 'account' || account.id !== EXPECTED_ACCOUNT) {
      warn('Authenticated Stripe account does not match STRIPE_EXPECTED_ACCOUNT_ID.');
    } else if (mode === 'LIVE' && (
      account.charges_enabled !== true || account.payouts_enabled !== true || account.details_submitted !== true
      || !requirementsReady
    )) {
      warn('Live account capabilities or verification requirements are not confirmed ready.');
    } else {
      console.log(`  ✓ Authenticated account ${EXPECTED_ACCOUNT}; expected ${mode} mode confirmed.`);
      if (mode === 'LIVE' && verificationNotExposed) {
        console.log('  ! Verification details were not exposed; Dashboard review remains necessary. Enabled capabilities are not KYC approval.');
      }
    }
  } catch {
    warn('Could not verify the authenticated Stripe account. Check key permissions and connectivity.');
  }
  if (problems) {
    console.log('Billing account qualification failed; price and webhook checks not performed.');
    process.exit(1);
  }
  if (mode === 'LIVE') {
    console.log('');
    console.log('Verifying the customer Billing Portal policy (read-only)');
    console.log('─'.repeat(72));
    try {
      const portal = await stripe.billingPortal.configurations.retrieve(PORTAL_CONFIG);
      const f = portal?.features;
      const base = process.env.BILLING_APP_URL || 'https://xenostudio.ai';
      const expectedReturn = new URL('/overview/billing', base).href;
      const valid = portal?.object === 'billing_portal.configuration'
        && portal.id === PORTAL_CONFIG && portal.active === true && portal.livemode === true
        && portal.default_return_url === expectedReturn
        && f?.customer_update?.enabled === true
        && Array.isArray(f.customer_update.allowed_updates)
        && ['address', 'email', 'name', 'tax_id'].every(value => f.customer_update.allowed_updates.includes(value))
        && f?.invoice_history?.enabled === true && f?.payment_method_update?.enabled === true
        && f?.subscription_cancel?.enabled === true && f.subscription_cancel.mode === 'at_period_end'
        && f.subscription_cancel.proration_behavior === 'none'
        && f?.subscription_update?.enabled === false;
      if (!valid) warn('Pinned live Billing Portal configuration does not match the reviewed XENO policy.');
      else console.log(`  ✓ Reviewed portal configuration ${PORTAL_CONFIG} is active and policy-matched.`);
    } catch {
      warn('Could not verify the pinned live Billing Portal configuration. Check its ID, permissions and connectivity.');
    }
    if (problems) {
      console.log('Billing portal qualification failed; price and webhook checks not performed.');
      process.exit(1);
    }
  }
  console.log('');
  console.log('Verifying each configured price against Stripe (read-only)');
  console.log('─'.repeat(72));

  for (const i of configured) {
    let price;
    try {
      price = await stripe.prices.retrieve(i.priceId);
    } catch {
      // Provider exceptions can contain credentials or request details.
      warn(`${i.id}: ${i.priceEnv} could not be verified as a Stripe Price. Check the price ID, key mode, permissions and connectivity.`);
      continue;
    }

    /* The comparison is a PURE function in src/server/utils/priceAgreement.js,
     * so the cases that matter — an archived price, a monthly price on an annual
     * item, a recurring credit pack — are unit-tested rather than waiting to be
     * discovered in a real Stripe dashboard. */
    // These fields enter human-readable diagnostics; never echo arbitrary provider text.
    if (!price || !/^[a-z]{3}$/.test(price.currency || '')
      || (price.unit_amount != null && (!Number.isSafeInteger(price.unit_amount) || price.unit_amount < 0))
      || (price.recurring?.interval != null && !['day', 'week', 'month', 'year'].includes(price.recurring.interval))) {
      warn(`${i.id}: malformed Stripe Price response; details suppressed.`);
      continue;
    }
    if (price.livemode !== (mode === 'LIVE')) {
      warn(`${i.id}: Stripe Price mode does not match STRIPE_EXPECTED_MODE.`);
      continue;
    }
    const issues = priceIssues(i, price);

    if (issues.length) {
      for (const p of issues) warn(`${i.id} (${i.priceEnv}): ${p}`);
    } else {
      const cadence = i.kind === 'subscription' ? `/${price.recurring.interval}` : ' one-time';
      console.log(`  ✓  ${i.id.padEnd(20)} ${(price.unit_amount / 100).toFixed(2)} ${price.currency.toUpperCase()}${cadence}`);
    }
  }

  /* ── The webhook must DELIVER what the code handles ─────────────────────── */
  /*
   * 🔴 Found in production 2026-08-24: the endpoint was subscribed to TWO events
   * while billingService.js handled ELEVEN. The other nine were written, tested
   * and unreachable, and every one of them is a money path:
   *
   *   customer.subscription.deleted -> sets the plan to 'free'. Never ran, so a
   *                                    cancelled customer kept access forever.
   *   charge.refunded               -> claws back the entitlement. Never ran.
   *   charge.dispute.created        -> alerts a human. Never ran — and Stripe
   *                                    sets a DEADLINE that silence loses.
   *   invoice.payment_failed        -> marks past_due. No dunning at all.
   *
   * Nothing errors in this failure. Stripe delivers exactly what it was asked
   * for, the handlers never fire, and every log looks healthy.
   *
   * The handled set is DERIVED from the source, never restated here. A
   * hand-kept copy is how the gap opened: someone adds a `case`, nobody updates
   * the endpoint, and the new handler is dead on arrival with no signal. */
  console.log('');
  console.log('Webhook delivers every event the code handles');
  console.log('─'.repeat(72));
  try {
    let svc = '';
    for (const p of ['src/server/services/billingService.js', 'services/billingService.js', '/app/services/billingService.js']) {
      try { svc = readFileSync(p, 'utf8'); break; } catch { /* try the next layout */ }
    }
    const base = process.env.BILLING_APP_URL || 'https://xenostudio.ai';
    const verified = await verifyBillingWebhooks({ stripe, source: svc,
      expectedUrl: new URL('/api/billing/webhook', base).href, liveMode: mode === 'LIVE' });
    console.log(`  ✓ ${verified.endpointCount} matching enabled endpoint(s) deliver all ${verified.eventCount} handled events`);
  } catch {
    // Includes provider/network failures: unknown is not evidence of readiness.
    // Do not print raw provider errors, which can include request credentials.
    warn('Could not verify billing webhook coverage, status, mode or endpoint. Billing readiness is unproven.');
  }
}

console.log('');
console.log('─'.repeat(72));
if (problems) {
  console.log(`${problems} problem${problems === 1 ? '' : 's'}. Billing is NOT ready.`);
  process.exit(1);
}
console.log('Billing configuration is consistent with the catalogue.');
console.log('Configuration only: publishable-key ownership, webhook-secret matching/delivery, tax and completed payments remain unverified.');
