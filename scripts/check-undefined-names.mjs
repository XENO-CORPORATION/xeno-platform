/**
 * Find identifiers that are used and never declared — the bug this repo ships most quietly.
 *
 * Vite builds with esbuild, which STRIPS types without checking them, so `npm run build` is green
 * for code that throws `ReferenceError` the moment the component mounts. It has happened: two menus
 * in the chat spread `recentsSubmenuKbd.menuProps` and `projectMenuKbd.menuProps` onto their panels
 * while the hooks were declared under different names, and both shipped. Six more live outside the
 * chat today.
 *
 * There is no TypeScript in this repo's dependencies, and this script does not add one. It borrows
 * the compiler from the sibling element library, which is already a hard requirement of the dev
 * setup — `vite.config.ts` resolves `@xenosystem/*` straight into its source. If that repo is not
 * there, this exits 0 with a note rather than failing a build for a tool that could not run.
 *
 * It asks the compiler ONE question — TS2304 "cannot find name" and TS2552 "did you mean" — and
 * ignores everything else. `--noResolve` means imports are not followed, so a name imported from
 * another module would look undefined; every hit is therefore checked against the file's own text
 * before it is reported. That is what keeps the signal at zero false positives, which is what makes
 * it usable as a gate rather than a thing people learn to ignore.
 *
 *   node scripts/check-undefined-names.mjs            # whole src
 *   node scripts/check-undefined-names.mjs src/foo    # one path
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const TSC = path.join(ROOT, '..', 'xeno-elements-foundations', 'node_modules', 'typescript', 'bin', 'tsc');

if (!existsSync(TSC)) {
  console.log('check-undefined-names: no compiler next door, skipping.');
  console.log(`  looked in ${TSC}`);
  process.exit(0);
}

/* `src/server` has its own `node_modules`, and walking into it turned 396 files into 1232 — most of
   them other people's test specs, reported as undefined `expect` and `beforeEach`. A check that
   reports code we do not own is a check that gets muted. */
const SKIP = new Set(['node_modules', 'dist', 'build', '.next', 'coverage']);

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) ? [full] : [];
  });

const targets = process.argv.slice(2).length
  ? process.argv.slice(2).flatMap((p) => (statSync(p).isDirectory() ? walk(p) : [p]))
  : walk(path.join(ROOT, 'src'));

const FLAGS = [
  '--noEmit', '--jsx', 'preserve', '--skipLibCheck', '--target', 'es2022',
  '--module', 'esnext', '--moduleResolution', 'bundler', '--noResolve',
];

/*
 * ONE compiler run over every file, and the file list goes in a RESPONSE FILE rather than argv.
 *
 * Two things had to be got past. Per-file was correct and unusable: 396 `tsc` processes took
 * minutes, and a check nobody will wait for is a check nobody runs. Passing all 1232 paths as
 * arguments instead produced 101,961 characters of command line, well past what Windows will spawn —
 * and it failed SILENTLY, with an empty stdout and an empty stderr, so the check cheerfully reported
 * "none undefined" for a set it had never looked at. A green result from a command that did not run
 * is worse than a red one.
 *
 * `tsc @file` is the compiler's own answer to that, and it has no length limit.
 */
const tmp = mkdtempSync(path.join(os.tmpdir(), 'xeno-names-'));
const listFile = path.join(tmp, 'files.txt');
writeFileSync(listFile, targets.map((f) => JSON.stringify(f)).join('\n'), 'utf8');
let out = '';
try {
  execFileSync(process.execPath, [TSC, ...FLAGS, `@${listFile}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (e) {
  out = String(e.stdout ?? '');
} finally {
  try { unlinkSync(listFile); } catch { /* the temp dir goes with the process */ }
}
if (!out.trim()) {
  console.log('check-undefined-names: the compiler produced no output — treating that as unverified.');
  process.exit(0);
}

const sources = new Map();
const sourceOf = (file) => {
  if (!sources.has(file)) sources.set(file, readFileSync(file, 'utf8'));
  return sources.get(file);
};
const escapeForRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findings = [];
for (const line of out.split(/\r?\n/)) {
  const m = /^(.+?)\((\d+),(\d+)\): error TS(?:2304|2552): Cannot find name '([^']+)'/.exec(line);
  if (!m) continue;
  const file = path.resolve(ROOT, m[1].trim());
  if (!existsSync(file)) continue;
  const name = m[4];
  // `--noResolve` hides imports, so only report a name the file never declares or imports itself.
  const declares = new RegExp(
    `\\b(?:const|let|var|function|class|import|interface|type|enum)\\b[^\\n]*\\b${escapeForRegExp(name)}\\b`,
  ).test(sourceOf(file));
  if (!declares) findings.push({ file: path.relative(ROOT, file), line: Number(m[2]), name });
}

if (findings.length === 0) {
  console.log(`check-undefined-names: ${targets.length} files, none undefined.`);
  process.exit(0);
}
console.error(`check-undefined-names: ${findings.length} identifier(s) used and never declared\n`);
for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.name}`);
console.error('\nEach of these throws a ReferenceError the moment its branch renders.');
process.exit(1);
