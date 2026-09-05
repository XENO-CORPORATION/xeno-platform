const demand = (value, code) => { if (!value) throw new Error(code); };
const owner = value => typeof value === 'string' ? value : value?.id;

// Qualification-only control. Every replay is delivered and signed by Stripe;
// no locally generated event or direct handler invocation can qualify this path.
export function recoveryProof({ receiver, stripe, resend, timeoutMs = 90_000, intervalMs = 1000 }) {
  let context, eventId;
  const report = { redeliveries: [] };
  const wait = async predicate => {
    const deadline = Date.now() + timeoutMs;
    do {
      if (await predicate()) return;
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    } while (Date.now() <= deadline);
    throw new Error('recovery_delivery_timeout');
  };
  const count = () => receiver.receipts.filter(r => r.id === eventId && r.type === 'customer.subscription.created'
    && r.objectId === context.subscription.id && r.reconciled === true).length;
  const state = async () => {
    const plan = (await context.db.query('SELECT plan,status,stripe_subscription_id,current_period_end FROM xeno_account_plans WHERE user_id::text=$1', [String(context.user.id)])).rows[0];
    const ledger = (await context.db.query(`SELECT COALESCE(c.balance,u.credits::bigint*1000000)::text AS balance,
      (SELECT COUNT(*)::int FROM credit_transactions t WHERE t.user_id=u.id) AS transactions
      FROM users u LEFT JOIN credit_accounts c ON c.user_id=u.id WHERE u.id=$1`, [String(context.user.id)])).rows[0];
    demand(ledger && /^-?\d+$/.test(ledger.balance) && Number.isInteger(ledger.transactions), 'recovery_ledger_missing');
    const canDownload = (await context.services.getEffectiveEntitlements(context.db, context.user.id))?.entitlements?.canDownload;
    demand(typeof canDownload === 'boolean', 'recovery_entitlement_missing');
    return { plan: plan || null, ledger, canDownload };
  };
  const replay = async label => {
    const before = count();
    await resend(eventId);
    await wait(() => count() > before);
    await receiver.waitForIdle();
    report.redeliveries.push({ label, eventId, successfulDeliveries: count() });
  };
  return {
    beforeSubscription() { receiver.setPaused(true); },
    resume() { receiver.setPaused(false); },
    async afterSubscription(value) {
      context = value;
      try {
        await wait(() => receiver.outageReceipts.some(r => r.type === 'customer.subscription.created'
          && r.objectId === context.subscription.id && r.status === 503));
        const rejected = receiver.outageReceipts.find(r => r.type === 'customer.subscription.created'
          && r.objectId === context.subscription.id && r.status === 503);
        eventId = rejected.id;
        demand(/^evt_[A-Za-z0-9]+$/.test(eventId), 'recovery_event_id');
        const event = await stripe.events.retrieve(eventId);
        demand(event.id === eventId && event.type === 'customer.subscription.created' && event.livemode === false
          && event.account == null && event.data?.object?.id === context.subscription.id
          && event.data.object.livemode === false && owner(event.data.object.customer) === context.customerId,
        'recovery_event_ownership');
        const blocked = await state();
        demand(!blocked.canDownload && !['active', 'trialing', 'past_due'].includes(blocked.plan?.status), 'outage_granted_access');
        report.rejectedEvent = rejected;
        receiver.setPaused(false);
        await replay('recover-after-503');
        const active = await state();
        demand(active.plan?.plan === 'pro' && active.plan.status === 'active'
          && active.plan.stripe_subscription_id === context.subscription.id && active.canDownload, 'recovery_not_active');
        demand(JSON.stringify(active.ledger) === JSON.stringify(blocked.ledger), 'recovery_changed_ledger');
        await replay('duplicate-active');
        demand(JSON.stringify(await state()) === JSON.stringify(active), 'duplicate_changed_state');
        return report;
      } finally { receiver.setPaused(false); }
    },
    async afterCancellation() {
      const canceled = await state();
      demand(canceled.plan?.status === 'canceled' && canceled.plan.stripe_subscription_id === context.subscription.id
        && canceled.canDownload === false, 'recovery_not_canceled');
      await replay('stale-created-after-cancel');
      demand(JSON.stringify(await state()) === JSON.stringify(canceled), 'stale_event_reopened_access');
      return report;
    },
  };
}
