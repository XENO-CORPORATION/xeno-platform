#!/usr/bin/env node
/**
 * Mutation check for src/server/tests/workspace-architect.test.mjs: each mutation removes one protection of the
 * workspace architect, and the suite MUST fail. A suite that still passes with a protection removed is not evidence.
 *
 *   PG_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres node scripts/workspace-architect-mutation.mjs
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
const SVC = 'services/workspaceArchitect.js', MODES = 'services/modeApply.js';
const MUTATIONS = [
  ['a file the caller cannot open is read', SVC, '|| !(await canView(db, actor, fileId))', ''],
  ['an element with an invented citation is kept', SVC, "return c.length && c.every((r) => refs.has(r)) ? c : null;", 'return c.length ? c : null;'],
  ['unknown fields of the answer survive', SVC, '  out.dropped = dropped;', '  Object.assign(out, raw, { mode: { ...raw.mode, ...out.mode }, tasks: out.tasks }); out.dropped = dropped;'],
  ['the model is given tools', SVC, 'messages, max_tokens: maxOutputTokens })', "messages, max_tokens: maxOutputTokens, tools: [{ type: 'function' }] })"],
  ['a re-run overwrites the person’s mode', SVC, 'mode: { ...mode, name: prior.live.name,', 'mode: { ...mode, name: mode.name,'],
  ['another workspace’s proposal is applied', SVC, 'WHERE id = $1 AND workspace_id = $2`, [proposalId, workspaceId]', 'WHERE id = $1 AND $2::uuid IS NOT NULL`, [proposalId, workspaceId]'],
  ['an agent may edit a proposal', SVC, '  humanOnly(p);\n  const cur =', '  const cur ='],
  ['the meter is skipped', SVC, 'await (options.meter || meterPremiumChat)(db, actor.id,', 'await (async (_d, _u, o) => ({ result: await o.run({ maxOutputTokens: 4000 }), creditsCharged: 0 }))(db, actor.id,'],
  ['an extending pack recreates the mode', MODES, "const extending = !!pack.extends && pack.extends === mode.id && live.length > 0;", 'const extending = false;'],
];

const admin = (sql) => spawnSync(process.execPath, ['-e', `const pg=require('pg');const c=new pg.Client(${JSON.stringify(ADMIN)});c.connect().then(()=>c.query(${JSON.stringify(sql)})).then(()=>c.end()).catch(e=>{console.error(e.message);process.exit(1)})`], { cwd: SERVER, encoding: 'utf8' });
let bad = 0;
for (const [name, file, from, to] of MUTATIONS) {
  const path = join(SERVER, file), orig = readFileSync(path, 'utf8');
  const lf = orig.replace(/\r\n/g, '\n');
  if (!lf.includes(from)) { console.log(`MISSING  ${name} — the mutation no longer matches ${file}`); bad++; continue; }
  const db = `wamut_${Date.now() % 1e8}`;
  try {
    writeFileSync(path, lf.replace(from, to));
    admin(`DROP DATABASE IF EXISTS ${db}`); admin(`CREATE DATABASE ${db}`);
    const url = ADMIN.replace(/\/[^/]*$/, `/${db}`);
    const r = spawnSync(process.execPath, ['tests/workspace-architect.test.mjs'], { cwd: SERVER, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 600000 });
    const failed = r.status !== 0;
    console.log(`${failed ? 'KILLED ' : 'SURVIVED'} ${name}`);
    if (!failed) bad++;
  } finally { writeFileSync(path, orig); admin(`DROP DATABASE IF EXISTS ${db}`); }
}
console.log(bad ? `${bad} mutation(s) survived` : 'every mutation was caught');
process.exit(bad ? 1 : 0);
