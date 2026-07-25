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
import express from 'express';
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { getBalanceV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import serviceLedgerRoutes from '../routes/serviceLedgerRoutes.js';

const TOKEN = 'test-service-token-abc123';
process.env.LEDGER_SERVICE_TOKEN = TOKEN;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const C = (n) => n * MICRO_PER_CREDIT;

// Base ledger tables migrateAccountV2 augments (created here for a fresh throwaway DB).
const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS api_usage_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, surface varchar(64), operation varchar(128), model varchar(128), provider varchar(64), actual_cost_micro bigint, estimated_cost_micro bigint, input_tokens int DEFAULT 0, output_tokens int DEFAULT 0, status varchar(16), request_id varchar(128), endpoint text, method varchar(8), created_at timestamptz DEFAULT now());
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
  await migrateAccountV2(pool);

  // Minimal app: fake req.db middleware (the pool) → router. NO authMiddleware.
  const app = express();
  app.use(express.json());
  app.use('/api/v2/ledger/service', (r, _res, next) => { r.db = pool; next(); }, serviceLedgerRoutes);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Seed a user with 100 credits.
  const userId = (await pool.query('INSERT INTO users (credits) VALUES (100) RETURNING id')).rows[0].id;

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

  console.log(`\n${fail === 0 ? '✅' : '❌'} service-ledger: ${pass} passed, ${fail} failed`);
  server.close();
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); if (server) server.close(); process.exit(1); });
