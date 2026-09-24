/**
 * XENO-WORKFORCE-01 FUND-09: "Do not release a reservation merely because a lease/HTTP request expired.
 * Running or uncertain provider work remains committed until its settlement/cancellation is proved or
 * a separately funded liability reserve covers it. Existing generic expiring holds require a qualified
 * run-backed extension."
 *
 * The defect this closes, measured 2026-09-23 against PostgreSQL: a run whose work outlives its hold's
 * TTL had its reservation voided by sweepExpiredHolds on time alone; the credits were then spent
 * elsewhere, and the run's settle no-oped on the voided hold and reported success. The run was free and
 * its credits were spent twice. extendHoldV2 / POST /holds/:holdId/extend is the run-backed extension.
 *
 * Driven through the REAL service ledger router over HTTP, against real PostgreSQL.
 *
 * Mutation-checked (each fails the named case; restored passes):
 *   - extension does not move expires_at            -> "an extended hold survives the sweeper and the run settles for real"
 *   - an expired hold may be extended               -> "an already-expired hold cannot be revived"
 *   - a settled hold may be extended                -> "a settled or voided hold cannot be extended"
 *   - no upper bound on the extension               -> "an extension is bounded"
 *   - the extension moves expires_at backwards      -> "an extension never shortens a hold"
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:5432/<disposable> node tests/hold-extension.test.mjs
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import { tablesDDL } from './fixtures/schema.mjs';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { getBalanceV2, sweepExpiredHolds, recordUsageV2, MICRO_PER_CREDIT, MAX_HOLD_EXTENSION_SECONDS } from '../utils/creditLedgerV2.js';
import serviceLedgerRoutes from '../routes/serviceLedgerRoutes.js';
import { installUsageCreditFixture, optInUsageCredits } from './usage-credit-fixture.mjs';

const TOKEN = 'test-service-token-hold-extension';
process.env.LEDGER_SERVICE_TOKEN = TOKEN;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass += 1; console.log(`  ✓ ${m}`); } else { fail += 1; console.log(`  ✗ ${m}`); } };
const C = (n) => n * MICRO_PER_CREDIT;

const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text DEFAULT 'test', email text DEFAULT 'test@test.com', display_name text DEFAULT 'Tester', role text DEFAULT 'user', is_active boolean DEFAULT true, status text DEFAULT 'active', credits bigint DEFAULT 0, email_verified boolean DEFAULT false);
CREATE TABLE IF NOT EXISTS agent_identities (user_id uuid PRIMARY KEY, owner_user_id uuid, agent_role varchar(16) DEFAULT 'other', agent_origin text, status varchar(16) DEFAULT 'active');
CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY, status varchar(16) DEFAULT 'active', metadata jsonb DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS xeno_account_plans (user_id text PRIMARY KEY, plan varchar(50) DEFAULT 'free', status varchar(20) DEFAULT 'active', current_period_end timestamptz);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
`;

let baseUrl;
async function req(path, body) {
  const res = await fetch(`${baseUrl}/api/v2/ledger/service${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const newUser = async (credits) => {
  const id = (await pool.query('INSERT INTO users (credits) VALUES ($1) RETURNING id', [credits])).rows[0].id;
  await optInUsageCredits(pool, id);
  await pool.query("INSERT INTO xeno_account_plans (user_id, plan, status) VALUES ($1, 'internal', 'active')", [id]);
  return id;
};
const expiry = async (uid, holdId) => (await pool.query('SELECT expires_at FROM credit_holds WHERE user_id=$1 AND hold_id=$2', [uid, holdId])).rows[0].expires_at;
const state = async (uid, holdId) => (await pool.query('SELECT state, settled_micro FROM credit_holds WHERE user_id=$1 AND hold_id=$2', [uid, holdId])).rows[0];
const backdate = (uid, holdId, sql) => pool.query(`UPDATE credit_holds SET expires_at = ${sql} WHERE user_id=$1 AND hold_id=$2`, [uid, holdId]);

async function main() {
  await pool.query(BASE);
  await pool.query(tablesDDL('api_usage_logs'));
  await migrateAccountV2(pool);
  await installUsageCreditFixture(pool);
  const app = express();
  app.use(express.json());
  app.use('/api/v2/ledger/service', (r, _res, next) => { r.db = pool; next(); }, serviceLedgerRoutes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // ── The FUND-09 scenario: a 100-credit run whose work outlives its hold's TTL. ───────────
    // Both holds get a ONE-second TTL and the test waits past it, so the sweeper genuinely sees them
    // expire. The first version used a 60 s TTL and swept at once, which would have passed with no
    // extension at all -- the control below exists so that mistake cannot come back unnoticed.
    const u = await newUser(100);
    const hold = await req('/holds', { userId: u, holdId: 'run-long', amountMicro: C(100), operation: 'agent_run', surface: 'agents', expiresInSeconds: 1 });
    ok(hold.status === 200 && hold.json?.state === 'held', `fixture: a 100-credit hold with a 1 s TTL (got ${hold.status})`);
    const control = await newUser(100);
    await req('/holds', { userId: control, holdId: 'run-long', amountMicro: C(100), operation: 'agent_run', surface: 'agents', expiresInSeconds: 1 });

    // The holder keeps its hold alive while the run works; the control's holder does not.
    const ext = await req('/holds/run-long/extend', { userId: u, extendBySeconds: 600 });
    ok(ext.status === 200 && ext.json?.state === 'held' && new Date(ext.json.expiresAt) > new Date(Date.now() + 500_000),
      `extend moves the expiry forward (got ${ext.status}, expiresAt ${ext.json?.expiresAt})`);
    await new Promise((resolve) => setTimeout(resolve, 1600));   // past both original TTLs
    const swept = await sweepExpiredHolds(pool);
    ok((await state(control, 'run-long')).state === 'voided',
      'control: the same hold WITHOUT an extension is swept -- so the case below is not passing vacuously');
    const afterSweep = await state(u, 'run-long');
    const competing = await recordUsageV2(pool, u, { transactionId: 'elsewhere', surface: 's', operation: 'o', costMicro: C(100) })
      .then(() => 'accepted', (e) => e.code);
    const settled = await req('/holds/run-long/settle', { userId: u, actualCostMicro: C(80) });
    const bal = await getBalanceV2(pool, u);
    ok(afterSweep.state === 'held' && competing === 'INSUFFICIENT_CREDITS'
      && settled.status === 200 && settled.json?.state === 'settled' && settled.json?.settledMicro === C(80)
      && bal.availableMicro === C(20),
    `an extended hold survives the sweeper and the run settles for real (swept ${swept}, state ${afterSweep.state}, `
      + `competing spend ${competing}, settle ${settled.json?.state}/${(settled.json?.settledMicro ?? 0) / MICRO_PER_CREDIT}, `
      + `left ${bal.availableMicro / MICRO_PER_CREDIT})`);

    // ── Refusals. ───────────────────────────────────────────────────────────────────────────
    const u2 = await newUser(100);
    await req('/holds', { userId: u2, holdId: 'lapsed', amountMicro: C(10), operation: 'agent_run', surface: 'agents' });
    await backdate(u2, 'lapsed', "now() - interval '1 second'");
    const revive = await req('/holds/lapsed/extend', { userId: u2, extendBySeconds: 600 });
    ok(revive.status === 409 && revive.json?.error?.code === 'HOLD_EXPIRED' && new Date(await expiry(u2, 'lapsed')) < new Date(),
      `an already-expired hold cannot be revived (got ${revive.status} ${revive.json?.error?.code})`);

    await req('/holds', { userId: u2, holdId: 'done', amountMicro: C(10), operation: 'agent_run', surface: 'agents' });
    await req('/holds/done/settle', { userId: u2, actualCostMicro: C(5) });
    await req('/holds', { userId: u2, holdId: 'dropped', amountMicro: C(10), operation: 'agent_run', surface: 'agents' });
    await req('/holds/dropped/void', { userId: u2 });
    const onSettled = await req('/holds/done/extend', { userId: u2, extendBySeconds: 600 });
    const onVoided = await req('/holds/dropped/extend', { userId: u2, extendBySeconds: 600 });
    ok(onSettled.status === 409 && onSettled.json?.error?.code === 'HOLD_NOT_ACTIVE'
      && onVoided.status === 409 && onVoided.json?.error?.code === 'HOLD_NOT_ACTIVE',
    `a settled or voided hold cannot be extended (settled ${onSettled.status}, voided ${onVoided.status})`);

    await req('/holds', { userId: u2, holdId: 'bounded', amountMicro: C(10), operation: 'agent_run', surface: 'agents' });
    const tooLong = await req('/holds/bounded/extend', { userId: u2, extendBySeconds: MAX_HOLD_EXTENSION_SECONDS + 1 });
    const zero = await req('/holds/bounded/extend', { userId: u2, extendBySeconds: 0 });
    ok(tooLong.status === 400 && zero.status === 400, `an extension is bounded (over max ${tooLong.status}, zero ${zero.status})`);

    await backdate(u2, 'bounded', "now() + interval '3000 seconds'");
    const before = await expiry(u2, 'bounded');
    const shorter = await req('/holds/bounded/extend', { userId: u2, extendBySeconds: 60 });
    ok(shorter.status === 200 && (await expiry(u2, 'bounded')).getTime() === before.getTime(),
      'an extension never shortens a hold');

    const missing = await req('/holds/nope/extend', { userId: u2, extendBySeconds: 60 });
    ok(missing.status === 404, `an unknown hold is 404 (got ${missing.status})`);
  } finally {
    server.close();
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} hold-extension: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
