/**
 * Ledger audit fixes (2026-07-19) — hermetic integration test against a real Postgres.
 *
 * Covers the money-defect fixes:
 *   1. video render CHARGES on the canonical ledger (was: free + gated on the lossy
 *      users.credits mirror) with deterministic refs `video-render:<jobId>` /
 *      `video-render-refund:<jobId>`, and refunds on cancel;
 *   2. transferToWorkspace saga compensation is a REVERSING entry (not a promo grant
 *      that inflates lifetime_earned);
 *   7. plan resolution: 'internal' entitlements + 'ultra'→'pro' alias (no silent
 *      free-tier fallback);
 *   9. walletBalance/getBalanceV2 plumb the real is_frozen;
 *  10. ensureWorkspaceWallet refuses to re-type an existing personal wallet;
 *  11. addGrant sourceRef replay hits uq_credit_txn_ref (admin-grant idempotency);
 *   6. inHouseDailyLimit real enforcement — boundary trip at the cap, unlimited
 *      plans, fail-open on counter failure.
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55511/t node tests/ledger-audit-fixes.test.mjs
 */
import pg from 'pg';
import crypto from 'crypto';
import express from 'express';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import {
  addGrant, getBalanceV2, setFrozen, verifyChainV2, MICRO_PER_CREDIT,
} from '../utils/creditLedgerV2.js';
import {
  ensureWorkspaceWallet, walletBalance, transferToWorkspace,
} from '../services/walletService.js';
import { entitlementsFor } from '../services/billingService.js';
import {
  enforceInHouseDailyLimit, bumpInhouseDailyUsage, nextUtcMidnight,
} from '../middleware/inHouseDailyLimit.js';
import videoRoutes from '../routes/videoRoutes.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const C = (n) => n * MICRO_PER_CREDIT;

