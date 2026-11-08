// Mutation check for prototypes/xeno-workspace/tests/products-live-test.mjs: remove each piece the test relies on and
// prove the test then fails. A test that still passes with the behaviour gone proves nothing.
//   node scripts/products-live-mutation-check.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(repo, 'prototypes/xeno-workspace/app.js'), DATA = path.join(repo, 'prototypes/xeno-workspace/data.js');
const MUTATIONS = [
  ['opening a product ignores its area', APP, "if (pg && (window.XENO_ZONE_LIVE || {})[pg[0] + '.' + pg[1]]) return go('zone'", "if (false) return go('zone'"],
  ['an old product address ignores its area', APP, "if (pg && (window.XENO_ZONE_LIVE || {})[pg[0] + '.' + pg[1]]) return { view: 'zone'", "if (false) return { view: 'zone'"],
  ['Fonts goes back to "soon"', DATA, "P('fonts', 'Fonts', { kind: 'web'", "P('fonts', 'Fonts', { status: 'soon', kind: 'web'"],
  ['CRM goes back to "soon"', DATA, "P('crm', 'CRM', { icon: null, code: 'Cr', kind: 'web'", "P('crm', 'CRM', { icon: null, code: 'Cr', status: 'soon', kind: 'web'"],
  ['Support Desk is called live', DATA, "P('desk', 'Support Desk', { icon: null, code: 'Sd', status: 'soon',", "P('desk', 'Support Desk', { icon: null, code: 'Sd',"],
];
const run = () => spawnSync(process.execPath, [path.join(repo, 'prototypes/xeno-workspace/tests/products-live-test.mjs')], { cwd: repo, encoding: 'utf8' });
let bad = 0;
const base = run(); if (base.status !== 0) { console.log('the test fails WITHOUT any mutation; fix it first\n' + base.stdout.slice(-2000)); process.exit(1); }
for (const [name, file, from, to] of MUTATIONS) {
  const orig = readFileSync(file, 'utf8');
  if (orig.split(from).length !== 2) { console.log('CANNOT APPLY', name); bad++; continue; }
  writeFileSync(file, orig.replace(from, to));
  try { const r = run(); const caught = r.status !== 0; if (!caught) bad++; console.log(caught ? 'CAUGHT ' : 'MISSED ', name); }
  finally { writeFileSync(file, orig); }
}
console.log(bad ? `${bad} mutation(s) not caught` : 'every mutation caught'); process.exit(bad ? 1 : 0);
