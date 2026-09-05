import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyHostedSubscription, refundSubscriptionCharge } from './lib/hosted-payment-proof.mjs';
function fixture() {
  const session = { id: 'cs_test_one', customer: 'cus_one', livemode: false, status: 'complete', payment_status: 'paid',
    mode: 'subscription', consent: { terms_of_service: 'accepted' }, subscription: 'sub_one' };
  const subscription = { id: 'sub_one', customer: 'cus_one', livemode: false, status: 'active', latest_invoice: 'in_one' };
  const invoice = { id: 'in_one', customer: 'cus_one', subscription: 'sub_one', charge: 'ch_one', livemode: false,
    status: 'paid', amount_paid: 900, currency: 'eur' };
  const charge = { id: 'ch_one', customer: 'cus_one', invoice: 'in_one', livemode: false, paid: true,
    amount: 900, amount_refunded: 0, currency: 'eur' };
  let writes = 0;
  const stripe = { checkout: { sessions: { retrieve: async () => session } }, subscriptions: { retrieve: async () => subscription },
    invoices: { retrieve: async () => invoice }, charges: { retrieve: async () => charge },
    refunds: { create: async (payload, options) => { writes++; assert.equal(payload.charge, 'ch_one');
      assert.equal(options.idempotencyKey, 'paid-loop-refund:run:ch_one'); charge.amount_refunded = 900; charge.refunded = true;
      return { id: 're_one', charge: 'ch_one', amount: 900, status: 'succeeded' }; } } };
  return { session, subscription, invoice, charge, stripe, writes: () => writes };
}
test('hosted proof binds paid consent and exact test subscription', async () => {
  const f = fixture(); assert.equal(await verifyHostedSubscription(f.stripe, 'cs_test_one', 'cus_one'), f.subscription);
  for (const patch of [{ status: 'open' }, { payment_status: 'unpaid' }, { customer: 'cus_other' }, { livemode: true },
    { consent: null }, { subscription: null }, { mode: 'payment' }]) {
    const f = fixture(); Object.assign(f.session, patch); await assert.rejects(verifyHostedSubscription(f.stripe, 'cs_test_one', 'cus_one'));
  }
  for (const patch of [{ id: 'sub_other' }, { customer: 'cus_other' }, { livemode: true }, { status: 'incomplete' }]) {
    const f = fixture(); Object.assign(f.subscription, patch); await assert.rejects(verifyHostedSubscription(f.stripe, 'cs_test_one', 'cus_one'));
  }
});
test('refund validates invoice, charge ownership and actual refunded amount', async () => {
  const f = fixture(); const report = await refundSubscriptionCharge(f.stripe, f.subscription, 'cus_one', 'run');
  assert.equal(report.amount, 900); assert.equal(f.writes(), 1);
  for (const [target, patch] of [['invoice', { subscription: 'sub_other' }], ['invoice', { customer: 'cus_other' }],
    ['invoice', { livemode: true }], ['invoice', { amount_paid: 0 }], ['invoice', { status: 'open' }],
    ['charge', { customer: 'cus_other' }], ['charge', { livemode: true }], ['charge', { invoice: 'in_other' }],
    ['charge', { amount: 1000 }], ['charge', { amount_refunded: 100 }]]) {
    const f = fixture(); Object.assign(f[target], patch);
    await assert.rejects(refundSubscriptionCharge(f.stripe, f.subscription, 'cus_one', 'run')); assert.equal(f.writes(), 0);
  }
});
