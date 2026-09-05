/**
 * THE THREE THINGS THAT COST MONEY QUIETLY.
 *
 * None of these change whether a payment succeeds. All three change what happens
 * afterwards, which is why they are the ones that get skipped:
 *
 *   1. a DISPUTE opens a 7–21 day response window. Before this, the webhook
 *      froze the account and told nobody, so the window opened in silence — and
 *      a window nobody knows about is a window that closes. A missed deadline is
 *      an automatic loss of the money AND the fee.
 *   2. an unrecognisable STATEMENT DESCRIPTOR is a leading cause of disputes in
 *      the first place. Someone who cannot place a charge from three weeks ago
 *      calls their bank, not us.
 *   3. one-time payments are NOT invoiced by Stripe automatically, so a credit
 *      pack would leave a German buyer with a receipt and no Rechnung.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installBillingProviderFixture, boundBillingPool } from './fixtures/billing-provider-fixture.mjs';

process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_fixture';
process.env.STRIPE_EXPECTED_ACCOUNT_ID = 'acct_fixture';
process.env.STRIPE_EXPECTED_MODE = 'test';
const accountFixture = installBillingProviderFixture();

const billing = readFileSync('src/server/services/billingService.js', 'utf8');
const email = readFileSync('src/server/services/emailService.js', 'utf8');

test('all checkout paths validate consent and use purchase-bound provider idempotency', () => {
  assert.equal((billing.match(/await requireCheckoutConsent\(pool, user.id, item.id, consentId\)/g) || []).length, 2);
  assert.equal((billing.match(/idempotencyKey: `xeno-checkout:\$\{consentId\}`/g) || []).length, 2);
  assert.doesNotMatch(billing, /if \(await consentReady/);
});

test('checkout status authorizes before Stripe and never infers fulfillment from a redirect', async () => {
  const { readCheckoutStatus } = await import('../src/server/services/checkoutStatus.js');
  let calls = 0;
  const session = { id: 'cs_test_owned', metadata: { xenoUserId: 'owner', itemId: 'credits_small' }, mode: 'payment', status: 'complete', payment_status: 'unpaid' };
  const provider = { checkout: { sessions: { retrieve: async () => { calls++; return session; } } } };
  await assert.rejects(readCheckoutStatus({ query: async () => ({ rows: [] }) }, provider, 'other', 'cs_test_owned'), { status: 404 });
  assert.equal(calls, 0);
  let fulfillmentRows = [];
  const pool = { query: async sql => ({ rows: sql.includes('checkout_consents') ? [{ item_id: 'credits_small' }] : fulfillmentRows }) };
  await assert.rejects(readCheckoutStatus(pool, provider, 'owner', '../other'), { status: 404 });
  assert.equal(calls, 0);
  assert.deepEqual(await readCheckoutStatus(pool, provider, 'owner', 'cs_test_owned'), { state: 'processing' });
  session.payment_status = 'paid';
  assert.deepEqual(await readCheckoutStatus(pool, provider, 'owner', 'cs_test_owned'), { state: 'fulfilling' });
  fulfillmentRows = [{ '?column?': 1 }];
  assert.deepEqual(await readCheckoutStatus(pool, provider, 'owner', 'cs_test_owned'), { state: 'fulfilled' });
  session.metadata.xenoUserId = 'another';
  await assert.rejects(readCheckoutStatus(pool, provider, 'owner', 'cs_test_owned'), { status: 404 });
  session.metadata.xenoUserId = 'owner';
  session.metadata.itemId = 'different';
  await assert.rejects(readCheckoutStatus(pool, provider, 'owner', 'cs_test_owned'), { status: 404 });
  session.metadata.itemId = 'credits_small';
  session.status = 'expired'; session.payment_status = 'unpaid';
  assert.deepEqual(await readCheckoutStatus(pool, provider, 'owner', 'cs_test_owned'), { state: 'expired' });
  session.status = 'open';
  assert.deepEqual(await readCheckoutStatus(pool, provider, 'owner', 'cs_test_owned'), { state: 'open' });
});

test('unpaid or unknown checkout settlement never activates plans or grants credits', async () => {
  const { handleEvent } = await import('../src/server/services/billingService.js');
  const pool = boundBillingPool();
  for (const mode of ['subscription', 'payment']) {
    for (const payment_status of ['unpaid', undefined, 'unknown']) {
      for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded']) {
        assert.deepEqual(await handleEvent(pool, accountFixture.event('evt_unsettled', type, { mode, payment_status,
          customer: 'cus_test', client_reference_id: 'test-user', metadata: { credits: 1000 } })),
          { handled: true, reason: 'payment not settled' });
      }
    }
  }
});

/* ── 1 · Disputes reach a human ──────────────────────────────────────────── */

test('🔴 a dispute ALERTS before it freezes', () => {
  /* Order matters only for one reason: whichever runs first is the one that
   * survives an exception in the other. The alert is the part with a legal
   * deadline, so it goes first. */
  const c = billing.slice(billing.indexOf("case 'charge.dispute.created'"));
  const alert = c.indexOf('alertDisputeOpened');
  const freeze = c.indexOf('is_frozen=true');
  assert.ok(alert > -1, 'a dispute no longer alerts anyone — the response window opens in silence');
  assert.ok(freeze > -1, 'the dispute no longer freezes the account');
  assert.ok(alert < freeze, 'the alert runs after the freeze — an error in the freeze would swallow it');
});

