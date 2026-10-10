import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f) => p.evaluate(f);
await p.setViewport({ width: 1440, height: 900 });
for (const start of ['#/overview', '#/studio']) {
  await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.adOn', 'true'); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); }); await p.goto(url + start); await wait(700);
  await p.click('#logo', { button: 'right' }); await wait(300); await ev(() => document.querySelector('[data-adaptive]').click()); await wait(400);
  ok(await ev(() => location.hash === '#/adaptive'), `${start} → Adaptive`);
  await p.click('#logo', { button: 'right' }); await wait(300);
  ok(await ev(() => /Adaptive/.test(document.querySelector('.msw-ph .ttl')?.textContent || '') && !!document.querySelector('[data-mode="studio"]')), 'switcher in Adaptive is titled Adaptive and lists every mode');
  await ev(() => document.querySelector('[data-mode="overview"]').click()); await wait(500);
  ok(await ev(() => location.hash === '#/overview'), `from Adaptive, choosing Overview lands on Overview (${await ev(() => window.XENO_ADDR.current())})`);
  await p.click('#logo', { button: 'right' }); await wait(300);
  await ev(() => document.querySelector('[data-mode="studio"]')?.click()); await wait(500);
  ok(await ev(() => location.hash.startsWith('#/studio')), `then choosing Studio lands in Studio (${await ev(() => window.XENO_ADDR.current())})`);
}
// a poisoned memory from before the fix is cleaned on load
await ev(() => localStorage.setItem('xw.last', JSON.stringify({ overview: { view: 'adaptive' } }))); await p.goto(url + '#/studio'); await wait(600);
await p.click('#logo', { button: 'right' }); await wait(300); await ev(() => document.querySelector('[data-mode="overview"]').click()); await wait(500);
ok(await ev(() => location.hash === '#/overview'), 'an old saved "Adaptive" place no longer hijacks Overview');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs); await b.close();
