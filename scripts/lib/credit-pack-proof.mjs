import { MICRO_PER_CREDIT } from '../../src/server/utils/creditLedgerV2.js';
const demand = (value, code) => { if (!value) throw new Error(code); };
const id = value => typeof value === 'string' ? value : value?.id;
const validId = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);

export async function verifyCreditPurchase(stripe, sessionId, customerId, userId, item) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  demand(session.id === sessionId && session.livemode === false && session.status === 'complete'
    && session.payment_status === 'paid' && session.mode === 'payment' && id(session.customer) === customerId
    && session.consent?.terms_of_service === 'accepted' && session.metadata?.xenoUserId === String(userId)
    && session.metadata?.itemId === item.id && Number(session.metadata?.credits) === item.credits
    && session.currency === 'eur' && session.amount_total === Math.round(item.price * 100), 'credit_checkout_unverified');
  const lines = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 2 });
  demand(lines.has_more === false && lines.data?.length === 1 && id(lines.data[0].price) === item.priceId
    && lines.data[0].quantity === 1, 'credit_price_unverified');
  demand(validId(id(session.payment_intent), 'pi'), 'credit_payment_missing');
  const intent = await stripe.paymentIntents.retrieve(id(session.payment_intent));
  demand(intent.id === id(session.payment_intent) && intent.livemode === false && intent.status === 'succeeded'
    && id(intent.customer) === customerId && intent.currency === 'eur' && intent.amount_received === session.amount_total
    && validId(id(intent.latest_charge), 'ch'), 'credit_payment_unverified');
  const charge = await stripe.charges.retrieve(id(intent.latest_charge));
  demand(charge.id === id(intent.latest_charge) && charge.livemode === false && charge.paid === true
    && id(charge.customer) === customerId && id(charge.payment_intent) === intent.id && charge.currency === 'eur'
    && charge.amount === session.amount_total && charge.amount_refunded === 0, 'credit_charge_unverified');
  return { sessionId, paymentIntent: intent.id, chargeId: charge.id, amount: charge.amount };
}

export async function runCreditPackProof({ stripe, db, services, user, customerId, runId, origin, receipts,
  checkout, rememberSession, timeoutMs = 90_000, intervalMs = 1000 }) {
  const item = services.getInternalCatalog().find(item => item.id === 'credits_small');
  demand(item?.kind === 'credits' && item.currency === 'eur' && Number.isSafeInteger(item.credits) && item.credits > 0
    && Number.isSafeInteger(item.credits * MICRO_PER_CREDIT) && validId(item.priceId, 'price'), 'credit_catalog_unverified');
  const micro = item.credits * MICRO_PER_CREDIT;
  const balance = async () => {
    const row = (await db.query(`SELECT COALESCE(c.balance, u.credits::bigint * $2) AS balance
      FROM users u LEFT JOIN credit_accounts c ON c.user_id = u.id WHERE u.id = $1`, [String(user.id), MICRO_PER_CREDIT])).rows[0];
    return row && Number(row.balance);
  };
  demand(await balance() === 0, 'credit_baseline_nonzero');
  const consentId = await services.recordConsent(db, { userId: user.id, itemId: item.id, immediatePerformance: true,
    withdrawalAcknowledged: true, termsAccepted: true, locale: 'en', clientIp: '127.0.0.1', userAgent: 'paid-loop-proof' });
  const session = await services.createCheckout(db, user, item.id, { consentId, origin });
  rememberSession(session.id);
  const binding = (await db.query('SELECT checkout_session_id, consumed_at FROM checkout_consents WHERE id=$1 AND user_id::text=$2',
    [consentId, String(user.id)])).rows[0];
  demand(binding?.checkout_session_id === session.id && Boolean(binding.consumed_at), 'credit_consent_binding');
  const url = new URL(session.url);
  demand(url.origin === 'https://checkout.stripe.com' && !url.username && !url.password, 'credit_checkout_url');
  await checkout(session);
  const purchase = await verifyCreditPurchase(stripe, session.id, customerId, user.id, item);
  const wait = async predicate => {
    const deadline = Date.now() + timeoutMs;
    do {
      if (await predicate()) return;
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    } while (Date.now() <= deadline);
    throw new Error('credit_ledger_not_delivered');
  };
  const state = async refunded => {
    const mapping = (await db.query('SELECT user_id, credits_micro, refunded_micro FROM billing_charges WHERE payment_intent=$1', [purchase.paymentIntent])).rows[0];
    const grants = (await db.query("SELECT COUNT(*)::int AS count FROM credit_transactions WHERE user_id=$1 AND type='credit' AND reference_type='xeno.grant' AND reference_id=$2",
      [String(user.id), `stripe:checkout:${session.id}`])).rows[0]?.count;
    return String(mapping?.user_id) === String(user.id) && Number(mapping?.credits_micro) === micro
      && Number(mapping?.refunded_micro) === refunded && grants === 1 && await balance() === micro - refunded;
  };
  await wait(async () => receipts.some(r => ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(r.type)
    && r.objectId === session.id && r.reconciled) && await state(0));
  const report = { ...purchase, credits: item.credits, refunds: [] };
  let previousAmount = 0;
  for (const target of [Math.round(purchase.amount * 0.4), purchase.amount]) {
    const before = await stripe.charges.retrieve(purchase.chargeId);
    demand(before.id === purchase.chargeId && before.livemode === false && before.paid === true && id(before.customer) === customerId
      && id(before.payment_intent) === purchase.paymentIntent && before.currency === 'eur'
      && before.amount === purchase.amount && before.amount_refunded === previousAmount, 'credit_refund_baseline');
    const oldReceipts = new Set(receipts.map(r => r.id));
    const refund = await stripe.refunds.create({ charge: purchase.chargeId, amount: target - previousAmount },
      { idempotencyKey: `paid-loop-credit-refund:${runId}:${purchase.chargeId}:${target}` });
    demand(validId(refund.id, 're') && id(refund.charge) === purchase.chargeId && refund.status === 'succeeded'
      && refund.amount === target - previousAmount, 'credit_refund_unverified');
    const after = await stripe.charges.retrieve(purchase.chargeId);
    demand(after.id === purchase.chargeId && after.livemode === false && after.amount_refunded === target
      && (target !== purchase.amount || after.refunded === true), 'credit_refund_cumulative');
    const refundedMicro = Math.round(micro * target / purchase.amount);
    await wait(async () => receipts.some(r => !oldReceipts.has(r.id) && r.type === 'charge.refunded'
      && r.objectId === purchase.chargeId && r.reconciled) && await state(refundedMicro));
    report.refunds.push({ id: refund.id, amount: refund.amount, cumulativeAmount: target, balanceMicro: micro - refundedMicro });
    previousAmount = target;
  }
  return report;
}
