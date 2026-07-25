/**
 * Integration test for ReBAC authz (Arch §3) against a real Postgres.
 * Also mounts the REAL /api/v2/authz router to prove the write-gate:
 * bootstrap on a zero-tuple object is allowed ONLY as "claim myself as owner".
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55473/t node tests/authz-v2.test.mjs
 */
import express from 'express';
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { check, writeTuples } from '../utils/authzReBAC.js';
import v2AuthzRoutes from '../routes/v2AuthzRoutes.js';

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

  // ── HTTP surface: /api/v2/authz write-gate + objects read-gate ─────────────
  let asUser = 'alice';
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; req.user = { id: asUser }; next(); });
  app.use('/api/v2/authz', v2AuthzRoutes);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v2/authz`;
  const http = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  // Bootstrap tightening: an unclaimed (zero-tuple) object accepts ONLY owner=self.
  asUser = 'mallory';
  let r = await http('POST', '/write', { writes: [{ object: 'workspace:victim1', relation: 'owner', subject: 'user:mallory-accomplice' }] });
  ok(r.status === 403, 'bootstrap owner=SOMEONE-ELSE on zero-tuple object → 403 (cross-tenant capture blocked)');
  r = await http('POST', '/write', { writes: [{ object: 'workspace:victim2', relation: 'editor', subject: 'user:mallory' }] });
  ok(r.status === 403, 'bootstrap non-owner relation (editor=self) on zero-tuple object → 403');
  r = await http('POST', '/write', { deletes: [{ object: 'workspace:victim3', relation: 'owner', subject: 'user:someone' }] });
  ok(r.status === 403, 'deletes on a zero-tuple object → 403 (no bootstrap via deletes)');
  r = await http('POST', '/write', { writes: [
    { object: 'workspace:victim4', relation: 'owner', subject: 'user:mallory' },
    { object: 'workspace:victim4', relation: 'admin', subject: 'user:mallory-accomplice' },
  ] });
  ok(r.status === 403, 'mixed bootstrap (owner=self PLUS a grant to another) → 403 (must be owner=self ONLY)');
  r = await http('POST', '/write', { writes: [{ object: 'system:credits', relation: 'owner', subject: 'user:mallory' }] });
  ok(r.status === 403, 'bootstrap of system:* → 403 (never claimable)');
  r = await http('POST', '/write', { writes: [{ object: 'workspace:mine1', relation: 'owner', subject: 'user:mallory' }] });
  ok(r.status === 200 && r.json.added === 1, 'legitimate bootstrap (claim MYSELF as owner of my new object) → 200');
  ok((await check(pool, { object: 'workspace:mine1', relation: 'owner', subject: 'user:mallory' })).allowed, 'the self-owner claim actually landed');

  // Non-empty objects keep the admin gate.
  r = await http('POST', '/write', { writes: [{ object: W, relation: 'admin', subject: 'user:mallory' }] });
  ok(r.status === 403, 'non-admin writing tuples on a CLAIMED object → 403');
  asUser = 'alice';
  r = await http('POST', '/write', { writes: [{ object: W, relation: 'viewer', subject: 'user:dave' }] });
  ok(r.status === 200, 'owner writing tuples on their object → 200');

  // objects read-gate: members only.
  asUser = 'mallory';
  r = await http('GET', `/objects/workspace/w1`);
  ok(r.status === 403, 'GET /objects on a workspace I am not a member of → 403 (was: world-readable)');
  asUser = 'carol';
  r = await http('GET', `/objects/workspace/w1`);
  ok(r.status === 200 && Array.isArray(r.json.tuples) && r.json.tuples.length > 0, 'GET /objects as a member (viewer) → 200 with tuples');

  server.close();
  console.log(`\n${fail === 0 ? '✅' : '❌'} authz-v2: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
