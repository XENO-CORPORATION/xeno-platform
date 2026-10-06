import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f) => p.evaluate(f);
const st = () => ev(() => ({ state: document.querySelector('.mw').dataset.state, view: document.querySelector('.mi-stage').dataset.view, demo: document.querySelector('.mw-prod.open .mi-win')?.dataset.demo || null, hash: location.hash }));
await p.setViewport({ width: 1600, height: 950 }); await p.goto(url); await ev(() => localStorage.clear()); await p.goto(url + '#/studio'); await p.reload(); await wait(1200);
// sidebar view: click a section row → its product opens, from your click, no stand-in cursor
await p.click('#modeIntro .mw .mi-zone[data-p]'); await wait(200);
ok(!(await ev(() => document.querySelector('.mw-cursor').classList.contains('on'))), 'your own click does not summon the stand-in cursor');
await wait(700); let s = await st();
ok(s.state === 'product' && s.view === 'product' && !!s.demo, `clicking a section in the mini sidebar opens its product (${s.demo})`);
ok(s.hash === '#/studio', 'and nothing reached the real app (address unchanged)');
await p.screenshot({ path: 'mwint-1.png' });
// close it → home
await p.click('#modeIntro .mw-prod .mw-x'); await wait(700); s = await st();
ok(s.state === 'home' && s.view === 'home' && !s.demo, 'the window\'s close returns to the home');
// home: click a work tile → product
await p.click('#modeIntro .mw-home .hw-t'); await wait(800); s = await st();
ok(s.state === 'product' && !!s.demo && s.hash === '#/studio', `clicking your work on the mini home opens it there (${s.demo}), not in the app`);
await p.click('#modeIntro .mw-prod .mw-x'); await wait(600);
// rail: search → list → pick
await p.click('#modeIntro .mw [data-r="search"]'); await wait(350);
ok(await ev(() => document.querySelector('.mw-kbar').classList.contains('list') && document.querySelectorAll('.mw-krow').length >= 3), 'rail search opens Ctrl K with the mode\'s products');
await p.screenshot({ path: 'mwint-2.png' });
await p.click('#modeIntro .mw-krow'); await wait(800); s = await st();
ok(s.state === 'product' && !!s.demo && await ev(() => !document.querySelector('.mw-kbar').classList.contains('on')), `picking one opens it and closes the bar (${s.demo})`);
// rail pin
await p.click('#modeIntro .mw-pin'); await wait(800); s = await st();
ok(s.state === 'product' && !!s.demo, `a rail pin opens its product (${s.demo})`);
// open-sidebar button when collapsed
await p.click('#modeIntro .mw-prod .mw-x'); await wait(700);
await p.click('#modeIntro .mw-open'); await wait(800); s = await st();
ok(s.state === 'sidebar' && s.view === 'sidebar', 'the open-sidebar button brings the sidebar back');
// the home's own actions inside the preview never run
await p.click('#modeIntro [data-mi-view="home"]'); await wait(900);
await ev(() => document.querySelector('#modeIntro .mw-home [data-hmn-do]')?.click()); await wait(300);
ok(await ev(() => !JSON.stringify(JSON.parse(localStorage.getItem('xw.doneN') || '{}')).includes('Approved')), 'Approve inside the mini home does not approve anything for real');
ok(await ev(() => [...document.querySelectorAll('#modeIntro .mw button')].every((x) => x.tabIndex === -1)), 'nothing in the miniature takes keyboard focus');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs); await b.close();
