// Mutation check for prototypes/xeno-workspace/tests/freshness-test.mjs: take away each protection and prove the
// test then fails. A test that still passes with the behaviour gone proves nothing.
//   node scripts/freshness-mutation-check.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), W = (f) => path.join(repo, 'prototypes/xeno-workspace', f);
const MUTATIONS = [
  ['the status bar ignores what the page really fetched', W('pages.js'), 'const fresh = LIVE[fam] ? `', 'const fresh = false ? `'],
  ['Support reports every load as a success', W('platform-support.js'), "    H().fresh('support', { ok });", "    H().fresh('support', { ok: true });"],
  ['Tasks reports every load as a success', W('platform-tasks.js'), "H().fresh('tasks', { ok: good,", "H().fresh('tasks', { ok: true,"],
  ['a repaint never adds a missing footer', W('pages.js'), "if (pf.foot && !ft) {", "if (false) {"],
  ['a failed queue check turns staff into a customer again', W('platform-support.js'), "else if (q.status === 403 || q.status === 404) S.staff = false; else S.queue = { error: said(q, 'The queue did not load') }; } }", "else S.staff = false; } }"],
  ['a failed Deploys load shows an empty list', W('platform-releases.js'), "S.deploys = r.ok ? r.d.deploys || [] : failed(r, 'Deploys');", "S.deploys = r.ok ? r.d.deploys || [] : [];"],
];
const run = () => spawnSync(process.execPath, [W('tests/freshness-test.mjs')], { cwd: repo, encoding: 'utf8' });
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
