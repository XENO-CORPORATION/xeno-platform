import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] }); const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const w = (ms) => new Promise((r) => setTimeout(r, ms)); const url = pathToFileURL(path.resolve('index.html')).href;
await p.goto(url); await p.evaluate(() => { try { localStorage.clear(); } catch {} }); await p.goto(url + '#/studio/p/chat'); await w(800);
const pos = () => p.evaluate(() => { const r = document.getElementById('apmenu').getBoundingClientRect(); return Math.round(r.left) + ',' + Math.round(r.top); });
await p.click('.live-chat [data-part="effort"]'); await w(300);
const out = [];
for (const k of [0, 1, 2, 3, 4, 5, 2]) {
  const cur = await p.evaluate(() => +document.querySelector('#aptrack .ef3-cell.cur').dataset.k);
  for (let i = cur; i < k; i++) await p.keyboard.press('ArrowRight');
  for (let i = cur; i > k; i--) await p.keyboard.press('ArrowLeft');
  await w(250);
  out.push(k + ' card=' + await pos() + ' pill=' + await p.evaluate(() => document.querySelector('.live-chat [data-part="effort"]').textContent.trim()));
}
console.log(out.join('\n'));
await p.keyboard.press('Escape'); await w(150);
for (const k of ['Minimal', 'Ultra']) {
  await p.evaluate((k) => localStorage.setItem('xw.effort', JSON.stringify(k)), k);
}
await p.click('.live-chat [data-part="effort"]'); await w(300); console.log('reopen:', await pos());
await p.click('.live-chat [data-part="model"]'); await w(300); console.log('model menu:', await pos());
console.log('errors', errs); await b.close();
