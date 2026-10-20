// Corpo › Analytics is real: the workspace's own numbers from /api/workspace-analytics (a stand-in here).
//   1. no sample rows ("Revenue €42k this month") and no "Preview — sample data" mark; Overview shows every metric
//   2. a division narrows tasks; a workspace-wide metric is not sent the division
//   3. save a dashboard → it opens; delete it → Undo restores it
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5211, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const METRICS = [['credits.spend', 'Credits', 'workspace'], ['tasks.throughput', 'Tasks', 'division'], ['storage.usage', 'Storage', 'workspace'], ['support.tickets', 'Support', 'workspace'], ['runs.agents', 'Agent runs', 'division']].map(([id, title, scope]) => ({ id, title, scope }));
const today = new Date().toISOString().slice(0, 10);
const VALUES = {
  'credits.spend': { wallet: true, balance: 900, spent: 123, series: [{ day: today, value: 123 }] },
  'tasks.throughput': { created: 4, closed: 2, createdSeries: [], closedSeries: [{ day: today, value: 2 }], open: { blocked: 1 }, medianCycleHours: 12 },
  'storage.usage': { usedBytes: 1536, allowanceBytes: 1048576, files: 2, byKind: [{ kind: 'image', bytes: 1000, files: 1 }] },
  'support.tickets': { open: { new: 1 }, openTotal: 1, created: 3, createdSeries: [], medianFirstResponseHours: 3 },
  'runs.agents': { byState: { completed: 1 }, total: 1, budgetCredits: 5 },
};
const db = { calls: [], dashboards: [], deleted: [] };

async function open(hash) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const sent = q.postData() ? JSON.parse(q.postData()) : null;
    if (u.pathname.startsWith('/api/workspace-analytics')) db.calls.push([q.method(), u.pathname + u.search, sent]);
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/workspace-analytics/metrics') return json({ success: true, workspaceId: 'w1', metrics: METRICS, divisions: [{ id: 'd-eng', name: 'Engineering' }] });
    let m = u.pathname.match(/^\/api\/workspace-analytics\/metrics\/(.+)$/);
    if (m) { const id = decodeURIComponent(m[1]); const div = u.searchParams.get('division'); const v = structuredClone(VALUES[id]); if (div && id === 'tasks.throughput') v.closed = 1;
      return json({ success: true, metric: id, scope: div ? 'division' : 'workspace', division: div ? { id: div, name: 'Engineering' } : null, days: Number(u.searchParams.get('days') || 30), value: v }); }
    if (u.pathname === '/api/workspace-analytics/dashboards' && q.method() === 'GET') return json({ success: true, dashboards: db.dashboards });
    if (u.pathname === '/api/workspace-analytics/dashboards' && q.method() === 'POST') { const d = { id: 'dash-' + (db.dashboards.length + 1), name: sent.name, widgets: sent.widgets }; db.dashboards.unshift(d); return json({ success: true, dashboard: d }); }
    m = u.pathname.match(/^\/api\/workspace-analytics\/dashboards\/([^/]+)(\/restore)?$/);
    if (m && q.method() === 'DELETE') { const i = db.dashboards.findIndex((d) => d.id === m[1]); db.deleted.push(...db.dashboards.splice(i, 1)); return json({ success: true, deleted: true, id: m[1], undo: 'restore' }); }
    if (m && m[2]) { const i = db.deleted.findIndex((d) => d.id === m[1]); const d = db.deleted.splice(i, 1)[0]; db.dashboards.unshift(d); return json({ success: true, dashboard: d }); }
    if (u.pathname.startsWith('/api/workspace-analytics/')) return json({ success: false, error: 'unexpected ' + u.pathname }, 500);
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    return json({ success: false, error: 'not found' }, 404); });
  await p.goto(base + '/workspace/' + hash, { waitUntil: 'domcontentloaded' }); await wait(1800);
  return { p, errs };
}
const cards = (p) => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-an-card]')].map((c) => [c.dataset.anCard, c.querySelector('[data-an-big]')?.textContent || ''])));

