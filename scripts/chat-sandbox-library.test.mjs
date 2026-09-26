/**
 * A run's produced files are surfaced as managed Library assets (CHAT-CODE-EXECUTION-SPEC.md §7).
 *
 * Uses a stub registrar (the shape of registerManagedLibraryFile) + a temp uploads dir, so it proves
 * the surfacing logic — bytes written to disk, correct registration shape, best-effort — without
 * standing up the whole Library schema. The real registrar is exercised in production by the same call.
 *
 * Mutation-checked: drop the try/catch in surfaceRunFilesToLibrary and "best-effort" fails; drop the
 * userId/uploadsDir guard and "refuses without deps" fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { surfaceRunFilesToLibrary } from '../src/server/services/sandboxSession.js';

const b64 = (s) => Buffer.from(s).toString('base64');

test('produced files are written to the uploads dir and registered, and returned with asset ids', async () => {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'xeno-lib-'));
  const calls = [];
  const register = async (_db, args) => { calls.push(args); return { id: `asset-${calls.length}` }; };

  const out = await surfaceRunFilesToLibrary({
    db: {},
    userId: 'user-1',
    uploadsDir,
    register,
    conversationId: 'conv-1',
    files: [
      { path: 'chart.png', content: b64('PNGDATA') },
      { path: 'out/report.csv', content: b64('a,b\n1,2') },
    ],
  });

  assert.equal(out.length, 2);
  assert.deepEqual(out.map((a) => a.path), ['chart.png', 'out/report.csv']);
  assert.deepEqual(out.map((a) => a.assetId), ['asset-1', 'asset-2']);

  // each registration names the person, is personal-scoped, and carries provenance
  for (const c of calls) {
    assert.equal(c.userId, 'user-1');
    assert.equal(c.workspaceId, null);
    assert.equal(c.metadata.source, 'chat-sandbox');
    assert.equal(c.metadata.conversationId, 'conv-1');
    assert.ok(existsSync(c.storagePath), 'the bytes were written to disk for the registrar to read');
  }
  // original name is the sandbox-relative path; bytes match
  assert.equal(calls[0].originalName, 'chart.png');
  assert.equal(readFileSync(calls[1].storagePath, 'utf8'), 'a,b\n1,2');
  assert.equal(calls[1].fileSize, Buffer.byteLength('a,b\n1,2'));
});

test('a registrar failure is swallowed — a Library problem never fails the run (best-effort)', async () => {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'xeno-lib-'));
  const register = async () => { throw new Error('library down'); };
  const out = await surfaceRunFilesToLibrary({ db: {}, userId: 'u', uploadsDir, register, conversationId: 'c', files: [{ path: 'x.txt', content: b64('x') }] });
  assert.deepEqual(out, [], 'no assets, but no throw');
});

test('refuses without the injected deps (no userId / uploadsDir / register)', async () => {
  const files = [{ path: 'x.txt', content: b64('x') }];
  assert.deepEqual(await surfaceRunFilesToLibrary({ db: {}, userId: null, uploadsDir: '/tmp', register: async () => ({ id: '1' }), files }), []);
  assert.deepEqual(await surfaceRunFilesToLibrary({ db: {}, userId: 'u', uploadsDir: null, register: async () => ({ id: '1' }), files }), []);
  assert.deepEqual(await surfaceRunFilesToLibrary({ db: {}, userId: 'u', uploadsDir: '/tmp', register: null, files }), []);
});
