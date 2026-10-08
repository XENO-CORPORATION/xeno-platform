// Browser REDs for the selection milestone (XENO FRAMEWORK - DECISION.md: F-02, F-03, F-13 to F-17).
// The guards at the end are behaviour the refactor must keep; they pass on HEAD. A thrown error is a FAIL with its
// message, so one symptom cannot hide another.
import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'], protocolTimeout: 60000 });
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const check = async (name, fn) => { try { await fn(); } catch (e) { ok(false, `${name} — threw: ${String(e.message).split('\n')[0]}`); } };
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const M = '[data-pg-ws^="Members/"]', F = '[data-pg-file]', MEM = '#/overview/g/workspace/Members', LIB = '#/overview/g/library', COM = '#/overview/g/community';
const LIBSEL = '#main [data-pg-file][aria-selected]:not([aria-selected="false"])';
const reset = async (hash) => { await p.goto(url); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.workspace', '"xeno"'); }); await p.goto(url + hash); await p.reload(); await wait(1000); };
const clickRow = async (s, i, mods = []) => { const el = (await p.$$('#main ' + s))[i]; for (const m of mods) await p.keyboard.down(m); await el.click(); for (const m of mods) await p.keyboard.up(m); await wait(250); };
const marks = () => p.evaluate(() => document.querySelectorAll('#main [data-xs]').length);
const barText = () => p.evaluate(() => document.getElementById('xs-bar')?.textContent ?? null);
const goPlace = (global) => p.evaluate((g) => window.XW.go('global', { global: g, zoneOf: 'overview' }), global);
const injectRows = (html) => p.evaluate((h) => { document.querySelector('#main').insertAdjacentHTML('beforeend', h); }, html);
const ctrlDom = (s, i) => p.evaluate((sel, n) => document.querySelectorAll('#main ' + sel)[n].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })), s, i).then(() => wait(250));
const clickBar = (re) => p.evaluate((src) => { const bt = [...document.querySelectorAll('#xs-bar [data-xs-i]')].find((x) => new RegExp(src).test(x.textContent)); if (!bt) return false; bt.click(); return true; }, re.source);

await check('F-02 A', async () => {
  await reset(MEM);
  await clickRow(M, 0, ['Control']); await clickRow(M, 2, ['Control']);
  ok((await marks()) === 2, `F-02 A precondition: two members selected (${await marks()})`);
  await goPlace('community'); await wait(500);
  const a = await p.evaluate(() => ({ bar: !!document.getElementById('xs-bar'), marks: document.querySelectorAll('[data-xs]').length }));
  ok(!a.bar && a.marks === 0, `F-02 A leaving Members in the app clears its selection and bar (bar ${a.bar}, marks ${a.marks})`);
});

await check('F-02 B', async () => {
  await reset(LIB);
  await clickRow(F, 0); await clickRow(F, 1, ['Control']);
  const pre = await barText();
  ok(/2 files selected/.test(pre || ''), `F-02 B precondition: two files picked (bar ${pre === null ? 'missing' : 'shown'})`);
  await goPlace('community'); await wait(500);
  const bar = await barText();
  ok(bar === null, `F-02 B leaving the Library in the app clears its bar (bar ${bar === null ? 'gone' : 'still shown'})`);
});

await check('F-02 C', async () => {
  await reset(LIB);
  await clickRow(F, 0); await clickRow(F, 1, ['Control']);
  await p.evaluate(() => { location.hash = '#/overview/g/community'; }); await wait(900);
  const bar = await barText();
  ok(bar === null, `F-02 C a hash change to another place clears the Library bar (bar ${bar === null ? 'gone' : 'still shown'})`);
});

await check('F-02 D', async () => {
  await reset(LIB);
  await clickRow(F, 3);
  const pre = await p.evaluate((s) => document.querySelectorAll(s).length, LIBSEL);
  ok(pre === 1, `F-02 D precondition: one file selected (${pre})`);
  await goPlace('community'); await wait(400); await goPlace('library'); await wait(800);
  const after = await p.evaluate((s) => document.querySelectorAll(s).length, LIBSEL);
  ok(after === 0, `F-02 D a single selected file is not still selected when the Library is opened again (${after})`);
});

await check('F-03 codec', async () => {
  await reset(COM);
  const e0 = errs.length;
  await p.evaluate(() => window.XENO_SEL.list({ key: 'r6', sel: '[data-r6]', id: (r) => r.dataset.r6, noun: ['row', 'rows'], actions: () => [] }));
  await p.evaluate(() => { location.hash = '#/overview/g/community?sel=a%2Cb,50%25'; }); await wait(900);
  await injectRows('<div data-r6="a,b">a,b</div><div data-r6="50%">50%</div><div data-r6="c">c</div>'); await wait(500);
  const sel = await p.evaluate(() => [...document.querySelectorAll('#main [data-r6][data-xs]')].map((n) => n.dataset.r6));
  const uri = errs.slice(e0).filter((x) => /URI malformed/.test(x)).length;
  ok(sel.length === 2 && sel.includes('a,b') && sel.includes('50%'), `F-03 an address with ?sel= selects the ids that contain a comma and a percent (selected ${JSON.stringify(sel)}, URIError ${uri})`);
});

await check('F-13 selection', async () => {
  await reset(MEM);
  await p.evaluate((s) => document.querySelectorAll('#main ' + s)[1].focus(), M);
  const focused = await p.evaluate((s) => !!document.activeElement?.closest?.('#main ' + s), M);
  ok(focused, 'F-13 precondition: focus is on a member row');
  await p.keyboard.down('Control'); await p.keyboard.down('Alt'); await p.keyboard.press('a'); await p.keyboard.up('Alt'); await p.keyboard.up('Control'); await wait(250);
  const n = await marks();
  ok(n === 0, `F-13 Ctrl Alt A is not Select all (${n} selected)`);
});

