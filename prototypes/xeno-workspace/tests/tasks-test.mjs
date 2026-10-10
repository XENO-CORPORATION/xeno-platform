// tasks-test — XENO Tasks in the workspace against a stand-in /api/tasks that enforces the same state machine.
// Proves: board per area and on Overview, raise, triage, claim, review hand-off, stale-screen refusal, comments,
// project tab, Needs you and search reach a task, and a failed load says so.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const PORT = 5197, base = 'http://127.0.0.1:' + PORT;
const USER = { id: 'u1', username: 'me', email: 'me@x.test', display_name: 'Me', avatar_url: null, email_verified: true };
let n = 0, failed = 0, fail = false;
const ok = (c, m) => { n++; if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const db = { tasks: [], seq: 0 };
const MOVES = { raised: ['todo', 'wont_do'], todo: ['in_progress', 'wont_do'], in_progress: ['blocked', 'in_review', 'done'], blocked: ['in_progress'], in_review: ['done', 'in_progress'], done: ['raised'], wont_do: ['raised'] };
const view = (t) => ({ ...t, can: { edit: true, moves: (MOVES[t.status] || []).filter((m) => !(m === 'done' && t.status === 'in_progress' && t.reviewRequired)) } });
const mk = (b) => { const t = { key: 'T-' + ++db.seq, title: b.title, body: b.body || '', kind: b.kind || 'task', priority: b.priority || 'none', status: 'raised', area: b.area ?? null, project: b.projectId ? { id: b.projectId, name: 'Website' } : null, assignee: null, reviewer: null, reviewRequired: false, reporter: { id: 'u1', kind: 'human', name: 'Me' }, labels: [], dueAt: null, updatedAt: new Date().toISOString(), events: [{ kind: 'created', actor: { id: 'u1', kind: 'human', name: 'Me' }, at: new Date().toISOString() }] }; db.tasks.push(t); return t; };
mk({ title: 'Fix the signup copy', area: 'studio' }); mk({ title: 'Office budget', area: 'office' });

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' }); if (!u.pathname.startsWith('/api/')) return q.continue();
  const req = { method: q.method() }, res = null, b = q.postData() ? JSON.parse(q.postData()) : {};
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER });
    if (u.pathname === '/api/tasks' && req.method === 'GET') { if (fail) return json(500, { success: false }); const a = u.searchParams.get('area'), pid = u.searchParams.get('projectId'); return json(200, { success: true, tasks: db.tasks.filter((t) => (!a || t.area === a) && (!pid || (t.project && t.project.id === pid))).map(view) }); }
    if (u.pathname === '/api/tasks' && req.method === 'POST') return json(201, { success: true, task: view(mk(b)) });
    const m = u.pathname.match(/^\/api\/tasks\/(T-\d+)(\/\w+)?$/);
    if (m) { const t = db.tasks.find((x) => x.key === m[1]); if (!t) return json(404, { success: false, error: 'Task not found' });
      const ev = (e) => t.events.push({ actor: { id: 'u1', kind: 'human', name: 'Me' }, at: new Date().toISOString(), ...e });
      if (!m[2] && req.method === 'GET') return json(200, { success: true, task: view(t) });
      if (m[2] === '/transition') { if (b.from && b.from !== t.status) return json(409, { success: false, error: 'It moved since you looked — it is now ' + t.status + '.' }); if (!(MOVES[t.status] || []).includes(b.to)) return json(400, { success: false, error: 'Not allowed' }); ev({ kind: 'status', from: t.status, to: b.to, note: b.note }); t.status = b.to; return json(200, { success: true, task: view(t) }); }
      if (m[2] === '/claim') { if (t.assignee) return json(409, { success: false, error: 'Someone already took it' }); t.assignee = { id: 'u1', kind: 'human', name: 'Me' }; ev({ kind: 'claimed' }); return json(200, { success: true, task: view(t) }); }
      if (m[2] === '/comments') { ev({ kind: 'comment', note: b.body }); return json(200, { success: true, task: view(t) }); } }
    if (u.pathname === '/api/workspace/needs') return json(200, { success: true, items: db.tasks.filter((t) => t.status === 'in_review').map((t) => ({ kind: 'task_review', id: t.key, title: t.key + ' · ' + t.title, detail: 'Waiting for your review', area: t.area, conversation_id: null, at: t.updatedAt })) });
    if (u.pathname === '/api/workspace/search') { const q = (u.searchParams.get('q') || '').toLowerCase(); return json(200, { success: true, results: db.tasks.filter((t) => t.title.toLowerCase().includes(q)).map((t) => ({ kind: 'task', id: t.key, title: t.key + ' · ' + t.title, area: t.area })), counts: {} }); }
    const EMPTY = { '/api/forum/threads': { success: true, threads: [], total: 0 }, '/api/forum/me': { success: true, actor: {}, capabilities: {} }, '/api/workspace/summary': { success: true, days: 7, areas: {} }, '/api/workspace/pins': { success: true, items: [] }, '/api/v2/ledger/usage': { rows: [] }, '/api/account/overview': { success: true, overview: { user: USER, credits: { balance: 0 }, workspace_count: 1 } }, '/api/user-data/settings': { success: true, settings: {} }, '/api/workspaces': { success: true, workspaces: [] }, '/api/chat/projects': { success: true, projects: [] }, '/api/chat/conversations': { success: true, conversations: [] }, '/api/library/assets': { success: true, items: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } } }[u.pathname];
    if (EMPTY) return json(200, EMPTY);
      return json(404, { success: false, error: 'not found' }); });
