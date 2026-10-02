/**
 * A dropped file lands at once and becomes the real attachment IN PLACE.
 *
 * ## Why (2026-10-02)
 * Dropping images onto the composer showed nothing until every upload in the batch had returned,
 * then all the chips appeared together; and each image chip built its blob URL during render, so
 * every later state change (upload done, scan done) handed the <img> a NEW URL and it re-decoded —
 * a visible repaint, as if one picture had been swapped for another.
 *
 * Now each file is placed the instant it is dropped (an image shows its own pixels from the local
 * bytes), keeps ONE id and ONE preview URL for its whole life, and is updated in place as its upload
 * and then its scan finish. Updates find the file by id wherever it lives, so queueing the prompt
 * mid-upload no longer strands the queued copy at "scanning" forever.
 *
 * Mutation-checked:
 *   - upload before placing (await upload, then setAttachedFiles)      -> "placed before upload" fails
 *   - build the preview in render again (URL.createObjectURL in JSX)    -> "one preview URL" fails
 *   - swap the chip id for the asset id on upload                       -> "keeps its id" fails
 *   - patch the composer only                                            -> "follows it into the queue" fails
 *   - patchQueuedFile matches the wrong file                             -> the pure cases fail
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const chat = readFileSync(join(ROOT, 'src/components/playground/Chat/ChatWithLLM.tsx'), 'utf8').replace(/\r\n/g, '\n');
const slice = (src, start, end) => {
  const i = src.indexOf(start);
  assert.notEqual(i, -1, `missing: ${start}`);
  return src.slice(i, src.indexOf(end, i + start.length));
};
const attach = slice(chat, 'const attachFileObjects = async', 'const handleFileSelected = async');

test('a dropped file is placed before a single byte is uploaded', () => {
  const placedAt = attach.indexOf('setAttachedFiles(prev => [...prev, ...placed]);');
  const uploadAt = attach.indexOf('libraryService.upload(');
  assert.ok(placedAt > 0 && uploadAt > 0, 'both steps exist');
  assert.ok(placedAt < uploadAt, 'the chip is on screen before the upload starts');
  assert.match(attach, /attachedFiles: \[\.\.\.item\.attachedFiles, \.\.\.placed\]/, 'a queued prompt gets its placeholder at once too');
});

test('one preview URL per file, made when it is attached — never during render', () => {
  assert.match(attach, /previewUrl: file\.type\.startsWith\('image\/'\) \? URL\.createObjectURL\(file\) : undefined,/);
  const chips = slice(chat, '{attachedFiles.map((file) => (', '{/* Stays hand-written — the file chip');
  assert.doesNotMatch(chips, /createObjectURL/, 'a URL minted in render re-decodes the image on every state change');
  assert.match(chips, /src=\{file\.previewUrl\}/);
});

test('the chip keeps its id: the upload updates it in place, never replaces it', () => {
  const upload = slice(attach, '// 3. Upload each file', '// 4. Scan-before-send');
  assert.match(upload, /patch\(f\.id, \{ assetId: done\.assetId,/, 'the asset id is a FIELD on the same chip');
  assert.doesNotMatch(upload, /patch\(f\.id, \{[^}]*(?<![A-Za-z])id:/, 'switching the id would remount the chip — the swap this removes');
});

test('updates follow the file into a queued prompt', () => {
  const patch = slice(attach, 'const patch = (id: string, change: Partial<AttachedFile>) => {', '\n    };');
  assert.match(patch, /setAttachedFiles\(/, 'the composer copy');
  assert.match(patch, /patchQueuedFile\(prev, id, change\)/, 'and the queued copy, found by id');
});

test('a failed upload removes its chip and says so', () => {
  const upload = slice(attach, '// 3. Upload each file', '// 4. Scan-before-send');
  assert.match(upload, /drop\(f\.id\);\n\s*setProjectFileNotice\(`"\$\{f\.name\}" could not be uploaded/);
});

const vite = await createServer({ appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
try {
  const Q = await vite.ssrLoadModule('/src/components/playground/Chat/chatQueueState.ts');
  const state = () => ({
    isExpanded: true,
    messages: [
      { id: 'q1', text: 'one', timestamp: 0, attachedFiles: [{ id: 'local-a', name: 'a.png', type: 'image/png', ready: false }] },
      { id: 'q2', text: 'two', timestamp: 0, attachedFiles: [{ id: 'local-b', name: 'b.pdf', type: 'application/pdf', ready: false }] },
    ],
  });

  test('patchQueuedFile updates exactly the file with that id, in whichever prompt holds it', () => {
    const next = Q.patchQueuedFile(state(), 'local-b', { ready: true, assetId: 'asset-b' });
    assert.deepEqual(next.messages[1].attachedFiles[0], { id: 'local-b', name: 'b.pdf', type: 'application/pdf', ready: true, assetId: 'asset-b' });
    assert.equal(next.messages[0].attachedFiles[0].ready, false, 'the other prompt is untouched');
  });

  test('patchQueuedFile(null) removes the file; an unknown id returns the same state', () => {
    const s = state();
    assert.deepEqual(Q.patchQueuedFile(s, 'local-a', null).messages[0].attachedFiles, []);
    assert.equal(Q.patchQueuedFile(s, 'nope', { ready: true }), s, 'no change, no new object — no needless re-render');
  });
} finally {
  await vite.close();
}
