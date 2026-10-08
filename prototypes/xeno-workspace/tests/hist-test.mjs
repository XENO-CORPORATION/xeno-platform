// §7v — one undo/redo history: a stack of toasts, Ctrl Z / Ctrl ⇧ Z through it, a drawer, and others' changes kept
import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'], protocolTimeout: 60000 }); const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a);
const MUT = process.env.MUT || '';
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url);
await ev(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.workspace', '"xeno"'); });
await p.goto(url + '#/overview/g/library'); await p.reload(); await wait(900);
if (MUT === 'single') await ev(() => { const r = window.XENO_HIST.record; window.XENO_HIST.record = (l, f) => { document.querySelectorAll('#xw-toasts .xh-toast').forEach((n) => n.remove()); return r(l, f); }; });
const live = () => ev(() => window.XENO_PG_LIBRARY.items.filter((f) => !f.trashedAt).length);
const trash = async () => { await ev(() => document.querySelector('#main [data-pg-file]').click()); await wait(300); await p.keyboard.press('Delete'); await wait(450); };
const key = async (k, mods = []) => { for (const m of mods) await p.keyboard.down(m); await p.keyboard.press(k); for (const m of mods) await p.keyboard.up(m); await wait(350); };
const n0 = await live();
await trash(); await trash(); const n2 = await live();
let g = await ev(() => [...document.querySelectorAll('#xw-toasts .xh-toast')].map((t) => ({ txt: t.textContent, undo: !!t.querySelector('[data-h="undo"]') })));
ok(n2 === n0 - 2, `two files moved to Trash (${n0} → ${n2})`);
ok(g.length === 2 && g.every((t) => t.undo), `both toasts stay up, each with its own Undo — the second does not replace the first (${g.length})`);
await ev(() => document.activeElement?.blur());
if (MUT === 'nokeys') await ev(() => document.addEventListener('keydown', (e) => { if (e.ctrlKey) e.stopImmediatePropagation(); }, true));
await key('z', ['Control']); ok(await live() === n0 - 1, 'Ctrl Z undoes the latest');
await key('z', ['Control']); ok(await live() === n0, 'Ctrl Z again undoes the one before — a history, not one step');
await key('z', ['Control', 'Shift']); ok(await live() === n0 - 1, 'Ctrl ⇧ Z redoes');
await key('y', ['Control']); ok(await live() === n0 - 2, 'Ctrl Y redoes the next');
g = await ev(() => JSON.parse(localStorage.getItem('xw.db.v1')).library.filter((f) => !f.trashedAt).length); ok(g === n0 - 2, `redo is saved, not only shown (${g})`);
// the drawer: every change, with jump
await key('h', ['Control', 'Shift']); g = await ev(() => { const d = document.getElementById('xw-history'); return { on: d?.classList.contains('on'), rows: d?.querySelectorAll('li').length, focus: d?.contains(document.activeElement) }; });
ok(g.on && g.rows === 3 && g.focus, `Ctrl ⇧ H opens the history drawer with both changes and the start of the session, and focus moves into it (${g.rows})`);
await ev(() => document.querySelector('#xw-history [data-h="jump"]').click()); await wait(400);
ok(await live() === n0 - 1, '“Back to here” returns to the state right after that change');
await ev(() => document.querySelector('#xw-history [data-h="jump"]').click()); await wait(400);
ok(await live() === n0 - 2, '“Redo to here” jumps forward again');
await ev(() => document.querySelector('#xw-history [data-h="jump"][data-id="0"]').click()); await wait(500); ok(await live() === n0, '“Start of this session” takes every change back');
await key('y', ['Control']); await key('y', ['Control']);
await p.keyboard.press('Escape'); await wait(300); ok(await ev(() => !document.getElementById('xw-history').classList.contains('on')), 'Escape closes the drawer');
// someone else's change since is kept
await key('z', ['Control']); // undo the latest trash
const otherId = await ev(() => { const db = JSON.parse(localStorage.getItem('xw.db.v1')); const f = db.library.find((x) => !x.trashedAt); f.name = 'Renamed by Mira'; localStorage.setItem('xw.db.v1', JSON.stringify(db)); window.XENO_DB.reload(); return f.id; });
await key('z', ['Control', 'Shift']); g = await ev((id) => ({ name: JSON.parse(localStorage.getItem('xw.db.v1')).library.find((x) => x.id === id).name, toast: document.getElementById('xw-toasts').textContent }), otherId);
ok(g.name === 'Renamed by Mira' && /someone else/.test(g.toast), `redo after someone else edited the same record keeps their change and says so (${g.name})`);
// typing is never hijacked
await ev(() => { const i = document.createElement('input'); i.id = 'tt'; document.body.appendChild(i); i.focus(); }); const before = await live(); await key('z', ['Control']);
ok(await live() === before, 'Ctrl Z inside a text field is the field’s own undo, not the workspace’s');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close(); process.exitCode = fails ? 1 : 0;
