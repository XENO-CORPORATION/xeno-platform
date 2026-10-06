import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f) => p.evaluate(f);
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });
for (const m of ['studio', 'office', 'social', 'corpo', 'dev', 'tools']) {
  await p.goto(url + '#/' + m); await wait(600);
  const r = await ev(() => { const h = document.querySelector('.hm2'); if (!h) return null; const esc = [...h.querySelectorAll('.mn')].filter((mn) => { const a = mn.getBoundingClientRect(), c = mn.parentElement.getBoundingClientRect(); return a.left < c.left - 1 || a.right > c.right + 1 || a.top < c.top - 1 || a.bottom > c.bottom + 1; }).length; return { esc, cont: !!h.querySelector('.hm2-cont') }; });
  ok(r && r.cont && r.esc === 0, `${m}: home renders, Continue present, no miniature escapes its card`);
}
await p.goto(url + '#/dev'); await wait(600);
ok(await ev(() => /2 things need you, 1 job is running/.test(document.querySelector('.hm2-greet p').textContent)), 'Dev status sentence counts only running jobs');
await p.click('.hm2 [data-hmn="n0"] [data-hmn-do]'); await wait(150);
ok(await ev(() => /Approved/.test(document.querySelector('.hm2 [data-hmn="n0"]')?.textContent || '')), 'Approve on the home completes in place');
await wait(900);
await p.click('#rail [data-go="bell"]'); await wait(400);
ok(await ev(() => !document.querySelector('#menu [data-nt="n0"]')), '…and the inbox agrees (it left the inbox)');
await p.keyboard.press('Escape'); await wait(300);
await p.click('.hm2-cont'); await wait(400);
ok(await ev(() => /p\/agent\//.test(location.hash) && /Refactor/.test(decodeURIComponent(location.hash))), 'Continue opens the last item');
await p.goto(url + '#/social'); await wait(900); await p.evaluate(() => document.querySelector('.wk-p').click()); await wait(400);
ok(await ev(() => /p\/post\//.test(location.hash)), 'a scheduled post opens in Post');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs); await b.close();
