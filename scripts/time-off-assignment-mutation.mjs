#!/usr/bin/env node
/**
 * Mutation check for src/server/tests/time-off-assignment.test.mjs: each mutation removes one access protection and the
 * suite MUST fail. Every mutated file is restored byte-for-byte afterwards; each run uses a fresh database.
 *
 *   PG_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres node scripts/time-off-assignment-mutation.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'), SERVER = join(ROOT, 'src', 'server');
const ADMIN = process.env.PG_ADMIN_URL;
if (!ADMIN) { console.error('PG_ADMIN_URL is required'); process.exit(2); }
const AV = 'services/workforceAvailability.js', TK = 'services/xenoTasks.js', RUN = 'services/agentCloudRuns.js';
const MUTATIONS = [
  ['time off is ignored', AV, '  if (!away) return { away: false };', '  return { away: false };'],
  ['an agent may override', AV, "if (override === true && actorKind === 'human')", 'if (override === true)'],
  ['create skips the check', TK, '  await assertNotAway(db, me, input.assigneeId, projectId, input.overrideAway);', ''],
  ['update skips the check', TK, '{ await assertAssignable(db, input.assigneeId, t.project_id); await assertNotAway(db, me, input.assigneeId, t.project_id, input.overrideAway); }', '{ await assertAssignable(db, input.assigneeId, t.project_id); }'],
  ['delegate skips the check', TK, '  await assertNotAway(db, me, agentId, t.project_id, overrideAway);', ''],
  ['a run skips the check', RUN, 'override: overrideAway === true, name:', 'override: true, name:'],
];
const admin = (sql) => spawnSync(process.execPath, ['-e', `const pg=require('pg');const c=new pg.Client(${JSON.stringify(ADMIN)});c.connect().then(()=>c.query(${JSON.stringify(sql)})).then(()=>c.end()).catch(e=>{console.error(e.message);process.exit(1)})`], { cwd: ROOT, encoding: 'utf8' });
let bad = 0;
for (const [name, file, from, to] of MUTATIONS) {
  const path = join(SERVER, file), orig = readFileSync(path, 'utf8');
  const lf = orig.replace(/\r\n/g, '\n');
  if (!lf.includes(from)) { console.log(`MISSING  ${name}`); bad++; continue; }
  const db = `tomut_${Date.now() % 1e8}`;
  try {
    writeFileSync(path, lf.replace(from, to));
    admin(`DROP DATABASE IF EXISTS ${db}`); admin(`CREATE DATABASE ${db}`);
    const url = ADMIN.replace(/\/[^/]*$/, `/${db}`);
    const r = spawnSync(process.execPath, [join(SERVER, 'tests', 'time-off-assignment.test.mjs')], { cwd: ROOT, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
    if (r.status === 0) { console.log(`SURVIVED ${name}`); bad++; } else console.log(`killed   ${name}`);
  } finally { writeFileSync(path, orig); admin(`DROP DATABASE IF EXISTS ${db}`); }
}
console.log(bad ? `${bad} mutation(s) not caught` : 'every mutation caught');
process.exit(bad ? 1 : 0);
