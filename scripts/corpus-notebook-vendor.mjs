#!/usr/bin/env node
/**
 * XENO Corpus's notebook engine is vendored here, byte for byte. This is the gate that keeps it that way.
 *
 * A chat project's notebook (sources → passages → ranked retrieval → citations) runs Corpus's own code
 * (`corpus-notebook.mjs`, its ranker `corpus-rank.mjs` and the Porter stemmer Corpus vendors), never a platform
 * re-implementation: `src/server/vendor/xeno-corpus-notebook/` + `SOURCE.json` (commit, git blob id, sha256 per file).
 * It is pinned separately from the skill format (`src/server/vendor/xeno-corpus/`) because the two move on their own.
 *
 *   node scripts/corpus-notebook-vendor.mjs                  # check (read-only; exits 1 on drift)
 *   node scripts/corpus-notebook-vendor.mjs --sync --commit <sha>             # DRY-RUN from a xeno-corpus checkout
 *   node scripts/corpus-notebook-vendor.mjs --sync --commit <sha> --confirm   # copy that commit's files, rewrite SOURCE.json
 *   node scripts/corpus-notebook-vendor.mjs --self-test      # prove the check can fail
 *
 * The check refuses: bytes that differ from the pinned sha256; a git blob id that differs (the bytes git stored at that
 * commit); a module that imports anything but node:crypto or another vendored file; and a module that reaches for fs,
 * eval, require or dynamic import. Purity is what makes it safe to run inside the backend at all.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'src/server/vendor/xeno-corpus-notebook');
const MANIFEST = join(VENDOR, 'SOURCE.json');
// path inside xeno-corpus = path inside the vendor folder, so the modules' relative imports resolve unchanged
export const FILES = ['corpus-notebook.mjs', 'corpus-rank.mjs', 'vendor/porter-stemmer/index.mjs', 'vendor/porter-stemmer/LICENSE'];
const MODULES = FILES.filter((f) => f.endsWith('.mjs'));

const lf = (buf) => Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const gitBlob = (buf) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');

/** Pure: what a module may import. node:crypto, or another vendored module by a relative path. */
export function importProblems(src, FILE) {
  const out = [];
  const specs = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  for (const s of specs) {
    if (s === 'node:crypto') continue;
    if (s.startsWith('./') || s.startsWith('../')) {
      const target = posix.normalize(posix.join(posix.dirname(FILE), s));
      if (MODULES.includes(target)) continue;
      out.push(`${FILE}: imports ${s}, which is not a vendored file`);
      continue;
    }
    out.push(`${FILE}: imports ${s}: only node:crypto and the vendored files keep it pure`);
  }
  if (/\bimport\s*\(|\beval\s*\(|new\s+Function\b|\brequire\s*\(|node:fs|["']fs["']|node:child_process/.test(src)) out.push(`${FILE}: reaches for fs, eval, require, a child process or dynamic import`);
  return out;
}

/** Pure: problems with these bytes against the pinned record. */
export function problemsOf(bytes, pin, FILE) {
  const b = lf(bytes), out = [];
  if (sha256(b) !== pin.sha256) out.push(`${FILE}: sha256 ${sha256(b)} is not the pinned ${pin.sha256}. Edit xeno-corpus, never the vendored copy`);
  if (gitBlob(b) !== pin.blob) out.push(`${FILE}: git blob ${gitBlob(b)} is not the pinned ${pin.blob}`);
  if (FILE.endsWith('.mjs')) out.push(...importProblems(b.toString('utf8'), FILE));
  return out;
}

export function check() {
  if (!existsSync(MANIFEST)) return ['SOURCE.json is missing'];
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const extra = Object.keys(m.files || {}).filter((f) => !FILES.includes(f)).map((f) => `SOURCE.json pins ${f}, which this gate does not know`);
  return [...extra, ...FILES.flatMap((FILE) => {
    const p = join(VENDOR, FILE);
    if (!existsSync(p)) return [`${FILE} is missing`];
    if (!m.files?.[FILE]) return [`${FILE} has no pin in SOURCE.json`];
    return problemsOf(readFileSync(p), m.files[FILE], FILE);
  })];
}

function findCorpus() {
  if (process.env.XENO_CORPUS_DIR) return process.env.XENO_CORPUS_DIR;
  for (let d = ROOT; ; d = dirname(d)) { const c = join(d, 'xeno-corpus'); if (existsSync(join(c, '.git'))) return c; if (dirname(d) === d) return null; }
}

function selfTest() {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  let ok = check().length === 0;
  console.log(ok ? 'ok   the vendored files pass' : `FAIL the vendored files do not pass: ${check().join(' | ')}`);
  const nb = readFileSync(join(VENDOR, FILES[0])).toString('utf8');
  const cases = [
    ['a changed byte in the notebook', FILES[0], Buffer.from(nb + '\n')],
    ['a changed byte in the stemmer', FILES[2], Buffer.concat([readFileSync(join(VENDOR, FILES[2])), Buffer.from('//x\n')])],
    ['a changed byte in the licence', FILES[3], Buffer.concat([readFileSync(join(VENDOR, FILES[3])), Buffer.from('x')])],
  ];
  for (const [name, FILE, b] of cases) { const caught = problemsOf(b, m.files[FILE], FILE).length > 0; console.log(`${caught ? 'ok  ' : 'FAIL'} ${name} is caught`); ok = ok && caught; }
  const imp = [
    ['an fs import', 'import fs from "node:fs";\n', /only node:crypto/],
    ['a dynamic import', 'const x = await import("./corpus-rank.mjs");\n', /dynamic import/],
    ['a relative import of a file that is not vendored', 'import x from "./corpus-store.mjs";\n', /not a vendored file/],
    ['an npm package', 'import x from "stemmer";\n', /only node:crypto/],
  ];
  for (const [name, src, re] of imp) { const caught = importProblems(src, FILES[0]).some((s) => re.test(s)); console.log(`${caught ? 'ok  ' : 'FAIL'} ${name} is refused`); ok = ok && caught; }
  const fine = importProblems('import { stemmer } from "./vendor/porter-stemmer/index.mjs";\nimport { createHash } from "node:crypto";\n', FILES[1]).length === 0;
  console.log(`${fine ? 'ok  ' : 'FAIL'} node:crypto and a vendored file are allowed`); ok = ok && fine;
  process.exit(ok ? 0 : 1);
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();
else if (args.includes('--sync')) {
  const dir = findCorpus(); const ci = args.indexOf('--commit'); const commit = ci >= 0 ? args[ci + 1] : null;
  if (!dir || !commit) { console.error('--sync needs a xeno-corpus checkout (XENO_CORPUS_DIR) and --commit <sha>'); process.exit(2); }
  const got = FILES.map((FILE) => { const bytes = lf(execFileSync('git', ['-C', dir, 'show', `${commit}:${FILE}`])); return { FILE, bytes, pin: { blob: gitBlob(bytes), sha256: sha256(bytes) } }; });
  const bad = got.flatMap((g) => problemsOf(g.bytes, g.pin, g.FILE));
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  const full = execFileSync('git', ['-C', dir, 'rev-parse', commit]).toString().trim();
  for (const g of got) console.log(`${g.FILE} @ ${full.slice(0, 7)}: blob ${g.pin.blob}, sha256 ${g.pin.sha256}`);
  if (!args.includes('--confirm')) { console.log('DRY-RUN: pass --confirm to write it'); process.exit(0); }
  for (const g of got) { const to = join(VENDOR, g.FILE); mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, g.bytes); }
  const m = {
    owner: 'xeno-corpus',
    repo: 'XENO-CORPORATION/xeno-corpus',
    commit: full,
    note: 'Vendored byte-identical: the chat notebook runs Corpus\'s own engine. Never edit here: change xeno-corpus, then run scripts/corpus-notebook-vendor.mjs --sync --commit <sha> --confirm.',
    files: Object.fromEntries(got.map((g) => [g.FILE, g.pin])),
  };
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
  console.log('written');
} else {
  const bad = check();
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  console.log(`corpus notebook engine: vendored byte-identical (${JSON.parse(readFileSync(MANIFEST, 'utf8')).commit.slice(0, 7)}, ${FILES.length} files)`);
}
