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
 * Exit 0 = every configured price agrees with the catalogue.
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
if (!getInternalCatalog || !priceIssues) {
  console.error('Could not load billingService.js from any known layout.');
  console.error('Run this from the repo root, or from /app inside xenostudio-backend.');
  process.exit(2);
}

const KEY = process.env.STRIPE_SECRET_KEY || '';
const WEBHOOK = process.env.STRIPE_WEBHOOK_SECRET || '';
const PUB = process.env.STRIPE_PUBLISHABLE_KEY || '';

/* Never print a secret to prove it is set. `${v:-…}` expands to the VALUE when
 * set — the trap that leaked a live token in this workspace on 2026-08-19. */
const state = (v) => (v ? `set (${v.length} chars)` : 'MISSING');
const mode = KEY.startsWith('sk_live_') ? 'LIVE' : KEY.startsWith('sk_test_') ? 'TEST' : 'unknown';

console.log('XENO billing preflight');
console.log('─'.repeat(72));
console.log(`  STRIPE_SECRET_KEY        ${state(KEY)}${KEY ? `  → ${mode} mode` : ''}`);
console.log(`  STRIPE_PUBLISHABLE_KEY   ${state(PUB)}`);
console.log(`  STRIPE_WEBHOOK_SECRET    ${state(WEBHOOK)}`);
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
if (KEY && mode === 'unknown') warn('STRIPE_SECRET_KEY is set but is neither sk_test_ nor sk_live_.');

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
  const stripe = new Stripe(KEY);
  console.log('');
  console.log('Verifying each configured price against Stripe (read-only)');
  console.log('─'.repeat(72));

  for (const i of configured) {
    let price;
    try {
      price = await stripe.prices.retrieve(i.priceId);
    } catch (e) {
      warn(`${i.id}: ${i.priceEnv} does not resolve to a Stripe Price (${e.message})`);
      continue;
    }

    /* The comparison is a PURE function in src/server/utils/priceAgreement.js,
     * so the cases that matter — an archived price, a monthly price on an annual
     * item, a recurring credit pack — are unit-tested rather than waiting to be
     * discovered in a real Stripe dashboard. */
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
    const handled = [...new Set([...svc.matchAll(/case '([a-z_]+\.[a-z_.]+)':/g)].map((m) => m[1]))].sort();

    if (handled.length < 5) {
      /* Guard the DERIVATION. If the parser stops finding cases, the honest
       * report is "I cannot tell", never "the webhook is fine". */
      console.log(`  ⚠  could not read the handled events (found ${handled.length}) — coverage NOT verified`);
    } else {
      const eps = (await stripe.webhookEndpoints.list({ limit: 10 })).data;
      if (!eps.length) {
        warn('no webhook endpoint is registered — no payment would ever be recorded');
      }
      for (const ep of eps) {
        const enabled = new Set(ep.enabled_events || []);
        const missing = enabled.has('*') ? [] : handled.filter((e) => !enabled.has(e));
        if (missing.length) {
          warn(`${ep.url} is missing ${missing.length} of ${handled.length} handled event(s): ${missing.join(', ')}`);
        } else {
          console.log(`  ✓  ${ep.url} delivers all ${handled.length}`);
        }
      }
    }
  } catch (e) {
    /* Advisory: this needs a live Stripe call, and a network blip must not read
     * as a broken configuration. */
    console.log(`  ⚠  could not verify webhook coverage — ${e.message}`);
  }
}

console.log('');
console.log('─'.repeat(72));
if (problems) {
  console.log(`${problems} problem${problems === 1 ? '' : 's'}. Billing is NOT ready.`);
  process.exit(1);
}
console.log('Billing configuration is consistent with the catalogue.');
