import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]); /* the OS setting must not decide a motion test */ const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a);
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });
await p.goto(url + '#/overview/g/library/Images'); await p.reload(); await wait(1000);
const plate = () => ev(() => { const s = document.querySelector('#panel .pbody > .psel'), c = [...document.querySelectorAll('#panel .pv .row[aria-current="true"]')][0]; if (!s) return null; const r = s.getBoundingClientRect(), cr = c?.getBoundingClientRect(); return { on: s.classList.contains('on'), y: Math.round(r.top), h: Math.round(r.height), cy: cr && Math.round(cr.top), ch: cr && Math.round(cr.height), cur: c?.textContent.trim(), stripe: c ? getComputedStyle(c, '::before').content : '', rowBg: c ? getComputedStyle(c).backgroundColor : '' }; });
let g = await plate();
ok(g && g.on && g.y === g.cy && g.h === g.ch, `a plate sits exactly on the current item (${JSON.stringify(g)})`);
ok(g.stripe === 'none' || g.stripe === '', `no vertical stripe on the selected item (::before content ${g.stripe})`);
ok(/rgba\(0, 0, 0, 0\)|transparent/.test(g.rowBg), `the row's own fill steps aside for the plate (${g.rowBg})`);
// move down to a row far below: the plate travels (an intermediate frame exists)
const target = await ev(() => { const r = [...document.querySelectorAll('#panel .pv .row')].find((x) => /Starred/.test(x.textContent)); return !!r; });
const y0 = g.y;
await ev(() => [...document.querySelectorAll('#panel .pv .row')].find((x) => /Starred/.test(x.textContent)).click());
const frames = []; for (let i = 0; i < 12; i++) { await wait(25); const f = await plate(); frames.push(f?.y); }
await wait(400); g = await plate();
const mid = frames.filter((y) => y > y0 + 8 && y < g.y - 8);
ok(target && g.cur?.startsWith('Starred') && g.y === g.cy, `selecting Starred moves the plate onto it (${g.cur} @ ${g.y})`);
ok(mid.length >= 2, `…and it SLIDES top to bottom rather than jumping (${mid.length} in-between frames: ${frames.join(',')})`);
// back up: travels upward
const y1 = g.y; await ev(() => [...document.querySelectorAll('#panel .pv .row')].find((x) => /^Video/.test(x.textContent.trim())).click());
const up = []; for (let i = 0; i < 10; i++) { await wait(25); up.push((await plate())?.y); } await wait(400); g = await plate();
ok(up.some((y) => y < y1 - 8 && y > g.y + 8) && g.cur.startsWith('Video'), `…and back up to Video (${up.join(',')})`);
// fold: the section collapses with motion, the plate follows its row
const h0 = await ev(() => document.querySelector('#panel .sec[data-sec] .sbody').getBoundingClientRect().height);
await ev(() => { const s = [...document.querySelectorAll('#panel .sec')].find((x) => x.querySelector('.sbody .row') && !x.querySelector('[aria-current="true"]')); window.__fs = s; s.querySelector('[data-fold]').click(); });
await wait(90); const hm = await ev(() => window.__fs.querySelector('.sbody').getBoundingClientRect().height); await wait(400);
const hz = await ev(() => window.__fs.querySelector('.sbody').getBoundingClientRect().height); g = await plate();
ok(hm > 0 && hz === 0, `folding a section animates its height (${Math.round(hm)} mid → ${hz})`);
ok(g.y === g.cy, `the plate stays on its row after rows above it moved (${g.y} vs ${g.cy})`);
await ev(() => window.__fs.querySelector('[data-fold]').click()); await wait(90); const ho = await ev(() => window.__fs.querySelector('.sbody').getBoundingClientRect().height); await wait(400);
const hf = await ev(() => window.__fs.querySelector('.sbody').getBoundingClientRect().height); ok(ho > 0 && ho < hf, `re-opening grows it back with motion (${Math.round(ho)} mid → ${Math.round(hf)})`);
const rows0 = await ev(() => [...document.querySelectorAll('#panel .sec.closed .row')].filter((r) => r.offsetParent).length); ok(rows0 === 0, `rows in a closed section leave the layout (${rows0} still laid out)`);
// keyboard: arrows walk the list
await ev(() => [...document.querySelectorAll('#panel .pv .row')].find((x) => /^Video/.test(x.textContent.trim())).focus());
await p.keyboard.press('ArrowDown'); let f1 = await ev(() => document.activeElement.textContent.trim());
await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp'); let f2 = await ev(() => document.activeElement.textContent.trim());
await p.keyboard.press('End'); let f3 = await ev(() => document.activeElement.textContent.trim());
ok(/^Audio/.test(f1) && /^Images/.test(f2) && /^Trash/.test(f3), `↑ ↓ End move through the list (${f1} / ${f2} / ${f3})`);
// a route that rebuilds the whole panel still glides from the old spot
await p.goto(url + '#/dev'); await wait(900); await ev(() => document.querySelector('#panel .pv .row[data-item]')?.click()); await wait(500); g = await plate();
ok(!g || !g.cur || g.y === g.cy, `other modes: plate on the current item when there is one (${JSON.stringify(g)})`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
