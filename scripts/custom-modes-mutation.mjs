#!/usr/bin/env node
/**
 * Mutation check for src/server/tests/custom-modes.test.mjs: each mutation removes one protection, and the suite
 * MUST fail. A suite that still passes with a protection removed is not evidence of that protection.
 *
 *   PG_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres node scripts/custom-modes-mutation.mjs
 *
 * Every mutated file is restored byte-for-byte afterwards (also on failure). Each run uses a fresh database.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'), SERVER = join(ROOT, 'src', 'server');
const ADMIN = process.env.PG_ADMIN_URL;
if (!ADMIN) { console.error('PG_ADMIN_URL is required'); process.exit(2); }
const SVC = 'services/modeApply.js', MIG = 'database/migrations/20261021090000-custom-modes.sql';
const MUTATIONS = [
  ['an agent may apply', SVC, "    humanOnly(p);\n    if (confirm !== true)", "    if (confirm !== true)"],
  ['apply needs no confirmation', SVC, "if (confirm !== true) fail(", "if (false) fail("],
  ['a stale plan is applied', SVC, "if (now.planHash !== planHash) fail(", "if (false) fail("],
  ['a retry applies again', SVC, '    if (prior) {', '    if (false) {'],
  ['revert deletes a person’s edit (mode)', SVC, 'if (m.edited_at) {', 'if (false) {'],
  ['revert deletes a person’s edit (task)', SVC, 'if (touched) {', 'if (false) {'],
  ['a community developer publishes a pack', MIG, "tier NOT IN ('verified','official')", 'false'],
  ['a pack depends on an unpublished version', MIG, 'AND v.version = md.depends_on_version AND v.published_at IS NOT NULL)) THEN', 'AND v.version = md.depends_on_version)) AND false THEN'],
];

const admin = (sql) => spawnSync(process.execPath, ['-e', `const pg=require('pg');const c=new pg.Client(${JSON.stringify(ADMIN)});c.connect().then(()=>c.query(${JSON.stringify(sql)})).then(()=>c.end()).catch(e=>{console.error(e.message);process.exit(1)})`], { cwd: SERVER, encoding: 'utf8' });
let bad = 0;
for (const [name, file, from, to] of MUTATIONS) {
  const path = join(SERVER, file), orig = readFileSync(path, 'utf8');
  const lf = orig.replace(/\r\n/g, '\n');
  if (!lf.includes(from)) { console.log(`MISSING  ${name} — the mutation no longer matches ${file}`); bad++; continue; }
  const db = `cmmut_${Date.now() % 1e8}`;
  try {
    writeFileSync(path, lf.replace(from, to));
    admin(`DROP DATABASE IF EXISTS ${db}`); admin(`CREATE DATABASE ${db}`);
    const url = ADMIN.replace(/\/[^/]*$/, `/${db}`);
    const r = spawnSync(process.execPath, ['tests/custom-modes.test.mjs'], { cwd: SERVER, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 600000 });
    const failed = r.status !== 0;
    console.log(`${failed ? 'KILLED ' : 'SURVIVED'} ${name}`);
    if (!failed) bad++;
  } finally { writeFileSync(path, orig); admin(`DROP DATABASE IF EXISTS ${db}`); }
}
console.log(bad ? `${bad} mutation(s) survived` : 'every mutation was caught');
process.exit(bad ? 1 : 0);
