/**
 * Download cleanup must never throw — a throw on the 15-minute interval
 * exits the process and Cloudflare answers 502 until the next restart.
 *
 * The live crash was unlinkSync on `downloads/cookies` (a directory).
 * This suite exercises the helper against a real temp dir and pins that
 * the interval path cannot call unlink on a directory.
 *
 * Does NOT import downloadService.js: that file mkdir's cookies/ and
 * starts the interval.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { purgeOrphanedDownloadFiles } from '../src/server/services/purgeOrphanedDownloadFiles.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE = readFileSync(join(ROOT, 'src', 'server', 'services', 'downloadService.js'), 'utf8');
const HOUR = 60 * 60 * 1000;

function extractFrom(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return '';
  const from = src.slice(start);
  const brace = from.indexOf('{');
  if (brace === -1) return from.slice(0, 4000);
  let depth = 0;
  let inStr = null;
  let escaped = false;
  for (let i = brace; i < from.length; i++) {
    const c = from[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      inStr = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return from.slice(0, i + 1);
    }
  }
  return from.slice(0, 4000);
}

test('unlinking the cookies directory throws EISDIR — that is the production crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xeno-dl-eisdir-'));
  const cookies = join(dir, 'cookies');
  mkdirSync(cookies);
  try {
    assert.throws(
      () => unlinkSync(cookies),
      (err) => err && (err.code === 'EISDIR' || err.code === 'EPERM'),
      'unlinking a directory must throw (Linux EISDIR, Windows EPERM)',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('purge skips cookies/ even when it is older than the cutoff, and never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xeno-dl-purge-'));
  try {
    const cookies = join(dir, 'cookies');
    mkdirSync(cookies);
    writeFileSync(join(cookies, 'cookies-user.txt'), 'jar');
    writeFileSync(join(dir, 'old.bin'), 'x');
    writeFileSync(join(dir, 'fresh.bin'), 'y');
    const old = new Date(Date.now() - 2 * HOUR);
    utimesSync(cookies, old, old);
    utimesSync(join(dir, 'old.bin'), old, old);

    let removed;
    assert.doesNotThrow(() => {
      removed = purgeOrphanedDownloadFiles(dir, HOUR);
    });
    assert.deepEqual(removed, ['old.bin']);
    assert.ok(existsSync(cookies), 'cookies/ must survive — those jars are not orphans');
    assert.ok(existsSync(join(cookies, 'cookies-user.txt')));
    assert.equal(existsSync(join(dir, 'old.bin')), false);
    assert.ok(existsSync(join(dir, 'fresh.bin')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cleanupOldDownloads delegates to the helper and cannot unlinkSync a readdir entry', () => {
  const body = extractFrom(SERVICE, 'export const cleanupOldDownloads');
  assert.match(
    body,
    /purgeOrphanedDownloadFiles\(DOWNLOADS_DIR/,
    'cleanupOldDownloads must call the helper — a local unlink loop is the crash.',
  );
  assert.doesNotMatch(
    body,
    /unlinkSync/,
    'cleanupOldDownloads must not unlink itself. That is how cookies/ took the process down.',
  );
  assert.match(body, /try\s*\{/, 'the cleanup function itself must be try/caught');
});

test('the interval cannot throw into uncaughtException', () => {
  assert.match(
    SERVICE,
    /setInterval\(\(\)\s*=>\s*\{\s*try/,
    'the timer callback must wrap cleanupOldDownloads. An uncaught throw exits the API.',
  );
  assert.match(
    SERVICE,
    /cleanupTimer\.unref/,
    'unref the timer so importing the module in a test cannot pin the process open.',
  );
});
