import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a); const idle = () => p.evaluate(() => window.XENO_NET?.idle?.());
const nav = async (r) => { await p.goto(url + '#/' + r); await p.reload(); await wait(1100); await idle(); };
const rclick = async (sel, extra = '') => { const bx = await ev((s, x) => { const n = [...document.querySelectorAll(s)].find((n) => n.offsetParent && (!x || n.matches(x))); if (!n) return null; n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 2), y: r.y + r.height / 2 }; }, sel, extra); if (!bx) return null; await p.mouse.click(bx.x, bx.y, { button: 'right' }); await wait(200); return bx; };
const menu = () => ev(() => { const m = document.querySelector('.xcm:not(.out):not(.sub)'); if (!m) return null; return { role: m.getAttribute('role'), items: [...m.querySelectorAll('.xcm-i')].map((x) => x.querySelector('.xcm-l').textContent.trim()), seps: m.querySelectorAll('.xcm-sep').length, r: m.getBoundingClientRect().toJSON() }; });
const pickItem = async (label) => { await ev((l) => { const it = [...document.querySelectorAll('.xcm:not(.out) .xcm-i')].find((x) => x.querySelector('.xcm-l').textContent.trim() === l); it.click(); }, label); await wait(350); await idle(); };
const esc = async () => { await p.keyboard.press('Escape'); await wait(180); await idle(); };
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });

