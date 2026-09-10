#!/usr/bin/env node
/**
 * Recover the LICENSE TEXT for a dependency that ships none in its tarball.
 *
 *   node scripts/recover-package-license.mjs <name> [options]          # propose, write nothing
 *   node scripts/recover-package-license.mjs <name> --write            # merge the record
 *
 * Some packages declare a licence in `package.json` and publish no licence file.
 * A declaration is metadata; what a distribution has to carry is the grant
 * itself, with its copyright line. So the text has to come from somewhere else,
 * and "somewhere else" is exactly where this goes wrong: pasting an SPDX
 * template produces a file that reads correctly, names the wrong copyright
 * holder, and is indistinguishable from real evidence afterwards.
 *
 * 🔴 THE BINDING IS THE WHOLE POINT. Text from a repository is only evidence for
 * a published artifact if the two are shown to be the same code. That is what
 * `runtimeProofs` are: files taken from the verified tarball whose bytes are
 * IDENTICAL to the same paths at one immutable commit. Without them, this would
 * be "a licence file exists in some repository that shares a name with this
 * package" — which is not a fact about what we ship.
 *
 * Consequently this refuses, rather than degrades, when:
 *   - the tarball's integrity does not match the lockfile
 *   - the manifest's declared licence differs from what the packet recorded
 *   - no tag resolves to a 40-hex commit (a branch name is not immutable)
 *   - NOT ONE runtime file matches the repository at that commit
 *   - no licence file is found at that commit
 *   - a record for this name@version already exists
 *
 * A refusal here is a finding, not a failure: it means the package needs a human
 * to look at it. `compliance/rights-review-packet.json` is where those go.
 * Widening a check to get a record written would defeat the only thing this
 * produces that a search engine could not.
 *
 * Dry-run by default (ABSOLUTE RULE §2b). `--write` merges and never replaces.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { verifyIntegrity, declaredManifestLicense } from './lib/npm-package-evidence.mjs';

// The backend's declared dependency, resolved the same way lib/npm-package-evidence.mjs
// resolves it — this repo's root does not declare tar-stream and should not start.
const { extract } = createRequire(new URL('../src/server/package.json', import.meta.url))('tar-stream');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const RECOVERED = 'compliance/recovered-package-licenses.json';
const LOCKFILES = ['package-lock.json', 'src/server/package-lock.json'];
const CACHE = path.join(os.tmpdir(), 'xeno-license-recovery');

const argv = process.argv.slice(2);
const NAME = argv.find((a) => !a.startsWith('--'));
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? undefined : argv[i + 1]; };
const WRITE = argv.includes('--write');
const VERIFY = argv.includes('--verify');
/** For a package published from a subdirectory of its repository. */
const REPO_PREFIX = (flag('repo-prefix') || '').replace(/^\/|\/$/g, '');
const REPO_OVERRIDE = flag('repo');
const TAG_OVERRIDE = flag('tag');
const COMMIT_OVERRIDE = flag('commit');
/** Required when a package is installed at more than one version. */
const VERSION = flag('version');

if (!NAME) {
  console.error('usage: node scripts/recover-package-license.mjs <name> [--repo owner/name] '
    + '[--version x.y.z] [--tag <tag> | --commit <40-hex>] [--repo-prefix <dir>] [--verify | --write]');
  process.exit(2);
}

/* A refusal is a normal outcome here, not a crash, so it unwinds instead of
 * calling process.exit(). Exiting with a fetch still in flight aborts libuv —
 * "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" — which replaces a
 * clean exit code and a one-line reason with a native crash dump and exit 127.
 * In a compliance tool that is worse than untidy: an operator cannot then tell
 * a deliberate refusal from a broken run. */
class Refusal extends Error {}
const die = (message) => { throw new Refusal(message); };
process.on('uncaughtException', (error) => {
  console.error(`
✗ ${NAME}: ${error instanceof Refusal ? error.message : error.stack}
`);
  process.exitCode = 1;
});

/* ── the artifact we actually ship ──────────────────────────────────────── */

/** Read name@version + integrity + resolved from the LOCKFILES, never from argv:
 *  the whole record is a claim about the bytes this repo installs. */
function lockedPackage(name) {
  const found = new Map();
  for (const lock of LOCKFILES) {
    const data = JSON.parse(readFileSync(lock, 'utf8'));
    for (const [key, item] of Object.entries(data.packages || {})) {
      if (!key.endsWith(`node_modules/${name}`)) continue;
      if (!item.resolved || !item.integrity) continue;
      if (VERSION && item.version !== VERSION) continue;
      found.set(`${item.version}|${item.integrity}`, { ...item, lock });
    }
  }
  if (found.size === 0) die('not present in either lockfile');
  if (found.size > 1) {
    die(`resolves to ${found.size} distinct artifacts (${[...found.values()].map((i) => i.version).join(', ')}). `
      + 'A record describes ONE set of bytes, so name which with --version <x.y.z>.');
  }
  return [...found.values()][0];
}

