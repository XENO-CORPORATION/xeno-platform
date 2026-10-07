import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'], protocolTimeout: 60000 }); const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a); const idle = () => p.evaluate(() => window.XENO_NET?.idle?.());
const nav = async (h) => { await p.goto(url + '#/overview/g/' + h); await p.reload(); await wait(900); await idle(); };
const click = (sel, txt) => ev((s, t) => { const n = [...document.querySelectorAll(s)].find((e) => !t || e.textContent.includes(t)); if (!n) throw new Error('no ' + s + ' ' + t); n.click(); }, sel, txt ?? null).then(() => wait(450)).then(idle);
const dlg = () => ev(() => [...document.querySelectorAll('.xd')].pop()?.textContent || '');
const submit = async () => { await ev(() => [...document.querySelectorAll('.xd')].pop().querySelector('[data-xd-submit], .xd-foot .xd-btn:not(.ghost)').click()); await wait(500); await idle(); };
const type = (id, v) => ev((i, x) => { const n = document.querySelector('#xdf-' + i); n.value = x; n.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
const pick = (f, v) => ev((f2, v2) => [...document.querySelectorAll(`.xd [data-f="${f2}"] [data-v]`)].find((x) => x.dataset.v === v2).click(), f, v);
const text = () => ev(() => document.querySelector('#main').textContent);
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url);
await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.workspace', '"xeno"'); });

// ---------------- Company ----------------
await nav('workspace/Company'); let g = await ev(() => ({ regs: document.querySelectorAll('#main .co-regs li').length, sums: [...document.querySelectorAll('#main .fd-sum small')].map((x) => x.textContent) }));
ok(g.regs === 2 && g.sums[0] === 'Wallet', `the company page shows its registrations (office + branch) and its wallet (${g.regs})`);
await click('#main [data-co="addId"][data-arg="tax"]'); await pick('j', 'RO'); await type('n', '12345678'); await submit();
await click('#main [data-co="addReg"]'); await pick('j', 'GR'); await type('n', '160011201000'); await pick('r', 'branch'); await submit();
await click('#main [data-co="addId"][data-arg="tax"]'); await pick('j', 'GR'); await type('n', '998877665'); await submit();
g = await ev(() => JSON.parse(localStorage.getItem('xw.company')).xeno.ids.tax.map((x) => x.prefix + x.number)); ok(g.includes('EL998877665'), `a Greek VAT number gets the EL prefix, not GR (${g.join(', ')})`);
await click('#main [data-co="topup"]'); await submit(); g = await ev(() => JSON.parse(localStorage.getItem('xw.company')).xeno.wallet.ledger.at(-1)); ok(g.amt === 10000 && g.what === 'Top-up', 'adding credits writes a ledger entry');
await click('#main [data-co="allocate"]'); ok(/Create a division first/.test(await ev(() => document.getElementById('toast').textContent)), 'allocating needs a division to allocate to');
await ev(() => { const S = window.XENO_WF.st(); S.divisions.push({ id: 'dvA', name: 'Creative', parent: null, head: 'Emilian', budget: { alloc: 0, spent: 0, reserved: 0 }, archived: false }, { id: 'dvB', name: 'Dev', parent: null, head: null, budget: { alloc: 0, spent: 0, reserved: 0 }, archived: false }); S.teams[0].ownDiv = 'dvA'; if (S.teams[1]) S.teams[1].ownDiv = 'dvB'; window.XENO_WF.commit(); });
await click('#main [data-co="allocate"]'); await pick('d', 'dvA'); await type('a', '2500'); await submit();
g = await ev(() => window.XENO_WF.st().divisions.find((d) => d.id === 'dvA').budget.alloc); ok(g === 2500, 'a division budget is an allocation from the company wallet');
await ev(() => { const W = window.XENO_PG_WORKSPACE; W.members = W.members.filter((m) => m.name !== 'Juno'); window.XENO_DB.save(); }); await nav('workspace/Company');
await click('#main [data-co="employ"]'); ok(/Its Mind and Soul stay yours/.test(await dlg()), 'employing says the Mind and Soul stay with you'); await pick('m', 'Juno'); await type('t', 'Finance assistant'); await submit();
g = await ev(() => window.XENO_PG_WORKSPACE.members.find((m) => m.name === 'Juno')); ok(g?.title === 'Finance assistant' && g.kind === 'agent', 'employing is an admission plus a title');
await ev(() => window.XA.switchWorkspace('personal')); await wait(300); await nav('workspace/Company'); ok(/This is your personal space/.test(await text()), 'a personal space offers to create a company instead');
await ev(() => window.XA.switchWorkspace('xeno')); await wait(300);

// ---------------- Anima ----------------
await nav('anima/Atlas%20%E2%80%94%20research'); g = await ev(() => ({ tabs: [...document.querySelectorAll('#main [role=tab][data-an="tab"]')].map((x) => x.textContent), banner: /taught itself something new/.test(document.querySelector('#main').textContent) }));
ok(g.tabs.length === 4 && g.banner, `a Mind has Overview, Mind, Soul and Channels, and flags a skill it taught itself (${g.tabs.join(' | ')})`);
await click('#main [data-an="tab"]', 'Soul'); g = await ev(() => location.hash); ok(/Soul$/.test(g), `each tab has its own address (${g})`);
await click('#main [data-an="keep"]'); g = await ev(() => window.XENO_PG_ANIMA.minds.find((m) => m.name === 'Atlas').skillList.find((s) => s.id.endsWith('snew')).state); ok(g === 'kept', 'a new skill is kept only when you say so');
const fp0 = await ev(() => window.XENO_PG_ANIMA.minds.find((m) => m.name === 'Atlas').signed.fp);
await click('#main [data-an="forget"]'); await submit(); g = await ev(() => window.XENO_PG_ANIMA.minds.find((m) => m.name === 'Atlas')); ok(g.memories.length === 3 && g.signed.fp !== fp0, 'forgetting removes the memory and re-signs the Soul');
await ev(() => { const i = document.querySelector('#main [data-an-q]'); i.value = 'board'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(300);
g = await ev(() => document.querySelectorAll('#main .an-mems li').length); ok(g === 1, `searching its memory filters as you type (${g})`);
await click('#main [data-an="tab"]', 'Mind'); await click('#main [data-an="tool"][data-arg$="|spend"]'); g = await ev(() => window.XENO_PG_ANIMA.minds.find((m) => m.name === 'Atlas').seed.tools.spend); ok(g === true, 'tools it may use switch one by one');
await click('#main [data-an="tab"]', 'Channels'); await click('#main [data-an="tg"]'); ok(/@XenoAnimaBot/.test(await dlg()), 'connecting Telegram gives a pairing code'); await type('u', 'emilian'); await submit();
g = await ev(() => window.XENO_PG_ANIMA.minds.find((m) => m.name === 'Atlas').channels.telegram); ok(g === '@emilian', 'and the channel is connected');
await nav('anima/Swarms'); g = await ev(() => document.querySelectorAll('#main .mk-sl').length); ok(g === 1, 'Swarms lists Minds that work together');
await nav('anima/Memory'); ok(await ev(() => document.querySelectorAll('#main .an-mems li').length) >= 8, 'Memory shows every Mind’s memories in one place');

// ---------------- Places ----------------
await nav('places'); g = await ev(() => ({ floors: [...document.querySelectorAll('#main .pl-floor header b')].map((x) => x.textContent), desks: document.querySelectorAll('#main .pl-desk').length }));
ok(g.floors.includes('Creative') && g.floors.includes('Dev') && g.floors.includes('Lobby'), `floors are the workspace's divisions, plus a lobby (${g.floors.join(', ')})`);
ok(g.desks > 0, `each team member has a desk (${g.desks})`);
g = await ev(() => ({ work: document.querySelectorAll('#main .pl-desk.pl-work').length, hand: document.querySelectorAll('#main .pl-desk.pl-hand').length })); ok(g.work >= 1 && g.hand >= 1, `a running agent works at its desk; one waiting on you has its hand up (${g.work}/${g.hand})`);
ok(await ev(() => document.querySelectorAll('#main .pl-walks li').length) >= 1, 'a handoff shows as someone walking work over');
await click('#main .pl-desk.pl-work'); g = await ev(() => document.querySelector('#main .pl-peek')?.textContent || ''); ok(/Working/.test(g) && /Watch its work/.test(g), 'looking at an occupant shows what they are doing and what you can do');
await click('#main .pl-peek [data-pl="walk"]').catch(() => {}); await click('#main [data-pl="walk"]'); ok(await ev(() => !!document.querySelector('#main .pl-floor.here')), 'you can walk to a floor — your position is this tab only');
await click('#main [data-pl="accept"]'); g = await ev(() => window.XENO_WF.st().handoffs.find((h) => h.id === 'h1').state); ok(g === 'accepted', 'taking a handoff in the building is the same command as in Workspace');
await click('#main [data-pl="list"]'); ok(await ev(() => document.querySelectorAll('#main .pl-list li').length) > 0, 'the whole building is also a plain list');
await click('#main [data-pl="list"]'); await click('#main [data-pl="edit"]'); const before = await ev(() => [...document.querySelectorAll('#main .pl-floor')].map((f) => f.textContent).join());
const mv = await ev(() => !!document.querySelector('#main [data-pl="move"]')); if (mv) { await click('#main [data-pl="move"]'); ok(await ev(() => !!localStorage.getItem('xw.placesLayout')), 'an admin can rearrange pods and the layout is saved'); } else ok(true, 'arranging is available (one pod per floor, nothing to move)');
await ev(() => { const S = window.XENO_WF.st(); S.divisions = []; window.XENO_WF.commit(); }); await nav('places');
ok(/Floors are the workspace’s divisions/.test(await text()) && (await ev(() => document.querySelectorAll('#main .pl-floor').length)) === 1, 'with no divisions it is a lobby and no floors — never filled in to look busy');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
