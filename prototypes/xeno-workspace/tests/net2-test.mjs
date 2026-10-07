import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'], protocolTimeout: 60000 }); const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a); const idle = () => p.evaluate(() => window.XENO_NET?.idle?.());
const nav = async (h) => { await p.goto(url + '#/' + h); await p.reload(); await wait(900); await idle(); };
const click = (sel, txt) => ev((s, t) => { const n = [...document.querySelectorAll(s)].find((e) => !t || e.textContent.includes(t)); if (!n) throw new Error('no ' + s + ' ' + t); n.click(); }, sel, txt ?? null).then(() => wait(300)).then(idle);
const dlg = () => ev(() => [...document.querySelectorAll('.xd')].pop()?.textContent || '');
const submit = async (ms = 700) => { await ev(() => [...document.querySelectorAll('.xd')].pop().querySelector('[data-xd-submit], .xd-foot .xd-btn:not(.ghost)').click()); await wait(ms); };
const cancel = () => ev(() => [...document.querySelectorAll('.xd')].pop().querySelector('[data-xd-cancel], .xd-foot .xd-btn.ghost').click()).then(() => wait(400)).then(idle);
const type = (id, v) => ev((i, x) => { const n = document.querySelector('#xdf-' + i); n.value = x; n.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
const set = (m, r = 'owner') => ev((a, c) => { window.XENO_NET.setMode(a); window.XENO_ROLE.set(c); window.XW.render(); }, m, r).then(() => wait(250)).then(idle);
const failed = async (what) => { const d = await dlg(); const isFail = /didn’t go through/.test(d) && /offline/.test(d); if (isFail) await cancel(); ok(isFail, `${what}: offline says it didn’t go through`); return isFail; };
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url);
await ev(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.workspace', '"xeno"'); });

// Community — a vote, offline, is rolled back
await nav('overview/g/community/th_0'); const v0 = await ev(() => document.querySelector('#main .cm-vote b').textContent);
await set('offline'); await click('#main .cm-vote'); await failed('Community vote');
ok(await ev(() => document.querySelector('#main .cm-vote b').textContent) === v0 && await ev(() => document.querySelector('#main .cm-vote').getAttribute('aria-pressed')) === 'false', 'the vote is exactly as it was');
// Community — a report, offline, creates nothing
await set('offline'); const th0 = await ev(() => JSON.parse(localStorage.getItem('xw.db.v1') || '{}').forum?.length || window.XENO_PG_FORUM.length);
await ev(() => { window.XA.report(); }); await wait(400); await type('title', 'Exports stall when offline here'); await submit(800); await failed('Report');
ok(await ev(() => window.XENO_PG_FORUM.length) === th0, 'no thread was posted');
// Company — adding a registration, offline
await set('normal'); await nav('overview/g/workspace/Company'); const r0 = await ev(() => document.querySelectorAll('#main .co-regs li').length);
await set('offline'); await click('#main [data-co="addReg"]'); await ev(() => [...document.querySelectorAll('.xd [data-f="j"] [data-v]')].find((x) => x.dataset.v === 'FR').click()); await type('n', '123456789'); await submit(800); await failed('Company registration');
ok(await ev((n) => document.querySelectorAll('#main .co-regs li').length === n && !JSON.parse(localStorage.getItem('xw.company')).xeno.registrations.some((x) => x.jur === 'FR'), r0), 'the registration was not added — stored or shown');
// Anima — forgetting a memory, offline
await set('normal'); await nav('overview/g/anima/Atlas — research/Soul'); const m0 = await ev(() => document.querySelectorAll('#main .an-mems li').length);
await set('offline'); await click('#main [data-an="forget"]'); await submit(800); await failed('Forgetting a memory');
ok(await ev(() => document.querySelectorAll('#main .an-mems li').length) === m0, 'the memory is still there');
// Workforce — seeding divisions, offline
await set('normal'); await nav('overview/g/workspace/Divisions'); await set('offline'); await click('#main [data-wf="seed"]'); await failed('Creating divisions');
ok(await ev(() => window.XENO_WF.divs().length) === 0 && await ev(() => !!document.querySelector('#main [data-wf="seed"]')), 'no divisions were created, and the offer is still there');
// Settings — a preference, offline
await set('normal'); await nav('overview/g/settings/Appearance'); const before = await ev(() => localStorage.getItem('xw.prefs'));
await set('offline'); const sw = await ev(() => !!document.querySelector('#main [data-set="pref"]')); if (sw) { await click('#main [data-set="pref"]'); await failed('A setting'); ok(await ev((b) => localStorage.getItem('xw.prefs') === b, before), 'the setting is unchanged'); } else ok(true, 'no switch on this section (skipped)');
await set('normal');
// Roles
await set('normal', 'member'); await nav('overview/g/workspace/Divisions');
let g = await ev(() => { const s = document.querySelector('#main [data-wf="seed"]'); return s && { off: s.getAttribute('aria-disabled'), why: s.title }; });
ok(g?.off === 'true' && /Owners and admins/.test(g.why), `a member sees "Set up divisions" unavailable, with the reason (${g?.why})`);
await click('#main [data-wf="seed"]'); ok(/Owners and admins/.test(await ev(() => document.getElementById('toast').textContent)) && await ev(() => window.XENO_WF.divs().length) === 0, 'and pressing it explains instead of acting');
await nav('overview/g/workspace/Company'); ok(!(await ev(() => !!document.querySelector('#main [data-co="addReg"]'))), 'a member doesn’t get the company’s owner controls');
await set('normal', 'admin'); await nav('overview/g/workspace/Company'); g = await ev(() => document.querySelector('#main [data-co="topup"]')?.title || '');
ok(/Only the owner adds money/.test(g), 'an admin manages the company but can’t add money to the wallet');
await nav('overview/g/community/th_1'); ok(!(await ev(() => !!document.querySelector('#main [data-cm="mod"]'))), 'forum moderation is for XENO staff, not workspace admins');
await set('normal', 'owner'); await nav('overview/g/workspace/Divisions'); await click('#main [data-wf="seed"]'); await wait(500);
await set('normal', 'guest'); await nav('overview/g/places'); g = await ev(() => ({ closed: document.querySelectorAll('#main .pl-closed').length, names: [...document.querySelectorAll('#main .pl-floor:not(.pl-closed) header b')].map((x) => x.textContent) }));
ok(g.closed === 6 && g.names.join() === 'Lobby', `a guest sees closed doors for floors — no names or headcounts — and the lobby (${g.closed} closed)`);
await set('normal', 'owner');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
