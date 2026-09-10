#!/usr/bin/env node
/**
 * Record a DECLARATION-ONLY attribution for a package that publishes no licence
 * text anywhere — not in the archive, not in its source headers, not in an
 * immutable upstream commit.
 *
 *   node scripts/record-declared-license.mjs <name> [--version x.y.z] [--write]
 *
 * This is the fourth and weakest route in the notices pipeline, and it exists
 * because the first three are exhausted for a real and irreducible reason: some
 * publishers name a licence in `package.json` and never write the text down. No
 * amount of searching produces a document that was never authored. The choice is
 * therefore between recording that honestly and shipping a notices file with a
 * hole in it — and a hole is worse, because it reads as an oversight rather than
 * as a finding.
 *
 * 🔴 WHAT MAKES IT HONEST RATHER THAN A FORGERY:
 *
 *   1. The canonical SPDX text is reproduced VERBATIM, placeholders and all —
 *      `Copyright (c) <year> <copyright holders>`. It is never interpolated with
 *      the author's name. Filling those in would manufacture a notice the
 *      publisher never wrote, and it would be indistinguishable from one they
 *      did. The declared holder is recorded ALONGSIDE it, as a separate fact
 *      with its own source (the manifest, bound to the archive hash).
 *   2. The text is labelled `spdx-canonical`, never `publisher`, and the
 *      renderer prints that distinction where a reader will see it.
 *   3. The ABSENCE is evidence too, so it is recorded: the archive's complete
 *      file inventory with hashes, the upstream repository and commit that were
 *      checked, and the filenames tried. A later reader can re-run the search
 *      rather than take this on trust.
 *
 * It refuses whenever a stronger route was available or the facts conflict —
 * see the checks below. Every refusal means "this package does not belong in
 * this category", never "try harder".
 *
 * ⚠️ This records facts. It is not a determination that declaration-only
 * attribution satisfies the licence, and it signs nothing.
 *
 * Dry-run by default. `--write` merges and never replaces.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { lockedPackageEvidence, declaredManifestLicense } from './lib/npm-package-evidence.mjs';
import { bundledNoticeTexts } from './collect-third-party-notices.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const STORE = 'compliance/declared-package-licenses.json';
const RECOVERED = 'compliance/recovered-package-licenses.json';
const LOCKFILES = ['package-lock.json', 'src/server/package-lock.json'];

const argv = process.argv.slice(2);
const NAME = argv.find((a) => !a.startsWith('--'));
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? undefined : argv[i + 1]; };
const VERSION = flag('version');
const WRITE = argv.includes('--write');

if (!NAME) {
  console.error('usage: node scripts/record-declared-license.mjs <name> [--version x.y.z] [--write]');
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

function lockedPackage(name) {
  const found = new Map();
  for (const lock of LOCKFILES) {
    const data = JSON.parse(readFileSync(lock, 'utf8'));
    for (const [key, item] of Object.entries(data.packages || {})) {
      if (!key.endsWith(`node_modules/${name}`) || !item.resolved || !item.integrity) continue;
      if (VERSION && item.version !== VERSION) continue;
      const existing = found.get(`${item.version}|${item.integrity}`) || { ...item, lockfiles: [] };
      existing.lockfiles.push(lock);
      found.set(`${item.version}|${item.integrity}`, existing);
    }
  }
  if (!found.size) die('not present in either lockfile');
  if (found.size > 1) die(`installed at ${found.size} versions — name one with --version`);
  return [...found.values()][0];
}

/** The declared copyright holder, as a plain string, from whichever field the
 *  publisher used. Never inferred from the repository owner or the npm account:
 *  this has to be something the publisher themselves wrote into the archive. */
function declaredHolder(manifest) {
  const a = manifest.author ?? (Array.isArray(manifest.contributors) ? manifest.contributors[0] : undefined);
  if (!a) return undefined;
  if (typeof a === 'string') return a;
  return [a.name, a.email && `<${a.email}>`].filter(Boolean).join(' ') || undefined;
}

const store = JSON.parse(readFileSync(STORE, 'utf8'));
const recovered = JSON.parse(readFileSync(RECOVERED, 'utf8'));
const item = lockedPackage(NAME);

