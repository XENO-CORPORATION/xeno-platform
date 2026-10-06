import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const geo = () => p.evaluate(() => { const m = document.getElementById('main'), r = m.getBoundingClientRect(), cs = getComputedStyle(m), rail = document.getElementById('rail').getBoundingClientRect();
  return { panel: document.documentElement.dataset.panel, l: Math.round(r.left), t: Math.round(r.top), r: Math.round(innerWidth - r.right), b: Math.round(innerHeight - r.bottom), radius: cs.borderTopLeftRadius, railR: Math.round(rail.right) }; });
const toggle = async () => { await p.keyboard.down('Control'); await p.keyboard.press('Backslash'); await p.keyboard.up('Control'); await wait(450); };
for (const [W, H] of [[1440, 900], [1920, 1080]]) {
  await p.setViewport({ width: W, height: H }); await p.goto(url); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });
  for (const r of ['overview', 'overview/g/projects', 'studio/p/chat']) {
    await p.goto(url + '#/' + r); await p.reload(); await wait(700);
    let g = await geo(); if (g.panel !== 'open') { await toggle(); g = await geo(); }
    ok(g.panel === 'open' && g.t > 0 && g.r > 0 && g.b > 0 && parseFloat(g.radius) > 0, `${W}x${H} ${r} sidebar open: a card — gaps ${g.t}/${g.r}/${g.b}px, radius ${g.radius}`);
    await toggle(); g = await geo();
    ok(g.panel === 'closed' && g.t === 0 && g.r === 0 && g.b === 0 && g.l === g.railR && parseFloat(g.radius) === 0, `${W}x${H} ${r} sidebar closed: full width and height — left ${g.l} (rail ends ${g.railR}), gaps ${g.t}/${g.r}/${g.b}px, radius ${g.radius}`);
    await toggle();
  }
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
