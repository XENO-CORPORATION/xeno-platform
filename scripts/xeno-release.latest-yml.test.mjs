#!/usr/bin/env node
/*
 * Unit tests for the electron-updater feed support in xeno-release.mjs.
 * Run: node --test scripts/xeno-release.latest-yml.test.mjs
 *
 * These are hermetic (no R2, no network): they exercise the pure helpers that resolve the
 * upload target and rewrite the installer references so in-app auto-update actually resolves.
 *
 * The first six tests predate the 2026-07-26 safety-gate work and MUST stay green — they
 * pin the slug-root rewrite that every product except Shell depends on. Everything after
 * them covers the channel-named feed and the Shell two-stage layout.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  updaterRelPath,
  rewriteLatestYml,
  rewriteFeedRefs,
  deriveChannel,
  channelFeedNames,
  feedTargets,
  findFeedFile,
  buildVersionJson,
} from './xeno-release.mjs';

test('updaterRelPath defaults to apps/<app>', () => {
  assert.equal(updaterRelPath('pixel'), 'apps/pixel');
  assert.equal(updaterRelPath('hub', undefined), 'apps/hub');
  assert.equal(updaterRelPath('sound', ''), 'apps/sound');
});

test('updaterRelPath derives the R2 prefix from a full publish URL', () => {
  assert.equal(updaterRelPath('hub', 'https://updates.xenostudio.ai/apps/hub/'), 'apps/hub');
  assert.equal(updaterRelPath('pixel', 'https://updates.xenostudio.ai/apps/pixel'), 'apps/pixel');
  // A publish URL that diverges from apps/<app> is honored verbatim (req. 3).
  assert.equal(updaterRelPath('x', 'https://updates.xenostudio.ai/channels/beta/'), 'channels/beta');
  // A bare-root publish URL derives an empty path → safety fallback to apps/<app>
  // (never write latest.yml to the bucket root).
  assert.equal(updaterRelPath('hub', 'https://updates.xenostudio.ai/'), 'apps/hub');
});

test('updaterRelPath accepts an already-relative path', () => {
  assert.equal(updaterRelPath('pixel', 'apps/pixel/'), 'apps/pixel');
  assert.equal(updaterRelPath('pixel', '/apps/pixel'), 'apps/pixel');
});

test('rewriteLatestYml prefixes bare installer refs with v<version>/', () => {
  const raw = [
    'version: 0.6.4',
    'files:',
    '  - url: XENO Pixel Setup 0.6.4.exe',
    '    sha512: abc123==',
    '    size: 71234567',
    'path: XENO Pixel Setup 0.6.4.exe',
    'sha512: abc123==',
    "releaseDate: '2026-07-22T00:00:00.000Z'",
    '',
  ].join('\n');
  const out = rewriteLatestYml(raw, '0.6.4');
  assert.match(out, /- url: v0\.6\.4\/XENO Pixel Setup 0\.6\.4\.exe/);
  assert.match(out, /^path: v0\.6\.4\/XENO Pixel Setup 0\.6\.4\.exe$/m);
  // sha512/size/version/releaseDate lines are untouched (hash is over content, not path).
  assert.match(out, /^version: 0\.6\.4$/m);
  assert.match(out, /^ {4}sha512: abc123==$/m);
  assert.match(out, /^ {4}size: 71234567$/m);
  assert.match(out, /releaseDate: '2026-07-22T00:00:00\.000Z'/);
});

test('rewriteLatestYml is idempotent (already-prefixed refs are left alone)', () => {
  const once = rewriteLatestYml('path: XENO Pixel Setup 0.6.4.exe\n', '0.6.4');
  const twice = rewriteLatestYml(once, '0.6.4');
  assert.equal(once, twice);
  assert.equal(once.trim(), 'path: v0.6.4/XENO Pixel Setup 0.6.4.exe');
});

test('rewriteLatestYml handles blockmap refs and quoted values', () => {
  const raw = [
    'files:',
    '  - url: XENO-HUB Setup 0.5.1.exe.blockmap',
    '    sha512: zzz==',
    "  - url: 'XENO-HUB Setup 0.5.1.exe'",
    '    sha512: yyy==',
    '',
  ].join('\n');
  const out = rewriteLatestYml(raw, '0.5.1');
  assert.match(out, /- url: v0\.5\.1\/XENO-HUB Setup 0\.5\.1\.exe\.blockmap/);
  assert.match(out, /- url: 'v0\.5\.1\/XENO-HUB Setup 0\.5\.1\.exe'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Channel-named feeds — the XENO Shell 0.1.0-beta.1 defect.
//
// electron-builder names the update-metadata file after the channel it DERIVES
// FROM THE SEMVER PRERELEASE TAG, not after anything the publisher declares. A
// publisher that only looks for latest*.yml therefore skips the feed for every
// prerelease, leaving in-app auto-update silently dead. Deriving from the version
// also covers alpha/rc, which a hardcoded {stable,beta} map does not.
// ─────────────────────────────────────────────────────────────────────────────

test('deriveChannel reads the channel out of the semver prerelease tag', () => {
  assert.equal(deriveChannel('0.6.4'), 'latest');
  assert.equal(deriveChannel('0.1.0-beta.1'), 'beta');
  assert.equal(deriveChannel('2.0.0-alpha.3'), 'alpha');
  assert.equal(deriveChannel('1.0.0-rc.1'), 'rc');
});

test('channelFeedNames maps a channel to the three per-OS feed filenames', () => {
  assert.deepEqual(channelFeedNames('latest'), {
    windows: 'latest.yml', mac: 'latest-mac.yml', linux: 'latest-linux.yml',
  });
  assert.deepEqual(channelFeedNames('beta'), {
    windows: 'beta.yml', mac: 'beta-mac.yml', linux: 'beta-linux.yml',
  });
  // 'stable' is the publisher's word for the channel electron-builder calls 'latest'.
  assert.equal(channelFeedNames('stable').windows, 'latest.yml');
});

test('findFeedFile picks beta.yml for a prerelease — the Shell defect', () => {
  // The pre-gate publisher scanned only latest.yml and warned-and-continued, which is
  // how a beta shipped with no auto-update channel at all.
  const present = new Set(['C:/out/beta.yml']);
  const locate = findFeedFile(['C:/out'], '0.1.0-beta.1', 'beta', (p) => present.has(p.replace(/\\/g, '/')));
  const found = locate('windows');
  assert.equal(found.foundAs, 'beta.yml');
  assert.equal(found.publishAs, 'beta.yml');
});

test('findFeedFile republishes a stable-named file UNDER the derived channel name', () => {
  // A product whose channel derivation disagrees with the build emits latest.yml for a
  // prerelease. It must still be published as beta.yml — that is the name the prerelease
  // client requests. Never the reverse: a prerelease feed must not land on latest.yml,
  // which stable clients consume.
  const present = new Set(['C:/out/latest.yml']);
  const locate = findFeedFile(['C:/out'], '0.1.0-beta.1', 'beta', (p) => present.has(p.replace(/\\/g, '/')));
  const found = locate('windows');
  assert.equal(found.foundAs, 'latest.yml');
  assert.equal(found.publishAs, 'beta.yml');
});

test('findFeedFile returns null when no feed exists for that OS', () => {
  const locate = findFeedFile(['C:/out'], '0.6.4', 'stable', () => false);
  assert.equal(locate('windows'), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// The Shell two-stage layout — bare vs prefixed refs.
//
// Shell reads apps/shell/version.json as a POLICY manifest, then sets the feed to
// <base>v<version>/ and fetches <channel>.yml from INSIDE that directory. Refs in
// THAT copy must be bare; the slug-root copy keeps the v<version>/ prefix. Getting
// this backwards produces v<v>/v<v>/<file> — the double-prefix 404 fixed by hand.
// ─────────────────────────────────────────────────────────────────────────────

const SHELL_FEED = [
  'version: 0.1.0-beta.1',
  'files:',
  '  - url: XENO Shell Setup 0.1.0-beta.1.exe',
  '    sha512: 02puZ+5DbwEENyUWIXu1wJiA1NcafxOAco0RIrV8dXBh2H/lJIacZFasgAJA1f7FtrsLDASP1+cQq2cyda6UlA==',
  '    size: 87281755',
  'path: XENO Shell Setup 0.1.0-beta.1.exe',
  'sha512: 02puZ+5DbwEENyUWIXu1wJiA1NcafxOAco0RIrV8dXBh2H/lJIacZFasgAJA1f7FtrsLDASP1+cQq2cyda6UlA==',
  "releaseDate: '2026-07-26T01:20:25.509Z'",
  '',
].join('\n');

test('rewriteFeedRefs(version-dir) keeps refs BARE', () => {
  const out = rewriteFeedRefs(SHELL_FEED, '0.1.0-beta.1', 'version-dir');
  assert.match(out, /^ {2}- url: XENO Shell Setup 0\.1\.0-beta\.1\.exe$/m);
  assert.match(out, /^path: XENO Shell Setup 0\.1\.0-beta\.1\.exe$/m);
  assert.doesNotMatch(out, /v0\.1\.0-beta\.1\//);
});

test('rewriteFeedRefs(version-dir) STRIPS an already-prefixed ref — the double-prefix 404', () => {
  // Feeding the slug-root output into the version-dir target is exactly the mistake
  // that produced v<v>/v<v>/<file> on R2. It must be corrected, not compounded.
  const slugRoot = rewriteFeedRefs(SHELL_FEED, '0.1.0-beta.1', 'slug-root');
  assert.match(slugRoot, /- url: v0\.1\.0-beta\.1\/XENO Shell Setup/);
  const versionDir = rewriteFeedRefs(slugRoot, '0.1.0-beta.1', 'version-dir');
  assert.match(versionDir, /^ {2}- url: XENO Shell Setup 0\.1\.0-beta\.1\.exe$/m);
  assert.doesNotMatch(versionDir, /v0\.1\.0-beta\.1\/v0\.1\.0-beta\.1\//);
  assert.doesNotMatch(versionDir, /v0\.1\.0-beta\.1\//);
});

test('rewriteFeedRefs is idempotent in BOTH layouts', () => {
  for (const layout of ['slug-root', 'version-dir']) {
    const once = rewriteFeedRefs(SHELL_FEED, '0.1.0-beta.1', layout);
    assert.equal(rewriteFeedRefs(once, '0.1.0-beta.1', layout), once, `${layout} not idempotent`);
  }
});

test('feedTargets("both") emits the two Shell copies at the right keys', () => {
  const targets = feedTargets({
    app: 'shell',
    version: '0.1.0-beta.1',
    updaterRel: 'apps/shell',
    feedName: 'beta.yml',
    layout: 'both',
    publicBase: 'https://updates.xenostudio.ai',
  });
  assert.deepEqual(targets.map((t) => t.key), [
    'apps/shell/beta.yml',
    'apps/shell/v0.1.0-beta.1/beta.yml',
  ]);
  assert.deepEqual(targets.map((t) => t.layout), ['slug-root', 'version-dir']);
  // The version-dir copy's base URL is what Shell's stage 2 sets as the feed URL.
  assert.equal(targets[1].baseUrl, 'https://updates.xenostudio.ai/apps/shell/v0.1.0-beta.1/');
});

test('feedTargets defaults to a single slug-root feed for every other product', () => {
  const targets = feedTargets({
    app: 'pixel', version: '0.6.4', updaterRel: 'apps/pixel', feedName: 'latest.yml', layout: 'slug-root',
  });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].key, 'apps/pixel/latest.yml');
});

// ─────────────────────────────────────────────────────────────────────────────
// version.json as a POLICY manifest (Shell stage 1).
// ─────────────────────────────────────────────────────────────────────────────

const shellRelease = {
  version: '0.1.0-beta.1',
  date: '2026-07-26',
  channel: 'beta',
  title: 'First public beta',
  notes: 'First public beta of the XENO Shell desktop environment.',
  assets: { windows: [{ label: 'Windows (x64)', file: 'v0.1.0-beta.1/XENO Shell Setup 0.1.0-beta.1.exe' }] },
};

test('buildVersionJson writes a POLICY manifest for a beta-only version-dir product', () => {
  // The old rule ("derive from the newest STABLE entry") wrote NO version.json for a
  // beta-only history — which for Shell means stage 1 never fires and the entire
  // updater is dead. That regression is pinned here.
  const out = buildVersionJson({
    release: shellRelease,
    next: [{ ...shellRelease, latest: false }],
    layout: 'both',
    opts: { 'rollout-percent': '25' },
  });
  assert.equal(out.version, '0.1.0-beta.1');
  assert.equal(out.windows, 'XENO Shell Setup 0.1.0-beta.1.exe'); // FILENAME only
  assert.equal(out.channel, 'beta');
  assert.equal(out.rolloutPercent, 25);
  assert.equal(out.rollback, false);
});

test('buildVersionJson defaults rolloutPercent to 100 and clamps out-of-range values', () => {
  const full = buildVersionJson({ release: shellRelease, next: [], layout: 'version-dir', opts: {} });
  assert.equal(full.rolloutPercent, 100);
  const clamped = buildVersionJson({
    release: shellRelease, next: [], layout: 'version-dir', opts: { 'rollout-percent': '512' },
  });
  assert.equal(clamped.rolloutPercent, 100);
});

test('buildVersionJson keeps the classic latest-stable shape for slug-root products', () => {
  const stable = {
    version: '0.6.4', date: '2026-07-22', channel: 'stable', title: 'Patch',
    assets: { windows: [{ file: 'v0.6.4/XENO Pixel Setup 0.6.4.exe' }] },
  };
  const out = buildVersionJson({ release: stable, next: [stable], layout: 'slug-root', opts: {} });
  assert.equal(out.windows, 'XENO Pixel Setup 0.6.4.exe');
  assert.equal(out.channel, undefined, 'policy fields must not leak into a normal version.json');
  assert.equal(out.rolloutPercent, undefined);
});

test('buildVersionJson writes nothing when a slug-root history has no stable entry', () => {
  const beta = { version: '0.6.0-beta.1', date: '2026-07-22', channel: 'beta', notes: 'x' };
  assert.equal(buildVersionJson({ release: beta, next: [beta], layout: 'slug-root', opts: {} }), null);
});
