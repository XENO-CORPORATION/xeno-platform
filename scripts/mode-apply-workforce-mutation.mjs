#!/usr/bin/env node
/**
 * Mutation check for src/server/tests/mode-apply-workforce.test.mjs: each mutation removes one protection of the
 * workforce half of modeApply, and the suite MUST fail. A suite that still passes with a protection removed is not
 * evidence of that protection.
 *
 *   PG_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres node scripts/mode-apply-workforce-mutation.mjs
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
const WF = 'services/modeApplyWorkforce.js', MODES = 'services/modeApply.js', ARCH = 'services/workspaceArchitect.js';
const MUTATIONS = [
  ['revert archives a division a person renamed', WF, "if (Number(d.revision) !== Number(rec.revision)) return 'changed by a person';", ''],
  ['revert retires an agent a person edited', WF, "if (Number(a.revision) !== Number(rec.revision)) return 'changed by a person';", ''],
  ['revert deletes an objective a person changed', WF, "if (o.status !== 'open' || o.title !== rec.title || o.success_evidence !== rec.successEvidence) return 'changed by a person';", ''],
  ['revert leaves the Places layout changed', WF, "  if (rec.type === 'places') {\n    if (!rec.id) return null;", "  if (rec.type === 'places') {\n    return null;"],
  ['a team may name an agent not in the setup', WF, "out.teams.forEach((t) => t.agents.forEach((a) => ref(ak, a, 'agent')));", ''],
  ['a half-applied setup commits', MODES, "  j.connect = async () => j;", "  j.connect = async () => db.connect ? db : j;\n  j.query = (sql, a) => db.query(/^\\s*ROLLBACK\\s*$/i.test(sql) ? 'COMMIT' : sql, a);"],
  ['a task ignores its pack project', MODES, "let projectId = t.project ? projectsByKey[String(t.project)] : null;", 'let projectId = null;'],
  ['an agent may apply', MODES, "    humanOnly(p);\n    if (confirm !== true)", "    if (confirm !== true)"],
  ['the architect re-proposes what is already there', ARCH, "proposal.divisions.filter((d) => !liveDiv.has(d.name.toLowerCase()))", 'proposal.divisions'],
];

const admin = (sql) => spawnSync(process.execPath, ['-e', `const pg=require('pg');const c=new pg.Client(${JSON.stringify(ADMIN)});c.connect().then(()=>c.query(${JSON.stringify(sql)})).then(()=>c.end()).catch(e=>{console.error(e.message);process.exit(1)})`], { cwd: SERVER, encoding: 'utf8' });
let bad = 0;
for (const [name, file, from, to] of MUTATIONS) {
  const path = join(SERVER, file), orig = readFileSync(path, 'utf8');
  const lf = orig.replace(/\r\n/g, '\n');
  if (!lf.includes(from)) { console.log(`MISSING  ${name} — the mutation no longer matches ${file}`); bad++; continue; }
  const db = `mwmut_${Date.now() % 1e8}`;
  try {
    writeFileSync(path, lf.replace(from, to));
    admin(`DROP DATABASE IF EXISTS ${db}`); admin(`CREATE DATABASE ${db}`);
    const url = ADMIN.replace(/\/[^/]*$/, `/${db}`);
    const r = spawnSync(process.execPath, ['tests/mode-apply-workforce.test.mjs'], { cwd: SERVER, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 600000 });
    const failed = r.status !== 0;
    console.log(`${failed ? 'KILLED ' : 'SURVIVED'} ${name}`);
    if (!failed) bad++;
  } finally { writeFileSync(path, orig); admin(`DROP DATABASE IF EXISTS ${db}`); }
}
console.log(bad ? `${bad} mutation(s) survived` : 'every mutation was caught');
process.exit(bad ? 1 : 0);