try {
  const { p, errs } = await open('#/corpo/z/analytics');
  const s0 = await p.evaluate(() => ({ page: document.querySelector('[data-an-page]')?.dataset.anPage, live: !!(window.XENO_ZONE_LIVE || {})['corpo.analytics'], mark: !!document.querySelector('#main [data-sample-badge]'), panelMark: !!document.querySelector('#panel [data-sample-badge]'), fake: document.body.textContent.includes('€42k') }));
  ok(s0.page === 'ready' && s0.live && !s0.mark && !s0.panelMark && !s0.fake, `Analytics is real: no sample rows, no sample mark (${JSON.stringify(s0)})`);
  let c = await cards(p);
  ok(Object.keys(c).length === 5 && c['credits.spend'] === '123' && c['tasks.throughput'] === '2' && c['storage.usage'] === '1.5 KB' && c['support.tickets'] === '1' && c['runs.agents'] === '1', `Overview shows every metric from the server (${JSON.stringify(c)})`);

  // division
  db.calls.length = 0;
  await p.select('[data-an-division]', 'd-eng'); await wait(700);
  c = await cards(p);
  const q = db.calls.filter((x) => x[0] === 'GET' && x[1].startsWith('/api/workspace-analytics/metrics/'));
  ok(c['tasks.throughput'] === '1', `the division narrows tasks (${c['tasks.throughput']})`);
  ok(q.find((x) => x[1].includes('tasks.throughput'))[1].includes('division=d-eng') && !q.find((x) => x[1].includes('credits.spend'))[1].includes('division='), 'only division metrics are sent the division');
  ok(/workspace-wide/.test(await p.$eval('[data-an-card="credits.spend"]', (e) => e.textContent)), 'a workspace-wide metric says so');
  await p.select('[data-an-division]', ''); await wait(400);

  // save a dashboard of two metrics
  await p.click('[data-an-new]'); await wait(200);
  await p.type('[data-an-name]', 'Support desk');
  await p.click('[data-an-pick="credits.spend"]'); await p.click('[data-an-pick="storage.usage"]'); await p.click('[data-an-pick="runs.agents"]');
  await p.select('[data-an-days]', '7');
  await p.click('[data-an-save]'); await wait(900);
  const post = db.calls.find((x) => x[0] === 'POST' && x[1].startsWith('/api/workspace-analytics/dashboards'));
  ok(post && post[2].name === 'Support desk' && JSON.stringify(post[2].widgets) === JSON.stringify([{ metric: 'tasks.throughput', days: 7 }, { metric: 'support.tickets', days: 7 }]), `the dashboard is saved with its metrics and window (${JSON.stringify(post && post[2])})`);
  c = await cards(p);
  ok(Object.keys(c).join() === 'tasks.throughput,support.tickets', `the saved dashboard opens with its two widgets (${Object.keys(c).join()})`);
  ok(await p.evaluate(() => [...document.querySelectorAll('[data-an-open]')].some((x) => x.textContent === 'Support desk' && x.getAttribute('aria-pressed') === 'true')), 'its tab is selected');

  // delete → undo
  await p.click('[data-an-delete="dash-1"]'); await wait(800);
  ok(db.dashboards.length === 0 && await p.evaluate(() => !!document.querySelector('[data-an-undone]') && document.querySelectorAll('[data-an-card]').length === 5), 'deleting goes back to Overview and offers Undo');
  await p.click('[data-an-undo="dash-1"]'); await wait(900);
  ok(db.calls.some((x) => x[0] === 'POST' && x[1].startsWith('/api/workspace-analytics/dashboards/dash-1/restore')) && db.dashboards.length === 1, 'Undo restores it through /restore');
  ok(await p.evaluate(() => !document.querySelector('[data-an-undone]') && document.querySelectorAll('[data-an-card]').length === 2), 'and reopens it');
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
  await p.close();
} finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
