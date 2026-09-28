// Restricted-account prerequisite for project funding; not a full FUND-17 citation.
// Ordinary wallet APIs must refuse a restricted account even when handed its UUID.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';
import * as ledger from '../src/server/utils/creditLedgerV2.js';
import { runAllMigrations } from '../src/server/services/migrationRunner.js';
import { migrateAccountV2 } from '../src/server/database/migrate-account-v2.js';
const url = process.env.TEST_DATABASE_URL;
if (url) requireProofDatabase(url);

test('ordinary wallet operations cannot move or release restricted pool value', { skip: !url }, async t => {
  const pool = new pg.Pool({ connectionString: url });
  t.after(() => pool.end());
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  const owner = randomUUID();
  const account = (await pool.query(`INSERT INTO credit_accounts(user_id,owner_kind,balance)
    VALUES($1,'project_pool',10000) RETURNING id`, [owner])).rows[0].id;
  await pool.query(`INSERT INTO credit_grants(user_id,account_id,amount_micro,remaining_micro,kind)
    VALUES($1,$2,10000,10000,'paid')`, [owner, account]);
  const hold = (await pool.query(`INSERT INTO credit_holds(user_id,account_id,hold_id,surface,operation,amount_micro,expires_at)
    VALUES($1,$2,'pool-held','fixture','test',1000,now()+interval '1 hour') RETURNING id`, [owner, account])).rows[0].id;
  await pool.query(`INSERT INTO credit_transactions(user_id,account_id,type,amount,balance_after,reference_type,reference_id)
    VALUES($1,$2,'debit',-1,10000,'xeno.usage','already-posted')`, [owner, account]);
  const snapshot = async () => {
    const out = {};
    for (const table of ['credit_accounts','credit_grants','credit_holds','credit_transactions','spend_caps','api_usage_logs']) {
      out[table] = (await pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') AS value FROM ${table} r`)).rows[0].value;
    }
    return out;
  };
  const before = await snapshot();
  const calls = [
    ['direct debit', () => ledger.recordUsageV2(pool, owner, { transactionId: randomUUID(), costMicro: 100, surface: 'test', operation: 'test' })],
    ['debit replay', () => ledger.recordUsageV2(pool, owner, { transactionId: 'already-posted', costMicro: 1 })],
    ['new reservation', () => ledger.holdV2(pool, owner, { holdId: 'new', amountMicro: 100, surface: 'test', operation: 'test' })],
    ['reservation replay', () => ledger.holdV2(pool, owner, { holdId: 'pool-held', amountMicro: 1000 })],
    ['settlement', () => ledger.settleHoldV2(pool, owner, 'pool-held', 500)],
    ['reservation release', () => ledger.voidHoldV2(pool, owner, 'pool-held')],
    ['reservation extension', () => ledger.extendHoldV2(pool, owner, 'pool-held', 3600)],
    ['grant', () => ledger.addGrant(pool, owner, { amountMicro: 100, sourceRef: randomUUID() })],
    ['clawback', () => ledger.clawback(pool, owner, 100)],
    ['refund', () => ledger.reverseUsage(pool, owner, 100, { refId: randomUUID() })],
    ['unfreeze', () => ledger.setFrozen(pool, owner, false)],
    ['spend-cap change', () => ledger.setSpendCap(pool, owner, { windowSec: 60, limitMicro: 10000 })],
  ];
  for (const [name, call] of calls) {
    await t.test(name, async () => {
      await assert.rejects(call, { code: 'RESTRICTED_ACCOUNT' }, `ordinary ${name} refuses a restricted account`);
      assert.deepEqual(await snapshot(), before, `ordinary ${name} leaves restricted financial state unchanged`);
    });
  }
  await t.test('a restricted account cannot be retyped or readdressed into a wallet', async () => {
    await assert.rejects(pool.query("UPDATE credit_accounts SET owner_kind='user' WHERE id=$1", [account]),
      { code: '23514' }, 'restricted identity cannot be retyped into an ordinary wallet');
    await assert.rejects(pool.query('UPDATE credit_accounts SET user_id=$2 WHERE id=$1', [account, randomUUID()]),
      { code: '23514' }, 'restricted identity cannot be readdressed');
    assert.deepEqual(await snapshot(), before, 'refused identity changes preserve every ledger row');
  });
  await t.test('generic expiry cannot release restricted commitments', async () => {
    await pool.query("UPDATE credit_holds SET expires_at=now()-interval '1 hour' WHERE id=$1", [hold]);
    const ordinary = randomUUID();
    await pool.query("INSERT INTO credit_accounts(user_id,owner_kind) VALUES($1,'user')", [ordinary]);
    await pool.query(`INSERT INTO credit_holds(user_id,hold_id,surface,operation,amount_micro,expires_at)
      VALUES($1,'ordinary-expired','test','test',100,now()-interval '1 hour')`, [ordinary]);
    await ledger.sweepExpiredHolds(pool);
    assert.equal((await pool.query('SELECT state FROM credit_holds WHERE id=$1', [hold])).rows[0].state, 'held',
      'generic expiry cannot release restricted commitments');
    assert.equal((await pool.query("SELECT state FROM credit_holds WHERE user_id=$1", [ordinary])).rows[0].state, 'voided',
      'ordinary expiry still runs');
  });
});
