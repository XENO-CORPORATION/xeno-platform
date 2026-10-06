import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
const errs = []; p.on('pageerror', (e) => errs.push(e.message + ' @ ' + String(e.stack).split('\n')[1]));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a);
const go = async (it) => { await p.goto(url + '#/overview/g/workspace/' + encodeURIComponent(it)); await p.reload(); await wait(900); };
const wf = (a, arg) => ev((x, y) => { const n = [...document.querySelectorAll('#main [data-wf]')].find((e) => e.dataset.wf === x && (y == null || e.dataset.arg === y)); n.click(); }, a, arg ?? null).then(() => wait(350));
const dlg = () => ev(() => { const d = [...document.querySelectorAll('.xd')].pop(); return d && { title: d.querySelector('.xd-head b')?.textContent, text: d.textContent }; });
const submit = async () => { await ev(() => [...document.querySelectorAll('.xd')].pop().querySelector('[data-xd-submit], .xd-foot .xd-btn:not(.ghost)').click()); await wait(450); };
const setF = (id, v) => ev((i, x) => { const n = document.querySelector('#xdf-' + i); n.value = x; n.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
const pick = (f, v) => ev((f2, v2) => [...document.querySelectorAll(`.xd [data-f="${f2}"] [data-v]`)].find((x) => x.dataset.v === v2).click(), f, v);
const S = () => ev(() => JSON.parse(localStorage.getItem('xw.wf')));
const close = async () => { for (let i = 0; i < 3; i++) { if (!(await ev(() => !!document.querySelector('.xd')))) break; await p.keyboard.press('Escape'); await wait(300); } };
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });

