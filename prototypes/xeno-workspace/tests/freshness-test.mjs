// A live page's status bar says what its data REALLY did. It used to say "Updated just now" whatever happened,
// including after a load that failed. Against stand-ins that fail on demand:
//   1. Support, Tasks, Community and Releases: a first load that fails says "Couldn't load" (never "Updated")
//   2. Retry in the status bar fetches again, and only a load that worked says "Updated just now"
//   3. a refresh that fails over data already shown keeps the data and says "Couldn't refresh"
//   4. a failed Support queue or Deploys list says it failed instead of showing an empty list
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5373, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
let STAFF = false;
const USER = () => ({ id: 'u1', username: 'ada', email: 'a@x.test', display_name: 'Ada', avatar_url: null, email_verified: true, role: STAFF ? 'admin' : 'user' });
const down = new Set();   // which endpoints answer 500 right now
const now = () => new Date().toISOString();
const sla = { firstResponseDueAt: now(), firstRespondedAt: null, resolutionDueAt: now(), firstResponseBreached: false, resolutionBreached: false };
const TICKET = { key: 'T-1', number: 1, kind: 'bug', title: 'Login loops', body: '', status: 'new', priority: 'normal', createdAt: now(), updatedAt: now(), url: '/workspace/support/T-1', sla, messages: [], attachments: [], requester: { id: 'u1', name: 'Ada' } };
const TASK = { id: 't1', key: 'X-1', title: 'Fix the gate', state: 'todo', status: 'todo', priority: 'normal', labels: [], createdAt: now(), updatedAt: now(), assignee: null, delegate: null, reviewer: null, project: null };
const THREAD = { shortId: 'abc', title: 'How do I export?', space: { name: 'Questions', slug: 'questions' }, author: { handle: 'ada', displayName: 'Ada', kind: 'human' }, postCount: 1, status: 'open', isResolved: false, lastActivityAt: now(), createdAt: now(), tags: [], score: 0 };

const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  if (down.has(u.pathname)) return json({ success: false, error: 'The server did not answer' }, 500);
  if (u.pathname === '/api/auth/me') return json({ success: true, user: USER() });
  if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
  if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
  if (u.pathname === '/api/support/tickets/mine') return json({ success: true, tickets: [TICKET] });
  if (u.pathname === '/api/support/tickets/queue') return STAFF ? json({ success: true, tickets: [TICKET] }) : json({ success: false }, 403);
  if (u.pathname === '/api/tasks') return json({ success: true, tasks: [TASK] });
  if (u.pathname === '/api/tasks/views') return json({ success: true, views: [] });
  if (u.pathname === '/api/releases/whats-new') return json({ success: true, notes: [{ id: 'n1', title: 'Faster sign-in', body: 'Sign-in is faster.', publishedAt: now() }] });
  if (u.pathname === '/api/releases/summary') return STAFF ? json({ success: true, summary: { deploys: 1, features: 0, notes: 0 } }) : json({ success: false }, 404);
  if (u.pathname === '/api/releases/deploys') return json({ success: true, deploys: [] });
  if (u.pathname === '/api/forum/threads') return json({ success: true, threads: [THREAD] });
  if (u.pathname === '/api/forum/me') return json({ success: true, capabilities: {}, actor: {} });
  return json({ success: false, error: 'not found' }, 404); });
const open = async (addr) => { await p.goto(base + addr, { waitUntil: 'domcontentloaded' }); await wait(1800); };
const bar = () => p.evaluate(() => document.querySelector('#main .mfoot .sb-fresh')?.innerText.trim() || '(no freshness line)');
const main = () => p.evaluate(() => document.querySelector('#main')?.innerText || '');
const press = async () => { await p.click('#main .mfoot [data-pg-reload]'); await wait(900); };

try {
  // ── Support: first load fails, retry works, a later refresh fails over shown data
  down.add('/api/support/tickets/mine');
  await open('/workspace/support');
  ok(/Couldn't load/.test(await bar()) && !/Updated/.test(await bar()), `Support: a failed first load says so (${await bar()})`);
  down.delete('/api/support/tickets/mine');
  await press();
  ok(/Updated just now/.test(await bar()) && /Login loops/.test(await main()), `Support: Retry fetches again, and the bar says Updated only now (${await bar()})`);
  down.add('/api/support/tickets/mine');
  await press();
  ok(/Couldn't refresh/.test(await bar()) && /Login loops/.test(await main()), `Support: a failed refresh keeps the requests and says it couldn't refresh (${await bar()})`);
  down.delete('/api/support/tickets/mine');

  // ── Tasks
  down.add('/api/tasks');
  await open('/workspace/tasks');
  ok(/Couldn't load/.test(await bar()) && !/Updated/.test(await bar()), `Tasks: a failed first load says so (${await bar()})`);
  down.delete('/api/tasks');
  await press();
  ok(/Updated just now/.test(await bar()), `Tasks: Retry fetches again (${await bar()})`);

  // ── Community (the forum index)
  down.add('/api/forum/threads');
  await open('/workspace/community');
  ok(/Couldn't load/.test(await bar()) && !/Updated/.test(await bar()), `Community: a failed first load says so (${await bar()})`);
  down.delete('/api/forum/threads');
  await press();
  ok(/Updated just now/.test(await bar()) && /How do I export/.test(await main()), `Community: Retry fetches again (${await bar()})`);

  // ── staff lists that used to turn a failure into "nothing here"
  STAFF = true;
  down.add('/api/support/tickets/queue');
  await open('/workspace/support/queue');
  ok(/queue did not load/i.test(await main()) && !/Nothing here/.test(await main()), `Support queue: a failed load says it failed, not "Nothing here" (${(await main()).replace(/\s+/g, ' ').slice(0, 160)})`);
  down.delete('/api/support/tickets/queue');
  // ── Releases (staff): a failed summary is shown as a failure, not as the customer's What's new
  down.add('/api/releases/summary');
  await open('/workspace/releases');
  ok(/Couldn't load/.test(await bar()) && /summary did not load/.test(await main()), `Releases: a failed first load says so, and stays the staff view (${await bar()} | ${(await main()).replace(/\s+/g, ' ').slice(0, 160)})`);
  down.delete('/api/releases/summary');
  await press();
  ok(/Updated just now/.test(await bar()) && !/summary did not load/.test(await main()), `Releases: Retry fetches again (${await bar()})`);
  down.add('/api/releases/deploys');
  await open('/workspace/releases/deploys');
  ok(/Deploys did not load/.test(await main()) && !/No deploys recorded yet/.test(await main()), 'Deploys: a failed load says it failed, not "No deploys recorded yet"');
  down.delete('/api/releases/deploys');
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
} catch (e) { fails++; console.log('FAIL threw:', e.message); }
await b.close(); await server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
