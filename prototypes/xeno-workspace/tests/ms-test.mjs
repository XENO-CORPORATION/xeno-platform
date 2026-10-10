// Multi-select, real downloads, touch long-press, permission-aware paste — on a real http origin.
import { createRequire } from 'node:module'; import path from 'node:path'; import fs from 'node:fs'; import http from 'node:http'; import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const root = path.resolve('.'), MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${srv.address().port}`, url = origin + '/index.html';
const dl = path.resolve('../dl-test'); fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl);
const b = await puppeteer.launch({ headless: true }); const ctx = b.defaultBrowserContext();
const p = await b.newPage(); await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const cdp = await p.createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, eventsEnabled: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms)); let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a); const idle = () => p.evaluate(() => window.XENO_NET?.idle?.());
const nav = async (r) => { await p.goto(url + '#/' + r); await p.reload(); await wait(1100); await idle(); };
const cardBox = (i) => ev((i) => { const n = [...document.querySelectorAll('#main [data-pg-file]')][i]; n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + Math.min(40, r.height / 2), id: n.dataset.pgFile }; }, i);
const selected = () => ev(() => [...document.querySelectorAll('#main [data-pg-file][aria-selected]')].map((n) => n.dataset.pgFile));
const menu = () => ev(() => { const m = document.querySelector('.xcm:not(.out):not(.sub)'); return m && { touch: m.classList.contains('touch'), h: m.querySelector('.xcm-i')?.getBoundingClientRect().height, items: [...m.querySelectorAll('.xcm-i')].map((x) => x.querySelector('.xcm-l').textContent.trim()) }; });
const pick = async (label) => { await ev((l) => [...document.querySelectorAll('.xcm:not(.out) .xcm-i')].find((x) => x.querySelector('.xcm-l').textContent.trim().startsWith(l)).click(), label); await wait(300); await idle(); };
// a download is any file written after the action started — names repeat, so presence alone proves nothing
const newest = async (_after, ms = 6000) => { const t0 = Date.now() - 50; while (Date.now() - t0 < ms) { const f = fs.readdirSync(dl).filter((x) => !x.endsWith('.crdownload') && fs.statSync(path.join(dl, x)).mtimeMs >= t0); if (f.length) { await wait(200); return f[0]; } await wait(100); } return null; };
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url); await ev(() => { localStorage.clear(); indexedDB.deleteDatabase('xw.files'); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });
await nav('overview/g/library');

// ================= multi-select =================
let c0 = await cardBox(0), c2 = await cardBox(2), c4 = await cardBox(4);
await p.mouse.click(c0.x, c0.y); await p.keyboard.down('Control'); await p.mouse.click(c2.x, c2.y); await p.mouse.click(c4.x, c4.y); await p.keyboard.up('Control'); await wait(150);
let g = await selected(); ok(g.length === 3 && g.includes(c0.id) && g.includes(c2.id) && g.includes(c4.id), `Ctrl-click adds files to the selection (${g.length} selected)`);
g = await ev(() => document.querySelector('#main .mfoot [data-sb-info]').textContent); ok(/^3 selected · /.test(g), `the status bar says "${g}"`);
await p.keyboard.down('Control'); await p.mouse.click(c2.x, c2.y); await p.keyboard.up('Control'); await wait(100);
g = await selected(); ok(g.length === 2 && !g.includes(c2.id), 'Ctrl-click on a selected file takes it out again');
await p.mouse.click(c0.x, c0.y); await p.keyboard.down('Shift'); await p.mouse.click(c4.x, c4.y); await p.keyboard.up('Shift'); await wait(150);
g = await selected(); ok(g.length === 5, `Shift-click selects the whole range (${g.length})`);
g = await ev(() => getSelection().toString()); ok(!g, 'Shift-click selects files, not the text on them');
await ev(() => document.activeElement?.blur()); await p.keyboard.down('Control'); await p.keyboard.press('a'); await p.keyboard.up('Control'); await wait(150);
const all = await ev(() => document.querySelectorAll('#main [data-pg-results] [data-pg-file]').length); g = await selected(); ok(g.length === all && all > 5, `Ctrl+A selects every file on the page (${g.length}/${all})`);
await p.keyboard.press('Escape'); await wait(100); g = await selected(); ok(g.length === 0, 'Esc clears the selection');
await p.mouse.click(c0.x, c0.y); await wait(80); await p.keyboard.down('Shift'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.up('Shift'); await wait(150);
g = await selected(); ok(g.length === 3, `Shift+arrow extends the selection from the keyboard (${g.length})`);
// batch menu
await p.mouse.click(c0.x, c0.y); await p.keyboard.down('Shift'); await p.mouse.click(c4.x, c4.y); await p.keyboard.up('Shift'); await wait(100);
c2 = await cardBox(2); await p.mouse.click(c2.x, c2.y, { button: 'right' }); await wait(220);
let m = await menu(); ok(m && ['Star 5 files', 'Move 5 files to project', 'Download 5 files', 'Copy links', 'Move 5 files to Trash'].every((x) => m.items.some((y) => y.startsWith(x))), `right-click inside the selection acts on all five: ${m && m.items.join(' | ')}`);
ok((await selected()).length === 5, '…and does not collapse the selection');
await ev(() => { const o = document.querySelector('#main .pg-ib[data-pg-info]'); if (o && o.getAttribute('aria-pressed') !== 'true') o.click(); }); await wait(250);
g = await ev(() => document.querySelector('#main .pg-detail .pg-tag')?.textContent); ok(g === '5 selected', `the details pane summarises the selection ("${g}")`);
await p.mouse.click(c2.x, c2.y, { button: 'right' }); await wait(200); await pick('Move 5 files to Trash');
const ids5 = [c0.id, (await cardBox(0)).id]; g = await ev(() => window.XENO_PG_LIBRARY.items.filter((f) => f.trashedAt && f.trashedAt > new Date(Date.now() - 5000).toISOString()).length);
ok(g === 5, `Move 5 files to Trash trashes all five (${g})`);
await ev(() => document.querySelector('.pg-undo')?.click()); await wait(300); g = await ev(() => window.XENO_PG_LIBRARY.items.filter((f) => f.trashedAt && f.trashedAt > new Date(Date.now() - 9000).toISOString()).length);
ok(g === 0, '…and one Undo brings all five back');
c0 = await cardBox(0); c4 = await cardBox(4); await p.mouse.click(c0.x, c0.y); await p.keyboard.down('Shift'); await p.mouse.click(c4.x, c4.y); await p.keyboard.up('Shift'); await wait(100);
const c6 = await cardBox(6); await p.mouse.click(c6.x, c6.y, { button: 'right' }); await wait(200); m = await menu(); g = await selected();
ok(m && m.items.includes('Open') && g.length === 1 && g[0] === c6.id, `right-click outside the selection selects just that file and shows its own menu (${JSON.stringify({ items: m && m.items.slice(0, 3), g, c6: c6.id })})`);
await p.keyboard.press('Escape');

// ================= downloads (bytes on disk) =================
const sig = (f, n = 8) => fs.readFileSync(path.join(dl, f)).subarray(0, n);
let before = fs.readdirSync(dl);
const imgId = await ev(() => window.XENO_PG_LIBRARY.items.find((f) => f.kind === 'image' && f.media && !f.trashedAt).id);
const img = await ev((id) => { const f = window.XENO_PG_LIBRARY.items.find((x) => x.id === id); return { name: f.name, w: f.media.width, h: f.media.height }; }, imgId);
await ev((id) => window.XENO_FILES.download([window.XENO_PG_LIBRARY.items.find((x) => x.id === id)]), imgId); let got = await newest(before);
const png = got && fs.readFileSync(path.join(dl, got)); ok(got === img.name && png.subarray(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === Math.min(img.w, 4096) && png.readUInt32BE(20) === Math.round(img.h * Math.min(1, 4096 / Math.max(img.w, img.h))), `an image downloads as a real PNG at its own size (${got}, ${png && png.readUInt32BE(16)}×${png && png.readUInt32BE(20)})`);
before = fs.readdirSync(dl); await ev(() => window.XENO_FILES.download([window.XENO_PG_LIBRARY.items.find((x) => /\.pdf$/.test(x.name))])); got = await newest(before);
ok(got && sig(got, 5).toString() === '%PDF-', `a .pdf downloads as a real PDF (${got})`);
const pdfOk = (() => { try { return execFileSync('python', ['-c', `import sys;d=open(sys.argv[1],'rb').read();print(d.count(b'endobj'), b'%%EOF' in d[-10:])`, path.join(dl, got)]).toString().trim(); } catch { return 'n/a'; } })();
ok(/^5 True$/.test(pdfOk), `…with a valid structure (5 objects, trailer present: ${pdfOk})`);
before = fs.readdirSync(dl); await ev(() => window.XENO_FILES.download([window.XENO_PG_LIBRARY.items.find((x) => x.kind === 'video' && !x.trashedAt)])); got = await newest(before, 9000);
ok(got && /\.webm$/.test(got) && sig(got, 4).toString('hex') === '1a45dfa3', `a video downloads as a real WebM and its name says so (${got})`);
before = fs.readdirSync(dl); await ev(() => window.XENO_FILES.download([window.XENO_PG_LIBRARY.items.find((x) => x.kind === 'sheet')])); got = await newest(before);
ok(got && /\.csv$/.test(got) && /Item,Owner,Amount/.test(fs.readFileSync(path.join(dl, got), 'utf8')), `a sheet downloads as CSV (${got})`);
// an uploaded file comes back byte for byte, even after a reload
const payload = 'exact bytes ' + Date.now();
await ev((s) => { const dt = new DataTransfer(); dt.items.add(new File([s], 'my-upload.txt', { type: 'text/plain' })); document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }, payload); await wait(400);
await p.reload(); await wait(1200);
before = fs.readdirSync(dl); await ev(() => window.XENO_FILES.download([window.XENO_PG_LIBRARY.items.find((x) => x.name === 'my-upload.txt')])); got = await newest(before);
ok(got === 'my-upload.txt' && fs.readFileSync(path.join(dl, got), 'utf8') === payload, 'an uploaded file downloads with its exact bytes — after a reload (IndexedDB)');
// several → one zip, verified by Python's zipfile
await nav('overview/g/library');
c0 = await cardBox(0); c4 = await cardBox(3); await p.mouse.click(c0.x, c0.y); await p.keyboard.down('Shift'); await p.mouse.click(c4.x, c4.y); await p.keyboard.up('Shift'); await wait(100);
before = fs.readdirSync(dl); c2 = await cardBox(1); await p.mouse.click(c2.x, c2.y, { button: 'right' }); await wait(200); await pick('Download 4 files'); got = await newest(before, 12000);
const zipCheck = got ? (() => { try { return execFileSync('python', ['-c', `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(), len(z.namelist()))`, path.join(dl, got)]).toString().trim(); } catch (e) { return 'error ' + e.message.slice(0, 80); } })() : 'none';
ok(got && /\.zip$/.test(got) && zipCheck === 'None 4', `four files download as one zip that Python's zipfile validates (${got}: ${zipCheck})`);
await p.keyboard.press('Escape');
// the details pane's Download is real too
const di = await ev(() => [...document.querySelectorAll('#main [data-pg-file]')].findIndex((n) => window.XENO_PG_LIBRARY.items.find((f) => f.id === n.dataset.pgFile).kind === 'document')); c0 = await cardBox(di); await p.mouse.click(c0.x, c0.y); await wait(250);
before = fs.readdirSync(dl); await ev(() => document.querySelector('#main .pg-detail [data-pg-download]').click()); got = await newest(before, 12000);
ok(!!got, `the details pane's Download button downloads the file (${got} | ${JSON.stringify(await ev(() => ({ toast: document.getElementById('toast').textContent, sel: [...document.querySelectorAll('#main [data-pg-file][aria-selected]')].length, btn: !!document.querySelector('#main .pg-detail [data-pg-download]'), last: window.XENO_FILES.last() })))})`);