const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, owner_kind varchar(16) DEFAULT 'user', balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS api_usage_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, surface varchar(64), operation varchar(128), model varchar(128), provider varchar(64), actual_cost_micro bigint, estimated_cost_micro bigint, input_tokens int DEFAULT 0, output_tokens int DEFAULT 0, status varchar(16), request_id varchar(128), endpoint text, method varchar(8), created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY, status varchar(16) DEFAULT 'active', metadata jsonb DEFAULT '{}'::jsonb);
-- New audit tables (mirrors migrations/20260719000000-ledger-audit-tables.sql)
CREATE TABLE IF NOT EXISTS inhouse_daily_usage (user_id uuid NOT NULL, day date NOT NULL, count int NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day));
CREATE TABLE IF NOT EXISTS ledger_compensation_failures (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, amount_micro bigint NOT NULL, txn_ref varchar(128), reason text, context jsonb, resolved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
-- Minimal video tables (only the columns the /render + /cancel routes touch)
CREATE TABLE IF NOT EXISTS video_projects (id uuid PRIMARY KEY, user_id uuid, title text, width int, height int, fps int, duration numeric, status text DEFAULT 'draft');
CREATE TABLE IF NOT EXISTS video_render_jobs (id uuid PRIMARY KEY, project_id uuid, user_id uuid, render_settings jsonb, status text, total_frames int, credits_used int, completed_at timestamptz, created_at timestamptz DEFAULT now());
`;

const balance = async (uid) => (await getBalanceV2(pool, uid)).availableMicro;
const newUser = async () => (await pool.query('INSERT INTO users (credits) VALUES (0) RETURNING id')).rows[0].id;
const grant = (uid, credits) => addGrant(pool, uid, { amountMicro: C(credits), kind: 'paid', sourceRef: `seed:${uid}` });
const lifetimeEarned = async (uid) => Number((await pool.query('SELECT lifetime_earned FROM credit_accounts WHERE user_id=$1', [uid])).rows[0].lifetime_earned);

async function main() {
  await pool.query(BASE);
  await migrateAccountV2(pool);
  console.log('✓ migration applied');

  // ── Fix 7: plan resolution — internal + ultra alias ────────────────────────
  {
    const internal = entitlementsFor('internal');
    ok(internal.plan === 'internal', 'internal plan resolves (no free fallback)');
    ok(internal.cloudSync && internal.crossApp && internal.agents && internal.collaboration
      && internal.commercial && internal.priority && internal.privateProjects,
    'internal: all platform features enabled');
    ok(internal.maxResolution === '4k' && internal.inHouseDailyLimit === null
      && internal.teamSeats === 0 && internal.watermark === false,
    'internal: 4k / unlimited in-house / 0 seats / no watermark');
    const ultra = entitlementsFor('ultra');
    ok(ultra.plan === 'pro', "ultra aliases to pro (PROPOSED mapping, pending ratification)");
    ok(entitlementsFor('nonsense').plan === 'free', 'unknown plan still falls back to free');
  }

  // ── Fix 1: video render debits + refunds on the canonical ledger ───────────
  // Mount the real route behind a stub auth/db middleware.
  let actingUser = null;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: actingUser }; req.db = pool; next(); });
  app.use('/api/video', videoRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;
  const call = (method, path, body) => fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });

  {
    const u = await newUser();
    await grant(u, 100);
    actingUser = u;
    // 1000×1000 × 2s × 5fps / 1e6 = 10 credits
    const pid = crypto.randomUUID();
    await pool.query('INSERT INTO video_projects (id, user_id, width, height, fps, duration) VALUES ($1,$2,1000,1000,5,2)', [pid, u]);

    const r = await call('POST', '/api/video/render', { project_id: pid });
    const body = await r.json();
    ok(r.status === 200 && body.success === true, 'render accepted');
    ok(body.estimated_credits === 10, 'estimatedCredits stays the cost source of truth (10)');
    ok(await balance(u) === C(90), 'render DEBITED 10 credits on the canonical ledger (was: free)');
    const jobId = body.job.id;
    const debitRow = (await pool.query(
      "SELECT type, amount FROM credit_transactions WHERE user_id=$1 AND reference_id=$2", [u, `video-render:${jobId}`],
    )).rows[0];
    ok(debitRow && debitRow.type === 'debit' && Number(debitRow.amount) === -C(10),
      'deterministic debit ref video-render:<jobId> (idempotent, signed −10)');

    // Cancel → refund with the deterministic refund ref.
    const rc = await call('POST', `/api/video/render/${jobId}/cancel`, {});
    const cbody = await rc.json();
    ok(rc.status === 200 && cbody.credits_refunded === 10, 'cancel refunds the 10 credits');
    ok(await balance(u) === C(100), 'balance restored to 100 after cancel refund');
    const refundRow = (await pool.query(
      "SELECT type, amount, reference_type, metadata FROM credit_transactions WHERE user_id=$1 AND reference_id=$2",
      [u, `video-render-refund:${jobId}`],
    )).rows[0];
    ok(refundRow && refundRow.type === 'refund' && Number(refundRow.amount) === C(10),
      'refund ref video-render-refund:<jobId>, type refund, POSITIVE amount (signed balance delta)');
    ok(refundRow?.metadata?.direction === 'reversal', 'refund row tagged metadata.direction=reversal');

    // Second cancel: SQL guard → 404, no double refund.
    const rc2 = await call('POST', `/api/video/render/${jobId}/cancel`, {});
    ok(rc2.status === 404 && await balance(u) === C(100), 'double-cancel rejected → no double refund');

    // Insufficient credits → 402 from the CANONICAL balance, not the mirror.
    const poor = await newUser();
    await grant(poor, 5);
    // Poison the legacy mirror to prove the mirror is NOT the decision input.
    await pool.query('UPDATE users SET credits = 999999 WHERE id=$1', [poor]);
    actingUser = poor;
    const pid2 = crypto.randomUUID();
    await pool.query('INSERT INTO video_projects (id, user_id, width, height, fps, duration) VALUES ($1,$2,1000,1000,5,2)', [pid2, poor]);
    const r402 = await call('POST', '/api/video/render', { project_id: pid2 });
    const b402 = await r402.json();
    ok(r402.status === 402 && b402.required === 10 && b402.available === 5,
      '402 gates on canonical ledger (5 avail) even with a poisoned users.credits mirror');
    ok(await balance(poor) === C(5), 'no partial charge on rejected render');
    const chain = await verifyChainV2(pool, u);
    ok(chain.ok === true, 'hash chain intact across grant→debit→refund');
  }
  server.close();

  // ── Fix 10: ensureWorkspaceWallet must not re-type a personal wallet ───────
  {
    const u = await newUser();
    await grant(u, 1); // creates the PERSONAL wallet row
    let threw = null;
    try { await ensureWorkspaceWallet(pool, u); } catch (e) { threw = e.code; }
    ok(threw === 'WALLET_KIND_CONFLICT', 'ensureWorkspaceWallet on a personal wallet throws WALLET_KIND_CONFLICT');
    const kind = (await pool.query('SELECT owner_kind FROM credit_accounts WHERE user_id=$1', [u])).rows[0].owner_kind;
    ok(kind === 'user', 'personal wallet NOT converted (owner_kind still user)');
    // And the legit path still works, idempotently.
    const ws = crypto.randomUUID();
    await ensureWorkspaceWallet(pool, ws);
    await ensureWorkspaceWallet(pool, ws);
    const wsKind = (await pool.query('SELECT owner_kind FROM credit_accounts WHERE user_id=$1', [ws])).rows[0].owner_kind;
    ok(wsKind === 'workspace', 'workspace wallet creation still idempotent');
  }

  // ── Fix 2: saga compensation = reversing entry, not a promo grant ──────────
  {
    const a = await newUser();
    await grant(a, 50);
    const earnedBefore = await lifetimeEarned(a);
    // Force the workspace-credit step to fail: the "workspace" id is an existing
    // PERSONAL wallet → ensureWorkspaceWallet throws → compensation must run.
    const b = await newUser();
    await grant(b, 1);
    let threw = null;
    try { await transferToWorkspace(pool, a, b, 20); } catch (e) { threw = e.code; }
    ok(threw === 'WALLET_KIND_CONFLICT', 'transfer rethrows the grant-step failure');
    ok(await balance(a) === C(50), 'compensation restored the debited 20 credits');
    ok(await lifetimeEarned(a) === earnedBefore,
      'compensation did NOT inflate lifetime_earned (reversing entry, not a promo grant)');
    const comp = (await pool.query(
      "SELECT metadata FROM credit_transactions WHERE user_id=$1 AND type='refund' AND reference_type='xeno.refund'", [a],
    )).rows;
    ok(comp.length === 1 && comp[0].metadata?.direction === 'reversal',
      'compensation wrote one xeno.refund reversal row');
    ok((await pool.query('SELECT count(*)::int n FROM ledger_compensation_failures')).rows[0].n === 0,
      'no compensation-failure record when the reversal succeeds');
    ok((await verifyChainV2(pool, a)).ok === true, 'hash chain intact across debit→compensation');
  }

  // ── Fix 9: is_frozen plumbed through balance views ─────────────────────────
  {
    const u = await newUser();
    await grant(u, 10);
    ok((await walletBalance(pool, u)).is_frozen === false, 'walletBalance reports unfrozen');
    await setFrozen(pool, u, true);
    ok((await getBalanceV2(pool, u)).is_frozen === true, 'getBalanceV2 reports is_frozen=true');
    ok((await walletBalance(pool, u)).is_frozen === true, 'walletBalance reports is_frozen=true (was always false)');
    await setFrozen(pool, u, false);
  }

  // ── Fix 11: grant sourceRef replay is rejected by uq_credit_txn_ref ────────
  {
    const u = await newUser();
    await addGrant(pool, u, { amountMicro: C(5), kind: 'paid', sourceRef: 'admin-grant:key-1' });
    let dupCode = null;
    try { await addGrant(pool, u, { amountMicro: C(5), kind: 'paid', sourceRef: 'admin-grant:key-1' }); } catch (e) { dupCode = e.code; }
    ok(dupCode === '23505', 'replayed sourceRef grant hits unique index (route maps to 409)');
    ok(await balance(u) === C(5), 'no double-mint on replay');
  }

  // ── Fix 6: in-house daily limit — boundary + unlimited + fail-open ─────────
  {
    const u = await newUser(); // free plan by default (no xeno_account_plans row)
    const first = await enforceInHouseDailyLimit(pool, u);
    ok(first.allowed === true && first.count === 1 && first.limit === 50, 'free plan: first request allowed (1/50)');
    // Jump to the boundary: 49 used → next bump = 50 (still allowed) → 51 blocked.
    await pool.query("UPDATE inhouse_daily_usage SET count = 49 WHERE user_id=$1", [u]);
    const at = await enforceInHouseDailyLimit(pool, u);
    ok(at.allowed === true && at.count === 50, 'boundary: 50th request of the day is ALLOWED');
    const over = await enforceInHouseDailyLimit(pool, u);
    ok(over.allowed === false && over.count === 51 && over.limit === 50, 'boundary: 51st request is BLOCKED (429)');
    ok(typeof over.resetAt === 'string' && new Date(over.resetAt).getTime() === nextUtcMidnight().getTime(),
      'blocked verdict names the UTC-midnight reset time');

    // Unlimited plans never bump the counter.
    const uPro = await newUser();
    await pool.query("INSERT INTO xeno_account_plans (user_id, plan, status) VALUES ($1,'pro','active')", [uPro]);
    const pro = await enforceInHouseDailyLimit(pool, uPro);
    ok(pro.allowed === true && pro.limit === null, 'pro plan: unlimited (limit null)');
    ok((await pool.query('SELECT count(*)::int n FROM inhouse_daily_usage WHERE user_id=$1', [uPro])).rows[0].n === 0,
      'pro plan: counter never written');
    const uUltra = await newUser();
    await pool.query("INSERT INTO xeno_account_plans (user_id, plan, status) VALUES ($1,'ultra','active')", [uUltra]);
    const ultra = await enforceInHouseDailyLimit(pool, uUltra);
    ok(ultra.allowed === true && ultra.limit === null, 'ultra plan: aliased to pro → unlimited');
    const uInt = await newUser();
    await pool.query("INSERT INTO xeno_account_plans (user_id, plan, status) VALUES ($1,'internal','active')", [uInt]);
    const internal = await enforceInHouseDailyLimit(pool, uInt);
    ok(internal.allowed === true && internal.limit === null, 'internal plan: unlimited');

    // Counter infrastructure failure → FAIL OPEN.
    const badDb = { query: async () => { throw new Error('db down'); } };
    const open = await enforceInHouseDailyLimit(badDb, crypto.randomUUID());
    ok(open.allowed === true && open.counterError === true, 'counter failure fails OPEN (never blocks inference)');

    // The raw upsert helper returns monotonically increasing counts.
    const uRaw = await newUser();
    ok(await bumpInhouseDailyUsage(pool, uRaw) === 1 && await bumpInhouseDailyUsage(pool, uRaw) === 2,
      'bumpInhouseDailyUsage upsert increments atomically');
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ledger-audit-fixes: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
