// Mutation check for a customer's billing details (services/customers.js, the 20261123090000 migration): take away each
// protection and prove src/server/tests/customers.test.mjs then fails. Needs DATABASE_URL = a disposable database.
//   node scripts/customers-billing-mutation-check.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import pg from '../src/server/node_modules/pg/lib/index.js';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVC = path.join(repo, 'src/server/services/customers.js'), MIG = path.join(repo, 'src/server/database/migrations/20261130090000-crm-company-billing.sql');
const MUTATIONS = [
  ['a viewer may change billing details', SVC, "export async function updateCompany(db, actor, companyId, input = {}) {\n  const ctx = await workspaceFor(db, actor, input.workspace, 'editor');", "export async function updateCompany(db, actor, companyId, input = {}) {\n  const ctx = await workspaceFor(db, actor, input.workspace, 'viewer');"],
  ['any text passes as a country', SVC, "if (country && !COUNTRY.test(country.toUpperCase()))", "if (false)"],
  ['unknown keys are stored', SVC, "  const out = { name: text(v.name, 'billing name', 200, false),", "  const out = { ...v, name: text(v.name, 'billing name', 200, false),"],
  ['the update is not limited to this workspace', SVC, "WHERE id = $1 AND workspace_id = $2 RETURNING *`, vals)", "WHERE id = $1 AND $2::uuid IS NOT NULL RETURNING *`, vals)"],
  ['the database does not bound the record', MIG, "length(billing::text) <= 4000", "length(billing::text) <= 4000000"],
];
const url = process.env.DATABASE_URL; if (!url) throw new Error('DATABASE_URL is required');
const fresh = async () => { const u = new URL(url), name = u.pathname.slice(1); u.pathname = '/postgres'; const c = new pg.Client({ connectionString: u.toString() }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS "${name}"`); await c.query(`CREATE DATABASE "${name}"`); await c.end(); };
const run = async () => { await fresh(); return spawnSync(process.execPath, [path.join(repo, 'src/server/tests/customers.test.mjs')], { cwd: repo, encoding: 'utf8', env: process.env }); };
let bad = 0;
const base = await run(); if (base.status !== 0) { console.log('the test fails WITHOUT any mutation; fix it first\n' + (base.stdout + base.stderr).slice(-2000)); process.exit(1); }
for (const [name, file, from0, to0] of MUTATIONS) {
  const orig = readFileSync(file, 'utf8'), nl = orig.includes('\r\n') ? '\r\n' : '\n', from = from0.replace(/\n/g, nl), to = to0.replace(/\n/g, nl);
  if (orig.split(from).length !== 2) { console.log('CANNOT APPLY', name); bad++; continue; }
  writeFileSync(file, orig.replace(from, to));
  try { const r = await run(); const caught = r.status !== 0; if (!caught) bad++; console.log(caught ? 'CAUGHT ' : 'MISSED ', name); }
  finally { writeFileSync(file, orig); }
}
console.log(bad ? `${bad} mutation(s) not caught` : 'every mutation caught'); process.exit(bad ? 1 : 0);
