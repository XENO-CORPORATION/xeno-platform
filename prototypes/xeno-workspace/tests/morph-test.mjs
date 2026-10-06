// Frame-by-frame record of the sidebar collapse/expand: every measured property must change monotonically
// (no snap backwards, no jump bigger than a frame's share) and end exactly at its target.
import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]); /* the OS setting must not decide a motion test */ const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });
const record = (dir) => p.evaluate((dir) => new Promise((done) => {
  const frames = [], t0 = performance.now();
  const snap = () => { const m = document.getElementById('main').getBoundingClientRect(), cs = getComputedStyle(document.getElementById('main')), pan = document.getElementById('panel').getBoundingClientRect();
    const cr = document.querySelector('#main .topbar .crumbs')?.getBoundingClientRect(), first = document.querySelector('#main .mview > *')?.getBoundingClientRect(), op = document.querySelector('#main .topbar .opener');
    frames.push({ t: Math.round(performance.now() - t0), mainL: m.left, mainT: m.top, mainR: innerWidth - m.right, radius: parseFloat(cs.borderTopLeftRadius), panelR: pan.right, crumbsL: cr ? cr.left : null, bodyL: first ? first.left : null, opener: op ? op.getBoundingClientRect().width : 0, openerO: op ? +getComputedStyle(op).opacity : 0 }); };
  snap(); document.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', code: 'Backslash', ctrlKey: true, bubbles: true }));
  const tick = () => { snap(); if (performance.now() - t0 < 700) requestAnimationFrame(tick); else done(frames); }; requestAnimationFrame(tick);
}), dir);
const props = ['mainL', 'mainT', 'mainR', 'radius', 'crumbsL', 'bodyL', 'opener'];
function judge(name, fr) {
  for (const k of props) {
    const v = fr.map((f) => f[k]).filter((x) => x != null); if (v.length < 3) continue;
    const total = v[v.length - 1] - v[0]; if (Math.abs(total) < 1) continue;
    const sign = Math.sign(total); let back = 0, maxStep = 0;
    const T = fr.filter((f) => f[k] != null).map((f) => f.t); let gap = 0;
    for (let i = 1; i < v.length; i++) { const d = v[i] - v[i - 1]; if (Math.sign(d) === -sign && Math.abs(d) > 0.5) back++; if (Math.abs(d) > maxStep) { maxStep = Math.abs(d); gap = T[i] - T[i - 1]; } }   // gap: how long that frame took — a dropped frame, not a snap, when it is long
    const moving = v.filter((x, i) => i && Math.abs(x - v[i - 1]) > 0.5).length;
    const snap = maxStep / Math.abs(total);
    ok(back === 0 && (snap < 0.5 || maxStep <= 8 || moving > 3 || gap > 60), `${name} ${k}: ${Math.round(v[0])} → ${Math.round(v[v.length - 1])} over ${moving} moving frames, biggest single step ${Math.round(snap * 100)}% of the change (that frame took ${gap} ms)${back ? `, ${back} steps backwards` : ''}`);
  }
}
for (const r of ['overview/g/projects', 'overview', 'studio/p/chat']) {
  await p.goto(url + '#/' + r); await p.reload(); await wait(900);
  if (await p.evaluate(() => document.documentElement.dataset.panel) !== 'open') { await p.keyboard.down('Control'); await p.keyboard.press('Backslash'); await p.keyboard.up('Control'); await wait(600); }
  judge(`${r} · close`, await record('close')); await wait(300);
  judge(`${r} · open`, await record('open')); await wait(300);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