test('the alert can never break the webhook', () => {
  /* A failed alert must not make Stripe retry the event: the freeze and the
   * clawback are exactly the parts that must not run twice, and an
   * unacknowledged webhook is redelivered. */
  const c = billing.slice(billing.indexOf("case 'charge.dispute.created'"), billing.indexOf("case 'charge.dispute.created'") + 700);
  assert.ok(/alertDisputeOpened\(pool, obj\)\.catch\(/.test(c),
    'the dispute alert is unguarded — a mail failure would make Stripe redeliver and re-run the clawback');
});

test('the alert logs at ERROR level before it tries to send', () => {
  /* If the mail path is broken, this line is the only surviving trace. It must
   * not depend on anything else working. */
  const fn = billing.slice(billing.indexOf('async function alertDisputeOpened'));
  const log = fn.indexOf('console.error');
  const send = fn.indexOf('sendEmail');
  assert.ok(log > -1 && send > -1, 'the alert lost either its log or its send');
  assert.ok(log < send, 'the log runs after the send — a broken mail path would leave no trace at all');
  assert.ok(/DISPUTE OPENED/.test(fn.slice(0, 1800)), 'the log line is no longer greppable');
});

test('the deadline is IN the alert, not a link away', () => {
  /* Someone reading this on a phone must not have to go looking for the amount
   * or the date to know how urgent it is. */
  const tpl = email.slice(email.indexOf('dispute_opened:'), email.indexOf('dispute_opened:') + 2200);
  for (const field of ['dueBy', 'amount', 'reason', 'disputeId']) {
    assert.ok(tpl.includes(field), `the dispute alert omits ${field}`);
  }
  /* The SUBJECT specifically. The body table also says "Respond by", so a
   * whole-template check stayed green with the deadline stripped from the
   * subject — and the subject is the only part visible in a notification. */
  const subject = tpl.slice(tpl.indexOf('subject:'), tpl.indexOf('html:'));
  assert.ok(/respond by/i.test(subject),
    'the subject no longer carries the deadline — the only part visible in a phone notification');
});

test('🔴 nobody can unsubscribe from a dispute alert', () => {
  /* It is operator mail with a legal deadline. Honouring an unsubscribe would
   * let one careless click permanently disable the only warning the business
   * gets. */
  const set = email.slice(email.indexOf('ESSENTIAL_TEMPLATES = new Set('), email.indexOf('ESSENTIAL_TEMPLATES = new Set(') + 200);
  assert.ok(set.includes('dispute_opened'),
    'dispute_opened is not essential — an unsubscribe would silence the chargeback warning');
});

/* ── 2 · The descriptor ──────────────────────────────────────────────────── */

test('a statement descriptor is always set', () => {
  assert.ok(billing.includes('statement_descriptor_suffix: statementDescriptor()'),
    'no statement descriptor — the charge shows whatever Stripe derives, which is the unrecognisable case');
  const fn = billing.slice(billing.indexOf('function statementDescriptor()'));
  /* BOTH fallbacks. There are two — the env default and the post-clamp guard —
   * so counting them is what catches one being removed. A value stripped to
   * nothing by the clamp must still not reach Stripe empty. */
  const fallbacks = (fn.slice(0, 350).match(/'XENOSTUDIO'/g) || []).length;
  assert.equal(fallbacks, 2,
    `expected an env default AND a post-clamp fallback, found ${fallbacks} — an empty or fully-stripped value would reach Stripe`);
});

test('the descriptor is CLAMPED to what Stripe accepts', () => {
  /* Stripe caps at 22 chars and rejects < > \\ ' " * — a violation is refused at
   * session creation, turning a cosmetic setting into a checkout outage. */
  const fn = billing.slice(billing.indexOf('function statementDescriptor()'), billing.indexOf('function statementDescriptor()') + 400);
  assert.ok(/slice\(0, 10\)/.test(fn), 'the suffix must leave room for the account prefix and separator');
  assert.ok(fn.includes('/[a-zA-Z]/.test(suffix)'));

  const m = fn.match(/raw\.replace\((\/\[[^\]]+\]\/g)/);
  assert.ok(m, 'the descriptor no longer strips rejected characters');
  // eslint-disable-next-line no-eval
  const re = eval(m[1]);
  for (const ch of ['<', '>', '"', "'", '*', '\\']) {
    assert.equal(`X${ch}Y`.replace(re, ''), 'XY', `the descriptor does not strip ${ch}, which Stripe rejects`);
  }
});

/* ── 3 · Invoices for one-time payments ──────────────────────────────────── */

test('one-time payments produce an invoice', () => {
  /* Subscriptions are invoiced automatically; payments are not. Without this a
   * credit pack leaves a German buyer with a receipt and no Rechnung. */
  assert.ok(billing.includes('invoice_creation: { enabled: true }'),
    'one-time payments no longer generate an invoice');
});

test('invoice creation and the descriptor apply to PAYMENTS, not subscriptions', () => {
  /* Stripe rejects both fields on a subscription-mode session, so applying them
   * unconditionally would break every plan purchase. */
  for (const field of ['payment_intent_data', 'invoice_creation']) {
    const i = billing.indexOf(field);
    assert.ok(i > -1, `${field} is gone`);
    const before = billing.slice(Math.max(0, i - 200), i);
    assert.ok(/item\.kind === 'subscription' \? \{\} :/.test(before),
      `${field} is applied unconditionally — Stripe refuses it on a subscription session`);
  }
});
