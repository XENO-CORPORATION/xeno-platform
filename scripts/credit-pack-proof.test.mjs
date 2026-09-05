import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCreditPurchase, runCreditPackProof } from './lib/credit-pack-proof.mjs';
function fixture(options = {}) {
  const item = { id: 'credits_small', kind: 'credits', credits: 1000, price: 10, currency: 'eur', priceId: 'price_one' };
  const session = { id: 'cs_test_one', livemode: false, status: 'complete', payment_status: 'paid', mode: 'payment', customer: 'cus_one',
    consent: { terms_of_service: 'accepted' }, metadata: { xenoUserId: 'user', itemId: item.id, credits: '1000' }, currency: 'eur', amount_total: 1000, payment_intent: 'pi_one', url: 'https://checkout.stripe.com/c/pay/test' };
  const intent = { id: 'pi_one', livemode: false, status: 'succeeded', customer: 'cus_one', currency: 'eur', amount_received: 1000, latest_charge: 'ch_one' };
  const charge = { id: 'ch_one', livemode: false, paid: true, customer: 'cus_one', payment_intent: 'pi_one', currency: 'eur', amount: 1000, amount_refunded: 0 };
  const lines = { has_more: false, data: [{ price: { id: 'price_one' }, quantity: 1 }] };
  const receipts = [];
  let balance = 0, refunded = 0, writes = 0;
  const stripe = { checkout: { sessions: { retrieve: async () => session, listLineItems: async () => lines } },
    paymentIntents: { retrieve: async () => intent }, charges: { retrieve: async () => charge }, refunds: {
      create: async ({ amount }) => {
        writes++; charge.amount_refunded += amount; charge.refunded = charge.amount_refunded === 1000;
        if (!options.noLedgerRefund) { refunded = charge.amount_refunded * 1_000_000; balance = 1_000_000_000 - refunded; }
        if (!(options.reusedReceipt && writes === 2)) receipts.push({ id: `evt_refund${writes}`, type: 'charge.refunded', objectId: 'ch_one', reconciled: true });
        return { id: `re_${writes}`, charge: 'ch_one', status: 'succeeded', amount };
      },
    } };
  const db = { query: async sql => {
    if (sql.includes('LEFT JOIN credit_accounts')) return { rows: [{ balance }] };
    if (sql.includes('checkout_consents')) return { rows: [{ checkout_session_id: 'cs_test_one', consumed_at: 'now' }] };
    if (sql.includes('billing_charges')) return { rows: [{ user_id: options.wrongMapping ? 'foreign' : 'user', credits_micro: 1_000_000_000, refunded_micro: refunded }] };
    if (sql.includes('credit_transactions')) return { rows: [{ count: options.doubleGrant ? 2 : 1 }] };
    throw new Error('unexpected SQL');
  } };
  const services = { getInternalCatalog: () => [item], recordConsent: async () => 'consent', createCheckout: async () => session };
  const run = () => runCreditPackProof({ stripe, db, services, user: { id: 'user' }, customerId: 'cus_one', runId: 'run', origin: 'http://localhost', receipts,
    rememberSession: () => {}, checkout: async () => { balance = 1_000_000_000; receipts.push({ id: 'evt_checkout', type: 'checkout.session.completed', objectId: 'cs_test_one', reconciled: !options.noCheckoutReceipt }); }, timeoutMs: 0 });
  return { item, session, intent, charge, lines, stripe, run, writes: () => writes };
}
test('credit purchase verifies exact price, paid owner and charge before any refund', async () => {
  const f = fixture(); assert.equal((await verifyCreditPurchase(f.stripe, 'cs_test_one', 'cus_one', 'user', f.item)).amount, 1000);
  for (const [target, patch] of [['session', { status: 'open' }], ['session', { livemode: true }], ['session', { payment_status: 'unpaid' }],
    ['session', { customer: 'cus_other' }], ['session', { consent: null }], ['session', { amount_total: 1 }],
    ['session', { metadata: { xenoUserId: 'foreign' } }], ['intent', { livemode: true }], ['intent', { amount_received: 0 }],
    ['intent', { customer: 'cus_other' }], ['charge', { customer: 'cus_other' }], ['charge', { payment_intent: 'pi_other' }],
    ['charge', { amount_refunded: 100 }], ['lines', { has_more: true }], ['lines', { data: [{ price: 'price_other', quantity: 1 }] }]]) {
    const f = fixture(); Object.assign(f[target], patch); await assert.rejects(verifyCreditPurchase(f.stripe, 'cs_test_one', 'cus_one', 'user', f.item));
    assert.equal(f.writes(), 0);
  }
});
test('credit ledger proves 40 percent then full refund with distinct receipt IDs', async () => {
  const f = fixture(), result = await f.run();
  assert.deepEqual(result.refunds.map(r => r.balanceMicro), [600_000_000, 0]); assert.equal(f.writes(), 2);
  for (const option of ['noLedgerRefund', 'reusedReceipt', 'doubleGrant', 'wrongMapping', 'noCheckoutReceipt']) {
    await assert.rejects(fixture({ [option]: true }).run(), option);
  }
});
