import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'], protocolTimeout: 60000 }); const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a); const idle = () => p.evaluate(() => window.XENO_NET?.idle?.());
const nav = async (h) => { await p.goto(url + '#/' + h); await p.reload(); await wait(900); await idle(); };
const click = (sel, txt) => ev((s, t) => { const n = [...document.querySelectorAll(s)].find((e) => !t || e.textContent.includes(t)); if (!n) throw new Error('no ' + s + ' ' + t); n.click(); }, sel, txt ?? null).then(() => wait(250)).then(idle);
const dlg = () => ev(() => [...document.querySelectorAll('.xd')].pop()?.textContent || '');
const submit = async (ms = 600) => { await ev(() => [...document.querySelectorAll('.xd')].pop().querySelector('[data-xd-submit], .xd-foot .xd-btn:not(.ghost)').click()); await wait(ms); };
const cancel = () => ev(() => [...document.querySelectorAll('.xd')].pop().querySelector('[data-xd-cancel], .xd-foot .xd-btn.ghost').click()).then(() => wait(300)).then(idle);
const mode = (m, r = 'owner') => ev((a, c) => { window.XENO_NET.setMode(a); window.XENO_ROLE.set(c); window.XW.render(); }, m, r).then(() => wait(200)).then(idle);
const E = () => ev(() => JSON.parse(localStorage.getItem('xw.mkEnts') || '{}'));
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url);
await ev(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.workspace', '"xeno"'); });
await nav('overview'); ok(await ev(() => /Prototype/.test(document.getElementById('net-chip')?.textContent || '')), 'the prototype chip shows the network and role being simulated');
// slow: the control that started it shows pending and can't be pressed twice
await mode('slow'); await nav('overview/g/market/Brand checker'); await click('#main [data-xa="getListing"]');
await ev(() => [...document.querySelectorAll('.xd')].pop().querySelector('[data-xd-submit], .xd-foot .xd-btn:not(.ghost)').click()); await wait(600);
ok(await ev(() => document.getElementById('net-bar')?.classList.contains('on')), 'a slow request shows “Saving…” while it is in flight');
ok(!(await E()).lst_1, 'and nothing is owned until the server says yes'); await wait(4200);
ok((await E()).lst_1?.state === 'active', 'then it lands');
// flaky: a payment fails, says you weren't charged, retry lands once
await mode('flaky'); await nav('overview/g/market/SaaS onboarding blueprint'); await click('#main [data-xa="getListing"]'); await submit(700);
let d = await dlg(); ok(/didn’t go through/.test(d) && /not charged/.test(d) && /can’t charge twice/.test(d), 'a failed payment says you were not charged and retrying can’t charge twice');
await submit(700); ok((await E()).lst_4?.state === 'active', 'Try again completes it');
const lg = await ev(() => window.XENO_NET_LOG.filter((x) => x.op === 'market.purchase').slice(-2)); ok(lg.length === 2 && lg[0].key && lg[0].key === lg[1].key, 'the retry reuses the same idempotency key');
// offline: cancel a subscription → rolled back to exactly what was there
await mode('normal'); await nav('overview/g/market/Brand checker'); await mode('offline');
await click('#main [data-mk="cancel"]'); await submit(700); d = await dlg(); ok(/offline/.test(d), 'offline says nothing was sent'); await cancel();
ok((await E()).lst_1.state === 'active' && /Renews/.test(await ev(() => document.querySelector('#main .mk-ent').textContent)), 'and the subscription is exactly as it was — rolled back, not half-changed');
// refuse: the server says no even if the client offered the button
await mode('refuse'); await click('#main [data-mk="cancel"]'); await submit(700); d = await dlg(); ok(/aren’t allowed/.test(d), 'a refusal says who can do it instead'); await cancel();
// funding through the same door
await mode('flaky'); await nav('studio/g/projects/Brand refresh/Funding'); const n0 = await ev(() => JSON.parse(localStorage.getItem('xw.funding') || '{}')['Brand refresh']?.contribs.length || 4);
await click('#main [data-fd="contribute"]'); await submit(700); d = await dlg(); ok(/Contributing didn’t go through/.test(d), 'a contribution that fails says so'); await cancel();
ok((await ev(() => JSON.parse(localStorage.getItem('xw.funding'))['Brand refresh'].contribs.length)) === n0, 'and no contribution was recorded');
const lots = await ev(() => JSON.parse(localStorage.getItem('xw.lots') || 'null')); ok(!lots || lots.filter((l) => l.kind === 'paid').reduce((n, l) => n + l.amount, 0) === 2400, 'and your credits were not taken');
// roles
await mode('normal', 'member'); await nav('overview/g/market/Postgres MCP'); ok(/Ask an admin to get it/.test(await ev(() => document.querySelector('#main .mk-buy').textContent)), 'a member asks an admin instead of buying for the workspace');
await click('#main [data-mk="request"]'); await wait(400); ok(/Requested/.test(await ev(() => document.querySelector('#main .mk-buy').textContent)), 'and sees the request is waiting');
await nav('overview/g/market/Seller console'); ok(/Selling is for owners and admins/.test(await ev(() => document.querySelector('#main').textContent)), 'the seller console explains it is for owners and admins');
await nav('studio/g/projects/Brand refresh/Funding'); ok(!(await ev(() => !!document.querySelector('#main [data-fd="approve"]'))) && (await ev(() => !!document.querySelector('#main [data-fd="contribute"]'))), 'in funding a member can contribute but not approve');
await mode('normal', 'guest'); await nav('overview/g/projects/Home reno/Funding'); ok(/visible to the project’s members/.test(await ev(() => document.querySelector('#main').textContent)), 'a guest sees that funding is for members');
await nav('overview/g/market/Postgres MCP'); ok(/Guests can’t add/.test(await ev(() => document.querySelector('#main .mk-buy').textContent)), 'a guest can browse but not add');
await mode('normal', 'owner');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
