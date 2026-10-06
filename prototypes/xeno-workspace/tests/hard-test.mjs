import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f) => p.evaluate(f);
const open = () => ev(() => document.getElementById('modeIntro')?.classList.contains('on'));
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.adOn', 'true'); });
await p.goto(url + '#/studio'); await p.reload(); await wait(900);
ok(!(await open()), 'with every intro seen, Studio opens without one');
await p.reload(); await wait(900);
ok(!(await open()) && await ev(() => localStorage.getItem('xw.adOn') === 'true'), 'a plain reload changes nothing');
// the hard reload: the key reaches the page, then the browser reloads
await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('KeyR'); await p.keyboard.up('Shift'); await p.keyboard.up('Control');
await p.reload(); await wait(1000);
ok(await open(), 'after Ctrl Shift R, Studio shows its intro again');
ok(await ev(() => localStorage.getItem('xw.adOn') === 'false' && !(JSON.parse(localStorage.getItem('xw.introSeen') || 'null') || {}).studio), 'Adaptive is back to off, so its opt-in shows again');
ok(await ev(() => /First-run sheets restored/.test(document.getElementById('toast').textContent)), 'a toast says what happened');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs); await b.close();
