import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
await p.setViewport({ width: 1280, height: 640 }); await p.goto(url); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });
const scan = () => p.evaluate(() => { const out = []; let scrollers = 0; document.querySelectorAll('*').forEach((n) => { const cs = getComputedStyle(n); if (!/(auto|scroll)/.test(cs.overflowY + cs.overflowX) || n.offsetParent === null && n !== document.body) return; const bar = n.offsetWidth - n.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth); if (n.scrollHeight > n.clientHeight + 1) scrollers++; if (bar > 0.5) out.push((n.id || n.className || n.tagName) + ':' + bar); }); return { out, scrollers }; });
for (const r of ['overview', 'studio', 'dev', 'overview/g/library', 'overview/g/projects', 'overview/g/inbox', 'studio/p/chat', 'dev/z/agents', 'overview/g/workspace/Members']) {
  await p.goto(url + '#/' + r); await p.reload(); await wait(700); const g = await scan();
  ok(!g.out.length, `${r}: ${g.scrollers} scrolling containers, visible scrollbars: ${g.out.join(', ') || 'none'}`);
}
// still scrolls with the wheel
await p.goto(url + '#/overview/g/library'); await p.reload(); await wait(700); await p.mouse.move(900, 400); await p.mouse.wheel({ deltaY: 600 }); await wait(400);
const st = await p.evaluate(() => document.querySelector('#main .mview').scrollTop); ok(st > 100, `the Library still scrolls with the wheel (scrollTop ${st})`);
// popovers and the intro sheet too
await p.goto(url + '#/overview'); await p.reload(); await wait(600); await p.click('#rail [data-go="bell"]'); await wait(400); let g = await scan(); ok(!g.out.length, `Notifications open: ${g.out.join(', ') || 'no scrollbars'}`);
await p.keyboard.press('Escape'); await p.evaluate(() => localStorage.removeItem('xw.introSeen')); await p.goto(url + '#/dev'); await p.reload(); await wait(900); g = await scan(); ok(!g.out.length, `Dev first-run sheet: ${g.out.join(', ') || 'no scrollbars'}`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
