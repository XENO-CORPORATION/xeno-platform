/**
 * A big paste becomes a `Pasted text.txt` file; a small one stays inline.
 *
 * ## Why (2026-09-26)
 * The composer had no paste handling: a pasted transcript or log went inline as a wall of text,
 * pushing the reply and every earlier turn off-screen. ChatGPT diverts a large paste into a
 * `Pasted text.txt` attachment. The decision (threshold, plain-text-only) is pure so it is tested
 * against the exact cases; the file it produces travels the SAME upload path as a picked file, so
 * the model reads it, it saves to the Library, and it opens in the right-side Context Panel.
 *
 * Mutation-checked:
 *   - lower/raise the threshold          -> the boundary cases flip
 *   - drop the hasFiles guard            -> "a paste carrying files is left alone" fails
 *   - rename the produced file           -> the file-name case fails
 *   - stop calling it from the composer  -> the reachability test fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const chat = readFileSync(join(ROOT, 'src', 'components', 'playground', 'Chat', 'ChatWithLLM.tsx'), 'utf8').replace(/\r\n/g, '\n');

const vite = await createServer({ appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
try {
  const { PASTE_TO_FILE_MIN_CHARS, pasteBecomesFile, makePastedTextFile, pastedFiles } = await vite.ssrLoadModule('/src/components/playground/Chat/chatPaste.ts');

  test('the threshold is 2000 (the owner decision)', () => {
    assert.equal(PASTE_TO_FILE_MIN_CHARS, 2000);
  });

  test('a plain-text paste AT or ABOVE the threshold becomes a file; below it stays inline', () => {
    assert.equal(pasteBecomesFile({ text: 'x'.repeat(2000), hasFiles: false }), true, 'exactly at the threshold converts');
    assert.equal(pasteBecomesFile({ text: 'x'.repeat(1999), hasFiles: false }), false, 'one under stays inline');
    assert.equal(pasteBecomesFile({ text: 'a short question', hasFiles: false }), false);
    assert.equal(pasteBecomesFile({ text: '', hasFiles: false }), false);
  });

  test('a paste that carries real files/images is left to the browser, however long its text', () => {
    assert.equal(pasteBecomesFile({ text: 'x'.repeat(5000), hasFiles: true }), false);
  });

  test('the produced attachment is a text/plain File named "Pasted text.txt" carrying the FULL text (never truncated)', () => {
    const text = 'line\n'.repeat(3000);
    const file = makePastedTextFile(text);
    assert.equal(file.name, 'Pasted text.txt');
    assert.equal(file.type, 'text/plain');
    assert.equal(file.size, Buffer.byteLength(text), 'the whole paste is in the file');
  });

  test('a pasted screenshot/image/file is returned as files (files first, items as fallback), clipboard images renamed', () => {
    const png = new File(['x'], 'image.png', { type: 'image/png' });
    const doc = new File(['y'], 'report.pdf', { type: 'application/pdf' });
    assert.deepEqual(pastedFiles({ files: [png, doc] }).map((f) => f.name), ['Pasted image.png', 'report.pdf']);
    assert.deepEqual(pastedFiles({ files: [], items: [{ kind: 'string', getAsFile: () => null }, { kind: 'file', getAsFile: () => png }] }).map((f) => f.name), ['Pasted image.png']);
    assert.deepEqual(pastedFiles({ files: [], items: [] }), []);
    assert.deepEqual(pastedFiles(null), []);
  });

  test('the composer attaches pasted files BEFORE the text rule, through the shared upload path', () => {
    assert.match(chat, /const files = pastedFiles\(event\.clipboardData\);\n\s*if \(files\.length\) \{ event\.preventDefault\(\); void attachFileObjects\(files\); return; \}/);
  });

  test('the composer REACHES it: onPaste is wired and routes a diverted paste through the shared upload path', () => {
    assert.match(chat, /onPaste=\{handleComposerPaste\}/);
    assert.match(chat, /if \(!pasteBecomesFile\(\{ text: pasted, hasFiles \}\)\) return;/);
    assert.match(chat, /void attachFileObjects\(\[makePastedTextFile\(pasted\)\]\)/);
    // attachFileObjects is the SAME path the file picker uses (no second upload implementation)
    // (the picker can target a queued prompt — `queuedId` — and it is still the one upload path)
    assert.match(chat, /const handleFileSelected = async[\s\S]{0,260}await attachFileObjects\(Array\.from\(files\)(, queuedId)?\)/);
    // ...and the upload inside it saves to the Library as a `chat-attachment` (2026-10-02: each placed
    // file uploads itself, so the call reads the placeholder's own File).
    assert.match(chat.slice(chat.indexOf('const attachFileObjects = async'), chat.indexOf('const handleFileSelected = async')),
      /libraryService\.upload\(f\.fileObject as File, 'chat-attachment'\)/);
  });
} finally {
  await vite.close();
}
