// tasks-host-test — XENO Tasks on its own host (tasks.xenosystem.ai; owner, 2026-11-21: "a full viewport render for the
// tasks alone, with a header, fast … she can open Tasks, select the project and set it there as to be done, assign,
// with the full logic we created to assign to agents"). Against a stand-in API (the server's shapes), on
// tasks.localhost, which the browser sends to this machine and address.js reads as the Tasks host. Proves:
//   - the page is the workspace's own Tasks with only its scripts (scripts/vite-workspace.mjs PRODUCT_SCRIPTS);
//   - the product header, no rail or sidebar, the page filling the window under it;
//   - the host's own addresses: / is the board, /My%20tasks a list, /T-4 a task; Back works; a reload lands there;
//   - Andreia's flow: New task in the header → pick the project and a person → it is created there → Accept moves it
//     to To do → delegate to an agent;
//   - any other place opens in the full workspace on the main site.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import net from 'node:net';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace, PRODUCT_SCRIPTS } = await import('../../../scripts/vite-workspace.mjs');
const PORT = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const HOST = 'http://tasks.localhost:' + PORT;
let failed = 0; const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const now = () => new Date().toISOString();
const USER = { id: 'u1', username: 'andreia', email: 'a@x.test', display_name: 'Andreia', email_verified: true, role: 'user', kind: 'human' };
const ME = { id: 'u1', kind: 'human', name: 'Andreia' };
const PEOPLE = [{ id: 'u1', name: 'Andreia', username: 'andreia', kind: 'human', me: true }, { id: 'u2', name: 'Codrin', username: 'codrin', kind: 'human' }, { id: 'a1', name: 'Builder', username: 'builder', kind: 'agent' }];
const PROJECT = { id: 'p0000000-0000-4000-8000-000000000001', name: 'Website', status: 'active', area: null, created_at: now(), updated_at: now(), settings: {} };
const MOVES = { raised: ['todo', 'wont_do'], todo: ['in_progress', 'wont_do'], in_progress: ['blocked', 'in_review', 'done'], blocked: ['in_progress'], in_review: ['done', 'in_progress'], done: ['raised'], wont_do: ['raised'] };
const db = { tasks: [], seq: 0, calls: [] };
const view = (t) => ({ attachments: [], children: [], links: [], watchers: [], subtasks: { total: 0, done: 0 }, canLink: true, parent: null, events: [], ...t, can: { edit: true, attach: true, delete: true, work: true, comment: true, take: !t.assignee, moves: MOVES[t.status] || [] } });
const mk = (b) => { const t = { key: 'T-' + ++db.seq, number: db.seq, title: b.title, body: b.body || '', kind: b.kind || 'task', priority: b.priority || 'none', status: 'raised', area: null,
  project: b.projectId ? { id: b.projectId, name: PROJECT.name } : null, assignee: b.assigneeId ? PEOPLE.find((p) => p.id === b.assigneeId) : null, delegate: null, reviewer: null, reviewRequired: false,
  reporter: ME, labels: [], dueAt: null, parentKey: null, watching: true, createdAt: now(), updatedAt: now() }; db.tasks.push(t); return t; };
