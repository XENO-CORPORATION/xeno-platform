// §7bb — a link for every selection: ?sel= in the address, restored on open, reload and Back
import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'], protocolTimeout: 60000 }); const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a);
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url);
await ev(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.workspace', '"xeno"'); });
const M = '[data-pg-ws^="Members/"]', MEM = 'overview/g/workspace/Members';
await p.goto(url + '#/' + MEM); await p.reload(); await wait(1100);
const sel = () => ev(() => [...document.querySelectorAll('#main [data-xs]')].map((r) => r.dataset.pgWs?.slice(8) || r.dataset.pgFile));
const q = () => ev(() => location.hash.split('?')[1] || '');
const clickRow = async (s, i, mods = []) => { const el = (await p.$$('#main ' + s))[i]; for (const m of mods) await p.keyboard.down(m); await el.click(); for (const m of mods) await p.keyboard.up(m); await wait(250); };
const h0 = await ev(() => history.length);
await clickRow(M, 0, ['Control']); await clickRow(M, 2, ['Control']); const picked = await sel();
let g = await q(); ok(/^sel=/.test(g) && picked.every((n) => decodeURIComponent(g).includes(n)), `the address carries the selection (?${decodeURIComponent(g)})`);
ok(await ev(() => history.length) === h0, 'selecting adds no Back step');
ok(await ev(() => !!document.querySelector('#main ' + '[data-pg-ws^="Members/"]')), 'the page itself still resolves with ?sel= on it');
// copy link — the exact address of this selection
await ev(() => { window.__copied = null; const H = window.XCM.H; const o = H.copy; H.copy = (t, m) => { window.__copied = t; return o.call(H, t, m); }; });
await ev(() => { const on = [...document.querySelectorAll('#xs-bar button')].find((x) => /Copy link to this selection/.test(x.textContent)); if (on) on.click(); else document.querySelector('#xs-bar [data-xs-more]')?.click(); }); await wait(250);
await ev(() => [...document.querySelectorAll('.xcm-i')].find((x) => /Copy link to this selection/.test(x.textContent))?.click()); await wait(250);
const link = await ev(() => window.__copied);
ok(!!link && /\?sel=/.test(link), `“Copy link to this selection” copies that address (${(link || '').split('#')[1] || 'nothing'})`);
// reload, and open the link fresh
await p.reload(); await wait(1300); g = await sel();
ok(g.length === 2 && picked.every((n) => g.includes(n)), `a reload comes back with the same rows selected (${g.join(', ')})`);
const p2 = await b.newPage(); await p2.setViewport({ width: 1440, height: 900 }); await p2.goto(link); await wait(1300);
g = await p2.evaluate(() => [...document.querySelectorAll('#main [data-xs]')].map((r) => r.dataset.pgWs.slice(8)));
ok(g.length === 2 && /2 members selected/.test(await p2.evaluate(() => document.getElementById('xs-bar')?.textContent || '')), `opening the link in a new tab selects the same two, with the bar (${g.join(', ')})`); await p2.close();
// Back / Forward
await ev(() => { location.hash = '#/overview/g/library'; }); await wait(900); await p.goBack(); await wait(1200);
g = await sel(); ok(g.length === 2, `Back returns to the members with the selection (${g.length})`);
await ev(() => document.activeElement?.blur()); await p.keyboard.press('Escape'); await wait(300);
ok(!(await q()), 'Esc clears it from the address too');
// the Library: one selected file is a link as well
await ev(() => { location.hash = '#/overview/g/library'; }); await wait(1100);
await clickRow('[data-pg-file]', 3); const fid = await ev(() => document.querySelector('#main [data-pg-file][aria-selected]:not([aria-selected="false"])')?.dataset.pgFile);
ok(!!fid && (await q()) === 'sel=' + encodeURIComponent(fid), `selecting one file puts it in the address (${await q()})`);
await p.reload(); await wait(1400);
ok(await ev(() => document.querySelector('#main [data-pg-file][aria-selected]:not([aria-selected="false"])')?.dataset.pgFile) === fid, 'and a reload opens the Library with that file selected');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
