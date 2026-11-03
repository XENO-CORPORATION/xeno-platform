// Every walk, one after the other, against a running real stack (start.mjs). Exits non-zero if any walk fails.
// Usage: node scripts/real-stack/start.mjs  (wait for READY)  then  npm run walk:real-stack
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const walks = ['walk-signup', 'walk-twostep', 'walk-forms', 'walk-providers', 'walk-market', 'walk-libraries'];
const only = process.argv[2];
let failed = 0;
for (const w of walks.filter((x) => !only || x.includes(only))) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(here, `${w}.mjs`)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lines = String(r.stdout + r.stderr).split('\n').filter((l) => /^(PASS|FAIL)/.test(l));
  const bad = lines.filter((l) => l.startsWith('FAIL'));
  if (r.status !== 0) failed += 1;
  console.log(`${r.status === 0 ? 'PASS' : 'FAIL'} ${w}  ${lines.length - bad.length}/${lines.length} checks  ${Math.round((Date.now() - t) / 1000)}s`);
  for (const l of bad) console.log('     ' + l);
}
console.log(failed ? `${failed} walk(s) failed` : 'every walk passed');
process.exitCode = failed ? 1 : 0;
