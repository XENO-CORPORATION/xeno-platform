/** Account identity is an authority boundary, not a deployment-preflight hint. */
export const BILLING_PROVIDER_TIMEOUT_MS = 10_000;
export function billingBindingError() {
  return Object.assign(new Error('Billing account is temporarily unavailable. Please try again later.'), {
    status: 503, code: 'billing_account_unavailable',
  });
}

export function billingAccountConfig(env) {
  const accountId = env.STRIPE_EXPECTED_ACCOUNT_ID || '';
  const mode = env.STRIPE_EXPECTED_MODE || '';
  const secret = env.STRIPE_SECRET_KEY || '';
  const publishable = env.STRIPE_PUBLISHABLE_KEY || '';
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId) || !['test', 'live'].includes(mode)
    || !new RegExp(`^(sk|rk)_${mode}_[A-Za-z0-9]+$`).test(secret)
    || !new RegExp(`^pk_${mode}_[A-Za-z0-9]+$`).test(publishable)) throw billingBindingError();
  return Object.freeze({ accountId, mode, livemode: mode === 'live' });
}

export async function boundedBillingRead(read) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => read({ timeout: BILLING_PROVIDER_TIMEOUT_MS, maxNetworkRetries: 0 })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(billingBindingError()), BILLING_PROVIDER_TIMEOUT_MS); }),
    ]);
  } catch { throw billingBindingError(); }
  finally { clearTimeout(timer); }
}

export async function verifyBillingAccount(provider, config, { sale = false } = {}) {
  /* `retrieveCurrent` — GET /v1/account with NO id parameter — plus explicit empty
   * params and then the per-call options.
   *
   * 🔴 The obvious call, `accounts.retrieve(...)`, has an id-or-params first
   * argument, and stripe-node 17 and 22 read that ambiguity DIFFERENTLY:
   *
   *   retrieve(undefined, {}, options)   22: correct     17: THROWS "Unknown arguments"
   *   retrieve({}, options)              22: options sent as ?query=params   17: correct
   *   retrieve(options)                  22: options DROPPED                 17: correct
   *
   * No single form of retrieve() is right under both. This guard was written as
   * the first form, tested against 22 (the ROOT node_modules) and deployed against
   * 17 (src/server, which is what the backend image installs) — where it threw on
   * every call and surfaced as billing_account_unavailable. Nobody saw it because
   * with the EXPECTED_* variables unset in production it had never executed there.
   * Found 2026-09-11, the first time it ran against a real key.
   *
   * retrieveCurrent({}, options) is measured CORRECT under both versions: path
   * /v1/account, and the options land in request settings rather than the query
   * string. The per-call maxNetworkRetries: 0 is load-bearing — the backend client
   * is built with maxNetworkRetries: 2, and retries could carry a read past the
   * 10 s bound this wrapper promises. scripts/billing-account-binding.test.mjs
   * proves this against the backend's OWN copy of the SDK and asserts the two
   * copies are the same version, so the divergence cannot go quiet again. */
  const account = await boundedBillingRead(options => provider.accounts.retrieveCurrent({}, options));
  if (account?.object !== 'account' || account.id !== config.accountId) throw billingBindingError();
  if (sale && config.livemode) {
    const requirements = account.requirements;
    const ready = requirements == null
      ? account.type === 'standard' && account.controller?.type === 'account' && account.capabilities?.card_payments === 'active'
      : typeof requirements === 'object' && !Array.isArray(requirements)
        && requirements.disabled_reason === null
        && ['currently_due', 'past_due', 'pending_verification'].every(key => Array.isArray(requirements[key]) && requirements[key].length === 0);
    if (account.charges_enabled !== true || account.payouts_enabled !== true || account.details_submitted !== true || !ready) throw billingBindingError();
  }
  return { verificationNotExposed: sale && config.livemode && account.requirements == null };
}

function requireEventContext(event, config) {
  if (event?.object !== 'event' || !/^evt_[A-Za-z0-9_]+$/.test(event.id || '')
    || typeof event.type !== 'string' || event.livemode !== config.livemode
    || event.account != null || event.context != null
    || !event.data?.object || typeof event.data.object !== 'object'
    || (event.data.object.livemode != null && event.data.object.livemode !== config.livemode)) throw billingBindingError();
}

export async function canonicalBillingEvent(provider, config, event) {
  requireEventContext(event, config);
  const canonical = await boundedBillingRead(options => provider.events.retrieve(event.id, {}, options));
  requireEventContext(canonical, config);
  if (canonical.id !== event.id || canonical.type !== event.type) throw billingBindingError();
  return canonical;
}

const LEGACY_TABLES = [
  ['billing_customers', 'TRUE'],
  ['billing_events', 'TRUE'],
  ['billing_charges', 'TRUE'],
  ['xeno_account_plans', 'stripe_subscription_id IS NOT NULL'],
  ['workspaces', "metadata->'billing'->>'stripe_subscription_id' IS NOT NULL"],
  ['checkout_consents', 'checkout_session_id IS NOT NULL'],
];

export async function requireBillingDatabaseBinding(pool, config) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Request-local bounds cover the advisory lock, DDL and inventory reads.
    // SET LOCAL is undone by either COMMIT or ROLLBACK, including pooled reuse.
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('xeno:billing-account-binding', 0))");
    await client.query(`CREATE TABLE IF NOT EXISTS billing_account_binding (
      singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
      account_id text NOT NULL CHECK (account_id ~ '^acct_[A-Za-z0-9]+$'),
      mode text NOT NULL CHECK (mode IN ('test', 'live')),
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    const binding = (await client.query('SELECT account_id, mode FROM billing_account_binding WHERE singleton = TRUE')).rows[0];
    if (binding) {
      if (binding.account_id !== config.accountId || binding.mode !== config.mode) throw billingBindingError();
    } else {
      for (const [table, predicate] of LEGACY_TABLES) {
        // Identifiers/predicates come only from the fixed source list, never input.
        const present = (await client.query('SELECT to_regclass($1) AS relation', [table])).rows[0]?.relation;
        if (present && (await client.query(`SELECT 1 FROM ${table} WHERE ${predicate} LIMIT 1`)).rows.length) throw billingBindingError();
      }
      await client.query('INSERT INTO billing_account_binding (singleton, account_id, mode) VALUES (TRUE, $1, $2)', [config.accountId, config.mode]);
    }
    await client.query('COMMIT');
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw billingBindingError();
  } finally { client?.release(); }
}
