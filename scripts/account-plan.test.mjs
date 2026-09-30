import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import * as plans from '../src/server/services/accountPlan.js';
import { ensureSchema } from '../src/server/services/billingSchema.js';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';

const url = process.env.TEST_DATABASE_URL;
test('account plan reads preserve billing exports and share one retryable schema bootstrap', { skip: !url, timeout: 30000 }, async t => {
  const pool = new pg.Pool({ connectionString: requireProofDatabase(url), max: 4 });
  let client;
  t.after(async () => { client?.release(); await pool.end(); });
  // A private schema makes this test independent of migrated tables. Only this session uses it.
  const schema = `plan_${randomUUID().replaceAll('-', '')}`;
  client = await pool.connect();
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  const account = randomUUID();
  const readonly = { previewReadOnly: true, query: (...args) => client.query(...args) };
  await assert.rejects(plans.getPlan(readonly, account), { code: '42P01' }, 'preview read must not bootstrap schema');
  assert.equal((await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=$1", [schema])).rows[0].n, 0);

  // A failed initializer must not poison every future read. A successful one is shared by
  // the reader and billing, including overlapping requests while the first CREATE is pending.
  let attempts = 0, release;
  const blocked = new Promise(resolve => { release = resolve; });
  const db = { async query(sql, params) {
    if (sql.includes('CREATE TABLE')) {
      attempts++;
      if (attempts === 1) throw new Error('fixture bootstrap failure');
      await blocked;
    }
    return client.query(sql, params);
  } };
  await assert.rejects(plans.getPlan(db, account), /fixture bootstrap failure/);
  const reading = plans.getPlan(db, account);
  const bootstrapping = ensureSchema(db);
  const pendingAttempts = attempts;
  release();
  const results = await Promise.allSettled([reading, bootstrapping]);
  assert.equal(pendingAttempts, 2, 'reader and billing share the pending schema initialization');
  assert(results.every(result => result.status === 'fulfilled'), 'schema retry succeeds for both callers');
  assert.deepEqual(results[0].value, { plan: 'free', status: 'none', currentPeriodEnd: null });
  const tables = (await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name', [schema])).rows.map(row => row.table_name);
  assert.deepEqual(tables, ['billing_charges', 'billing_customers', 'billing_events', 'xeno_account_plans']);

  process.env.JWT_SECRET = process.env.JWT_SECRET || 'account-plan-local-fixture';
  const billing = await import('../src/server/services/billingService.js');
  for (const name of ['PLAN_ALIASES', 'canonicalPlan', 'entitlementsFor', 'getPlan', 'getEntitlements']) {
    assert.equal(billing[name], plans[name], `billing export ${name} is the same binding`);
  }
  const billingSource = await readFile(new URL('../src/server/services/billingService.js', import.meta.url), 'utf8');
  assert.match(billingSource, /import \{ ensureSchema \} from '\.\/billingSchema\.js'/);
  assert.doesNotMatch(billingSource, /let schemaPromise|function ensureSchema\(/, 'billing must not own a second schema promise');

  const end = new Date('2030-01-02T00:00:00Z');
  await client.query('INSERT INTO xeno_account_plans(user_id,plan,status,current_period_end) VALUES($1,$2,$3,$4)', [account, 'ultra', 'active', end]);
  for (const status of ['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid', 'paused', null]) {
    await client.query('UPDATE xeno_account_plans SET status=$2 WHERE user_id=$1', [account, status]);
    const active = ['active', 'trialing', 'past_due'].includes(status);
    const result = await billing.getEntitlements(db, account);
    assert.equal(result.plan, active ? 'ultra' : 'free', `stored plan/status preserved for ${status}`);
    assert.equal(result.status, status || 'none');
    assert.deepEqual(result.currentPeriodEnd, end);
    assert.equal(result.entitlements, plans.entitlementsFor(active ? 'pro' : 'free'));
  }
  await client.query("UPDATE xeno_account_plans SET plan='unknown_plan',status='active' WHERE user_id=$1", [account]);
  assert.equal((await plans.getEntitlements(db, account)).entitlements, plans.entitlementsFor('free'), 'unknown plan grants only free entitlements');
  assert.equal(attempts, 2, 'successful bootstrap remains cached across both public read paths');
  const preview = await plans.getPlan(readonly, account);
  assert.equal(preview.plan, 'unknown_plan');
});
