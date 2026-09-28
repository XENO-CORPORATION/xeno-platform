// Paid-lot provenance foundation for project contributions. This is deliberately NOT a
// FUND-02 citation yet: contribution admission must consume this evidence before that is true.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';
import { installBillingProviderFixture } from './fixtures/billing-provider-fixture.mjs';

const url = process.env.TEST_DATABASE_URL;
if (url) requireProofDatabase(url);
if (process.env.NODE_ENV === 'production') throw new Error('Payment origin proof requires an isolated test environment');
process.env.STRIPE_SECRET_KEY = 'sk_test_localfixture';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_localfixture';
process.env.STRIPE_EXPECTED_ACCOUNT_ID = 'acct_fixture';
process.env.STRIPE_EXPECTED_MODE = 'test';
const fixture = installBillingProviderFixture();
const { handleEvent } = await import('../src/server/services/billingService.js');
const { addGrant } = await import('../src/server/utils/creditLedgerV2.js');
const { migrateAccountV2 } = await import('../src/server/database/migrate-account-v2.js');

test('payment origins bind settled monetary evidence to the exact lot atomically', { skip: !url }, async t => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(() => pool.end());
  const { runAllMigrations } = await import('../src/server/services/migrationRunner.js');
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  const marker = randomUUID().replaceAll('-', '');
  const user = async tag => (await pool.query(`INSERT INTO users(username,email,password_hash,email_verified,display_name)
    VALUES($1,$2,'fixture-only',true,$1) RETURNING id`, [marker + tag, `${marker}${tag}@example.test`])).rows[0].id;
  const alice = await user('a');
  const session = (tag, patch = {}) => ({ id: `cs_${marker}${tag}`, mode: 'payment', payment_status: 'paid',
    payment_intent: `pi_${marker}${tag}`, client_reference_id: alice, customer: `cus_${marker}`,
    amount_total: 500, currency: 'eur', metadata: { xenoUserId: alice, credits: '5', kind: 'credits' }, ...patch });
  const event = (tag, s) => fixture.event(`evt_${marker}${tag.replaceAll('-', '_')}`, 'checkout.session.completed', s);
  const run = e => handleEvent(pool, e, { provider: fixture.provider });
  const rows = async () => (await pool.query(`SELECT p.*,g.user_id,g.source_ref,g.kind,g.amount_micro AS grant_micro
    FROM credit_grant_payment_origins p JOIN credit_grants g ON g.id=p.grant_id ORDER BY p.checkout_session`)).rows;

  await t.test('a settled checkout records exact provider, mode, payment, lot and monetary amount', async () => {
    const s = session('paid');
    await run(event('paid', s));
    const [origin] = await rows();
    assert.ok(origin, 'a paid fulfillment records its payment origin');
    assert.deepEqual([origin.provider_account, origin.provider_mode, origin.payment_intent, origin.checkout_session,
      origin.paid_minor, origin.currency, origin.amount_micro, origin.grant_micro, origin.user_id],
    ['acct_fixture', 'test', s.payment_intent, s.id, '500', 'eur', '5000000', '5000000', alice],
    'payment origin describes the exact purchased lot');
    await run(event('paid', s));
    await run(event('second-event', s));
    assert.equal((await rows()).length, 1, 'replayed checkout cannot mint a second payment origin');
  });

  await t.test('paid labels, fake references and zero-price promotions do not prove paid origin', async () => {
    await addGrant(pool, alice, { amountMicro: 1000, kind: 'paid', sourceRef: 'backfill' });
    await addGrant(pool, alice, { amountMicro: 1000, kind: 'paid', sourceRef: `stripe:checkout:cs_fake_${marker}` });
    await run(event('free', session('free', { payment_status: 'no_payment_required', amount_total: 0, payment_intent: null })));
    await run(event('zero', session('zero', { amount_total: 0 })));
    await run(event('missing-money', session('missing-money', { amount_total: undefined })));
    await run(event('missing-pi', session('missing-pi', { payment_intent: null })));
    await run(event('invalid-currency', session('invalid-currency', { currency: 'EUR' })));
    await run(event('pending', session('pending', { payment_status: 'unpaid' })));
    assert.deepEqual((await rows()).map(r => r.checkout_session), [session('paid').id],
      'only a positive settled payment has transferable origin');
    const promo = (await pool.query('SELECT amount_micro FROM credit_grants WHERE source_ref=$1', [`stripe:checkout:${session('free').id}`])).rows;
    assert.equal(promo[0]?.amount_micro, '5000000', 'zero-price fulfillment still grants usable credits without transfer evidence');
  });

  await t.test('origin recording and fulfillment roll back together on a write failure', async () => {
    await pool.query(`CREATE FUNCTION reject_fixture_origin() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture origin write failed'; END $$;
      CREATE TRIGGER reject_fixture_origin BEFORE INSERT ON credit_grant_payment_origins
      FOR EACH ROW EXECUTE FUNCTION reject_fixture_origin()`);
    const s = session('rollback'), e = event('rollback', s);
    const before = (await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1', [alice])).rows[0].balance;
    try {
      await assert.rejects(run(e), /fixture origin write failed/, 'origin failure aborts the fulfillment');
      assert.equal((await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1', [alice])).rows[0].balance, before,
        'origin failure rolls back the credit balance');
      for (const [table, field, value] of [['billing_events','event_id',e.id], ['billing_charges','payment_intent',s.payment_intent],
        ['credit_grants','source_ref',`stripe:checkout:${s.id}`], ['credit_transactions','reference_id',`stripe:checkout:${s.id}`]]) {
        assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE ${field}=$1`, [value])).rows[0].n, 0,
          'origin failure leaves no claimed event, charge, lot or journal entry');
      }
    } finally {
      await pool.query('DROP TRIGGER reject_fixture_origin ON credit_grant_payment_origins; DROP FUNCTION reject_fixture_origin()');
    }
    await run(e);
    assert.equal((await rows()).filter(r => r.checkout_session === s.id).length, 1,
      'the same checkout can retry after a rolled-back origin write');
  });

  await t.test('origin evidence is immutable and cannot be attached to a different lot amount', async () => {
    const [origin] = await rows();
    await assert.rejects(pool.query('UPDATE credit_grant_payment_origins SET paid_minor=paid_minor+1 WHERE grant_id=$1', [origin.grant_id]),
      { code: '23514' }, 'payment origins cannot be rewritten');
    await assert.rejects(pool.query('DELETE FROM credit_grant_payment_origins WHERE grant_id=$1', [origin.grant_id]),
      { code: '23514' }, 'payment origins cannot be erased');
    await assert.rejects(pool.query('TRUNCATE credit_grant_payment_origins'), { code: '23514' }, 'payment origins cannot be truncated');
    await addGrant(pool, alice, { amountMicro: 1000, kind: 'paid', sourceRef: `stripe:checkout:cs_guard_${marker}` });
    const grant = (await pool.query('SELECT id FROM credit_grants WHERE source_ref=$1', [`stripe:checkout:cs_guard_${marker}`])).rows[0].id;
    await assert.rejects(pool.query(`INSERT INTO credit_grant_payment_origins
      (grant_id,provider_account,provider_mode,payment_intent,checkout_session,event_id,paid_minor,currency,amount_micro)
      VALUES($1,'acct_fixture','test',$2,$3,$4,1,'eur',2000)`, [grant, `pi_guard_${marker}`, `cs_guard_${marker}`, `evt_guard_${marker}`]),
    { code: '23514' }, 'payment origin cannot overstate its lot');
    const before = await rows();
    await migrateAccountV2(pool);
    assert.deepEqual(await rows(), before, 'startup replay preserves payment evidence without backfilling old paid labels');
  });
});
