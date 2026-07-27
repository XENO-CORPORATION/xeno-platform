#!/usr/bin/env node
/*
 * amend-release-entry.test.mjs — an amend may correct a field and NOTHING else.
 * Run: node --test scripts/amend-release-entry.test.mjs
 *
 * `releases.json` is the canonical, machine-read history and R2 has no object
 * versioning, so the only safe in-place edit is one that provably touches a single
 * field of a single entry. These tests are the guard; the prose in the script
 * header is not. Hermetic: no network, no R2, no rclone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { amendEntry, derivedPointerNotes, AmendRefused } from './amend-release-entry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const rel = (version, extra = {}) => ({
  version, date: '2026-01-01', latest: false, type: 'release', channel: 'stable',
  severity: 'normal', notes: `notes for ${version}`,
  assets: { windows: [{ label: 'Windows (x64)', file: `v${version}/App Setup ${version}.exe`, size: 1, sha256: 'ab' }] },
  ...extra,
});

test('THE COMMS CASE: re-channelling an entry edits that entry and only that entry', () => {
  const feed = [rel('0.2.0', { latest: true }), rel('0.1.0')];
  const { next, plan } = amendEntry({
    feed, version: '0.1.0',
    changes: { channel: 'beta', latest: false, title: 'Internal alpha' },
  });

  assert.equal(next.length, 2, 'no entry added or dropped');
  assert.deepEqual(next.map((r) => r.version), ['0.2.0', '0.1.0'], 'order preserved');
  assert.equal(next[1].channel, 'beta');
  assert.equal(next[1].title, 'Internal alpha');
  // latest was already false → not reported as a change, and stays false.
  assert.equal(next[1].latest, false);
  assert.deepEqual(plan.map((p) => p.field).sort(), ['channel', 'title']);
  // Untouched entry is byte-identical.
  assert.equal(JSON.stringify(next[0]), JSON.stringify(feed[0]));
  // The installer link never moves.
  assert.deepEqual(next[1].assets, feed[1].assets);
});

test('THE DOCS CASE: a notes rewrite leaves every other field alone', () => {
  const feed = [rel('0.2.0', { latest: true, title: 'The real XENO Docs' })];
  const { next, plan } = amendEntry({ feed, version: '0.2.0', changes: { notes: 'corrected' } });
  assert.deepEqual(plan.map((p) => p.field), ['notes']);
  assert.equal(next[0].notes, 'corrected');
  for (const k of ['version', 'date', 'latest', 'type', 'channel', 'severity', 'title']) {
    assert.deepEqual(next[0][k], feed[0][k], `${k} must not move`);
  }
  assert.deepEqual(next[0].assets, feed[0].assets);
});

test('an unrecognised type is REFUSED — ReleaseFeed renders it as the Release badge', () => {
  const feed = [rel('0.1.0')];
  assert.throws(() => amendEntry({ feed, version: '0.1.0', changes: { type: 'alpha' } }), AmendRefused);
  assert.throws(() => amendEntry({ feed, version: '0.1.0', changes: { channel: 'alpha' } }), AmendRefused);
  assert.throws(() => amendEntry({ feed, version: '0.1.0', changes: { severity: 'urgent' } }), AmendRefused);
});

test('version, date and assets are NOT amendable', () => {
  const feed = [rel('0.1.0')];
  for (const field of ['version', 'date', 'assets']) {
    assert.throws(() => amendEntry({ feed, version: '0.1.0', changes: { [field]: 'x' } }), AmendRefused, field);
  }
});

test('an empty or missing feed refuses rather than seeding one', () => {
  assert.throws(() => amendEntry({ feed: [], version: '0.1.0', changes: { channel: 'beta' } }), AmendRefused);
  assert.throws(() => amendEntry({ feed: null, version: '0.1.0', changes: { channel: 'beta' } }), AmendRefused);
});

test('a version that is not live, or is live twice, refuses', () => {
  assert.throws(() => amendEntry({ feed: [rel('0.1.0')], version: '9.9.9', changes: { channel: 'beta' } }), AmendRefused);
  const dupe = [rel('0.1.0'), rel('0.1.0', { channel: 'beta' })];
  assert.throws(() => amendEntry({ feed: dupe, version: '0.1.0', changes: { title: 'x' } }), AmendRefused);
});

test('empty notes refuse — notes are REQUIRED by the schema', () => {
  assert.throws(() => amendEntry({ feed: [rel('0.1.0')], version: '0.1.0', changes: { notes: '   ' } }), AmendRefused);
});

test('the pointer notes rule matches xeno-release buildVersionJson (title wins, 400 cap)', () => {
  assert.equal(derivedPointerNotes({ title: 'T', notes: 'N' }), 'T');
  assert.equal(derivedPointerNotes({ notes: 'N' }), 'N');
  assert.equal(derivedPointerNotes({ notes: 'x'.repeat(500) }).length, 400);
});

test('IMPORTING THIS MODULE MUST NOT WRITE ANYTHING (2026-07-26 incident)', () => {
  // A bare import already happened at the top of this file. Prove the entry-point
  // guard holds for a child process too: no args → refuse, no network, no rclone.
  const script = join(HERE, 'amend-release-entry.mjs');
  let out = '';
  try {
    out = execFileSync(process.execPath, [script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  assert.match(out, /REFUSED/);
  assert.match(out, /Nothing was written/);
});
