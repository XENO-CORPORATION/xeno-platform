// storage-clouds-browser — Connected clouds (Google Drive through XENO Connect) in the website Storage, against a stand-in
// for the platform's /api/storage/connect proxy that keeps Connect's rules (link → completed, 410 handled server-side,
// ids only). Walks connect → browse → upload → rename → trash/undo → disconnect, and proves each address survives a
// fresh load and Back. Also proves the page never receives or stores a token.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('./vite-workspace.mjs');
const PORT = 5203, base = 'http://127.0.0.1:' + PORT;
const USER = { id: 'u1', username: 'me', email: 'me@x.test', display_name: 'Me', avatar_url: null, email_verified: true };
const WS = '0f0f0f0f-0000-4000-8000-000000000001';
const START = 'https://connect.xeno.test/v1/connect/link/start/' + 'h'.repeat(24);
let failed = 0;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const db = {
  calls: [], conns: [], linkStarted: false, uploads: {},
  files: { root: [{ id: 'fold1', name: 'Plans', mimeType: 'application/vnd.google-apps.folder', parents: ['ROOTID'] }, { id: 'file1', name: 'notes.txt', mimeType: 'text/plain', size: '5', parents: ['ROOTID'] }], fold1: [] },
};
const all = () => Object.values(db.files).flat();
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Drafts' : undefined));
br.on('targetchanged', (t) => { if (t.url() === START) db.linkStarted = true; });
await p.setRequestInterception(true);
p.on('request', (q) => {
  const u = new URL(q.url());
  if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const method = q.method(); const raw = q.postData(); let b = {}; try { b = raw ? JSON.parse(raw) : {}; } catch { b = {}; }
  db.calls.push([method, u.pathname + u.search, q.headers()['idempotency-key'] || null, q.headers()['x-xeno-csrf'] ? 'csrf' : null]);
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER });
  if (u.pathname === '/api/workspaces') return json(200, { success: true, workspaces: [{ id: WS, name: 'Me', workspace_type: 'personal' }] });
  const m = u.pathname.match(/^\/api\/storage\/connect\/workspaces\/([^/]+)\/(.*)$/);
  if (m) {
    if (m[1] !== WS) return json(403, { error: { code: 'not_a_member' } });
    const rest = m[2];
    if (rest === 'connections') return json(200, db.conns);
    if (rest === 'providers') return json(200, { providers: [{ id: 'google', features: ['drive'], apps: [{ id: 'google-xeno', kind: 'xeno' }] }] });
    if (rest === 'link/sessions' && method === 'POST') return json(200, { id: 'link1', startUrl: START, expiresAt: Date.now() + 600000 });
    if (rest === 'link/sessions/link1') {
      if (!db.linkStarted) return json(200, { id: 'link1', status: 'pending' });
      if (!db.conns.length) db.conns.push({ id: 'conn1', workspaceId: WS, providerId: 'google', providerAppId: 'google-xeno', providerAccountId: 'a', displayName: 'me@gmail.test', status: 'active', grantedScopes: [], revision: 1 });
      return json(200, { id: 'link1', status: 'completed', connectionId: 'conn1' });
    }
    if (rest === 'connections/conn1/revoke') { db.conns = []; return json(200, { revoked: true }); }
    const op = rest.match(/^connections\/conn1\/operations\/(.+)$/);
    if (op) {
      const name = op[1];
      if (name === 'drive.files.list') return json(200, { files: (db.files[b.parentId] || []).filter((f) => !f.trashed), incompleteSearch: false });
      if (name === 'drive.files.stat') { if (b.fileId === 'root') return json(200, { id: 'ROOTID', name: 'My Drive', mimeType: 'application/vnd.google-apps.folder' }); const f = all().find((x) => x.id === b.fileId); return f ? json(200, f) : json(404, { error: { code: 'NOT_FOUND' } }); }
      if (name === 'drive.quota.read') return json(200, { usage: '1048576', limit: '16106127360', quotaDomain: { status: 'unknown' } });
      if (name === 'drive.files.create') { const f = { id: 'fold2', name: b.name, mimeType: 'application/vnd.google-apps.folder', parents: [b.parentId] }; (db.files[b.parentId] ||= []).push(f); db.files.fold2 = []; return json(200, f); }
      const f = all().find((x) => x.id === b.fileId);
      if (name === 'drive.files.rename') { f.name = b.name; return json(200, f); }
      if (name === 'drive.files.trash') { f.trashed = true; return json(200, f); }
      if (name === 'drive.files.restore') { f.trashed = false; return json(200, f); }
      if (name === 'drive.files.move') { const from = db.files[b.removeParentId === 'ROOTID' ? 'root' : b.removeParentId] || db.files.root; from.splice(from.indexOf(f), 1); (db.files[b.addParentId] ||= []).push(f); f.parents = [b.addParentId]; return json(200, f); }
    }
    if (rest === 'connections/conn1/content') { const s = Number(u.searchParams.get('start')), e = Number(u.searchParams.get('end')); return q.respond({ status: 206, headers: { 'content-range': `bytes ${s}-${e}/5` }, contentType: 'application/octet-stream', body: 'hello'.slice(s, e + 1) }); }
    if (rest === 'connections/conn1/uploads' && method === 'POST') { db.uploads.up1 = { b, got: 0 }; return json(200, { id: 'up1', status: 'uploading', acknowledgedBytes: 0 }); }
    if (rest.startsWith('connections/conn1/uploads/up1/parts')) { const up = db.uploads.up1; up.got += (raw || '').length; const f = { id: 'file9', name: up.b.name, mimeType: up.b.mimeType, size: String(up.got), parents: [up.b.parentId] }; (db.files[up.b.parentId] ||= []).push(f); return json(200, { id: 'up1', status: 'completed', acknowledgedBytes: String(up.got), fileId: 'file9' }); }
  }
  if (u.pathname === '/api/library/storage') return json(200, { success: true, storage: { usedBytes: 0, allowanceBytes: null, files: 0, byKind: [] } });
  if (u.pathname === '/api/notifications') return json(200, { success: true, unread: 0, items: [] });
  if (u.pathname === '/api/workspace/search') return json(200, { success: true, results: [], counts: {} });
  if (u.pathname === '/api/workspace/needs') return json(200, { success: true, items: [] });
  return json(200, { success: true });
});
const main = () => p.$eval('#main', (e) => e.innerText).catch(() => '');
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const fresh = async (url) => { await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await settle(2000); };
const pathNow = () => new URL(p.url()).pathname;
const S = '/workspace/corpo/apps/storage';
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await settle(250); } return false; };