async function download(item, name) {
  const url = new URL(item.resolved);
  if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password) {
    die(`unapproved registry origin ${url.origin}`);
  }
  await mkdir(CACHE, { recursive: true });
  const cached = path.join(CACHE, `${sha256(item.integrity)}.tgz`);
  let bytes;
  try { bytes = await readFile(cached); } catch {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok) die(`registry HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(cached, bytes);
  }
  verifyIntegrity(bytes, item.integrity);   // throws on mismatch — never softened
  return bytes;
}

/** Every regular file in the tarball, keyed by its path WITHOUT the leading
 *  `package/` directory, which is the path the repository would use. */
async function readAll(bytes) {
  const unpacked = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 });
  const parser = extract();
  const files = new Map();
  await new Promise((resolve, reject) => {
    parser.on('error', reject);
    parser.on('finish', resolve);
    parser.on('entry', (header, stream, next) => {
      const name = header.name.replaceAll('\\', '/');
      const parts = name.split('/');
      const safe = parts.length >= 2 && parts.every((p) => p && p !== '..' && p !== '.') && !name.includes(':');
      const keep = header.type === 'file' && safe && header.size <= 4 * 1024 * 1024;
      const chunks = [];
      stream.on('data', (c) => { if (keep) chunks.push(c); });
      stream.on('error', reject);
      stream.on('end', () => {
        if (keep) files.set(parts.slice(1).join('/'), Buffer.concat(chunks));
        next();
      });
      stream.resume();
    });
    parser.end(unpacked);
  });
  return files;
}

/* ── the repository, at ONE immutable commit ────────────────────────────── */

function repositoryOf(manifest) {
  if (REPO_OVERRIDE) return REPO_OVERRIDE;
  const raw = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  if (!raw) die('the manifest names no repository — pass --repo owner/name after checking by hand');
  const m = String(raw).match(/github\.com[/:]([^/]+)\/([^/#.]+)/) || String(raw).match(/^(?:github:)?([\w.-]+)\/([\w.-]+)$/);
  if (!m) die(`cannot read a GitHub repository out of ${JSON.stringify(raw)} — pass --repo`);
  return `${m[1]}/${m[2].replace(/\.git$/, '')}`;
}

async function gh(url) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'xeno-license-recovery' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (response.status === 403 || response.status === 429) {
    die('GitHub rate-limited this run. Set GITHUB_TOKEN and try again — do NOT work around it by '
      + 'pasting licence text from memory.');
  }
  return response.ok ? response.json() : undefined;
}

/**
 * A TAG, dereferenced to a commit sha. A branch is not immutable and is refused.
 *
 * `--commit` exists because a great many small packages carry no tags at all,
 * and the pin is then something a HUMAN establishes — by reading the repository,
 * or by finding the commit whose tree matches the published files. Supplying it
 * skips only the LOOKUP: the byte-for-byte proof that the commit is the source
 * of these bytes still has to pass, so a wrong sha produces a refusal, not a
 * record. That is the property worth protecting; discovering the sha is not.
 */
async function resolveCommit(repo, version) {
  if (COMMIT_OVERRIDE) {
    if (!/^[a-f0-9]{40}$/.test(COMMIT_OVERRIDE)) die('--commit must be a full 40-hex sha; a short sha or a branch is not a pin');
    return { commit: COMMIT_OVERRIDE, tag: '(--commit)' };
  }
  const candidates = TAG_OVERRIDE ? [TAG_OVERRIDE] : [`v${version}`, version, `${NAME}@${version}`, `${NAME}-v${version}`];
  for (const tag of candidates) {
    const ref = await gh(`https://api.github.com/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`);
    if (!ref?.object) continue;
    if (ref.object.type === 'commit') return { commit: ref.object.sha, tag };
    const annotated = await gh(ref.object.url);           // annotated tag → its commit
    if (annotated?.object?.sha) return { commit: annotated.object.sha, tag };
  }
  die(`no tag resolves to a commit for ${version} (tried ${candidates.join(', ')}). `
    + 'Pass --tag, or --commit <40-hex> once a human has established the pin — a branch name is not one.');
}

async function raw(repo, commit, filePath) {
  const url = `https://raw.githubusercontent.com/${repo}/${commit}/${filePath}`;
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) return undefined;
  return { url, body: Buffer.from(await response.arrayBuffer()) };
}

/* ── run ────────────────────────────────────────────────────────────────── */

