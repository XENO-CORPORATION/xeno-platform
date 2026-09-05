const demand = (condition, code) => { if (!condition) throw new Error(code); };
const id = value => typeof value === 'string' ? value : value?.id;
export const periodEnd = sub => sub.current_period_end || sub.items?.data?.[0]?.current_period_end;
export function ownedClock(clock, runId, clockId = clock?.id) {
  return /^clock_[A-Za-z0-9]+$/.test(clockId || '') && clock?.id === clockId
    && clock.livemode === false && clock.name === `xeno-paid-loop:${runId}`;
}
export async function advanceRenewal({ stripe, clockId, runId, customerId, subscription, receipts,
  timeoutMs = 120_000, intervalMs = 1000 }) {
  const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
  demand(ownedClock(clock, runId, clockId) && clock.status === 'ready', 'clock_ownership');
  const customer = await stripe.customers.retrieve(customerId);
  demand(customer.id === customerId && customer.livemode === false && id(customer.test_clock) === clockId, 'clock_customer');
  const current = await stripe.subscriptions.retrieve(subscription.id);
  demand(current.id === subscription.id && current.livemode === false && id(current.customer) === customerId
    && current.status === 'active' && id(current.test_clock) === clockId, 'clock_subscription');
  const before = periodEnd(current), previousInvoice = id(current.latest_invoice);
  demand(Number.isSafeInteger(before) && before > clock.frozen_time && before - clock.frozen_time <= 32 * 86400
    && /^in_[A-Za-z0-9]+$/.test(previousInvoice || ''), 'renewal_baseline');
  const target = before + 7200;
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: target });
  const deadline = Date.now() + timeoutMs;
  do {
    const advanced = await stripe.testHelpers.testClocks.retrieve(clockId);
    demand(ownedClock(advanced, runId, clockId) && ['ready', 'advancing'].includes(advanced.status), 'clock_advance_failed');
    if (advanced.status === 'ready' && advanced.frozen_time === target) {
      const renewed = await stripe.subscriptions.retrieve(subscription.id);
      demand(renewed.id === subscription.id && renewed.livemode === false && id(renewed.customer) === customerId
        && id(renewed.test_clock) === clockId, 'renewal_owner_changed');
      const invoiceId = id(renewed.latest_invoice);
      if (renewed.status === 'active' && periodEnd(renewed) > before && invoiceId !== previousInvoice && /^in_[A-Za-z0-9]+$/.test(invoiceId || '')) {
        const invoice = await stripe.invoices.retrieve(invoiceId);
        demand(invoice.id === invoiceId && invoice.livemode === false && id(invoice.customer) === customerId
          && id(invoice.subscription) === subscription.id && invoice.currency === 'eur'
          && invoice.billing_reason === 'subscription_cycle', 'renewal_invoice_owner');
        const receipt = receipts.find(event => ['invoice.paid', 'invoice.payment_succeeded'].includes(event.type)
          && event.objectId === invoiceId && event.reconciled === true);
        if (invoice.status === 'paid' && Number.isSafeInteger(invoice.amount_paid) && invoice.amount_paid > 0 && receipt) {
          return { invoiceId, subscriptionId: subscription.id, periodEnd: periodEnd(renewed),
            previousPeriodEnd: before, amount: invoice.amount_paid, currency: invoice.currency, eventId: receipt.id };
        }
      }
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  } while (Date.now() <= deadline);
  throw new Error('renewal_not_delivered');
}
