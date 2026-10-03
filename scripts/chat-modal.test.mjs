/**
 * Every chat and project dialog goes through ONE primitive (ChatModal), and that primitive covers the
 * whole viewport.
 *
 * ## Why (2026-10-03)
 * "The popups for projects and chats have a blur over an area, the sidebar is not properly considered."
 * Each dialog hand-rolled its scrim: the create-project one was offset by `TASKBAR_WIDTH_PX +
 * historyWorkspaceInsetPx` so the backdrop covered only part of the screen; the library ones were
 * `absolute inset-0` (confined to a container); several sat inside transformed ancestors, where a
 * `position: fixed` element is positioned against the ancestor, not the viewport. All blurred.
 *
 * Three layers, because each catches what the others cannot:
 *   1. source: the primitive portals to document.body and carries no blur / shadow;
 *   2. COVERAGE SET: every dialog marker lives in a ChatModal and no file hand-rolls a scrim. The
 *      scanner is a pure function with a self-test proving it FAILS on the old shapes;
 *   3. a REAL render (esbuild bundle of the real component + puppeteer): mounted inside a transformed,
 *      overflow-hidden ancestor with a 52px + 260px left offset, the scrim is exactly the viewport and
 *      the card is centred on it; Esc closes only the topmost of two stacked modals; a drag that began
 *      inside the card and ended on the scrim does not close; the scroll lock survives stacking.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHAT_DIR = join(ROOT, 'src', 'components', 'playground', 'Chat');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const modalSrc = read(join(CHAT_DIR, 'ChatModal.tsx'));
const modalCss = read(join(CHAT_DIR, 'chatModal.css'));

const MARKERS = [
  'data-create-project-dialog',
  'data-project-settings-dialog',
  'data-delete-chat-dialog',
  'data-chat-settings-dialog',
  'data-project-file-preview',
  'data-project-scheduled-preview',
  'data-project-scheduled-create',
  'data-chat-files-preview',
  'data-chat-move-dialog',
  'data-chat-share-dialog',
  'data-chat-customize-dialog',
  'data-library-new-document-dialog',
  'data-library-preview-dialog',
];

/** Pure scanner: returns the list of problems in a set of { name, text } sources. */
export function scanDialogSources(files) {
  const problems = [];
  for (const { name, text } of files) {
    if (name === 'ChatModal.tsx') continue;
    text.split('\n').forEach((line, i) => {
      if (/inset-0/.test(line) && /backdrop-blur/.test(line)) problems.push(`${name}:${i + 1} a scrim with backdrop blur`);
      if (/fixed inset-0 z-\[999\]/.test(line)) problems.push(`${name}:${i + 1} a hand-rolled fixed scrim`);
      if (/fixed top-0 right-0 bottom-0/.test(line)) problems.push(`${name}:${i + 1} a scrim offset from the left`);
    });
    if (/TASKBAR_WIDTH_PX[^\n]*\n?[^\n]*historyWorkspaceInsetPx[\s\S]{0,80}backgroundColor:\s*is\w+Shown/.test(text)) {
      problems.push(`${name} a sidebar-offset scrim`);
    }
    for (const marker of MARKERS) {
      const raw = new RegExp(`(^|\\s)${marker}=("")|(^|\\s)${marker}(\\s|/|>)`).test(text.replace(/dialogProps=\{\{[^}]*\}\}/g, ''));
      if (raw) problems.push(`${name} carries ${marker} as a raw attribute instead of inside ChatModal dialogProps`);
    }
  }
  const all = files.map((f) => f.text).join('\n');
  for (const marker of MARKERS) {
    const m = new RegExp(`dialogProps=\\{\\{[^}]*'${marker}'`).exec(all);
    if (!m) problems.push(`${marker} is not attached to any ChatModal`);
  }
  for (const { name, text } of files) {
    if (name === 'ChatModal.tsx') continue;
    if (/dialogProps=\{\{/.test(text) && !/import ChatModal from '\.\/ChatModal'/.test(text)) problems.push(`${name} uses dialogProps without importing ChatModal`);
  }
  return problems;
}

const chatFiles = () => readdirSync(CHAT_DIR)
  .filter((f) => f.endsWith('.tsx'))
  .map((name) => ({ name, text: read(join(CHAT_DIR, name)) }));

test('ChatModal portals to document.body, always, and paints no blur or shadow', () => {
  assert.match(modalSrc, /createPortal\(/, 'the primitive must createPortal');
  assert.match(modalSrc, /document\.body,\s*\n?\s*\)/, 'the portal target must be document.body');
  assert.doesNotMatch(modalSrc + modalCss, /backdrop-blur|backdrop-filter|backdropFilter/, 'no backdrop blur (DESIGN_SYSTEM: plain overlay)');
  assert.doesNotMatch(modalCss.replace(/box-shadow:\s*none;/g, ''), /box-shadow/, 'no shadow on a modal');
  assert.match(modalCss, /\.chat-modal-scrim\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/, 'the scrim is fixed, inset 0');
  assert.doesNotMatch(modalCss, /\.chat-modal-scrim\s*\{[^}]*\bleft:/, 'the scrim has no left offset');
  assert.match(modalSrc, /role="dialog"/);
  assert.match(modalSrc, /aria-modal="true"/);
  assert.match(modalSrc, /useDialog/, 'focus trap / restore / refcounted scroll lock come from useDialog');
});

test('coverage set: every chat/project dialog marker is inside a ChatModal and nothing hand-rolls a scrim', () => {
  assert.deepEqual(scanDialogSources(chatFiles()), []);
});

test('the coverage scanner can fail (mutation check on the OLD shapes)', () => {
  const clean = chatFiles();
  const mutate = (name, fn) => clean.map((f) => (f.name === name ? { ...f, text: fn(f.text) } : f));
  const oldBlur = scanDialogSources(mutate('ChatMoveModal.tsx', (t) => `${t}\n<div className="chat-themed fixed inset-0 z-[999] flex backdrop-blur-sm">`));
  assert.ok(oldBlur.some((p) => /backdrop blur/.test(p)), 'a blurred scrim must be flagged');
  assert.ok(oldBlur.some((p) => /hand-rolled/.test(p)), 'a hand-rolled fixed scrim must be flagged');
  const offset = scanDialogSources(mutate('ChatWithLLM.tsx', (t) => `${t}\n<div className="fixed top-0 right-0 bottom-0 z-[1]">`));
  assert.ok(offset.some((p) => /offset from the left/.test(p)), 'the sidebar-offset scrim must be flagged');
  const raw = scanDialogSources(mutate('ChatWithLLM.tsx', (t) => t.replace("'data-delete-chat-dialog': ''", "'data-x': ''") + '\n<div data-delete-chat-dialog="">'));
  assert.ok(raw.some((p) => /data-delete-chat-dialog/.test(p)), 'a dialog marker outside ChatModal must be flagged');
});

// ── the real render ──────────────────────────────────────────────────────────────────────────────
test('rendered: scrim = viewport, card centred, inside a transformed ancestor; Esc, drag and scroll lock', async () => {
  const esbuild = await import('esbuild');
  const puppeteer = (await import('puppeteer')).default;
  const result = await esbuild.build({
    stdin: {
      resolveDir: ROOT,
      loader: 'tsx',
      sourcefile: 'chat-modal-entry.tsx',
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import ChatModal from './src/components/playground/Chat/ChatModal';
        function App() {
          const [a, setA] = React.useState(true);
          const [b, setB] = React.useState(false);
          (window as any).__openB = () => setB(true);
          return (
            <div id="host" style={{ position: 'absolute', left: 312, top: 0, width: 600, height: 400, transform: 'translateZ(0)', overflow: 'hidden', filter: 'none' }}>
              {a && <ChatModal onClose={() => setA(false)} title="First" dialogProps={{ 'data-test-a': '' }}><input id="ina" /></ChatModal>}
              {b && <ChatModal onClose={() => setB(false)} title="Second" size="sm" dialogProps={{ 'data-test-b': '' }}><input id="inb" /></ChatModal>}
            </div>
          );
        }
        createRoot(document.getElementById('root')!).render(<App />);
      `,
    },
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'css' },
    alias: { '@': join(ROOT, 'src') },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production","VITE_API_URL":""}' },
    logLevel: 'silent',
  });
  const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const css = (result.outputFiles.find((f) => f.path.endsWith('.css'))?.text) ?? modalCss;
  const tokens = `:root{--chat-canvas:#0a0a0a;--chat-surface:#171717;--chat-elevated:#262626;--chat-text:#fafafa;--chat-muted:#a3a3a3;--chat-border:#2e2e2e;--chat-hover:#303030}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${tokens}${css}body{margin:0;background:#111}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/g, '<\\/script')}</script></body></html>`;

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewport({ width: 1000, height: 700 });
    await page.setContent(html);
    await page.waitForSelector('[data-test-a]');
    await new Promise((r) => setTimeout(r, 300));

    const geo = () => page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const scrim = q('[data-chat-modal-scrim]');
      const card = q('[data-test-a]');
      const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; };
      const cs = getComputedStyle(scrim);
      const cc = getComputedStyle(card);
      return {
        scrim: r(scrim), card: r(card), vw: innerWidth, vh: innerHeight,
        parentIsBody: scrim.parentElement === document.body,
        insideHost: !!document.getElementById('host').contains(scrim),
        blur: cs.backdropFilter, shadow: cc.boxShadow, bg: cs.backgroundColor,
        focusInside: card.contains(document.activeElement) || document.activeElement === card,
        overflow: document.body.style.overflow,
      };
    });

    const g = await geo();
    assert.equal(g.parentIsBody, true, 'the scrim is a direct child of document.body');
    assert.equal(g.insideHost, false, 'the scrim is NOT inside the transformed ancestor');
    assert.deepEqual([g.scrim.l, g.scrim.t, g.scrim.w, g.scrim.h], [0, 0, g.vw, g.vh], `scrim must equal the viewport, got ${JSON.stringify(g.scrim)}`);
    assert.ok(Math.abs(g.card.l + g.card.w / 2 - g.vw / 2) <= 1, `card centred horizontally on the VIEWPORT, got ${JSON.stringify(g.card)}`);
    assert.ok(Math.abs(g.card.t + g.card.h / 2 - g.vh / 2) <= 1, `card centred vertically on the VIEWPORT, got ${JSON.stringify(g.card)}`);
    assert.ok(g.blur === 'none' || g.blur === '', `no backdrop blur, got ${g.blur}`);
    assert.equal(g.shadow, 'none', 'no box shadow on the card');
    assert.equal(g.focusInside, true, 'focus moved into the dialog');
    assert.equal(g.overflow, 'hidden', 'page scroll is locked');

    // mobile: full width minus a 12px margin
    await page.setViewport({ width: 390, height: 700 });
    await new Promise((r) => setTimeout(r, 100));
    const m = await geo();
    assert.deepEqual([m.scrim.l, m.scrim.t, m.scrim.w, m.scrim.h], [0, 0, 390, 700], 'scrim covers the mobile viewport');
    assert.ok(Math.abs(m.card.w - (390 - 24)) <= 1, `card is viewport minus 12px margins on mobile, got ${m.card.w}`);
    await page.setViewport({ width: 1000, height: 700 });

    // a drag that began INSIDE the card and was released on the scrim must not close it
    const cardBox = await page.evaluate(() => { const b = document.querySelector('[data-test-a]').getBoundingClientRect(); return { x: b.left + 20, y: b.top + 20 }; });
    await page.mouse.move(cardBox.x, cardBox.y);
    await page.mouse.down();
    await page.mouse.move(3, 3);
    await page.mouse.up();
    assert.ok(await page.$('[data-test-a]'), 'a drag that started in the card and ended on the scrim must not close it');

    // stacked: open B, Esc closes only B, then A
    await page.evaluate(() => window.__openB());
    await page.waitForSelector('[data-test-b]');
    assert.equal((await page.$$('[data-chat-modal-scrim]')).length, 2, 'each layer has its own scrim');
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(await page.$('[data-test-b]'), null, 'Esc closes the topmost modal');
    assert.ok(await page.$('[data-test-a]'), 'Esc did NOT also close the modal behind it');
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden', 'closing the top modal must not release the scroll lock');

    // backdrop click that BEGAN on the scrim closes it
    await page.mouse.click(5, 5);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(await page.$('[data-test-a]'), null, 'a click that began and ended on the scrim closes');
    assert.equal(await page.evaluate(() => document.body.style.overflow), '', 'the scroll lock is released once the last modal closes');
    assert.deepEqual(errors, [], `no page errors: ${errors.join('; ')}`);
  } finally {
    await browser.close();
  }
});
