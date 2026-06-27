#!/usr/bin/env node
/*
 * xeno-release — the canonical release publisher (PRODUCT-PAGES-SPEC.md §7).
 *
 * On each product release this is the ONE tool that updates R2 so the website +
 * Hub reflect the new version. It uploads installers, prepends a full Release
 * entry to releases.json (the canonical history), and regenerates version.json
 * (the derived latest-stable pointer Hub auto-update reads). A release is not
 * complete until BOTH JSON files are updated.
 *
 * Usage:
 *   node scripts/xeno-release.mjs publish \
 *     --app hub --version 0.5.1 --date 2026-06-20 \
 *     --channel stable --type patch [--severity normal] [--title "..."] \
 *     (--notes "markdown" | --notes-file CHANGELOG.md) \
 *     [--win "release/Setup.exe"] [--mac "release/App.dmg"] [--linux "release/App.AppImage"] \
 *     [--dry-run]
 *
 * Requires: rclone with an `r2:` remote → the xeno-hub-releases bucket.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, mkdtempSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

const R2_PUBLIC = 'https://updates.xenostudio.ai';
const R2_REMOTE = 'r2:xeno-hub-releases';
const LABELS = { windows: 'Windows (x64)', mac: 'macOS', linux: 'Linux (AppImage)' };
const VERSION_KEY = { windows: 'windows', mac: 'mac', linux: 'linux' };

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function fail(msg) { console.error(`xeno-release: ${msg}`); process.exit(1); }

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(file);
    s.on('error', reject);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

function rclone(args, dryRun) {
  if (dryRun) { console.log(`  [dry-run] rclone ${args.join(' ')}`); return; }
  execFileSync('rclone', args, { stdio: 'inherit' });
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function publish(opts) {
  const app = opts.app || fail('--app is required');
  const version = String(opts.version || fail('--version is required')).replace(/^v/i, '');
  const date = opts.date || fail('--date (YYYY-MM-DD) is required');
  const channel = opts.channel === 'beta' ? 'beta' : 'stable';
  const type = ['release', 'patch', 'hotfix'].includes(opts.type) ? opts.type : 'release';
  const severity = opts.severity === 'critical' ? 'critical' : 'normal';
  const dryRun = !!opts['dry-run'];

  let notes = '';
  if (opts['notes-file']) notes = readFileSync(opts['notes-file'], 'utf8').trim();
  else if (typeof opts.notes === 'string') notes = opts.notes;
  if (!notes) fail('notes required (--notes "..." or --notes-file FILE)');

  // 1) Installers → compute size+sha256, upload to apps/<app>/v<version>/.
  const assets = {};
  const versionJsonFiles = {};
  for (const os of ['windows', 'mac', 'linux']) {
    const flag = os === 'windows' ? 'win' : os;
    const localPath = opts[flag];
    if (!localPath || localPath === true) continue;
    const size = statSync(localPath).size;
    const sum = await sha256(localPath);
    const fname = basename(localPath);
    const rel = `v${version}/${fname}`;
    console.log(`  ${os}: ${fname} (${(size / 1048576).toFixed(1)} MB, sha256 ${sum.slice(0, 12)}…)`);
    rclone(['copyto', localPath, `${R2_REMOTE}/apps/${app}/${rel}`, '--no-traverse'], dryRun);
    assets[VERSION_KEY[os]] = [{ label: LABELS[os], file: rel, size, sha256: sum }];
    versionJsonFiles[VERSION_KEY[os]] = fname;
  }

  // 2) Build the Release object.
  const release = {
    version, date,
    latest: channel === 'stable',
    type, channel, severity,
    ...(opts.title ? { title: opts.title } : {}),
    notes,
    ...(Object.keys(assets).length ? { assets } : {}),
  };

  // 3) Prepend to releases.json (dedupe by version); recompute latest flags so
  //    exactly the newest STABLE entry is latest.
  const existing = (await fetchJson(`${R2_PUBLIC}/apps/${app}/releases.json`)) ?? [];
  const list = Array.isArray(existing) ? existing : (existing.releases ?? []);
  const deduped = list.filter((r) => r.version !== version || (r.channel ?? 'stable') !== channel);
  const next = [release, ...deduped];
  let stableSeen = false;
  for (const r of next) {
    if ((r.channel ?? 'stable') === 'stable' && !stableSeen) { r.latest = true; stableSeen = true; }
    else r.latest = false;
  }

  // 4) Regenerate version.json from the latest STABLE entry (Hub auto-update).
  const latestStable = next.find((r) => (r.channel ?? 'stable') === 'stable');
  const versionJson = latestStable
    ? {
        version: latestStable.version,
        date: latestStable.date,
        ...Object.fromEntries(
          ['windows', 'mac', 'linux']
            .map((k) => [k, latestStable.assets?.[k]?.[0]?.file?.split('/').pop()])
            .filter(([, v]) => v),
        ),
        notes: (latestStable.title || latestStable.notes || '').slice(0, 400),
      }
    : null;

  // 5) Upload both JSON files (no-cache).
  const tmp = mkdtempSync(join(tmpdir(), 'xeno-rel-'));
  const relFile = join(tmp, 'releases.json');
  writeFileSync(relFile, JSON.stringify(next, null, 2));
  rclone(['copyto', relFile, `${R2_REMOTE}/apps/${app}/releases.json`, '--header-upload', 'Cache-Control: no-cache', '--no-traverse'], dryRun);
  if (versionJson) {
    const verFile = join(tmp, 'version.json');
    writeFileSync(verFile, JSON.stringify(versionJson, null, 2));
    rclone(['copyto', verFile, `${R2_REMOTE}/apps/${app}/version.json`, '--header-upload', 'Cache-Control: no-cache', '--no-traverse'], dryRun);
  }

  console.log(`\n✓ Published ${app} v${version} (${channel}/${type}). releases.json: ${next.length} entries.`);
  console.log(`  Pages: https://xenostudio.ai/product/${app}`);
  if (dryRun) console.log('  (dry-run — nothing uploaded)');
  console.log('\n  NOTE (SPEC §13.6): trigger a product-pages prerender + frontend deploy so the');
  console.log('  static/SEO pages reflect the new version.');
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (cmd !== 'publish') {
  console.log('Usage: node scripts/xeno-release.mjs publish --app <slug> --version <x.y.z> --date <YYYY-MM-DD> \\');
  console.log('         [--channel stable|beta] [--type release|patch|hotfix] [--severity normal|critical] \\');
  console.log('         [--title "..."] (--notes "..." | --notes-file FILE) \\');
  console.log('         [--win FILE] [--mac FILE] [--linux FILE] [--dry-run]');
  process.exit(cmd ? 1 : 0);
}
publish(args).catch((e) => { console.error(e); process.exit(1); });
