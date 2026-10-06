import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href; const w = (ms) => new Promise((r) => setTimeout(r, ms));
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.goto(url + '#/overview'); await w(700);
const clickTrack = (cat) => p.evaluate(async (cat) => { const btn = document.querySelector(`#rail [data-cat="${cat}"]`); const y0 = btn.getBoundingClientRect().top; btn.click(); let drift = 0;
  await new Promise((res) => { const t0 = performance.now(); const f = () => { drift = Math.max(drift, Math.abs(btn.getBoundingClientRect().top - y0)); if (performance.now() - t0 < 500) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); return drift; }, cat);
const state = () => p.evaluate(() => ({ open: [...document.querySelectorAll('#rzone .rcat[aria-expanded="true"]')].map((x) => x.dataset.cat).join(','), trays: document.querySelectorAll('#rzone .rcat-kids').length }));
for (const c of ['studio', 'office', 'studio', 'dev', 'office']) { const d = await clickTrack(c); await w(300); console.log(`toggle ${c}: clicked button drift ${Math.round(d)}px`, JSON.stringify(await state())); }
await p.click('#rail [data-zone="dev-automate"]'); await w(500); console.log('click dev>automate, replaced nothing?', JSON.stringify(await state()));
await p.reload(); await w(700); console.log('after reload (persisted):', JSON.stringify(await state()));
await p.goto(url + '#/overview/z/social-message'); await w(700); console.log('deep link adds social:', JSON.stringify(await state()));
console.log('errors', errs); await b.close();