if (store.packages.some((p) => p.name === NAME && p.version === item.version)) {
  die(`already recorded at ${item.version} — this tool never replaces a record`);
}
if (recovered.packages.some((p) => p.name === NAME && p.version === item.version)) {
  die('a RECOVERED record already exists, which is stronger evidence. This category is for packages '
    + 'where no text was found anywhere; using it here would hide the better record.');
}

const pack = await lockedPackageEvidence(item, NAME, path.join(process.cwd(), '.compliance/npm-tarballs'),
  { includeLicenseHeaders: true });

/* ── the four reasons a stronger route was available ─────────────────────── */

const notices = bundledNoticeTexts(pack.files);
if (notices.length) {
  die(`the archive DOES carry a notice (${notices.map((f) => f.path).join(', ')}). The normal path handles `
    + 'this; a declaration-only record would hide a real text.');
}
if (pack.licenseHeaders.length) {
  die(`the published source carries ${pack.licenseHeaders.length} copyright/licence header(s). That is the `
    + '`referenced` route in compliance/referenced-package-licenses.json, which is stronger — use it.');
}

const license = declaredManifestLicense(pack.manifest);
if (!license) die('the manifest declares no licence, so there is no declaration to attribute. That is a '
  + 'different and much larger problem: the package grants nothing at all.');

const holder = declaredHolder(pack.manifest);
if (!holder) {
  die('the manifest names no author, so there is no copyright holder to attribute to. Reproducing a '
    + 'licence text with nobody named attributes the work to no one, which is not attribution.');
}

/* ── conflicts: the repository disagreeing with the manifest is fatal ─────────
 *
 * This runs BEFORE the canonical-text lookup, and the order is load-bearing.
 * When highlightjs-vue was checked with the text check first, it reported "no
 * canonical text is pinned for CC0-1.0" — true, fixable in a minute, and
 * completely the wrong headline. The actual finding is that its manifest says
 * CC0-1.0 while its repository says BSD-3-Clause. Pinning the CC0 text would
 * have cleared the reported obstacle and walked straight into the real one,
 * which is exactly how a conflict gets resolved by accident. Report the finding
 * first; the inconvenience can wait. */

