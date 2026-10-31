/**
 * Proves the XENO Research suite can FAIL: each mutation removes one protection from services/xenoResearch.js and
 * the real-Postgres suite (src/server/tests/xeno-research.test.mjs) must go red. A clean control must stay green.
 *
 *   DATABASE_URL=postgres://… node scripts/research-mutation-check.mjs
 *
 * The file is always restored, byte for byte, whatever happens.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'src/server/services/xenoResearch.js');
const TEST = join(ROOT, 'src/server/tests/xeno-research.test.mjs');
const MUTATIONS = [
  ['fail-closed gate: an unqualified Box runs anyone', "if (state !== 'qualified' && !inside) {", 'if (false) {'],
  ['fail-closed gate: no Box configuration still queues', "if (!c.configured) return {", 'if (false) return {'],
  ['tenant scoping: the project viewer check is skipped', "!(await allowed(db, who.accountable, `project:${pid}`, 'viewer'))) throw notFound('Project not found');", 'false) throw notFound(\'Project not found\');'],
  ['signature check: verify against the embedded key, not the platform key', 'e.verifyRecord({ ...r.provenance, signature: r.signature }, expected || undefined)', 'e.verifyRecord({ ...r.provenance, signature: r.signature })'],
  ['engine audience: every run is passed to the engine as XENO', 'audience: audienceFor(workspaceId, c)', "audience: 'xeno'"],
  ['concurrency cap removed', 'if (running >= MAX_CONCURRENT) {', 'if (false) {'],
];
const original = readFileSync(FILE, 'utf8');
const run = () => spawnSync(process.execPath, [TEST], { cwd: ROOT, env: process.env, encoding: 'utf8' });
let bad = 0;
try {
  const control = run();
  console.log(`${control.status === 0 ? 'ok  ' : 'FAIL'} control: the unmutated suite is green`);
  if (control.status !== 0) { bad++; console.log(control.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join('\n')); }
  for (const [name, from, to] of MUTATIONS) {
    if (!original.includes(from)) { bad++; console.log(`FAIL ${name}: the protected line is gone — update this check`); continue; }
    writeFileSync(FILE, original.replace(from, to));
    const r = run();
    const caught = r.status !== 0;
    if (!caught) bad++;
    console.log(`${caught ? 'ok  ' : 'FAIL'} ${name}: ${caught ? 'the suite fails' : 'the suite still PASSES — the protection is untested'}`);
    writeFileSync(FILE, original);
  }
} finally { writeFileSync(FILE, original); }
if (bad) process.exit(1);