try {
  await p.setCookie({ name: 'xeno_csrf', value: 'c'.repeat(32), url: base });
  await fresh(`${S}/connections`);
  let t = await main();
  ok(/Connected clouds/.test(t) && /No cloud accounts connected/.test(t) && /Connect Google Drive/.test(t), 'the accounts page opens at …/storage/connections with Connect Google Drive');
  const side = await p.$eval('#panel', (e) => e.innerText).catch(() => '');
  ok(/Connected clouds/.test(side), 'the Storage sidebar lists Connected clouds');

  // connect: a new tab goes to Connect's one-use start address; this page polls and lands on the account
  await p.click('[data-xsc="connect"]');
  ok(await until(async () => pathNow() === `${S}/connections/conn1`), 'Connect → Google → completed lands on …/connections/<connectionId>');
  ok(db.linkStarted, 'the browser itself navigated to Connect\'s start address');
  ok(db.calls.some(([mth, u, , c]) => mth === 'POST' && u.endsWith('/link/sessions') && u.includes(WS) && c), 'the link is started in the named workspace with the CSRF header');
  await settle(); t = await main();
  ok(/Plans/.test(t) && /notes\.txt/.test(t) && /me@gmail\.test/.test(t), 'the account opens on My Drive with its files and the account in the breadcrumb');
  const top = await p.$eval('body', (e) => e.innerText);
  ok(/1 MB of 15 GB used in Google Drive/.test(top), 'the quota is shown');

  // browse into a folder, by id; refresh and Back
  for (const pg of await br.pages()) if (pg !== p) await pg.close().catch(() => {});   // the Google tab
  await p.click('.xst-r[data-xsc-item="fold1"] .nm'); await settle();
  ok(pathNow() === `${S}/connections/conn1/folders/fold1`, 'a folder is addressed …/connections/<c>/folders/<id>');
  await fresh(`${S}/connections/conn1/folders/fold1`);
  ok(/This folder is empty/.test(await main()) && /Plans/.test(await main()), 'the folder survives a fresh load at its address');
  await p.goBack(); await settle(1500);
  ok(pathNow() === `${S}/connections/conn1` && /notes\.txt/.test(await main()), 'Back returns to My Drive');

  // a file, by id; fresh load; download through ranged reads
  await p.click('.xst-r[data-xsc-item="file1"] .nm'); await settle();
  ok(pathNow() === `${S}/connections/conn1/items/drive/file1`, 'a file is addressed …/items/drive/<fileId>');
  await fresh(`${S}/connections/conn1/items/drive/file1`);
  t = await main(); ok(/notes\.txt/.test(t) && /Download/.test(t) && /Move to trash/.test(t), 'the file view survives a fresh load');
  await p.click('[data-xsc="download"]');
  ok(await until(async () => /Downloaded/.test(await main())) && db.calls.some(([, u]) => /content\?fileId=file1&start=0&end=4/.test(u)), 'download reads the file by byte range');
  await p.click('[data-xsc="crumb"][data-to="connections/conn1"]'); await settle();

  // upload
  const input = await p.$('[data-xsc-files]');
  await input.uploadFile(path.join(here, 'storage-clouds-browser.test.mjs'));
  ok(await until(async () => /Uploaded/.test(await main())), 'upload finishes');
  const start = db.calls.find(([mth, u]) => mth === 'POST' && u.endsWith('/connections/conn1/uploads'));
  ok(start && /^[0-9a-f]{32}$/.test(start[2]) && db.calls.some(([mth, u]) => mth === 'PUT' && /uploads\/up1\/parts\?offset=0/.test(u)), 'the upload starts with an Idempotency-Key and writes parts at Connect\'s offset');
  ok(/storage-clouds-browser\.test\.mjs/.test(await main()), 'the uploaded file is listed');

  // new folder
  await p.click('[data-xsc="new"]');
  ok(await until(async () => /Made “Drafts”/.test(await main())), 'New folder makes a folder in Drive');

  // rename
  await p.hover('.xst-r[data-xsc-item="file1"]'); await p.click('.xst-r[data-xsc-item="file1"] [data-xsc="rename"]'); await settle(300);
  await p.$eval('[data-xsc-name]', (i) => { i.value = 'renamed.txt'; }); await p.focus('[data-xsc-name]'); await p.keyboard.press('Enter');
  ok(await until(async () => /renamed\.txt/.test(await main()) && !/notes\.txt/.test(await main())), 'rename changes the name in Drive');
  const renameKey = db.calls.find(([, u]) => u.endsWith('drive.files.rename'))?.[2];
  ok(/^[0-9a-f]{32}$/.test(renameKey || ''), 'each change carries its own Idempotency-Key');

  // move into Plans
  await p.hover('.xst-r[data-xsc-item="file1"]'); await p.click('.xst-r[data-xsc-item="file1"] [data-xsc="move"]'); await settle(300);
  await p.click('[data-xsc="moveto"][data-id="fold1"]');
  ok(await until(async () => /Moved “renamed\.txt”/.test(await main()) && !/renamed\.txt\n/.test(await p.$eval('[data-xsc-list]', (e) => e.innerText).catch(() => ''))), 'move puts the file in another folder');
  ok(db.files.fold1.some((f) => f.id === 'file1'), 'the move reached Drive');

  // trash with undo
  await p.hover('.xst-r[data-xsc-item="file9"]'); await p.click('.xst-r[data-xsc-item="file9"] [data-xsc="trash"]');
  ok(await until(async () => /Moved “storage-clouds-browser\.test\.mjs” to the trash/.test(await main())), 'trash moves the file to Drive\'s trash');
  await p.click('[data-xsc="undo"]');
  ok(await until(async () => /Restored/.test(await main()) && /storage-clouds-browser\.test\.mjs/.test(await p.$eval('[data-xsc-list]', (e) => e.innerText).catch(() => ''))), 'Undo restores it');

  // disconnect
  await p.click('[data-xsc="crumb"][data-to="connections"]'); await settle();
  await p.click('[data-xsc-conn="conn1"] [data-xsc="disconnect"]');
  ok(await until(async () => /Disconnected/.test(await main()) && /No cloud accounts connected/.test(await main())), 'Disconnect removes the account');

  // no token ever reaches the page
  const stored = await p.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
  ok(!/eyJ|DPoP|access_token|xeno-connect/i.test(stored), 'no token is in localStorage, sessionStorage or a readable cookie');
  ok(db.calls.every(([, u]) => !/connect\.xeno\.test/.test(u)), 'the page calls only the platform, never Connect directly');
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
} catch (e) { failed++; console.log('FAIL', e.stack); }
await br.close(); await server.close();
console.log(failed ? `${failed} failed` : 'storage-clouds: all passed'); process.exit(failed ? 1 : 0);
