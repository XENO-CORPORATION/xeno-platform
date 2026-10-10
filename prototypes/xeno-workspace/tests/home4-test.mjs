import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pickState = async (v) => { await p.evaluate(() => document.querySelector('.mfoot [data-pg-preview]').click()); await new Promise((r) => setTimeout(r, 120)); await p.evaluate((v) => document.querySelector(`.pg-ddm [data-v="${v}"]`).click(), v); };
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a); const idle = () => p.evaluate(() => window.XENO_NET?.idle?.());
const secs = () => ev(() => [...document.querySelectorAll('#main [data-hsec]')].map((x) => x.dataset.hsec).join(','));
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url);
await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.lastSeen.overview', String(Date.now() - 70 * 60000)); });
await p.goto(url + '#/overview'); await p.reload(); await wait(900);
ok(await secs() === 'needs,running,modes,projects,recent', `Overview default order: ${await secs()}`);
// new since last visit: sentence and tags agree
let g = await ev(() => ({ s: document.querySelector('.hm2-greet p').textContent, tags: document.querySelectorAll('.hm2-new').length }));
ok(/4 are new since you were last here, 1 h ago/.test(g.s) && g.tags === 4, `"new since last visit": sentence and ${g.tags} tags agree — "${g.s}"`);
await p.reload(); await wait(900); g = await ev(() => document.querySelectorAll('.hm2-new').length);
ok(g === 4, `within the same session the marks stay while you read (${g})`);
// customize: hide, reorder, persist, reset
await p.click('[data-home-custom]'); await wait(200);
g = await ev(() => ({ open: !!document.querySelector('.hm-cust'), exp: document.querySelector('.topbar [data-home-custom]').getAttribute('aria-expanded'), focus: document.activeElement?.getAttribute('role') }));
ok(g.open && g.exp === 'true' && g.focus === 'switch', `Customize opens with focus on the first switch (${JSON.stringify(g)})`);
await p.click('[data-hc-tog="running"]'); await wait(150); await p.click('[data-hc-mv="recent"][data-d="-1"]'); await wait(150);
ok(await secs() === 'needs,modes,recent,projects', `hide Running + move Recent up updates the page live: ${await secs()}`);
await p.keyboard.press('Escape'); await wait(100); g = await ev(() => ({ open: !!document.querySelector('.hm-cust'), focus: document.activeElement?.dataset?.homeCustom !== undefined }));
ok(!g.open && g.focus, `Escape closes it and returns focus to Customize (${JSON.stringify(g)})`);
await p.reload(); await wait(900); ok(await secs() === 'needs,modes,recent,projects', `the layout survives a reload: ${await secs()}`);
await p.goto(url + '#/dev'); await p.reload(); await wait(900); ok(await secs() === 'needs,kpis,sig,areas', `each home has its own layout — Dev untouched: ${await secs()}`);
await p.goto(url + '#/overview'); await p.reload(); await wait(900); await p.click('[data-home-custom]'); await wait(150); await p.click('[data-hc-reset]'); await wait(150);
ok(await secs() === 'needs,running,modes,projects,recent', `Reset restores the default: ${await secs()}`);
await p.keyboard.press('Escape');
// numbers: in context and linked to what they measure
await p.goto(url + '#/dev'); await p.reload(); await wait(900);
g = await ev(() => [...document.querySelectorAll('.kpi')].map((k) => [k.querySelector('b').textContent, k.querySelector('.kpi-d').textContent, !!k.querySelector('.hc svg .hc-line'), k.dataset.zone]));
ok(g.length === 3 && g.every(([v, d, s, z]) => v && /[↑↓] \d+%/.test(d) && s && z), `Dev shows 3 numbers, each with a trend, a 7-day line and a link: ${JSON.stringify(g)}`);
await ev(() => document.querySelector('.kpi').click()); await wait(500); g = await ev(() => window.XENO_ADDR.current()); ok(/#\/dev\/z\/agents/.test(g), `a number opens the area it measures (${g})`);
// error state is per section: the rest of the page still works
await p.goto(url + '#/dev'); await p.reload(); await wait(900); await pickState('error'); await wait(300);
g = await ev(() => ({ errs: document.querySelectorAll('.hm2-err').length, board: !!document.querySelector('.rb'), areas: !!document.querySelector('.hm2-areas') }));
ok(g.errs === 2 && g.board && g.areas, `Error: needs + numbers show their own error, the run board and areas still render (${JSON.stringify(g)})`);
await ev(() => document.querySelector('[data-home-retry]').click()); await wait(400); g = await ev(() => ({ errs: document.querySelectorAll('.hm2-err').length, kpis: document.querySelectorAll('.kpi').length }));
ok(g.errs === 0 && g.kpis === 3, `Try again recovers (${JSON.stringify(g)})`);
// first day: a checklist, steps tick off
await pickState('empty'); await wait(300);
g = await ev(() => ({ steps: document.querySelectorAll('.fd-steps li').length, h1: document.querySelector('.hm2 h1').textContent, cust: !!document.querySelector('.topbar [data-home-custom]') }));
ok(g.steps === 4 && /Welcome/.test(g.h1) && !g.cust, `First day: a 4-step checklist, no Customize on an empty page (${JSON.stringify(g)})`);
await ev(() => document.querySelector('[data-fd-step="dev:project"]').click()); await wait(500); await p.goBack(); await wait(500);
g = await ev(() => ({ done: document.querySelectorAll('.fd-steps li.done').length, sub: document.querySelector('.hm2-sub')?.textContent }));
ok(g.done === 1 && /1 of 4/.test(g.sub || ''), `a step you take is ticked off when you come back (${JSON.stringify(g)})`);
await pickState('normal'); await wait(300);
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
