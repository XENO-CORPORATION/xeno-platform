/**
 * A streamed chat reply appears WHOLE WORDS at a time, in a real browser (owner, 2026-11-14: "if the full word is
 * done it should appear the full word in its place, not letter by letter").
 *
 * Bundles the chat's own SmoothedReply (src/components/playground/Chat/SmoothedReply.tsx) with the same markdown
 * steps the reply uses (remark-gfm, rehype-raw), streams bursts that end in the MIDDLE of words, and reads the drawn
 * text on every animation frame:
 *   - no frame shows part of a word (every frame is a prefix of the final text ending at a word boundary);
 *   - the newest words are wrapped in span.xa-w (the fade), and nothing inside code is;
 *   - the reply ends with the whole text drawn;
 *   - a reply that is not streaming when first drawn (history) is shown whole in its first frame;
 *   - ChatWithLLM draws its reply through SmoothedReply, with the fade step last.
 * Mutation check: drawing `text` instead of `smoothed.text` shows half words and fails the first check.
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'xeno-smooth-'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✘'} ${name}${ok || !detail ? '' : ` — ${detail}`}`); };

const entry = join(dir, 'entry.tsx');
writeFileSync(entry, `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { SmoothedReply, revealTailPlugins } from ${JSON.stringify(join(ROOT, 'src/components/playground/Chat/SmoothedReply.tsx'))};

function Reply({ id, initial, initialStreaming }) {
  const [state, setState] = useState({ text: initial, streaming: initialStreaming });
  window['set_' + id] = (text, streaming) => setState({ text, streaming });
  return <div id={id}><SmoothedReply text={state.text} streaming={state.streaming}>{(smoothed) => (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, ...revealTailPlugins(smoothed)]}>{smoothed.text}</ReactMarkdown>
  )}</SmoothedReply></div>;
}
const HISTORY = 'An earlier reply that was already finished when the chat opened.';
createRoot(document.getElementById('root')).render(<>
  <Reply id="live" initial="" initialStreaming={true} />
  <Reply id="history" initial={HISTORY} initialStreaming={false} />
</>);
`);

let browser;
try {
  await build({
    entryPoints: [entry], bundle: true, outfile: join(dir, 'bundle.js'), format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')],
  });
  const css = `@keyframes xa-reveal{from{opacity:0}to{opacity:1}} span.xa-w{animation:xa-reveal 180ms ease-out both}`;
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div><script src="bundle.js"></script></body></html>`);

  browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + join(dir, 'index.html').replace(/\\/g, '/'));
  await page.waitForFunction(() => typeof window.set_live === 'function');

  const historyFirst = await page.evaluate(() => document.getElementById('history').innerText.trim());
  check('a reply that is not streaming when first drawn is shown whole at once', historyFirst === 'An earlier reply that was already finished when the chat opened.', historyFirst);

  const FINAL = 'The axe head is a broad wedge with a curved cutting edge, seen from behind in the first-person view.\n\n```js\nconst blade = "steel";\n```\n\nThat keeps the grip readable.';
  // Bursts cut words in half, as a model's tokens do.
  const cuts = [7, 13, 22, 31, 44, 52, 66, 79, 90, 101, 118, 131, 140, 152, FINAL.length];
  const frames = await page.evaluate(async (FINAL, cuts) => {
    const seen = [];
    let stop = false;
    const el = document.getElementById('live');
    const sample = () => { seen.push({ text: el.innerText, spans: el.querySelectorAll('span.xa-w').length, codeSpans: el.querySelectorAll('code span.xa-w, pre span.xa-w').length }); if (!stop) requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
    for (const cut of cuts) { window.set_live(FINAL.slice(0, cut), true); await new Promise((r) => setTimeout(r, 45)); }
    window.set_live(FINAL, false);
    await new Promise((r) => setTimeout(r, 2500));
    stop = true;
    return seen;
  }, FINAL, cuts);

  // Compare as words: innerText reflows markdown, so compare the sequence of words drawn against the final words.
  const finalWords = FINAL.replace(/```js|```/g, ' ').split(/\s+/).filter(Boolean);
  const partial = [];
  for (const f of frames) {
    const words = f.text.split(/\s+/).filter(Boolean);
    words.forEach((w, i) => { if (w !== finalWords[i] && !partial.includes(w)) partial.push(w); });
  }
  check(`no frame shows part of a word (${frames.length} frames)`, partial.length === 0, `half words seen: ${partial.slice(0, 5).join(', ')}`);
  check('the newest words fade in (span.xa-w appears while streaming)', frames.some((f) => f.spans > 0));
  check('nothing inside code is wrapped for the fade', frames.every((f) => f.codeSpans === 0));
  const last = frames[frames.length - 1];
  check('the reply ends with the whole text drawn', last.text.split(/\s+/).filter(Boolean).join(' ') === finalWords.join(' '), last.text);
  check('the page raised no errors', errors.length === 0, errors.join('; '));

  const src = readFileSync(join(ROOT, 'src/components/playground/Chat/ChatWithLLM.tsx'), 'utf8');
  check('ChatWithLLM draws its reply parts from the smoothed text', /<SmoothedReply[\s\S]{0,400}turnBodyParts\(message\.turn, smoothed\.text\)/.test(src));
  check('the fade step comes last, after raw HTML and math', /rehypePlugins=\{\[rehypeRaw, rehypeChatKatex, \.\.\.\(partIndex === lastTextPart \? revealTailPlugins\(smoothed\) : \[\]\)\]\}/.test(src));
  const themeCss = readFileSync(join(ROOT, 'src/components/playground/Chat/chat-theme.css'), 'utf8');
  check('the chat stylesheet carries the fade and turns it off for reduced motion', /@keyframes xa-reveal/.test(themeCss) && /prefers-reduced-motion: reduce\)\s*\{\s*span\.xa-w\s*\{\s*animation: none/.test(themeCss));
} catch (err) {
  check('the test ran', false, err?.stack || String(err));
} finally {
  await browser?.close();
  rmSync(dir, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