mk({ title: 'Fix the signup copy', projectId: PROJECT.id }); mk({ title: 'Office budget' });

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true, allowedHosts: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
let scripts = new Set(); p.on('request', (q) => { if (q.resourceType() === 'script') scripts.add(new URL(q.url()).pathname.split('/').pop()); });
await p.setRequestInterception(true);
p.on('request', (q) => {
  const u = new URL(q.url());
  if (!/(^|\.)localhost$|^127\.0\.0\.1$/.test(u.hostname)) return q.respond({ status: 204, body: '' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const method = q.method(); let b = {}; try { b = q.postData() ? JSON.parse(q.postData()) : {}; } catch { b = {}; }
  db.calls.push([method, u.pathname, b]);
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER });
  if (u.pathname === '/api/workspaces') return json(200, { success: true, workspaces: [] });
  if (u.pathname === '/api/chat/projects') return json(200, { success: true, projects: [PROJECT] });
  if (u.pathname === '/api/chat/conversations') return json(200, { success: true, conversations: [] });
  if (u.pathname === '/api/tasks/assignees') return json(200, { success: true, assignees: PEOPLE });
  if (u.pathname === '/api/tasks/views') return json(200, { success: true, views: [] });
  if (u.pathname === '/api/tasks' && method === 'GET') return json(200, { success: true, tasks: db.tasks.map(view) });
  if (u.pathname === '/api/tasks' && method === 'POST') return json(201, { success: true, task: view(mk(b)) });
  const m = /^\/api\/tasks\/(T-\d+)(\/[\w-]+)?$/.exec(u.pathname);
  if (m) {
    const t = db.tasks.find((x) => x.key === m[1]); if (!t) return json(404, { success: false, error: 'Task not found' });
    if (!m[2] && method === 'GET') return json(200, { success: true, task: view(t) });
    if (m[2] === '/transition') { if (!(MOVES[t.status] || []).includes(b.to)) return json(400, { success: false, error: 'Not allowed' }); t.status = b.to; t.updatedAt = now(); return json(200, { success: true, task: view(t) }); }
    if (m[2] === '/delegate') { t.delegate = b.agentId ? PEOPLE.find((x) => x.id === b.agentId) : null; t.updatedAt = now(); return json(200, { success: true, task: view(t) }); }
    if (m[2] === '/watch') return json(200, { success: true, task: view(t) });
  }
  return json(200, { success: true });
});
const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));
const pickOpen = () => p.waitForSelector('.tk-pick:not([hidden])', { timeout: 4000 });
const pickClick = (re) => p.evaluate((src) => { const rx = new RegExp(src); const b = [...document.querySelectorAll('.tk-pick:not([hidden]) .tk-pick-i')].find((x) => rx.test(x.textContent.trim())); if (b) b.click(); return !!b; }, re.source);
const at = () => p.evaluate(() => decodeURIComponent(location.pathname));
try {
  await p.goto(HOST + '/', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('[data-tk-card]', { timeout: 15000 }); await settle();

  // ── the page: the workspace's Tasks, its scripts only, filling the window under the product header
  const want = new Set(PRODUCT_SCRIPTS.tasks);
  ok(scripts.size === want.size && [...scripts].every((s) => want.has(s)), `the Tasks host loads only Tasks' ${want.size} scripts (loaded ${scripts.size})`);
  const lay = await p.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; };
    const h = document.querySelector('[data-product-header="tasks"]')?.getBoundingClientRect(), m = document.getElementById('main').getBoundingClientRect();
    return { product: document.documentElement.dataset.product, header: !!h && h.height === 44 && h.top === 0 && h.width === innerWidth, rail: vis('#rail'), panel: vis('#slot'), main: m.top === 44 && m.left === 0 && m.right === innerWidth && m.bottom === innerHeight,
      name: document.querySelector('.ph-home b')?.textContent, board: document.querySelector('.ph-tab[aria-selected="true"]')?.textContent };
  });
  ok(lay.product === 'tasks' && lay.header && lay.name === 'Tasks', 'the Tasks header runs across the top, 44px, with the mark and the name');
  ok(!lay.rail && !lay.panel && lay.main, 'no rail and no sidebar: Tasks fills the window below the header');
  ok(lay.board === 'Board' && await p.$('[data-tk-card="T-1"]') && await p.$('[data-tk-card="T-2"]'), 'the board is the first view, with every task of the workspace');
  ok(!(await p.evaluate(() => [...document.querySelectorAll('#main .topbar [data-tk="new"]')].some((e) => getComputedStyle(e).display !== 'none'))), 'New task is in the header once, not repeated in the page bar');

  // ── the host's own addresses
  await p.click('[data-ph-go="My tasks"]'); await settle();
  ok(await at() === '/My tasks' && /My tasks/.test(await p.$eval('.ph-tab[aria-selected="true"]', (e) => e.textContent)), 'My tasks has its own address on the host: /My tasks');
  await p.goBack(); await settle();
  ok(await at() === '/' && await p.$('[data-tk-card="T-1"]'), 'Back returns to the board at /');
  await p.goto(HOST + '/T-1', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('[data-tk-root="task:T-1"] .tk-side', { timeout: 15000 });
  ok(/T-1/.test(await p.$eval('.ph-crumb-name', (e) => e.textContent)) && await at() === '/T-1', 'a task has its own address, /T-1: opened directly, it shows the task and says so in the header');
  const away = await p.evaluate(() => [window.XENO_ADDR.url('#/overview/g/projects'), window.XENO_ADDR.url('#/overview/g/tasks/T-1'), document.querySelector('.ph-hi')?.getAttribute('href')]);
  ok(away[0] === 'http://localhost:' + PORT + '/workspace/projects' && away[1] === HOST + '/T-1' && away[2] === 'http://localhost:' + PORT + '/workspace/tasks', 'a place that is not Tasks is the full workspace on the main site; Tasks stays on this host; the header links to Tasks in the workspace');

  // ── Andreia's flow: New task → the project and a person → To do → an agent
  await p.goto(HOST + '/', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('[data-tk-card]', { timeout: 15000 }); await settle(800);
  await p.click('[data-ph-new]'); await p.waitForSelector('.xd [data-tk-new]', { timeout: 4000 });
  ok(true, 'New task in the header opens the New task window');
  await p.type('.xd [data-n-title]', 'Fix the login page spacing');
  await p.click('.xd [data-n-chip="project"]'); await pickOpen(); await settle(200);
  ok(await pickClick(/Website/), 'the project picker lists the workspace’s projects'); await settle(200);
  await p.click('.xd [data-n-chip="assignee"]'); await pickOpen(); await settle(200);
  const groups = await p.$$eval('.tk-pick:not([hidden]) .tk-pick-g', (els) => els.map((e) => e.textContent));
  ok(groups.includes('People') && groups.includes('Agents'), 'the assignee picker offers people and agents');
  await pickClick(/Codrin/); await settle(200);
  await p.keyboard.down('Control'); await p.keyboard.press('Enter'); await p.keyboard.up('Control'); await settle(1200);
  const made = db.tasks.find((t) => t.title === 'Fix the login page spacing');
  const post = db.calls.find(([mth, pth, b]) => mth === 'POST' && pth === '/api/tasks' && b.title === 'Fix the login page spacing');
  ok(made && post && post[2].projectId === PROJECT.id && post[2].assigneeId === 'u2', 'it is created in the project, assigned to the person picked');
  ok(await at() === '/' + made.key && !!(await p.$(`[data-tk-root="task:${made.key}"]`)), `the new task opens at its own address, /${made.key}`);
  await p.waitForSelector('.tk-next .tk-act--main', { timeout: 4000 }); await p.click('.tk-next .tk-act--main'); await settle(800);
  ok(made.status === 'todo', 'Accept moves it from Triage to To do');
  await p.click('[data-tk-prop="delegate"]'); await pickOpen(); await settle(200);
  ok(await pickClick(/Builder/), 'the Agent row offers the workspace’s agents'); await settle(900);
  ok(made.delegate && made.delegate.id === 'a1' && db.calls.some(([mth, pth, b]) => mth === 'POST' && pth === `/api/tasks/${made.key}/delegate` && b.agentId === 'a1'), 'it is delegated to the agent, through the same call the workspace makes');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} catch (e) { failed++; console.log('FAIL', e.message); }
await br.close(); await server.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
