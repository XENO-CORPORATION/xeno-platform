/**
 * A reply renders as the model wrote it: formatting markers and code are not altered.
 *
 * ## Why (2026-10-02)
 * Found while proving math rendering in a real browser:
 *   - Every answer passed through a `cleanText` that stripped one `*`/`**`/`_`/`__` from the start
 *     and end of the whole text, so an answer opening with **a bold title** lost its opening `**` and
 *     showed the closing `**` raw. It also collapsed 3+ newlines INSIDE code blocks, changing code a
 *     person copies (Python's two blank lines between functions became one).
 *   - The first line of EVERY code block sat 8px right of the rest — reported against a PLAINTEXT
 *     box-drawing block and first blamed on the model. It was the reply wrapper's `prose-code:px-2`,
 *     meant for inline code, also padding the block's <code>; inline padding shows only at the start.
 *
 * Mutation-checked:
 *   - restore the start/end marker strip       -> "bold opening survives" fails
 *   - collapse newlines inside fences again    -> "code is byte-for-byte" fails
 *   - drop padding: 0 from the code tag        -> "first line aligned" fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const vite = await createServer({ appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
try {
  const { cleanAnswerText } = await vite.ssrLoadModule('/src/components/playground/Chat/cleanAnswerText.ts');

  test('🔴 an answer that opens or closes with formatting keeps its markers', () => {
    assert.equal(cleanAnswerText('**Burn-In Filter: Policies**\n\n- item'), '**Burn-In Filter: Policies**\n\n- item');
    assert.equal(cleanAnswerText('* first bullet\n* second'), '* first bullet\n* second', 'the first bullet is not eaten');
    assert.equal(cleanAnswerText('Done. That is **all**'), 'Done. That is **all**', 'a closing bold is not left raw');
    assert.equal(cleanAnswerText('_emphasis_ first'), '_emphasis_ first');
  });

  test('code is byte-for-byte, even with blank-line runs inside it', () => {
    const py = 'Here:\n\n```python\ndef a():\n    pass\n\n\ndef b():\n    pass\n```';
    assert.equal(cleanAnswerText(py), py, "PEP 8's two blank lines between functions survive");
    const tilde = '~~~\nx\n\n\n\ny\n~~~';
    assert.equal(cleanAnswerText(tilde), tilde);
  });

  test('prose is still tidied: blank-line runs collapse and the ends are trimmed', () => {
    assert.equal(cleanAnswerText('\n\nOne\n\n\n\nTwo\n\n'), 'One\n\nTwo');
    assert.equal(cleanAnswerText(null), null);
    assert.equal(cleanAnswerText(''), null);
  });

  test('every former cleanText call in the chat uses cleanAnswerText', () => {
    const chat = read('src/components/playground/Chat/ChatWithLLM.tsx');
    assert.doesNotMatch(chat, /\bcleanText\b/, 'the marker-stripping helper is gone');
    assert.doesNotMatch(chat, /\[\*_\]\{1,2\}/, 'no start/end marker strip anywhere in the chat');
    assert.ok((chat.match(/cleanAnswerText\(/g) || []).length >= 7);
  });

  test('a code block\'s first line is aligned: its <code> takes no inline-code padding', () => {
    const block = read('src/components/playground/Chat/CodeBlockWithHeader.tsx');
    assert.match(block, /codeTagProps=\{\{ style: \{[^}]*\bpadding: 0\b[^}]*\} \}\}/,
      'the wrapper pads inline code (prose-code:px-2); without this the first line sits 8px right');
  });
} finally {
  await vite.close();
}
