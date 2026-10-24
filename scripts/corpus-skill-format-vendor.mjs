#!/usr/bin/env node
/**
 * XENO Corpus's skill format is vendored here, byte for byte — this is the gate that keeps it that way.
 *
 * The skill record (bundle digest, file manifest, sidecar and revision rules) is OWNED by xeno-corpus
 * (`corpus-skill-format.mjs`, D235–D240). The platform hosts skills and must compute the SAME digest, so it runs
 * Corpus's code, not a copy of its rules: `src/server/vendor/xeno-corpus/` + `SOURCE.json` (commit, git blob id, sha256).
 *
 *   node scripts/corpus-skill-format-vendor.mjs                  # check (read-only; exits 1 on drift)
 *   node scripts/corpus-skill-format-vendor.mjs --sync           # DRY-RUN: what a sync from a xeno-corpus checkout would change
 *   node scripts/corpus-skill-format-vendor.mjs --sync --confirm --commit <sha>   # copy that commit's file, rewrite SOURCE.json
 *   node scripts/corpus-skill-format-vendor.mjs --self-test      # prove the check can fail
 *
 * The check refuses: bytes that differ from SOURCE.json's sha256; a git blob id that differs (the same bytes git
 * stored at that commit); and a module that imports anything but node:crypto or reaches for fs/eval/dynamic import —
 * the property that makes it safe to vendor at all.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'src/server/vendor/xeno-corpus');
const MANIFEST = join(VENDOR, 'SOURCE.json');
// every vendored Corpus file: the format (D240) and the secret-gate rules (D236). Each is pinned on its own.
const FILES = ['corpus-skill-format.mjs', 'corpus-secret-rules.mjs'];

const lf = (buf) => Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const gitBlob = (buf) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');

/** Pure: problems with these bytes against the pinned record. */
export function problemsOf(bytes, pin, FILE = FILES[0]) {
  const b = lf(bytes), out = [];
  if (sha256(b) !== pin.sha256) out.push(`${FILE}: sha256 ${sha256(b)} is not the pinned ${pin.sha256} — edit xeno-corpus, never the vendored copy`);
  if (gitBlob(b) !== pin.blob) out.push(`${FILE}: git blob ${gitBlob(b)} is not the pinned ${pin.blob}`);
  const src = b.toString('utf8');
  const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  if (imports.some((m) => m !== 'node:crypto')) out.push(`${FILE}: imports ${imports.join(', ')} — only node:crypto keeps it pure`);
  if (/\bimport\s*\(|\beval\s*\(|new\s+Function\b|require\s*\(|node:fs|["']fs["']/.test(src)) out.push(`${FILE}: reaches for fs, eval, require or dynamic import`);
  return out;
}

function check() {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  return FILES.flatMap((FILE) => {
    const p = join(VENDOR, FILE);
    if (!existsSync(p)) return [`${FILE} is missing`];
    if (!m.files[FILE]) return [`${FILE} has no pin in SOURCE.json`];
    return problemsOf(readFileSync(p), m.files[FILE], FILE);
  });
}

function findCorpus() {
  if (process.env.XENO_CORPUS_DIR) return process.env.XENO_CORPUS_DIR;
  for (let d = ROOT; ; d = dirname(d)) { const c = join(d, 'xeno-corpus'); if (existsSync(join(c, FILES[0]))) return c; if (dirname(d) === d) return null; }
}

function selfTest() {
  const FILE = FILES[0], bytes = readFileSync(join(VENDOR, FILE)), pin = JSON.parse(readFileSync(MANIFEST, 'utf8')).files[FILE];
  const cases = [
    ['a changed byte', Buffer.concat([bytes, Buffer.from('\n')])],
    ['an fs import', Buffer.from(bytes.toString('utf8').replace('import { createHash } from "node:crypto";', 'import { createHash } from "node:crypto";\nimport fs from "node:fs";'))],
  ];
  let ok = problemsOf(bytes, pin).length === 0;
  console.log(ok ? 'ok   the vendored file passes' : 'FAIL the vendored file does not pass');
  for (const [name, b] of cases) { const caught = problemsOf(b, pin).length > 0; console.log(`${caught ? 'ok  ' : 'FAIL'} ${name} is caught`); ok = ok && caught; }
  const rules = readFileSync(join(VENDOR, FILES[1])), rpin = JSON.parse(readFileSync(MANIFEST, 'utf8')).files[FILES[1]];
  const r1 = problemsOf(rules, rpin, FILES[1]).length === 0, r2 = problemsOf(Buffer.concat([rules, Buffer.from('//x\n')]), rpin, FILES[1]).length > 0;
  console.log(`${r1 && r2 ? 'ok  ' : 'FAIL'} the secret rules pass, and a changed byte in them is caught`); ok = ok && r1 && r2;
  const pure = problemsOf(Buffer.from('import x from "node:fs";\n'), { sha256: 'x', blob: 'x' }).some((s) => /only node:crypto/.test(s));
  console.log(`${pure ? 'ok  ' : 'FAIL'} a non-crypto import is named`); ok = ok && pure;
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
  for (const g of got) console.log(`${g.FILE} @ ${commit}: blob ${g.pin.blob}, sha256 ${g.pin.sha256}`);
  if (!args.includes('--confirm')) { console.log('DRY-RUN: pass --confirm to write it'); process.exit(0); }
  for (const g of got) writeFileSync(join(VENDOR, g.FILE), g.bytes);
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8')); m.commit = execFileSync('git', ['-C', dir, 'rev-parse', commit]).toString().trim(); for (const g of got) m.files[g.FILE] = g.pin;
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
  console.log('written');
} else {
  const bad = check();
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  console.log(`corpus-skill-format + corpus-secret-rules: vendored byte-identical (${JSON.parse(readFileSync(MANIFEST, 'utf8')).commit.slice(0, 7)})`);
}