// DIV-03: none by default, six on request
await go('Divisions'); let g = await ev(() => ({ cards: document.querySelectorAll('#main .wf-div').length, empty: !!document.querySelector('#main .wf-empty'), memDivs: window.XENO_PG_WORKSPACE.members.filter((m) => (m.divisions || []).length).length }));
ok(g.cards === 0 && g.empty && g.memDivs === 0, 'a workspace starts with no divisions, and no one is placed in one (DIV-03)');
await wf('seed'); g = await ev(() => [...document.querySelectorAll('#main .wf-div-h b')].map((x) => x.textContent)); ok(g.join() === 'Creative,Office,Comms,Corpo,Dev,Platform', `the starter six on request (${g.join(', ')})`);
g = await ev(() => [...document.querySelectorAll('#panel [data-sec] .row')].map((x) => x.textContent.trim()).filter((x) => /^Creative/.test(x)).length); ok(g === 1, 'the sidebar lists them — derived from the same record');
// nesting + head + budget
await wf('newDiv'); await setF('name', 'Video'); await pick('parent', await ev(() => JSON.parse(localStorage.getItem('xw.wf')).divisions.find((d) => d.name === 'Creative').id)); await submit();
g = await ev(() => document.querySelectorAll('#main .wf-org ol .wf-div').length); ok(g === 1, 'a division can sit inside another, drawn as a nested branch (DIV-01)');
await go('Divisions/Video'); await wf('head'); await pick('who', 'Atlas'); await setF('why', 'Runs the render pipeline'); await submit();
g = await S(); ok(g.divisions.find((d) => d.name === 'Video').head === 'Atlas' && g.decisions[0].kind === 'head' && g.decisions[0].reason === 'Runs the render pipeline', 'an agent can head a division, and the decision is recorded with its reason (DIV-06, LIFE-06)');
await wf('budget'); await setF('n', '8000'); await submit(); g = await ev(() => document.querySelector('#main .wf-budget dd').textContent); ok(/8,000/.test(g), `the budget is set (${g})`);
g = await ev(() => document.querySelector('#main .wf-note')?.textContent); ok(/also counts against Creative/.test(g), 'a child division’s spending counts against its parent (DIV-07)');
// teams: two edges, functions, rights
await go('Teams/Design'); g = await ev(() => [...document.querySelectorAll('#main [data-wf-sel]')].map((s) => s.dataset.wfSel)); ok(g.join() === 'ownDiv,fundDiv', 'a team has two separate edges: reports to, and paid by (DIV-04)');
const cid = await ev(() => JSON.parse(localStorage.getItem('xw.wf')).divisions.find((d) => d.name === 'Creative').id), pid = await ev(() => JSON.parse(localStorage.getItem('xw.wf')).divisions.find((d) => d.name === 'Platform').id);
await ev((v) => { const s = document.querySelector('#main [data-wf-sel="ownDiv"]'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, cid); await wait(400);
await ev((v) => { const s = document.querySelector('#main [data-wf-sel="fundDiv"]'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, pid); await wait(400);
g = await S(); const des = g.teams.find((t) => t.name === 'Design'); ok(des.ownDiv === cid && des.fundDiv === pid, 'reporting to Creative while Platform pays is representable');
await wf('fn', 'Design|Atlas'); await pick('fn', 'observer'); await setF('why', 'Read-only for now'); await submit();
g = await S(); ok(g.teams.find((t) => t.name === 'Design').members.find((m) => m.name === 'Atlas').fn === 'observer' && /worker → observer/.test(g.decisions[0].what), 'changing a function is a recorded revision (LIFE-05)');
await go('Members/Atlas'); await wf('actTeam', 'Design'); await wf('act', 'dispatch');
g = await ev(() => ({ v: document.querySelector('#main .wf-verdict').textContent, no: [...document.querySelectorAll('#main .wf-axes li.no .wf-ax')].map((x) => x.textContent) }));
ok(/^No/.test(g.v) && g.no.join() === 'Team function', `an observer can’t start a run — the explainer names the blocking axis (${g.no})`);
await wf('act', 'read'); g = await ev(() => document.querySelector('#main .wf-verdict').textContent); ok(/^Yes/.test(g), 'but can read transcripts');
g = await ev(() => document.querySelectorAll('#main .wf-ev').length); ok(g >= 5, `the record is counted from events in a window, with no score (${g} counts)`);
// handoffs
await go('Handoffs'); g = await ev(() => document.querySelector('#main [role=tab][aria-selected=true]')?.textContent); ok(/To me/.test(g), 'Handoffs opens on what was handed to you');
await go('Handoffs/h1'); await wf('accept', 'h1'); g = await S(); ok(g.handoffs.find((h) => h.id === 'h1').state === 'accepted', 'Accept accepts');
await go('Members/Kit'); await ev(() => document.querySelector('#main .pg-top-acts [data-wf="handoff"]').click()); await wait(400);
g = await dlg(); ok(/Hand off work/.test(g.title) && /full transcript/.test(g.text), 'the handoff dialog asks what it shares, transcript off unless chosen (HAND-06)');
await ev(() => document.querySelector('.xd [data-f="work"] [data-v]').click()); await submit();
g = await ev(() => ({ h: decodeURIComponent(location.hash), props: document.querySelector('#main .pg-props')?.textContent }));
ok(/Handoffs\/h/.test(g.h) && /person → agent/.test(g.props) && /Kit’s own/.test(g.props), `it opens the handoff: boundaries crossed and whose access (${(g.props || '').replace(/\s+/g, ' ').slice(0, 80)})`);
const hid = g.h.split('Handoffs/')[1]; await wf('withdraw', hid); g = await S(); ok(g.handoffs.find((h) => h.id === hid).state === 'revoked', 'the sender can withdraw an open offer');
await ev(() => { const s = JSON.parse(localStorage.getItem('xw.wf')); s.handoffs.push({ id: 'hx', from: 'Mira', to: 'Emilian', work: 'Old ask', kind: 'task', share: ['result'], state: 'offered', at: Date.now() - 5e8, expires: Date.now() - 1000, crossed: [], payer: 'Workspace', rev: [] }); localStorage.setItem('xw.wf', JSON.stringify(s)); });
await go('Handoffs'); g = await S(); ok(g.handoffs.find((h) => h.id === 'hx').state === 'expired', 'an offer nobody accepts expires without running (HAND-03)');
// removal = revocation + settlement; history kept
await go('Members/Kit'); await ev(() => [...document.querySelectorAll('#main .pg-top-acts button')].find((x) => /Remove/.test(x.textContent)).click()); await wait(400);
g = await dlg(); ok(/Remove Kit/.test(g.title) && /nothing is deleted/.test(g.text) && /What happens/.test(g.text), 'removing shows what settles before it happens (LIFE-02)'); await setF('why', 'Project ended'); await submit();
g = await ev(() => window.XENO_PG_WORKSPACE.members.find((m) => m.name === 'Kit').status); ok(g === 'settling', `access ends at once, then the work settles (${g})`); await wait(4300);
g = await ev(() => ({ st: window.XENO_PG_WORKSPACE.members.find((m) => m.name === 'Kit')?.status, kept: !!window.XENO_PG_WORKSPACE.members.find((m) => m.name === 'Kit') }));
ok(g.st === 'departed' && g.kept, 'after settling they are Departed — and still on the record (LIFE-03)');
// decisions + persistence
await go('Decisions'); g = await ev(() => document.querySelectorAll('#main .wf-dec li').length); ok(g >= 8, `every decision is in the log (${g})`);
g = await ev(() => document.querySelector('#main .wf-dec li small').textContent); ok(/Workspace owner/.test(g), `each names who decided and under what authority (${g.slice(0, 60)})`);
await p.reload(); await wait(900); g = await ev(() => document.querySelectorAll('#main .wf-dec li').length); ok(g >= 8, 'it all survives a reload');
// crumbs walk back up
await go('Teams/Design'); await ev(() => document.querySelector('#main .crumbs a[data-crumb="Teams"]')?.click() || [...document.querySelectorAll('.crumbs a')].find((a) => a.textContent === 'Teams')?.click()); await wait(500);
g = await ev(() => decodeURIComponent(location.hash)); ok(/workspace\/Teams$/.test(g), `the breadcrumb is a trail you can walk back up (${g})`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
