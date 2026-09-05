import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceRenewal, ownedClock } from './lib/renewal-payment-proof.mjs';
function fixture() {
  const clock = { id: 'clock_one', name: 'xeno-paid-loop:run', livemode: false, status: 'ready', frozen_time: 1000 };
  const customer = { id: 'cus_one', livemode: false, test_clock: 'clock_one' };
  const subscription = { id: 'sub_one', customer: 'cus_one', test_clock: 'clock_one', livemode: false, status: 'active', current_period_end: 2000, latest_invoice: 'in_before' };
  const invoice = { id: 'in_after', customer: 'cus_one', subscription: 'sub_one', livemode: false, currency: 'eur', billing_reason: 'subscription_cycle', status: 'paid', amount_paid: 2400 };
  const receipts = [{ id: 'evt_one', type: 'invoice.paid', objectId: 'in_after', reconciled: true }];
  let advances = 0;
  const stripe = { customers: { retrieve: async () => customer }, subscriptions: { retrieve: async () => subscription },
    invoices: { retrieve: async () => invoice }, testHelpers: { testClocks: {
      retrieve: async () => clock, advance: async (_id, { frozen_time }) => {
        advances++; clock.frozen_time = frozen_time; subscription.current_period_end = 30000; subscription.latest_invoice = 'in_after';
      },
    } } };
  return { clock, customer, subscription, invoice, receipts, stripe, advances: () => advances,
    run: () => advanceRenewal({ stripe, clockId: 'clock_one', runId: 'run', customerId: 'cus_one', subscription, receipts, timeoutMs: 0, intervalMs: 0 }) };
}
test('renewal proves a new paid cycle invoice plus successfully reconciled exact delivery', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.invoiceId, 'in_after'); assert.equal(result.eventId, 'evt_one'); assert.equal(result.periodEnd, 30000);
  assert.equal(f.advances(), 1);
});
test('clock identity, mode and subscription/customer binding gate advancement', async () => {
  for (const [target, patch] of [['clock', { id: 'clock_other' }], ['clock', { name: 'foreign' }], ['clock', { livemode: true }],
    ['clock', { status: 'internal_failure' }], ['customer', { test_clock: 'clock_other' }], ['customer', { livemode: true }],
    ['subscription', { test_clock: 'clock_other' }], ['subscription', { customer: 'cus_other' }], ['subscription', { current_period_end: 999 }]]) {
    const f = fixture(); Object.assign(f[target], patch); await assert.rejects(f.run()); assert.equal(f.advances(), 0);
  }
  assert.equal(ownedClock({ id: 'clock_one', name: 'xeno-paid-loop:run', livemode: false }, 'run', 'clock_other'), false);
});
test('unpaid, wrong-owner, stale and missing invoice delivery cannot pass', async () => {
  for (const patch of [{ id: 'in_other' }, { subscription: 'sub_other' }, { customer: 'cus_other' }, { livemode: true },
    { currency: 'usd' }, { billing_reason: 'subscription_create' }, { status: 'open' }, { amount_paid: 0 }]) {
    const f = fixture(); Object.assign(f.invoice, patch); await assert.rejects(f.run());
  }
  for (const patch of [{ type: 'customer.subscription.updated' }, { objectId: 'in_before' }, { reconciled: false }]) {
    const f = fixture(); Object.assign(f.receipts[0], patch); await assert.rejects(f.run());
  }
  for (const variant of ['no_receipt', 'no_advance', 'old_invoice', 'old_period', 'advancing']) {
    const f = fixture(), advance = f.stripe.testHelpers.testClocks.advance;
    if (variant === 'no_receipt') f.receipts.length = 0;
    f.stripe.testHelpers.testClocks.advance = async (...args) => {
      if (variant === 'no_advance') return;
      await advance(...args);
      if (variant === 'old_invoice') f.subscription.latest_invoice = 'in_before';
      if (variant === 'old_period') f.subscription.current_period_end = 2000;
      if (variant === 'advancing') f.clock.status = 'advancing';
    };
    await assert.rejects(f.run());
  }
});
