import { billingAccountConfig, verifyBillingAccount, boundedBillingRead } from '../../src/server/utils/billingAccountBinding.js';

const TABLES = Object.freeze({
  billing_customers: 'TRUE', billing_events: 'TRUE', billing_charges: 'TRUE',
  xeno_account_plans: 'stripe_subscription_id IS NOT NULL',
  workspaces: "metadata->'billing'->>'stripe_subscription_id' IS NOT NULL",
  checkout_consents: 'checkout_session_id IS NOT NULL',
});
const LIMIT = 10_000;
const idIs = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(value);
const fail = code => Object.assign(new Error('Billing reconciliation could not complete.'), { code });
const integer = value => Number.isSafeInteger(value) && value >= 0;
const STATUSES = Object.freeze({
  subscriptions: ['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'],
  paymentIntents: ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded'],
  checkouts: ['open', 'complete', 'expired'],
});
const counters = values => Object.fromEntries(values.map(value => [value, 0]));

/** Caller owns a dedicated, already connected PostgreSQL client (not a shared pool).
 * No schema creation, binding adoption, financial mutation, or COMMIT is performed. */
export async function readBillingReconciliationSnapshot(client) {
  const query = (sql, params) => boundedBillingRead(() => client.query(sql, params));
  let began = false;
  try {
    await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); began = true;
    await query("SET LOCAL statement_timeout = '10s'");
    await query("SET LOCAL lock_timeout = '10s'");
    const counts = {};
    for (const [table, predicate] of Object.entries(TABLES)) {
      const present = await query('SELECT to_regclass($1) AS relation', [table]);
      if (present.rows?.length !== 1 || !Object.hasOwn(present.rows[0], 'relation')) throw fail('database_snapshot_failed');
      if (present.rows[0].relation === null) { counts[table] = 0; continue; }
      const result = await query(`SELECT count(*)::text AS count FROM ${table} WHERE ${predicate}`);
      const raw = result.rows?.[0]?.count;
      if (result.rows?.length !== 1 || !/^(0|[1-9][0-9]*)$/.test(raw || '') || !integer(Number(raw))) throw fail('database_snapshot_failed');
      counts[table] = Number(raw);
    }
    if (counts.billing_customers > LIMIT) throw fail('database_snapshot_limit');
    const customers = counts.billing_customers
      ? (await query(`SELECT stripe_customer_id FROM billing_customers ORDER BY stripe_customer_id LIMIT ${LIMIT + 1}`)).rows?.map(row => row.stripe_customer_id)
      : [];
    const present = await query('SELECT to_regclass($1) AS relation', ['billing_account_binding']);
    if (present.rows?.length !== 1 || !Object.hasOwn(present.rows[0], 'relation')) throw fail('database_snapshot_failed');
    let binding = null;
    if (present.rows[0].relation !== null) {
      const rows = (await query('SELECT account_id, mode FROM billing_account_binding')).rows;
      if (!Array.isArray(rows) || rows.length > 1) throw fail('database_snapshot_failed');
      if (rows.length) binding = { accountId: rows[0].account_id, mode: rows[0].mode };
    }
    return validateSnapshot({ counts, customers, binding });
  } catch (error) {
    throw fail(error?.code === 'database_snapshot_limit' ? error.code : 'database_snapshot_failed');
  } finally {
    if (began) {
      try { await query('ROLLBACK'); } catch { throw fail('database_snapshot_rollback_failed'); }
    }
  }
}

function validateSnapshot(snapshot) {
  if (!snapshot || !snapshot.counts || !Array.isArray(snapshot.customers)
    || snapshot.customers.length > LIMIT
    || !Object.keys(TABLES).every(key => integer(snapshot.counts[key]))
    || snapshot.counts.billing_customers !== snapshot.customers.length
    || snapshot.customers.some(id => !idIs(id, 'cus'))
    || new Set(snapshot.customers).size !== snapshot.customers.length
    || snapshot.binding === undefined
    || (snapshot.binding !== null && (!idIs(snapshot.binding.accountId, 'acct') || !['test', 'live'].includes(snapshot.binding.mode)))) {
    throw fail('database_snapshot_invalid');
  }
  // Copy only expected data. Neither opaque identifiers nor arbitrary DB fields enter a report.
  return { counts: Object.fromEntries(Object.keys(TABLES).map(key => [key, snapshot.counts[key]])),
    customers: [...snapshot.customers], binding: snapshot.binding && { ...snapshot.binding } };
}

/** Inject a Stripe SDK client using the same credentials as env, and a read-only DB snapshot function.
 * Reports only scoped observations, never an authorization to change accounts. */
