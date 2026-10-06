// Layout-shift check: capture every element's box while a view is LOADING, then again once the data has
// arrived, and require them to match. A placeholder that is the real component cannot move anything.
import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pickState = async (v) => { await p.evaluate(() => document.querySelector('.mfoot [data-pg-preview]').click()); await new Promise((r) => setTimeout(r, 120)); await p.evaluate((v) => document.querySelector(`.pg-ddm [data-v="${v}"]`).click(), v); };
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a);
const seed = () => ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });
// boxes of the elements inside a root, keyed by a stable path
const boxes = (sel) => ev((sel) => { const root = document.querySelector(sel); if (!root) return null; const R = root.getBoundingClientRect(), out = {};
  const kids = (n) => [...n.children].flatMap((c) => getComputedStyle(c).display === 'contents' ? kids(c) : [c]);   // a loading wrapper is not a level
  const walk = (n, k) => { kids(n).forEach((c, i) => { const key = k + '/' + c.tagName + i; if (c.getAnimations().some((x) => x.effect && x.effect.getTiming().iterations === Infinity && x.playState === 'running' && !/shim/.test(x.animationName || ''))) return; const r = c.getBoundingClientRect(); if (r.width || r.height) out[key] = [Math.round(r.x - R.x), Math.round(r.y - R.y), Math.round(r.width), Math.round(r.height)]; if (key.split('/').length < 9) walk(c, key); }); };
  walk(root, ''); return { out, busy: !!root.querySelector('[aria-busy="true"]') || !!root.closest('[aria-busy="true"]') || !!document.querySelector('.ghost-p, .pg--loading') }; }, sel);
const diff = (a, z) => { let moved = 0, n = 0, worst = ''; const all = []; for (const k of Object.keys(a)) { if (!z[k]) continue; n++; const d = a[k].map((v, i) => Math.abs(v - z[k][i])); if (Math.max(...d) > 1) { moved++; if (!worst) worst = `${k} ${a[k]} → ${z[k]}`; all.push(k + ' ' + a[k] + ' → ' + z[k]); } } if (process.env.V && all.length) console.log(all.slice(0, 12).join(' | ')); return { moved, n, worst }; };
await p.setViewport({ width: 1440, height: 900 });
await p.evaluateOnNewDocument(() => { window.__xwLatency = 1100; });   // a slow network, so every loading state is really on screen when measured
// 1) full pages, real first load (the page's own 360 ms load)
for (const r of ['overview/g/projects', 'overview/g/library', 'dev/z/agents', 'overview/g/workspace', 'studio/g/projects/Brand refresh', 'overview/g/market']) {
  await p.goto(url); await seed(); await p.goto(url + '#/' + r.split('/').map(encodeURIComponent).join('/')); await p.reload(); await wait(120);
  const a = await boxes('#main .pg'); await wait(1900); const z = await boxes('#main .pg');
  const d = diff(a.out, z.out); ok(a.busy && !z.busy && d.n > 10 && d.moved === 0, `${r}: loading shown (${a.busy}), ${d.n} elements compared, ${d.moved} moved ${d.worst}`);
}
// 2) homes: the inbox feed arrives after first paint
for (const r of ['overview', 'dev', 'studio', 'social']) {
  await p.goto(url); await seed(); await p.goto(url + '#/' + r); await p.reload(); await wait(120);
  const a = await boxes('#main .mview'); await wait(1300); const z = await boxes('#main .mview');
  const d = diff(a.out, z.out); ok(a.busy && !z.busy && d.n > 20 && d.moved === 0, `home ${r}: loading shown (${a.busy}), ${d.n} elements compared, ${d.moved} moved ${d.worst}`);
}
// 3) popovers and the inbox page, opened before their data exists
await p.goto(url); await seed(); await p.goto(url + '#/overview'); await p.reload(); await wait(60);
await p.click('#rail [data-go="bell"]'); await wait(220); let a = await boxes('#menu'); await wait(2000); let z = await boxes('#menu'); let d = diff(a.out, z.out);
ok(a.busy && !z.busy && d.moved === 0, `Notifications popover: ${d.n} elements compared, ${d.moved} moved ${d.worst} (loading at first look: ${a.busy}, still loading at second: ${z.busy})`);
await p.keyboard.press('Escape'); await p.goto(url); await seed(); await p.goto(url + '#/overview'); await p.reload(); await wait(60);
await p.click('#rail [data-go="usage"]'); await wait(220); a = await boxes('#menu'); await wait(2000); z = await boxes('#menu'); d = diff(a.out, z.out);
ok(a.busy && !z.busy && d.moved === 0, `Usage popover: ${d.n} elements compared, ${d.moved} moved ${d.worst}`);
await p.goto(url); await seed(); await p.goto(url + '#/overview/g/inbox'); await p.reload(); await wait(80); a = await boxes('#main .mview'); await wait(1300); z = await boxes('#main .mview'); d = diff(a.out, z.out);
ok(a.busy && !z.busy && d.moved === 0, `Inbox page: ${d.n} elements compared, ${d.moved} moved ${d.worst}`);
// 4) the preview switch: Loading → Normal on a page and a home is also shift-free
for (const [r, fam] of [['overview/g/library', 'library'], ['dev', 'home']]) {
  await p.goto(url); await seed(); await p.goto(url + '#/' + r); await p.reload(); await wait(800);
  await pickState('loading'); await wait(150); a = await boxes('#main .mview');
  await pickState('normal'); await wait(300); z = await boxes('#main .mview'); d = diff(a.out, z.out);
  ok(d.n > 10 && d.moved === 0, `preview Loading → Normal on ${r}: ${d.n} elements compared, ${d.moved} moved ${d.worst}`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
