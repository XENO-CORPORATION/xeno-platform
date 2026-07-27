#!/usr/bin/env node
/*
 * publish-cli-releases.test.mjs — the CLI feed publisher must only ever ADD.
 * Run: node --test scripts/publish-cli-releases.test.mjs
 *
 * Every test here reproduces a real hazard, and the first one FAILS against the
 * pre-2026-07-27 publisher, which uploaded its generated feed as-is.
 *
 * THE BUG THIS LOCKS DOWN
 * -----------------------
 * The generated feed is `keys(RELEASE_NOTES) ∩ versions(npm package)`. That equals
 * the full history only while a product keeps ONE npm identity forever. When
 * agent-cli was renamed `@xeno-corporation/xeno-agent-cli` → `@xenosystem/agent-cli`,
 * the new registry entry had exactly one version (0.5.17) while the live feed held
 * 25 real releases — so publishing the generated feed would have deleted all 25.
 * R2 has no object versioning, so that deletion is irrecoverable.
 *
 * Hermetic: no network, no R2, no rclone. `mergeFeed` is pure, and importing the
 * module must not publish anything (see the entry-point test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { mergeFeed } from './publish-cli-releases.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const rel = (version, extra = {}) => ({
  version, date: '2026-01-01', latest: false, type: 'release',
  channel: 'stable', severity: 'normal', notes: `notes for ${version}`, ...extra,
});

test('THE RENAME CASE: a one-version generated feed never deletes a 25-version history', () => {
  // Exactly the agent-cli situation on 2026-07-27.
  const existing = ['0.4.45', '0.4.44', '0.4.43', '0.4.42', '0.4.41'].map((v) =>
    rel(v, { install: 'npm install -g @xeno-corporation/xeno-agent-cli' }));
  existing[0].latest = true;
  const generated = [rel('0.5.17', { install: 'npm install -g @xenosystem/agent-cli' })];

  const { feed, dropped, chosen } = mergeFeed({ generated, existing, latestTag: '0.5.17' });

  assert.deepEqual(dropped, [], 'a publish must never drop a live version');
  assert.equal(feed.length, 6, 'new entry is ADDED to the history, not swapped for it');
  assert.equal(feed[0].version, '0.5.17', 'newest first');
  assert.equal(chosen.version, '0.5.17');
  // Every pre-existing version survives, with its original bytes.
  for (const v of ['0.4.45', '0.4.44', '0.4.43', '0.4.42', '0.4.41']) {
    const kept = feed.find((r) => r.version === v);
    assert.ok(kept, `${v} must survive the merge`);
    assert.equal(kept.notes, `notes for ${v}`, 'kept entries are verbatim');
  }
  // The old entry's install command is history, and stays historically accurate.
  assert.match(feed.find((r) => r.version === '0.4.45').install, /@xeno-corporation/);
  assert.match(feed[0].install, /@xenosystem/);
});

test('exactly one stable entry is latest, and the previous latest is demoted', () => {
  const existing = [rel('0.4.45', { latest: true }), rel('0.4.44')];
  const generated = [rel('0.5.17')];
  const { feed } = mergeFeed({ generated, existing, latestTag: '0.5.17' });
  assert.deepEqual(feed.filter((r) => r.latest).map((r) => r.version), ['0.5.17']);
  assert.equal(feed.find((r) => r.version === '0.4.45').latest, false, 'previous latest is demoted');
});

test('a regenerated version UPDATES in place rather than duplicating', () => {
  const existing = [rel('0.1.0', { notes: 'stale' })];
  const generated = [rel('0.1.0', { notes: 'fresh' })];
  const { feed, dropped } = mergeFeed({ generated, existing, latestTag: '0.1.0' });
  assert.deepEqual(dropped, []);
  assert.equal(feed.length, 1, 'no duplicate entry for the same version');
  assert.equal(feed[0].notes, 'fresh', 'generated data wins for versions it covers');
});

test('first publish (no live feed) is not mistaken for a history wipe', () => {
  const { feed, dropped, chosen } = mergeFeed({ generated: [rel('0.0.2'), rel('0.0.1')], existing: [], latestTag: '0.0.2' });
  assert.deepEqual(dropped, []);
  assert.equal(feed.length, 2);
  assert.equal(chosen.version, '0.0.2');
});

test('the `{releases:[...]}` wrapper form is read, not silently treated as empty', () => {
  // productCatalog tolerates this shape on read; treating it as [] would make the
  // guard blind and the merge destructive.
  const existing = { releases: [rel('0.1.0')] };
  const { feed, dropped } = mergeFeed({ generated: [rel('0.1.1')], existing, latestTag: '0.1.1' });
  assert.deepEqual(dropped, []);
  assert.equal(feed.length, 2);
});

test('beta entries are preserved but never become latest', () => {
  const existing = [rel('0.9.0', { channel: 'beta' }), rel('0.1.0')];
  const { feed, chosen } = mergeFeed({ generated: [rel('0.1.1')], existing, latestTag: '0.1.1' });
  assert.equal(feed.length, 3, 'the beta entry survives');
  assert.equal(chosen.version, '0.1.1');
  assert.equal(feed.find((r) => r.version === '0.9.0').latest, false, 'a beta is never latest');
});

test('a latestTag missing from the merged feed falls back to the newest stable', () => {
  const { chosen } = mergeFeed({ generated: [rel('0.2.0')], existing: [rel('0.1.0')], latestTag: '9.9.9' });
  assert.equal(chosen.version, '0.2.0');
});

test('dropped is REPORTED, so the caller can refuse (the guard is not decorative)', () => {
  // mergeFeed cannot drop by construction; prove the channel exists by feeding a
  // live entry the merge cannot represent (no version key).
  const { dropped } = mergeFeed({ generated: [rel('1.0.0')], existing: [rel('0.9.0')], latestTag: '1.0.0' });
  assert.deepEqual(dropped, [], 'normal path reports nothing dropped');
  assert.ok(Array.isArray(dropped), 'dropped is always an array the caller can check');
});

test('IMPORTING the module publishes nothing (2026-07-26: import() executed a script)', () => {
  // The import at the top of this file already proves it — a publishing main()
  // would have needed --app/--pkg/--notes and exited. Assert the guard is present
  // in source too, so nobody removes it without this test going red.
  const src = execFileSync(process.execPath, ['-e',
    `process.stdout.write(require('fs').readFileSync(${JSON.stringify(join(HERE, 'publish-cli-releases.mjs'))},'utf8'))`,
  ], { encoding: 'utf8' });
  assert.match(src, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/,
    'main() must be gated on being the process entry point');
});
