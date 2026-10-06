import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] }); const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const w = (ms) => new Promise((r) => setTimeout(r, ms)); const url = pathToFileURL(path.resolve('index.html')).href;
await p.goto(url); await p.evaluate(() => { try { localStorage.clear(); } catch {} }); await p.goto(url + '#/studio'); await w(700);
const order = () => p.evaluate(() => [...document.querySelectorAll('#panel > .pv .ad-row')].map((r) => r.dataset.key).join(','));
const trace = () => p.evaluate(() => document.querySelector('#panel > .pv .ad-trace span')?.textContent || '-');
// enter from the switcher (right-click the logo)
await p.click('#logo', { button: 'right' }); await w(400);
await p.click('[data-adaptive]'); await w(500);
console.log('hash', await p.evaluate(() => location.hash), '| consent shown:', await p.evaluate(() => !!document.querySelector('.ad-consent')));
await p.screenshot({ path: 'ad-1-consent.png', clip: { x: 0, y: 0, width: 400, height: 900 } });
await p.click('[data-ad="on"]'); await w(500);
console.log('on. order:', await order());
await p.click('[data-ad="sim"]'); await w(800);
console.log('after sim 1:', await order(), '| trace:', await trace());
await p.screenshot({ path: 'ad-2-adapted.png', clip: { x: 0, y: 0, width: 400, height: 900 } });
await p.click('[data-ad="undo"]'); await w(700);
console.log('after undo:', await order(), '| pins:', await p.evaluate(() => localStorage.getItem('xw.adPins')));
// usage signal + boundary: open a product elsewhere, come back
await p.goto(url + '#/office/p/docs'); await w(400); for (let i = 0; i < 2; i++) { await p.goto(url + '#/dev/p/workflow'); await w(300); }
await p.goto(url + '#/adaptive'); await w(700);
console.log('after real use + return:', await order(), '| trace:', await trace());
await p.hover('#panel > .pv .ad-row'); await w(150);
const k = await p.evaluate(() => document.querySelector('#panel > .pv .ad-row').dataset.key);
await p.click(`[data-adpin="${k}"]`); await w(400); console.log('pinned', k, '->', await order());
await p.click('[data-ad="freeze"]'); await w(300); console.log('customs:', await p.evaluate(() => JSON.parse(localStorage.getItem('xw.customs') || '[]').map((c) => c.name).join(' | ')));
await p.click('[data-ad="off"]'); await w(500); console.log('off -> consent again:', await p.evaluate(() => !!document.querySelector('.ad-consent')), 'usage', await p.evaluate(() => localStorage.getItem('xw.adUsage')));
console.log('errors', errs); await b.close();
