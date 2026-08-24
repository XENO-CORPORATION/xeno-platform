#!/usr/bin/env node
/**
 * PROVE THE PAID LOOP END TO END, AGAINST REAL STRIPE AND THE REAL DATABASE.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * The paid path had never run: zero consent records, zero payments, zero
 * subscriptions ever. And until today the webhook was subscribed to 2 of the 11
 * events the code handles, so nine handlers went from unreachable to reachable
 * without one of them ever executing against a real event.
 *
 * 🔴 There is also a specific suspicion to settle. billingService.js warns that
 * Stripe REJECTS automatic_tax.enabled=true unless Stripe Tax is fully
 * provisioned, and that turning it on prematurely "would break 100% of
 * checkout". STRIPE_AUTOMATIC_TAX was set to true earlier today with ZERO tax
 * registrations. Nobody has completed a checkout since — nobody ever has — so
 * that would be invisible. Step 1 settles it.
 *
 * ── REAL vs STAND-IN ────────────────────────────────────────────────────────
 *
 * REAL: createCheckout through the app's own code path, the consent gate, the
 * Stripe subscription, the webhook delivered to the production endpoint, the
 * plan write, entitlement resolution, cancellation, and the refusal afterwards.
 *
 * STAND-IN: `pm_card_visa`, Stripe's named test token — no card data exists in
 * this script. The user is a row created here and deleted at the end.
 *
 * NOT COVERED: Stripe's hosted Checkout page. That is Stripe's UI, not our code.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 *
 *   • DRY-RUN by default; --confirm to act.
 *   • REFUSES a live key, with no override — this creates subscriptions.
 *   • Everything created is tracked and removed in `finally`, including on
 *     failure, and the cleanup is VERIFIED rather than assumed.
 *   • The address is on `.invalid`, a reserved TLD that can never receive mail.
 */
import crypto from 'crypto';

const CONFIRM = process.argv.includes('--confirm');
const KEY = process.env.STRIPE_SECRET_KEY || '';
if (!KEY) { console.error('STRIPE_SECRET_KEY is not set'); process.exit(1); }
if (KEY.startsWith('sk_live_')) {
  console.error('REFUSED: live key. This creates subscriptions; there is no override.');
  process.exit(1);
}

const { default: Stripe } = await import('stripe');
const stripe = new Stripe(KEY);
const pg = (await import('pg')).default;

const pool = new pg.Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});

/* Where the services SIT depends on where this runs: from the repo it is
 * src/server/services/, and inside the backend container /app IS src/server. The
 * same footgun billing-preflight already documents. */
async function loadService(file) {
  for (const p of [`../src/server/services/${file}`, `./services/${file}`, `/app/services/${file}`]) {
    try { return await import(p); } catch { /* next layout */ }
  }
  throw new Error(`cannot load ${file} from any known layout`);
}

const MARK = crypto.randomBytes(4).toString('hex');
const EMAIL = `paid-loop-proof-${MARK}@xenostudio.invalid`;

let ok = 0, bad = 0;
const pass = (m) => { ok++; console.log(`  ok    ${m}`); };
const fail = (m) => { bad++; console.log(`  FAIL  ${m}`); };
const note = (m) => console.log(`        ${m}`);
const step = (m) => console.log(`\n── ${m}`);

const made = { userId: null, customerId: null, subId: null, consentId: null };

async function waitFor(fn, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}
const planOf = async () => (await pool.query(
  'SELECT plan, status FROM xeno_account_plans WHERE user_id::text = $1', [made.userId],
)).rows[0] || null;

