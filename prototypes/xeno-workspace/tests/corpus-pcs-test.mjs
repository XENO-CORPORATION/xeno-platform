// Settings › Corpus on your PCs: /api/account/corpus-pcs (a stand-in here).
//   1. it has its own address, and nobody with no PC is told what to do
//   2. a PC shows what's turned on, by name; Turn off says so; Remove asks first
//   3. a failed load says it failed
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5296, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const ID = '11111111-1111-4111-8111-111111111111';
const db = { pcs: [], fail: false, patches: [], deletes: [] };
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const M = q.method();
  if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
  if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
  if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
  if (u.pathname === '/api/account/overview') return json({ success: true, overview: { user: { ...USER, plan: 'free' }, credits: { balance: 0 }, workspace_count: 1 } });
  if (u.pathname === '/api/account/corpus-pcs' && M === 'GET') return db.fail ? json({ error: 'x' }, 500) : json({ pcs: db.pcs });
  if (u.pathname === `/api/account/corpus-pcs/${ID}` && M === 'PATCH') { const s = JSON.parse(q.postData()); db.patches.push(s); db.pcs[0].enabled = s.enabled; db.pcs[0].connected = s.enabled; return json({ pc: { id: ID, enabled: s.enabled } }); }
  if (u.pathname === `/api/account/corpus-pcs/${ID}` && M === 'DELETE') { db.deletes.push(ID); db.pcs = []; return json({ revoked: true, id: ID }); }
  return json({ success: false, error: 'not found' }, 404); });
const open = async () => { await p.goto(base + '/workspace/settings/pcs', { waitUntil: 'domcontentloaded' }); await wait(2200); };
const main = () => p.evaluate(() => document.querySelector('#main')?.innerText || document.body.innerText);
try {
  await open();
  ok((await p.evaluate(() => location.pathname)).endsWith('/settings/pcs'), `it has its own address (${await p.evaluate(() => location.pathname)})`);
  ok(/No PC is connected/.test(await main()) && /turn a project on/.test(await main()), 'with no PC, it says what to do');
  ok(/Answers aren’t kept on XENO’s servers/.test(await main()), 'and what happens to answers');
  db.pcs = [{ id: ID, label: 'Work PC', os: 'win32', enabled: true, connected: true, appVersion: '0.3.5', projects: [{ id: 'a', name: 'Thesis' }, { id: 'b', name: 'Notes' }], lastSeenAt: new Date().toISOString() }];
  await open();
  const t = await main();
  ok(/Work PC/.test(t) && /Connected now/.test(t) && /Thesis, Notes/.test(t), 'a PC shows that it’s connected and what’s turned on');
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/corpus-pcs.png' });
  await p.click('[data-acct="pcEnable"]'); await wait(900);
  ok(db.patches[0]?.enabled === false && /Turned off/.test(await main()), 'Turn off turns it off, and says so');
  await p.click('[data-acct="pcEnable"]'); await wait(900);
  ok(db.patches[1]?.enabled === true, 'Turn on turns it back on');
  await p.click('[data-acct="pcRemove"]'); await wait(400);
  ok(!db.deletes.length && !!(await p.$('.xd')), 'Remove asks first');
  await p.click('.xd .xd-btn[data-xd-close]'); await wait(300);
  ok(!db.deletes.length, 'saying no removes nothing');
  await p.click('[data-acct="pcRemove"]'); await wait(400);
  await p.click('.xd [data-xd-ok]'); await wait(900);
  ok(db.deletes.length === 1 && /No PC is connected/.test(await main()), 'saying yes removes it');
  db.fail = true; await open();
  ok(/couldn’t load your PCs/.test(await main()), 'a failed load says it failed, rather than “no PC”');
  { const c = await p.evaluate(() => document.querySelector('.crumbs')?.innerText || ''); ok(/Corpus on your PCs/.test(c), `the breadcrumb says its name, not its id (${c.split(/\s+/).join(' ')})`); }
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
} catch (e) { fails++; console.log('FAIL threw:', e.message); }
await b.close(); await server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
