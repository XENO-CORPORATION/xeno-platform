#!/usr/bin/env node
/*
 * publish-cli-releases.mjs — build a product's R2 release feed for a CLI product
 * (npm-distributed, no per-OS installer) and publish it to the platform.
 *
 * CLI products (agent-cli, sdk) have no downloadable installer, so the desktop
 * `publish-to-platform.mjs` (installer + blockmap + auto-update) does not apply.
 * The website's /product/:slug/releases page still reads apps/:app/releases.json
 * from R2, so a CLI needs that feed generated from its REAL release data:
 *
 *   - versions + publish dates  →  the npm registry (source of truth for what
 *                                   is actually installable)
 *   - human release notes       →  the package's own RELEASE_NOTES map
 *                                   (for a CLI this is the exact text shown at
 *                                   startup; SDKs keep equivalent public notes)
 *
 * The intersection (versions that are BOTH on npm AND have notes) becomes the
 * feed, newest first, with the npm `latest` dist-tag flagged as `latest`.
 * Nothing here is authored/fabricated — it mirrors npm + the CLI source.
 *
 * ── MERGE, NEVER REPLACE ─────────────────────────────────────────────────────
 * This script used to upload the generated feed as-is. That silently REPLACED
 * `releases.json`, which `03-release-data.md` §10 defines as the canonical,
 * prepend-only history. The two behaviours only agreed while a product kept one
 * npm identity forever; the moment a package is RENAMED (agent-cli:
 * `@xeno-corporation/xeno-agent-cli` → `@xenosystem/agent-cli`) the new registry
 * entry knows nothing about the old versions, so the generated feed was one entry
 * and publishing it would have deleted 25 real releases. R2 has no object
 * versioning — that deletion is irrecoverable (see `docs/engineering-learnings.md`
 * → "Importing a module to check its syntax EXECUTES it", 2026-07-26).
 *
 * So the generated feed is now MERGED over the live one: generated entries win for
 * the versions they cover, every other existing entry is KEPT verbatim, and the
 * result is re-sorted newest-first. If a merge would still drop a version the
 * script REFUSES rather than publishing — a structural guard, not a convention.
 *
 * Usage:
 *   node scripts/publish-cli-releases.mjs \
 *     --app agent-cli \
 *     --pkg @xenosystem/agent-cli \
 *     --notes ../xeno-agent-cli/apps/xeno-agent-cli/src/commands/release-notes.ts \
 *     [--install "npm install -g @xenosystem/agent-cli"] \
 *     [--out dist-feed] [--dry-run]
 *
 * `--notes` accepts either:
 *   - a `.ts` file exporting a `RELEASE_NOTES` object literal (the CLI pattern), or
 *   - a `.json` file of the same shape, for a product whose notes live in a
 *     CHANGELOG rather than in a startup-notes module. Keys beginning with `_` are
 *     ignored, so the file can carry a `_source` provenance block. A version's
 *     value is either `string[]` (rendered as `•` bullets, exactly like the TS
 *     form) or an object `{ notes, title?, type?, severity?, channel? }` whose
 *     extra keys are the SCHEMA fields from `03-release-data.md` §2.1 — that is
 *     how a security/deprecation signal is carried into the feed.
 *
 * Requires rclone with the R2 remote (default r2:xeno-hub-releases) unless --dry-run.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { updatesOrigin } from '../src/server/config/hosts.js';
import { R2Publisher } from './lib/r2-upload.mjs';

const PUBLIC = process.env.XENO_UPDATES_BASE || updatesOrigin();

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const DRY = process.argv.includes('--dry-run');
function fail(m) { console.error(`publish-cli-releases: ${m}`); process.exit(1); }

/* Argument resolution is DEFERRED into main(). It used to run at module top level,
 * where a missing --app called fail() → process.exit(1) the instant the module was
 * imported. That makes the file impossible to import for testing, and — worse — it
 * is the same "merely loading this module does something" shape as the 2026-07-26
 * incident. Nothing outside a direct invocation may now have any effect. */
function resolveOptions() {
  const APP = arg('app') || fail('missing --app (R2 folder / product slug)');
  const PKG = arg('pkg') || fail('missing --pkg (npm package name)');
  const NOTES_FILE = arg('notes') || fail('missing --notes (path to release-notes.ts or .json)');
  const INSTALL = arg('install') || `npm install -g ${PKG}`;
  const OUT = arg('out') || join(process.env.TEMP || '/tmp', `cli-feed-${APP}`);
  const REMOTE = `${process.env.XENO_R2_REMOTE || 'r2:xeno-hub-releases'}/apps/${APP}`;
  return { APP, PKG, NOTES_FILE, INSTALL, OUT, REMOTE };
}

