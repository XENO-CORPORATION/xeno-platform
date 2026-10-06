import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, msg) => console.log(c ? 'PASS' : 'FAIL', msg);
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 }); await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.goto(url + '#/studio'); await wait(700);
const geo = () => p.evaluate(() => { const m = document.getElementById('menu').getBoundingClientRect(), r = document.getElementById('rail').getBoundingClientRect(); return { left: Math.round(m.left - r.right), bottom: Math.round(innerHeight - m.bottom), top: Math.round(m.top), w: Math.round(m.width), owner: document.getElementById('menu').dataset.owner, on: document.getElementById('menu').classList.contains('on') }; });
const shot = async (n) => { const g = await p.evaluate(() => { const m = document.getElementById('menu').getBoundingClientRect(); return { y: Math.max(0, m.top - 20), h: m.height + 40 }; }); await p.screenshot({ path: n, clip: { x: 0, y: g.y, width: 480, height: Math.min(g.h, 900 - g.y) } }); };
// chip

for (const k of ['bell', 'help', 'usage']) { await p.click(`#rail [data-go="${k}"]`); await wait(300); const g = await geo(); ok(g.on && g.owner === k && g.left === 7 && g.bottom === 7, `${k}: open, owner, 7px from rail (${g.left}) and bottom (${g.bottom}), w ${g.w}`); await shot(`rp-${k}.png`);
  await p.click(`#rail [data-go="${k}"]`); await wait(250); ok(!(await geo()).on, `${k}: second click closes`); }
// notifications: focus, keyboard archive, tabs, mark all
await p.click('#rail [data-go="bell"]'); await wait(300);
ok(await p.evaluate(() => document.activeElement.classList.contains('nt2')), 'bell: first row focused on open');
const n0 = await p.evaluate(() => document.querySelectorAll('#menu .nt2').length);
await p.keyboard.press('ArrowDown'); await p.keyboard.press('e'); await wait(150);
const n1 = await p.evaluate(() => document.querySelectorAll('#menu .nt2').length);
ok(n1 === n0 - 1, `E archives the focused row (${n0} -> ${n1})`);
ok(await p.evaluate(() => document.activeElement.classList.contains('nt2')), 'focus stays in the list after archive');
await p.click('#menu [data-nt-tab="archive"]'); await wait(150);
ok(await p.evaluate(() => document.querySelectorAll('#menu .nt2').length) === 1, 'Archived tab holds the archived row');
await p.click('#menu [data-nt-tab="inbox"]'); await wait(150);
const unreadBefore = await p.evaluate(() => document.querySelectorAll('#menu .nt2.unread').length);
await p.click('#menu [data-nt-all]'); await wait(150);
ok(unreadBefore > 0 && await p.evaluate(() => document.querySelectorAll('#menu .nt2.unread').length) === 0, `Mark all read clears ${unreadBefore} unread`);
ok(await p.evaluate(() => document.querySelector('#rail [data-go="bell"] .badge')?.style.display === 'none'), 'bell badge hides when nothing unread');
await p.keyboard.press('Escape'); await wait(200);
// empty state: archive everything
await p.evaluate(() => { localStorage.setItem('xws.archN', '[]'); });
// help search
await p.click('#rail [data-go="help"]'); await wait(300);
ok(await p.evaluate(() => document.activeElement.tagName === 'INPUT'), 'help: search focused on open');
await p.keyboard.type('short'); await wait(100);
const hp = await p.evaluate(() => [...document.querySelectorAll('#menu .mi.hp')].map((x) => x.textContent.trim()));
ok(hp.length === 2 && /Keyboard shortcuts/.test(hp[0]) && /Search the docs/.test(hp[1]), 'help search filters + offers docs search: ' + hp.join(' | '));
await shot('rp-help-search.png');
await p.keyboard.press('Escape'); await wait(200);
// usage toggle
await p.click('#rail [data-go="usage"]'); await wait(300);


await p.keyboard.press('Escape'); await wait(200);
// short window
await p.setViewport({ width: 1280, height: 560, deviceScaleFactor: 1 }); await wait(200);
for (const k of ['bell', 'help', 'usage']) { await p.click(`#rail [data-go="${k}"]`); await wait(300); const g = await geo(); ok(g.top >= 7 && g.bottom === 7, `560px ${k}: top ${g.top} bottom ${g.bottom}`); await p.keyboard.press('Escape'); await wait(200); }
console.log('errors', errs); await b.close();
