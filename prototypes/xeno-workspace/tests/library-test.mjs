// The Library on the platform: real files and pictures; upload, download, rename, star, trash, restore, delete forever;
// every page of a long library; and where each file lives.
// A Vite server serves the workspace; the test answers /api/ from a small in-memory platform. Nothing real is touched.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5190, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();

const fid = (n) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;
const WS = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const file = (n, name, mime, size, extra = {}) => ({ id: 'file:' + fid(n), source: 'file', source_id: fid(n), name, category: /^image/.test(mime) ? 'images' : 'files', item_type: /^image/.test(mime) ? 'image' : 'file', mime_type: mime, size_bytes: size, description: '', preview_url: /^image/.test(mime) ? `/api/library/assets/${fid(n)}/content` : null, asset_id: fid(n), conversation_id: null, conversation_title: null, created_at: '2026-10-07T10:00:00Z', updated_at: '2026-10-07T10:00:00Z', workspace_id: null, place_kind: 'personal', workspace_name: null, starred: false, trashed_at: null, purge_after: null, ...extra });
const db = {
  user: { id: 'u1', username: 'ada', email: 'ada@example.test', display_name: 'Ada Lovelace', email_verified: true },
  items: [file(1, 'Engine diagram.png', 'image/png', PNG.length), file(2, 'Notes on the engine.pdf', 'application/pdf', 20480), file(3, 'In a project.pdf', 'application/pdf', 1024),
    file(4, 'Brand guide.pdf', 'application/pdf', 4096, { workspace_id: WS, place_kind: 'workspace', workspace_name: 'Analytical Engines Ltd' }),
    file(5, 'Not mine to trash.pdf', 'application/pdf', 512, { workspace_id: WS, place_kind: 'workspace', workspace_name: 'Analytical Engines Ltd' }),
    { ...file(9, 'Bernoulli numbers', 'text/plain', 900), id: 'artifact:' + fid(9), source: 'artifact', item_type: 'code', asset_id: null, conversation_id: 'c1', conversation_title: 'Programs for the engine' },
    { ...file(10, 'a difference engine, brass', 'image/png', 0), id: 'generation:' + fid(10) + ':1', source: 'generation', asset_id: null, preview_url: null }],
  linked: new Set([fid(3)]), notOwner: new Set([fid(5)]), calls: [], gets: [], uploads: [], expect: [], next: 20,
};
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const EMPTY = { '/api/account/overview': { success: true, overview: { user: {}, credits: { balance: 0 }, workspace_count: 1 } }, '/api/account/sessions': { success: true, sessions: [] }, '/api/account/security': { success: true, security: { confirmation: { confirmed: false, available: true, expires_at: null }, methods: ['password'], has_password: true, email: '', pending_email: null } }, '/api/account/api-keys': { success: true, keys: [] }, '/api/account/exports': { success: true, exports: [] }, '/api/auth/linked-accounts': { success: true, accounts: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } }, '/api/dashboard/stats': { success: true, stats: { usage_available: false, usage_by_surface: [] } }, '/api/user-data/settings': { success: true, settings: {} }, '/api/workspaces': { success: true, workspaces: [] }, '/api/chat/projects': { success: true, projects: [] }, '/api/chat/conversations': { success: true, conversations: [] } };
const refuse = (status, code) => json(status, { success: false, error: 'refused', code });
function answer(q) {
  const u = new URL(q.url()), m = q.method(), p = u.pathname;
  if (m !== 'GET') db.calls.push({ m, p, type: q.headers()['content-type'] || '', csrf: q.headers()['x-xeno-csrf'] || null, body: q.postData() || '' });
  if (p === '/api/auth/me') return json(200, { success: true, user: db.user });
  if (m === 'GET' && EMPTY[p]) { const b = EMPTY[p]; if (p === '/api/account/overview') b.overview.user = db.user; return json(200, b); }
  if (p === '/api/library/assets' && m === 'GET') {
    const view = u.searchParams.get('view') || 'active', limit = Number(u.searchParams.get('limit')) || 100, offset = Number(u.searchParams.get('offset')) || 0;
    db.gets.push({ view, limit, offset });
    const all = db.items.filter((x) => (view === 'trash' ? !!x.trashed_at : !x.trashed_at) && (view !== 'starred' || x.starred));
    const items = all.slice(offset, offset + limit);
    return json(200, { success: true, items, tab: 'all', sort: 'updated', limit, offset, view, place: '', total: all.length, has_more: offset + items.length < all.length });
  }
  const content = p.match(/^\/api\/library\/assets\/([^/]+)\/content$/);
  if (content && m === 'GET') { const it = db.items.find((x) => x.asset_id === content[1] && !x.trashed_at); if (!it) return json(404, { success: false, error: 'Library asset not found' }); return /^image/.test(it.mime_type) ? { status: 200, contentType: 'image/png', body: PNG } : { status: 200, contentType: it.mime_type, body: Buffer.from('%PDF-1.4 the stored bytes of ' + it.name) }; }
  if (p === '/api/library/trash' && m === 'DELETE') { const mine = db.items.filter((x) => x.trashed_at && !db.notOwner.has(x.source_id)); db.items = db.items.filter((x) => !mine.includes(x)); return json(200, { success: true, purged: mine.length }); }
  const purge = p.match(/^\/api\/library\/trash\/([^/]+)\/([^/]+)$/);
  if (purge && m === 'DELETE') { const it = db.items.find((x) => x.source === purge[1] && x.source_id === purge[2]); if (!it) return refuse(404, 'not_found'); if (!it.trashed_at) return refuse(409, 'not_in_trash'); db.items = db.items.filter((x) => x !== it); return json(200, { success: true }); }
  const act = p.match(/^\/api\/library\/assets\/([^/]+)\/([^/]+)(?:\/(star|trash|restore))?$/);
  if (act) {
    const it = db.items.find((x) => x.source === act[1] && x.source_id === act[2]); if (!it) return refuse(404, 'not_found');
    if (act[3] === 'star' && (m === 'PUT' || m === 'DELETE')) { it.starred = m === 'PUT'; return json(200, { success: true, starred: it.starred }); }
    if (act[3] === 'trash' && m === 'POST') { if (db.notOwner.has(it.source_id)) return refuse(403, 'forbidden'); if (db.linked.has(it.source_id)) return refuse(409, 'asset_has_project_references'); if (it.trashed_at) return refuse(409, 'already_in_trash'); it.trashed_at = '2026-10-08T12:00:00Z'; it.purge_after = '2026-11-07T12:00:00Z'; return json(200, { success: true, trashed_at: it.trashed_at, purge_after: it.purge_after }); }
    if (act[3] === 'restore' && m === 'POST') { if (!it.trashed_at) return refuse(409, 'not_in_trash'); it.trashed_at = null; it.purge_after = null; return json(200, { success: true }); }
    if (!act[3] && m === 'PATCH') { const name = String(JSON.parse(q.postData() || '{}').name || '').trim(); if (it.source === 'generation') return refuse(400, 'rename_unsupported'); if (!name || /[\\/]/.test(name)) return refuse(400, 'invalid_name'); it.name = name; return json(200, { success: true, name }); }
  }
  if (p === '/api/upload' && m === 'POST') { const name = db.expect.shift() || 'upload'; if (/\.exe$/.test(name)) return json(400, { error: "File type 'application/x-msdownload' is not allowed" }); db.uploads.push(name); db.items.unshift(file(db.next++, name, /\.png$/.test(name) ? 'image/png' : 'text/plain', 12)); return json(200, { success: true, file: { name } }); }
  return json(404, { success: false, error: 'not in the fake platform: ' + m + ' ' + p });
}

