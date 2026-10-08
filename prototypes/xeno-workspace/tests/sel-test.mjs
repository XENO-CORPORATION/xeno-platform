// §7w — select many and act on them: one model for members, threads and the Library
import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'], protocolTimeout: 60000 }); const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a);
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url);
await ev(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.workspace', '"xeno"'); });
const go = async (h) => { await p.goto(url + '#/' + h); await p.reload(); await wait(900); };
const rowsSel = (s) => ev((s) => [...document.querySelectorAll('#main ' + s)].map((r, i) => i), s);
const clickRow = async (s, i, mods = []) => { const el = (await p.$$('#main ' + s))[i]; for (const m of mods) await p.keyboard.down(m); await el.click(); for (const m of mods) await p.keyboard.up(m); await wait(250); };
const barTxt = () => ev(() => document.getElementById('xs-bar')?.textContent || '');
const nSel = () => ev(() => document.querySelectorAll('#main [data-xs]').length);
// members
const M = '[data-pg-ws^="Members/"]';
await go('overview/g/workspace/Members'); const nm = (await rowsSel(M)).length;
await clickRow(M, 0, ['Control']); await clickRow(M, 2, ['Control']);
ok(await nSel() === 2 && /2 members selected/.test(await barTxt()), `Ctrl-click adds rows one at a time, and the bar says how many (${await barTxt()})`);
ok(await ev(() => location.hash.split('?')[0].endsWith('/Members')), 'a Ctrl-click selects — it does not open the row');
await clickRow(M, 4, ['Shift']); ok(await nSel() === 4, `Shift-click selects the range from the last row (rows 0, 2 and 2–4 → ${await nSel()})`);
await clickRow(M, 4, ['Control']); ok(await nSel() === 3, 'Ctrl-click on a selected row removes it');
// right-click acts on the whole selection with the same verbs as the bar
const r0 = (await p.$$('#main ' + M))[0]; await r0.click({ button: 'right' }); await wait(300);
let g = await ev(() => [...document.querySelectorAll('.xcm-i')].map((x) => x.textContent).join(' | '));
ok(/Copy 3 names/.test(g) && /Copy 3 names/.test(await barTxt()), 'right-click on a selected row offers the same verbs as the bar, for all of them');
await p.keyboard.press('Escape'); await wait(200);
await p.keyboard.press('Escape'); await wait(250); ok(await nSel() === 0 && !(await barTxt()), 'Esc clears the selection and the bar goes');
await ev((s) => document.querySelectorAll('#main ' + s)[1].focus(), M); await p.keyboard.press('x'); await wait(200);
ok(await nSel() === 1, 'X toggles the focused row');
await p.keyboard.down('Shift'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.up('Shift'); await wait(200);
ok(await nSel() === 3, `Shift ↓ extends the selection (${await nSel()})`);
await p.keyboard.down('Control'); await p.keyboard.press('a'); await p.keyboard.up('Control'); await wait(200);
ok(await nSel() === nm, `Ctrl A selects every row on screen (${await nSel()} of ${nm})`);
await ev(() => window.XENO_HIST.toast('A toast while the bar is up'));
g = await ev(() => { const t = document.getElementById('xw-toasts').getBoundingClientRect(), bar = document.getElementById('xs-bar').getBoundingClientRect(); return t.bottom <= bar.top + 1; });
ok(g, 'toasts sit above the action bar, never on top of it');
// threads: Follow two, Ctrl Z takes it back
const T = '[data-pg-gitem]';
await go('overview/g/community'); ok(await nSel() === 0, 'leaving the page clears the selection');
await clickRow(T, 0, ['Control']); await clickRow(T, 1, ['Control']);
ok(/Follow 2 threads/.test(await barTxt()), 'threads offer Follow for all of them');
await ev(() => [...document.querySelectorAll('#xs-bar button')].find((x) => /Follow 2/.test(x.textContent)).click()); await wait(300);
g = await ev(() => JSON.parse(localStorage.getItem('xw.forumSubs') || '[]').length);
ok(g === 2 && !(await barTxt()), `Follow follows both and the selection clears (${g})`);
await ev(() => document.activeElement?.blur()); await p.keyboard.down('Control'); await p.keyboard.press('z'); await p.keyboard.up('Control'); await wait(300);
ok(await ev(() => JSON.parse(localStorage.getItem('xw.forumSubs') || '[]').length) === 0, 'Ctrl Z unfollows them again — bulk actions go through the one history');
// the Library keeps its own model but shows the same bar
await go('overview/g/library'); const F = '[data-pg-file]'; const live0 = await ev(() => window.XENO_PG_LIBRARY.items.filter((f) => !f.trashedAt).length);
await clickRow(F, 0); await clickRow(F, 1, ['Control']);
ok(/2 files selected/.test(await barTxt()) && /Move 2 files to Trash/.test(await barTxt()), `the Library shows the same bar with its own verbs (${(await barTxt()).slice(0, 70)})`);
await ev(() => [...document.querySelectorAll('#xs-bar button')].find((x) => /Move 2 files to Trash/.test(x.textContent)).click()); await wait(400);
ok(await ev(() => window.XENO_PG_LIBRARY.items.filter((f) => !f.trashedAt).length) === live0 - 2, 'and acts on both');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