try {
  console.log(`PAID LOOP PROOF — ${CONFIRM ? 'CONFIRM' : 'DRY-RUN'}, Stripe TEST mode`);
  console.log('─'.repeat(74));
  console.log(`  marker ${MARK}   user ${EMAIL}`);
  console.log(`  STRIPE_AUTOMATIC_TAX=${process.env.STRIPE_AUTOMATIC_TAX || '(unset)'}`);

  if (!CONFIRM) {
    console.log('\n  would: create a user + billing_customers mapping; call createCheckout');
    console.log('         WITHOUT consent (must refuse) and WITH consent (must return a');
    console.log('         Stripe URL); create a Pro subscription with pm_card_visa; wait');
    console.log('         for the webhook; assert the plan lands and entitlement opens;');
    console.log('         cancel; assert the plan drops and entitlement closes; then');
    console.log('         delete everything and verify it is gone.');
    console.log('\nDRY-RUN — nothing created. Re-run with --confirm.');
    process.exit(0);
  }

  /* ── 0 · the account ───────────────────────────────────────────────────── */
  step('0 · test account');
  const u = await pool.query(
    `INSERT INTO users (email, username, display_name, password_hash, is_active, role)
     VALUES ($1,$2,$3,$4,TRUE,'user') RETURNING id`,
    [EMAIL, `paidloop${MARK}`, `Paid Loop ${MARK}`, 'x'.repeat(60)],
  );
  made.userId = u.rows[0].id;
  pass(`user ${made.userId}`);

  /* ── 1 · 🔴 does checkout still work with automatic_tax on? ────────────── */
  step('1 · createCheckout — the automatic_tax question');
  const { createCheckout } = await loadService('billingService.js');
  const user = { id: made.userId, email: EMAIL };

  /* 1a · the consent gate must REFUSE first. */
  let refused = null;
  try {
    /* itemId is the THIRD POSITIONAL argument, not a field on an options object. */
    await createCheckout(pool, user, 'pro_monthly');
  } catch (e) { refused = e; }
  if (refused && (refused.code === 'consent_required' || /consent/i.test(refused.message))) {
    pass('refuses without consent (the withdrawal-waiver gate fires)');
  } else if (refused) {
    fail(`refused for the WRONG reason: ${refused.code || ''} ${refused.message}`);
    if (/tax/i.test(refused.message)) {
      note('🔴 that is the automatic_tax rejection — checkout is broken for everyone');
    }
  } else {
    fail('🔴 checkout succeeded with NO consent — every sale stays withdrawable for 14 days');
  }

  /* 1b · with consent, it must produce a real Stripe session. */
  const { recordConsent } = await loadService('checkoutConsent.js');
  made.consentId = await recordConsent(pool, {
    userId: made.userId, itemId: 'pro_monthly',
    immediatePerformance: true, withdrawalAcknowledged: true, termsAccepted: true,
    locale: 'de', clientIp: '127.0.0.1', userAgent: 'paid-loop-proof',
  });
  pass(`consent recorded ${made.consentId}`);

  try {
    const session = await createCheckout(pool, user, 'pro_monthly');
    if (session?.url && /checkout\.stripe\.com/.test(session.url)) {
      pass('checkout session created — Stripe ACCEPTED the configuration');
      note(`automatic_tax did not break it (STRIPE_AUTOMATIC_TAX=${process.env.STRIPE_AUTOMATIC_TAX})`);
    } else {
      fail(`createCheckout returned no usable url: ${JSON.stringify(session).slice(0, 200)}`);
    }
  } catch (e) {
    fail(`🔴 createCheckout THREW: ${e.message}`);
    if (/tax/i.test(e.message)) {
      note('🔴 CONFIRMED: automatic_tax with no registrations breaks checkout for EVERY customer.');
      note('   Set STRIPE_AUTOMATIC_TAX=false until Stripe Tax registrations exist.');
    }
  }

  /* ── 2 · a real subscription ───────────────────────────────────────────── */
  step('2 · subscription (pm_card_visa — a named test token, never card data)');
  /* 🔴 REUSE the customer createCheckout already made. It calls customerFor(),
   * which creates a Stripe customer and inserts the billing_customers mapping
   * keyed by user_id (PRIMARY KEY, ON CONFLICT DO NOTHING).
   *
   * The first version of this proof created a SECOND customer and inserted its
   * own mapping — which was silently skipped by that PK conflict, so the webhook
   * looked up the wrong customer and reported "no user for customer". The
   * product was fine; the harness was modelling something production never does.
   * In production the subscription is created BY Checkout on this same customer. */
  const mapped = await pool.query(
    'SELECT stripe_customer_id FROM billing_customers WHERE user_id = $1', [String(made.userId)],
  );
  if (!mapped.rowCount) { fail('createCheckout did not create a billing_customers mapping'); throw new Error('no mapping'); }
  made.customerId = mapped.rows[0].stripe_customer_id;
  pass(`reusing the customer createCheckout made: ${made.customerId}`);

  /* ⚠️ attach() MINTS A NEW payment method from the shared test token and returns
   * it with a different id. Setting the token itself as the default fails with
   * "must be attached to the customer" — use what attach gave back. */
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: made.customerId });
  await stripe.customers.update(made.customerId, {
    invoice_settings: { default_payment_method: pm.id },
  });
  pass(`test payment method attached (${pm.id})`);

  const sub = await stripe.subscriptions.create({
    customer: made.customerId,
    items: [{ price: process.env.STRIPE_PRICE_PRO_MONTHLY }],
    metadata: { xenoPlan: 'pro' },
  });
  made.subId = sub.id;
  pass(`subscription ${sub.id} status=${sub.status}`);

  /* ── 3 · webhook -> plan ───────────────────────────────────────────────── */
  step('3 · webhook -> plan  (customer.subscription.created — unreachable until today)');
  const landed = await waitFor(async () => {
    const p = await planOf();
    return p && p.plan !== 'free' ? p : null;
  });
  if (landed) pass(`plan=${landed.plan} status=${landed.status}`);
  else fail('🔴 the plan never changed — the webhook did not arrive or did not resolve the user');

  /* ── 4 · entitlement opens ─────────────────────────────────────────────── */
  step('4 · entitlement');
  const { getEffectiveEntitlements } = await loadService('effectivePlan.js');
  const e1 = await getEffectiveEntitlements(pool, made.userId);
  if (e1.entitlements?.canDownload) pass(`canDownload=true (plan ${e1.plan})`);
  else fail(`🔴 canDownload=${e1.entitlements?.canDownload} — a paying customer is refused`);

  /* ── 5 · cancel ────────────────────────────────────────────────────────── */
  step('5 · cancel -> customer.subscription.deleted  (also unreachable until today)');
  await stripe.subscriptions.cancel(made.subId);
  made.subId = null;
  const dropped = await waitFor(async () => {
    const p = await planOf();
    return p && (p.plan === 'free' || p.status === 'canceled') ? p : null;
  });
  if (dropped) pass(`plan=${dropped.plan} status=${dropped.status}`);
  else fail('🔴 the plan did NOT drop — a cancelled customer keeps full access');

  /* ── 6 · entitlement closes ────────────────────────────────────────────── */
  step('6 · entitlement after cancellation — the gate must CLOSE, not only open');
  const e2 = await getEffectiveEntitlements(pool, made.userId);
  if (!e2.entitlements?.canDownload) pass(`canDownload=false (plan ${e2.plan})`);
  else fail('🔴 still true after cancelling — the gate only ever opens');
} catch (err) {
  fail(`threw: ${err.message}`);
  if (err.stack) note(err.stack.split('\n')[1]?.trim() || '');
} finally {
  step('cleanup');
  try { if (made.subId) { await stripe.subscriptions.cancel(made.subId); console.log('  removed subscription'); } }
  catch (e) { console.log(`  ! subscription: ${e.message}`); }
  try { if (made.customerId) { await stripe.customers.del(made.customerId); console.log('  removed customer'); } }
  catch (e) { console.log(`  ! customer: ${e.message}`); }
  try {
    if (made.userId) {
      for (const t of ['checkout_consents', 'billing_customers', 'xeno_account_plans', 'download_grants']) {
        await pool.query(`DELETE FROM ${t} WHERE user_id::text = $1`, [made.userId]).catch(() => {});
      }
      await pool.query('DELETE FROM users WHERE id = $1', [made.userId]);
      const left = await pool.query('SELECT 1 FROM users WHERE id = $1', [made.userId]);
      console.log(left.rowCount === 0 ? '  removed user, VERIFIED gone' : '  ! user row survived — remove by hand');
    }
  } catch (e) { console.log(`  ! user: ${e.message}`); }
  await pool.end();

  console.log('\n' + '─'.repeat(74));
  console.log(`${ok} passed, ${bad} failed.`);
  process.exit(bad ? 1 : 0);
}
