// tasks-open-measure — how long it takes to see your tasks, measured the same way for every way in.
// Opens a Tasks address in headless Chrome against a stand-in API (the same shapes the server answers) and reports, per
// run: requests, bytes transferred, scripts executed, and the time from navigation to the first task card on screen
// (`[data-tk-card]`), cold (empty cache) and warm (second visit, cache kept). Usage:
//   node prototypes/xeno-workspace/tests/tasks-open-measure.mjs [address ...]   (default: the workspace Tasks board)
//   An address is a workspace path (/workspace/tasks) or tasks:<path> for the Tasks host (tasks.localhost).
// Output is one JSON line per address, so a before and an after can be compared as numbers.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const net = await import('node:net');
const PORT = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });   // a free port: other sessions run tests too
const base = 'http://127.0.0.1:' + PORT;
const USER = { id: 'u1', username: 'me', email: 'me@x.test', display_name: 'Me', avatar_url: null, email_verified: true };
const now = new Date().toISOString();
const PEOPLE = [{ id: 'u1', name: 'Me', username: 'me', kind: 'human', me: true }, { id: 'a1', name: 'Builder', username: 'builder', kind: 'agent' }];
const tasks = Array.from({ length: 60 }, (_, i) => ({ key: 'T-' + (i + 1), number: i + 1, title: 'Task number ' + (i + 1), body: '', kind: 'task', priority: ['high', 'medium', 'low', 'none'][i % 4],
  status: ['raised', 'todo', 'in_progress', 'in_review', 'done'][i % 5], area: null, project: { id: 'p1', name: 'Website' }, assignee: i % 3 ? PEOPLE[0] : null, reviewer: null, reviewRequired: false,
  reporter: PEOPLE[0], labels: [], dueAt: null, parentKey: null, watching: false, createdAt: now, updatedAt: now, events: [], attachments: [], children: [], links: [], watchers: [], subtasks: { total: 0, done: 0 },
  can: { edit: true, attach: true, delete: true, work: true, comment: true, take: false, moves: ['todo'] } }));
const paths = process.argv.slice(2).length ? process.argv.slice(2) : ['/workspace/tasks'];

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true, allowedHosts: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const answer = (q) => {
  const u = new URL(q.url());
  if (u.hostname !== '127.0.0.1' && !u.hostname.endsWith('.localhost')) return q.respond({ status: 204, body: '' });            // fonts and other third parties: not ours to time
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const json = (body) => q.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, ...body }) });
  if (u.pathname === '/api/auth/me') return json({ user: USER });
  if (u.pathname === '/api/tasks') return json({ tasks });
  { const m = /^\/api\/tasks\/(T-\d+)$/.exec(u.pathname); if (m) { const t = tasks.find((x) => x.key === m[1]); return t ? json({ task: t }) : q.respond({ status: 404, contentType: 'application/json', body: '{"success":false}' }); } }
  if (u.pathname === '/api/tasks/assignees') return json({ assignees: PEOPLE });
  if (u.pathname === '/api/tasks/views') return json({ views: [] });
  return json({});
};
async function visit(page, url) {
  let n = 0, bytes = 0, scripts = 0;
  const cdp = await page.target().createCDPSession(); await cdp.send('Network.enable');
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });
  const onReq = (q) => { n++; if (q.resourceType() === 'script') scripts++; if (process.env.REQS) { const u = new URL(q.url()); if (!u.pathname.startsWith('/workspace/') && !u.pathname.startsWith('/api/')) console.log('REQ', u.host, u.pathname); } };
  page.on('request', onReq);
  const t0 = Date.now();
  await page.goto(url.startsWith('tasks:') ? 'http://tasks.localhost:' + PORT + url.slice(6) : base + url, { waitUntil: 'domcontentloaded' });
  // ready: a board or list shows its first card; a task page shows its properties column
  const ready = /\/T-\d+$/.test(url) ? '[data-tk-root^="task:"] .tk-side' : '[data-tk-card]';
  try { await page.waitForSelector(ready, { timeout: 15000 }); } catch (e) {
    // say what the page showed instead, so a failure is a finding and not a timeout
    const shot = path.join(repo, 'scratchpad', 'tasks-open-measure-fail.png');
    await import('node:fs').then((fs) => fs.mkdirSync(path.dirname(shot), { recursive: true }));
    await page.screenshot({ path: shot });
    const seen = await page.evaluate(() => ({ at: location.href, product: document.documentElement.dataset.product || null, main: (document.querySelector('#main')?.innerText || '').slice(0, 300) }));
    throw new Error('no task card on ' + url + ': ' + JSON.stringify(seen) + ' · screenshot ' + shot);
  }
  const ms = Date.now() - t0;
  page.off('request', onReq); await cdp.detach();
  return { ms, requests: n, scripts, kb: Math.round(bytes / 1024) };
}
for (const url of paths) {
  const ctx = await br.createBrowserContext();
  const page = await ctx.newPage(); await page.setViewport({ width: 1400, height: 900 });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.setRequestInterception(true); page.on('request', answer);
  try {
    const cold = await visit(page, url);
    const warm = await visit(page, url);
    if (process.env.DUMP) console.log(await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((n) => n.outerHTML.slice(0, 1500)).join('\n---\n'), process.env.DUMP));
    if (process.env.SHOT) { await new Promise((r) => setTimeout(r, 600)); await page.screenshot({ path: path.join(repo, 'scratchpad', 'tasks-open-' + url.replace(/[^a-z0-9]+/gi, '_') + '.png') }); }
    console.log(JSON.stringify({ url, cold, warm, pageErrors: errs.slice(0, 5) }));
  } catch (e) { console.log(JSON.stringify({ url, failed: e.message, pageErrors: errs.slice(0, 8) })); process.exitCode = 1; }
  await ctx.close();
}
await br.close(); await server.close();
