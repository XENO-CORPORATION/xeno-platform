// Test-only module loader: real signature verification, synthetic provider reads.
// No application bypass switch or mutable production provider is introduced.
import Stripe from 'stripe';
import { registerHooks } from 'node:module';

export function installBillingProviderFixture() {
  const events = new Map();
  const calls = [];
  const account = { object: 'account', id: 'acct_fixture' };
  const provider = {
    accounts: { retrieveCurrent: async (params, options) => {
      calls.push('account');
      /* Until 2026-09-11 this stub required `(undefined, {}, options)` — the exact
       * argument shape stripe-node 17 rejects. A stub cannot know what the real SDK
       * accepts, so it asserts only the outcomes that matter: nothing that could be
       * an account id, and the retry override present. */
      if (params && Object.keys(params).length) throw new Error('wrong authenticated-account request');
      if (options?.timeout !== 10000 || options?.maxNetworkRetries !== 0) throw new Error('wrong authenticated-account request');
      return structuredClone(account);
    } },
    events: { retrieve: async id => {
      calls.push('event');
      if (!events.has(id)) throw new Error('fixture event does not belong to this account');
      return structuredClone(events.get(id));
    } },
  };
  globalThis.__billingAccountFixtureStripe = class extends Stripe {
    constructor(...args) { super(...args); this.accounts = provider.accounts; this.events = provider.events; }
  };
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'stripe' && context.parentURL?.endsWith('/services/billingService.js')) return { url: 'fixture:billing-account-stripe', shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url === 'fixture:billing-account-stripe') return { format: 'module', source: 'export default globalThis.__billingAccountFixtureStripe;', shortCircuit: true };
      return next(url, context);
    },
  });
  return { account, provider, calls, events, event(id, type, object) {
    const event = { object: 'event', id, type, livemode: false, data: { object } };
    events.set(id, structuredClone(event));
    return event;
  } };
}

/** Existing binding fixture; rejects any unanticipated SQL rather than faking it. */
export function boundBillingPool(query = async () => { throw new Error('Unexpected billing mutation'); }) {
  return { query, connect: async () => ({ release() {}, query: async sql => {
    if (sql.startsWith('SELECT account_id')) return { rows: [{ account_id: 'acct_fixture', mode: 'test' }] };
    if (['BEGIN', 'COMMIT', 'ROLLBACK', "SET LOCAL lock_timeout = '10s'", "SET LOCAL statement_timeout = '10s'"].includes(sql) || sql.startsWith('SELECT pg_advisory_xact_lock') || sql.startsWith('CREATE TABLE IF NOT EXISTS billing_account_binding')) return { rows: [] };
    throw new Error('Unexpected binding SQL');
  } }) };
}