// ================= paste =================
await ctx.overridePermissions(origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
await nav('studio/p/chat');
await ev(() => navigator.clipboard.writeText(' from the clipboard'));
await ev(() => { const ta = document.querySelector('#main textarea'); ta.focus(); ta.value = 'hello'; ta.setSelectionRange(5, 5); });
let tb = await ev(() => { const r = document.querySelector('#main textarea').getBoundingClientRect(); return { x: r.x + 120, y: r.y + r.height / 2 }; });
await p.mouse.click(tb.x, tb.y, { button: 'right' }); await wait(200); await pick('Paste'); await wait(300);
g = await ev(() => document.querySelector('#main textarea').value); ok(g === 'hello from the clipboard', `Paste inserts the clipboard text at the caret ("${g}")`);
await nav('overview/g/library');
await ev(() => navigator.clipboard.writeText('a note I copied'));
const n0 = await ev(() => window.XENO_PG_LIBRARY.items.length);
const bg = await ev(() => { const r = document.querySelector('#main .mview').getBoundingClientRect(); for (let y = r.bottom - 20; y > r.top; y -= 12) for (let x = r.right - 24; x > r.left + 200; x -= 40) { const n = document.elementFromPoint(x, y); if (n && n.matches('.pg, .mview, .pg-body, .pg-split')) return { x, y }; } return null; });
await p.mouse.click(bg.x, bg.y, { button: 'right' }); await wait(200); m = await menu(); ok(m && m.items.includes('Paste') && m.items.includes('Select all'), `the Library's own menu offers Paste and Select all (${m && m.items.join(' | ')})`);
await pick('Paste'); await wait(500);
g = await ev(() => window.XENO_PG_LIBRARY.items.find((f) => /^Pasted text/.test(f.name))); ok(g && (await ev(() => window.XENO_PG_LIBRARY.items.length)) === n0 + 1, `pasting text into the Library adds it as a file (${g && g.name})`);
before = fs.readdirSync(dl); await ev((id) => window.XENO_FILES.download([window.XENO_PG_LIBRARY.items.find((x) => x.id === id)]), g.id); got = await newest(before);
ok(got && fs.readFileSync(path.join(dl, got), 'utf8') === 'a note I copied', '…and that file holds exactly what was pasted');
await ev(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' })); document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })); }); await wait(400);
g = await ev(() => window.XENO_PG_LIBRARY.items.some((f) => f.name === 'shot.png')); ok(g, 'Ctrl+V with a copied image on the Library adds the image');
await cdp.send('Browser.setPermission', { permission: { name: 'clipboard-read' }, setting: 'denied', origin });
await nav('studio/p/chat'); await ev(() => { const ta = document.querySelector('#main textarea'); ta.focus(); ta.value = 'x'; });
tb = await ev(() => { const r = document.querySelector('#main textarea').getBoundingClientRect(); return { x: r.x + 120, y: r.y + r.height / 2 }; });
await p.mouse.click(tb.x, tb.y, { button: 'right' }); await wait(200); await pick('Paste'); await wait(300);
g = await ev(() => document.getElementById('toast').textContent); ok(/blocked for this site/.test(g), `when clipboard access is blocked, it says so and how to fix it ("${g.slice(0, 70)}…")`);

// ================= touch =================
const t = await b.newPage(); await t.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
await t.setViewport({ width: 1180, height: 820, hasTouch: true }); await t.goto(url + '#/overview/g/library'); await t.reload(); await wait(1200);
const tev = (f, ...a) => t.evaluate(f, ...a);
const tc = await tev(() => { const n = [...document.querySelectorAll('#main [data-pg-file]')][1]; const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 40, id: n.dataset.pgFile }; });
await t.touchscreen.touchStart(tc.x, tc.y); await wait(250); await t.touchscreen.touchEnd(); await wait(250);
g = await tev(() => !!document.querySelector('.xcm:not(.out)')); ok(!g, 'a short tap does not open a menu');
await tev(() => document.querySelector('.xcm')?.remove());
await t.touchscreen.touchStart(tc.x, tc.y); await wait(900);   /* measured after the 160 ms opening animation, never during it */
m = await tev(() => { const m = document.querySelector('.xcm:not(.out)'); return m && { touch: m.classList.contains('touch'), h: Math.round(m.querySelector('.xcm-i').getBoundingClientRect().height), kbd: [...m.querySelectorAll('kbd')].some((k) => k.offsetParent), first: m.querySelector('.xcm-l').textContent.trim() }; });
const route0 = await tev(() => window.XENO_ADDR.current());
await t.touchscreen.touchEnd(); await wait(350);
ok(m && m.touch && m.h >= 44 && !m.kbd && m.first === 'Open', `press and hold opens the file's menu, sized for a finger (rows ${m && m.h} px, no key hints)`);
g = await tev((r) => ({ open: !!document.querySelector('.xcm:not(.out)'), same: location.hash === r }), route0); ok(g.open && g.same, 'lifting the finger keeps the menu open and does not open the file underneath');
await tev(() => [...document.querySelectorAll('.xcm:not(.out) .xcm-i')].find((x) => x.querySelector('.xcm-l').textContent.trim() === 'Starred').click()); await wait(300);
g = await tev((id) => window.XENO_PG_LIBRARY.items.find((f) => f.id === id).starred, tc.id); const s0 = g;
ok(typeof s0 === 'boolean' && !(await tev(() => !!document.querySelector('.xcm:not(.out)'))), 'tapping a menu item runs it and closes the menu');
await t.touchscreen.touchStart(tc.x, tc.y); await wait(120); await t.touchscreen.touchMove(tc.x, tc.y + 40); await wait(600); await t.touchscreen.touchEnd(); await wait(200);
g = await tev(() => !!document.querySelector('.xcm:not(.out)')); ok(!g, 'moving the finger (a scroll) cancels the press-and-hold');

console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 6)); await b.close(); srv.close();
