/**
 * Scan-before-send: an attachment enters a conversation only once the server says it is clean.
 *
 * ## Why (2026-09-30)
 * The composer waited ~38 s for each upload's malware scan and then marked the file ready ANYWAY.
 * The scanner takes ~17 s per file and works through them one at a time, so six images needed ~2
 * minutes: the composer unlocked at 15:49:02 with one of six scanned, the user sent, the server
 * correctly refused to save a message referencing unscanned files, and the message was lost —
 * while every image the user clicked said it was still being scanned.
 *
 * Reproduced in a real browser against production's scan timing: the old code saved the message at
 * 45 s with five files unscanned; this code holds it and saves at ~135 s, once all six are clean.
 *
 * Mutation-checked:
 *   - release on timeout again (`.then(() => patch(f.id, { ready: true }))`) -> "never released unscanned" fails
 *   - drop the server's `blocked` field                          -> "the status route" fails
 *   - stop removing a blocked file                               -> "a blocked file is removed" fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const chat = read('src/components/playground/Chat/ChatWithLLM.tsx');
const service = read('src/services/libraryService.ts');
const routes = read('src/server/routes/libraryRoutes.js');

const slice = (src, start, end) => {
  const i = src.indexOf(start);
  assert.notEqual(i, -1, `missing: ${start}`);
  return src.slice(i, src.indexOf(end, i + start.length));
};

test('the status route says ready, still scanning, or blocked — and blocked only for malware', () => {
  const handler = slice(routes, "router.get('/assets/:id/status'", "router.post('/assets/:id/ingestions/retry'");
  assert.match(handler, /ready: file\.ingestion_safe !== false,/);
  assert.match(handler, /blocked: file\.ingestion_error_code === 'malware_detected',/,
    'the one terminal verdict besides ready');
});

test('the client reads three answers and fails closed', () => {
  const fn = slice(service, 'async assetScanStatus(', '\n  },');
  assert.match(fn, /if \(!response\.ok\) return 'pending';/, 'a failed request is NOT ready');
  assert.match(fn, /if \(body\?\.ready === true\) return 'ready';/, 'only an explicit ready is ready');
  assert.match(fn, /return body\?\.blocked === true \? 'blocked' : 'pending';/);
});

test('🔴 a file is never released unscanned: the wait ends only on a verdict', () => {
  const wait = slice(chat, 'const waitForAssetReady = async', '\n  };');
  assert.match(wait, /if \(status !== 'pending'\) return status;/, 'only ready/blocked end the wait early');
  assert.match(wait, /return 'gave-up';/, 'the ceiling yields a verdict that is NOT ready');
  const attach = slice(chat, 'const attachFileObjects = async', 'const handleFileSelected = async');
  assert.doesNotMatch(attach, /waitForAssetReady\([^)]*\)\.then\(\(\) =>/,
    'a .then that ignores the verdict marks an unscanned file ready — the 2026-09-30 defect');
  assert.match(attach, /uploading: true,\n\s*ready: false,/, 'a placed file is unsendable from its first frame');
  const scan = slice(attach, '// 4. Scan-before-send', 'const now = Date.now();');
  assert.match(scan, /if \(verdict === 'ready'\) \{ patch\(f\.id, \{ ready: true \}\); return; \}/,
    'ready flips only on a ready verdict — in the composer AND in a queued prompt (patch reaches both)');
});

test('a blocked file is removed, and the person is told why', () => {
  const attach = slice(chat, 'const attachFileObjects = async', 'const handleFileSelected = async');
  assert.match(attach, /if \(verdict === 'blocked'\) drop\(f\.id\);/);
  const drop = slice(attach, 'const drop = (id: string) => {', '\n    };');
  assert.match(drop, /setAttachedFiles\(/, 'removed from the composer');
  assert.match(drop, /patchQueuedFile\(prev, id, null\)/, 'and from any queued prompt holding it');
  assert.match(chat, /was blocked by the security scan and was removed\./);
  assert.match(chat, /is still being scanned\. Remove it, or keep waiting/);
});

test('send stays gated on every attachment being ready', () => {
  assert.match(chat, /attachedFiles\.some\(f => f\.ready === false\)/, 'the send button reads the same flag');
});
