import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f) => p.evaluate(f);
await p.setViewport({ width: 1600, height: 950 }); await p.goto(url); await ev(() => localStorage.clear()); await p.goto(url + '#/studio'); await p.reload(); await wait(1100);
await p.click('#modeIntro [data-mi-view="product"]'); await wait(1900);
const frame0 = await ev(() => document.querySelector('#modeIntro .mw-prod').getBoundingClientRect().toJSON());
// switch by clicking a rail pin yourself, and sample the window frame + the two contents every frame
const samp = p.evaluate(() => new Promise((res) => { const out = [], t0 = performance.now(); const tick = () => { const pr = document.querySelector('#modeIntro .mw-prod'), r = pr.getBoundingClientRect(), ws = [...pr.querySelectorAll('.mi-win')].map((w) => ({ id: w.dataset.demo, o: +(+getComputedStyle(w).opacity).toFixed(2) })); out.push({ t: Math.round(performance.now() - t0), x: Math.round(r.x), w: Math.round(r.width), ws }); if (performance.now() - t0 < 700) requestAnimationFrame(tick); else res(out); }; requestAnimationFrame(tick); }));
const pin2 = await ev(() => [...document.querySelectorAll('#modeIntro .mw-pin')].map((x) => x.dataset.p).find((id) => id !== document.querySelector('#modeIntro .mw-prod .mi-win')?.dataset.demo));
await p.click(`#modeIntro .mw-pin[data-p="${pin2}"]`); const fr = await samp;
ok(fr.every((f) => Math.abs(f.x - fr[0].x) <= 1 && Math.abs(f.w - fr[0].w) <= 1), `switching keeps the window frame still (x ${fr[0].x}±1, width ${fr[0].w}±1 every frame)`);
ok(fr.some((f) => f.ws.length === 2 && f.ws.every((w) => w.o > 0.05 && w.o < 0.95)), 'old and new product crossfade (both partly visible mid-switch)');
ok(fr[fr.length - 1].ws.length === 1 && fr[fr.length - 1].ws[0].id === pin2 && fr[fr.length - 1].ws[0].o === 1, `it settles on ${pin2}, fully shown, old one removed`);
await p.screenshot({ path: 'swap-end.png' });
// close returns home without flying into the corner
await p.click('#modeIntro .mw-prod .mw-x'); await wait(60);
const origin = await ev(() => getComputedStyle(document.querySelector('#modeIntro .mw-prod')).transformOrigin);
ok(/^(\d+(\.\d+)?)px/.test(origin) && parseFloat(origin) > 200, `close shrinks in place, not into the rail (origin ${origin})`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs); await b.close();