await check('F-14', async () => {
  await reset(MEM);
  await clickRow(M, 0, ['Control']); await clickRow(M, 1, ['Control']);
  await p.evaluate(() => { const H = window.XCM.H; const o = H.copy; H.copy = (t, m) => new Promise((res) => setTimeout(() => { o.call(H, t, m); res(); }, 500)); });
  ok(await clickBar(/Copy 2 names/), 'F-14 precondition: the Copy 2 names verb is on the bar');
  await wait(120);
  await clickRow(M, 2, ['Control']);                   // while the copy runs, the selection changes
  await wait(800);
  const n = await marks();
  ok(n === 3, `F-14 a finished action keeps a selection that changed while it ran (${n} selected, expected 3)`);
});

await check('F-15', async () => {
  await reset(MEM);
  await clickRow(M, 0, ['Control']); await clickRow(M, 1, ['Control']);
  await p.evaluate(() => { window.XCM.H.copy = () => Promise.reject(new Error('copy refused')); });
  const e15 = errs.length;
  ok(await clickBar(/Copy 2 names/), 'F-15 precondition: the Copy 2 names verb is on the bar');
  await wait(400);
  const unh = errs.slice(e15).filter((x) => /in promise/.test(x)).length;
  const marks15 = await marks();
  ok(unh === 0 && marks15 === 2, `F-15 a rejected action is contained: no unhandled rejection, selection kept (unhandled ${unh}, selected ${marks15})`);
});

await check('F-16', async () => {
  await reset(COM);
  await p.evaluate(() => {
    window.__ran = []; window.__n16 = 0;
    window.XENO_SEL.list({ key: 'r16', sel: '[data-r16]', id: (r) => r.dataset.r16, noun: ['row', 'rows'],
      actions: () => { window.__n16 += 1; const label = 'Verb ' + window.__n16; return [[{ label, run: () => { window.__ran.push(label); } }]]; } });
  });
  await injectRows('<div data-r16="x">x</div><div data-r16="y">y</div>'); await wait(300);
  await ctrlDom('[data-r16]', 0); await ctrlDom('[data-r16]', 1);
  const painted = await p.evaluate(() => document.querySelector('#xs-bar [data-xs-i="0.0"] span')?.textContent ?? null);
  ok(painted !== null, 'F-16 precondition: the verb is on the bar');
  await p.evaluate(() => document.querySelector('#xs-bar [data-xs-i="0.0"]').click()); await wait(300);
  const ran = await p.evaluate(() => window.__ran);
  ok(painted !== null && (ran.length === 0 || ran[0] === painted), `F-16 the bar runs the verb it showed (showed ${painted}, ran ${JSON.stringify(ran)})`);
});

await check('F-17', async () => {
  await reset(COM);
  await p.evaluate(() => window.XENO_SEL.list({ key: 'r17', sel: '[data-r17]', id: (r) => r.dataset.r17, noun: ['row', 'rows'], actions: () => [null, [{ label: 'Solo', run: () => {} }]] }));
  await injectRows('<div data-r17="x">x</div><div data-r17="y">y</div>'); await wait(300);
  await ctrlDom('[data-r17]', 0);
  const bar = await barText();
  ok(bar !== null && /Solo/.test(bar), `F-17 a missing action group is skipped, not fatal (bar ${bar === null ? 'missing' : 'text ' + JSON.stringify(bar)})`);
});

// ---- guards: behaviour the refactor must keep (these pass on HEAD) ----
await check('guard Escape', async () => {
  await reset(LIB);
  await clickRow(F, 0); await clickRow(F, 1, ['Control']);
  await p.evaluate(() => document.activeElement?.blur());
  await p.keyboard.press('Escape'); await wait(300);
  const g = await p.evaluate((s) => ({ bar: !!document.getElementById('xs-bar'), marks: document.querySelectorAll(s).length }), LIBSEL);
  ok(!g.bar && g.marks === 0, `guard Escape clears the Library's bar and its marks (bar ${g.bar}, marks ${g.marks})`);
});

await check('guard Clear button', async () => {
  await reset(LIB);
  await clickRow(F, 0); await clickRow(F, 1, ['Control']);
  await p.evaluate(() => document.querySelector('#xs-bar [data-xs-clear]').click()); await wait(300);
  const g = await p.evaluate((s) => ({ bar: !!document.getElementById('xs-bar'), marks: document.querySelectorAll(s).length }), LIBSEL);
  ok(!g.bar && g.marks === 0, `guard the Clear button clears the Library's bar and its marks (bar ${g.bar}, marks ${g.marks})`);
});

await check('guard XENO_SEL.clear', async () => {
  await reset(MEM);
  await clickRow(M, 0, ['Control']); await clickRow(M, 2, ['Control']);
  await p.evaluate(() => window.XENO_SEL.clear()); await wait(300);
  const g = await p.evaluate(() => ({ bar: !!document.getElementById('xs-bar'), marks: document.querySelectorAll('#main [data-xs]').length, sel: /sel=/.test(location.hash) }));
  ok(!g.bar && g.marks === 0 && !g.sel, `guard XENO_SEL.clear() repaints and writes the address (bar ${g.bar}, marks ${g.marks}, sel in address ${g.sel})`);
});

console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5));
await b.close(); process.exitCode = fails ? 1 : 0;
