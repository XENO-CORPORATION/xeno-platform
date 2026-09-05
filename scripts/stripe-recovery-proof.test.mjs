import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryProof } from './lib/stripe-recovery-proof.mjs';

function fixture(options = {}) {
  let paused = false, plan = null, credits = '0', transactions = 0, sends = 0;
  const receipt = { id: 'evt_created', objectId: 'sub_owned', type: 'customer.subscription.created', reconciled: true };
  const receiver = { receipts: [], outageReceipts: [{ ...receipt, status: 503 }],
    setPaused(value) { paused = value; }, async waitForIdle() {} };
  const event = { id: receipt.id, type: receipt.type, livemode: false,
    data: { object: { id: 'sub_owned', customer: 'cus_owned', livemode: false } } };
  const stripe = { events: { retrieve: async () => options.event || event } };
  const current = status => ({ plan: status === 'active' ? 'pro' : 'free', status,
    stripe_subscription_id: 'sub_owned', current_period_end: '2026-10-04T00:00:00.000Z' });
  const db = { async query(sql) {
    if (sql.includes('FROM xeno_account_plans')) return { rows: plan ? [{ ...plan }] : [] };
    return { rows: [{ balance: credits, transactions }] };
  } };
  const services = { getEffectiveEntitlements: async () => ({ entitlements: { canDownload: options.outageAccess || plan?.status === 'active' } }) };
  const context = { db, services, subscription: { id: 'sub_owned' }, customerId: 'cus_owned', user: { id: '42' } };
  const proof = recoveryProof({ receiver, stripe, timeoutMs: 0, intervalMs: 0, resend: async id => {
    assert.equal(id, receipt.id); assert.equal(paused, false); sends++;
    if (options.missingReceipt) return;
    receiver.receipts.push({ ...receipt, reconciled: !options.noopReceipt });
    if (!plan || options.reopen) plan = current('active');
    if (options.duplicateMutation && sends === 2) { credits = '1000000'; transactions++; }
    if (options.wrongSubscription) plan.stripe_subscription_id = 'sub_foreign';
  } });
  return { proof, context, receiver, paused: () => paused, cancel: () => { plan = current('canceled'); } };
}

test('provider recovery, duplicate and stale-created after cancel preserve exact state', async () => {
  const f = fixture(); f.proof.beforeSubscription(); assert.equal(f.paused(), true);
  const recovered = await f.proof.afterSubscription(f.context);
  assert.equal(f.paused(), false); assert.equal(recovered.redeliveries.length, 2);
  f.cancel(); const final = await f.proof.afterCancellation();
  assert.deepEqual(final.redeliveries.map(r => r.successfulDeliveries), [1, 2, 3]);
});

test('unreceived, noop, unowned, already-open and duplicate-mutating proofs fail closed', async () => {
  for (const options of [{ missingReceipt: true }, { noopReceipt: true }, { outageAccess: true },
    { duplicateMutation: true }, { wrongSubscription: true },
    { event: { id: 'evt_foreign', type: 'customer.subscription.created', livemode: false } }]) {
    const f = fixture(options); f.proof.beforeSubscription();
    await assert.rejects(f.proof.afterSubscription(f.context));
    assert.equal(f.paused(), false, 'failure resumes cleanup delivery');
  }
  const f = fixture(); f.receiver.outageReceipts = []; f.proof.beforeSubscription();
  await assert.rejects(f.proof.afterSubscription(f.context)); assert.equal(f.paused(), false);
});

test('stale event cannot reopen a canceled subscription', async () => {
  const f = fixture({ reopen: true }); f.proof.beforeSubscription(); await f.proof.afterSubscription(f.context);
  f.cancel(); await assert.rejects(f.proof.afterCancellation(), /stale_event_reopened_access/);
});

test('provider event exact test identity and customer are required', async () => {
  const base = { id: 'evt_created', type: 'customer.subscription.created', livemode: false,
    data: { object: { id: 'sub_owned', customer: 'cus_owned', livemode: false } } };
  for (const event of [{ ...base, livemode: true }, { ...base, account: 'acct_other' },
    { ...base, type: 'invoice.paid' }, { ...base, data: { object: { ...base.data.object, id: 'sub_other' } } },
    { ...base, data: { object: { ...base.data.object, customer: 'cus_other' } } },
    { ...base, data: { object: { ...base.data.object, livemode: true } } }]) {
    const f = fixture({ event }); f.proof.beforeSubscription();
    await assert.rejects(f.proof.afterSubscription(f.context), /recovery_event_ownership/);
  }
});
