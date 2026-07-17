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
 * Usage:
 *   node scripts/publish-cli-releases.mjs \
 *     --app agent-cli \
 *     --pkg @xeno-corporation/xeno-agent-cli \
 *     --notes ../xeno-agent-cli/apps/xeno-agent-cli/src/commands/release-notes.ts \
 *     [--install "npm install -g @xeno-corporation/xeno-agent-cli"] \
 *     [--out dist-feed] [--dry-run]
 *
 * Requires rclone with the R2 remote (default r2:xeno-hub-releases) unless --dry-run.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = process.env.XENO_UPDATES_BASE || 'https://updates.xenostudio.ai';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const DRY = process.argv.includes('--dry-run');
function fail(m) { console.error(`publish-cli-releases: ${m}`); process.exit(1); }

const APP = arg('app') || fail('missing --app (R2 folder / product slug)');
const PKG = arg('pkg') || fail('missing --pkg (npm package name)');
const NOTES_FILE = arg('notes') || fail('missing --notes (path to release-notes.ts)');
const INSTALL = arg('install') || `npm install -g ${PKG}`;
const OUT = arg('out') || join(process.env.TEMP || '/tmp', `cli-feed-${APP}`);
const REMOTE = `${process.env.XENO_R2_REMOTE || 'r2:xeno-hub-releases'}/apps/${APP}`;

/* Extract the RELEASE_NOTES object literal from the CLI source. It is pure data
 * (double-quoted keys + string arrays), so once trailing commas are stripped it
 * is valid JSON — no need to execute the TS module (which pulls in config/io). */
function parseReleaseNotes(file) {
  const text = readFileSync(file, 'utf8');
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

function cmpSemverDesc(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0); }
  return 0;
}

async function main() {
  // 1) npm registry — versions, publish dates, and the `latest` dist-tag.
  const reg = await fetch(`https://registry.npmjs.org/${PKG.replace('/', '%2f')}`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : fail(`npm registry ${r.status} for ${PKG}`)));
  const npmVersions = reg.versions || {};
  const npmTime = reg.time || {};
  const latestTag = reg['dist-tags']?.latest;

  // 2) CLI release notes (the exact startup text).
  const notes = parseReleaseNotes(NOTES_FILE);

  // 3) Feed = versions present on npm AND carrying notes, newest first.
  const versions = Object.keys(notes)
    .filter((v) => npmVersions[v] && npmTime[v])
    .sort(cmpSemverDesc);
  if (versions.length === 0) fail('no versions with both an npm publish date and release notes');

  const feed = versions.map((v) => ({
    version: v,
    date: npmTime[v].slice(0, 10),
    latest: v === latestTag,
    type: 'release',
    channel: 'stable',
    severity: 'normal',
    // notes as a bullet block — ReleaseFeed renders whitespace-pre-line.
    notes: notes[v].map((n) => `• ${n}`).join('\n'),
    // npm-distributed packages have no per-OS installer assets. Record the
    // package-appropriate install command so the feed stays self-describing.
    install: INSTALL,
  }));

  const latest = feed.find((r) => r.latest) || feed[0];
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

  // 4) Publish to R2 (no-cache so the site/Hub see updates immediately).
  const push = (local, dest) => {
    const a = ['copyto', local, `${REMOTE}/${dest}`, '--header-upload', 'Cache-Control: no-cache', '--no-traverse'];
    if (DRY) { console.error(`  [dry-run] rclone ${a.join(' ')}`); return; }
    execFileSync('rclone', a, { stdio: 'inherit' });
  };
  push(relPath, 'releases.json');
  push(verPath, 'version.json');

  console.error(`\n✓ ${DRY ? '(dry-run) ' : ''}Published ${APP} feed. Page: https://xenostudio.ai/product/${APP}/releases`);
  console.error(`  Feed: ${PUBLIC}/apps/${APP}/releases.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
