// storage-host-mutation-check — proves storage-host-test can FAIL: each mutation removes one piece of the Storage host,
// rebuilds (the test reads the production build, dist/), runs the test, and requires it to fail; each file is restored
// byte for byte afterwards, pass or fail, and the build is made again from the restored sources at the end.
//   node prototypes/xeno-workspace/tests/storage-host-mutation-check.mjs     (about 3 minutes a mutation: one build each)
import { readFileSync, writeFileSync } from 'node:fs'; import { spawnSync } from 'node:child_process'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), ws = path.resolve(here, '..'), repo = path.resolve(here, '../../..');
const MUTANTS = [
  ['the host is not read as the Storage host', path.join(ws, 'address.js'), '/^(tasks|chat|storage)\\.(xenosystem', '/^(tasks|chat|storageX)\\.(xenosystem'],
  ['Storage is not the host\'s product', path.join(ws, 'address.js'), "storage: [['', 'p', 'storage']],", ''],
  ['Storage\'s places keep the workspace\'s item form', path.join(ws, 'address.js'), "storage: (it) => (STORAGE_VIEWS.includes(it) ? it.toLowerCase() : it.replace(/^f\\//, 'folders/').replace(/^t\\//, 'teams/')),", 'storage: (it) => it,'],
  ['the rail carries the workspace\'s areas, not Storage\'s places', path.join(ws, 'app.js'), "    storage: [['data-xl-new=\"storage\"', 'upload', 'Upload']", "    storageX: [['data-xl-new=\"storage\"', 'upload', 'Upload']"],
  ['the sidebar shows the workspace path', path.join(ws, 'app.js'), 'const onHost = window.XENO_ADDR?.product === id;', 'const onHost = false;'],
  ['Upload on the rail does nothing', path.join(ws, 'platform-storage.js'), ", #rail [data-xl-new=\"storage\"]'", "'"],
  ['the host page has no upload panel', path.join(repo, 'scripts', 'vite-workspace.mjs'), "'pages-data.js', 'platform-work.js', 'platform-storage-uploads.js', 'platform-storage.js'", "'pages-data.js', 'platform-work.js', 'platform-storage.js'"],
];
const build = () => spawnSync('npx', ['vite', 'build'], { cwd: repo, encoding: 'utf8', shell: true, timeout: 600000 });
let caught = 0;
try {
  for (const [name, file, from, to] of MUTANTS) {
    const orig = readFileSync(file), text = orig.toString('utf8');
    if (!text.includes(from)) { console.log('ANCHOR MISSING', name); process.exitCode = 1; continue; }
    try {
      writeFileSync(file, text.replace(from, to));
      const b = build();
      if (b.status !== 0) { caught++; console.log('CAUGHT', name, '· the build refused it'); continue; }
      const r = spawnSync(process.execPath, [path.join(here, 'storage-host-test.mjs')], { encoding: 'utf8', timeout: 600000 });
      const fails = (r.stdout.match(/^FAIL .*/gm) || []);
      if (r.status !== 0 && (fails.length || /Error/.test(r.stderr))) { caught++; console.log('CAUGHT', name, '·', (fails[0] || r.stderr.split('\n').find((l) => /Error/.test(l)) || '').slice(0, 140)); } else { console.log('MISSED', name); process.exitCode = 1; }
    } finally { writeFileSync(file, orig); }
  }
} finally {
  const b = build(); console.log(b.status === 0 ? 'rebuilt from the restored sources' : 'REBUILD FAILED');
  const control = spawnSync(process.execPath, [path.join(here, 'storage-host-test.mjs')], { encoding: 'utf8', timeout: 600000 });
  console.log(control.status === 0 ? 'control (restored) passes' : 'CONTROL FAILED'); if (control.status !== 0) process.exitCode = 1;
}
console.log(`${caught} of ${MUTANTS.length} mutations caught`);
