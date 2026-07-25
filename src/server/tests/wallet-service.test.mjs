/**
 * Integration test for walletService (workspace billing, Phase 4) against a real Postgres.
 * Verifies the money-movement surface: micro→whole conversion, idempotent workspace-wallet
 * creation, the personal→workspace transfer SAGA (debit the user, grant the workspace;
 * refund/insufficient/invalid guards), budget spend-caps, and billing-account resolution
 * (pooled vs personal, member vs non-member).
 *
 * Run: DATABASE_URL=postgresql://postgres:pw@host:5432/db node tests/wallet-service.test.mjs
 */
import pg from 'pg';
import crypto from 'crypto';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import {
  ensureWorkspaceWallet, walletBalance, transferToWorkspace,
  setWorkspaceBudget, resolveBillingAccountId, wholeFromMicro,
} from '../services/walletService.js';
import { addGrant, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import { writeTuples } from '../utils/authzReBAC.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

// Tables migrateAccountV2 augments (present on live) + the minimal `workspaces` shape
// resolveBillingAccountId reads. owner_kind lives on credit_accounts (added by the
// workspace-billing migration on live) — stubbed here so the wallet upsert works.
const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, owner_kind varchar(16) DEFAULT 'user', balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS api_usage_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, surface varchar(64), operation varchar(128), model varchar(128), provider varchar(64), actual_cost_micro bigint, estimated_cost_micro bigint, input_tokens int DEFAULT 0, output_tokens int DEFAULT 0, status varchar(16), request_id varchar(128), endpoint text, method varchar(8), created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY, status varchar(16) DEFAULT 'active', metadata jsonb DEFAULT '{}'::jsonb);
`;

async function main() {
  await pool.query(BASE);
  await migrateAccountV2(pool);
  console.log('✓ migration applied');

  // ---- wholeFromMicro (pure) ----
  ok(wholeFromMicro(MICRO_PER_CREDIT * 3) === 3, 'wholeFromMicro exact 3 credits');
  ok(wholeFromMicro(MICRO_PER_CREDIT * 3 + (MICRO_PER_CREDIT - 1)) === 3, 'wholeFromMicro floors a fractional credit');
  ok(wholeFromMicro(0) === 0 && wholeFromMicro(null) === 0, 'wholeFromMicro handles 0/null');

  // ---- ensureWorkspaceWallet idempotent ----
  const wsId = crypto.randomUUID();
  await ensureWorkspaceWallet(pool, wsId);
  await ensureWorkspaceWallet(pool, wsId);
  const wsRows = (await pool.query('SELECT owner_kind FROM credit_accounts WHERE user_id=$1', [wsId])).rows;
  ok(wsRows.length === 1 && wsRows[0].owner_kind === 'workspace', 'ensureWorkspaceWallet idempotent + owner_kind=workspace');

  // ---- transferToWorkspace saga ----
  const userId = crypto.randomUUID();
  await pool.query('INSERT INTO users (id, credits) VALUES ($1, 0)', [userId]);
  await addGrant(pool, userId, { amountMicro: 100 * MICRO_PER_CREDIT, kind: 'promo', sourceRef: 'seed' });
  ok((await walletBalance(pool, userId)).credits === 100, 'user funded with 100 credits');

  const t = await transferToWorkspace(pool, userId, wsId, 30);
  ok(t.ok === true && t.transferred === 30, 'transfer 30 succeeds');
  ok((await walletBalance(pool, userId)).credits === 70, 'user debited to 70');
  ok((await walletBalance(pool, wsId)).credits === 30, 'workspace credited to 30');

  // ---- insufficient + invalid guards (saga must not partially apply) ----
  const insuf = await transferToWorkspace(pool, userId, wsId, 1000);
  ok(insuf.ok === false && insuf.status === 402, 'over-balance transfer → 402 insufficient');
  ok((await walletBalance(pool, userId)).credits === 70, 'user balance unchanged after failed transfer');
  ok((await walletBalance(pool, wsId)).credits === 30, 'workspace balance unchanged after failed transfer');
  ok((await transferToWorkspace(pool, userId, wsId, 0)).status === 400, 'zero amount → 400');
  ok((await transferToWorkspace(pool, userId, wsId, -5)).status === 400, 'negative amount → 400');

  // ---- setWorkspaceBudget ----
  const b = await setWorkspaceBudget(pool, wsId, { credits: 50 });
  ok(b.ok === true && b.credits === 50, 'setWorkspaceBudget returns ok');
  const cap = (await pool.query('SELECT limit_micro FROM spend_caps WHERE user_id=$1', [wsId])).rows[0];
  ok(cap && Number(cap.limit_micro) === 50 * MICRO_PER_CREDIT, 'spend_cap persisted at 50 credits');

  // ---- resolveBillingAccountId ----
  ok((await resolveBillingAccountId(pool, userId, null)).kind === 'user', 'no workspace → personal wallet');

  const personalWs = crypto.randomUUID();
  await pool.query("INSERT INTO workspaces (id, status, metadata) VALUES ($1, 'active', '{}'::jsonb)", [personalWs]);
  ok((await resolveBillingAccountId(pool, userId, personalWs)).kind === 'user', 'workspace not pooled → personal wallet');

  const pooledWs = crypto.randomUUID();
  await pool.query(`INSERT INTO workspaces (id, status, metadata) VALUES ($1, 'active', '{"billing_mode":"pooled"}'::jsonb)`, [pooledWs]);
  ok((await resolveBillingAccountId(pool, userId, pooledWs)).kind === 'user', 'pooled workspace but non-member → personal wallet');

  await writeTuples(pool, { writes: [{ object: `workspace:${pooledWs}`, relation: 'editor', subject: `user:${userId}` }] });
  const member = await resolveBillingAccountId(pool, userId, pooledWs);
  ok(member.kind === 'workspace' && member.id === pooledWs, 'pooled workspace + member → workspace wallet');

  console.log(`\n${fail === 0 ? '✅' : '❌'} wallet-service: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
