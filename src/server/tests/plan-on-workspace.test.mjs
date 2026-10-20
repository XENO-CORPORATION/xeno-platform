/**
 * D-1 (2026-10-20): the plan lives on the WORKSPACE. Real Postgres. Proves, on a migrated copy:
 *   - backfill: a Pro row written BEFORE the migration names its owner's personal workspace (DOWN, seed, UP);
 *   - the Stripe write path (setPlan via the webhook's upsert, keyed on user_id) still settles AND fills workspace_id;
 *   - getWorkspacePlan: personal carries the owner's Pro; a team workspace uses its own subscription; a Pro owner
 *     does NOT license a team workspace; a Studio owner does;
 *   - getActingEntitlements: acting in a workspace reads that workspace; a non-member cannot borrow its plan;
 *   - DOWN removes the column exactly and UP restores it.
 *
 * Run: DATABASE_URL=postgresql://… node tests/plan-on-workspace.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { ensurePersonalWorkspace } from '../services/personalWorkspace.js';
import { getWorkspacePlan, getActingEntitlements } from '../services/effectivePlan.js';
import { workspaceStorageAllowance } from '../services/storageAllowance.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const here = path.dirname(fileURLToPath(import.meta.url));
const [UP, DOWN] = fs.readFileSync(path.join(here, '../database/migrations/20261020120000-plan-on-workspace.sql'), 'utf8').split(/^-- DOWN\s*$/m);
const tag = `pow${process.pid}`;
const hasCol = async () => (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'xeno_account_plans' AND column_name = 'workspace_id'`)).rows.length === 1;
const GB = 1024 ** 3;

async function main() {
  await runAllMigrations(pool);
  assert.ok(await hasCol(), 'UP adds xeno_account_plans.workspace_id');
  const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1, $2, $1, true, true, 'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`])).rows[0].id;
  const upsertPlan = (uid, plan, status = 'active') => pool.query(
    `INSERT INTO xeno_account_plans (user_id, plan, status, stripe_subscription_id, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status, updated_at = now()`, [String(uid), plan, status, `sub_${uid.slice(0, 8)}`]);

  // ── DOWN, seed an existing Pro subscriber, UP: the backfill ──
  await pool.query(DOWN);
  assert.equal(await hasCol(), false, 'DOWN removes the column');
  const pro = await user('pro'); const proWs = (await ensurePersonalWorkspace(pool, pro)).id;
  await upsertPlan(pro, 'pro');
  await pool.query(UP.replace(/^-- UP\s*$/m, ''));
  assert.ok(await hasCol(), 'UP restores the column');
  await pool.query(UP.replace(/^-- UP\s*$/m, '')); // idempotent
  assert.equal((await pool.query('SELECT workspace_id FROM xeno_account_plans WHERE user_id = $1', [String(pro)])).rows[0].workspace_id, proWs, 'backfill: a Pro row is the plan of its owner\'s personal workspace');

  // ── the webhook write path (keyed on user_id) still settles, and fills the workspace ──
  const fresh = await user('fresh'); const freshWs = (await ensurePersonalWorkspace(pool, fresh)).id;
  await upsertPlan(fresh, 'pro');
  const row = (await pool.query('SELECT plan, status, workspace_id FROM xeno_account_plans WHERE user_id = $1', [String(fresh)])).rows[0];
  assert.deepEqual([row.plan, row.status, row.workspace_id], ['pro', 'active', freshWs], 'a new subscription settles by user and names its workspace');
  await upsertPlan(fresh, 'pro', 'canceled');
  assert.equal((await getWorkspacePlan(pool, freshWs)).plan, 'free', 'a cancelled subscription leaves the personal workspace Free');
  await upsertPlan(fresh, 'pro', 'past_due');
  assert.equal((await getWorkspacePlan(pool, freshWs)).plan, 'pro', 'past_due keeps the grace period');

  // ── workspace plans ──
  assert.equal((await getWorkspacePlan(pool, proWs)).plan, 'pro', 'a personal workspace carries its owner\'s Pro');
  const team = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Pow Co', $2) RETURNING id`, [pro, `${tag}-co`])).rows[0].id;
  assert.equal((await getWorkspacePlan(pool, team)).plan, 'free', 'a personal Pro does NOT license a team workspace');
  assert.equal(await workspaceStorageAllowance(pool, team), 5 * GB, 'so its pool is Free');
  await pool.query(`UPDATE workspaces SET metadata = jsonb_build_object('billing', jsonb_build_object('plan','team','status','active','seat_limit',2)) WHERE id = $1`, [team]);
  assert.equal((await getWorkspacePlan(pool, team)).plan, 'team', 'a team workspace uses its own subscription');
  assert.equal(await workspaceStorageAllowance(pool, team), 200 * GB);
  const studio = await user('studio'); await upsertPlan(studio, 'studio');
  const studioTeam = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Studio Co', $2) RETURNING id`, [studio, `${tag}-st`])).rows[0].id;
  assert.equal((await getWorkspacePlan(pool, studioTeam)).plan, 'studio', 'Studio includes a shared workspace');
  assert.equal((await getWorkspacePlan(pool, '00000000-0000-4000-8000-000000000000')).plan, 'free', 'an unknown workspace fails closed');

  // ── acting entitlements ──
  assert.equal((await getActingEntitlements(pool, pro, { workspaceId: proWs })).plan, 'pro');
  assert.equal((await getActingEntitlements(pool, pro, { workspaceId: team })).plan, 'team', 'the owner acting in the team workspace reads its plan');
  const stranger = await user('stranger');
  assert.equal((await getActingEntitlements(pool, stranger, { workspaceId: studioTeam })).plan, 'free', 'a non-member cannot borrow a workspace plan by naming it');
  await pool.query(`UPDATE workspaces SET metadata = '{}'::jsonb WHERE id = $1`, [team]);
  assert.equal((await getActingEntitlements(pool, pro, { workspaceId: team })).entitlements.cloudSync, false, 'Pro acting in an unpaid team workspace is held to Free there');
  assert.equal((await getActingEntitlements(pool, pro)).plan, 'pro', 'no acting workspace = the legacy answer');
  console.log('plan-on-workspace: all checks passed');
}

main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });
