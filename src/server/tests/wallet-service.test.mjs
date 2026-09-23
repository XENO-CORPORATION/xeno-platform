import { installUsageCreditFixture, optInUsageCredits } from './usage-credit-fixture.mjs';
import { tablesDDL } from './fixtures/schema.mjs';
/**
 * Integration test for walletService (workspace billing, Phase 4) against a real Postgres.
 * Verifies the money-movement surface: micro→whole conversion, idempotent workspace-wallet
 * creation, the personal→workspace transfer SAGA (debit the user, grant the workspace;
 * refund/insufficient/invalid guards), budget spend-caps, and billing-account resolution
 * (pooled vs personal, member vs non-member).
 *
 * Run: DATABASE_URL=postgresql://postgres:pw@host:5432/db node tests/wallet-service.test.mjs
 *
 * ⚠️ XENO-WORKFORCE-01 FUND-06 IS NOT CITED HERE -- AND THE LAST ASSERTIONS PIN BEHAVIOUR IT FORBIDS.
 * FUND-06: "Each run has one selected payer ... No silent fallback to a personal wallet if the
 * selected pool cannot fund the work." resolveBillingAccountId returns the PERSONAL wallet whenever
 * the workspace is missing, archived, not pooled, or the caller is not a member, and reports nothing
 * about which of those happened; its only caller (index.js, the chat completion route) additionally
 * falls back to personal on ANY error, logging a warning. The assertions "pooled workspace but
 * non-member -> personal wallet" and friends below encode that fallback as correct. Under FUND-06 a
 * caller who SELECTED a pool it cannot use must be refused, not quietly billed personally.
 *
 * LATENT, NOT LIVE -- measured 2026-09-23: WORKSPACE_BILLING_ENABLED is unset in BOTH production
 * backend replicas (xeno-platform-backend-2/-3; read with `docker exec <c> printenv`, which lists 125
 * variables, so an absent name is really absent) and no workspace has billing_mode='pooled'. The first
 * measurement queried a container name that does not exist and reported "unset" from the error --
 * corrected here. So every spend bills personally by
 * design and no pool is ever silently bypassed. The defect becomes live the day that flag is set.
 * Repairing it means a typed refusal from the resolver, a caller that returns it to the client, and
 * changing the assertions below -- do it BEFORE enabling pooled billing, not after.
 *
 * 🔴 AND A POOL CANNOT SPEND AT ALL YET -- a second, independent blocker found while measuring the
 * first (2026-09-23, real PostgreSQL). A member transferred 30 credits into a pooled workspace (the
 * transfer succeeds, workspace balance 30), the resolver named the WORKSPACE as payer, and a 5-credit
 * hold against it was refused QUOTA_EXCEEDED "Turn on usage credits". Paid lots are spendable only
 * with a usage_credit_preferences row, and that table's user_id REFERENCES users(id) -- so a workspace
 * id can never hold one (insert refused 23503; the same foreign key is on production). Every pooled
 * spend therefore fails. Enabling WORKSPACE_BILLING_ENABLED today would not bill pools; it would
 * refuse every member's premium chat in a pooled workspace. The consent model (FUND-02 / D07-adjacent:
 * whose consent does a pooled paid lot need?) must be settled before the flag can mean anything.
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
CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY, status varchar(16) DEFAULT 'active', metadata jsonb DEFAULT '{}'::jsonb);
`;

async function main() {
  await pool.query(BASE);
  // api_usage_logs from the MIGRATIONS (fixtures/schema.mjs): its shape is production's, incl. `dimensions`.
  await pool.query(tablesDDL('api_usage_logs'));
  await migrateAccountV2(pool);
  await installUsageCreditFixture(pool);
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
  await optInUsageCredits(pool, userId);
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
