/**
 * Math in model replies renders; money stays money; code is never touched.
 *
 * ## Why (2026-10-02)
 * A reply showed "$\rightarrow$" as raw source: the main chat had no math rendering at all. The PDF
 * and Word chats did, with remark-math's default single-dollar math, so "costs $5 and $10" there
 * rendered "5 and " as a formula. One setup (src/lib/chatMath.ts) now serves every chat renderer.
 *
 * These tests render through the REAL pipeline — react-markdown + remark-gfm + remark-math +
 * rehype-katex, exactly as the chat composes them — and assert on the HTML, not on our own
 * pre-pass alone: a pre-pass can be "correct" while the renderer still shows the source.
 *
 * Mutation-checked:
 *   - let the scan skip past a non-closing dollar to a later one  -> "$5 and $10 and x$" fails
 *   - drop the code-span hold                                      -> the inline-code case fails
 *   - stop converting \( \)                                        -> the \( \) case fails
 *   - forget to wire a chat renderer                               -> "every chat renderer" fails
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
  const M = await vite.ssrLoadModule('/src/lib/chatMath.ts');
  // React is CommonJS, so it loads natively; only the TypeScript module goes through Vite.
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const ReactMarkdown = (await import('react-markdown')).default;
  const remarkGfm = (await import('remark-gfm')).default;

  const html = (md) => renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, M.remarkChatMath],
    rehypePlugins: [M.rehypeChatKatex],
  }, M.normalizeChatMath(md)));
  const mathCount = (h) => (h.match(/class="katex"/g) || []).length;
  // What a sighted reader sees. KaTeX keeps the LaTeX source in a hidden MathML <annotation> for
  // screen readers — correct, and not "source shown".
  const text = (h) => h.replace(/<annotation[\s\S]*?<\/annotation>/g, '').replace(/<[^>]+>/g, '');

  test('the reported reply: $\\rightarrow$ renders as an arrow, not as source', () => {
    const h = html('**"Cross-account S3 access"** $\\rightarrow$ **Both sides must allow**');
    assert.equal(mathCount(h), 1);
    assert.match(h, /→/, 'KaTeX drew the arrow');
    assert.doesNotMatch(text(h), /\\rightarrow/, 'the LaTeX source is not shown');
  });

  test('inline, display, \\( \\) and \\[ \\] all render', () => {
    assert.equal(mathCount(html('Energy is $E = mc^2$ here.')), 1);
    assert.equal(mathCount(html('Solve $2x + 1 = 5$ first.')), 1, 'math that starts with a digit still renders');
    assert.equal(mathCount(html('Inline \\(a^2 + b^2\\) too.')), 1);
    const display = html('Before\n\n\\[\n\\int_0^1 x\\,dx\n\\]\n\nAfter');
    assert.match(display, /class="katex-display"/, '\\[ \\] on its own lines is display math');
    assert.match(html('$$\n\\sum_{i=1}^n i\n$$'), /class="katex-display"/);
  });

  test('🔴 money stays money', () => {
    for (const md of [
      'It costs $5 and $10.',
      'Between $5-$10 per month.',
      'Price: $5.',
      'Pay $1,200 now or $1,300 later.',
      '$5 and $10 and x$',
      'US$ 20 or $ 30',
      'From $10 to $20 and x$',
      // No digits, so only the "the NEXT dollar decides" rule keeps this from pairing `$USD … rate$`.
      'Quote in $USD or $ EUR at the daily rate$',
    ]) {
      const h = html(md);
      assert.equal(mathCount(h), 0, `no formula in: ${md}`);
      assert.equal(text(h).split('$').length, md.split('$').length, `every dollar sign still shown in: ${md}`);
    }
  });

  test('a dollar in code is code: inline code and fenced blocks are untouched', () => {
    const inline = html('Run `echo $HOME and $PATH` then');
    assert.equal(mathCount(inline), 0);
    assert.match(inline, /<code>echo \$HOME and \$PATH<\/code>/, 'no backslash added inside code');
    const fenced = html('```bash\nexport A=$B\necho "$x$"\n```');
    assert.equal(mathCount(fenced), 0);
    assert.match(fenced, /export A=\$B\necho &quot;\$x\$&quot;/);
  });

  test('a half-streamed formula never throws and never swallows the reply', () => {
    assert.doesNotThrow(() => html('The ratio is $\\frac{1}{'));
    assert.match(text(html('The ratio is $\\frac{1}{')), /The ratio is \$\\frac\{1\}\{/, 'shown as text until it closes');
    assert.doesNotThrow(() => html('Bad $\\notacommand{x}$ formula'));
  });

  test('an escaped dollar stays a dollar, and math cannot become a link', () => {
    assert.equal(mathCount(html('Literal \\$5 and \\$10')), 0);
    const h = html('$\\href{https://evil.example}{x}$');
    assert.doesNotMatch(h, /href="https:\/\/evil/, 'trust:false keeps \\href inert');
  });

  test('every chat renderer of model replies uses the shared setup', () => {
    const sites = {
      'src/components/playground/Chat/ChatWithLLM.tsx': 2,
      'src/components/playground/Chat/ChatWithVoice.tsx': 1,
      'src/components/playground/Chat/SearchChatInterface.tsx': 1,
      'src/components/playground/Office/PDFChatInterface.tsx': 1,
      'src/components/playground/Office/WordChatInterface.tsx': 1,
      'src/components/playground/Studio/ImageStudio/components/ChatMessages.tsx': 3,
    };
    for (const [rel, n] of Object.entries(sites)) {
      const src = read(rel);
      assert.equal((src.match(/remarkChatMath/g) || []).length - 1, n, `${rel}: ${n} renderer(s) with remarkChatMath`);
      assert.equal((src.match(/normalizeChatMath\(/g) || []).length, n, `${rel}: every renderer pre-passes its text`);
      assert.doesNotMatch(src, /remarkPlugins=\{\[[^\]]*\bremarkMath\b/, `${rel}: no bare remarkMath (single-dollar money bug)`);
    }
  });
} finally {
  await vite.close();
}
