/**
 * The publisher refuses what it does not understand, before it touches anything.
 *
 * Found publishing XENO Corpus 0.3.1 (2026-10-31): `--dir release` is not a flag, and nothing said so. The run ignored it,
 * found no installers, reported "Published", and moved version.json to a version whose installer answered 404. The
 * pointer has no versioning, so the only safe place to catch this is before the first write.
 *
 * Every case runs the real script with the real arguments. Each one must exit non-zero in the argument check, so no case
 * can reach R2 even on a machine that has rclone configured.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'xeno-release.mjs');
const run = (...args) => spawnSync(process.execPath, [SCRIPT, 'publish', ...args], { encoding: 'utf8', timeout: 30_000 });
const base = ['--app', 'flag-test-no-such-app', '--version', '0.0.1', '--date', '2026-10-31', '--notes', 'x', '--dry-run'];

test('a flag it does not know is refused by name, and the installers named after it do not rescue it', () => {
  const r = run(...base, '--dir', 'release', '--win', 'Setup.exe');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown flag --dir/);
});

test('a misspelt safety flag is refused rather than silently not applied', () => {
  const r = run(...base, '--win', 'Setup.exe', '--dryrun');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown flag --dryrun/);
});

test('no installer named is refused, because it would move the pointers with nothing behind them', () => {
  const r = run(...base);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no artifact named/);
});

test('--allow-no-artifacts and every documented flag get past the argument check', () => {
  const r = run(...base, '--allow-no-artifacts', '--channel', 'stable', '--type', 'patch', '--severity', 'normal', '--title', 't');
  assert.doesNotMatch(r.stderr, /unknown flag|no artifact named/);
  const named = run(...base, '--win', 'no-such-file.exe', '--mac', 'no-such.dmg', '--linux', 'no-such.AppImage', '--artifact-dir', '.', '--updater-layout', 'slug-root', '--updater-url', 'https://example.invalid/', '--rollout-percent', '100', '--allow-overwrite', '--allow-unscannable-payload', '--allow-no-updater-feed', '--rollback');
  assert.doesNotMatch(named.stderr, /unknown flag|no artifact named/);
});
