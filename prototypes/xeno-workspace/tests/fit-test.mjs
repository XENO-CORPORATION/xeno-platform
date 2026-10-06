import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
for (const [W, H] of [[1440, 900], [1366, 768], [1280, 720]]) {
  await p.setViewport({ width: W, height: H, deviceScaleFactor: W === 1440 ? 2 : 1 }); await p.goto(url); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); }); await p.goto(url + '#/dev'); await wait(900);
  for (const k of ['bell', 'help', 'usage']) {
    await p.click(`#rail [data-go="${k}"]`); await wait(450);
    const r = await p.evaluate(() => { const m = document.getElementById('menu'), st = m.querySelector('.pl-stack'), rr = m.getBoundingClientRect(); return { h: Math.round(rr.height), top: Math.round(rr.top), scroll: st ? st.scrollHeight - st.clientHeight : 0 }; });
    const fit = r.scroll <= 1 && r.top >= 7;
    if (!fit) bad++;
    console.log(fit ? 'PASS' : 'FAIL', `${W}x${H} ${k}: height ${r.h}, top ${r.top}, hidden overflow ${r.scroll}px`);
    if (W === 1440) await p.screenshot({ path: `fit-${k}.png`, clip: { x: 0, y: Math.max(0, r.top - 12), width: 480, height: Math.min(r.h + 24, H - Math.max(0, r.top - 12)) } });
    await p.keyboard.press('Escape'); await wait(300);
  }
}
console.log(bad ? `${bad} FAILED` : 'ALL PASS', '| errors', errs); await b.close();