// ---- library file ----
await nav('overview/g/library');
await rclick('#main [data-pg-file]');
let m = await menu();
ok(m && m.role === 'menu' && ['Open', 'Starred', 'Rename…', 'Duplicate', 'Move to project', 'Copy link', 'Download', 'Move to Trash'].every((x) => m.items.includes(x)) && m.seps >= 4, `a file's menu: open / organise / link / trash in groups (${m && m.items.join(' | ')})`);
let g = await ev(() => document.querySelector('#main [data-pg-file][aria-selected]')?.dataset.pgFile);
ok(!!g, 'right-clicking a file selects it (Finder, Drive)');
const fname = await ev((id) => window.XENO_PG_LIBRARY.items.find((f) => f.id === id).name, g);
await p.keyboard.press('m'); await wait(60); g = await ev(() => document.activeElement.textContent.trim()); ok(/^Move to project/.test(g), `type-ahead jumps to "Move to project" (${g})`);
await p.keyboard.press('ArrowRight'); await wait(200);
g = await ev(() => ({ sub: !!document.querySelector('.xcm.sub'), exp: document.querySelector('.xcm:not(.sub) [aria-expanded="true"]')?.textContent.trim(), focus: document.activeElement.closest('.xcm.sub') ? document.activeElement.textContent.trim() : null }));
ok(g.sub && /Move to project/.test(g.exp) && g.focus, `→ opens the submenu and focuses its first project (${g.focus})`);
const target = g.focus; await p.keyboard.press('Enter'); await wait(400);
g = await ev((n) => window.XENO_PG_LIBRARY.items.find((f) => f.name === n).project, fname);
ok(g === target, `choosing a project moves the file (${fname} → ${g})`);
const fid = await ev(() => document.querySelector('#main [data-pg-file][aria-selected]')?.dataset.pgFile);
const st0 = await ev((id) => window.XENO_PG_LIBRARY.items.find((f) => f.id === id).starred, fid);
await ev(() => document.activeElement?.blur?.()); await p.keyboard.press('s'); await wait(250);
ok(await ev((id) => window.XENO_PG_LIBRARY.items.find((f) => f.id === id).starred, fid) === !st0, 'S toggles Starred on the selected file — the key the menu shows');
const n0 = await ev(() => window.XENO_PG_LIBRARY.items.length);
await p.keyboard.down('Control'); await p.keyboard.press('d'); await p.keyboard.up('Control'); await wait(350);
g = await ev(() => window.XENO_PG_LIBRARY.items.map((f) => f.name)); ok(g.length === n0 + 1 && g.some((x) => / copy/.test(x)), `Ctrl+D duplicates it (${g.find((x) => / copy/.test(x))})`);
await rclick('#main [data-pg-file]', '[aria-selected]'); await pickItem('Rename…'); await wait(250);
await ev(() => { const i = document.querySelector('#xdf-name'); i.value = 'Renamed from menu'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await p.keyboard.press('Enter'); await wait(500);
ok(await ev(() => window.XENO_PG_LIBRARY.items.some((f) => f.name === 'Renamed from menu')), 'Rename… renames the file through the shared dialog');
const sel = await ev(() => document.querySelector('#main [data-pg-file][aria-selected]')?.dataset.pgFile);
await ev(() => document.activeElement?.blur?.()); await p.keyboard.press('Delete'); await wait(400);
g = await ev((id) => !!window.XENO_PG_LIBRARY.items.find((f) => f.id === id)?.trashedAt, sel); ok(g, `Delete moves the selected file to Trash (${sel})`);
await ev(() => document.querySelector('.pg-undo')?.click()); await wait(300); ok(!(await ev((id) => window.XENO_PG_LIBRARY.items.find((f) => f.id === id)?.trashedAt, sel)), '…and Undo brings it back');

// ---- page background ----
const bg = await ev(() => { const r = document.querySelector('#main .mview').getBoundingClientRect(); for (let y = r.bottom - 20; y > r.top; y -= 12) for (let x = r.right - 24; x > r.left + 200; x -= 40) { const n = document.elementFromPoint(x, y); if (n && (n.matches('.pg, .mview, .pg-body, .pg-split') )) return { x, y }; } return { x: r.right - 24, y: r.bottom - 20 }; });
await p.mouse.click(bg.x, bg.y, { button: 'right' }); await wait(200); m = await menu();
ok(m && m.items.includes('Copy link to this page') && m.items.includes('Layout'), `empty page space has the page's own menu (${m && m.items.join(' | ')})`);
await esc(); ok(!(await menu()), 'Esc closes it');

// ---- sidebar ----
await nav('studio/p/chat');
await rclick('#panel [data-chat]', ':not([data-sec="pinned"] *)'); m = await menu();
ok(m && ['Open', 'Pinned', 'Rename…', 'Move to project', 'Delete…'].every((x) => m.items.includes(x)), `a chat: ${m && m.items.join(' | ')}`);
const chatName = await ev(() => document.querySelector('#panel [data-menu-open]')?.dataset.chat);
await pickItem('Pinned'); g = await ev((t) => [...document.querySelectorAll('#panel [data-sec="pinned"] [data-chat]')].map((x) => x.dataset.chat).includes(t), chatName);
ok(g, `Pinned really pins "${chatName}" into the Pinned section`);
await rclick('#panel [data-project]'); m = await menu();
ok(m && ['Open', 'New task…', 'Rename…', 'Change icon…', 'Archive…', 'Delete…'].every((x) => m.items.includes(x)), `a project: ${m && m.items.join(' | ')}`);
await esc();
await ev(() => { const r = [...document.querySelectorAll('#panel [data-project]')].find((n) => n.offsetParent); r.querySelector('[data-more]').click(); }); await wait(200);
const m2 = await menu(); ok(m2 && JSON.stringify(m2.items) === JSON.stringify(m.items), 'the "…" button opens exactly the right-click menu');
await esc();
await rclick('#panel .sec > .sh'); m = await menu(); ok(m && m.items.includes('Collapse others') && m.items.includes('Expand all'), `a section heading: ${m && m.items.join(' | ')}`);
await esc();
await rclick('#rail [data-zone]'); m = await menu(); ok(m && m.items.some((x) => /^Open /.test(x)) && m.items.includes('Copy link'), `a rail area: ${m && m.items.join(' | ')}`);
await esc(); await rclick('#rail [data-go="library"]'); m = await menu(); ok(m && m.items.includes('Open Library') && m.items.includes('Open in new window'), `a rail destination: ${m && m.items.join(' | ')}`);
await esc();

// ---- text ----
await ev(() => { const ta = document.querySelector('#main textarea'); ta.focus(); ta.value = 'hello world'; ta.setSelectionRange(0, 5); });
const tb = await ev(() => { const r = document.querySelector('#main textarea').getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
await p.mouse.click(tb.x, tb.y, { button: 'right' }); await wait(200); m = await menu();
ok(m && ['Undo', 'Cut', 'Copy', 'Paste', 'Select all'].every((x) => m.items.includes(x)) && m.items.some((x) => x.startsWith('Ask XENO about “hello')), `a text field with a selection: ${m && m.items.join(' | ')}`);
ok(m && !m.items.includes('Back'), 'a text menu carries no page-level items (Chrome, macOS)');
await pickItem('Cut'); g = await ev(() => document.querySelector('#main textarea').value); ok(g.trim() === 'world', `Cut removes the selected text from the field ("${g}")`);
if (await ev(() => !!document.querySelector('#main [data-message-id]'))) { await rclick('#main [data-message-id]'); m = await menu(); ok(m && m.items.includes('Copy message') && m.items.includes('Quote in reply'), `a chat message: ${m && m.items.join(' | ')}`); await pickItem('Quote in reply'); g = await ev(() => document.querySelector('#main textarea').value); ok(/^> /.test(g), 'Quote in reply puts the quote in the composer'); }

// ---- keyboard ----
await ev(() => [...document.querySelectorAll('#panel [data-chat]')].find((n) => n.offsetParent).focus());
await p.keyboard.down('Shift'); await p.keyboard.press('F10'); await p.keyboard.up('Shift'); await wait(220);
g = await ev(() => ({ open: !!document.querySelector('.xcm.on'), first: document.activeElement.closest('.xcm') ? document.activeElement.querySelector('.xcm-l').textContent.trim() : null }));
ok(g.open && g.first === 'Open', `Shift+F10 opens the focused row's menu with the first item focused (${g.first})`);
await esc(); g = await ev(() => document.activeElement?.dataset?.chat); ok(!!g, `Esc returns focus to the row (${g})`);

// ---- home section ----
await nav('studio'); await rclick('#panel [data-product]'); m = await menu(); ok(m && m.items.includes('Pinned to the rail'), `a product row: ${m && m.items.join(' | ')}`); await esc();
await rclick('#main [data-hsec] h2'); m = await menu();
ok(m && m.items.includes('Move down') && m.items.some((x) => x.startsWith('Hide “')), `a home section: ${m && m.items.join(' | ')}`);
const first = await ev(() => document.querySelector('#main [data-hsec]').dataset.hsec);
await pickItem('Move down'); g = await ev(() => [...document.querySelectorAll('#main [data-hsec]')].map((x) => x.dataset.hsec));
ok(g[1] === first, `Move down really reorders the home (${first} is now second)`);
await rclick('#main [data-hsec] h2'); g = await ev(() => [...document.querySelectorAll('.xcm:not(.out) .xcm-i')].find((x) => /Move up/.test(x.textContent))?.getAttribute('aria-disabled'));
ok(g === 'true', 'Move up is disabled (shown, not hidden) on the first section');
await esc();

// ---- edges ----
await p.mouse.click(1435, 895, { button: 'right' }); await wait(200); m = await menu();
ok(m && m.r.right <= 1436 && m.r.bottom <= 892.5 && m.r.left >= 8, `a menu opened in the corner flips to stay on screen (${m && Math.round(m.r.right)}, ${m && Math.round(m.r.bottom)})`);
await esc();
g = await ev(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: true, clientX: 600, clientY: 400 }); document.querySelector('#main').dispatchEvent(e); return e.defaultPrevented; });
ok(!g, 'Shift+right-click is not intercepted — the native menu stays one keystroke away');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 6)); await b.close();
