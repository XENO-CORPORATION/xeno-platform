const demand = (value, code) => { if (!value) throw new Error(code); };
const id = value => typeof value === 'string' ? value : value?.id;
const validId = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);

export async function verifyHostedSubscription(stripe, sessionId, customerId) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  demand(session.id === sessionId && session.livemode === false && id(session.customer) === customerId
    && session.status === 'complete' && session.payment_status === 'paid' && session.mode === 'subscription'
    && session.consent?.terms_of_service === 'accepted' && validId(id(session.subscription), 'sub'), 'hosted_checkout_unverified');
  const subscription = await stripe.subscriptions.retrieve(id(session.subscription));
  demand(subscription.id === id(session.subscription) && subscription.livemode === false
    && id(subscription.customer) === customerId && subscription.status === 'active', 'hosted_subscription_unverified');
  return subscription;
}

export async function refundSubscriptionCharge(stripe, subscription, customerId, runId) {
  demand(subscription.livemode === false && id(subscription.customer) === customerId
    && validId(id(subscription.latest_invoice), 'in'), 'refund_invoice_missing');
  const invoice = await stripe.invoices.retrieve(id(subscription.latest_invoice));
  demand(invoice.id === id(subscription.latest_invoice) && invoice.livemode === false && invoice.status === 'paid'
    && id(invoice.customer) === customerId && id(invoice.subscription) === subscription.id
    && invoice.currency === 'eur' && Number.isSafeInteger(invoice.amount_paid) && invoice.amount_paid > 0
    && validId(id(invoice.charge), 'ch'), 'refund_invoice_unverified');
  const charge = await stripe.charges.retrieve(id(invoice.charge));
  demand(charge.id === id(invoice.charge) && charge.livemode === false && charge.paid === true
    && id(charge.customer) === customerId && id(charge.invoice) === invoice.id
    && charge.currency === invoice.currency && charge.amount === invoice.amount_paid && charge.amount_refunded === 0,
  'refund_charge_unverified');
  const refund = await stripe.refunds.create({ charge: charge.id, amount: charge.amount },
    { idempotencyKey: `paid-loop-refund:${runId}:${charge.id}` });
  demand(validId(refund.id, 're') && id(refund.charge) === charge.id && refund.amount === charge.amount
    && refund.status === 'succeeded', 'refund_unverified');
  const confirmed = await stripe.charges.retrieve(charge.id);
  demand(confirmed.id === charge.id && confirmed.livemode === false && confirmed.amount_refunded === charge.amount
    && confirmed.refunded === true, 'refund_balance_unverified');
  return { invoiceId: invoice.id, chargeId: charge.id, refundId: refund.id, amount: refund.amount, currency: invoice.currency };
}
