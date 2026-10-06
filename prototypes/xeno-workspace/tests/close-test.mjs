import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href; const w = (ms) => new Promise((r) => setTimeout(r, ms));
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.goto(url + '#/overview'); await w(600);
const open = () => p.evaluate(() => [...document.querySelectorAll('#rzone .rcat[aria-expanded="true"]')].map((x) => x.dataset.cat).join(',') || '-');
const trays = () => p.evaluate(() => document.querySelectorAll('#rzone .rcat-kids:not(.closing)').length);
await p.click('#rail [data-cat="studio"]'); await w(300); await p.click('#rail [data-zone="studio-generate"]'); await w(500);
console.log('on Studio>Generate:', await open(), await trays());
await p.click('#rail [data-cat="studio"]'); await w(400); console.log('close Studio while on its area:', await open(), await trays());
await p.click('#rail [data-go="projects"]'); await w(400); console.log('navigate elsewhere, still closed:', await open());
await p.goBack(); await w(500); console.log('come back to the area (re-arrival opens once):', await open());
await p.click('#rail [data-cat="studio"]'); await w(400); console.log('close again:', await open());
await p.click('#rail [data-cat="studio"]'); await w(400); console.log('reopen:', await open());
for (let i = 0; i < 6; i++) { await p.click('#rail [data-cat="dev"]'); await w(60); }
await w(400); console.log('6 fast toggles of Dev (even = closed):', await open(), 'trays', await trays());
console.log('errors', errs); await b.close();
