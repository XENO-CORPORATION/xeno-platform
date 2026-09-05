/**
 * Money-in atomicity + auditability + refund/dispute test (Blocker #2).
 * Exercises billingService.handleEvent end-to-end against a real ledger:
 *   - one-time credit grant is atomic (claim+grant in one tx) and idempotent
 *   - a grant appends a hash-chained credit_transactions row (auditable money-in)
 *   - a failure mid-grant rolls back the event claim (no money-taken-no-credits)
 *   - refunds claw back proportionally, cumulatively, and idempotently
 *   - disputes claw back fully and freeze the account
 *   - the hash chain stays valid across credit + debit + refund
 *
 * Run against a NEW loopback PostgreSQL database named xeno_payment_<unique-id>.
 * DATABASE_URL=... node src/server/tests/billing-money-in.test.mjs
 */
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes, createHmac } from 'node:crypto';
import express from 'express';
import { CONSENT_HASH, requireCheckoutConsent, consumeConsent } from '../services/checkoutConsent.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { installBillingProviderFixture } from '../../../scripts/fixtures/billing-provider-fixture.mjs';
import { billingAccountConfig, requireBillingDatabaseBinding } from '../utils/billingAccountBinding.js';
// Local fixture credentials only. This suite never contacts a payment provider.
if (process.env.NODE_ENV === 'production') throw new Error('Run billing fixtures only against an isolated test database');
const fixtureDatabaseUrl = new URL(process.env.DATABASE_URL || 'postgresql://invalid/');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(fixtureDatabaseUrl.hostname) || !/^\/xeno_payment_[a-zA-Z0-9_]+$/.test(fixtureDatabaseUrl.pathname)) {
  throw new Error('Billing fixtures require a dedicated loopback database named xeno_payment_<unique-id>');
}
process.env.STRIPE_SECRET_KEY = 'sk_test_localfixture';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_localfixture';
process.env.STRIPE_EXPECTED_ACCOUNT_ID = 'acct_fixture';
process.env.STRIPE_EXPECTED_MODE = 'test';
process.env.STRIPE_WEBHOOK_SECRET = randomBytes(32).toString('hex');
const accountFixture = installBillingProviderFixture();
const { handleEvent: processBillingEvent, getPlan } = await import('../services/billingService.js');
const handleEvent = (pool, event, { provider = {} } = {}) => processBillingEvent(pool, event, { provider: { ...accountFixture.provider, ...provider } });
const { stripeWebhook } = await import('../routes/billingRoutes.js');
const { readCheckoutStatus } = await import('../services/checkoutStatus.js');
import { getBalanceV2, verifyChainV2, recordUsageV2, holdV2, settleHoldV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const C = (n) => n * MICRO_PER_CREDIT;

const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), metadata jsonb DEFAULT '{}'::jsonb, updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS api_usage_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, surface varchar(64), operation varchar(128), model varchar(128), provider varchar(64), actual_cost_micro bigint, estimated_cost_micro bigint, input_tokens int DEFAULT 0, output_tokens int DEFAULT 0, status varchar(16), request_id varchar(128), endpoint text, method varchar(8), created_at timestamptz DEFAULT now());
`;

const evt = accountFixture.event;
const paidSession = (uid, credits, pi) => ({
  id: `cs_test_${pi || uid.replaceAll('-', '')}`,
  mode: 'payment', payment_status: 'paid', customer: `cus_${uid.replaceAll('-', '')}`, client_reference_id: uid, payment_intent: pi,
  metadata: { xenoUserId: uid, credits: String(credits), itemId: 'credits_small', kind: 'credits' },
});
const balance = async (uid) => (await getBalanceV2(pool, uid)).availableMicro;
const frozen = async (uid) => (await pool.query('SELECT is_frozen FROM credit_accounts WHERE user_id=$1', [uid])).rows[0]?.is_frozen;
const txCount = async (uid, type) => Number((await pool.query('SELECT COUNT(*)::int c FROM credit_transactions WHERE user_id=$1 AND type=$2', [uid, type])).rows[0].c);
const eventCount = async (id) => Number((await pool.query('SELECT COUNT(*)::int c FROM billing_events WHERE event_id=$1', [id])).rows[0].c);
const newUser = async () => (await pool.query('INSERT INTO users (credits) VALUES (0) RETURNING id')).rows[0].id;

async function main() {
  await pool.query(BASE);
  await migrateAccountV2(pool);

  // Exercise the exact legacy inventory SQL in isolated namespaces, including
  // absent optional tables. Each schema is created here and removed here.
  for (const [table, definition, values] of [
    ['billing_customers', 'stripe_customer_id text', "'cus_old'"],
    ['billing_events', 'event_id text', "'evt_old'"],
    ['billing_charges', 'payment_intent text', "'pi_old'"],
    ['xeno_account_plans', 'stripe_subscription_id text', "'sub_old'"],
    ['workspaces', 'metadata jsonb', "'{\"billing\":{\"stripe_subscription_id\":\"sub_old\"}}'::jsonb"],
    ['checkout_consents', 'checkout_session_id text', "'cs_old'"],
  ]) {
    const namespace = `binding_legacy_${randomBytes(8).toString('hex')}`;
    await pool.query(`CREATE SCHEMA ${namespace}`);
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      await client.query(`SET search_path TO ${namespace}`);
      await client.query(`CREATE TABLE ${table} (${definition})`);
      await client.query(`INSERT INTO ${table} VALUES (${values})`);
      const isolatedPool = { connect: async () => ({ query: (...args) => client.query(...args), release() {} }) };
      await assert.rejects(requireBillingDatabaseBinding(isolatedPool, billingAccountConfig(process.env)), { code: 'billing_account_unavailable' });
      assert.equal((await client.query('SELECT to_regclass($1) AS relation', ['billing_account_binding'])).rows[0].relation, null);
      assert.equal((await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0].count, 1);
      ok(true, `database account binding: legacy ${table} blocks adoption without changing history`);
    } finally {
      await client.end();
      await pool.query(`DROP SCHEMA ${namespace} CASCADE`);
    }
  }

  // The empty, dedicated database is the only automatic-adoption case. Exercise
  // real advisory-lock serialization, refusal and durable single-row identity.
  const accountConfig = billingAccountConfig(process.env);
  await Promise.all(Array.from({ length: 6 }, () => requireBillingDatabaseBinding(pool, accountConfig)));
  const binding = (await pool.query('SELECT account_id, mode FROM billing_account_binding')).rows;
  assert.deepEqual(binding, [{ account_id: 'acct_fixture', mode: 'test' }]);
  for (const other of [{ ...accountConfig, accountId: 'acct_other' }, { ...accountConfig, mode: 'live' }]) {
    await assert.rejects(requireBillingDatabaseBinding(pool, other), { code: 'billing_account_unavailable' });
  }
  assert.deepEqual((await pool.query('SELECT account_id, mode FROM billing_account_binding')).rows, binding);
  ok(true, 'database account binding: concurrent empty initialization is single-row and mismatch cannot adopt history');

  // Real server-enforced timeouts, not timer mocks. A one-slot pool also proves
  // the rejected request released its client and SET LOCAL did not leak.
  const timeoutPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 1000 });
  const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const settingsSql = "SELECT current_setting('lock_timeout') AS lock_timeout, current_setting('statement_timeout') AS statement_timeout";
  try {
    const originalSettings = (await timeoutPool.query(settingsSql)).rows;
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('xeno:billing-account-binding', 0))");
    await assert.rejects(requireBillingDatabaseBinding(timeoutPool, accountConfig), { code: 'billing_account_unavailable' });
    await holder.query('ROLLBACK');
    assert.deepEqual((await timeoutPool.query(settingsSql)).rows, originalSettings);
    await requireBillingDatabaseBinding(timeoutPool, accountConfig);
    ok(true, 'database account binding: real contended lock times out, rolls back, releases and preserves pooled settings');

    let released = 0;
    const slowInventoryPool = { connect: async () => {
      const client = await timeoutPool.connect();
      return { release() { released++; client.release(); }, query: (sql, ...args) =>
        client.query(sql.startsWith('SELECT account_id') ? 'SELECT pg_sleep(20)' : sql, ...args) };
    } };
    await assert.rejects(requireBillingDatabaseBinding(slowInventoryPool, accountConfig), { code: 'billing_account_unavailable' });
    assert.equal(released, 1);
    assert.deepEqual((await timeoutPool.query(settingsSql)).rows, originalSettings);
    assert.deepEqual((await timeoutPool.query('SELECT account_id, mode FROM billing_account_binding')).rows, binding);
    ok(true, 'database account binding: real slow query times out, rolls back, releases and preserves the binding');
  } finally {
    await holder.query('ROLLBACK').catch(() => {});
    await holder.end();
    await timeoutPool.end();
  }

  // ── 1. Grant is atomic + auditable + idempotent ────────────────────────────
  const u1 = await newUser();
  await handleEvent(pool, evt('evt_grant_1', 'checkout.session.completed', paidSession(u1, 1000, 'pi_1')));
  ok(await balance(u1) === C(1000), 'grant: balance = 1000 credits');
  ok(await txCount(u1, 'credit') === 1, 'grant: appended ONE credit_transactions journal row (auditable money-in)');
  ok(await eventCount('evt_grant_1') === 1, 'grant: billing_events claim recorded');
  const charge = (await pool.query('SELECT credits_micro, refunded_micro FROM billing_charges WHERE payment_intent=$1', ['pi_1'])).rows[0];
  ok(charge && Number(charge.credits_micro) === C(1000), 'grant: billing_charges mapped pi → 1000 credits');

  // replay the SAME event → no double credit, no second journal row
  await handleEvent(pool, evt('evt_grant_1', 'checkout.session.completed', paidSession(u1, 1000, 'pi_1')));
  ok(await balance(u1) === C(1000), 'replay: balance still 1000 (idempotent)');
  ok(await txCount(u1, 'credit') === 1, 'replay: still ONE credit journal row');
  await Promise.all(['a', 'b', 'c'].map(suffix => handleEvent(pool,
    evt(`evt_other_${suffix}`, 'checkout.session.async_payment_succeeded', paidSession(u1, 1000, 'pi_1')))));
  ok(await balance(u1) === C(1000) && await txCount(u1, 'credit') === 1, 'different concurrent event IDs for one checkout do not double-grant');
  await handleEvent(pool, evt('evt_same_pi_new_cs', 'checkout.session.completed', { ...paidSession(u1, 1000, 'pi_1'), id: 'cs_test_alternate' }));
  ok(await balance(u1) === C(1000), 'payment-intent claim also protects an already fulfilled purchase');

  // ── 2. Atomicity: a grant that fails mid-tx rolls back the event claim ──────
  // Pre-insert a conflicting ledger ref so addGrantTx's insertLedgerEntry hits
  // uq_credit_txn_ref and throws AFTER claimEventTx has inserted billing_events.
  const acctId = (await pool.query('SELECT id FROM credit_accounts WHERE user_id=$1', [u1])).rows[0].id;
  await pool.query(
    `INSERT INTO credit_transactions (user_id, account_id, type, amount, balance_after, reference_type, reference_id)
     VALUES ($1,$2,'credit',0,0,'xeno.grant','stripe:checkout:cs_test_pi_atomic')`,
    [u1, acctId],
  );
  const balBefore = await balance(u1);
  let threw = false;
  try {
    await handleEvent(pool, evt('evt_atomic', 'checkout.session.completed', paidSession(u1, 500, 'pi_atomic')));
  } catch { threw = true; }
  ok(threw, 'atomicity: grant collision throws (surfaces as 500 → Stripe retries)');
  ok(await eventCount('evt_atomic') === 0, 'atomicity: event claim ROLLED BACK (not marked processed) — money-taken-no-credits impossible');
  ok(await balance(u1) === balBefore, 'atomicity: balance unchanged after the failed grant');
  ok(await eventCount('checkout:cs_test_pi_atomic') === 0, 'atomicity: checkout claim rolled back');
  ok(!(await pool.query('SELECT 1 FROM billing_charges WHERE payment_intent=$1', ['pi_atomic'])).rows.length, 'atomicity: charge claim rolled back');

  // ── 3. Refund clawback: proportional, cumulative, idempotent ───────────────
  const u2 = await newUser();
  await handleEvent(pool, evt('evt_grant_2', 'checkout.session.completed', paidSession(u2, 1000, 'pi_2')));
  ok(await balance(u2) === C(1000), 'refund-setup: u2 granted 1000');

  // partial refund: 400 of 1000 cents refunded → claw 40% = 400 credits
  await handleEvent(pool, evt('evt_ref_a', 'charge.refunded', { payment_intent: 'pi_2', amount: 1000, amount_refunded: 400 }));
  ok(await balance(u2) === C(600), 'refund: partial 40% clawed → balance 600');
  ok(await txCount(u2, 'refund') === 1, 'refund: appended a reversing journal row');

  // replay the SAME refund event → no double clawback
  await handleEvent(pool, evt('evt_ref_a', 'charge.refunded', { payment_intent: 'pi_2', amount: 1000, amount_refunded: 400 }));
  ok(await balance(u2) === C(600), 'refund: replay is idempotent (still 600)');

  // second refund event, now cumulative full (1000/1000) → claw the remaining 600
  await handleEvent(pool, evt('evt_ref_b', 'charge.refunded', { payment_intent: 'pi_2', amount: 1000, amount_refunded: 1000 }));
  ok(await balance(u2) === 0, 'refund: cumulative full refund → balance 0');
  const chg2 = (await pool.query('SELECT refunded_micro FROM billing_charges WHERE payment_intent=$1', ['pi_2'])).rows[0];
  ok(Number(chg2.refunded_micro) === C(1000), 'refund: refunded_micro tracked cumulative = 1000');

  // ── 4. Refund shortfall: already-spent credits can't be over-clawed ────────
  const u3 = await newUser();
  await handleEvent(pool, evt('evt_grant_3', 'checkout.session.completed', paidSession(u3, 1000, 'pi_3')));
  await recordUsageV2(pool, u3, { transactionId: 'spend1', surface: 's', operation: 'o', costMicro: C(700) });
  ok(await balance(u3) === C(300), 'shortfall-setup: spent 700, balance 300');
  await handleEvent(pool, evt('evt_ref_c', 'charge.refunded', { payment_intent: 'pi_3', amount: 1000, amount_refunded: 1000 }));
  ok(await balance(u3) === 0, 'shortfall: full refund claws only the remaining 300 (clamped at 0, not negative)');

  // ── 5. Dispute: full clawback + account frozen ─────────────────────────────
  const u4 = await newUser();
  await handleEvent(pool, evt('evt_grant_4', 'checkout.session.completed', paidSession(u4, 1000, 'pi_4')));
  await handleEvent(pool, evt('evt_disp', 'charge.dispute.funds_withdrawn', { payment_intent: 'pi_4', amount: 1000 }));
  ok(await balance(u4) === 0, 'dispute: full grant clawed back → balance 0');
  ok(await frozen(u4) === true, 'dispute: account frozen (spend blocked)');

  // ── 6. Hash chain stays valid across credit + debit + refund ───────────────
  const chain = await verifyChainV2(pool, u2);
  ok(chain.ok, `chain: verifyChainV2 ok across grant+refunds (entries=${chain.entries})`);
  const chain3 = await verifyChainV2(pool, u3);
  ok(chain3.ok, `chain: verifyChainV2 ok across grant+debit+refund (entries=${chain3.entries})`);

  // ── 7. Dispute OPENED (created) → freeze without throwing (uuid=text regression) ──
  const u5 = await newUser();
  await handleEvent(pool, evt('evt_grant_5', 'checkout.session.completed', paidSession(u5, 1000, 'pi_5')));
  await handleEvent(pool, evt('evt_disp_open', 'charge.dispute.created', { payment_intent: 'pi_5', charge: 'ch_5' }));
  ok(await frozen(u5) === true, 'dispute.created: account frozen (no uuid=text plan error)');

  // ── 8. Clawback with an in-flight hold never drives the balance negative ────
  const u6 = await newUser();
  await handleEvent(pool, evt('evt_grant_6', 'checkout.session.completed', paidSession(u6, 1000, 'pi_6')));
  await holdV2(pool, u6, { holdId: 'h1', amountMicro: C(800), surface: 's', operation: 'o' });
  await handleEvent(pool, evt('evt_ref_hold', 'charge.refunded', { payment_intent: 'pi_6', amount: 1000, amount_refunded: 1000 }));
  ok(await balance(u6) === 0, 'hold+refund: posted balance clawed to 0');
  await settleHoldV2(pool, u6, 'h1', C(800)); // settle the pre-existing hold AFTER the clawback
  const rawBal = Number((await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1', [u6])).rows[0].balance);
  const legacyBal = Number((await pool.query('SELECT credits FROM users WHERE id=$1', [u6])).rows[0].credits);
  ok(rawBal >= 0 && legacyBal >= 0, `hold-settle after clawback: balance stays >= 0 (raw=${rawBal}, legacy=${legacyBal})`);

  // ── 9. $0 / 100%-off promo pack (no_payment_required) still grants ─────────
  const u7 = await newUser();
  const compSession = { ...paidSession(u7, 500, null), payment_status: 'no_payment_required', payment_intent: null };
  await handleEvent(pool, evt('evt_comp', 'checkout.session.completed', compSession));
  ok(await balance(u7) === C(500), 'promo: 100%-off pack grants credits (payment_status=no_payment_required)');
  await handleEvent(pool, evt('evt_comp_other', 'checkout.session.completed', compSession));
  ok(await balance(u7) === C(500), 'promo: different event ID without a payment intent cannot double-grant');

  // Subscription completion can precede settlement for delayed payment methods.
  const u8 = await newUser();
  const subscription = { ...paidSession(u8, 0, null), mode: 'subscription', subscription: 'sub_delayed',
    metadata: { xenoUserId: u8, itemId: 'pro_monthly' }, payment_status: 'unpaid' };
  await handleEvent(pool, evt('evt_sub_pending', 'checkout.session.completed', subscription));
  ok((await getPlan(pool, u8)).plan === 'free', 'unpaid subscription does not grant paid access');
  subscription.payment_status = 'paid';
  const remoteSubscription = { id: 'sub_delayed', customer: subscription.customer, status: 'active', created: 100,
    metadata: { ...subscription.metadata }, items: { data: [{ price: { id: 'price_test_pro' }, quantity: 1 }] } };
  const provider = { subscriptions: { retrieve: async id => {
    assert.equal(id, remoteSubscription.id); return structuredClone(remoteSubscription);
  } } };
  await handleEvent(pool, evt('evt_sub_settled', 'checkout.session.async_payment_succeeded', subscription), { provider });
  ok((await getPlan(pool, u8)).plan === 'pro', 'settled delayed subscription grants its plan');
  await handleEvent(pool, evt('evt_sub_settled', 'checkout.session.async_payment_succeeded', subscription), { provider });
  ok((await getPlan(pool, u8)).plan === 'pro', 'subscription event replay preserves its plan');
  ok(await balance(u8) === 0, 'subscription settlement does not invent top-up credits');
  remoteSubscription.status = 'canceled';
  await handleEvent(pool, evt('evt_sub_deleted', 'customer.subscription.deleted', remoteSubscription), { provider });
  await handleEvent(pool, evt('evt_late_checkout', 'checkout.session.completed', subscription), { provider });
  await handleEvent(pool, evt('evt_late_invoice', 'invoice.paid', { customer: subscription.customer, subscription: 'sub_delayed' }), { provider });
  ok((await getPlan(pool, u8)).plan === 'free', 'late checkout and paid invoice cannot resurrect a canceled subscription');
  remoteSubscription.status = 'active';
  await handleEvent(pool, evt('evt_late_failed', 'invoice.payment_failed', { customer: subscription.customer,
    parent: { subscription_details: { subscription: 'sub_delayed' } } }), { provider });
  ok((await getPlan(pool, u8)).status === 'active', 'late failed invoice cannot undo a successful payment retry');

  const teamUser = await newUser();
  const workspaceId = (await pool.query('INSERT INTO workspaces DEFAULT VALUES RETURNING id')).rows[0].id;
  const teamSession = { ...paidSession(teamUser, 0, null), mode: 'subscription', subscription: 'sub_team',
    metadata: { xenoUserId: teamUser, xenoWorkspaceId: workspaceId, itemId: 'team_seat', seats: '3' } };
  const teamResource = { id: 'sub_team', customer: teamSession.customer, status: 'active', created: 200,
    metadata: { ...teamSession.metadata }, items: { data: [{ price: { id: 'price_team_test' }, quantity: 3 }] } };
  const teamProvider = { subscriptions: { retrieve: async () => structuredClone(teamResource) } };
  await handleEvent(pool, evt('evt_team_paid', 'checkout.session.completed', teamSession), { provider: teamProvider });
  await handleEvent(pool, evt('evt_team_renewed', 'invoice.paid', { customer: teamSession.customer, subscription: 'sub_team' }), { provider: teamProvider });
  const teamState = (await pool.query("SELECT metadata->'billing' AS billing FROM workspaces WHERE id=$1", [workspaceId])).rows[0].billing;
  ok(teamState.plan === 'team' && teamState.seat_limit === 3 && (await getPlan(pool, teamUser)).plan === 'free', 'Team checkout and renewal fund workspace seats, not the owner personal plan');
  const failingProvider = { subscriptions: { retrieve: async () => { throw new Error('fixture provider unavailable'); } } };
  await assert.rejects(handleEvent(pool, evt('evt_team_failed', 'invoice.payment_failed', { customer: teamSession.customer, subscription: 'sub_team' }), { provider: failingProvider }));
  ok((await pool.query("SELECT metadata->'billing'->>'status' AS status FROM workspaces WHERE id=$1", [workspaceId])).rows[0].status === 'active', 'provider failure rolls back subscription state and requests webhook retry');

  // Real SQL ownership/item/expiry checks, not mocks that ignore WHERE clauses.
  await assert.rejects(requireCheckoutConsent(pool, u1, 'credits_small'), { code: 'consent_unavailable' });
  ok(true, 'missing consent migration blocks checkout');
  await pool.query(readFileSync(new URL('../database/migrations/20260824180000-checkout-consent.sql', import.meta.url), 'utf8'));
  const consent = (await pool.query(`INSERT INTO checkout_consents
    (user_id,item_id,immediate_performance,withdrawal_acknowledged,terms_accepted,consent_text,consent_hash)
    VALUES ($1,'credits_small',TRUE,TRUE,TRUE,'test wording',$2) RETURNING id`, [u1, CONSENT_HASH])).rows[0].id;
  assert.equal(await requireCheckoutConsent(pool, u1, 'credits_small', consent), consent);
  ok(true, 'owner can use a fresh matching consent after migration becomes available');
  for (const [uid, item] of [[u2, 'credits_small'], [u1, 'credits_large']]) {
    await assert.rejects(requireCheckoutConsent(pool, uid, item, consent), { code: 'consent_required' });
  }
  ok(true, 'supplied consent IDs cannot cross accounts or items');
  for (const assignment of ["consented_at = NOW() - INTERVAL '2 hours'", "consented_at = NOW() + INTERVAL '1 hour'", "consent_hash = 'old'", 'terms_accepted = FALSE']) {
    await pool.query('UPDATE checkout_consents SET consented_at=NOW(), consent_hash=$2, terms_accepted=TRUE WHERE id=$1', [consent, CONSENT_HASH]);
    await pool.query(`UPDATE checkout_consents SET ${assignment} WHERE id=$1`, [consent]);
    await assert.rejects(requireCheckoutConsent(pool, u1, 'credits_small', consent), { code: 'consent_required' });
  }
  ok(true, 'stale, future, wrong-wording and incomplete consents are rejected');
  await pool.query('UPDATE checkout_consents SET consented_at=NOW(), consent_hash=$2, terms_accepted=TRUE WHERE id=$1', [consent, CONSENT_HASH]);
  await consumeConsent(pool, consent, 'cs_test_binding');
  await consumeConsent(pool, consent, 'cs_test_binding');
  await assert.rejects(consumeConsent(pool, consent, 'cs_test_other'), { code: 'consent_consumed' });
  await assert.rejects(requireCheckoutConsent(pool, u1, 'credits_small', consent), { code: 'consent_required' });
  ok(true, 'consent binding retries are idempotent but cannot authorize another checkout');

  const statusProvider = session => ({ checkout: { sessions: { retrieve: async () => session } } });
  const settledSession = { ...paidSession(u1, 1000, 'pi_1'), id: 'cs_test_binding' };
  assert.deepEqual(await readCheckoutStatus(pool, statusProvider(settledSession), u1, 'cs_test_binding'), { state: 'fulfilled' });
  await assert.rejects(readCheckoutStatus(pool, statusProvider(settledSession), u2, 'cs_test_binding'), { status: 404 });
  ok(true, 'checkout status uses real SQL ownership and recorded payment fulfillment');
  const subConsent = (await pool.query(`INSERT INTO checkout_consents
    (user_id,item_id,immediate_performance,withdrawal_acknowledged,terms_accepted,consent_text,consent_hash,consumed_at,checkout_session_id)
    VALUES ($1,'pro_monthly',TRUE,TRUE,TRUE,'test',$2,NOW(),'cs_test_subscription') RETURNING id`, [u8, CONSENT_HASH])).rows[0].id;
  assert.ok(subConsent);
  assert.deepEqual(await readCheckoutStatus(pool, statusProvider({ ...subscription, id: 'cs_test_subscription' }), u8, 'cs_test_subscription'), { state: 'fulfilled' });
  ok(true, 'subscription status reads the canonical account-plan table');
  const replacement = { ...remoteSubscription, id: 'sub_replacement', created: 300 };
  const replacementProvider = { subscriptions: { retrieve: async id => structuredClone(id === replacement.id ? replacement : remoteSubscription) } };
  await handleEvent(pool, evt('evt_replacement', 'customer.subscription.created', replacement), { provider: replacementProvider });
  remoteSubscription.status = 'canceled';
  await handleEvent(pool, evt('evt_old_canceled', 'customer.subscription.deleted', remoteSubscription), { provider: replacementProvider });
  ok((await getPlan(pool, u8)).plan === 'pro', 'canceling a superseded subscription does not revoke its newer replacement');
  replacement.metadata = {};
  replacement.status = 'canceled';
  await handleEvent(pool, evt('evt_retired_price', 'customer.subscription.deleted', replacement), { provider: replacementProvider });
  ok((await getPlan(pool, u8)).plan === 'free', 'a retired price cannot prevent canceling its subscription');
  replacement.status = 'active';
  replacement.metadata = { xenoUserId: u1, itemId: 'pro_monthly' };
  await assert.rejects(handleEvent(pool, evt('evt_wrong_sub_owner', 'customer.subscription.updated', replacement), { provider: replacementProvider }));
  ok((await getPlan(pool, u8)).plan === 'free', 'subscription owner metadata mismatch cannot change access');

  // Exercise the actual raw-body HTTP handler and signature verifier, not only handleEvent.
  const app = express();
  app.post('/webhook', express.raw({ type: 'application/json' }), (req, res, next) => { req.db = pool; next(); }, stripeWebhook);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const u9 = await newUser();
    const payload = JSON.stringify(evt('evt_http_paid', 'checkout.session.completed', paidSession(u9, 1000, 'pi_http')));
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = `t=${timestamp},v1=${createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest('hex')}`;
    const send = (body, sig) => fetch(`http://127.0.0.1:${server.address().port}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig }, body });
    assert.equal((await send(payload, `t=${timestamp},v1=invalid`)).status, 400);
    ok(await balance(u9) === 0, 'HTTP: invalid signature cannot grant credits');
    assert.equal((await send(payload.replace('1000', '9000'), signature)).status, 400);
    ok(await balance(u9) === 0, 'HTTP: modified raw payload cannot grant credits');
    assert.equal((await send(payload, signature)).status, 200);
    assert.equal((await send(payload, signature)).status, 200);
    ok(await balance(u9) === C(1000) && await txCount(u9, 'credit') === 1, 'HTTP: signed payment applies once and repeated delivery returns 200');
  } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }

  console.log(`\n${fail === 0 ? '✅' : '❌'} billing-money-in: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exitCode = fail === 0 ? 0 : 1;
}
main().catch(async (e) => { console.error('FATAL', e); await pool.end(); process.exitCode = 1; });