/* Extract the RELEASE_NOTES object literal from the CLI source. It is pure data
 * (double-quoted keys + string arrays), so once trailing commas are stripped it
 * is valid JSON — no need to execute the TS module (which pulls in config/io).
 *
 * A `.json` notes file is read directly. Either way this only ever PARSES text:
 * the notes source is never imported, because importing a module executes it. */
function parseReleaseNotes(file) {
  const text = readFileSync(file, 'utf8');
  if (file.toLowerCase().endsWith('.json')) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { fail(`invalid JSON in ${file}: ${e.message}`); }
    return parsed;
  }
  const m = text.match(/RELEASE_NOTES[^=]*=\s*\{/);
  if (!m) fail(`could not find RELEASE_NOTES in ${file}`);
  let i = text.indexOf('{', m.index);
  let depth = 0, end = -1;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end < 0) fail('unbalanced RELEASE_NOTES object');
  const literal = text.slice(i, end + 1).replace(/,(\s*[}\]])/g, '$1'); // drop trailing commas
  return JSON.parse(literal);
}

const TYPES = ['release', 'patch', 'hotfix'];
const SEVERITIES = ['normal', 'critical'];
const CHANNELS = ['stable', 'beta'];

/* Normalise one RELEASE_NOTES value into { notes, title?, type, severity, channel }.
 * `string[]` (the CLI form) becomes `•` bullets. The object form additionally
 * carries the optional schema fields — validated here so a typo in a notes file
 * cannot put an unknown value into a published feed. */
function normalizeNotesEntry(version, value) {
  const toText = (n) => (Array.isArray(n) ? n.map((s) => `• ${s}`).join('\n') : String(n));
  if (Array.isArray(value) || typeof value === 'string') {
    return { notes: toText(value), type: 'release', severity: 'normal', channel: 'stable' };
  }
  if (!value || typeof value !== 'object') fail(`notes for ${version} must be an array, string, or object`);
  if (value.notes === undefined) fail(`notes for ${version}: object form requires a "notes" key`);
  const out = {
    notes: toText(value.notes),
    type: value.type ?? 'release',
    severity: value.severity ?? 'normal',
    channel: value.channel ?? 'stable',
  };
  if (value.title) out.title = String(value.title);
  if (!TYPES.includes(out.type)) fail(`notes for ${version}: type "${out.type}" not one of ${TYPES.join('|')}`);
  if (!SEVERITIES.includes(out.severity)) fail(`notes for ${version}: severity "${out.severity}" not one of ${SEVERITIES.join('|')}`);
  if (!CHANNELS.includes(out.channel)) fail(`notes for ${version}: channel "${out.channel}" not one of ${CHANNELS.join('|')}`);
  if (!out.notes.trim()) fail(`notes for ${version} are empty — every release entry must carry notes`);
  return out;
}

async function fetchJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Merge a generated feed over the live history. PURE — no network, no R2, no
 * process exit — so the invariant below can be tested hermetically.
 *
 * Rules:
 *  - generated entries WIN for the versions they cover;
 *  - every other live entry is KEPT verbatim (this is what survives a package rename);
 *  - the result is newest-first;
 *  - exactly one stable entry is `latest`: npm's dist-tag when present, else newest stable;
 *  - `dropped` lists any live version missing from the result. It must always be empty —
 *    the caller REFUSES to publish otherwise. R2 has no object versioning.
 *
 * @returns {{feed: object[], dropped: string[], chosen: object|null}}
 */
export function mergeFeed({ generated = [], existing = [], latestTag } = {}) {
  const live = Array.isArray(existing) ? existing : Array.isArray(existing?.releases) ? existing.releases : [];
  const generatedVersions = new Set(generated.map((r) => r.version));
  const kept = live.filter((r) => r && r.version && !generatedVersions.has(r.version));
  const feed = [...generated, ...kept].sort((a, b) => cmpSemverDesc(a.version, b.version));

  const after = new Set(feed.map((r) => r.version));
  const dropped = live.map((r) => r?.version).filter((v) => v && !after.has(v));

  const isStable = (r) => (r.channel ?? 'stable') === 'stable';
  const chosen = feed.find((r) => r.version === latestTag && isStable(r)) ?? feed.find(isStable) ?? null;
  for (const r of feed) r.latest = r === chosen;

  return { feed, dropped, chosen };
}

function cmpSemverDesc(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0); }
  return 0;
}

