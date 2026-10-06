import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f) => p.evaluate(f);
await p.setViewport({ width: 1600, height: 950 });
for (const m of ['studio', 'office', 'social', 'corpo', 'dev', 'tools']) {
  await p.goto(url); await ev(() => localStorage.clear()); await p.goto(url + '#/' + m); await p.reload(); await wait(1100);
  const side = await ev(() => { const d = document.getElementById('modeIntro'); return { open: d?.classList.contains('on'), mark: !!d?.querySelector('.mw-mark svg'), pins: d?.querySelectorAll('.mw .mi-pinrow').length, rail: d?.querySelectorAll('.mw-pin').length, tiles: d?.querySelectorAll('.mi-tile').length }; });
  await p.screenshot({ path: `all-${m}-1.png` });
  await p.click('#modeIntro [data-mi-view="home"]'); await wait(1000);
  const home = await ev(() => { const h = document.querySelector('#modeIntro .mw-home .hm2'); return { ok: !!h && document.querySelector('.mw').dataset.state === 'home', secs: h ? [...h.querySelectorAll('.hm2-h h2')].map((x) => x.textContent).join(' / ') : '' }; });
  await p.screenshot({ path: `all-${m}-2.png` });
  await p.click('#modeIntro [data-mi-view="product"]'); await wait(1600);
  const prod = await ev(() => ({ demo: document.querySelector('#modeIntro .mw-prod.open .mi-win')?.dataset.demo || null }));
  await p.screenshot({ path: `all-${m}-3.png` });
  const tile = await ev(() => document.querySelector('#modeIntro .mi-tile:not([aria-pressed="true"])')?.dataset.miPin);
  if (tile) { await p.hover(`#modeIntro [data-mi-pin="${tile}"]`); await wait(2100); }
  const hov = await ev(() => document.querySelector('#modeIntro .mw-prod.open .mi-win')?.dataset.demo || null);
  ok(side.open && side.mark && side.pins >= 1 && side.rail === side.pins && side.tiles >= 1 && home.ok && !!prod.demo && (!tile || hov === tile),
    `${m}: intro opens (mark, ${side.pins} pins in sidebar = ${side.rail} in rail, ${side.tiles} tiles) · home [${home.secs}] · product opens (${prod.demo}) · pointing opens ${tile || '—'} (${hov})`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs); await b.close();
