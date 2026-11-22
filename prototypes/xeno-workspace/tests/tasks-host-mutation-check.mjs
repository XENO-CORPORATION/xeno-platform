// tasks-host-mutation-check — proves tasks-host-test can FAIL: each mutation removes one piece of the Tasks host, runs
// the test, and requires it to fail; the file is restored byte for byte afterwards, pass or fail.
//   node prototypes/xeno-workspace/tests/tasks-host-mutation-check.mjs
import { readFileSync, writeFileSync } from 'node:fs'; import { spawnSync } from 'node:child_process'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), ws = path.resolve(here, '..'), repo = path.resolve(here, '../../..');
const MUTANTS = [
  ['the host is not read as the Tasks host', path.join(ws, 'address.js'), "/^(tasks)\\.(xenosystem\\.ai|xenostudio\\.ai|localhost)$/", "/^(tasksX)\\.(xenosystem\\.ai|xenostudio\\.ai|localhost)$/"],
  ['the product header is never drawn', path.join(ws, 'app.js'), '    renderProductHeader();', '    void 0;'],
  ['the workspace chrome is not hidden', path.join(ws, 'index.html'), 'html[data-product] .rail,html[data-product] .slot,html[data-product] .peekzone{display:none!important}', ''],
  ['the host serves every workspace script', path.join(repo, 'scripts', 'vite-workspace.mjs'), "const page = productPage(fs.readFileSync(path.join(src, 'index.html'), 'utf8'), 'tasks').html;", "const page = fs.readFileSync(path.join(src, 'index.html'), 'utf8').replace('<html lang=\"en\">', '<html lang=\"en\" data-product=\"tasks\">');"],
  ['the platform does not count the host as served', path.join(ws, 'platform.js'), '(product || /^\\/workspace(\\/|$)/.test(location.pathname))', '/^\\/workspace(\\/|$)/.test(location.pathname)'],
];
let caught = 0;
for (const [name, file, from, to] of MUTANTS) {
  const orig = readFileSync(file);
  const text = orig.toString('utf8');
  if (!text.includes(from)) { console.log('ANCHOR MISSING', name); process.exitCode = 1; continue; }
  try {
    writeFileSync(file, text.replace(from, to));
    const r = spawnSync(process.execPath, [path.join(here, 'tasks-host-test.mjs')], { encoding: 'utf8', timeout: 240000 });
    const fails = (r.stdout.match(/^FAIL .*/gm) || []);
    if (r.status !== 0 && fails.length) { caught++; console.log('CAUGHT', name, '·', fails[0]); } else { console.log('MISSED', name); process.exitCode = 1; }
  } finally { writeFileSync(file, orig); }
}
console.log(`${caught} of ${MUTANTS.length} mutations caught`);
