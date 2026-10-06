import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] }); const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const w = (ms) => new Promise((r) => setTimeout(r, ms)); const url = pathToFileURL(path.resolve('index.html')).href;
for (const H of [900, 768, 640, 560]) {
  await p.setViewport({ width: 1280, height: H }); await p.goto(url); await p.evaluate(() => { try { localStorage.clear(); } catch {} }); await p.goto(url + '#/corpo/z/scheduling'); await w(700);
  const r = await p.evaluate(() => { const m = document.getElementById('rmid'), q = (s) => document.querySelector(s).getBoundingClientRect();
    const av = q('.rail .avatar'), lg = q('#logo'), cur = document.querySelector('#rzone [aria-current="true"]')?.getBoundingClientRect(), mb = m.getBoundingClientRect();
    const squashed = [...document.querySelectorAll("#rmid > .rbtn, #rzone .rbtn")].some((x) => x.getBoundingClientRect().height < 35); const overlap = [...document.querySelectorAll('.rail > *')].some((x, i, arr) => i && x.getBoundingClientRect().top < arr[i - 1].getBoundingClientRect().bottom - 1);
    return { scroll: m.scrollHeight > m.clientHeight, fades: m.className, avatarIn: av.bottom <= innerHeight, logoTop: Math.round(lg.top), squashed, curVisible: cur ? cur.top >= mb.top - 1 && cur.bottom <= mb.bottom + 1 : 'none', overlap }; });
  console.log(H, JSON.stringify(r));
  if (H === 640) await p.screenshot({ path: 'rail640.png', clip: { x: 0, y: 0, width: 360, height: 640 } });
}
console.log('errors', errs); await b.close();
