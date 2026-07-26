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
 * ── SAFETY GATES (2026-07-26) ─────────────────────────────────────────────────
 * Every upload goes through scripts/lib/r2-upload.mjs, which scans the ARTIFACT
 * BYTES for secrets before rclone is invoked. It is not possible to publish past
 * a finding, because the scan lives inside the uploader rather than beside it.
 * See scripts/lib/secret-scan.mjs for why (a live platform key reached the CDN
 * inside three extension ZIPs while the repo's own CI guardrail was green: the
 * publish path never touched CI).
 *
 * Gates, in order:
 *   1. SECRET     — artifact bytes, containers unpacked. Fail-closed.
 *   2. COVERAGE   — an installer whose payload could not be opened is refused
 *                   unless --allow-unscannable-payload is passed.
 *   3. FEED       — the updater feed's refs, filenames, sha512 and sizes must
 *                   match the artifacts, in the layout the feed will live in.
 *   4. IMMUTABLE  — refuse to overwrite an existing v<version>/ artifact.
 *   5. LIVE       — after upload, fetch what we published and prove the chain
 *                   resolves: feed → installer URL → ranged GET 206 + size.
 *
 * --dry-run runs gates 1-4 (and skips 5, which needs a real upload).
 *
 * Usage:
 *   node scripts/xeno-release.mjs publish \
 *     --app hub --version 0.5.1 --date 2026-06-20 \
 *     --channel stable --type patch [--severity normal] [--title "..."] \
 *     (--notes "markdown" | --notes-file CHANGELOG.md) \
 *     [--win "release/Setup.exe"] [--mac "release/App.dmg"] [--linux "release/App.AppImage"] \
 *     [--updater-layout slug-root|version-dir|both] \
 *     [--rollout-percent 100] [--rollback] \
 *     [--dry-run]
 *
 * Requires: rclone with an `r2:` remote → the xeno-hub-releases bucket.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { updatesOrigin } from '../src/server/config/hosts.js';
import { R2Publisher, GateError } from './lib/r2-upload.mjs';
import {
  deriveChannel,
  channelFeedNames,
  rewriteFeedRefs,
  rewriteLatestYml,
  parseUpdaterFeed,
  verifyFeedAgainstArtifacts,
  describeArtifact,
  formatFeedProblems,
} from './lib/feed-integrity.mjs';
import { verifyPublishedChain, formatLiveResult } from './lib/live-verify.mjs';

// Sourced from the ONE hostname seam (src/server/config/hosts.js). Override
// with XENO_UPDATES_BASE (kept for compatibility) or XENO_UPDATES_ORIGIN.
const R2_PUBLIC = process.env.XENO_UPDATES_BASE || updatesOrigin();
const R2_REMOTE = 'r2:xeno-hub-releases';
const LABELS = { windows: 'Windows (x64)', mac: 'macOS', linux: 'Linux (AppImage)' };
const VERSION_KEY = { windows: 'windows', mac: 'mac', linux: 'linux' };

export { rewriteLatestYml, rewriteFeedRefs, deriveChannel, channelFeedNames };

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

/**
 * A gate said no. Carries the exit code. Thrown rather than calling process.exit()
 * from deep in the flow: an abrupt exit while stdout still has buffered output
 * aborts the process on Windows (libuv `UV_HANDLE_CLOSING` assertion), which
 * replaces the explanation the operator needs with a crash dump.
 */
