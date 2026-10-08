// The Library on the platform: real files and pictures, real upload, download and delete, and honest gaps.
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
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const file = (n, name, mime, size, extra = {}) => ({ id: 'file:' + fid(n), source: 'file', source_id: fid(n), name, category: /^image/.test(mime) ? 'images' : 'files', item_type: /^image/.test(mime) ? 'image' : 'file', mime_type: mime, size_bytes: size, description: '', preview_url: /^image/.test(mime) ? `/api/library/assets/${fid(n)}/content` : null, asset_id: fid(n), conversation_id: null, conversation_title: null, created_at: '2026-10-07T10:00:00Z', updated_at: '2026-10-07T10:00:00Z', ...extra });
const db = {
  user: { id: 'u1', username: 'ada', email: 'ada@example.test', display_name: 'Ada Lovelace', email_verified: true },
  items: [file(1, 'Engine diagram.png', 'image/png', PNG.length), file(2, 'Notes on the engine.pdf', 'application/pdf', 20480), file(3, 'In a project.pdf', 'application/pdf', 1024),
    { id: 'artifact:' + fid(9), source: 'artifact', source_id: fid(9), name: 'Bernoulli numbers', category: 'files', item_type: 'code', mime_type: 'text/plain', size_bytes: 900, description: '', preview_url: null, asset_id: null, conversation_id: 'c1', conversation_title: 'Programs for the engine', created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T10:00:00Z' }],
  linked: new Set([fid(3)]), calls: [], uploads: [], expect: [], next: 20,
};
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const EMPTY = { '/api/account/overview': { success: true, overview: { user: {}, credits: { balance: 0 }, workspace_count: 1 } }, '/api/account/sessions': { success: true, sessions: [] }, '/api/auth/linked-accounts': { success: true, accounts: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } }, '/api/dashboard/stats': { success: true, stats: { usage_available: false, usage_by_surface: [] } }, '/api/user-data/settings': { success: true, settings: {} }, '/api/workspaces': { success: true, workspaces: [] }, '/api/chat/projects': { success: true, projects: [] }, '/api/chat/conversations': { success: true, conversations: [] } };
function answer(q) {
  const u = new URL(q.url()), m = q.method(), p = u.pathname;
  if (m !== 'GET') db.calls.push({ m, p, type: q.headers()['content-type'] || '', csrf: q.headers()['x-xeno-csrf'] || null, body: q.postData() || '' });
  if (p === '/api/auth/me') return json(200, { success: true, user: db.user });
  if (m === 'GET' && EMPTY[p]) { const b = EMPTY[p]; if (p === '/api/account/overview') b.overview.user = db.user; return json(200, b); }
  if (p === '/api/library/assets' && m === 'GET') return json(200, { success: true, items: db.items, tab: 'all', sort: 'updated', limit: 200, offset: 0 });
  const content = p.match(/^\/api\/library\/assets\/([^/]+)\/content$/);
  if (content && m === 'GET') { const it = db.items.find((x) => x.asset_id === content[1]); if (!it) return json(404, { success: false, error: 'Library asset not found' }); return /^image/.test(it.mime_type) ? { status: 200, contentType: 'image/png', body: PNG } : { status: 200, contentType: it.mime_type, body: Buffer.from('%PDF-1.4 the stored bytes of ' + it.name) }; }
  const del = p.match(/^\/api\/library\/assets\/([^/]+)\/([^/]+)$/);
  if (del && m === 'DELETE') { const id = decodeURIComponent(del[2]); if (db.linked.has(id)) return json(409, { success: false, error: 'Asset is referenced by a project', code: 'asset_has_project_references' }); const had = db.items.some((x) => x.source_id === id && x.source === del[1]); db.items = db.items.filter((x) => !(x.source_id === id && x.source === del[1])); return had ? json(200, { success: true }) : json(404, { success: false, error: 'Library item not found' }); }
  if (p === '/api/upload' && m === 'POST') { const name = db.expect.shift() || 'upload'; if (/\.exe$/.test(name)) return json(400, { error: "File type 'application/x-msdownload' is not allowed" }); db.uploads.push(name); db.items.unshift(file(db.next++, name, /\.png$/.test(name) ? 'image/png' : 'text/plain', 12)); return json(200, { success: true, file: { name } }); }
  return json(404, { success: false, error: 'not in the fake platform: ' + m + ' ' + p });
}

const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 950 });
const errs = [], missing = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.startsWith('/api/')) { const r = answer(q); if (r.status === 404 && !/\/content$/.test(u.pathname)) missing.push(q.method() + ' ' + u.pathname); return q.respond(r); } if (u.host.includes('fonts.g')) return q.abort(); q.continue(); });
await p.setCookie({ name: 'xeno_csrf', value: 'csrf-test-token', url: base });
const main = () => p.evaluate(() => document.querySelector('#main')?.innerText || '');
const goLib = async (item) => { await p.evaluate((it) => window.XW.go('global', { global: 'library', item: it }), item || null); await wait(450); };
const settle = async () => { await p.evaluate(() => window.XENO_NET.idle()); await wait(550); };
const names = () => p.evaluate(() => window.XENO_PG_LIBRARY.items.map((x) => x.name));
const toastText = () => p.evaluate(() => document.getElementById('toast')?.innerText || '');
const paste = (name, type) => p.evaluate((n, t) => { const dt = new DataTransfer(); dt.items.add(new File(['hello engine'], n, { type: t })); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, name, type);

try {
  await p.goto(base + '/workspace/', { waitUntil: 'networkidle0' }); await wait(700);
  ok((await p.evaluate(() => window.XENO_LIB.state().status)) === 'ready', 'the Library loads from the platform');
  await goLib(); let t = await main();
  const list = await names();
  ok(list.length === 4 && ['Engine diagram.png', 'Notes on the engine.pdf', 'Bernoulli numbers'].every((n) => list.includes(n) && t.includes(n)), 'the files are the real ones (' + list.length + ')');
  await p.click('#main [data-pg-view="library"][data-v="grid"]'); await wait(700);
  const pics = await p.evaluate(() => [...document.querySelectorAll('#main [data-pg-file]')].map((c) => ({ name: c.querySelector('b')?.textContent, img: c.querySelector('.pg-thumb img')?.getAttribute('src') || null, loaded: !!c.querySelector('.pg-thumb img')?.naturalWidth, icon: !!c.querySelector('.pg-thumb--ic') })));
  const png = pics.find((x) => x.name === 'Engine diagram.png'), pdf = pics.find((x) => x.name === 'Notes on the engine.pdf');
  ok(!!png && /\/api\/library\/assets\/.+\/content$/.test(png.img || '') && png.loaded, 'an image shows its own picture, loaded from the platform');
  ok(!!pdf && !pdf.img && pdf.icon, 'a file that is not a picture shows a plain type icon, not sample artwork');
  ok(/Programs for the engine|Chat/.test(t) && /Uploaded/.test(t), 'each file says where it came from as far as the platform knows: a chat, or an upload');

  await goLib('Trash'); ok(/There is no trash yet/.test(await main()), 'Trash says the platform has none, and that deleting is final');
  await goLib('Starred'); ok(/Starred isn’t available yet/.test(await main()), 'Starred says it is not available');

  // ---- what cannot be done yet is refused in words ----
  const menu = await p.evaluate(() => window.XENO_LIB.fileMenu(window.XENO_PG_LIBRARY.items[0], { open() {}, details() {}, copy() {} }).flat().map((i) => i.label));
  ok(JSON.stringify(menu) === JSON.stringify(['Open', 'Details', 'Download', 'Copy name', 'Delete forever…']), 'the file menu offers only what works (' + menu.join(', ') + ')');
  await p.evaluate(() => window.XENO_LIB.refuse('rename')); await wait(200);
  ok(/Renaming a file isn’t available on XENO yet/.test(await toastText()), 'an action the platform lacks says so');

  // ---- upload, through the page's own paste path ----
  await goLib(); db.calls.length = 0;
  db.expect.push('Letter to Babbage.txt'); await paste('Letter to Babbage.txt', 'text/plain'); await settle();
  let c = db.calls.find((x) => x.p === '/api/upload');
  ok(!!c && c.type.startsWith('multipart/form-data') && c.csrf === 'csrf-test-token' && db.uploads.length === 1, 'adding a file uploads it to the platform, as a form upload with the CSRF token');
  ok((await names()).includes('Letter to Babbage.txt') && (await names()).length === 5, 'the uploaded file is in the Library after the platform confirms it');
  db.calls.length = 0; db.expect.push('virus.exe'); await paste('virus.exe', 'application/x-msdownload'); await wait(900);
  const refusal = await p.evaluate(() => document.querySelector('.xd')?.innerText || '');
  await p.evaluate(() => document.querySelector('.xd [data-xd-ok]')?.click()); await settle();
  ok(/wasn’t added/.test(refusal) && /not allowed/.test(refusal) && !(await names()).includes('virus.exe'), 'a file the platform refuses is not shown as added (' + refusal.replace(/\s+/g, ' ').slice(0, 90) + ')');

  // ---- download: the stored bytes ----
  const dl = await p.evaluate(async () => { const f = window.XENO_PG_LIBRARY.items.find((x) => x.name === 'Notes on the engine.pdf'); return window.XENO_FILES.download([f]); });
  ok(!!dl && dl.real === true && dl.name === 'Notes on the engine.pdf' && dl.size === '%PDF-1.4 the stored bytes of Notes on the engine.pdf'.length, 'a download is the stored file, not sample content (' + JSON.stringify(dl) + ')');

  // ---- delete: final, asked first ----
  db.calls.length = 0;
  await p.evaluate(() => { window.XENO_LIB.remove([window.XENO_PG_LIBRARY.items.find((x) => x.name === 'Notes on the engine.pdf')]); }); await wait(350);
  const ask = await p.evaluate(() => document.querySelector('.xd')?.innerText || '');
  ok(/forever/.test(ask) && /no trash/.test(ask) && db.calls.length === 0, 'deleting asks first and says it cannot be undone');
  await p.click('.xd [data-xd-ok]'); await settle();
  c = db.calls.find((x) => x.m === 'DELETE');
  ok(!!c && /\/api\/library\/assets\/file\/bbbbbbbb-bbbb-4bbb-8bbb-000000000002$/.test(c.p) && !(await names()).includes('Notes on the engine.pdf'), 'the file is deleted on the platform, by its id, and leaves the list');

  db.calls.length = 0;
  await p.evaluate(() => { window.XENO_LIB.remove([window.XENO_PG_LIBRARY.items.find((x) => x.name === 'In a project.pdf')]); }); await wait(350);
  await p.click('.xd [data-xd-ok]'); await wait(900);
  const inUse = await p.evaluate(() => document.querySelector('.xd')?.innerText || '');
  await p.evaluate(() => document.querySelector('.xd [data-xd-ok]')?.click()); await settle();
  ok(/used by a project/.test(inUse) && (await names()).includes('In a project.pdf'), 'a file a project uses is not deleted, and the reason is given');

  // ---- the page's own trash button deletes for real ----
  await p.evaluate(() => localStorage.setItem('xw.pgLibInfo', 'true')); await goLib();
  await p.click('#main [data-pg-file="file:bbbbbbbb-bbbb-4bbb-8bbb-000000000001"]'); await wait(350);
  const hasTrash = await p.evaluate(() => !!document.querySelector('#main [data-pg-trash]'));
  if (hasTrash) { db.calls.length = 0; await p.click('#main [data-pg-trash]'); await wait(350); const said = await p.evaluate(() => document.querySelector('.xd')?.innerText || ''); await p.evaluate(() => document.querySelector('.xd [data-xd-close]')?.click()); await wait(200);
    ok(/Delete “Engine diagram\.png” forever\?/.test(said) && db.calls.length === 0 && (await names()).includes('Engine diagram.png'), 'the details panel’s delete asks before anything is removed, and cancelling removes nothing'); }
  else ok(false, 'the details panel did not show a delete button for the selected file');

  ok(missing.length === 0, 'the workspace asked for no route the platform lacks (' + JSON.stringify([...new Set(missing)].slice(0, 3)) + ')');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { ok(false, 'threw: ' + String(e.message).split('\n')[0]); }
await b.close(); await server.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
