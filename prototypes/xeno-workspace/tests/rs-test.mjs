import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message + ' @ ' + String(e.stack).split('\n')[1]));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a); const idle = () => p.evaluate(() => window.XENO_NET?.idle?.());
const go = async (it) => { await p.goto(url + '#/overview/g/workspace/' + encodeURIComponent(it)); await p.reload(); await wait(900); await idle(); };
const rs = (a, arg) => ev((x, y) => { const n = [...document.querySelectorAll('#main [data-rs]')].find((e) => e.dataset.rs === x && (y == null || e.dataset.arg === y)); n.click(); }, a, arg ?? null).then(() => wait(350)).then(idle);
const dlg = () => ev(() => { const d = [...document.querySelectorAll('.xd')].pop(); return d && { title: d.querySelector('.xd-head b')?.textContent, text: d.textContent }; });
const submit = async () => { await ev(() => [...document.querySelectorAll('.xd')].pop().querySelector('[data-xd-submit], .xd-foot .xd-btn:not(.ghost)').click()); await wait(450); await idle(); };
const pick = (f, v) => ev((f2, v2) => [...document.querySelectorAll(`.xd [data-f="${f2}"] [data-v]`)].find((x) => x.dataset.v === v2).click(), f, v);
const A = () => ev(() => JSON.parse(localStorage.getItem('xw.wf')).asg);
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.workspace', '"xeno"'); });

await go('Agents'); let g = await ev(() => [...document.querySelectorAll('#main .rs-card b')].map((x) => x.textContent));
ok(g.length === 4 && !g.includes('Scout'), `a workspace lists only the agents assigned to it — Scout (Personal) is not here (${g.join(', ')})`);
await go('All my agents'); g = await ev(() => [...document.querySelectorAll('#main .pg-tr:not(.pg-th) .pg-name')].map((x) => x.textContent)); ok(g.includes('Scout') && g.length === 5, `All my agents aggregates across workspaces (${g.join(', ')})`);
await rs('filter', 'nothere');
g = await ev(() => [...document.querySelectorAll('#main .pg-tr:not(.pg-th) .pg-name')].map((x) => x.textContent)); ok(g.join() === 'Scout', `the “Not here” filter (${g})`);
await go('Agents/Scout'); g = await ev(() => ({ b: document.querySelector('#main .pg-state b')?.textContent, acts: [...document.querySelectorAll('#main .pg-state .pg-btn')].map((x) => x.textContent) })); ok(/isn’t assigned to XENO Corp/.test(g.b) && g.acts.some((x) => /Assign it to/.test(x)), `your own agent, outside its workspaces, offers to be assigned here (${g.acts.join(' · ')})`);
await rs('home', 'Scout'); g = await ev(() => ({ ws: window.XA.currentWorkspace().name, vers: document.querySelectorAll('#main .rs-vers li').length })); ok(g.ws === 'Personal' && g.vers === 1, 'Open in Personal switches there and shows it in full');
await ev(() => window.XA.switchWorkspace('xeno')); await wait(300);
// Atlas: versions, assignments with both checks, access
await go('Agents/Atlas'); g = await ev(() => ({ vers: document.querySelectorAll('#main .rs-vers li').length, active: document.querySelector('#main .rs-vers li.on .rs-v')?.textContent, works: [...document.querySelectorAll('#main .rs-asg b')].map((x) => x.textContent), checks: [...document.querySelectorAll('#main .rs-checks li')].map((x) => x.textContent) }));
ok(g.vers === 3 && g.active === 'v4', `versions are listed with the active one marked (${g.active})`);
ok(g.works.join() === 'XENO Corp,Personal' && g.checks.length === 2, `it works in its owner and where assigned — the assignment shows both recorded checks (${g.checks.join(' / ')})`);
await rs('activate', 'Atlas|3'); g = await ev(() => document.getElementById('toast').textContent); ok(/runs already going stay on v4/.test(g), `changing the active version never moves running work (${g})`);
await rs('version', 'Atlas'); await ev(() => { const i = document.querySelector('#xdf-notes'); i.value = 'Faster summaries'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await submit();
g = await ev(() => JSON.parse(localStorage.getItem('xw.wf')).res.Atlas.versions[0]); ok(g.v === 5 && /^[0-9a-f]{7}$/.test(g.hash), `a new version gets its own hash (v${g.v} ${g.hash})`);
await rs('access', 'Atlas|invoke|managers'); g = await ev(() => JSON.parse(localStorage.getItem('xw.wf')).res.Atlas.access.invoke); ok(g === 'managers', 'access rights are separate and change one at a time');
// propose to a workspace you don't admin → waits; to one you do → accepted with both checks
await ev(() => localStorage.setItem('xw.workspaces', JSON.stringify(window.XA.workspaces().map((w) => (w.id === 'lumen' ? { ...w, sub: 'Guest · 2 projects' } : w))))); await go('Agents/Kit');
await rs('propose', 'Kit'); await pick('to', 'lumen'); await submit(); g = (await A()).find((a) => a.res === 'Kit' && a.to === 'lumen');
ok(g.state === 'proposed' && g.checks.length === 1, 'offering to someone else’s workspace waits for its admin — only the owner check so far (ASN-04)');
await rs('propose', 'Kit'); await pick('to', 'personal'); await submit(); g = (await A()).find((a) => a.res === 'Kit' && a.to === 'personal');
ok(g.state === 'accepted' && g.checks.length === 2, 'where you are admin on both sides, both checks are still recorded');
await rs('revoke', g.id); await submit(); g = (await A()).find((a) => a.id === g.id); ok(g.state === 'revoked', 'Revoke ends the assignment');
await go('Agents/Kit'); g = await ev(() => [...document.querySelectorAll('#main .rs-asg b')].map((x) => x.textContent)); ok(!g.includes('Personal'), 'and it disappears from “Works in”');
// team assignment with an explicit member set
await go('Teams/Design'); await ev(() => [...document.querySelectorAll('#main [data-rs="propose"]')][0].click()); await wait(400);
g = await dlg(); ok(/Members who come with it/.test(g.text), 'assigning a team asks which members come with it (ASN-05/06)'); await pick('to', 'personal'); await submit();
g = (await A()).find((a) => a.res === 'Design' && a.kind === 'team'); ok(g && g.members === 'explicit' && g.set.length >= 2, `the team goes with a named member set (${g && g.set.join(', ')})`);
// a workspace that doesn't hold it says so
await ev(() => localStorage.setItem('xw.workspace', '"lumen"')); await go('Agents/Atlas');
g = await ev(() => document.querySelector('#main .pg-state b')?.textContent); ok(/isn’t assigned to Lumen Studio/.test(g || ''), `elsewhere it shows “not assigned here” instead of leaking its details (${g})`);
await go('Agents'); g = await ev(() => document.querySelector('#main .pg-state b')?.textContent); ok(/No agents work in Lumen Studio/.test(g || ''), 'and that workspace’s list is honestly empty');
await go('Decisions'); g = await ev(() => document.querySelectorAll('#main .wf-dec li').length); ok(g >= 5, `every assignment is a decision on the record (${g})`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