export async function reconcileBilling({ provider, env, readSnapshot, maxPages = 100, maxRequests = 1000 }) {
  const report = {
    schemaVersion: 1, scope: 'database-mapped-customers-only', complete: false,
    cutoverApproved: false, reviewRequired: true, accountVerified: false, mode: null,
    database: null, binding: 'unknown',
    customers: { mapped: 0, retrieved: 0, missing: 0, deleted: 0, unknown: 0 },
    subscriptions: counters(STATUSES.subscriptions), paymentIntents: counters(STATUSES.paymentIntents),
    checkouts: counters(STATUSES.checkouts),
    checkoutPaymentStatus: counters(['paid', 'unpaid', 'no_payment_required']),
    obligations: { nonterminalSubscriptions: 0, openCheckouts: 0, unsettledPaymentIntents: 0, unknown: true },
    requests: 0, issues: [],
    limitations: ['Not an account-wide inventory.', 'Database and provider are not one atomic snapshot.',
      'Invoices, disputes, refunds and unmapped customers require separate reconciliation.',
      'No migration, binding adoption, cancellation, refund or cutover is authorized.'],
  };
  const issue = code => { if (!report.issues.includes(code)) report.issues.push(code); };
  let config;
  try {
    config = billingAccountConfig(env);
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000
      || !Number.isSafeInteger(maxRequests) || maxRequests < 2 || maxRequests > 10000) throw fail('limits_invalid');
  } catch { issue('configuration_invalid'); return report; }
  report.mode = config.mode;
  const read = async (fn, { missingOk = false } = {}) => {
    if (report.requests >= maxRequests) throw fail('request_limit');
    report.requests++;
    // Convert only Stripe's documented resource_missing classification inside the
    // provider boundary. No provider message, request ID, identifier or raw error escapes.
    return boundedBillingRead(options => Promise.resolve().then(() => fn(options)).catch(error => {
      if (missingOk && error?.code === 'resource_missing') return { __missing: true };
      throw error;
    }));
  };
  try {
    // Keep canonical current-account request semantics; no Connect account override.
    report.requests++;
    await verifyBillingAccount(provider, config);
    report.accountVerified = true;
  } catch { issue('account_verification_failed'); return report; }
  let snapshot;
  try { snapshot = validateSnapshot(await boundedBillingRead(() => readSnapshot())); }
  catch { issue('database_snapshot_failed'); return report; }
  report.database = snapshot.counts;
  report.customers.mapped = snapshot.customers.length;
  report.binding = snapshot.binding ? 'matching' : 'absent';
  if (snapshot.binding && (snapshot.binding.accountId !== config.accountId || snapshot.binding.mode !== config.mode)) {
    report.binding = 'mismatched'; issue('database_binding_mismatch'); return report;
  }
  const seen = { subscriptions: new Set(), paymentIntents: new Set(), checkouts: new Set() };
  const lists = [
    ['subscriptions', 'subscription', 'sub', (params, options) => provider.subscriptions.list({ ...params, status: 'all' }, options)],
    ['paymentIntents', 'payment_intent', 'pi', (params, options) => provider.paymentIntents.list(params, options)],
    ['checkouts', 'checkout.session', 'cs', (params, options) => provider.checkout.sessions.list(params, options)],
  ];
  for (const customerId of snapshot.customers) {
    if (report.requests >= maxRequests) { issue('request_limit'); break; }
    try {
      const customer = await read(options => provider.customers.retrieve(customerId, {}, options), { missingOk: true });
      if (customer?.__missing === true) { report.customers.missing++; issue('customer_missing'); }
      else {
      if (customer?.object !== 'customer' || customer.id !== customerId) throw fail('customer_invalid');
      if (customer.deleted === true) { report.customers.deleted++; issue('customer_deleted'); }
      else if (customer.livemode !== config.livemode) throw fail('customer_invalid');
      else report.customers.retrieved++;
      }
    } catch { report.customers.unknown++; issue('customer_retrieval_failed'); }
    for (const [key, object, prefix, list] of lists) {
      let cursor;
      try {
        for (let pageIndex = 0; ; pageIndex++) {
          if (pageIndex >= maxPages) throw fail('page_limit');
          const page = await read(options => list({ customer: customerId, limit: 100, ...(cursor ? { starting_after: cursor } : {}) }, options));
          if (page?.object !== 'list' || !Array.isArray(page.data) || typeof page.has_more !== 'boolean'
            || page.data.length > 100 || (page.has_more && page.data.length === 0)) throw fail('list_invalid');
          for (const item of page.data) {
            if (item?.object !== object || !idIs(item.id, prefix) || item.livemode !== config.livemode
              || item.customer !== customerId || seen[key].has(item.id)
              || !STATUSES[key].includes(item.status)
              || (key === 'checkouts' && !Object.hasOwn(report.checkoutPaymentStatus, item.payment_status))) throw fail('list_invalid');
            seen[key].add(item.id);
            report[key][item.status]++;
            if (key === 'checkouts') report.checkoutPaymentStatus[item.payment_status]++;
          }
          if (!page.has_more) break;
          cursor = page.data.at(-1).id;
        }
      } catch (error) {
        issue(error?.code === 'page_limit' || error?.code === 'request_limit' ? error.code : `${key}_inventory_failed`);
      }
    }
  }
  try { await read(options => /* retrieveCurrent, not retrieve: see billingAccountBinding.js — the
   * id-or-params form is read differently by stripe-node 17 and 22 and this one
   * threw on the version the backend ships. */
    provider.accounts.retrieveCurrent({}, options)).then(account => {
    if (account?.object !== 'account' || account.id !== config.accountId) throw fail('account_changed');
  }); } catch { issue('final_account_verification_failed'); }
  report.obligations.nonterminalSubscriptions = Object.entries(report.subscriptions)
    .filter(([status]) => !['canceled', 'incomplete_expired'].includes(status)).reduce((sum, [, count]) => sum + count, 0);
  report.obligations.openCheckouts = report.checkouts.open;
  report.obligations.unsettledPaymentIntents = Object.entries(report.paymentIntents)
    .filter(([status]) => !['canceled', 'succeeded'].includes(status)).reduce((sum, [, count]) => sum + count, 0);
  report.complete = report.issues.length === 0;
  report.obligations.unknown = !report.complete;
  return report;
}
