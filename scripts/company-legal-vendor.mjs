#!/usr/bin/env node
/**
 * XENO Company's legal layer is vendored here as one built file; this is the gate that keeps it honest.
 *
 * `@xenosystem/company-legal` (xeno-company/packages/legal) OWNS the jurisdiction packs and the EN 16931 invoice core. It is
 * a private TypeScript package and the backend image copies only `src/server/`, so a bundle of it lives in
 * `src/server/vendor/xeno-company/company-legal.mjs`, with `SOURCE.json` saying where it came from. Never edit the bundle:
 * an invoice rule changes in xeno-company, then here with --sync.
 *
 *   node scripts/company-legal-vendor.mjs                 # check (default; read-only, exits 1 on drift)
 *   node scripts/company-legal-vendor.mjs --sync --confirm  # rebuild from xeno-company and rewrite SOURCE.json
 *   node scripts/company-legal-vendor.mjs --self-test     # prove the check can fail
 *
 * The check refuses a bundle whose bytes differ from SOURCE.json. With XENO_COMPANY_DIR set it also refuses sources that differ
 * from the ones it was built from; a checkout found by chance may be on any branch, so it proves nothing. Hashes are over
 * LF-normalised text, so a Windows checkout and git's blob agree.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'src/server/vendor/xeno-company');
const BUNDLE = join(VENDOR, 'company-legal.mjs');
const MANIFEST = join(VENDOR, 'SOURCE.json');
const hash = (text) => createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');

function findCompany() {
  if (process.env.XENO_COMPANY_DIR) return process.env.XENO_COMPANY_DIR;
  for (let dir = ROOT, i = 0; i < 4; i += 1, dir = dirname(dir)) {
    const candidate = join(dir, 'xeno-company', 'packages/legal/src');
    if (existsSync(candidate)) return join(dir, 'xeno-company');
  }
  return null;
}
function sourceHash(company) {
  const src = join(company, 'packages/legal/src');
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p); } else if (n.endsWith('.ts')) files.push(p); } };
  walk(src);
  return hash(files.map((f) => `${relative(src, f).replace(/\\/g, '/')}\n${hash(readFileSync(f, 'utf8'))}`).join('\n'));
}
async function sync(company) {
  const { build } = await import(pathToFileURL(join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
  const out = await build({ entryPoints: [join(company, 'packages/legal/src/index.ts')], bundle: true, format: 'esm', platform: 'node', target: 'node22', legalComments: 'none', write: false });
  const banner = '// GENERATED from xeno-company/packages/legal. Do not edit: change it there, then scripts/company-legal-vendor.mjs --sync --confirm.\n';
  const text = banner + out.outputFiles[0].text.replace(/\r\n/g, '\n');
  mkdirSync(VENDOR, { recursive: true });
  writeFileSync(BUNDLE, text);
  const commit = execFileSync('git', ['-C', company, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  writeFileSync(MANIFEST, `${JSON.stringify({ package: '@xenosystem/company-legal', repo: 'xeno-company', commit, sourceHash: sourceHash(company), bundleHash: hash(text) }, null, 2)}\n`);
  return { commit };
}
export function problems(company = process.env.XENO_COMPANY_DIR || null, read = readFileSync) {
  const out = [];
  let m;
  try { m = JSON.parse(read(MANIFEST, 'utf8')); } catch { return ['SOURCE.json is missing or unreadable']; }
  if (hash(read(BUNDLE, 'utf8')) !== m.bundleHash) out.push('company-legal.mjs differs from SOURCE.json: it was edited by hand. Change xeno-company, then --sync --confirm.');
  if (company && sourceHash(company) !== m.sourceHash) out.push('xeno-company/packages/legal changed since this bundle was built: run --sync --confirm.');
  return out;
}

const argv = process.argv.slice(2);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (argv.includes('--self-test')) {
    const tampered = (path, enc) => (path === BUNDLE ? `${readFileSync(path, enc)}// tampered\n` : readFileSync(path, enc));
    if (!problems(null, tampered).length) { console.error('FAIL: an edited bundle was not refused'); process.exit(1); }
    console.log('OK: an edited bundle is refused');
  } else if (argv.includes('--sync')) {
    const company = findCompany();
    if (!company) { console.error('xeno-company checkout not found (set XENO_COMPANY_DIR)'); process.exit(1); }
    if (!argv.includes('--confirm')) { console.log(`would rebuild from ${company}; add --confirm`); process.exit(0); }
    const { commit } = await sync(company);
    console.log(`vendored @xenosystem/company-legal at ${commit.slice(0, 8)}`);
  } else {
    const bad = problems();
    if (bad.length) { for (const p of bad) console.error(`FAIL: ${p}`); process.exit(1); }
    console.log('OK: the vendored company-legal matches SOURCE.json');
  }
}
