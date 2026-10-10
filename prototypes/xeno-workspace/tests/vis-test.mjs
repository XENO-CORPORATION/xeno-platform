import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'], protocolTimeout: 60000 }); const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a);
const as = (r) => ev((x) => sessionStorage.setItem('xw.viewAs', x), r);
const nav = async (h) => { await p.goto(url + '#/' + h); await p.reload(); await wait(800); };
const text = () => ev(() => document.querySelector('#main')?.textContent || '');
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url);
await ev(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.workspace', '"xeno"'); });
// guest
await as('guest');
await nav('overview/g/workspace'); let t = await text();
ok(/You’re a guest here/.test(t) && !/Members/.test(t.split('Shared with you')[0] || '') , 'a guest’s Workspace shows only what was shared with them');
await nav('overview/g/workspace/Members'); t = await text(); ok(!/Mira Chen|Members All/.test(t) && /guest here/.test(t), 'a guest can’t open the members list by its address');
await nav('overview/g/workspace/Company'); t = await text(); ok(!/Wallet/.test(t) && /guest here/.test(t), 'nor the company page');
await nav('studio/g/projects'); t = await text(); ok(/Home reno|Partner co-marketing/.test(t) && !/Brand refresh/.test(t), 'the project list shows only projects shared with them');
await nav('studio/g/projects/Brand refresh'); t = await text(); ok(/There’s no project here/.test(t) && !/Homepage hero/.test(t), 'a project not shared with them reads as not found — nothing leaks');
await nav('overview/g/projects/Home reno'); t = await text(); ok(!/There’s no project here/.test(t), 'a shared project opens');
await nav('overview/g/library'); const files = await ev(() => document.querySelectorAll('#main [data-pg-file]').length); ok(files >= 0 && !(await text()).includes('Launch trailer v3.mp4'), `the Library shows only files shared with them (${files})`);
await nav('overview/g/places'); ok(!(await ev(() => document.querySelectorAll('#main .pl-walks li').length)), 'Places doesn’t show the workspace’s handoffs to a guest');
await nav('overview/g/settings/Workspace'); t = await text(); ok(/Guest — you see only what was shared/.test(t) && /Owners and admins manage/.test(t), 'workspace settings say what a guest is');
await nav('overview/g/workspace'); t = await ev(() => document.querySelector('#panel')?.textContent || ''); ok(!/Members|Divisions|people/.test(t) && /Shared with you/.test(t), 'the Workspace sidebar shows only what was shared — no members or counts');
await nav('overview/g/workspace/Home reno'); await wait(300); ok(/projects\/Home/.test(await ev(() => window.XENO_ADDR.current())), 'a shared project in the guest sidebar opens that project');
await nav('studio/g/projects'); t = await ev(() => document.querySelector('#panel')?.textContent || ''); ok(!/Brand refresh|Q4 planning/.test(t) && /Home reno/.test(t), 'the Projects sidebar lists only shared projects');
await nav('overview/g/community'); ok((await ev(() => document.querySelectorAll('#main [data-pg-gitem]').length)) > 0, 'Community is still theirs');
await nav('overview/g/anima'); ok(/Atlas/.test(await text()), 'and so is their own Anima');
// member
await as('member');
await nav('overview/g/workspace/Members'); ok(/Mira/.test(await text()), 'a member sees the workspace’s people');
await nav('overview/g/workspace/Company'); t = await text(); ok(!/Every entry/.test(t) && /visible to owners and admins/.test(t) && /Legal entity/.test(t), 'a member sees the company and its legal entity, not the wallet or identifiers');
ok(!/Set up XENO Corp/.test(t), 'and isn’t shown the owner’s setup checklist');
// owner sees everything again
await as('owner'); await nav('overview/g/workspace/Company'); ok(/Every entry/.test(await text()), 'the owner sees the wallet');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
