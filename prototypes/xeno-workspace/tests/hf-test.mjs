import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a); const idle = () => p.evaluate(() => window.XENO_NET?.idle?.());
const nav = async (r) => { await p.goto(url + '#/' + r.split('/').map(encodeURIComponent).join('/')); await p.reload(); await wait(1500); await idle(); };
const bar = () => ev(() => ({ head: document.querySelector('.pg-top .crumbs')?.textContent, sum: document.querySelector('.pg-top-sum')?.textContent.replace(/\s+/g, ' ').trim(), acts: [...document.querySelectorAll('.pg-top-acts button')].map((x) => x.textContent.trim() || x.getAttribute('aria-label')), fresh: document.querySelector('.mfoot .sb-fresh')?.textContent.trim(), info: document.querySelector('.mfoot .sb-info')?.textContent.trim(), keys: [...document.querySelectorAll('.mfoot .sb-keys span')].map((x) => x.textContent).join(' '), h1s: document.querySelectorAll('.mview h1').length }));
await p.setViewport({ width: 1440, height: 900 }); await p.evaluateOnNewDocument(() => { window.__xwLatency = 900; });   // a slow network, so loading states are on screen when looked at await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });
// one header: title, summary and actions in the bar; no second header in the body
await nav('overview/g/projects'); let g = await bar();
g.tabs = await ev(() => [...document.querySelectorAll('.pg-top-left [role=tab]')].map((x) => x.textContent.replace(/\d+$/, '').trim())); g.tools = await ev(() => ({ search: !!document.querySelector('.pg-top-tools [data-pg-q]'), menus: document.querySelectorAll('.pg-top-tools [data-pg-dd]').length, layout: !!document.querySelector('.pg-top-tools .pg-vt'), bodyBar: !!document.querySelector('.mview .pg > .pg-bar') }));
ok(g.head === 'Projects' && g.tabs.join() === 'Active,Shared with me,Archived' && g.tools.search && g.tools.menus === 2 && g.tools.layout && !g.tools.bodyBar && g.acts.includes('New project') && g.h1s === 0, `Projects: one header row — title, view tabs, search, Mode, Sort, layout, New project; no toolbar left in the body (${JSON.stringify({ tabs: g.tabs, tools: g.tools, acts: g.acts })})`);
ok(/Updated just now/.test(g.fresh) && g.info === '5 projects · 5 active · 4 waiting on you · 1 blocked' && /Search.*Move.*Open.*Clear/.test(g.keys), `Projects status bar: "${g.fresh}" · "${g.info}" · keys "${g.keys}"`);
// the status bar follows what you do
await p.click('[data-pg-q="projects"]'); await p.keyboard.type('auth'); await wait(150); g = await bar();
ok(g.info === '1 project matching “auth”', `search updates the status bar: "${g.info}"`);
await p.keyboard.press('Escape'); await wait(100);
await nav('overview/g/library'); await ev(() => document.querySelector('[data-pg-file="lib_1001"]').click()); await wait(150); g = await bar();
ok(/^1 selected · Product shot\.png · 8\.4 MB$/.test(g.info) && /Details/.test(g.keys), `selecting a file updates it: "${g.info}"`);
// refresh is a real reload: shapes, then fresh data
await ev(() => document.querySelector('[data-pg-refresh]').click()); await wait(100); g = await bar(); const busy = await ev(() => !!document.querySelector('.pg--loading'));
ok(/Loading/.test(g.fresh) && busy, `Refresh shows loading in the bar and as shapes (${g.fresh})`);
await wait(1300); g = await bar(); ok(/Updated just now/.test(g.fresh), `…then "Updated just now" (${g.fresh})`);
// the preview is tucked away, and still works
await ev(() => document.querySelector('.mfoot [data-pg-preview]').click()); await wait(150);
g = await ev(() => ({ open: !!document.querySelector('.pg-ddm'), n: document.querySelectorAll('.pg-ddm [data-v]').length, above: document.querySelector('.pg-ddm').getBoundingClientRect().bottom <= document.querySelector('.mfoot').getBoundingClientRect().top + 1 }));
ok(g.open && g.n === 5 && g.above, `Preview opens a 5-state menu above the bar (${JSON.stringify(g)})`);
await ev(() => document.querySelector('.pg-ddm [data-v="error"]').click()); await wait(150); g = await bar(); const err = await ev(() => !!document.querySelector('.pg-state.err'));
ok(err && /Couldn't load/.test(g.fresh), `choosing Error shows the error page and the bar says so (${g.fresh})`);
await ev(() => document.querySelector('[data-pg-retry]').click()); await wait(1400); g = await bar(); ok(/Updated/.test(g.fresh), 'Try again recovers');
// object pages keep the object's title as content, the bar keeps the path
await nav('studio/g/projects/Brand refresh'); g = await bar();
ok(g.head === 'Projects/Brand refresh' && g.h1s === 0 && /4\/9/.test(g.sum) && /On track/.test(g.sum) && /Homepage hero approved/.test(g.sum) && g.acts.join() === 'More actions,Assign,New task', `project page: one header — path, progress, status, milestone and actions in the bar, nothing repeated below (${JSON.stringify({ head: g.head, h1s: g.h1s, acts: g.acts })})`);
// homes: the date in the bar, the feed's freshness and counts in the status bar — and it updates when the feed arrives
await p.goto(url + '#/overview'); await p.reload(); await wait(120); const early = (await bar()).fresh; await wait(1600); g = await bar();
ok(/Loading/.test(early) && /Updated/.test(g.fresh) && g.info === '5 need you · 2 running' && /Find.*Modes.*Sidebar/.test(g.keys) && /October|November|December|January|February|March|April|May|June|July|August|September/.test(g.sum), `Overview: "${early}" → "${g.fresh}" · "${g.info}" · date "${g.sum}"`);
await nav('dev'); g = await bar(); ok(g.info === '2 need you · 1 running', `a mode home counts its own: "${g.info}"`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