class ReleaseRefused extends Error {
  constructor(message, code) { super(message); this.name = 'ReleaseRefused'; this.code = code; }
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/**
 * Resolve the R2 key-prefix where a product's electron-updater expects its channel
 * feed, from its electron-builder `publish.url`. This MUST equal the product's
 * configured publish URL. After the config reconciliation every Electron product uses
 * `https://updates.xenostudio.ai/apps/<slug>/`, so the default is `apps/<app>`.
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
 * Which feed files must be published, and where, for a given updater layout.
 *
 * 'slug-root'   (every product except Shell) — one feed at apps/<slug>/<channel>.yml
 *               with refs prefixed `v<version>/`.
 *
 * 'version-dir' (XENO Shell, and nothing else today) — Shell's updater is TWO-STAGE:
 *               it reads apps/shell/version.json as a POLICY manifest (channel,
 *               rolloutPercent, rollback — see xeno-shell/apps/desktop/src/main/
 *               updaterPolicy.ts), then sets electron-updater's feed to
 *               `<base>v<version>/` and fetches `<channel>.yml` from INSIDE that
 *               directory. Refs there must therefore be BARE filenames; prefixing
 *               them yields v<v>/v<v>/<file> and a 404.
 *
 * 'both'        publish both copies — the versioned one with bare refs (what Shell's
 *               stage 2 reads) and the slug-root one with prefixed refs (so a plain
 *               electron-updater client pointed at apps/<slug>/ still resolves).
 *               This is what Shell actually has on R2 and is the correct setting for it.
 */
export function feedTargets({ app, version, updaterRel, feedName, layout, publicBase = R2_PUBLIC }) {
  const targets = [];
  if (layout === 'slug-root' || layout === 'both') {
    targets.push({ key: `${updaterRel}/${feedName}`, layout: 'slug-root', baseUrl: `${publicBase}/${updaterRel}/` });
  }
  if (layout === 'version-dir' || layout === 'both') {
    targets.push({
      key: `apps/${app}/v${version}/${feedName}`,
      layout: 'version-dir',
      baseUrl: `${publicBase}/apps/${app}/v${version}/`,
    });
  }
  return targets;
}

/**
 * Locate the electron-builder feed for an OS, trying channel names in priority order.
 * The name it is PUBLISHED as always follows the channel DERIVED FROM THE VERSION —
 * that is the name electron-updater will request. A stable-named file found for a
 * prerelease is therefore republished as <derived>.yml; never the reverse, which
 * would feed a prerelease to stable clients.
 */
export function findFeedFile(searchDirs, version, declaredChannel, exists = existsSync) {
  const derived = deriveChannel(version);
  const candidates = [derived];
  if (declaredChannel && declaredChannel !== 'stable') candidates.push(declaredChannel);
  candidates.push('latest');
  return (os) => {
    for (const channel of [...new Set(candidates)]) {
      const name = channelFeedNames(channel)[os];
      for (const dir of searchDirs) {
        const p = join(dir, name);
        if (exists(p)) return { path: p, foundAs: name, publishAs: channelFeedNames(derived)[os] };
      }
    }
    return null;
  };
}

async function publish(opts) {
  const app = opts.app || fail('--app is required');
  const version = String(opts.version || fail('--version is required')).replace(/^v/i, '');
  const date = opts.date || fail('--date (YYYY-MM-DD) is required');
  const channel = opts.channel === 'beta' ? 'beta' : 'stable';
  const type = ['release', 'patch', 'hotfix'].includes(opts.type) ? opts.type : 'release';
  const severity = opts.severity === 'critical' ? 'critical' : 'normal';
  const dryRun = !!opts['dry-run'];
  const layout = ['slug-root', 'version-dir', 'both'].includes(opts['updater-layout'])
    ? opts['updater-layout']
    : 'slug-root';

  let notes = '';
  if (opts['notes-file']) notes = readFileSync(opts['notes-file'], 'utf8').trim();
  else if (typeof opts.notes === 'string') notes = opts.notes;
  if (!notes) fail('notes required (--notes "..." or --notes-file FILE)');

  const r2 = new R2Publisher({
    remote: R2_REMOTE,
    dryRun,
    allowUnscannablePayload: !!opts['allow-unscannable-payload'],
    allowOverwrite: !!opts['allow-overwrite'],
  });

  console.log(`\nxeno-release: ${app} v${version} (${channel}/${type}) — layout ${layout}${dryRun ? ' [DRY RUN]' : ''}`);
  console.log('  gates: secret → coverage → immutability → feed' + (dryRun ? '' : ' → live'));

  // ═══ PHASE A — GATE EVERYTHING. Nothing is uploaded in this phase. ═══════════
  //
  // The order matters. An earlier version of this script uploaded the installers
  // and both JSON pointers BEFORE checking the feed, so a feed failure left a
  // half-published release on R2 — new installers live, releases.json already
  // advertising the version, and a dead updater. Every check now runs against
  // local files first; the first byte reaches R2 only once all of them pass.
  const assets = {};
  const providedOs = new Set();
  const artifactDirs = new Set();
  const uploadedByVersionDir = []; // every file landing in v<version>/ — the feed must agree with these
  const pendingArtifacts = [];     // [localPath, key, label]
  for (const os of ['windows', 'mac', 'linux']) {
    const flag = os === 'windows' ? 'win' : os;
    const localPath = opts[flag];
    if (!localPath || localPath === true) continue;
    if (!existsSync(localPath)) fail(`--${flag}: file not found: ${localPath}`);
    const meta = describeArtifact(localPath);
    const rel = `v${version}/${meta.name}`;
    console.log(`\n  ${os}: ${meta.name} (${(meta.size / 1048576).toFixed(1)} MB, sha256 ${meta.sha256.slice(0, 12)}…)`);
    await r2.gate(localPath);                                   // secret + coverage
    r2.assertNotClobbering(localPath, `apps/${app}/${rel}`);     // immutability
    pendingArtifacts.push([localPath, `apps/${app}/${rel}`, rel]);
    uploadedByVersionDir.push(meta);
    assets[VERSION_KEY[os]] = [{ label: LABELS[os], file: rel, size: meta.size, sha256: meta.sha256 }];
    providedOs.add(os);
    artifactDirs.add(dirname(localPath));

    // Differential-update sidecar: electron-builder emits `<installer>.blockmap`
    // next to the installer, and the feed references it from the SAME versioned dir.
    const blockmap = `${localPath}.blockmap`;
    if (existsSync(blockmap)) {
      const bm = describeArtifact(blockmap);
      console.log(`  ${os}: ${bm.name} (differential blockmap)`);
      await r2.gate(blockmap);
      r2.assertNotClobbering(blockmap, `apps/${app}/v${version}/${bm.name}`);
      pendingArtifacts.push([blockmap, `apps/${app}/v${version}/${bm.name}`, `v${version}/${bm.name}`]);
      uploadedByVersionDir.push(bm);
    }
  }
  console.log(`  ✓ ${r2.coverageSummary()}`);

  // ── 2) Release object ──────────────────────────────────────────────────────
  const release = {
    version, date,
    latest: channel === 'stable',
    type, channel, severity,
    ...(opts.title ? { title: opts.title } : {}),
    notes,
    ...(Object.keys(assets).length ? { assets } : {}),
  };

  // ── 3) releases.json — prepend, dedupe by (version, channel), recompute latest ──
  const existing = (await fetchJson(`${R2_PUBLIC}/apps/${app}/releases.json`)) ?? [];
  const list = Array.isArray(existing) ? existing : (existing.releases ?? []);
  const deduped = list.filter((r) => r.version !== version || (r.channel ?? 'stable') !== channel);
  const next = [release, ...deduped];
  let stableSeen = false;
  for (const r of next) {
    if ((r.channel ?? 'stable') === 'stable' && !stableSeen) { r.latest = true; stableSeen = true; }
    else r.latest = false;
  }

  // ── 4) version.json ────────────────────────────────────────────────────────
  const versionJson = buildVersionJson({ release, next, layout, opts });

  // ── 5) The electron-updater channel feed — VERIFIED, still not uploaded ────
  const updaterRel = updaterRelPath(app, opts['updater-url']);
  const searchDirs = opts['artifact-dir'] && opts['artifact-dir'] !== true
    ? [opts['artifact-dir']]
    : [...artifactDirs];
  const locate = findFeedFile(searchDirs, version, channel);
  const plannedFeeds = [];
  const feedProblems = [];

  for (const os of ['windows', 'mac', 'linux']) {
    if (!providedOs.has(os)) continue;
    const found = searchDirs.length ? locate(os) : null;
    if (!found) {
      feedProblems.push({
        code: 'FEED_MISSING',
        ref: os,
        message: `no updater feed (${channelFeedNames(deriveChannel(version))[os]}) found in ${searchDirs.join(', ') || '(no artifact dir)'}`,
        fix: 'electron-builder emits it next to the installer ONLY with a `generic` publish provider configured. '
          + 'Add publish.provider=generic + publish.url to electron-builder.yml and rebuild, or pass --artifact-dir. '
          + 'Publishing without it means installed clients can never receive a fix.',
      });
      continue;
    }
    if (found.foundAs !== found.publishAs) {
      console.log(`  updater: found ${found.foundAs}, publishing AS ${found.publishAs} (channel derived from ${version})`);
    }

    const raw = readFileSync(found.path, 'utf8');
    for (const target of feedTargets({ app, version, updaterRel, feedName: found.publishAs, layout })) {
      const text = rewriteFeedRefs(raw, version, target.layout);
      const check = verifyFeedAgainstArtifacts({
        feedText: text, version, layout: target.layout, artifacts: uploadedByVersionDir,
      });
      if (!check.ok) {
        feedProblems.push(...check.problems.map((p) => ({ ...p, ref: `${target.key} ${p.ref}` })));
        continue;
      }
      console.log(`  ✓ feed verified: ${target.key} (layout ${target.layout}, ${check.feed.refs.length} refs, sha512+size match)`);
      plannedFeeds.push({ ...target, text, feedName: found.publishAs });
    }
  }

  if (feedProblems.length && !opts['allow-no-updater-feed']) {
    console.error('\n✖ RELEASE REFUSED — the auto-update feed did not verify.');
    console.error(formatFeedProblems(feedProblems));
    console.error(
      '\n  NOTHING WAS UPLOADED. A release whose feed is wrong is worse than no release:\n' +
      '  installed clients keep polling a dead channel and can never be fixed remotely.\n' +
      '  Re-run with --allow-no-updater-feed ONLY for a slug that has no in-app updater\n' +
      '  (CLI/library products).',
    );
    throw new ReleaseRefused('updater feed did not verify', 2);
  }
  if (feedProblems.length) {
    console.warn('\n  ⚠ --allow-no-updater-feed: continuing WITHOUT a verified auto-update channel:');
    console.warn(formatFeedProblems(feedProblems));
  }

  // ═══ PHASE B — UPLOAD. Every gate above has passed. ═════════════════════════
  console.log('');
  for (const [localPath, key, label] of pendingArtifacts) {
    await r2.putArtifact(localPath, key, { label });
  }
  await r2.putPointer(JSON.stringify(next, null, 2), `apps/${app}/releases.json`, { label: 'releases.json' });
  if (versionJson) {
    await r2.putPointer(JSON.stringify(versionJson, null, 2), `apps/${app}/version.json`, { label: 'version.json' });
  }
  const publishedFeeds = [];
  for (const feed of plannedFeeds) {
    await r2.putPointer(feed.text, feed.key, { label: feed.key });
    publishedFeeds.push(feed);
  }

  // ═══ PHASE C — LIVE verification: fetch what we just published ══════════════
  if (!dryRun && publishedFeeds.length) {
    console.log('\n  live verification (feed → installer URL → ranged GET):');
    let broken = false;
    for (const f of publishedFeeds) {
      const result = await verifyPublishedChain({
        feedUrl: `${f.baseUrl}${f.feedName}`,
        expectedVersion: version,
        expectedFiles: uploadedByVersionDir,
        expectedBody: f.text,
        parseFeed: parseUpdaterFeed,
      });
      console.log(formatLiveResult(result));
      if (!result.ok) broken = true;
    }
    if (broken) {
      console.error(
        '\n✖ THE RELEASE IS BROKEN. The feed is published but does not resolve to a downloadable\n' +
        '  installer. In-app auto-update will fail for every client that polls it. Fix the feed or\n' +
        '  re-upload the installer BEFORE announcing this version.',
      );
      throw new ReleaseRefused('the published auto-update chain does not resolve', 3);
    }
    console.log('  ✓ auto-update chain resolves end to end.');
  } else if (dryRun) {
    console.log('\n  live verification: SKIPPED (dry-run — nothing was uploaded).');
    console.log('  Every other gate ran for real against the local artifacts.');
  }

  console.log(`\n✓ ${dryRun ? 'DRY RUN OK' : 'Published'} ${app} v${version} (${channel}/${type}). releases.json: ${next.length} entries.`);
  console.log(`  ${r2.coverageSummary()}`);
  console.log(`  Pages: https://xenostudio.ai/product/${app}`);
  if (dryRun) console.log('  (dry-run — nothing uploaded)');
  console.log('\n  NOTE (SPEC §13.6): trigger a product-pages prerender + frontend deploy so the');
  console.log('  static/SEO pages reflect the new version.');
}

/**
 * version.json is normally derived from the latest STABLE entry.
 *
 * A product whose updater treats version.json as a POLICY manifest (Shell's
 * two-stage updater reads channel + rolloutPercent + rollback from it) has NO
 * stable entry at all while it is in beta — under the old rule the publisher then
 * wrote no version.json, which for Shell means stage 1 never fires and the whole
 * updater is dead. So when the layout is version-dir/both, version.json is written
 * from THIS release regardless of channel, carrying the policy fields.
 */
export function buildVersionJson({ release, next, layout, opts = {} }) {
  const policyManifest = layout !== 'slug-root';
  const source = policyManifest ? release : next.find((r) => (r.channel ?? 'stable') === 'stable');
  if (!source) return null;
  const rollout = opts['rollout-percent'] != null && opts['rollout-percent'] !== true
    ? Math.min(100, Math.max(0, Math.floor(Number(opts['rollout-percent']))))
    : 100;
  return {
    version: source.version,
    date: source.date,
    ...Object.fromEntries(
      ['windows', 'mac', 'linux']
        .map((k) => [k, source.assets?.[k]?.[0]?.file?.split('/').pop()])
        .filter(([, v]) => v),
    ),
    ...(policyManifest
      ? { channel: source.channel ?? 'stable', rolloutPercent: rollout, rollback: !!opts.rollback }
      : {}),
    notes: (source.title || source.notes || '').slice(0, 400),
  };
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
    console.log('         [--artifact-dir DIR] [--updater-url URL] [--updater-layout LAYOUT] [--dry-run]');
    console.log('');
    console.log('  --artifact-dir    Dir holding the electron-builder channel feed (default: the installer dir(s)).');
    console.log('  --updater-url     Product electron-updater publish URL for the feed target');
    console.log('                    (default: apps/<app>/ — matches version.json).');
    console.log('  --updater-layout  slug-root (default) | version-dir | both.');
    console.log('                    version-dir/both = the XENO Shell two-stage updater: version.json is a');
    console.log('                    policy manifest and the channel feed is read from inside v<version>/.');
    console.log('  --rollout-percent Staged rollout 0-100 for a version-dir policy manifest (default 100).');
    console.log('  --rollback        Mark the policy manifest as an authorized downgrade.');
    console.log('');
    console.log('  Safety gates (all fail-closed; --dry-run runs every gate except the live one):');
    console.log('  --allow-unscannable-payload  Acknowledge an installer whose payload could not be opened.');
    console.log('  --allow-overwrite            Permit replacing an existing immutable v<version>/ artifact.');
    console.log('  --allow-no-updater-feed      Publish a slug that has no in-app updater (CLI/library).');
    process.exit(cmd ? 1 : 0);
  }
  // process.exitCode (not process.exit) so buffered stdout is flushed — the
  // failure text IS the deliverable for an unattended agent.
  publish(args).catch((e) => {
    if (e instanceof GateError) {
      console.error(`\nxeno-release: REFUSED — ${e.message}`);
      console.error('  Nothing was uploaded.');
      process.exitCode = 4;
      return;
    }
    if (e instanceof ReleaseRefused) {
      console.error(`\nxeno-release: REFUSED — ${e.message}`);
      process.exitCode = e.code;
      return;
    }
    console.error(e);
    process.exitCode = 1;
  });
}
