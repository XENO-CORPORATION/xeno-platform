import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f) => p.evaluate(f);
for (const [W, H] of [[1920, 1080], [2000, 945], [1440, 900], [1280, 720]]) for (const mode of ['dev', 'studio', 'office']) {
  await p.setViewport({ width: W, height: H }); await p.goto(url); await ev(() => localStorage.clear()); await p.goto(url + '#/' + mode); await p.reload(); await wait(1100);
  const g = await ev(() => { const r = (s) => document.querySelector('#modeIntro ' + s).getBoundingClientRect(); const seg = r('.mi-seg'), cap = r('.adp-cap'), eye = r('.adx-eyebrow'), btn = r('.adx-btns'), copy = r('.mi-copy'), pick = r('.mi-pick'), def = r('.mi-defcard'), c = document.querySelector('#modeIntro .mi-copy');
    return { top: Math.round(eye.top - seg.top), bot: Math.round(btn.bottom - cap.bottom), below: Math.round(copy.bottom - btn.bottom), gapMid: Math.round(def.top - pick.bottom), ov: c.scrollHeight - c.clientHeight }; });
  ok(Math.abs(g.top) <= 4 && Math.abs(g.bot) <= 6 && g.ov <= 1 && g.gapMid >= 8, `${W}x${H} ${mode}: heading vs toggle ${g.top}px, buttons vs caption ${g.bot}px, space under buttons ${g.below}px, picker→decision ${g.gapMid}px, overflow ${g.ov}`);
  if (mode === 'dev') await p.screenshot({ path: `anchor-${W}.png` });
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs); await b.close();
