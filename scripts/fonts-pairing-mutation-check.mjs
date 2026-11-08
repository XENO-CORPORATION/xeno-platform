// Mutation check for AI font pairing (services/fonts.js suggestPairings/readPairing): take each protection away and prove
// src/server/tests/fonts.test.mjs then fails. Needs DATABASE_URL = a disposable database.
//   node scripts/fonts-pairing-mutation-check.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import pg from '../src/server/node_modules/pg/lib/index.js';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), SVC = path.join(repo, 'src/server/services/fonts.js');
const MUTATIONS = [
  ['a font outside the catalogue is passed through', "    if (!f || f.id === forId || seen.has(f.id)) continue;", "    if (!p || f?.id === forId || seen.has(p.id)) continue;"],
  ['the family may be paired with itself', "    if (!f || f.id === forId || seen.has(f.id)) continue;", "    if (!f || seen.has(f.id)) continue;"],
  ['there is no cap', "    if (out.length >= PAIRING_LIMITS.pairs) break;", ""],
  ['anyone may ask in any workspace', "  const ctx = await scope(db, actor, workspace, 'viewer');\n  const f = familyById(String(family || ''));", "  const ctx = { workspaceId: workspace };\n  const f = familyById(String(family || ''));"],
  ['an empty answer is a success', "  if (!out.length) throw new FontError('No pairing from the catalogue came back — try again', 'pairing_empty', 502);", ""],
];
const url = process.env.DATABASE_URL; if (!url) throw new Error('DATABASE_URL is required');
const fresh = async () => { const u = new URL(url), name = u.pathname.slice(1); u.pathname = '/postgres'; const c = new pg.Client({ connectionString: u.toString() }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS "${name}"`); await c.query(`CREATE DATABASE "${name}"`); await c.end(); };
const run = async () => { await fresh(); return spawnSync(process.execPath, [path.join(repo, 'src/server/tests/fonts.test.mjs')], { cwd: repo, encoding: 'utf8', env: process.env }); };
let bad = 0;
const base = await run(); if (base.status !== 0) { console.log('the test fails WITHOUT any mutation; fix it first\n' + (base.stdout + base.stderr).slice(-2000)); process.exit(1); }
for (const [name, from0, to0] of MUTATIONS) {
  const orig = readFileSync(SVC, 'utf8'), nl = orig.includes('\r\n') ? '\r\n' : '\n', from = from0.replace(/\n/g, nl), to = to0.replace(/\n/g, nl);
  if (orig.split(from).length !== 2) { console.log('CANNOT APPLY', name); bad++; continue; }
  writeFileSync(SVC, orig.replace(from, to));
  try { const r = await run(); const caught = r.status !== 0; if (!caught) bad++; console.log(caught ? 'CAUGHT ' : 'MISSED ', name); }
  finally { writeFileSync(SVC, orig); }
}
console.log(bad ? `${bad} mutation(s) not caught` : 'every mutation caught'); process.exit(bad ? 1 : 0);
