// A finished image in a chat reply (ChatGenerationCard, 2026-10-25), the real component in a real browser: the frame
// takes the picture's REAL shape once it loads (the request said 1:1, the model returned a portrait — no letterbox
// bars), it sits at a reading size rather than the reply's full width, and a click opens it in the Library viewer.
// AGENT_SHOTS=<dir> saves a screenshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(repo, 'scripts', 'harness', '.chat-generation-image');
const GEN = '33333333-3333-4333-8333-333333333333', ASSET = '44444444-4444-4444-8444-444444444444';

/** A solid grey PNG of the given size — real image bytes, so the browser measures a real natural size. */
function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width, 0x80)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

test('a finished chat image: its own shape, a reading size, and a click opens the Library viewer', { timeout: 120000 }, async () => {
  await mkdir(out, { recursive: true });
  await build({
    stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import '../../../src/components/playground/Chat/chat-theme.css'; import { ChatGenerationCard } from '../../../src/components/playground/Chat/StudioGenerationFeed';
      window.opened = [];
      createRoot(document.getElementById('root')).render(React.createElement('div', { className: 'chat-theme-dark chat-themed', style: { width: 820, margin: '40px auto', padding: '0 24px' } }, React.createElement(ChatGenerationCard, { id: '${GEN}', onUsePrompt: () => {}, onOpenAsset: (asset, all) => window.opened.push({ asset, all }) })));`, resolveDir: out, loader: 'tsx' },
    bundle: true, format: 'esm', outdir: out, entryNames: 'card', jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css', '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl' },
    alias: { '@': join(repo, 'src') }, define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' }, logLevel: 'error',
  });
  const image = png(690, 1000);   // portrait, though the request asked for 1:1
  const generation = { id: GEN, type: 'image', state: 'succeeded', request: { type: 'image', model: 'gpt-image-2.5-sunburst', prompt: 'A humanoid robot in a laboratory', settings: { ratio: '1:1', quality: 'high' }, referenceAssetIds: [] }, requestHash: 'h', version: 1, quote: {}, resultAssetIds: [ASSET], replacedBy: null, createdAt: new Date().toISOString(), favorite: false };
  const server = createServer(async (req, res) => {
    const p = new URL(req.url, 'http://local').pathname;
    for await (const _ of req) { /* drain */ }
    const json = (v, s = 200) => { res.statusCode = s; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(v)); };
    if (p === `/api/generations/${GEN}`) return json({ generation });
    if (p === `/api/library/assets/${ASSET}/content`) { res.setHeader('Content-Type', 'image/png'); return res.end(req.method === 'HEAD' ? undefined : image); }
    if (p === `/api/library/assets/${ASSET}/link`) return json({ url: `/files/${ASSET}.png` });
    if (p === `/files/${ASSET}.png`) { res.setHeader('Content-Type', 'image/png'); return res.end(image); }
    if (p.startsWith('/api/')) return json({}, 404);
    if (p === '/card.js' || p === '/card.css') { res.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : 'text/css'); return res.end(await readFile(join(out, p.slice(1)))); }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><link rel="stylesheet" href="/card.css"><style>body{margin:0;background:#0a0a0a;font-family:Inter,Segoe UI,system-ui,sans-serif}</style></head><body><div id="root"></div><script type="module" src="/card.js"></script></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage(); await page.setViewport({ width: 1040, height: 760 });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => { const img = document.querySelector('.sgf-chat .sgf-tile img'); return img && img.complete && img.naturalWidth > 0; }, { timeout: 15000 });
    await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.querySelector('.sgf-chat')).getPropertyValue('--sgf-ar')) - 0.69) < 0.001, { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 700));   // the reveal
    const m = await page.evaluate(() => {
      const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { w: r.width, h: r.height }; };
      const img = document.querySelector('.sgf-chat .sgf-tile img');
      const ir = img.getBoundingClientRect();
      return { tile: box('.sgf-chat .sgf-tile'), card: box('.sgf-chat .sgf-card'), reply: box('.sgf-chat'), img: { w: ir.width, h: ir.height } };
    });
    assert.ok(Math.abs(m.tile.w / m.tile.h - 0.69) < 0.01, `the frame is the picture's real shape (${(m.tile.w / m.tile.h).toFixed(3)}), not the requested 1:1`);
    assert.ok(Math.abs(m.img.w - m.tile.w) < 1 && Math.abs(m.img.h - m.tile.h) < 1, 'the picture fills its frame: no letterbox bars');
    assert.ok(m.tile.h <= 441, `at most 440px tall (${Math.round(m.tile.h)})`);
    assert.ok(m.card.w < m.reply.w - 100 && Math.abs(m.card.w - m.tile.w) < 3, `the card is as wide as the picture (${Math.round(m.card.w)}), not the reply (${Math.round(m.reply.w)})`);
    if (process.env.AGENT_SHOTS) { await mkdir(process.env.AGENT_SHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.AGENT_SHOTS, 'chat-generation-image.png') }); }
    await page.click('.sgf-chat .sgf-tile');
    const opened = await page.evaluate(() => window.opened);
    assert.deepEqual(opened, [{ asset: { assetId: ASSET, mime: 'image/png', prompt: 'A humanoid robot in a laboratory' }, all: [ASSET] }], 'a click opens this image in the Library viewer');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); server.close(); }
});
