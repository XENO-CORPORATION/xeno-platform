// Explicit test-only opt-in for older money suites. Never changes production
// defaults. Apply the real migration rather than a copied table definition.
import { readFileSync } from 'node:fs';

export async function installUsageCreditFixture(pool) {
  await pool.query(readFileSync(new URL('../database/migrations/20260915140000-usage-credit-consent.sql', import.meta.url),'utf8').split('-- DOWN')[0]);
}
export async function optInUsageCredits(pool,userId) {
  await pool.query('INSERT INTO usage_credit_preferences (user_id,enabled) VALUES ($1,true) ON CONFLICT (user_id) DO UPDATE SET enabled=true',[userId]);
}

// Media metering now resolves the principal and its plan before admission.
// Minimal identity/plan fixture, with internal plan to avoid injecting a new
// weekly grant into the arithmetic this legacy suite exists to test.
export async function installMediaIdentityFixture(pool) {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username text,
    ADD COLUMN IF NOT EXISTS display_name text, ADD COLUMN IF NOT EXISTS role text DEFAULT 'user',
    ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true, ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
    CREATE TABLE IF NOT EXISTS agent_identities (user_id uuid, owner_user_id uuid, agent_role text,agent_origin text,status text);
    CREATE TABLE IF NOT EXISTS workspaces (id uuid,metadata jsonb);
    CREATE TABLE IF NOT EXISTS xeno_account_plans (user_id text PRIMARY KEY,plan text,status text,current_period_end timestamptz);`);
}
export async function newMediaUser(pool) {
  const {rows:[row]}=await pool.query('INSERT INTO users (credits) VALUES (0) RETURNING id');
  await optInUsageCredits(pool,row.id);
  await pool.query("INSERT INTO xeno_account_plans (user_id,plan,status) VALUES ($1,'internal','active')",[row.id]);
  return row.id;
}
