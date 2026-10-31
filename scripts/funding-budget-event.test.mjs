// A funding budget can be written, its event names the CAMPAIGN's project, and the fix rolls back cleanly.
// 20261022090000 bound workforce_funding_budgets to a trigger that read workforce_funding_pools.project_id (no such
// column), so every budget INSERT failed with 42703 (found 2026-10-23). Runs on a disposable database, inside a schema
// of its own that it drops afterwards (the workforce fixture is shared by several suites):
//   WORKFORCE_TEST_DATABASE_URL=postgresql://…/workforceproof node --test scripts/funding-budget-event.test.mjs
// `npm run ci:local` runs it that way in its proofs stage (the variable is one of its DB_PROOF_FIXTURES).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const pg = createRequire(new URL('../src/server/package.json', import.meta.url))('pg');
const FILE = new URL('../src/server/database/migrations/20261028130000-funding-budget-event-project.sql', import.meta.url);
const [UP, DOWN] = readFileSync(FILE, 'utf8').split(/^--\s*DOWN\b.*$/m);

test('the budgets trigger uses its own function; DOWN restores the old binding', () => {
  assert.match(UP, /JOIN workforce_funding_campaigns c ON c\.id = p\.campaign_id/);
  assert.doesNotMatch(UP, /SELECT project_id INTO \w+ FROM workforce_funding_pools/);
  assert.match(UP, /EXECUTE FUNCTION workforce_funding_budget_event\(\)/);
  assert.match(DOWN, /EXECUTE FUNCTION workforce_event_capture\(\)/);
});

const DB_URL = process.env.WORKFORCE_TEST_DATABASE_URL || process.env.DATABASE_URL;
const SCHEMA = `funding_budget_event_${process.pid}_${Date.now()}`;

test('up, down and up again on a real database', { skip: !DB_URL && 'needs WORKFORCE_TEST_DATABASE_URL (disposable)' }, async () => {
  const admin = new pg.Pool({ connectionString: DB_URL });
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  // Every connection resolves unqualified names in the owned schema, so the migration under test runs exactly as
  // written and nothing lands in (or reads from) public.
  const pool = new pg.Pool({ connectionString: DB_URL, options: `-c search_path=${SCHEMA},pg_catalog` });
  try {
    // the smallest schema the trigger touches, shaped as the migrations shape it
    await pool.query(`CREATE TABLE IF NOT EXISTS workforce_funding_campaigns (id uuid PRIMARY KEY, project_id uuid NOT NULL);
      CREATE TABLE IF NOT EXISTS workforce_funding_pools (id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES workforce_funding_campaigns(id));
      CREATE TABLE IF NOT EXISTS workforce_funding_budgets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pool_id uuid NOT NULL REFERENCES workforce_funding_pools(id),
        state text NOT NULL, proposed_by_user_id uuid, decided_by_user_id uuid, spender_user_id uuid, maximum_micro bigint, revision int DEFAULT 1);
      CREATE TABLE IF NOT EXISTS e2e_events (type text, project_id uuid);
      CREATE OR REPLACE FUNCTION workforce_event_emit(p_type text, p_kind text, p_id uuid, p_actor uuid, ws uuid, dv uuid, p_project uuid, p_data jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO e2e_events VALUES (p_type, p_project) $$;
      CREATE OR REPLACE FUNCTION workforce_event_capture() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE t record; BEGIN
        SELECT project_id INTO t FROM workforce_funding_pools WHERE id = NEW.pool_id; RETURN NULL; END $$;
      DROP TRIGGER IF EXISTS workforce_funding_budgets_event ON workforce_funding_budgets;
      CREATE TRIGGER workforce_funding_budgets_event AFTER INSERT OR UPDATE ON workforce_funding_budgets FOR EACH ROW EXECUTE FUNCTION workforce_event_capture();`);
    const proj = '11111111-1111-4111-8111-111111111111', camp = '22222222-2222-4222-8222-222222222222', pool1 = '33333333-3333-4333-8333-333333333333';
    await pool.query('INSERT INTO workforce_funding_campaigns VALUES ($1,$2) ON CONFLICT DO NOTHING', [camp, proj]);
    await pool.query('INSERT INTO workforce_funding_pools VALUES ($1,$2) ON CONFLICT DO NOTHING', [pool1, camp]);
    const insert = () => pool.query(`INSERT INTO workforce_funding_budgets (pool_id, state) VALUES ($1, 'proposed')`, [pool1]);
    await assert.rejects(insert(), /column "project_id" does not exist/, 'control: the shipped binding refuses every budget');
    await pool.query(UP);
    await insert();
    assert.deepEqual((await pool.query('SELECT type, project_id FROM e2e_events')).rows, [{ type: 'funding.budget_proposed', project_id: proj }]);
    await pool.query(DOWN);
    await assert.rejects(insert(), /column "project_id" does not exist/, 'DOWN restores the previous binding exactly');
    await pool.query(UP);
    await insert();
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await admin.end();
  }
});