const store = JSON.parse(readFileSync(RECOVERED, 'utf8'));
const item = lockedPackage(NAME);
const existing = store.packages.find((p) => p.name === NAME && p.version === item.version);
/* --verify rebuilds a record that ALREADY exists and requires the result to
 * agree. It is how this tool's success path is proven at all: the two records in
 * the store were assembled by hand and are already accepted by the consuming
 * library, so reproducing one independently shows the builder agrees with real
 * evidence — rather than shipping a builder whose happy path has never run. */
if (existing && !VERIFY) {
  die(`a record for ${NAME}@${item.version} already exists — this tool never replaces one. `
    + 'Use --verify to check that it reproduces, or delete it deliberately first if it is wrong.');
}
if (VERIFY && !existing) die('--verify needs an existing record to reproduce, and there is none');

console.log(`${NAME}@${item.version}  (${item.lock})`);
const bytes = await download(item, NAME);
const files = await readAll(bytes);
const manifest = JSON.parse(files.get('package.json')?.toString('utf8') ?? die('no root manifest in the tarball'));
if (manifest.name !== NAME || manifest.version !== item.version) die('the tarball is a different package than the lockfile names');

const license = declaredManifestLicense(manifest);
if (!license) die('the manifest declares no licence at all — that is a different problem, and a human one');

/* In --verify the pin comes from the record being reproduced. Re-discovering it
 * would test tag lookup, which is not what the record asserts; what it asserts
 * is that THESE bytes came from THAT commit, and that is what gets re-proved. */
const repo = VERIFY ? existing.repository : repositoryOf(manifest);
const { commit, tag } = VERIFY
  ? { commit: existing.commit, tag: '(stored)' }
  : await resolveCommit(repo, item.version);
console.log(`  repository ${repo}  tag ${tag} -> ${commit}`);

const repoPath = (p) => (REPO_PREFIX ? `${REPO_PREFIX}/${p}` : p);
const prefix = `https://raw.githubusercontent.com/${repo}/${commit}/`;

/* Runtime proofs: real shipped code, matched byte-for-byte. Ordered so the
 * package's declared entry point is tried first — that is the file most likely
 * to exist unbuilt in the repository, and the most meaningful one to match. */
const entry = String(manifest.main || 'index.js').replace(/^\.\//, '');
const candidates = [entry, 'index.js', 'index.mjs', 'index.cjs', 'index.ts',
  ...[...files.keys()].filter((p) => /\.(?:[cm]?js|ts)$/.test(p) && !p.includes('/'))]
  .filter((p, i, all) => files.has(p) && all.indexOf(p) === i)
  .slice(0, 6);

const runtimeProofs = [];
for (const candidate of candidates) {
  const upstream = await raw(repo, commit, repoPath(candidate));
  if (!upstream) continue;
  const local = sha256(files.get(candidate));
  if (sha256(upstream.body) !== local) continue;      // a near-match is not a match
  runtimeProofs.push({ path: repoPath(candidate), sha256: local, url: upstream.url });
}
if (!runtimeProofs.length) {
  die(`not one shipped file matches ${repo}@${commit} byte-for-byte (tried ${candidates.join(', ') || 'nothing'}).\n`
    + '  The published artifact is probably BUILT from that source rather than copied from it, so the\n'
    + '  repository cannot stand as evidence for these bytes. That is a real finding: record it in\n'
    + '  compliance/rights-review-packet.json for a human, and do not write a record without a binding.');
}

/* Names seen in the wild, and the list is not decoration: `eastasianwidth` reads
 * as "no licence anywhere" until you try `MIT-LICENSE.txt`, which is exactly the
 * false negative that turns a recoverable package into a human question. When a
 * refusal says "no licence file", check the repository by eye before believing
 * it — and add the name here rather than working around it. */
const LICENSE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENCE.txt',
  'License', 'License.md', 'license', 'license.md', 'license.txt',
  'LICENSE-MIT', 'LICENSE-MIT.txt', 'MIT-LICENSE', 'MIT-LICENSE.txt', 'MIT-LICENSE.md',
  'LICENSE.BSD', 'BSD-LICENSE.txt', 'LICENSE-APACHE',
  'COPYING', 'COPYING.md', 'COPYING.txt', 'UNLICENSE', 'UNLICENSE.txt', 'NOTICE'];
const licenseFiles = [];
for (const candidate of LICENSE_NAMES) {
  const upstream = await raw(repo, commit, repoPath(candidate));
  if (!upstream) continue;
  const text = upstream.body.toString('utf8');
  if (!text.trim()) continue;
  licenseFiles.push({ path: repoPath(candidate), url: upstream.url, sha256: sha256(upstream.body), text });
  break;                                              // one grant, not a pile of near-duplicates
}
if (!licenseFiles.length) {
  die(`no licence file at ${repo}@${commit} either (tried ${LICENSE_NAMES.length} names). The grant may be `
    + 'inside the README, or the project may genuinely never have published one. Either way a human decides.');
}

