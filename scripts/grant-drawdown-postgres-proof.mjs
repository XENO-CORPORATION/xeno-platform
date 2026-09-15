#!/usr/bin/env node
// Real PostgreSQL proof against temporary copies of the ledger tables only.
// No public account is created or modified. The outer transaction always rolls back.
// Run inside the backend container with its existing DB_* environment:
// node /app/grant-drawdown-proof.mjs --execute --ledger=/app/utils/creditLedgerV2.js
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

if (!process.argv.includes('--execute')) {
  console.log('Dry run: create temporary ledger tables, exercise debit paths, roll back. Pass --execute.');
  process.exit(0);
}
const path = process.argv.find(arg => arg.startsWith('--ledger='))?.slice(9);
assert.ok(path, '--ledger=<absolute module path> required');
const { recordUsageV2, settleHoldV2 } = await import(pathToFileURL(path));
const client = new pg.Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL search_path = pg_temp, pg_catalog");
  await client.query("SET LOCAL statement_timeout = '10s'");
  await client.query('CREATE TEMP TABLE users (id uuid PRIMARY KEY, credits integer) ON COMMIT DROP');
  for (const table of ['credit_accounts', 'credit_grants', 'credit_holds', 'credit_transactions', 'api_usage_logs', 'spend_caps']) {
    await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS) ON COMMIT DROP`);
  }
  await client.query('CREATE TEMP TABLE usage_credit_preferences (user_id uuid PRIMARY KEY,enabled boolean) ON COMMIT DROP');
  await client.query('CREATE TEMP TABLE credit_hold_funding (hold_row_id uuid,grant_id uuid,reserved_micro bigint,draw_order integer) ON COMMIT DROP');
  // Ledger transaction controls cannot commit our outer proof transaction.
  const tx = { release() {}, async query(sql, params) {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
    return client.query(sql, params);
  } };
  const pool = { connect: async () => tx };
  for (const debitPath of ['settle', 'usage']) {
    for (const scenario of [
      { name: 'allowance-first', kinds: ['allowance','promo','paid'], priorities: [5,50,100], cost: 60, expected: [40,100,100] },
      { name: 'overflow', kinds: ['allowance','paid'], priorities: [5,100], cost: 150, expected: [0,50] },
      { name: 'priority-before-kind', kinds: ['paid','free'], priorities: [1,10], cost: 60, expected: [40,100] },
      { name: 'expiry-before-kind', kinds: ['paid','free'], priorities: [10,10], cost: 60, expected: [40,100] },
      { name: 'expired-excluded', kinds: ['allowance','paid'], priorities: [5,100], cost: 60, expected: [100,40], expired: true },
    ]) {
      await client.query('TRUNCATE users, credit_accounts, credit_grants, credit_holds, credit_transactions, api_usage_logs, spend_caps');
      const uid = '00000000-0000-4000-8000-000000000001';
      await client.query('INSERT INTO users VALUES ($1,0)', [uid]);
      await client.query('INSERT INTO usage_credit_preferences VALUES ($1,true) ON CONFLICT (user_id) DO UPDATE SET enabled=true',[uid]);
      const { rows: [acct] } = await client.query('INSERT INTO credit_accounts (user_id,balance) VALUES ($1,$2) RETURNING id', [uid, scenario.kinds.length * 100]);
      const ids = [];
      for (let i = 0; i < scenario.kinds.length; i++) {
        const { rows: [lot] } = await client.query(`INSERT INTO credit_grants (user_id,account_id,amount_micro,remaining_micro,kind,priority,expires_at)
          VALUES ($1,$2,100,100,$3,$4,now()+($5::integer * interval '1 day')) RETURNING id`,
          [uid,acct.id,scenario.kinds[i],scenario.priorities[i], scenario.expired && i === 0 ? -1 : i + 1]);
        ids.push(lot.id);
      }
      if (debitPath === 'settle') {
        await client.query(`INSERT INTO credit_holds (user_id,account_id,hold_id,surface,operation,amount_micro,expires_at)
          VALUES ($1,$2,'proof-hold','proof','drawdown',$3,now()+interval '1 hour')`, [uid,acct.id,scenario.cost]);
        await settleHoldV2(pool, uid, 'proof-hold', scenario.cost);
        await settleHoldV2(pool, uid, 'proof-hold', scenario.cost);
      } else {
        const event = { transactionId: 'proof-usage', surface: 'proof', operation: 'drawdown', costMicro: scenario.cost };
        await recordUsageV2(pool, uid, event);
        await recordUsageV2(pool, uid, event);
      }
      const remaining = [];
      for (const id of ids) remaining.push(Number((await client.query('SELECT remaining_micro FROM credit_grants WHERE id=$1',[id])).rows[0].remaining_micro));
      assert.deepEqual(remaining,scenario.expected,`${debitPath}: ${scenario.name}`);
      assert.equal(Number((await client.query('SELECT count(*) AS n FROM credit_transactions')).rows[0].n),1,'replay must not debit twice');
      console.log(`PASS ${debitPath}: ${scenario.name}, idempotent replay`);
    }
  }
} finally {
  await client.query('ROLLBACK');
  await client.end();
  console.log('Proof transaction rolled back; public tables untouched.');
}
