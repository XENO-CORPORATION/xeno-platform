import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage();
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
for (const [W, H] of [[1920, 1080], [1440, 900], [1280, 720]]) for (const m of ['studio', 'office', 'social', 'corpo', 'dev', 'tools']) {
  await p.setViewport({ width: W, height: H }); await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.goto(url + '#/' + m); await p.reload(); await wait(900);
  const r = await p.evaluate(() => { const c = document.querySelector('#modeIntro .mi-copy'); if (!c) return null; const cr = c.getBoundingClientRect(); const out = [...c.querySelectorAll('.mi-tile, .mi-soon, .mi-defcard, .adx-btns')].filter((t) => { const r = t.getBoundingClientRect(); return r.right > cr.right + 1 || r.left < cr.left - 1 || r.bottom > cr.bottom + 1; }).length; return { out, ov: c.scrollHeight - c.clientHeight }; });
  const okk = r && r.out === 0 && r.ov <= 1; if (!okk) fails++;
  if (!okk) console.log('FAIL', W, H, m, JSON.stringify(r));
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS — no tile leaves the column, no overflow, 6 modes × 3 sizes'); await b.close();
