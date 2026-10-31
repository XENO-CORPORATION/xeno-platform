// The chat's image-approval card (GenerationRecord.tsx, design 2026-10-24), the real component in a real browser
// against a stand-in /api/generations: the settings open into the model's own options; changing one prices exactly
// that request again; approving sends the person's settings and the card follows to the version that ran; Cancel
// leaves nothing generated. AGENT_SHOTS=<dir> saves screenshots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(repo, 'scripts', 'harness', '.generation-card');
const PROPOSAL = '11111111-1111-4111-8111-111111111111', MINE = '22222222-2222-4222-8222-222222222222';
const prompt = 'A sleek, sophisticated humanoid robot standing in a modern high-tech research laboratory. The robot features polished white and brushed metal chassis panels, subtle glowing cyan LED accents along its joints and visor, and intricate mechanical details. Cinematic lighting with soft ambient blue and warm rim light, sharp focus, 8k resolution, highly detailed digital art.';
const request = (settings) => ({ type: 'image', model: 'gpt-image-2.5-sunburst', prompt, settings, referenceAssetIds: [], projectId: null, conversationId: null, area: null });

test('the image-approval card: options from the model, re-priced on change, approved as the person’s own version', { timeout: 120000 }, async () => {
  await mkdir(out, { recursive: true });
  await build({
    stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import '../../../src/components/playground/Chat/chat-theme.css'; import { GenerationRecord } from '../../../src/components/playground/Chat/GenerationRecord';
      createRoot(document.getElementById('root')).render(React.createElement('div', { className: 'chat-theme-dark chat-themed', style: { maxWidth: 820, margin: '40px auto', padding: '0 24px' } }, React.createElement(GenerationRecord, { id: '${PROPOSAL}' })));`, resolveDir: out, loader: 'tsx' },
    bundle: true, format: 'esm', outdir: out, entryNames: 'card', jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css', '.svg': 'dataurl', '.png': 'dataurl' },
    alias: { '@': join(repo, 'src') }, define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' }, logLevel: 'error',
  });
  const state = { proposal: { id: PROPOSAL, type: 'image', state: 'awaiting_approval', request: request({ ratio: '1:1', quality: 'high' }), requestHash: 'h-proposal', version: 1, quote: {}, resultAssetIds: [], replacedBy: null }, mine: null };
  const calls = [];
  const server = createServer(async (req, res) => {
    const p = new URL(req.url, 'http://local').pathname;
    let body = ''; for await (const c of req) body += c;
    const json = (v, s = 200) => { res.statusCode = s; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(v)); };
    if (p === '/api/generations/catalog') return json({ types: [{ type: 'image', available: true, models: [{ id: 'gpt-image-2.5-sunburst', type: 'image', endpoint: '/v1/images/generations', settings: { ratio: { values: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'], default: '1:1' }, quality: { values: ['low', 'medium', 'high', 'auto'], default: 'medium' } }, references: { max: 8 } }], tariff: null }] });
    if (p === '/api/generations/quote') { const r = JSON.parse(body); calls.push(['quote', r.settings]); return json({ quoteToken: 'q-' + r.settings.ratio + '-' + r.settings.quality, requestHash: 'h-' + r.settings.ratio + '-' + r.settings.quality, tariffRevision: 't1', maxRetailCredits: r.settings.quality === 'high' ? 10 : 6, expiresAt: new Date(Date.now() + 300000).toISOString() }); }
    if (p === `/api/generations/${PROPOSAL}/approve`) {
      const b = JSON.parse(body); calls.push(['approve', b]);
      state.mine = { id: MINE, type: 'image', state: 'queued', request: request(b.settings), requestHash: b.requestHash, version: 1, quote: {}, resultAssetIds: [], replacedBy: null };
      state.proposal = { ...state.proposal, state: 'cancelled', replacedBy: MINE };
      return json({ generation: state.mine });
    }
    if (p === `/api/generations/${PROPOSAL}`) return json({ generation: state.proposal });
    if (p === `/api/generations/${MINE}`) return json({ generation: state.mine });
    if (p.startsWith('/api/')) return json({}, 404);
    if (p === '/card.js' || p === '/card.css') { res.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : 'text/css'); return res.end(await readFile(join(out, p.slice(1)))); }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><link rel="stylesheet" href="/card.css"><style>body{margin:0;background:#0a0a0a;font-family:Inter,Segoe UI,system-ui,sans-serif}</style></head><body><div id="root"></div><script type="module" src="/card.js"></script></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage(); await page.setViewport({ width: 1040, height: 520 });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const shot = async (name) => { if (process.env.AGENT_SHOTS) { await mkdir(process.env.AGENT_SHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.AGENT_SHOTS, `generation-card-${name}.png`) }); } };
  const text = () => page.evaluate(() => document.body.innerText);
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => /Generate · up to 10 credits/.test(document.body.innerText), { timeout: 15000 });
    let t = await text();
    assert.match(t, /Image\s*Gpt Image 2\.5 Sunburst/); assert.match(t, /Awaiting approval/i); assert.match(t, /Nothing has been generated or charged yet\./);
    assert.ok(await page.$('.chat-q-gen-mark[data-live]') && await page.$('.chat-q-gen-state[data-live]'), 'the square pulses and the status shimmers while it waits');
    await shot('waiting');
    // Ratio opens into the model's own ratios, each drawn at its proportion
    await page.click('.chat-q-gen-pick button[data-pick]');
    const opts = await page.$$eval('.chat-q-gen-menu [role="option"]', (els) => els.map((e) => [e.textContent.trim(), !!e.querySelector('.chat-q-gen-frame i'), e.getAttribute('aria-selected')]));
    assert.deepEqual(opts.map((o) => o[0]), ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']); assert.ok(opts.every((o) => o[1]) && opts[0][2] === 'true', 'each ratio shows its frame; the current one is ticked');
    await new Promise((r) => setTimeout(r, 700));   // the options ease in one after another
    await shot('ratio-open');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Ratio\s*16:9/.test(document.body.innerText));
    // Quality, with its bars; picking Medium prices that exact request again
    await page.click('.chat-q-gen-pick:nth-child(2) button[data-pick]');
    assert.equal((await page.$$('.chat-q-gen-menu .chat-q-gen-bars')).length, 4, 'each quality shows its level');
    await page.evaluate(() => [...document.querySelectorAll('.chat-q-gen-menu [role="option"]')].find((b) => b.textContent.trim() === 'Medium').click());
    await page.waitForFunction(() => /Generate · up to 6 credits/.test(document.body.innerText));
    assert.deepEqual(calls.filter((c) => c[0] === 'quote').pop()[1], { ratio: '16:9', quality: 'medium' }, 'the price is for exactly the settings shown');
    await shot('changed');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Generate/.test(b.textContent)).click());
    await page.waitForFunction(() => /Queued/i.test(document.body.innerText) && !/Nothing has been generated/.test(document.body.innerText), { timeout: 15000 });
    const approve = calls.find((c) => c[0] === 'approve')[1];
    assert.deepEqual(approve.settings, { ratio: '16:9', quality: 'medium' }); assert.equal(approve.quoteToken, 'q-16:9-medium');
    t = await text();
    assert.match(t, /Ratio\s*16:9/); assert.equal(await page.$('.chat-q-gen-pick'), null, 'once approved the settings are fixed: plain chips, no menus');
    assert.ok(await page.$(`.chat-q-gen-wrap[data-generation-id="${MINE}"]`), 'the card now shows the person’s own generation');
    await shot('approved');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); server.close(); }
});