async function upstreamSpdx(manifest) {
  const raw = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  const m = raw && String(raw).match(/github\.com[/:]([^/]+)\/([^/#.]+)/);
  if (!m) return { repository: undefined, spdx: undefined };
  const repository = `${m[1]}/${m[2].replace(/\.git$/, '')}`;
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'xeno-license-recovery' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repository}/license`, { headers, redirect: 'follow' });
  if (!response.ok) return { repository, spdx: undefined };
  const body = await response.json();
  return { repository, spdx: body?.license?.spdx_id, licensePath: body?.path };
}

/** When this exact version was published to npm. */
async function publishedOn(name, version) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { redirect: 'follow' });
  if (!response.ok) return undefined;
  return (await response.json())?.time?.[version];
}

/** When the repository's licence file FIRST appeared. */
async function licenceAddedOn(repository, filePath) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'xeno-license-recovery' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(
    `https://api.github.com/repos/${repository}/commits?path=${encodeURIComponent(filePath)}&per_page=100`,
    { headers, redirect: 'follow' });
  if (!response.ok) return undefined;
  const commits = await response.json();
  if (!Array.isArray(commits) || !commits.length) return undefined;
  const first = commits[commits.length - 1];          // the API returns newest first
  return { date: first.commit?.author?.date, commit: first.sha };
}

const upstream = await upstreamSpdx(pack.manifest);

/* 🔴 A REPOSITORY LICENCE THAT POSTDATES THE RELEASE IS NOT A CONFLICT.
 *
 * The first version of this check compared the manifest against the repository
 * as it stands TODAY and called any difference a conflict for a human. That
 * reading is wrong often enough to matter: highlightjs-vue@1.0.0 was published
 * 2019-11-18 and its BSD-3-Clause LICENSE was added 2019-12-24 — five weeks
 * later. Nothing conflicted at the moment being asked about. The package
 * declared CC0-1.0 and the repository was relicensed afterwards; comparing
 * across time manufactured a dispute out of an ordinary sequence of events, and
 * would have sent someone to email a maintainer about a disagreement that never
 * existed.
 *
 * So when the two differ, ask WHEN. A licence file that did not exist on the
 * publish date says nothing about the archive we install, and is recorded as a
 * later relicensing. One that predates the release and still disagrees is a real
 * conflict and still refuses. */
let relicensing;
if (upstream.spdx && upstream.spdx !== 'NOASSERTION' && upstream.spdx !== license) {
  const published = await publishedOn(NAME, item.version);
  const added = upstream.licensePath ? await licenceAddedOn(upstream.repository, upstream.licensePath) : undefined;
  if (published && added?.date && new Date(added.date) > new Date(published)) {
    relicensing = {
      repositoryLicense: upstream.spdx,
      repositoryLicensePath: upstream.licensePath,
      addedOn: added.date.slice(0, 10),
      addedInCommit: added.commit,
      versionPublishedOn: published.slice(0, 10),
      reading: `The repository is ${upstream.spdx} today, and that licence file was added after this `
        + `version was published. On ${published.slice(0, 10)} the only grant this package carried was its `
        + `declared ${license}.`,
    };
    console.log(`  NOTE: repository is ${upstream.spdx}, added ${added.date.slice(0, 10)} — AFTER this version `
      + `shipped on ${published.slice(0, 10)}. Recorded as a later relicensing, not a conflict.`);
  } else {
    die(`the manifest declares ${license} and the repository ${upstream.repository} is ${upstream.spdx}, and `
      + 'that licence file does not postdate this release, so the disagreement is real.\n'
      + '  Reproducing the canonical text of one while the publisher names the other would pick a side.\n'
      + '  That is a human question — leave it in compliance/rights-review-packet.json.');
  }
}

const text = store.texts[license];
if (!text) {
  die(`no canonical text is pinned for ${license}. Add one to ${STORE} from `
    + 'spdx/license-list-data at a pinned commit — never typed from memory.');
}
if (sha256(text.text) !== text.sha256) die(`the pinned ${license} text does not match its own hash`);

/* ── the record ──────────────────────────────────────────────────────────── */

const record = {
  name: NAME,
  version: item.version,
  integrity: item.integrity,
  resolved: item.resolved,
  license,
  declaredCopyrightHolder: holder,
  holderSource: 'package.json author field, in the integrity-verified archive',
  textSource: 'spdx-canonical',
  absenceEvidence: {
    checkedOn: new Date().toISOString().slice(0, 10),
    archiveContents: pack.files.map(({ path: p, sha256: h }) => ({ path: p, sha256: h })),
    sourceLicenseHeaders: 0,
    upstreamRepository: upstream.repository ?? null,
    upstreamRepositoryLicense: upstream.spdx ?? null,
    laterRelicensing: relicensing ?? null,
    note: upstream.spdx
      ? 'The repository carries a licence file today; it is not in the published archive, and this record '
        + 'does not assert that it applied to this version. Where a byte-bound commit could be established '
        + 'the recovered-package-licenses route is used instead. See laterRelicensing when the repository '
        + 'now names a DIFFERENT licence than this release declared.'
      : 'Neither the published archive nor the repository carries a licence file.',
  },
};

console.log(`${NAME}@${record.version}  (${item.lockfiles.join(', ')})`);
console.log(`  declared:  ${license}`);
console.log(`  holder:    ${holder}`);
console.log(`  archive:   ${pack.files.length} inventoried file(s), 0 notices, 0 source headers`);
console.log(`  upstream:  ${upstream.repository ?? '(none named)'} -> ${upstream.spdx ?? 'no licence'}`);
console.log(`  text:      ${license} canonical, ${text.text.length} bytes, ${text.url}`);
console.log(`             placeholders NOT interpolated — "${text.text.split('\n').find((l) => /Copyright/i.test(l))?.trim()}"`);

if (!WRITE) {
  console.log('\n  dry run — pass --write to merge this record.');
} else {
  store.packages.push(record);
  store.packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  writeFileSync(`${STORE}.tmp`, `${JSON.stringify(store, null, 2)}\n`);
  const back = JSON.parse(readFileSync(`${STORE}.tmp`, 'utf8'));
  if (back.packages.length !== store.packages.length) die('the merged store did not read back whole');
  writeFileSync(STORE, `${JSON.stringify(store, null, 2)}\n`);
  console.log(`\n  written — ${store.packages.length} declaration-only record(s)`);
}
