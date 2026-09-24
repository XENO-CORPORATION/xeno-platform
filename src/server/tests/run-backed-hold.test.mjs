/**
 * XENO-WORKFORCE-01 FUND-09, the contract every hold-placing service relies on:
 *   "Do not release a reservation merely because a lease/HTTP request expired. Running or uncertain
 *    provider work remains committed until its settlement/cancellation is proved or a separately funded
 *    liability reserve covers it. Existing generic expiring holds require a qualified run-backed extension."
 *
 * Every service that places a hold now renews it while its work is unresolved. Each suite below proves
 * its own holder against real PostgreSQL:
 *   - the extension verb, POST /holds/:holdId/extend                   xeno-platform #389, hold-extension
 *   - platform in-process meters (chat, stream, media)                 xeno-platform #390, meter-hold-heartbeat
 *   - xeno-agents-api: a running run renews on a timer, and a refusal
 *     stops the run                                                    agents-api #7, holdHeartbeat.test.ts
 *   - xeno-api-proxy execution plane: running work, and an ambiguous job
 *     past its deadline, stay committed as an unresolved liability until
 *     an operator proves the outcome                                   api-proxy #13, hold-liability.test.js
 *   - xeno-api-proxy synchronous chat/media sessions                    api-proxy #14, chat-billing.test.mjs
 * A new holder that does not renew breaks FUND-09 again -- add it here.
 *
 * This case is the holder's contract in one pass, through the REAL service-ledger router over HTTP:
 * a run keeps renewing while it works, the sweeper cannot release it, its credits cannot be spent
 * twice, it settles at real usage, and once gone it can never be revived. A control that does NOT
 * renew IS swept, so the case cannot pass on a hold that simply had not expired.
 *
 * Mutation-checked (each fails this case; restored passes):
 *   - extendHoldV2 does not move expires_at
 *   - the sweeper ignores expires_at for held rows it should release (control stops being swept)
 *   - an expired hold may be revived
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:5432/<disposable> node tests/run-backed-hold.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import { tablesDDL } from './fixtures/schema.mjs';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { getBalanceV2, sweepExpiredHolds, recordUsageV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import serviceLedgerRoutes from '../routes/serviceLedgerRoutes.js';
import { installUsageCreditFixture, optInUsageCredits } from './usage-credit-fixture.mjs';

const TOKEN = 'test-service-token-run-backed-hold';
const C = (n) => n * MICRO_PER_CREDIT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text DEFAULT 'test', email text DEFAULT 'test@test.com', display_name text DEFAULT 'Tester', role text DEFAULT 'user', is_active boolean DEFAULT true, status text DEFAULT 'active', credits bigint DEFAULT 0, email_verified boolean DEFAULT false);
CREATE TABLE IF NOT EXISTS agent_identities (user_id uuid PRIMARY KEY, owner_user_id uuid, agent_role varchar(16) DEFAULT 'other', agent_origin text, status varchar(16) DEFAULT 'active');
CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY, status varchar(16) DEFAULT 'active', metadata jsonb DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS xeno_account_plans (user_id text PRIMARY KEY, plan varchar(50) DEFAULT 'free', status varchar(20) DEFAULT 'active', current_period_end timestamptz);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
`;

test('a run-backed hold stays committed while its work runs, and a lapsed one cannot be revived (FUND-09)', async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required');
  process.env.LEDGER_SERVICE_TOKEN = TOKEN;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(BASE);
  await pool.query(tablesDDL('api_usage_logs'));
  await migrateAccountV2(pool);
  await installUsageCreditFixture(pool);
  const app = express();
  app.use(express.json());
  app.use('/api/v2/ledger/service', (r, _res, next) => { r.db = pool; next(); }, serviceLedgerRoutes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.close(); await pool.end(); });
  const base = `http://127.0.0.1:${server.address().port}/api/v2/ledger/service`;
  const post = async (path, body) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const newUser = async () => {
    const id = (await pool.query('INSERT INTO users (credits) VALUES (100) RETURNING id')).rows[0].id;
    await optInUsageCredits(pool, id);
    await pool.query("INSERT INTO xeno_account_plans (user_id, plan, status) VALUES ($1, 'internal', 'active')", [id]);
    return id;
  };
  const holdState = async (uid) => (await pool.query("SELECT state FROM credit_holds WHERE user_id=$1 AND hold_id='run'", [uid])).rows[0].state;

  // Two identical 100-credit runs with a 1 s hold. The holder renews one of them on a timer -- the
  // same shape every holder above uses -- and leaves the other alone.
  const live = await newUser();
  const control = await newUser();
  for (const uid of [live, control]) {
    const h = await post('/holds', { userId: uid, holdId: 'run', amountMicro: C(100), operation: 'agent_run', surface: 'agents', expiresInSeconds: 1 });
    assert.equal(h.status, 200);
  }
  const beats = [];
  const beat = setInterval(async () => { beats.push((await post('/holds/run/extend', { userId: live, extendBySeconds: 2 })).status); }, 300);
  try {
    // The run works for 3 s -- three times its hold's TTL -- and the sweeper runs throughout.
    for (let i = 0; i < 6; i += 1) { await sleep(500); await sweepExpiredHolds(pool); }
  } finally {
    clearInterval(beat);
  }
  assert.equal(await holdState(control), 'voided', 'control: an un-renewed hold IS released by the sweeper');
  assert.equal(await holdState(live), 'held', 'a renewed hold is never released while its work runs');
  assert.ok(beats.length >= 5 && beats.every((s) => s === 200), `every beat renewed (${beats.join(',')})`);

  // Its credits cannot be spent twice while it is committed ...
  const competing = await recordUsageV2(pool, live, { transactionId: 'elsewhere', surface: 's', operation: 'o', costMicro: C(100) })
    .then(() => 'accepted', (e) => e.code);
  assert.equal(competing, 'INSUFFICIENT_CREDITS', 'the committed reservation still guards the balance');
  // ... and the run settles at what it really used.
  const settled = await post('/holds/run/settle', { userId: live, actualCostMicro: C(70) });
  assert.equal(settled.json?.state, 'settled');
  assert.equal(settled.json?.settledMicro, C(70));
  assert.equal((await getBalanceV2(pool, live)).availableMicro, C(30));

  // A hold that has lapsed can never be revived: its credits may already be spent elsewhere.
  const revived = await post('/holds/run/extend', { userId: control, extendBySeconds: 600 });
  assert.equal(revived.status, 409);
  assert.equal(await holdState(control), 'voided');
});
