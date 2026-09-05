import { randomBytes } from 'node:crypto';
import { verifyBillingWebhooks } from '../../src/server/utils/billingWebhookVerification.js';
import { verifyHostedSubscription, refundSubscriptionCharge } from './hosted-payment-proof.mjs';
import { advanceRenewal, ownedClock } from './renewal-payment-proof.mjs';
import { runCreditPackProof } from './credit-pack-proof.mjs';

const requireState = (value, code) => { if (!value) throw new Error(code); };
const objectId = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(value);
const ownerId = value => typeof value === 'string' ? value : value?.id;

export function modeFor(args) {
  if (!args.length) return 'plan';
  if (args.length === 1 && args[0] === '--confirm') return 'confirm';
  throw new Error('Only --confirm is accepted');
}

export function validateTarget(env) {
  requireState(env.NODE_ENV === 'test', 'test_environment_required');
  requireState(/^(sk|rk)_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY || ''), 'test_key_required');
  requireState(/^[a-f0-9]{32}$/.test(env.XENO_PAID_LOOP_RUN_ID || ''), 'run_id_required');
  requireState(env.DB_NAME === `xeno_paid_loop_${env.XENO_PAID_LOOP_RUN_ID}`, 'disposable_database_required');
  requireState(['127.0.0.1', '::1'].includes(env.DB_HOST), 'loopback_database_required');
  requireState(/^\d+$/.test(env.DB_PORT || '') && Number(env.DB_PORT) > 0 && Number(env.DB_PORT) <= 65535, 'explicit_port_required');
  requireState(Boolean(env.DB_USER?.trim() && env.DB_PASSWORD?.trim()), 'database_credentials_required');
  requireState(!Object.entries(env).some(([key, value]) => value && (/^PG/i.test(key) || /^(DATABASE_URL|TEST_DATABASE_URL|NODE_OPTIONS)$/i.test(key))), 'connection_override_refused');
  requireState(objectId(env.STRIPE_PRICE_PRO_MONTHLY, 'price'), 'price_required');
  let origin;
  try { origin = new URL(env.BILLING_APP_URL); } catch { throw new Error('loopback_app_required'); }
  requireState(['http:', 'https:'].includes(origin.protocol) && ['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname)
    && !origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/', 'loopback_app_required');
  let webhook;
  try { webhook = new URL(env.XENO_PAID_LOOP_WEBHOOK_URL); } catch { throw new Error('isolated_webhook_required'); }
  const transport = env.XENO_PAID_LOOP_TRANSPORT || 'public-webhook';
  requireState(['public-webhook', 'stripe-cli'].includes(transport), 'invalid_delivery_transport');
  requireState((transport === 'stripe-cli' ? webhook.origin === origin.origin : webhook.protocol === 'https:') && !['xenostudio.ai', 'www.xenostudio.ai'].includes(webhook.hostname)
    && !webhook.username && !webhook.password && !webhook.search && !webhook.hash
    && webhook.pathname === '/api/billing/webhook', 'isolated_webhook_required');
  return { runId: env.XENO_PAID_LOOP_RUN_ID, database: env.DB_NAME,
    comment: `xeno-paid-loop:${env.XENO_PAID_LOOP_RUN_ID}`, origin: origin.origin,
    priceId: env.STRIPE_PRICE_PRO_MONTHLY, webhookUrl: webhook.href, transport };
}

export async function allPages(list, options) {
  const rows = [], seen = new Set();
  let cursor;
  for (let page = 0; page < 100; page++) {
    const result = await list({ ...options, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    requireState(Array.isArray(result?.data) && typeof result.has_more === 'boolean', 'malformed_listing');
    for (const item of result.data) {
      requireState(item?.id && !seen.has(item.id), 'repeated_listing');
      seen.add(item.id); rows.push(item);
    }
    if (!result.has_more) return rows;
    requireState(result.data.length > 0, 'empty_continuation');
    cursor = result.data.at(-1).id;
  }
  throw new Error('listing_bound_exceeded');
}

// Dedicated CLI process only. Dependencies may log and swallow errors.
export async function quietDependencies(action) {
  const names = ['log', 'info', 'warn', 'error', 'debug'];
  const saved = Object.fromEntries(names.map(name => [name, console[name]]));
  let errors = 0;
  for (const name of names) console[name] = () => { if (name === 'error') errors++; };
  try { return { result: await action(), errors }; }
  finally { for (const name of names) console[name] = saved[name]; }
}

export async function runProof({ config, pool, stripe, services, webhookSource, cliReady = false, hostedCheckout, creditsCheckout, recovery, renewal = false, receipts = [], pollMs = 30_000, intervalMs = 1_000 }) {
  const report = { qualification: 'provider-subscription-service-loop', status: 'failed',
    runId: config.runId, database: config.database, databaseRetained: false,
    passed: [], failures: [], resources: { customers: [], subscriptions: [], sessions: [], clocks: [] },
    notExercised: ['Hosted Checkout completion', 'Renewal', 'Delayed payment', 'Refund', 'Receipt delivery', 'Browser relogin'] };
  let phase = 'ownership', userId, fixtureStarted = false, clockId;
  const settledSessions = new Set(), settledSubscriptions = new Set();
  const email = `paid-loop-${config.runId}-${randomBytes(16).toString('hex')}@xenostudio.invalid`;
  const fail = code => { report.failures.push(code); };
  // Services receive this tracked query boundary, including their swallowed errors.
  const db = { query: async (...args) => {
    try { return await pool.query(...args); }
    catch (error) { fail(`database_read_or_write:${phase}`); throw error; }
  } };
  const check = (condition, code) => { requireState(condition, code); report.passed.push(code); };
  const remember = (group, id, prefix) => {
    requireState(objectId(id, prefix), 'invalid_provider_id');
    if (!report.resources[group].includes(id)) report.resources[group].push(id);
  };
  const ownedCustomer = customer => customer?.livemode === false && customer.email === email
    && customer.metadata?.xenoUserId === String(userId) && objectId(customer.id, 'cus');
  const planOf = async () => (await db.query(
    'SELECT plan, status, stripe_subscription_id, current_period_end FROM xeno_account_plans WHERE user_id::text = $1', [String(userId)],
  )).rows[0];
  async function poll(predicate) {
    const until = Date.now() + pollMs;
    do {
      const plan = await planOf();
      if (predicate(plan)) return true;
      if (Date.now() >= until) return false;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    } while (Date.now() <= until);
    return false;
  }
  try {
    const target = (await db.query(`SELECT current_database() AS name,
      shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = current_database()`)).rows[0];
    check(target?.name === config.database && target?.comment === config.comment, 'database_ownership');
    phase = 'webhook_isolation';
    const endpoints = await allPages(options => stripe.webhookEndpoints.list(options), {});
    check(endpoints.every(endpoint => endpoint.status === 'disabled'
      || (endpoint.status === 'enabled' && endpoint.livemode === false && endpoint.url === config.webhookUrl)), 'no_shared_webhook_destinations');
    if (config.transport === 'stripe-cli') {
      check(cliReady === true && endpoints.every(endpoint => endpoint.status === 'disabled'), 'isolated_cli_delivery_ready');
      report.notExercised.push('Public webhook endpoint delivery');
    } else {
      await verifyBillingWebhooks({ stripe, source: webhookSource, expectedUrl: config.webhookUrl, liveMode: false });
      report.passed.push('isolated_webhook_coverage');
    }
    check((await allPages(options => stripe.customers.list(options), { email })).length === 0, 'fresh_provider_identity');
    phase = 'fixture'; fixtureStarted = true; report.databaseRetained = true;
    const inserted = await db.query(`INSERT INTO users (email, username, display_name, password_hash, is_active, role)
      VALUES ($1,$2,$3,$4,TRUE,'user') RETURNING id`,
    [email, `paidloop${randomBytes(12).toString('hex')}`, 'Paid loop fixture', randomBytes(32).toString('hex')]);
    userId = inserted.rows[0]?.id;
    requireState(userId != null, 'fixture_id_missing');
    const user = { id: userId, email };
    phase = 'consent_refusal';
    let refusal;
    try { await services.createCheckout(db, user, 'pro_monthly'); }
    catch (error) { refusal = error.code; }
    check(refusal === 'consent_required', 'exact_consent_refusal');
    if (renewal) {
      phase = 'renewal_fixture';
      const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000),
        name: config.comment }, { idempotencyKey: `paid-loop-clock:${config.runId}` });
      remember('clocks', clock?.id, 'clock'); clockId = clock.id;
      requireState(ownedClock(clock, config.runId, clockId), 'clock_ownership');
      const customer = await stripe.customers.create({ email, metadata: { xenoUserId: String(userId) }, test_clock: clockId },
        { idempotencyKey: `paid-loop-clock-customer:${config.runId}` });
      remember('customers', customer?.id, 'cus');
      requireState(ownedCustomer(customer) && ownerId(customer.test_clock) === clockId, 'clock_customer_ownership');
      await db.query('INSERT INTO billing_customers (user_id, stripe_customer_id) VALUES ($1,$2)', [String(userId), customer.id]);
    }
    phase = 'checkout';
    const consentId = await services.recordConsent(db, { userId, itemId: 'pro_monthly',
      immediatePerformance: true, withdrawalAcknowledged: true, termsAccepted: true,
      locale: 'en', clientIp: '127.0.0.1', userAgent: 'paid-loop-proof' });
    requireState(consentId != null, 'consent_id_missing');
    requireState(report.failures.length === 0, 'dependency_database_failure');
    const session = await services.createCheckout(db, user, 'pro_monthly', { consentId, origin: config.origin });
    remember('sessions', session?.id, 'cs_test');
    const url = new URL(session.url);
    check(url.origin === 'https://checkout.stripe.com' && !url.username && !url.password, 'checkout_url');
    const binding = (await db.query(`SELECT checkout_session_id, consumed_at FROM checkout_consents
      WHERE id = $1 AND user_id::text = $2`, [consentId, String(userId)])).rows[0];
    check(binding?.checkout_session_id === session.id && Boolean(binding.consumed_at), 'exact_consent_binding');
    const customerId = (await db.query('SELECT stripe_customer_id FROM billing_customers WHERE user_id = $1', [String(userId)])).rows[0]?.stripe_customer_id;
    requireState(objectId(customerId, 'cus'), 'customer_mapping_missing');
    check(ownedCustomer(await stripe.customers.retrieve(customerId)), 'customer_ownership');
    remember('customers', customerId, 'cus');
    const providerSession = await stripe.checkout.sessions.retrieve(session.id);
    check(providerSession?.id === session.id && providerSession.livemode === false
      && ownerId(providerSession.customer) === customerId && providerSession.status === 'open', 'provider_session');
    phase = 'subscription';
    recovery?.beforeSubscription();
    let subscription;
    if (hostedCheckout) {
      phase = 'hosted_checkout';
      await hostedCheckout(session);
      subscription = await verifyHostedSubscription(stripe, session.id, customerId);
      report.passed.push('hosted_checkout_paid_with_consent');
      report.notExercised = report.notExercised.filter(item => item !== 'Hosted Checkout completion');
    } else {
    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customerId });
    requireState(objectId(pm?.id, 'pm'), 'payment_method_missing');
    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } });
    subscription = await stripe.subscriptions.create({ customer: customerId,
      items: [{ price: config.priceId }], metadata: { xenoUserId: String(userId), itemId: 'pro_monthly' } },
    { idempotencyKey: `paid-loop:${config.runId}:${userId}` });
    }
    remember('subscriptions', subscription?.id, 'sub');
    check(subscription.livemode === false && ownerId(subscription.customer) === customerId && subscription.status === 'active', 'active_test_subscription');
    if (recovery) {
      phase = 'delivery_recovery';
      report.recovery = await recovery.afterSubscription({ subscription, customerId, db, services, user });
      report.passed.push('delivery_503_recovery', 'provider_duplicate_state_unchanged');
    }
    check(await poll(plan => plan?.plan === 'pro' && plan.status === 'active' && plan.stripe_subscription_id === subscription.id), 'active_plan_delivered');
    check((await services.getEffectiveEntitlements(db, userId))?.entitlements?.canDownload === true, 'entitlement_open');
    if (renewal) {
      phase = 'renewal';
      report.renewal = await advanceRenewal({ stripe, clockId, runId: config.runId, customerId, subscription, receipts, timeoutMs: pollMs, intervalMs });
      check(await poll(plan => plan?.plan === 'pro' && plan.status === 'active' && plan.stripe_subscription_id === subscription.id
        && new Date(plan.current_period_end).getTime() === report.renewal.periodEnd * 1000), 'renewal_period_delivered');
      check((await services.getEffectiveEntitlements(db, userId))?.entitlements?.canDownload === true, 'renewal_entitlement_open');
      report.notExercised = report.notExercised.filter(item => item !== 'Renewal');
    }
    if (hostedCheckout) {
      phase = 'subscription_refund';
      report.refund = await refundSubscriptionCharge(stripe, subscription, customerId, config.runId);
      report.passed.push('subscription_charge_full_refund');
      report.notExercised = report.notExercised.map(item => item === 'Refund' ? 'Credit-pack refund ledger' : item);
      check((await services.getEffectiveEntitlements(db, userId))?.entitlements?.canDownload === true, 'refund_does_not_cancel_subscription');
    }
    if (creditsCheckout) {
      phase = 'credit_pack';
      report.creditPack = await runCreditPackProof({ stripe, db, services, user, customerId, runId: config.runId,
        origin: config.origin, receipts, checkout: creditsCheckout, rememberSession: id => remember('sessions', id, 'cs_test'), timeoutMs: pollMs, intervalMs });
      report.passed.push('hosted_credit_purchase', 'credit_ledger_grant', 'partial_refund_ledger', 'full_refund_ledger');
      report.notExercised = report.notExercised.filter(item => item !== 'Refund');
      report.notExercised = report.notExercised.map(item => item === 'Hosted Checkout completion' ? 'Hosted subscription Checkout completion' : item);
      report.notExercised.push('Subscription-charge refund');
    }
    phase = 'cancellation';
    await stripe.subscriptions.cancel(subscription.id);
    check(await poll(plan => plan?.status === 'canceled' && plan.stripe_subscription_id === subscription.id), 'cancellation_delivered');
    check((await services.getEffectiveEntitlements(db, userId))?.entitlements?.canDownload === false, 'entitlement_closed');
    if (recovery) {
      phase = 'stale_delivery'; report.recovery = await recovery.afterCancellation();
      report.passed.push('stale_provider_event_access_closed');
    }
  } catch { fail(`phase_failed:${phase}`); }
  finally {
    recovery?.resume();
    phase = 'cleanup';
    if (fixtureStarted && userId != null) {
      // Recover objects created before a response/DB write failed. Retain SQL audit evidence.
      let customers = [];
      if (renewal) {
        try {
          const clocks = await allPages(options => stripe.testHelpers.testClocks.list(options), {});
          for (const clock of clocks.filter(c => c.name === config.comment)) {
            requireState(ownedClock(clock, config.runId), 'unowned_clock'); remember('clocks', clock.id, 'clock');
          }
        } catch { fail('cleanup_clock_discovery'); }
      }
      try {
        customers = await allPages(options => stripe.customers.list(options), { email });
        for (const clock of report.resources.clocks) {
          requireState(ownedClock(await stripe.testHelpers.testClocks.retrieve(clock), config.runId, clock), 'unowned_clock');
          customers.push(...await allPages(options => stripe.customers.list(options), { email, test_clock: clock }));
        }
      }
      catch { fail('cleanup_customer_discovery'); }
      const ids = new Set([...customers.map(customer => customer.id), ...report.resources.customers]);
      for (const id of ids) {
        try {
          requireState(objectId(id, 'cus'), 'invalid_customer');
          requireState(ownedCustomer(await stripe.customers.retrieve(id)), 'unowned_customer');
          remember('customers', id, 'cus');
          const sessions = await allPages(options => stripe.checkout.sessions.list(options), { customer: id });
          for (const session of sessions) {
            try {
              requireState(session.livemode === false && ownerId(session.customer) === id, 'unowned_session');
              remember('sessions', session.id, 'cs_test');
              if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
              const state = await stripe.checkout.sessions.retrieve(session.id);
              requireState(state?.id === session.id && state.livemode === false && ownerId(state.customer) === id
                && ['expired', 'complete'].includes(state.status), 'session_not_terminal');
              settledSessions.add(session.id);
            } catch { fail('cleanup_session_failed'); }
          }
          const subscriptions = await allPages(options => stripe.subscriptions.list(options), { customer: id, status: 'all' });
          for (const subscription of subscriptions) {
            try {
              requireState(subscription.livemode === false && ownerId(subscription.customer) === id, 'unowned_subscription');
              remember('subscriptions', subscription.id, 'sub');
              if (!['canceled', 'incomplete_expired'].includes(subscription.status)) await stripe.subscriptions.cancel(subscription.id);
              const state = await stripe.subscriptions.retrieve(subscription.id);
              requireState(state?.id === subscription.id && state.livemode === false && ownerId(state.customer) === id
                && ['canceled', 'incomplete_expired'].includes(state.status), 'subscription_not_terminal');
              settledSubscriptions.add(subscription.id);
            } catch { fail('cleanup_subscription_failed'); }
          }
          requireState(sessions.every(session => settledSessions.has(session.id))
            && subscriptions.every(subscription => settledSubscriptions.has(subscription.id)), 'cleanup_incomplete');
          await stripe.customers.del(id);
          const removed = await stripe.customers.retrieve(id);
          requireState(removed?.id === id && removed.deleted === true, 'customer_not_deleted');
          report.passed.push('customer_cleanup_verified');
        } catch { fail('cleanup_customer_failed'); }
      }
      if (report.resources.sessions.length && !report.passed.includes('customer_cleanup_verified')) fail('cleanup_unresolved_resources');
      if (report.resources.sessions.some(id => !settledSessions.has(id))
        || report.resources.subscriptions.some(id => !settledSubscriptions.has(id))) fail('cleanup_unverified_known_objects');
      for (const clock of report.resources.clocks) {
        try {
          requireState(!report.failures.some(code => code.startsWith('cleanup_')), 'cleanup_incomplete');
          requireState(ownedClock(await stripe.testHelpers.testClocks.retrieve(clock), config.runId, clock), 'unowned_clock');
          const remaining = await allPages(options => stripe.customers.list(options), { test_clock: clock });
          requireState(remaining.length === 0, 'clock_customers_remain');
          const deleted = await stripe.testHelpers.testClocks.del(clock);
          requireState(deleted.id === clock && deleted.deleted === true, 'clock_not_deleted');
          report.passed.push('clock_cleanup_verified');
        } catch { fail('cleanup_clock_failed'); }
      }
    }
    let closeTimer;
    try { await Promise.race([pool.end(), new Promise((_, reject) => { closeTimer = setTimeout(() => reject(new Error('pool_close_timeout')), 15_000); })]); }
    catch { fail('database_close_failed'); }
    finally { clearTimeout(closeTimer); }
  }
  report.status = report.failures.length ? 'failed' : 'passed-service-loop-only';
  return report;
}
