#!/usr/bin/env node
/*
 * Unit tests for the electron-updater `latest*.yml` support added to xeno-release.mjs.
 * Run: node --test scripts/xeno-release.latest-yml.test.mjs
 *
 * These are hermetic (no R2, no network): they exercise the pure helpers that resolve the
 * upload target and rewrite the installer references so in-app auto-update actually resolves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updaterRelPath, rewriteLatestYml } from './xeno-release.mjs';

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
    "sha512: abc123==",
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
