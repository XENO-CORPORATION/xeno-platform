import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url'; import fs from 'node:fs';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const src = fs.readFileSync(new URL('./pages-test.mjs', import.meta.url), 'utf8'); const routes = eval(src.slice(src.indexOf("['studio/g/projects'"), src.indexOf("];", src.indexOf("['studio/g/projects'")) + 1));
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(url); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.workspace', '"xeno"'); });
const out = {};
for (const role of ['member', 'guest']) {
  await p.evaluate((r) => sessionStorage.setItem('xw.viewAs', r), role);
  for (const r of routes) { await p.goto(url + '#/' + r); await p.reload(); await wait(500);
    const g = await p.evaluate(() => { const m = document.querySelector('#main'); if (!m) return null; const live = [...m.querySelectorAll('[data-xa],[data-wf],[data-rs],[data-co],[data-fd],[data-mk],[data-cm],[data-set],[data-pl],[data-an]')].filter((e) => !e.classList.contains('role-off') && e.getAttribute('aria-disabled') !== 'true');
      const act = (e) => Object.entries(e.dataset).find(([k]) => /^(xa|wf|rs|co|fd|mk|cm|set|pl|an)$/.test(k)); return { title: m.querySelector('.crumbs b')?.textContent, acts: [...new Set(live.map((e) => act(e)).filter(Boolean).map(([k, v]) => k + ':' + v))] }; });
    out[role + ' ' + r] = g; } }
fs.writeFileSync(new URL('./role-walk.json', import.meta.url), JSON.stringify(out, null, 1)); console.log('routes', routes.length, 'errors', errs.slice(0, 3)); await b.close();
