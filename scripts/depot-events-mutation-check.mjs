// Mutation check for the Depot event feed suite: each protection is removed in turn and the suite must FAIL.
// Usage (from the repo root): PG_ADMIN=postgresql://postgres:<pw>@127.0.0.1:<port> npm run test:depot-events-mutation
// PG_ADMIN must be a DISPOSABLE server: this script drops and creates its own databases (evmut_control, evmut_x) on it.
// Each source edit is put back in `finally`, so an interrupted run leaves the tree as it was.
// Not mutated on purpose: the v != 1 refusal is held twice (here and in the Index's recordDepotEvent), so removing
// one copy is caught by the other by design.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const admin = process.env.PG_ADMIN;
if (!admin || !/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(admin)) {
  console.error('refusing: PG_ADMIN must point at a local disposable Postgres server');
  process.exit(2);
}
const F = 'src/server/services/depotEvents.js';
const MUTANTS = [
  ['signature not checked', F, 'if (!verifyDepotSignature({ header: signature, raw: body, secrets, now })) throw', 'if (false) throw'],
  ['no time window', F, 'if (Math.abs(now / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS) return false;', ''],
  ['weak secrets accepted', F, '.filter((s) => s.length >= 32)', '.filter(Boolean)'],
  ['only the first secret tried', F, 'return secrets.some((s) => {', 'return secrets.slice(0, 1).some((s) => {'],
  ['unconfigured platform open', F, "if (!secrets.length) throw new DepotEventError('events_not_configured', 503,", "if (false) throw new DepotEventError('events_not_configured', 503,"],
  ['signature over re-serialised JSON', F, "const body = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw ?? ''), 'utf8');",
    "const body = Buffer.from(JSON.stringify(JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') || 'null' : String(raw ?? 'null'))), 'utf8');"],
];

async function freshDb(name) {
  const c = new pg.Client({ connectionString: `${admin}/postgres` });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name}`); await c.query(`CREATE DATABASE ${name}`);
  await c.end();
  return `${admin}/${name}`;
}
function runSuite(url) {
  const r = spawnSync(process.execPath, ['tests/depot-events.test.mjs'], { cwd: 'src/server', env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 120000 });
  return r.status === 0 && /depot-events: \d+ passed, 0 failed/.test(r.stdout);
}

let caught = 0;
const control = runSuite(await freshDb('evmut_control'));
console.log(`control (no mutation): ${control ? 'PASS' : 'FAIL'}`);
if (!control) process.exit(2);
for (const [label, file, from, to] of MUTANTS) {
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes(from)) { console.log(`MISSING  ${label}: anchor not found`); process.exitCode = 1; continue; }
  fs.writeFileSync(file, original.replace(from, to));
  try {
    const passed = runSuite(await freshDb('evmut_x'));
    console.log(`${passed ? 'SURVIVED' : 'caught  '} ${label}`);
    if (!passed) caught += 1; else process.exitCode = 1;
  } finally { fs.writeFileSync(file, original); }
}
console.log(`${caught}/${MUTANTS.length} mutations caught`);
