import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] }); const p = await b.newPage();
await p.setViewport({ width: 1440, height: 700 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const w = (ms) => new Promise((r) => setTimeout(r, ms)); const url = pathToFileURL(path.resolve('index.html')).href;
await p.goto(url); await p.evaluate(() => { try { localStorage.clear(); } catch {} }); await p.goto(url + '#/social/p/post'); await w(600);
await p.evaluate(() => { window.__pv = document.querySelector('#panel > .pv'); document.querySelector('#panel > .pv .pbody').scrollTop = 40; });
for (const it of ['Calendar', 'Queue', 'Drafts']) { await p.click(`#panel > .pv [data-item="${it}"]`); await w(250); }
console.log('same panel node after 3 clicks:', await p.evaluate(() => window.__pv === document.querySelector('#panel > .pv')),
  '| marked:', await p.evaluate(() => [...document.querySelectorAll('#panel > .pv [aria-current="true"]')].map((x) => x.dataset.item).join(',')),
  '| hash:', await p.evaluate(() => window.XENO_ADDR.current()));
await p.goBack(); await w(300); console.log('browser back keeps panel:', await p.evaluate(() => window.__pv === document.querySelector('#panel > .pv')), await p.evaluate(() => window.XENO_ADDR.current()));
await p.click('#rail [data-go="chat"]'); await w(400); console.log('different panel redraws:', await p.evaluate(() => window.__pv !== document.querySelector('#panel > .pv')));
await p.goto(url + '#/studio'); await w(500); console.log('product marks:', await p.evaluate(() => document.querySelectorAll('#panel > .pv .row[data-product] img').length));
console.log('errors', errs); await b.close();
