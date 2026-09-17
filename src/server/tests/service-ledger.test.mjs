/**
 * Integration test for the SERVICE-authenticated ledger surface
 * (routes/serviceLedgerRoutes.js) against a real Postgres.
 *
 * Run: LEDGER_SERVICE_TOKEN=... DATABASE_URL=postgresql://t:t@127.0.0.1:5432/t \
 *        node tests/service-ledger.test.mjs
 *
 * Mounts the router in a minimal express app (fake req.db middleware + the
 * service-token env, NO authMiddleware, no req.user), then drives it over HTTP.
 * Covers: token gate (401 fail-closed), hold reserves, insufficient→402,
 * settle debits actual + releases remainder, void releases, replay idempotency.
 */
import http from 'node:http';
import { tablesDDL } from './fixtures/schema.mjs';
import express from 'express';
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { getBalanceV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import serviceLedgerRoutes from '../routes/serviceLedgerRoutes.js';
import { installUsageCreditFixture, optInUsageCredits } from './usage-credit-fixture.mjs';

const TOKEN = 'test-service-token-abc123';
process.env.LEDGER_SERVICE_TOKEN = TOKEN;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const C = (n) => n * MICRO_PER_CREDIT;

// Base ledger tables migrateAccountV2 augments (created here for a fresh throwaway DB).
const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text DEFAULT 'test', email text DEFAULT 'test@test.com', display_name text DEFAULT 'Tester', role text DEFAULT 'user', is_active boolean DEFAULT true, status text DEFAULT 'active', credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS agent_identities (user_id uuid PRIMARY KEY, owner_user_id uuid, agent_role varchar(16) DEFAULT 'other', agent_origin text, status varchar(16) DEFAULT 'active');
CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY, status varchar(16) DEFAULT 'active', metadata jsonb DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS xeno_account_plans (user_id text PRIMARY KEY, plan varchar(50) DEFAULT 'free', status varchar(20) DEFAULT 'active', current_period_end timestamptz);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
`;

let server, baseUrl;

async function req(method, path, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const available = async (uid) => (await getBalanceV2(pool, uid)).availableMicro;

async function main() {
  await pool.query(BASE);
  // api_usage_logs from the MIGRATIONS (fixtures/schema.mjs): its shape is production's, incl. `dimensions`.
  await pool.query(tablesDDL('api_usage_logs'));
  await migrateAccountV2(pool);
  await installUsageCreditFixture(pool);

  // Minimal app: fake req.db middleware (the pool) → router. NO authMiddleware.
  const app = express();
  app.use(express.json());
  app.use('/api/v2/ledger/service', (r, _res, next) => { r.db = pool; next(); }, serviceLedgerRoutes);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Seed a user with 100 credits and internal plan (no auto-allowance issued).
  const userId = (await pool.query('INSERT INTO users (credits) VALUES (100) RETURNING id')).rows[0].id;
  await optInUsageCredits(pool, userId);
  await pool.query("INSERT INTO xeno_account_plans (user_id, plan, status) VALUES ($1, 'internal', 'active')", [userId]);

  // ── 1. Auth gate: no token / wrong token → 401 (never open) ─────────────────
  const noTok = await req('POST', '/api/v2/ledger/service/holds', { body: { userId, holdId: 'h-x', amountMicro: C(1), operation: 'op', surface: 'agents' } });
  ok(noTok.status === 401 && noTok.json?.error?.code === 'UNAUTHORIZED', 'no token → 401 UNAUTHORIZED');
  const badTok = await req('POST', '/api/v2/ledger/service/holds', { token: 'wrong-token-000000', body: { userId, holdId: 'h-x', amountMicro: C(1), operation: 'op', surface: 'agents' } });
  ok(badTok.status === 401 && badTok.json?.error?.code === 'UNAUTHORIZED', 'wrong token → 401 UNAUTHORIZED');
  ok((await available(userId)) === C(100), 'rejected auth attempts did not touch balance (still 100)');

  // ── 2. Valid token + userId → hold succeeds, balance reserved ───────────────
  const h1 = await req('POST', '/api/v2/ledger/service/holds', { token: TOKEN, body: { userId, holdId: 'hold-svc-1', amountMicro: C(10), operation: 'agent.run', surface: 'agents' } });
  ok(h1.status === 200 && h1.json?.state === 'held', 'valid service call → hold created (held)');
  ok((await available(userId)) === C(90), 'hold reserved 10 → available 90');

  // ── 3. Bad request: missing fields → 400 ────────────────────────────────────
  const bad = await req('POST', '/api/v2/ledger/service/holds', { token: TOKEN, body: { userId, holdId: 'h-missing' } });
  ok(bad.status === 400 && bad.json?.error?.code === 'BAD_REQUEST', 'missing fields → 400 BAD_REQUEST');

  // ── 4. Replay same holdId is idempotent (no double-hold) ────────────────────
  const h1replay = await req('POST', '/api/v2/ledger/service/holds', { token: TOKEN, body: { userId, holdId: 'hold-svc-1', amountMicro: C(10), operation: 'agent.run', surface: 'agents' } });
  ok(h1replay.status === 200 && h1replay.json?.state === 'held', 'replayed holdId → 200 (idempotent)');
  ok((await available(userId)) === C(90), 'replay did NOT double-reserve (still available 90)');

  // ── 5. Insufficient credits → 402 ───────────────────────────────────────────
  const over = await req('POST', '/api/v2/ledger/service/holds', { token: TOKEN, body: { userId, holdId: 'hold-svc-big', amountMicro: C(500), operation: 'agent.run', surface: 'agents' } });
  ok(over.status === 402 && over.json?.error?.code === 'INSUFFICIENT_CREDITS', 'over-reserve → 402 INSUFFICIENT_CREDITS');
  ok((await available(userId)) === C(90), 'balance unchanged after rejected over-reserve (90)');

  // ── 6. Settle debits actual + releases remainder ────────────────────────────
  const settle = await req('POST', '/api/v2/ledger/service/holds/hold-svc-1/settle', { token: TOKEN, body: { userId, actualCostMicro: C(4) } });
  ok(settle.status === 200 && settle.json?.state === 'settled' && settle.json?.settledMicro === C(4), 'settle → settled for 4 (partial)');
  ok((await available(userId)) === C(96), 'settle debited 4, released the other 6 → available 96');

  // ── 7. Void releases the reservation without charging ───────────────────────
  const h2 = await req('POST', '/api/v2/ledger/service/holds', { token: TOKEN, body: { userId, holdId: 'hold-svc-2', amountMicro: C(20), operation: 'agent.run', surface: 'agents' } });
  ok(h2.status === 200 && (await available(userId)) === C(76), 'second hold reserves 20 → available 76');
  const voided = await req('POST', '/api/v2/ledger/service/holds/hold-svc-2/void', { token: TOKEN, body: { userId } });
  ok(voided.status === 200 && voided.json?.state === 'voided', 'void → voided');
  ok((await available(userId)) === C(96), 'void released 20 → available 96 (no charge)');

  // ── The usage row for a HELD call carries what the settle measured and WHY it
  //    was routed here (gateway f6087f3 sends routeReason/routeMismatchBasis).
  //    Before 2026-09-17 every settled row had model NULL and 0 tokens.
  const h3 = await req('POST', '/api/v2/ledger/service/holds', { token: TOKEN, body: { userId, holdId: 'hold-svc-dims', operation: 'chat.completion', surface: 'xeno-web', amountMicro: C(10) } });
  ok(h3.status === 200, 'hold for the dimensions case');
  const s3 = await req('POST', '/api/v2/ledger/service/holds/hold-svc-dims/settle', {
    token: TOKEN,
    body: { userId, usage: { model: 'gpt-4o-mini', inputTokens: 120, outputTokens: 30, measured: true },
      routeReason: 'provider-mismatch', routeMismatchBasis: 'catalogue-mismatch', unknownField: 'ignored' },
  });
  ok(s3.status === 200 && s3.json?.state === 'settled', `settle with usage + route dimensions → ${s3.status}`);
  const row3 = (await pool.query(`SELECT model, input_tokens, output_tokens, dimensions FROM api_usage_logs WHERE user_id=$1 AND request_id='hold-svc-dims'`, [userId])).rows[0];
  ok(row3 && row3.model === 'gpt-4o-mini' && Number(row3.input_tokens) === 120 && Number(row3.output_tokens) === 30,
    'settled usage row carries the measured model + tokens (was NULL / 0 for every held call)');
  ok(row3 && row3.dimensions?.route_reason === 'provider-mismatch' && row3.dimensions?.route_mismatch_basis === 'catalogue-mismatch' && row3.dimensions?.usage_source === 'provider',
    'settled usage row carries route_reason + route_mismatch_basis + usage_source');
  const h4 = await req('POST', '/api/v2/ledger/service/holds', { token: TOKEN, body: { userId, holdId: 'hold-svc-dims-bad', operation: 'chat.completion', surface: 'xeno-web', amountMicro: C(10) } });
  const s4 = await req('POST', '/api/v2/ledger/service/holds/hold-svc-dims-bad/settle', {
    token: TOKEN, body: { userId, actualCostMicro: C(1), routeReason: 'not-a-real-reason', routeMismatchBasis: 42 },
  });
  ok(h4.status === 200 && s4.status === 200 && s4.json?.state === 'settled', 'an unknown route label never rejects a settle (the charge lands)');
  const row4 = (await pool.query(`SELECT dimensions FROM api_usage_logs WHERE user_id=$1 AND request_id='hold-svc-dims-bad'`, [userId])).rows[0];
  ok(row4 && row4.dimensions === null, 'an unknown route label is DROPPED, not stored');
  const u5 = await req('POST', '/api/v2/ledger/service/usage', {
    token: TOKEN,
    body: { userId, transactionId: 'usage-dims-1', surface: 'xeno-web', operation: 'chat.completion',
      usage: { model: 'gpt-4o-mini', inputTokens: 10, outputTokens: 5, measured: true }, routeReason: 'account-default' },
  });
  const row5 = (await pool.query(`SELECT dimensions FROM api_usage_logs WHERE user_id=$1 AND request_id='usage-dims-1'`, [userId])).rows[0];
  ok(u5.status === 200 && row5?.dimensions?.route_reason === 'account-default' && row5?.dimensions?.usage_source === 'provider',
    'one-shot /usage carries route_reason beside usage_source');

  console.log(`\n${fail === 0 ? '✅' : '❌'} service-ledger: ${pass} passed, ${fail} failed`);
  // Await the close, and drop keep-alive sockets first. An unawaited
  // server.close() followed by pool.end() and process.exit() aborts inside
  // libuv on Windows -- "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"
  // -- AFTER every assertion has passed, so a green suite is recorded as a
  // failed one. Intermittent, which is worse: a launch gate that is red at
  // random gets ignored.
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  // Set the code and let the loop drain. process.exit() races libuv's handle
  // teardown and aborts AFTER every assertion has passed.
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error('FATAL', e); if (server) server.close(); process.exit(1); });