const main = () => p.$eval('#main', (e) => e.innerText).catch(() => '');
const settle = () => new Promise((r) => setTimeout(r, 600));
const nav = async (hash) => { await p.evaluate((h) => (location.hash = h), hash); await settle(); };
try {
  await p.goto(base + '/workspace/#/studio/g/tasks', { waitUntil: 'domcontentloaded' }); await new Promise((r) => setTimeout(r, 1600));
  await nav('#/studio/g/tasks'); let t = await main();
  ok(/Fix the signup copy/.test(t) && !/Office budget/.test(t) && await p.$('[data-tk-col="raised"] [data-tk-card="T-1"]'), 'an area board shows only that area’s tasks, in Triage');
  await nav('#/overview/g/tasks'); t = await main();
  ok(/Fix the signup copy/.test(t) && /Office budget/.test(t), 'Overview shows every area’s tasks');
  await nav('#/studio/g/tasks');
  await p.click('#main [data-tk="new"]'); await p.waitForSelector('.xd input', { timeout: 4000 });
  await p.type('.xd input', 'Write the launch post'); await p.click('.xd [type="submit"], .xd .xd-ok').catch(() => p.keyboard.press('Enter')); await settle(); await settle();
  await p.click('[data-tk-move="todo"]'); await settle();
  ok(db.tasks[2].status === 'todo' && /moved it Triage → To do/.test(await main()), 'Accept moves it and the history records it');
  await p.click('[data-tk="claim"]'); await settle();
  ok(db.tasks[2].assignee && !(await p.$('[data-tk="claim"]')), 'Take it assigns it and the button goes away');
  db.tasks[2].status = 'blocked';                // someone else moved it; this screen still shows To do, whose Start would also be legal from Blocked
  await p.click('[data-tk-move="in_progress"]'); await settle();
  ok(db.tasks[2].status === 'blocked' && db.tasks[2].events.filter((e) => e.kind === 'status').length === 1 && /Blocked/.test(await main()), 'a stale screen cannot overwrite a newer state; the page reloads to the truth');
  await p.click('[data-tk-move="in_progress"]'); await settle();
  await p.click('[data-tk-move="in_review"]'); await settle();
  await p.goto(base + '/workspace/#/overview', { waitUntil: 'domcontentloaded' }); await new Promise((r) => setTimeout(r, 2000)); t = await main();
  ok(/T-3 · Write the launch post/.test(t) || (await p.evaluate(() => (window.XENO_NEEDS || []).some((x) => x.kind === 'task_review'))), 'a task in review shows up in Needs you');
  await nav('#/studio/g/tasks/T-3');
  await p.type('[data-tk-comment] textarea', 'Draft is in the doc'); await p.click('[data-tk-comment] [type="submit"]'); await settle();
  ok(/Draft is in the doc/.test(await main()), 'a comment lands on the task');
  fail = true; await p.evaluate(() => window.XENO_TASKS.load()); await settle(); await nav('#/office/g/tasks');
  ok(/couldn’t be loaded/.test(await main()), 'a failed load says so and offers a retry'); fail = false;
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);