const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 950 });
const errs = [], missing = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.startsWith('/api/')) { const r = answer(q); if (r.status === 404 && !/\/content$/.test(u.pathname) && !/not_found/.test(r.body)) missing.push(q.method() + ' ' + u.pathname); return q.respond(r); } if (u.host.includes('fonts.g')) return q.abort(); q.continue(); });
await p.setCookie({ name: 'xeno_csrf', value: 'csrf-test-token', url: base });
const main = () => p.evaluate(() => document.querySelector('#main')?.innerText || '');
const goLib = async (item) => { await p.evaluate((it) => window.XW.go('global', { global: 'library', item: it }), item || null); await wait(450); };
const settle = async () => { await p.evaluate(() => window.XENO_NET.idle()); await wait(550); };
const names = (trash = false) => p.evaluate((t) => window.XENO_PG_LIBRARY.items.filter((x) => !!x.trashedAt === t).map((x) => x.name), trash);
const toastText = () => p.evaluate(() => document.getElementById('toast')?.innerText || '');
const dialog = () => p.evaluate(() => document.querySelector('.xd')?.innerText || '');
const lib = (fn, name, ...args) => p.evaluate((f, n, a) => { const it = window.XENO_PG_LIBRARY.items.find((x) => x.name === n); window.XENO_LIB[f](f === 'rename' ? it : [it], ...a); }, fn, name, args);
const paste = (name, type) => p.evaluate((n, t) => { const dt = new DataTransfer(); dt.items.add(new File(['hello engine'], n, { type: t })); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, name, type);
const sent = (m, re) => db.calls.find((x) => x.m === m && re.test(x.p));

try {
  await p.goto(base + '/workspace/', { waitUntil: 'networkidle0' }); await wait(700);
  ok((await p.evaluate(() => window.XENO_LIB.state().status)) === 'ready', 'the Library loads from the platform');
  ok(db.gets.some((g) => g.view === 'active') && db.gets.some((g) => g.view === 'trash'), 'it asks for the Library and for the trash');
  await goLib(); let t = await main();
  const list = await names();
  ok(list.length === 7 && ['Engine diagram.png', 'Notes on the engine.pdf', 'Bernoulli numbers', 'Brand guide.pdf'].every((n) => list.includes(n) && t.includes(n)), 'the files are the real ones (' + list.length + ')');
  await p.click('#main [data-pg-view="library"][data-v="grid"]'); await wait(700);
  const pics = await p.evaluate(() => [...document.querySelectorAll('#main [data-pg-file]')].map((c) => ({ name: c.querySelector('b')?.textContent, img: c.querySelector('.pg-thumb img')?.getAttribute('src') || null, loaded: !!c.querySelector('.pg-thumb img')?.naturalWidth, icon: !!c.querySelector('.pg-thumb--ic') })));
  const png = pics.find((x) => x.name === 'Engine diagram.png'), pdf = pics.find((x) => x.name === 'Notes on the engine.pdf');
  ok(!!png && /\/api\/library\/assets\/.+\/content$/.test(png.img || '') && png.loaded, 'an image shows its own picture, loaded from the platform');
  ok(!!pdf && !pdf.img && pdf.icon, 'a file that is not a picture shows a plain type icon, not sample artwork');
  ok(/Programs for the engine|Chat/.test(t) && /Uploaded/.test(t), 'each file says where it came from as far as the platform knows: a chat, or an upload');

  // ---- where a file lives ----
  const places = await p.evaluate(() => Object.fromEntries(window.XENO_PG_LIBRARY.items.map((x) => [x.name, x.place])));
  ok(places['Brand guide.pdf'] === 'Analytical Engines Ltd' && places['Engine diagram.png'] === 'Personal', 'each file knows where it lives: the person’s own space, or a named workspace');
  await p.evaluate(() => localStorage.setItem('xw.pgLibInfo', 'true')); await goLib();
  await p.click(`#main [data-pg-file="file:${fid(4)}"]`); await wait(350);
  ok(/Lives in\s*Analytical Engines Ltd/.test((await main()).replace(/\n/g, ' ')), 'the details say which workspace a file lives in');
  await p.evaluate(() => { const i = document.querySelector('#main [data-pg-q="library"]'); i.value = 'analytical'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(500);
  const found = await p.evaluate(() => [...document.querySelectorAll('#main [data-pg-file]')].map((c) => c.querySelector('b')?.textContent));
  ok(found.length === 2 && found.includes('Brand guide.pdf'), 'searching a workspace’s name finds its files (' + found.join(', ') + ')');
  await p.evaluate(() => { const i = document.querySelector('#main [data-pg-q="library"]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(300);

  // ---- menus offer what works ----
  const menuOf = (name) => p.evaluate((n) => window.XENO_LIB.fileMenu(window.XENO_PG_LIBRARY.items.find((x) => x.name === n), { open() {}, details() {}, copy() {} }).flat().map((i) => i.label), name);
  let menu = await menuOf('Notes on the engine.pdf');
  ok(JSON.stringify(menu) === JSON.stringify(['Open', 'Details', 'Star', 'Rename…', 'Download', 'Copy name', 'Move to Trash']), 'the file menu offers what works (' + menu.join(', ') + ')');
  ok(!(await menuOf('a difference engine, brass')).includes('Rename…'), 'a generated picture, named by its prompt, is not offered Rename');
  await p.evaluate(() => window.XENO_LIB.refuse('duplicate')); await wait(200);
  ok(/Duplicating a file isn’t available on XENO yet/.test(await toastText()), 'an action the platform still lacks says so');
  await goLib('Shared with me'); ok(/Shared with me isn’t available yet/.test(await main()), 'Shared with me says it is not available, and why');

  // ---- star ----
  await goLib(); db.calls.length = 0;
  await lib('star', 'Notes on the engine.pdf'); await settle();
  ok(!!sent('PUT', new RegExp(`/api/library/assets/file/${fid(2)}/star$`)) && sent('PUT', /star$/).csrf === 'csrf-test-token', 'starring a file tells the platform, with the CSRF token');
  await goLib('Starred'); t = await main();
  ok(/Notes on the engine\.pdf/.test(t) && !/Engine diagram\.png/.test(t), 'Starred lists the starred file and nothing else');
  await lib('star', 'Notes on the engine.pdf'); await settle();
  ok(!!sent('DELETE', /star$/) && !(await p.evaluate(() => window.XENO_PG_LIBRARY.items.find((x) => x.name === 'Notes on the engine.pdf').starred)), 'starring again removes the star');

  // ---- rename ----
  await goLib(); db.calls.length = 0;
  await lib('rename', 'Notes on the engine.pdf'); await wait(400);
  await p.evaluate(() => { const i = document.querySelector('.xd input'); i.value = 'Engine notes, final.pdf'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await p.click('.xd [data-xd-submit]'); await settle();
  let c = sent('PATCH', new RegExp(`/api/library/assets/file/${fid(2)}$`));
  ok(!!c && JSON.parse(c.body).name === 'Engine notes, final.pdf' && (await names()).includes('Engine notes, final.pdf') && !(await names()).includes('Notes on the engine.pdf'), 'renaming a file renames it on the platform');
  await p.evaluate(() => window.XENO_HIST.undo()); await settle();
  ok((await names()).includes('Notes on the engine.pdf'), 'Undo puts the old name back, on the platform too');
  db.calls.length = 0; await lib('rename', 'Notes on the engine.pdf'); await wait(400);
  await p.evaluate(() => { const i = document.querySelector('.xd input'); i.value = 'a/b.pdf'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await p.evaluate(() => document.querySelector('.xd [data-xd-submit]')?.click()); await wait(400);
  ok(/slash/.test(await dialog()) && !sent('PATCH', /./), 'a name with a slash is refused before anything is sent');
  // a form with a change in it asks before closing; closing twice discards it
  for (let k = 0; k < 2 && await dialog(); k++) { await p.evaluate(() => document.querySelector('.xd [data-xd-close]')?.click()); await wait(300); }
  ok(!(await dialog()), 'the rename form closes');

  // ---- upload, through the page's own paste path ----
  await goLib(); db.calls.length = 0;
  db.expect.push('Letter to Babbage.txt'); await paste('Letter to Babbage.txt', 'text/plain'); await settle();
  c = db.calls.find((x) => x.p === '/api/upload');
  ok(!!c && c.type.startsWith('multipart/form-data') && c.csrf === 'csrf-test-token' && db.uploads.length === 1, 'adding a file uploads it to the platform, as a form upload with the CSRF token');
  ok((await names()).includes('Letter to Babbage.txt') && (await names()).length === 8, 'the uploaded file is in the Library after the platform confirms it');
  db.calls.length = 0; db.expect.push('virus.exe'); await paste('virus.exe', 'application/x-msdownload'); await wait(900);
  const refusal = await dialog();
  await p.evaluate(() => document.querySelector('.xd [data-xd-ok]')?.click()); await settle();
  ok(/wasn’t added/.test(refusal) && /not allowed/.test(refusal) && !(await names()).includes('virus.exe'), 'a file the platform refuses is not shown as added (' + refusal.replace(/\s+/g, ' ').slice(0, 90) + ')');

  // ---- download: the stored bytes ----
  const dl = await p.evaluate(async () => { const f = window.XENO_PG_LIBRARY.items.find((x) => x.name === 'Notes on the engine.pdf'); return window.XENO_FILES.download([f]); });
  ok(!!dl && dl.real === true && dl.name === 'Notes on the engine.pdf' && dl.size === '%PDF-1.4 the stored bytes of Notes on the engine.pdf'.length, 'a download is the stored file, not sample content (' + JSON.stringify(dl) + ')');

  // ---- trash: no question asked, because it can be undone ----
  db.calls.length = 0;
  await lib('trash', 'Notes on the engine.pdf'); await settle();
  ok(!!sent('POST', new RegExp(`/api/library/assets/file/${fid(2)}/trash$`)) && !(await dialog()), 'moving a file to the trash tells the platform and asks nothing');
  ok(!(await names()).includes('Notes on the engine.pdf') && (await names(true)).includes('Notes on the engine.pdf'), 'it leaves the Library and is in the trash');
  await goLib('Trash'); t = await main();
  ok(/Notes on the engine\.pdf/.test(t) && !/Engine diagram\.png/.test(t), 'Trash lists it and nothing else');
  await p.click(`#main [data-pg-file="file:${fid(2)}"]`); await wait(350);
  ok(/Deleted for good\s*(in \d+ days|tomorrow|today)/.test((await main()).replace(/\n/g, ' ')), 'its details say when it will be deleted for good');
  await p.evaluate(() => document.querySelector('#main [data-pg-unsel]')?.click()); await wait(200);
  menu = await menuOf('Notes on the engine.pdf');
  ok(JSON.stringify(menu) === JSON.stringify(['Restore', 'Copy name', 'Delete forever…']), 'in the trash the menu is Restore and Delete forever (' + menu.join(', ') + ')');
  await p.evaluate(() => window.XENO_HIST.undo()); await settle();
  ok(!!sent('POST', /restore$/) && (await names()).includes('Notes on the engine.pdf') && !(await names(true)).length, 'Undo restores it, on the platform');

  db.calls.length = 0; await lib('trash', 'In a project.pdf'); await wait(900);
  const inUse = await dialog(); await p.evaluate(() => document.querySelector('.xd [data-xd-ok]')?.click()); await settle();
  ok(/project uses it/.test(inUse) && (await names()).includes('In a project.pdf'), 'a file a project uses is not trashed, and the reason is given');
  db.calls.length = 0; await lib('trash', 'Not mine to trash.pdf'); await wait(900);
  const notMine = await dialog(); await p.evaluate(() => document.querySelector('.xd [data-xd-ok]')?.click()); await settle();
  ok(/can see this file but can’t change it/.test(notMine) && (await names()).includes('Not mine to trash.pdf'), 'a workspace file the person does not own is not trashed, and the reason is given');

  // ---- the page's own buttons: trash from the details panel, restore and delete forever from the trash ----
  await goLib(); await p.click(`#main [data-pg-file="file:${fid(1)}"]`); await wait(350);
  db.calls.length = 0; await p.click('#main [data-pg-trash]'); await settle();
  ok(!!sent('POST', new RegExp(`/file/${fid(1)}/trash$`)) && (await names(true)).includes('Engine diagram.png'), 'the details panel’s trash button moves the file to the trash for real');
  await goLib('Trash'); await p.click(`#main [data-pg-file="file:${fid(1)}"]`); await wait(350);
  db.calls.length = 0; await p.click('#main [data-pg-restore]'); await settle();
  ok(!!sent('POST', /restore$/) && (await names()).includes('Engine diagram.png'), 'the Restore button restores it for real');

  // ---- delete forever: only in the trash, and it asks ----
  await lib('trash', 'Letter to Babbage.txt'); await settle();
  db.calls.length = 0; await lib('purge', 'Letter to Babbage.txt'); await wait(400);
  const ask = await dialog();
  ok(/Delete “Letter to Babbage\.txt” forever\?/.test(ask) && /can’t be undone/.test(ask) && db.calls.length === 0, 'deleting forever asks first and says it cannot be undone');
  await p.evaluate(() => document.querySelector('.xd [data-xd-close]')?.click()); await wait(300);
  ok((await names(true)).includes('Letter to Babbage.txt') && db.calls.length === 0, 'cancelling deletes nothing');
  await lib('purge', 'Letter to Babbage.txt'); await wait(400); await p.click('.xd [data-xd-ok]'); await settle();
  ok(!!sent('DELETE', /\/api\/library\/trash\/file\/.+$/) && !(await names(true)).includes('Letter to Babbage.txt') && !db.items.some((x) => x.name === 'Letter to Babbage.txt'), 'confirmed, it is deleted on the platform');
  db.calls.length = 0; await lib('purge', 'Engine diagram.png'); await wait(400);
  ok(!(await dialog()) && db.calls.length === 0, 'a file that is not in the trash is never offered Delete forever');

  // ---- empty trash ----
  await lib('trash', 'Bernoulli numbers'); await settle(); await lib('trash', 'Brand guide.pdf'); await settle();
  await goLib('Trash'); db.calls.length = 0; await p.click('#main [data-pg-empty-trash]'); await wait(400);
  ok(/Empty the trash\?/.test(await dialog()) && /2 items/.test(await dialog()) && db.calls.length === 0, 'Empty trash asks first and says how many');
  await p.click('.xd [data-xd-ok]'); await settle();
  ok(!!sent('DELETE', /^\/api\/library\/trash$/) && !(await names(true)).length && /Trash is empty/.test(await main()), 'confirmed, the trash is emptied on the platform');

  // ---- a long library: every page is loaded ----
  for (let i = 0; i < 430; i++) db.items.push(file(1000 + i, `Batch ${String(i).padStart(3, '0')}.pdf`, 'application/pdf', 10));
  db.gets.length = 0; await p.evaluate(() => window.XENO_LIB.load()); await wait(300);
  const loaded = (await names()).length, pages = db.gets.filter((g) => g.view === 'active').map((g) => g.offset);
  ok(loaded === db.items.length && loaded > 400 && JSON.stringify(pages) === JSON.stringify([0, 200, 400]), `a library past one page is loaded in full: ${loaded} files over ${pages.length} requests`);
  ok((await p.evaluate(() => window.XENO_LIB.state())).total === loaded, 'and the page knows the platform’s own count');

  ok(missing.length === 0, 'the workspace asked for no route the platform lacks (' + JSON.stringify([...new Set(missing)].slice(0, 3)) + ')');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { ok(false, 'threw: ' + String(e.message).split('\n')[0]); }
await b.close(); await server.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