async function main() {
  const { APP, PKG, NOTES_FILE, INSTALL, OUT, REMOTE } = resolveOptions();

  // 1) npm registry — versions, publish dates, and the `latest` dist-tag.
  const reg = await fetch(`https://registry.npmjs.org/${PKG.replace('/', '%2f')}`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : fail(`npm registry ${r.status} for ${PKG}`)));
  const npmVersions = reg.versions || {};
  const npmTime = reg.time || {};
  const latestTag = reg['dist-tags']?.latest;

  // 2) CLI release notes (the exact startup text).
  const notes = parseReleaseNotes(NOTES_FILE);

  // 3) Generated = versions present on npm AND carrying notes, newest first.
  const versions = Object.keys(notes)
    .filter((v) => !v.startsWith('_'))          // `_source` provenance blocks are not versions
    .filter((v) => npmVersions[v] && npmTime[v])
    .sort(cmpSemverDesc);
  if (versions.length === 0) fail('no versions with both an npm publish date and release notes');

  const generated = versions.map((v) => {
    const meta = normalizeNotesEntry(v, notes[v]);
    return {
      version: v,
      date: npmTime[v].slice(0, 10),
      latest: false,                            // recomputed across the MERGED list below
      type: meta.type,
      channel: meta.channel,
      severity: meta.severity,
      ...(meta.title ? { title: meta.title } : {}),
      // notes as a bullet block — ReleaseFeed renders whitespace-pre-line.
      notes: meta.notes,
      // npm-distributed packages have no per-OS installer assets. Record the
      // package-appropriate install command so the feed stays self-describing.
      install: INSTALL,
    };
  });

  // 3b) MERGE over the live history. Generated entries win for the versions they
  //     cover; every other existing entry is kept verbatim. See the header.
  const live = await fetchJson(`${PUBLIC}/apps/${APP}/releases.json`);
  const existing = Array.isArray(live) ? live : Array.isArray(live?.releases) ? live.releases : [];
  const generatedVersions = new Set(generated.map((r) => r.version));
  const { feed, dropped, chosen } = mergeFeed({ generated, existing, latestTag });

  // 3c) The structural guard: a publish may only ADD to the history. If any
  //     version that is live today is missing from what we are about to upload,
  //     refuse — R2 has no object versioning, so the overwrite is irreversible.
  if (dropped.length) {
    fail(
      `REFUSING to publish: ${dropped.length} version(s) live in apps/${APP}/releases.json would be LOST ` +
      `(${dropped.join(', ')}). releases.json is the canonical prepend-only history and R2 has no object ` +
      `versioning, so this overwrite could not be undone.`,
    );
  }
  if (!chosen) fail('no stable entry in the merged feed — refusing to publish a feed with no latest');

  // 3e) Print the plan BEFORE anything is written.
  const before = existing.map((r) => r?.version).filter(Boolean);
  const existingVersions = new Set(before);
  console.error(`\nPlan for apps/${APP}/releases.json — ${existing.length} live → ${feed.length} entries:`);
  for (const r of feed) {
    const state = !existingVersions.has(r.version) ? 'ADD   ' : generatedVersions.has(r.version) ? 'UPDATE' : 'KEEP  ';
    console.error(`  ${state} ${r.version}  ${r.date}${r.latest ? '  [latest]' : ''}${r.title ? `  ${r.title}` : ''}`);
  }
  console.error(`  (0 dropped — guard passed)`);

  const latest = chosen;
  const versionJson = {
    version: latest.version,
    date: latest.date,
    npm: PKG,
    install: INSTALL,
    notes: latest.notes,
  };

  mkdirSync(OUT, { recursive: true });
  const relPath = join(OUT, 'releases.json');
  const verPath = join(OUT, 'version.json');
  writeFileSync(relPath, JSON.stringify(feed, null, 2));
  writeFileSync(verPath, JSON.stringify(versionJson, null, 2));
  console.error(`Built ${feed.length} releases for ${APP} (latest v${latest.version} · ${latest.date})`);
  console.error(`  ${relPath}`);
  console.error(`  ${verPath}`);

  // 4) Publish to R2 through the gated choke point (scripts/lib/r2-upload.mjs).
  //    These feeds are assembled from the npm registry and the CLI's own
  //    release-notes.ts — data this script does not author, so it is scanned like
  //    any other artifact. `Cache-Control: no-cache` is applied by putPointer.
  const r2 = new R2Publisher({ remote: REMOTE, dryRun: DRY });
  await r2.putPointer(readFileSync(relPath, 'utf8'), 'releases.json', { label: 'releases.json' });
  await r2.putPointer(readFileSync(verPath, 'utf8'), 'version.json', { label: 'version.json' });

  console.error(`\n✓ ${DRY ? '(dry-run) ' : ''}Published ${APP} feed. Page: https://xenostudio.ai/product/${APP}/releases`);
  console.error(`  Feed: ${PUBLIC}/apps/${APP}/releases.json`);
}

// Only run when invoked directly. Importing this module must never publish —
// on 2026-07-26 a bare `import()` of a sibling script executed it and wiped four
// products' release histories. There is no load-without-execute mode in ESM, so
// inertness has to be written here explicitly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
