#!/usr/bin/env node
/**
 * Mutation check for src/server/tests/workforce-people.test.mjs: each mutation removes one access protection and the
 * suite MUST fail. Every mutated file is restored byte-for-byte afterwards; each run uses a fresh database.
 *
 *   PG_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres node scripts/workforce-people-mutation.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'), SERVER = join(ROOT, 'src', 'server');
const ADMIN = process.env.PG_ADMIN_URL;
if (!ADMIN) { console.error('PG_ADMIN_URL is required'); process.exit(2); }
const SVC = 'services/workforcePeople.js', MODES = 'services/modeApply.js';
const MUTATIONS = [
  ['a peer reads private fields', SVC, 'const mayReadPrivate = (ctx, byId, subjectId) => ctx.me.id === subjectId ||', 'const mayReadPrivate = (ctx, byId, subjectId) => true ||'],
  ['a manager does not see reports', SVC, "(ctx.me.kind === 'human' && chainAbove(byId, subjectId).includes(ctx.me.id))", 'false'],
  ['an agent edits HR data', SVC, "  if (ctx.me.kind !== 'human') fail('A person makes changes", "  if (false) fail('A person makes changes"],
  ['a person gives themself a title', SVC, '&& !ctx.admin) fail(\'Only a workspace admin changes title', "&& false) fail('Only a workspace admin changes title"],
  ['a peer edits someone else', SVC, '&& !self && !ctx.admin) fail(', '&& false) fail('],
  ['a non-admin onboards', SVC, "    if (!ctx.admin) fail('A person who administers this workspace starts onboarding'", "    if (false) fail('A person who administers this workspace starts onboarding'"],
  ['a reporting loop is allowed', SVC, 'if (m && chainAbove(byId, m).includes(x.id)) fail(', 'if (false) fail('],
  ['offboarding leaves access', SVC, '  if (plan.removesAccess) removal =', '  if (false) removal ='],
  ['over the agent limit applies half a company', MODES, "    if (now.plan.conflicts.some((c) => c.startsWith('agents:'))) fail(", '    if (false) fail('],
];
const admin = (sql) => spawnSync(process.execPath, ['-e', `const pg=require('pg');const c=new pg.Client(${JSON.stringify(ADMIN)});c.connect().then(()=>c.query(${JSON.stringify(sql)})).then(()=>c.end()).catch(e=>{console.error(e.message);process.exit(1)})`], { cwd: ROOT, encoding: 'utf8' });
let bad = 0;
for (const [name, file, from, to] of MUTATIONS) {
  const path = join(SERVER, file), orig = readFileSync(path, 'utf8');
  const lf = orig.replace(/\r\n/g, '\n');
  if (!lf.includes(from)) { console.log(`MISSING  ${name}`); bad++; continue; }
  const db = `ppmut_${Date.now() % 1e8}`;
  try {
    writeFileSync(path, lf.replace(from, to));
    admin(`DROP DATABASE IF EXISTS ${db}`); admin(`CREATE DATABASE ${db}`);
    const url = ADMIN.replace(/\/[^/]*$/, `/${db}`);
    const r = spawnSync(process.execPath, [join(SERVER, 'tests', 'workforce-people.test.mjs')], { cwd: ROOT, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
    if (r.status === 0) { console.log(`SURVIVED ${name}`); bad++; } else console.log(`killed   ${name}`);
  } finally { writeFileSync(path, orig); admin(`DROP DATABASE IF EXISTS ${db}`); }
}
console.log(bad ? `${bad} mutation(s) not caught` : 'every mutation caught');
process.exit(bad ? 1 : 0);
