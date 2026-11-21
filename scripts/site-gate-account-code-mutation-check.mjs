// Mutation check for "an account that used a live code keeps the site" (owner, 2026-11-21): each protection is removed in
// turn and the real-Postgres proof (src/server/tests/site-access-codes.test.mjs) must FAIL; the control must pass.
// Usage (repo root): PG_ADMIN=postgresql://postgres:<pw>@127.0.0.1:<port> node scripts/site-gate-account-code-mutation-check.mjs
// PG_ADMIN must be a DISPOSABLE local server; this script drops and creates gatemut_* databases on it.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const admin = process.env.PG_ADMIN;
if (!admin || !/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(admin)) { console.error('refusing: PG_ADMIN must be a local disposable server'); process.exit(2); }
const R = 'src/server/routes/siteGateRoutes.js', S = 'src/server/services/siteAccessCodes.js';
const MUTANTS = [
  ['the account is not admitted by its code', R, 'return codes.accountHasLiveCode ? await codes.accountHasLiveCode(req.db, userId) : false;', 'return false;'],
  ['a revoked code still admits', S, "WHERE e.event = 'used_by_account' AND e.actor_id = $1 AND c.revoked_at IS NULL AND c.expires_at > now() LIMIT 1", "WHERE e.event = 'used_by_account' AND e.actor_id = $1 AND c.expires_at > now() LIMIT 1"],
  ['an expired code still admits', S, "WHERE e.event = 'used_by_account' AND e.actor_id = $1 AND c.revoked_at IS NULL AND c.expires_at > now() LIMIT 1", "WHERE e.event = 'used_by_account' AND e.actor_id = $1 AND c.revoked_at IS NULL LIMIT 1"],
  ['a suspended account is admitted by its code', R, '      if (!isUsableAccount(rows[0])) return false;', ''],
];
async function fresh(name) {
  const c = new pg.Client({ connectionString: `${admin}/postgres` }); await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name}`); await c.query(`CREATE DATABASE ${name}`); await c.end();
  return `${admin}/${name}`;
}
const run = (url) => { const r = spawnSync(process.execPath, ['tests/site-access-codes.test.mjs'], { cwd: 'src/server', env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 240000 }); return r.status === 0; };
const control = run(await fresh('gatemut_control'));
console.log(`control (no mutation): ${control ? 'PASS' : 'FAIL'}`);
if (!control) process.exit(2);
let caught = 0;
for (const [label, file, from, to] of MUTANTS) {
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes(from)) { console.log(`MISSING  ${label}`); process.exitCode = 1; continue; }
  fs.writeFileSync(file, original.replace(from, to));
  try { const passed = run(await fresh('gatemut_x')); console.log(`${passed ? 'SURVIVED' : 'caught  '} ${label}`); if (!passed) caught += 1; else process.exitCode = 1; }
  finally { fs.writeFileSync(file, original); }
}
console.log(`${caught}/${MUTANTS.length} mutations caught`);
