// tasks-test — XENO Tasks in the workspace against a stand-in /api/tasks that enforces the same state machine.
// Proves: board per area and on Overview, create, triage, claim, review hand-off, stale-screen refusal, comments,
// property rows that edit in place, agent assignees, image drop, right-click menu, drag between columns, delete,
// that every one of those redraws only the tasks region (never the workspace), that another person's changes appear
// without a reload, Needs you, and that a failed load says so.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const PORT = 5197, base = 'http://127.0.0.1:' + PORT;
const USER = { id: 'u1', username: 'me', email: 'me@x.test', display_name: 'Me', avatar_url: null, email_verified: true };
let failed = 0, fail = false;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const db = { tasks: [], seq: 0, uploads: 0 };
const now = () => new Date().toISOString();
const MOVES = { raised: ['todo', 'wont_do'], todo: ['in_progress', 'wont_do'], in_progress: ['blocked', 'in_review', 'done'], blocked: ['in_progress'], in_review: ['done', 'in_progress'], done: ['raised'], wont_do: ['raised'] };
const view = (t) => ({ attachments: [], ...t, can: { edit: true, attach: true, delete: true, moves: (MOVES[t.status] || []).filter((m) => !(m === 'done' && t.status === 'in_progress' && t.reviewRequired)) } });
const ME = { id: 'u1', kind: 'human', name: 'Me' };
const mk = (b) => { const t = { key: 'T-' + ++db.seq, title: b.title, body: b.body || '', kind: b.kind || 'task', priority: b.priority || 'none', status: 'raised', area: b.area ?? null, project: b.projectId ? { id: b.projectId, name: 'Website' } : null, assignee: null, reviewer: null, reviewRequired: false, reporter: ME, labels: [], dueAt: null, createdAt: now(), updatedAt: now(), events: [{ kind: 'created', actor: ME, at: now() }] }; db.tasks.push(t); return t; };
mk({ title: 'Fix the signup copy', area: 'studio' }); mk({ title: 'Office budget', area: 'office' });
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a00000000049454e44ae426082', 'hex');

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => {
  const u = new URL(q.url());
  if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const method = q.method(); let b = {}; try { b = q.postData() ? JSON.parse(q.postData()) : {}; } catch { b = {}; }
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER });
  if (u.pathname === '/api/tasks' && method === 'GET') { if (fail) return json(500, { success: false }); const a = u.searchParams.get('area'), pid = u.searchParams.get('projectId'); return json(200, { success: true, tasks: db.tasks.filter((t) => (!a || t.area === a) && (!pid || (t.project && t.project.id === pid))).map(view) }); }
  if (u.pathname === '/api/tasks' && method === 'POST') return json(201, { success: true, task: view(mk(b)) });
  if (u.pathname === '/api/tasks/assignees') return json(200, { success: true, assignees: [{ id: 'u1', name: 'Me', kind: 'human', me: true }, { id: 'u2', name: 'Codrin', kind: 'human' }, { id: 'a1', name: 'Builder', kind: 'agent' }] });
  const am = u.pathname.match(/^\/api\/tasks\/(T-\d+)\/attachments(?:\/([\w-]+))?$/);
  if (am) {
    const t = db.tasks.find((x) => x.key === am[1]); t.attachments = t.attachments || [];
    if (method === 'POST') { const id = 'img' + (t.attachments.length + 1); t.attachments.push({ id, filename: u.searchParams.get('name'), mime: 'image/png', size: 10, at: now(), uploader: ME }); db.uploads++; t.updatedAt = now(); return json(201, { success: true, task: view(t) }); }
    return q.respond({ status: 200, contentType: 'image/png', body: PNG });
  }
  const m = u.pathname.match(/^\/api\/tasks\/(T-\d+)(\/\w+)?$/);
  if (m) {
    const t = db.tasks.find((x) => x.key === m[1]); if (!t) return json(404, { success: false, error: 'Task not found' });
    const ev = (e) => { t.events.push({ actor: ME, at: now(), ...e }); t.updatedAt = now(); };
    if (!m[2] && method === 'GET') return json(200, { success: true, task: view(t) });
    if (!m[2] && method === 'PATCH') {
      for (const k of ['title', 'body', 'priority', 'kind', 'dueAt']) if (b[k] !== undefined) t[k] = b[k];
      if (b.assigneeId !== undefined) t.assignee = b.assigneeId ? { id: b.assigneeId, name: b.assigneeId === 'a1' ? 'Builder' : 'Codrin', kind: b.assigneeId === 'a1' ? 'agent' : 'human' } : null;
      ev({ kind: 'edited', from: Object.keys(b)[0] }); return json(200, { success: true, task: view(t) });
    }
    if (!m[2] && method === 'DELETE') { db.tasks.splice(db.tasks.indexOf(t), 1); return json(200, { success: true, key: t.key, deleted: true }); }
    if (m[2] === '/transition') { if (b.from && b.from !== t.status) return json(409, { success: false, error: 'Someone moved this task first.' }); if (!(MOVES[t.status] || []).includes(b.to)) return json(400, { success: false, error: 'Not allowed' }); ev({ kind: 'status', from: t.status, to: b.to, note: b.note }); t.status = b.to; return json(200, { success: true, task: view(t) }); }
    if (m[2] === '/claim') { if (t.assignee) return json(409, { success: false, error: 'Someone already took it' }); t.assignee = ME; ev({ kind: 'claimed' }); return json(200, { success: true, task: view(t) }); }
    if (m[2] === '/comments') { ev({ kind: 'comment', note: b.body }); return json(200, { success: true, task: view(t) }); }
  }
  if (u.pathname === '/api/workspace/needs') return json(200, { success: true, items: db.tasks.filter((t) => t.status === 'in_review').map((t) => ({ kind: 'task_review', id: t.key, title: t.key + ' · ' + t.title, detail: 'Waiting for your review', area: t.area, conversation_id: null, at: t.updatedAt })) });
  if (u.pathname === '/api/workspace/search') { const s = (u.searchParams.get('q') || '').toLowerCase(); return json(200, { success: true, results: db.tasks.filter((t) => t.title.toLowerCase().includes(s)).map((t) => ({ kind: 'task', id: t.key, title: t.key + ' · ' + t.title, area: t.area })), counts: {} }); }
  const EMPTY = { '/api/forum/threads': { success: true, threads: [], total: 0 }, '/api/forum/me': { success: true, actor: {}, capabilities: {} }, '/api/workspace/summary': { success: true, days: 7, areas: {} }, '/api/workspace/pins': { success: true, items: [] }, '/api/v2/ledger/usage': { rows: [] }, '/api/account/overview': { success: true, overview: { user: USER, credits: { balance: 0 }, workspace_count: 1 } }, '/api/user-data/settings': { success: true, settings: {} }, '/api/workspaces': { success: true, workspaces: [] }, '/api/chat/projects': { success: true, projects: [] }, '/api/chat/conversations': { success: true, conversations: [] }, '/api/library/assets': { success: true, items: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } } }[u.pathname];
  if (EMPTY) return json(200, EMPTY);
  return json(404, { success: false, error: 'not found' });
});
const main = () => p.$eval('#main', (e) => e.innerText).catch(() => '');
const settle = () => new Promise((r) => setTimeout(r, 600));
const nav = async (hash) => { await p.evaluate((h) => (location.hash = h), hash); await settle(); };
const countRenders = () => p.evaluate(() => { window.__renders = 0; if (!window.__wrapped) { window.__wrapped = 1; const o = window.XW.render; window.XW.render = function (...a) { window.__renders++; return o.apply(this, a); }; } });
const renders = () => p.evaluate(() => window.__renders);
const menuClick = (re) => p.evaluate((src) => { const rx = new RegExp(src); const b = [...document.querySelectorAll('.xcm .xcm-i')].find((x) => rx.test(x.textContent.trim())); if (b) b.click(); return !!b; }, re.source);
try {
  await p.goto(base + '/workspace/#/studio/g/tasks', { waitUntil: 'domcontentloaded' }); await new Promise((r) => setTimeout(r, 1600));
  await nav('#/studio/g/tasks'); let t = await main();
  ok(/Fix the signup copy/.test(t) && !/Office budget/.test(t) && await p.$('[data-tk-col="raised"] [data-tk-card="T-1"]'), 'an area board shows only that area’s tasks, in Triage');
  await nav('#/overview/g/tasks'); t = await main();
  ok(/Fix the signup copy/.test(t) && /Office budget/.test(t), 'Overview shows every area’s tasks');
  await nav('#/studio/g/tasks');
  await p.click('#main [data-tk="new"]'); await p.waitForSelector('.xd input', { timeout: 4000 });
  await p.type('.xd input', 'Write the launch post'); await p.click('.xd [type="submit"], .xd .xd-ok').catch(() => p.keyboard.press('Enter')); await settle(); await settle();
  t = await main();
  ok(/Write the launch post/.test(t) && !!(await p.$('[data-tk-move="todo"]')) && db.tasks.find((x) => x.key === 'T-3')?.area === 'studio', 'creating a task in an area stores it there and opens it');
  ok(!!(await p.$('.tk-props [data-tk-prop="assignee"]')) && await p.$$eval('.tk-prop', (els) => els.length > 8 && els.every((e) => e.getBoundingClientRect().height < 44)), 'each property is one row, label and value side by side, not stacked');

  await countRenders();
  await p.click('[data-tk-move="todo"]'); await settle();
  ok(db.tasks[2].status === 'todo' && /moved it\s*Triage\s*→\s*To do/.test(await main()), 'Accept moves it and the activity records it');
  await p.click('[data-tk="claim"]'); await settle();
  ok(db.tasks[2].assignee && !(await p.$('[data-tk="claim"]')), 'Take it assigns it and the button goes away');
  ok(await renders() === 0, 'moving and taking a task redraw only the task, never the workspace around it');
  db.tasks[2].status = 'blocked';    // someone else moved it; this screen still shows To do, whose Start would also be legal from Blocked
  await p.click('[data-tk-move="in_progress"]'); await settle();
  ok(db.tasks[2].status === 'blocked' && db.tasks[2].events.filter((e) => e.kind === 'status').length === 1 && /Blocked/.test(await main()), 'a stale screen cannot overwrite a newer state; the task redraws to the truth');

  await p.click('[data-tk-prop="priority"]'); await p.waitForSelector('.xcm', { timeout: 3000 });
  await menuClick(/^High/); await settle();
  ok(db.tasks[2].priority === 'high' && /High/.test(await p.$eval('[data-tk-prop="priority"]', (e) => e.textContent)), 'a property row opens its choices in place and saves the change');
  await p.click('[data-tk-prop="assignee"]'); await p.waitForSelector('.xcm', { timeout: 3000 }); await settle();
  const who = await p.$$eval('.xcm .xcm-i', (els) => els.map((e) => e.textContent.trim()));
  ok(who.some((x) => /Builder.*agent/.test(x)) && who.some((x) => /Codrin/.test(x)), 'the assignee choices list people and agents (' + who.slice(0, 4).join(', ') + ')');
  await menuClick(/Builder/); await settle();
  ok(db.tasks[2].assignee?.kind === 'agent' && !!(await p.$('.tk-prop .tk-face--agent')), 'a task can be assigned to an agent');
  await p.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])], 'screen.png', { type: 'image/png' })); const pg = document.querySelector('#main .tk-page'); pg.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); pg.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); });
  await settle(); await settle();
  ok(db.uploads === 1 && !!(await p.$('.tk-img img[src*="/attachments/img1"]')) && /screen\.png/.test(await main()), 'an image dropped on the task is uploaded and shown on it');
  db.tasks[2].title = 'Write the launch post v2'; db.tasks[2].updatedAt = new Date(Date.now() + 5000).toISOString();
  await p.evaluate(() => window.XENO_TASKS.poll()); await settle();
  ok(/launch post v2/.test(await main()) && await renders() === 0, 'another person’s change appears on the open task without a reload');
  await p.click('[data-tk-move="in_progress"]'); await settle();
  await p.click('[data-tk-move="in_review"]'); await settle();
  ok(db.tasks[2].status === 'in_review', 'it goes to review');

  await nav('#/studio/g/tasks'); await countRenders();
  db.tasks.push({ ...db.tasks[0], key: 'T-9', title: 'Raised by Codrin', status: 'raised', assignee: null, events: [], updatedAt: now() });
  await p.evaluate(() => window.XENO_TASKS.poll()); await settle();
  ok(!!(await p.$('[data-tk-col="raised"] [data-tk-card="T-9"]')) && await renders() === 0, 'a task someone else adds appears on the board without reloading the page');
  await p.click('[data-tk-card="T-9"]', { button: 'right' }); await p.waitForSelector('.xcm', { timeout: 3000 });
  const items = await p.$$eval('.xcm .xcm-i', (els) => els.map((e) => e.textContent.trim()));
  ok(['Open', 'Take it', 'Move to', 'Assign to', 'Priority', 'Rename', 'Delete task'].every((w) => items.some((x) => x.startsWith(w))), 'right-clicking a card gives its full menu (' + items.length + ' items)');
  await p.keyboard.press('Escape');
  await p.evaluate(() => { const card = document.querySelector('[data-tk-card="T-9"]'), col = document.querySelector('[data-tk-col="todo"] .tk-col-b'); const dt = new DataTransfer(); card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); col.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); });
  await settle();
  ok(db.tasks.find((x) => x.key === 'T-9')?.status === 'todo' && !!(await p.$('[data-tk-col="todo"] [data-tk-card="T-9"]')), 'dragging a card to another column moves the task');
  await p.click('[data-tk-card="T-9"]', { button: 'right' }); await p.waitForSelector('.xcm', { timeout: 3000 });
  await menuClick(/^Delete task/); await p.waitForSelector('.xd [data-xd-ok]', { timeout: 3000 }); await p.click('.xd [data-xd-ok]'); await settle();
  ok(!db.tasks.some((x) => x.key === 'T-9') && !(await p.$('[data-tk-card="T-9"]')) && await renders() === 0, 'Delete removes the task from the board in place, after a confirmation');

  await p.goto(base + '/workspace/#/overview', { waitUntil: 'domcontentloaded' }); await new Promise((r) => setTimeout(r, 2000)); t = await main();
  ok(/T-3 · Write the launch post/.test(t) || (await p.evaluate(() => (window.XENO_NEEDS || []).some((x) => x.kind === 'task_review'))), 'a task in review shows up in Needs you');
  await nav('#/studio/g/tasks/T-3');
  await p.type('[data-tk-comment] textarea', 'Draft is in the doc'); await p.click('[data-tk-comment] [type="submit"]'); await settle();
  ok(/Draft is in the doc/.test(await main()), 'a comment lands on the task');
  await p.type('[data-tk-comment] textarea', 'half written');
  db.tasks[2].title = 'Write the launch post v3'; db.tasks[2].updatedAt = new Date(Date.now() + 9000).toISOString(); await p.evaluate(() => window.XENO_TASKS.poll()); await settle();
  ok(/launch post v3/.test(await main()) && await p.$eval('[data-tk-comment] textarea', (e) => e.value) === 'half written', 'a comment being written survives the task redrawing under it');
  fail = true; await nav('#/office/g/tasks');
  ok(/couldn’t be loaded/.test(await main()), 'a failed load says so and offers a retry'); fail = false;
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);
