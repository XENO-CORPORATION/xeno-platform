/**
 * Integration test for ReBAC authz (Arch §3) against a real Postgres.
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55473/t node tests/authz-v2.test.mjs
 */
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { check, writeTuples } from '../utils/authzReBAC.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

async function main() {
  // Stub the live table the migration indexes, so the additive migration runs.
  await pool.query(`CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, reference_type varchar(64), reference_id varchar(128))`);
  await migrateAccountV2(pool);
  const W = 'workspace:w1';

  await writeTuples(pool, { writes: [
    { object: W, relation: 'owner',  subject: 'user:alice' },
    { object: W, relation: 'editor', subject: 'user:bob' },
    { object: W, relation: 'viewer', subject: 'user:carol' },
    { object: W, relation: 'editor', subject: 'agent:bot1' }, // scoped agent
  ]});

  // role hierarchy: owner satisfies every lower role
  ok((await check(pool, { object: W, relation: 'admin',  subject: 'user:alice' })).allowed, 'owner ⇒ admin (hierarchy)');
  ok((await check(pool, { object: W, relation: 'viewer', subject: 'user:alice' })).allowed, 'owner ⇒ viewer');
  // editor can edit + view, but NOT admin
  ok((await check(pool, { object: W, relation: 'editor', subject: 'user:bob' })).allowed, 'editor ⇒ editor');
  ok((await check(pool, { object: W, relation: 'viewer', subject: 'user:bob' })).allowed, 'editor ⇒ viewer');
  ok(!(await check(pool, { object: W, relation: 'admin', subject: 'user:bob' })).allowed, 'editor ⇏ admin');
  // viewer cannot edit
  ok(!(await check(pool, { object: W, relation: 'editor', subject: 'user:carol' })).allowed, 'viewer ⇏ editor');
  // membership
  ok((await check(pool, { object: W, relation: 'member', subject: 'user:carol' })).allowed, 'any role ⇒ member');
  ok(!(await check(pool, { object: W, relation: 'member', subject: 'user:dave' })).allowed, 'non-member ⇏ member');
  // AGENT gets EXACTLY its relation — no hierarchy escalation
  ok((await check(pool, { object: W, relation: 'editor', subject: 'agent:bot1' })).allowed, 'agent ⇒ its granted editor');
  ok(!(await check(pool, { object: W, relation: 'viewer', subject: 'agent:bot1' })).allowed, 'agent editor does NOT escalate to viewer (scoped, exact)');
  ok(!(await check(pool, { object: W, relation: 'admin', subject: 'agent:bot1' })).allowed, 'agent does NOT inherit admin');
  // revoke
  await writeTuples(pool, { deletes: [{ object: W, relation: 'editor', subject: 'user:bob' }] });
  ok(!(await check(pool, { object: W, relation: 'editor', subject: 'user:bob' })).allowed, 'revoked editor loses access');

  console.log(`\n${fail === 0 ? '✅' : '❌'} authz-v2: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