/* 🔴 A DECLARATION AND A TEXT CAN DISAGREE, and pairing them silently is the
 * worst thing this tool could do: the record would then assert, with a byte
 * proof attached, that we ship under a licence nobody granted. `highlightjs-vue`
 * is the live example — its manifest says CC0-1.0 and its repository carries a
 * BSD-3-Clause LICENSE. Which one governs is a question for a human, and the
 * only wrong answer is to pick one quietly. */
const upstreamSpdx = (await gh(`https://api.github.com/repos/${repo}/license`))?.license?.spdx_id;
if (upstreamSpdx && upstreamSpdx !== 'NOASSERTION' && upstreamSpdx !== license) {
  die(`the manifest declares ${license} and the repository is ${upstreamSpdx} (${repo}).\n`
    + '  Recording the text under the declared identifier would assert a grant nobody made.\n'
    + '  Which one governs is a human question — put it in compliance/rights-review-packet.json.');
}

const record = {
  name: NAME, version: item.version, integrity: item.integrity, resolved: item.resolved,
  license, repository: repo, commit, runtimeProofs, files: licenseFiles,
};

/* The library that CONSUMES this is stricter than the code that wrote it; run
 * its rules here so a record is never written that would be rejected on read. */
for (const file of [...record.files, ...record.runtimeProofs]) {
  if (file.url !== prefix + file.path) die(`built a record whose URL does not derive from the pin: ${file.url}`);
  if (!/^[a-f0-9]{64}$/.test(file.sha256)) die(`built a record with a malformed hash for ${file.path}`);
}
if (!/^[a-f0-9]{40}$/.test(record.commit)) die('built a record with an unpinned commit');
for (const file of record.files) if (sha256(file.text) !== file.sha256) die('built a record whose text and hash disagree');

console.log(`  ${runtimeProofs.length} runtime proof(s) matched: ${runtimeProofs.map((p) => p.path).join(', ')}`);
console.log(`  licence ${licenseFiles[0].path} (${license}), ${licenseFiles[0].text.length} bytes`);
const holder = licenseFiles[0].text.split('\n').find((l) => /copyright/i.test(l));
console.log(`  ${holder ? holder.trim() : 'NOTE: the text carries no copyright line — check it by hand'}`);

if (VERIFY) {
  /* Compare on the fields that CONSTITUTE the binding. The stored record may
   * legitimately carry more runtime proofs than this run chose to fetch, so a
   * strict deep-equal would fail for a reason that is not a disagreement. */
  const differs = [];
  for (const key of ['name', 'version', 'integrity', 'resolved', 'license', 'repository', 'commit']) {
    if (existing[key] !== record[key]) differs.push(`${key}: stored ${existing[key]} vs rebuilt ${record[key]}`);
  }
  for (const file of record.files) {
    const match = existing.files.find((f) => f.path === file.path);
    if (!match) differs.push(`licence file ${file.path} is not in the stored record`);
    else if (match.sha256 !== file.sha256) differs.push(`licence text for ${file.path} differs from the stored hash`);
    else if (match.text !== file.text) differs.push(`licence text for ${file.path} differs byte-for-byte`);
  }
  for (const proof of record.runtimeProofs) {
    const match = existing.runtimeProofs.find((p) => p.path === proof.path);
    if (match && match.sha256 !== proof.sha256) differs.push(`runtime proof ${proof.path} differs from the stored hash`);
  }
  if (differs.length) {
    console.error(`\n✗ the rebuilt record does NOT reproduce the stored one:\n  ${differs.join('\n  ')}\n`);
    process.exitCode = 1;
  } else {
    console.log(`\n  ✓ reproduces the stored record exactly — integrity, commit, licence text and every`
      + ` overlapping runtime proof agree`);
  }
} else if (!WRITE) {
  console.log('\n  dry run — pass --write to merge this record.');
} else {
  store.packages.push(record);
  store.packages.sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version));
  writeFileSync(`${RECOVERED}.tmp`, `${JSON.stringify(store, null, 2)}\n`);
  const written = JSON.parse(readFileSync(`${RECOVERED}.tmp`, 'utf8'));
  if (written.packages.length !== store.packages.length) die('the merged file did not read back with every record');
  writeFileSync(RECOVERED, `${JSON.stringify(store, null, 2)}\n`);
  console.log(`\n  written — ${store.packages.length} records in ${RECOVERED}`);
}
