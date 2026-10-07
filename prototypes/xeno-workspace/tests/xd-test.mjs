import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a); const idle = () => p.evaluate(() => window.XENO_NET?.idle?.());
const nav = async (r) => { await p.goto(url + '#/' + r.split('/').map(encodeURIComponent).join('/')); await p.reload(); await wait(800); await idle(); };
const open = () => ev(() => !!document.querySelector('.xd.on'));
const ctrl = async (k) => { await p.keyboard.down('Control'); await p.keyboard.press(k); await p.keyboard.up('Control'); await wait(300); await idle(); };
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });
// ---- Settings: the full-page account centre (MODES §7j) ----
await nav('overview/g/projects'); await ctrl('Comma'); await wait(500);
let g = await ev(() => decodeURIComponent(location.hash)); ok(/g\/settings\//.test(g), `Ctrl , opens the account centre (${g})`);
await ev(() => window.XENO_SETTINGS.go('appearance')); await wait(400);
await ev(() => [...document.querySelectorAll('#main [data-set="prefv"]')].find((x) => x.dataset.arg === 'text=large').click()); await wait(300);
g = await ev(() => ({ attr: document.documentElement.dataset.text, zoom: getComputedStyle(document.body).zoom })); ok(g.attr === 'large' && +g.zoom > 1, `Text size Large applies at once (${JSON.stringify(g)})`);
await p.reload(); await wait(800); g = await ev(() => document.documentElement.dataset.text); ok(g === 'large', `the preference survives a reload (${g})`);
await ev(() => [...document.querySelectorAll('#main [data-set="prefv"]')].find((x) => x.dataset.arg === 'text=default').click()); await wait(200);
// ---- New project: validation, unsaved changes, create ----
await nav('overview/g/projects'); await p.click('.pg-top-acts [data-xa="newProject"]'); await wait(300);
g = await ev(() => ({ open: !!document.querySelector('.xd-md'), focus: document.activeElement?.id, ring: getComputedStyle(document.activeElement).outlineStyle }));
ok(g.open && g.focus === 'xdf-name' && g.ring === 'none', `New project opens with focus in Name — and no focus ring on a text field (${JSON.stringify(g)})`);
await ev(() => document.querySelector('[data-xd-submit]').click()); await wait(100);
g = await ev(() => ({ err: document.querySelector('[data-f="name"] .xd-err').textContent, open: !!document.querySelector('.xd') }));
ok(g.open && /required/.test(g.err), `empty name is refused with a message (${g.err})`);
await p.keyboard.type('Brand refresh'); await ev(() => document.querySelector('[data-xd-submit]').click()); await wait(100);
g = await ev(() => document.querySelector('[data-f="name"] .xd-err').textContent); ok(/already exists/.test(g), `a duplicate name is refused (${g})`);
await p.keyboard.press('Escape'); await wait(150); g = await ev(() => ({ open: !!document.querySelector('.xd'), warn: document.querySelector('.xd-warn')?.textContent }));
ok(g.open && /unsaved/.test(g.warn), `Esc with typed text warns instead of discarding (${g.warn})`);
await ev(() => { const i = document.querySelector('#xdf-name'); i.value = ''; i.focus(); }); await p.keyboard.type('Spring launch');
await ev(() => document.querySelector('[data-f="mode"] [data-v="Social"]').click()); await ev(() => document.querySelector('[data-f="icon"] [data-v="megaphone"]').click());
await p.keyboard.down('Control'); await p.keyboard.press('Enter'); await p.keyboard.up('Control'); await wait(600);
g = await ev(() => ({ hash: decodeURIComponent(location.hash), h1: document.querySelector('.pg-top .crumbs b')?.textContent, side: !!document.querySelector('#panel [data-item="Spring launch"]'), open: !!document.querySelector('.xd') }));
ok(!g.open && /projects\/Spring launch$/.test(g.hash) && g.h1 === 'Spring launch' && g.side, `Ctrl+Enter creates it: its own page, address and sidebar row (${JSON.stringify(g)})`);
// ---- More menu: rename, icon, task, delete ----
await ev(() => document.querySelector('.pg-top-acts [data-xa="projectMenu"]').click()); await wait(150);
g = await ev(() => [...document.querySelectorAll('.xcm:not(.out) [role="menuitem"]')].map((x) => x.querySelector('.xcm-l').textContent.trim()));
ok(g.join('|') === 'Rename|Change icon|Assign people or agents|Set a budget|Archive|Delete project', `More menu: ${g.join(' · ')}`);
await ev(() => [...document.querySelectorAll('.xcm:not(.out) .xcm-i')].find((x) => x.querySelector('.xcm-l').textContent.trim() === 'Rename').click()); await wait(300); await ev(() => { const i = document.querySelector('#xdf-name'); i.value = 'Spring launch 2027'; }); await p.keyboard.press('Enter'); await wait(500);
g = await ev(() => ({ hash: decodeURIComponent(location.hash), h1: document.querySelector('.pg-top .crumbs b')?.textContent, side: !!document.querySelector('#panel [data-item="Spring launch 2027"]') }));
ok(/projects\/Spring launch 2027$/.test(g.hash) && g.h1 === 'Spring launch 2027' && g.side, `rename updates the page, the address and the sidebar (${JSON.stringify(g)})`);
await ev(() => document.querySelector('[data-ptab="Tasks"]').click()); await wait(400);
await ev(() => document.querySelector('.pg-top-acts [data-xa="newTask"]').click()); await wait(300); await p.keyboard.type('Draft the launch post'); await p.keyboard.press('Enter'); await wait(500);
g = await ev(() => [...document.querySelectorAll('.pg-task b')].map((x) => x.textContent)); ok(g.includes('Draft the launch post'), `New task lands on the board (${g})`);
await nav('overview/g/projects'); g = await ev(() => { const r = [...document.querySelectorAll('.pg-table--proj .pg-tr, .pg-card--proj')].find((x) => /Spring launch 2027/.test(x.textContent)); return r ? (r.querySelector('.pg-picon svg')?.dataset.glyph || 'NO-ICON:' + r.className) : 'NO-ROW:' + document.querySelectorAll('.pg-table--proj .pg-tr, .pg-card--proj').length; });
ok(/megaphone|broadcast/.test(g || ''), `the chosen icon shows in the projects list after a refresh (${g})`);
await nav('overview/g/projects/Spring launch 2027'); await ev(() => document.querySelector('.pg-top-acts [data-xa="projectMenu"]').click()); await wait(150); await ev(() => [...document.querySelectorAll('.xcm:not(.out) .xcm-i')].find((x) => /^Delete/.test(x.querySelector('.xcm-l').textContent.trim())).click()); await wait(300);
g = await ev(() => ({ dis: document.querySelector('[data-xd-ok]').disabled, focus: document.activeElement?.id }));
ok(g.dis && g.focus === 'xd-type', `Delete needs the name typed first; the button starts disabled (${JSON.stringify(g)})`);
await p.keyboard.type('Spring launch 2027'); g = await ev(() => document.querySelector('[data-xd-ok]').disabled); ok(!g, 'typing the exact name enables Delete');
await p.keyboard.press('Enter'); await wait(500); g = await ev(() => ({ hash: location.hash, gone: !document.querySelector('#panel [data-item="Spring launch 2027"]') }));
ok(/projects$/.test(g.hash) && g.gone, `delete returns to Projects and the project is gone everywhere (${JSON.stringify(g)})`);
// ---- Invite ----
await nav('overview/g/workspace/Members'); const before = await ev(() => document.querySelectorAll('.pg-table--mem .pg-tr:not(.pg-th)').length);
await p.click('.pg-top-acts [data-xa="invite"]'); await wait(300); await p.keyboard.type('not-an-email'); await p.keyboard.press('Enter'); await wait(100);
g = await ev(() => ({ chipBad: !!document.querySelector('.xd-chip.bad') })); await ev(() => document.querySelector('[data-xd-submit]').click()); await wait(100);
const ierr = await ev(() => document.querySelector('[data-f="emails"] .xd-err').textContent);
ok(g.chipBad && /not an email/.test(ierr), `an invalid address is marked and refused (${ierr})`);
await ev(() => document.querySelector('.xd-chip.bad [data-chip-x]').click()); await ev(() => document.querySelector('#xdf-emails').focus()); await p.keyboard.type('lena@studio.com'); await p.keyboard.press('Enter');
await ev(() => document.querySelector('[data-xd-submit]').click()); await wait(600);
g = await ev(() => ({ n: document.querySelectorAll('.pg-table--mem .pg-tr:not(.pg-th)').length, invited: /Lena/.test(document.querySelector('.pg-table--mem').textContent), side: document.querySelector('#panel [data-item="Members"] .meta')?.textContent }));
ok(g.n === before + 1 && g.invited && /7 people/.test(g.side), `the invite appears in Members and the sidebar count (${JSON.stringify(g)})`);
// ---- focus trap ----
await p.click('.pg-top-acts [data-xa="invite"]'); await wait(300); for (let i = 0; i < 30; i++) await p.keyboard.press('Tab');
g = await ev(() => !!document.activeElement.closest('.xd')); ok(g, 'Tab never leaves the dialog'); await p.keyboard.press('Escape'); await wait(300);
g = await ev(() => document.activeElement?.dataset?.xa); ok(g === 'invite', `closing returns focus to the button that opened it (${g})`);
// ---- chat rename from the sidebar menu ----
await nav('studio/p/chat'); const bx = await ev(() => { const n = [...document.querySelectorAll('#panel [data-chat="Homepage hero ideas"]')].find((x) => x.offsetParent); const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, height: r.height }; }); await p.mouse.click(bx.x + 40, bx.y + bx.height / 2, { button: 'right' }); await wait(200);
await ev(() => [...document.querySelectorAll('.xcm:not(.out) .xcm-i')].find((x) => x.querySelector('.xcm-l').textContent.trim() === 'Rename…').click()); await wait(300); await ev(() => { const i = document.querySelector('#xdf-name'); i.value = 'Hero directions'; }); await p.keyboard.press('Enter'); await wait(500);
g = await ev(() => !!document.querySelector('#panel [data-chat="Hero directions"]') && !document.querySelector('#panel [data-chat="Homepage hero ideas"]')); ok(g, 'a chat renamed from the sidebar menu is renamed in the sidebar');
// ---- persistence: what you change survives a refresh (the backend's job, stood in for here) ----
await nav('overview/g/workspace/Members'); g = await ev(() => /Lena/.test(document.querySelector('.pg-table--mem').textContent)); ok(g, 'the invite is still there after a refresh');
await nav('studio/p/chat'); g = await ev(() => !!document.querySelector('#panel [data-chat="Hero directions"]')); ok(g, 'the chat rename is still there after a refresh');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
