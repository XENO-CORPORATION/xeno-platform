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
import { readFileSync, writeFileSync, statSync, mkdtempSync, createReadStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { updatesOrigin } from '../src/server/config/hosts.js';

// Sourced from the ONE hostname seam (src/server/config/hosts.js). Override
// with XENO_UPDATES_BASE (kept for compatibility) or XENO_UPDATES_ORIGIN.
// release-guide/02-cloudflare-r2.md documented this file as a hardcoded
// exception; it no longer is.
const R2_PUBLIC = process.env.XENO_UPDATES_BASE || updatesOrigin();
const R2_REMOTE = 'r2:xeno-hub-releases';
const LABELS = { windows: 'Windows (x64)', mac: 'macOS', linux: 'Linux (AppImage)' };
const VERSION_KEY = { windows: 'windows', mac: 'mac', linux: 'linux' };
// electron-updater reads one channel file per OS from its `publish.url`. These are the
// electron-builder-generated names next to the installer in the product's build output.
const LATEST_YML = { windows: 'latest.yml', mac: 'latest-mac.yml', linux: 'latest-linux.yml' };

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

/**
 * Resolve the R2 key-prefix where a product's electron-updater expects `latest*.yml`,
 * from its electron-builder `publish.url`. This MUST equal the product's configured
 * publish URL (electron-updater fetches `<publish.url>/latest.yml`). After the config
 * reconciliation every Electron product uses `https://updates.xenostudio.ai/apps/<slug>/`,
 * so the default is `apps/<app>` — identical to where version.json/releases.json go. The
 * override exists for the case a product's publish URL legitimately diverges (req. 3).
 * Accepts either a full publish URL or an already-relative R2 path.
 */
export function updaterRelPath(app, updaterUrl) {
  if (typeof updaterUrl === 'string' && updaterUrl.trim()) {
    let rel = updaterUrl.trim().replace(/^https?:\/\/[^/]+/i, ''); // strip scheme + host
    rel = rel.replace(/^\/+/, '').replace(/\/+$/, '');             // trim leading/trailing slashes
    if (rel) return rel;
  }
  return `apps/${app}`;
}

/**
 * Rewrite the installer references in an electron-builder `latest*.yml` so they resolve
 * against the product's publish URL to the IMMUTABLE `v<version>/` installer we upload —
 * not a flat filename at the publish root (which does not exist on R2).
 *
 * electron-updater resolves each `url:`/`path:` in latest.yml relative to `publish.url`
 * (`new URL(fileName, "https://updates.xenostudio.ai/apps/<slug>/")`). electron-builder
 * emits bare filenames, which would resolve to `apps/<slug>/<file>` (404 — installers live
 * under `apps/<slug>/v<version>/`). Prefixing `v<version>/` makes them resolve correctly
 * while preserving the versioned, never-overwritten installer layout. The sha512/size are
 * untouched (they hash file CONTENT, not the path), so the rewrite stays valid. Idempotent:
 * any value already containing a `/` is left alone.
 */
export function rewriteLatestYml(text, version) {
  const prefix = `v${version}/`;
  return text.split('\n').map((line) => {
    const m = line.match(/^(\s*(?:-\s+url|url|path):\s+)(.+?)\s*$/);
    if (!m) return line;
    const head = m[1];
    const val = m[2];
    const q = /^(['"]).*\1$/.test(val) ? val[0] : '';
    let inner = q ? val.slice(1, -1) : val;
    if (!inner || inner.includes('/')) return line; // already carries a path segment → leave as-is
    inner = prefix + inner;
    return `${head}${q}${inner}${q}`;
  }).join('\n');
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
  const providedOs = new Set();
  const artifactDirs = new Set();
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
    providedOs.add(os);
    artifactDirs.add(dirname(localPath));
    // Differential-update sidecar: electron-builder emits `<installer>.blockmap` next to
    // the installer, and latest.yml references it from the SAME versioned dir. Upload it
    // (immutable, like the installer) so delta updates resolve instead of 404-ing.
    const blockmap = `${localPath}.blockmap`;
    if (existsSync(blockmap)) {
      console.log(`  ${os}: ${basename(blockmap)} (differential blockmap)`);
      rclone(['copyto', blockmap, `${R2_REMOTE}/apps/${app}/v${version}/${basename(blockmap)}`, '--no-traverse'], dryRun);
    }
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

  // 6) electron-updater channel → upload latest*.yml so IN-APP auto-update fires.
  //    electron-builder emits these next to the installer; the XENO flow never uploaded
  //    them, so electron-updater's generic provider never saw a new version. They are
  //    MOVING POINTERS (no-cache, like version.json), and their installer references are
  //    rewritten to the immutable v<version>/ path (see rewriteLatestYml). Their R2 target
  //    is the product's electron-updater publish URL (updaterRelPath) — after the config
  //    reconciliation that is apps/<slug>/, the same dir as version.json.
  const updaterRel = updaterRelPath(app, opts['updater-url']);
  const searchDirs = opts['artifact-dir'] && opts['artifact-dir'] !== true
    ? [opts['artifact-dir']]
    : [...artifactDirs];
  if (searchDirs.length) {
    for (const os of ['windows', 'mac', 'linux']) {
      const ymlName = LATEST_YML[os];
      const found = searchDirs.map((d) => join(d, ymlName)).find((p) => existsSync(p));
      if (!found) {
        // Only warn for an OS whose installer we just published (its channel file is expected).
        if (providedOs.has(os)) {
          console.warn(`  ⚠ ${ymlName}: not found in ${searchDirs.join(', ')} — in-app auto-update NOT updated for ${os}. (electron-builder emits it next to the installer only with a \`generic\` publish provider configured.)`);
        }
        continue;
      }
      const rewritten = rewriteLatestYml(readFileSync(found, 'utf8'), version);
      const outFile = join(tmp, ymlName);
      writeFileSync(outFile, rewritten);
      console.log(`  updater: ${ymlName} → ${updaterRel}/${ymlName} (installer refs → v${version}/, no-cache)`);
      rclone(['copyto', outFile, `${R2_REMOTE}/${updaterRel}/${ymlName}`, '--header-upload', 'Cache-Control: no-cache', '--no-traverse'], dryRun);
    }
  } else if (Object.keys(assets).length) {
    console.warn('  ⚠ no artifact dir to scan for latest*.yml (installers had no resolvable dir); pass --artifact-dir to feed the electron-updater channel.');
  }

  console.log(`\n✓ Published ${app} v${version} (${channel}/${type}). releases.json: ${next.length} entries.`);
  console.log(`  Pages: https://xenostudio.ai/product/${app}`);
  if (dryRun) console.log('  (dry-run — nothing uploaded)');
  console.log('\n  NOTE (SPEC §13.6): trigger a product-pages prerender + frontend deploy so the');
  console.log('  static/SEO pages reflect the new version.');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd !== 'publish') {
    console.log('Usage: node scripts/xeno-release.mjs publish --app <slug> --version <x.y.z> --date <YYYY-MM-DD> \\');
    console.log('         [--channel stable|beta] [--type release|patch|hotfix] [--severity normal|critical] \\');
    console.log('         [--title "..."] (--notes "..." | --notes-file FILE) \\');
    console.log('         [--win FILE] [--mac FILE] [--linux FILE] \\');
    console.log('         [--artifact-dir DIR] [--updater-url URL] [--dry-run]');
    console.log('');
    console.log('  --artifact-dir  Dir holding electron-builder latest*.yml (default: the installer dir(s)).');
    console.log('  --updater-url   Product electron-updater publish URL for the latest*.yml target');
    console.log('                  (default: apps/<app>/ — matches version.json).');
    process.exit(cmd ? 1 : 0);
  }
  publish(args).catch((e) => { console.error(e); process.exit(1); });
}
