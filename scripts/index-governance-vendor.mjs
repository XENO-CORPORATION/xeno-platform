#!/usr/bin/env node
/**
 * The XENO Index governance core is vendored here, byte for byte — this is the gate that keeps it that way.
 *
 * The release record's code is OWNED by xeno-index (`packages/index/src/governance/`, decision
 * xeno-index/docs/decisions/0001-release-governance-record.md). xeno-platform HOSTS it: the tables live in this
 * database, and the backend image copies only `src/server/`, so the code is vendored into
 * `src/server/vendor/xeno-index/governance/` with a manifest (`SOURCE.json`) of where it came from and each file's hash.
 *
 *   node scripts/index-governance-vendor.mjs                 # check (default; read-only, exits 1 on drift)
 *   node scripts/index-governance-vendor.mjs --sync          # DRY-RUN: show what a sync from xeno-index would change
 *   node scripts/index-governance-vendor.mjs --sync --confirm  # copy from xeno-index and rewrite SOURCE.json
 *   node scripts/index-governance-vendor.mjs --self-test     # prove the check can fail
 *
 * The check refuses:
 *   1. a vendored file whose bytes differ from SOURCE.json   — someone edited the host copy; edit xeno-index instead;
 *   2. a platform migration whose bytes differ from the Index schema hash — the tables must be the Index's schema;
 *   3. when the canonical checkout is present (XENO_INDEX_DIR, or a `xeno-index` found walking up), a vendored file
 *      that differs from it — the host is behind or ahead of its owner.
 * Hashes are over LF-normalised text, so a Windows CRLF checkout and git's LF blob agree.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'src/server/vendor/xeno-index/governance');
const MANIFEST = join(VENDOR, 'SOURCE.json');
const MIGRATIONS = join(ROOT, 'src/server/database/migrations');
const CODE = ['index.js', 'releaseRecord.js', 'releaseInternalNotes.js', 'releaseInternalNoteTemplate.js', 'releasesMcp.js'];
const SCHEMA = ['20261023100000-release-record.sql', '20261026090000-release-internal-notes.sql'];

export const hashText = (s) => createHash('sha256').update(String(s).replace(/\r\n/g, '\n')).digest('hex');
const hashFile = (p) => hashText(readFileSync(p, 'utf8'));

export function findIndex(start = ROOT, env = process.env) {
  if (env.XENO_INDEX_DIR) return existsSync(join(env.XENO_INDEX_DIR, 'packages/index/package.json')) ? env.XENO_INDEX_DIR : null;
  let d = start;
  for (;;) {
    const c = join(d, 'xeno-index');
    if (existsSync(join(c, 'packages/index/package.json'))) return c;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** Pure: compare what is on disk against the manifest and (optionally) the canonical source. Returns problems. */
export function compare({ manifest, vendored, migrations, canonical }) {
  const problems = [];
  for (const f of CODE) {
    if (vendored[f] == null) problems.push(`vendored ${f} is missing`);
    else if (manifest.files?.[f] !== vendored[f]) problems.push(`vendored ${f} differs from SOURCE.json — the host copy was edited; change xeno-index and re-sync`);
    if (canonical && canonical.files[f] !== vendored[f]) problems.push(`vendored ${f} differs from xeno-index — run --sync --confirm`);
  }
  for (const f of SCHEMA) {
    if (migrations[f] == null) problems.push(`migration ${f} is missing`);
    else if (manifest.schema?.[f] !== migrations[f]) problems.push(`migration ${f} differs from the Index schema in SOURCE.json`);
    if (canonical && canonical.schema[f] !== migrations[f]) problems.push(`migration ${f} differs from xeno-index/packages/index/schema/${f}`);
  }
  return problems;
}

const readTree = () => ({
  vendored: Object.fromEntries(CODE.map((f) => [f, existsSync(join(VENDOR, f)) ? hashFile(join(VENDOR, f)) : null])),
  migrations: Object.fromEntries(SCHEMA.map((f) => [f, existsSync(join(MIGRATIONS, f)) ? hashFile(join(MIGRATIONS, f)) : null])),
});
const readCanonical = (dir) => ({
  files: Object.fromEntries(CODE.map((f) => [f, hashFile(join(dir, 'packages/index/src/governance', f))])),
  schema: Object.fromEntries(SCHEMA.map((f) => [f, hashFile(join(dir, 'packages/index/schema', f))])),
});

function selfTest() {
  const h = 'a'.repeat(64);
  const files = Object.fromEntries(CODE.map((f) => [f, h])), schema = Object.fromEntries(SCHEMA.map((f) => [f, h]));
  const ok = compare({ manifest: { files, schema }, vendored: files, migrations: schema, canonical: { files, schema } });
  const edited = compare({ manifest: { files, schema }, vendored: { ...files, 'releaseRecord.js': 'b'.repeat(64) }, migrations: schema, canonical: null });
  const behind = compare({ manifest: { files, schema }, vendored: files, migrations: schema, canonical: { files: { ...files, 'releasesMcp.js': 'c'.repeat(64) }, schema } });
  const schemaDrift = compare({ manifest: { files, schema }, vendored: files, migrations: { ...schema, [SCHEMA[0]]: 'd'.repeat(64) }, canonical: null });
  const pass = ok.length === 0 && edited.length === 1 && behind.length === 1 && schemaDrift.length === 1 && hashText('a\r\nb') === hashText('a\nb');
  console.log(pass ? 'self-test: the check fails on an edited copy, a stale copy and a drifted schema' : 'self-test FAILED');
  process.exit(pass ? 0 : 1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();
  const indexDir = findIndex();
  if (argv.includes('--sync')) {
    if (!indexDir) { console.error('xeno-index not found — set XENO_INDEX_DIR to its checkout'); process.exit(2); }
    const src = join(indexDir, 'packages/index/src/governance');
    const changes = CODE.filter((f) => !existsSync(join(VENDOR, f)) || hashFile(join(VENDOR, f)) !== hashFile(join(src, f)));
    let commit = null;
    try { commit = execFileSync('git', ['-C', indexDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
    console.log(`${argv.includes('--confirm') ? 'SYNC' : 'DRY-RUN'} from ${indexDir} @ ${commit || 'unknown'}: ${changes.length ? changes.join(', ') : 'no code changes'}`);
    if (!argv.includes('--confirm')) return;
    mkdirSync(VENDOR, { recursive: true });
    for (const f of CODE) writeFileSync(join(VENDOR, f), readFileSync(join(src, f), 'utf8').replace(/\r\n/g, '\n'));
    const c = readCanonical(indexDir);
    writeFileSync(MANIFEST, JSON.stringify({
      owner: 'xeno-index', path: 'packages/index/src/governance', package: '@xenosystem/index/governance',
      decision: 'xeno-index/docs/decisions/0001-release-governance-record.md', commit,
      note: 'Vendored, byte-identical. Never edit these files here: change xeno-index and run scripts/index-governance-vendor.mjs --sync --confirm.',
      files: c.files, schema: c.schema,
    }, null, 2) + '\n');
    return;
  }
  if (!existsSync(MANIFEST)) { console.error('SOURCE.json missing — the vendored Index governance core is not present'); process.exit(1); }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const problems = compare({ manifest, ...readTree(), canonical: indexDir ? readCanonical(indexDir) : null });
  if (problems.length) { for (const p of problems) console.error(`FAIL: ${p}`); process.exit(1); }
  console.log(`index governance vendor: ${CODE.length} files + ${SCHEMA.length} schema files match SOURCE.json${indexDir ? ` and ${indexDir}` : ' (canonical checkout not present — checked against the manifest only)'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
