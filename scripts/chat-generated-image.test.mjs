/**
 * The images a chat turn generated, MOUNTED — the real `ChatGeneratedImages` component, in a DOM.
 *
 * The server half is pinned by chat-image-tool / chat-image-edit; this pins the half a person sees,
 * because "the event arrived" says nothing about whether a frame was drawn, at what shape, or what
 * it shows while the library copy is still in its malware-scan quarantine:
 *
 *   - generating: a frame ALREADY the announced shape, captioned, with no image yet;
 *   - the preview the live frame carried fills that frame the moment the image exists;
 *   - once the frame knows the real pixel size, it takes that shape (16:9 arrives as 1792x1024);
 *   - a failed image keeps its frame and says why, rather than vanishing;
 *   - several images of one turn each get a frame, in order;
 *   - a stored image (no preview — a reload) is read from the library, never from a raw URL;
 *   - the chat renders these from the turn record, and the old keyword detector is gone.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import testUtils from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { act } = testUtils;
const motionStubPath = fileURLToPath(new URL('./framer-motion-test-stub.mjs', import.meta.url));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
};
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const vite = await createServer({
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  resolve: { alias: { 'framer-motion': motionStubPath } },
  server: { middlewareMode: true },
});

let dom;
try {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://xenostudio.ai/overview/chat', pretendToBeVisual: true });
  // the same globals chat-turn-transcript.test.mjs installs (navigator is a getter on Node's global)
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
    Element: dom.window.Element, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  dom.window.requestAnimationFrame = (cb) => dom.window.setTimeout(() => cb(Date.now()), 0);
  dom.window.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame;

  // The library is the network: a signed link for an asset id, never a raw URL built in the page.
  const signed = [];
  globalThis.fetch = async (url, init) => {
    const match = /\/api\/library\/assets\/([^/]+)\/link$/.exec(String(url));
    if (match && init?.method === 'POST') {
      signed.push(match[1]);
      // jsdom has no fetch/Response — Node's are the ones the component's module sees
      return new Response(JSON.stringify({ success: true, url: `https://xenostudio.ai/api/library/assets/${match[1]}/content?v=v2&sig=x` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };

  const { ChatGeneratedImages, aspectValue, frameMaxWidth } = await vite.ssrLoadModule('/src/components/playground/Chat/ChatGeneratedImage.tsx');
  const { applyTurnEvent, newTurnRecord, turnImages, closeTurnRecord } = await vite.ssrLoadModule('/src/components/playground/Chat/chatTurnTranscript.ts');

  const root = createRoot(document.getElementById('root'));
  const render = async (props) => {
    await act(async () => { root.render(React.createElement(ChatGeneratedImages, props)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    return document.getElementById('root');
  };
  const frames = (el) => [...el.querySelectorAll('figure.chat-genimage')];
  const views = (record, previews = {}) => turnImages(record).map((step) => ({ step, previewUrl: previews[step.id] }));

  // ── generating: the frame is the announced shape before the picture exists ──────────────────
  let record = applyTurnEvent(newTurnRecord(1000), { type: 'image_start', index: 0, prompt: 'A red fox in snow', aspectRatio: '16:9' }, 1100);
  let el = await render({ images: views(record), live: true });
  const generating = frames(el)[0];
  check('an image_start draws ONE frame at once, before any image exists', frames(el).length === 1 && generating?.dataset.genimageState === 'generating');
  check('the frame is ALREADY the announced 16:9 shape', generating.querySelector('.chat-genimage-frame').style.aspectRatio === String(16 / 9), generating.querySelector('.chat-genimage-frame').style.aspectRatio);
  check('a wide frame takes the full column; a tall one is narrowed so it cannot become a wall', frameMaxWidth(aspectValue('16:9')) === 560 && frameMaxWidth(aspectValue('9:16')) === 315 && generating.style.maxWidth === '560px');
  check('it says what is happening, in words, as a live status', /Creating image/.test(generating.textContent) && generating.querySelector('[role="status"]') !== null);
  check('and it shows no picture yet — nothing is drawn before it exists', generating.querySelector('img') === null);

  // ── the image lands: the preview fills that frame at once, and takes the real pixel size ───
  const PREVIEW = 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAEX/I/of';
  record = applyTurnEvent(record, { type: 'image_result', index: 0, image: { id: '11111111-2222-4333-8444-555555555555', aspectRatio: '16:9', width: 1792, height: 1024 } }, 30000);
  el = await render({ images: views(record, { 'image-1': PREVIEW }), live: true });
  const landed = frames(el)[0];
  check('image_result fills the SAME frame (one frame, not a second one)', frames(el).length === 1);
  check('the preview the live frame carried is shown immediately — the library copy is still in its scan', landed.dataset.genimageState === 'preview' && [...landed.querySelectorAll('img')].some((img) => img.getAttribute('src') === PREVIEW), landed.dataset.genimageState);
  check('the frame now takes the REAL pixel size (1792x1024), not the rounded ratio', landed.querySelector('.chat-genimage-frame').style.aspectRatio === String(1792 / 1024));
  check('the picture is described for assistive tech by the model\'s own prompt', [...landed.querySelectorAll('img')].some((img) => /A red fox in snow/.test(img.alt)));
  check('and it opens (the whole image is the target) and downloads', landed.querySelector('button.chat-genimage-open') && landed.querySelector('button[aria-label="Download image"]'));

  // the library copy was asked for while the preview showed; it stays hidden until it has LOADED
  const hiddenLib = [...landed.querySelectorAll('img')].find((img) => img.getAttribute('src') !== PREVIEW);
  check('behind the preview, the library copy is already being fetched through a signed link', signed.includes('11111111-2222-4333-8444-555555555555') && hiddenLib && /chat-genimage-img--hidden/.test(hiddenLib.className), JSON.stringify(signed));
  await act(async () => { hiddenLib.dispatchEvent(new dom.window.Event('load')); });
  check('once the library image has loaded it takes over and the preview goes — no blank frame between', frames(el)[0].dataset.genimageState === 'library' && ![...frames(el)[0].querySelectorAll('img')].some((img) => img.getAttribute('src') === PREVIEW));

  // ── a reload: no preview, so the image is read from the LIBRARY by asset id ──────────────────
  await render({ images: [], live: false });
  signed.length = 0;
  const stored = closeTurnRecord(record, 31000);
  el = await render({ images: views(stored), live: false });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  check('a reloaded image is asked of the library by its asset id (a signed link, never a raw URL in the page)', signed.includes('11111111-2222-4333-8444-555555555555'), JSON.stringify(signed));
  const libImg = frames(el)[0].querySelector('img');
  check('the library image is the signed URL the library answered with', libImg && /\/api\/library\/assets\/11111111-2222-4333-8444-555555555555\/content\?v=v2/.test(libImg.getAttribute('src') || ''), libImg?.getAttribute('src'));
  check('until it loads, the reloaded frame shows a placeholder at its own shape, not an empty box', frames(el)[0].dataset.genimageState === 'pending' && /Preparing image/.test(frames(el)[0].textContent));

  // ── failure: the frame stays and says why ─────────────────────────────────────────────────────
  let failedRecord = applyTurnEvent(newTurnRecord(1000), { type: 'image_start', index: 0, prompt: 'x', aspectRatio: '1:1' }, 1100);
  failedRecord = applyTurnEvent(failedRecord, { type: 'image_error', index: 0, code: 'image_declined', message: 'That image was declined by the content filter.' }, 5000);
  el = await render({ images: views(failedRecord), live: true });
  const failed = frames(el)[0];
  check('a failed image KEEPS its frame and says why — it never just vanishes', failed?.dataset.genimageState === 'failed' && /declined by the content filter/.test(failed.textContent) && /Image not created/.test(failed.textContent));
  check('a failed image offers nothing to open or download', !failed.querySelector('button'));

  // ── an interrupted turn: a step that never finished is not left spinning ─────────────────────
  const interrupted = applyTurnEvent(newTurnRecord(1000), { type: 'image_start', index: 0, prompt: 'x', aspectRatio: '1:1' }, 1100);
  el = await render({ images: views(interrupted), live: false });
  check('an image the turn never finished does not spin forever once the turn is over', frames(el)[0].dataset.genimageState === 'failed' && /not finished/.test(frames(el)[0].textContent));

  // ── two images in one turn: two frames, in order ──────────────────────────────────────────────
  let two = applyTurnEvent(newTurnRecord(1000), { type: 'image_start', index: 0, prompt: 'first', aspectRatio: '1:1' }, 1100);
  two = applyTurnEvent(two, { type: 'image_start', index: 1, prompt: 'second', aspectRatio: '9:16' }, 1200);
  el = await render({ images: views(two), live: true });
  check('two images of one turn get two frames, in order, each at its own shape', frames(el).length === 2 && frames(el)[0].dataset.aspect === '1:1' && frames(el)[1].dataset.aspect === '9:16');
  el = await render({ images: [], live: false });
  check('a turn that made no image renders nothing at all', el.querySelector('.chat-genimages') === null);

  // ── the chat really mounts it, from the turn record, and the old detector is gone ────────────
  // the working tree is CRLF on Windows and LF in git; read the source in one shape either way
  const chat = code(readFileSync('src/components/playground/Chat/ChatWithLLM.tsx', 'utf8').replace(/\r\n/g, '\n'));
  check('ChatWithLLM renders ChatGeneratedImages from the turn record', /turnImages\(message\.turn\)\.map\(\(step\) => \(\{[\s\S]{0,3000}<ChatGeneratedImages/.test(chat));
  check('ONE renderer for every generated image: the old square container, its dot-matrix placeholder and its hard-coded model badge are gone', !/<ImageContainer|DotMatrixImagePlaceholder|GPT Image 2/.test(chat));
  check('an older conversation\'s single saved image is drawn by the same frame', /message\.generatedImageAsset \|\| message\.imageData\)\) \{[\s\S]{0,2000}asset: message\.generatedImageAsset/.test(chat));
  check('the live image events fold into the turn record and keep the preview', /event\.type === 'image_start' \|\| event\.type === 'image_result' \|\| event\.type === 'image_error'/.test(chat) && /imagePreviews\[`image-\$\{/.test(chat));
  check('the streamed save stores the turn\'s images as attachments, so a reload has them', /turnImages\(updatedMessage\.turn\)\.some\(\(step\) => step\.assetId\)[\s\S]{0,120}attachments: messageLibraryAttachments\(updatedMessage\)/.test(chat));
  check('the keyword image detector is gone — an image request is a chat turn the model decides', !/extractedDirectPrompt|isPotentialImageRefinement|const generateImage =/.test(chat));
  check('the preview is session-only: nothing sends imagePreviews to the server', !/imagePreviews[^\n]{0,80}chatService\.addMessage|addMessage\([^)]*imagePreviews/.test(chat));
  const css = readFileSync('src/components/playground/Chat/chatGeneratedImage.css', 'utf8');
  check('every colour of the frame is a chat token (it renders in light, dim and dark)', !/#[0-9a-f]{3,8}\b/i.test(css.replace(/\.chat-genimage-action[^{]*\{[^}]*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')) && /var\(--chat-border\)/.test(css));
  check('reduced motion is honoured', /prefers-reduced-motion: reduce/.test(css));
} finally {
  await vite.close();
  dom?.window.close();
}

const failedChecks = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed`);
process.exitCode = failedChecks.length ? 1 : 0;
