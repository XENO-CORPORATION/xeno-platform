// canvas-test — canvases in the workspace (platform-canvas.js) against a stand-in /api/canvases that validates content
// with the SERVER's own cleanContent, so a canvas the page saves is one the server would accept. Headless.
// Proves: Board | List | Canvas switch, the id-based address (refresh, Back, a fresh tab), creating a canvas, putting
// tasks on it, notes, links, groups, connecting two tasks and making the wire a real link, task data read live,
// autosave with the revision, a conflict refused (never overwritten), view-only canvases, undo, and no page errors.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const { cleanContent } = await import(pathToFileURL(path.join(repo, 'src/server/services/canvases.js')).href);
const PORT = Number(process.env.TEST_PORT) || 5199, base = 'http://127.0.0.1:' + PORT;
const USER = { id: 'u1', username: 'me', email: 'me@x.test', display_name: 'Me', avatar_url: null, email_verified: true };
let failed = 0;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const now = () => new Date().toISOString();
const ME = { id: 'u1', kind: 'human', name: 'Me' };
const db = { tasks: [], seq: 0, canvases: [], links: [], puts: [] };
const mk = (b) => { const t = { key: 'T-' + ++db.seq, number: db.seq, title: b.title, status: b.status || 'todo', kind: 'task', priority: b.priority || 'none', area: 'studio', project: null, assignee: null, labels: [], events: [], links: [], reporter: ME, createdAt: now(), updatedAt: now(), can: { edit: true, moves: [] } }; db.tasks.push(t); return t; };
mk({ title: 'Design the onboarding', status: 'in_progress', priority: 'high' }); mk({ title: 'Write the copy' }); mk({ title: 'Ship it' });
const recs = (c) => Object.fromEntries(c.content.nodes.filter((n) => n.type === 'xeno-ref').map((n) => { const t = db.tasks.find((x) => x.key === n.ref.id); return [n.ref.id, t ? { key: t.key, title: t.title, status: t.status, priority: t.priority, project: null, assignee: null } : { key: n.ref.id, missing: true }]; }));
const out = (c) => ({ id: c.id, name: c.name, area: 'studio', project: c.project || null, revision: String(c.revision), items: c.content.nodes.length, updatedAt: now(), can: { edit: !c.readonly, delete: !c.readonly }, content: c.content, records: { tasks: recs(c), files: { 'f0000000-0000-4000-8000-000000000001': { id: 'f0000000-0000-4000-8000-000000000001', name: 'brief.pdf', type: 'application/pdf', bytes: 2400000, url: '/workspace/library?sel=f0000000-0000-4000-8000-000000000001' }, 'f0000000-0000-4000-8000-000000000002': { id: 'f0000000-0000-4000-8000-000000000002', missing: true } }, chats: { 'c0000000-0000-4000-8000-000000000001': { id: 'c0000000-0000-4000-8000-000000000001', title: 'Kickoff notes', url: '/workspace/apps/chat/c0000000-0000-4000-8000-000000000001' } } } });

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
const handler = (q) => {
  const u = new URL(q.url());
  if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const method = q.method(); let b = {}; try { b = q.postData() ? JSON.parse(q.postData()) : {}; } catch { b = {}; }
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER });
  if (u.pathname === '/api/canvases' && method === 'GET') return json(200, { success: true, canvases: db.canvases.map(out) });
  if (u.pathname === '/api/canvases' && method === 'POST') { const c = { id: '00000000-0000-4000-8000-' + String(db.canvases.length + 1).padStart(12, '0'), name: b.name, revision: 1, content: { nodes: [], edges: [] } }; db.canvases.push(c); return json(201, { success: true, canvas: out(c) }); }
  const cm = u.pathname.match(/^\/api\/canvases\/([\w-]+)$/);
  if (cm) {
    const c = db.canvases.find((x) => x.id === cm[1]); if (!c) return json(404, { success: false, error: 'Canvas not found', code: 'canvas_not_found' });
    if (method === 'GET') return json(200, { success: true, canvas: out(c) });
    if (method === 'DELETE') { db.canvases.splice(db.canvases.indexOf(c), 1); return json(200, { success: true, deleted: c.id }); }
    if (method === 'PUT') {
      db.puts.push(b);
      if (String(b.revision) !== String(c.revision)) return json(409, { success: false, error: 'Someone changed this canvas since you opened it', code: 'canvas_changed' });
      let content; try { content = cleanContent(b.content); } catch (e) { return json(e.status || 400, { success: false, error: e.message, code: e.code }); }
      for (const e of content.edges) if (e.xeno?.link) { const a = content.nodes.find((n) => n.id === e.fromNode), z = content.nodes.find((n) => n.id === e.toNode); db.links.push([a.ref.id, e.xeno.link, z.ref.id]); }
      Object.assign(c, { content, name: b.name || c.name, revision: c.revision + 1 }); return json(200, { success: true, canvas: out(c) });
    }
  }
  if (u.pathname === '/api/tasks' && method === 'GET') return json(200, { success: true, tasks: db.tasks });
  if (u.pathname === '/api/tasks' && method === 'POST') return json(201, { success: true, task: mk(b) });
  // the Orchestrator's graph of the canvas's project: T-1 blocks T-2, T-3 waits on T-2 (the server computes ready)
  if (u.pathname === '/api/orchestrator/graph') { db.graphCalls = (db.graphCalls || 0) + 1; const n = (key, ready, blockedBy) => ({ kind: 'task', id: key, key, ref: 'task:' + key, title: db.tasks.find((t) => t.key === key).title, status: 'todo', done: false, ready, blockedBy });
    return json(200, { success: true, graph: { projectId: u.searchParams.get('project'), nodes: [n('T-1', true, []), n('T-2', false, ['task:T-1']), n('T-3', false, ['task:T-2'])],
      edges: [{ id: 'e1', store: 'task_links', from: 'task:T-1', to: 'task:T-2' }, { id: 'e2', store: 'task_links', from: 'task:T-2', to: 'task:T-3' }], ready: ['task:T-1'] } }); }
  if (u.pathname === '/api/tasks/projects') return json(200, { success: true, projects: [] });
  if (u.pathname === '/api/tasks/views') return json(200, { success: true, views: [] });
  const tm = u.pathname.match(/^\/api\/tasks\/(T-\d+)$/); if (tm) { const t = db.tasks.find((x) => x.key === tm[1]); return t ? json(200, { success: true, task: { ...t, events: [], attachments: [], children: [], watchers: [] } }) : json(404, { success: false }); }
  const EMPTY = { '/api/notifications': { success: true, unread: 0, items: [] }, '/api/workspace/needs': { success: true, items: [] }, '/api/workspace/search': { success: true, results: [], counts: {} }, '/api/forum/threads': { success: true, threads: [], total: 0 }, '/api/forum/me': { success: true, actor: {}, capabilities: {} }, '/api/workspace/summary': { success: true, days: 7, areas: {} }, '/api/workspace/pins': { success: true, items: [] }, '/api/v2/ledger/usage': { rows: [] }, '/api/account/overview': { success: true, overview: { user: USER, credits: { balance: 0 }, workspace_count: 1 } }, '/api/user-data/settings': { success: true, settings: {} }, '/api/workspaces': { success: true, workspaces: [] }, '/api/chat/projects': { success: true, projects: [] }, '/api/chat/conversations': { success: true, conversations: [] }, '/api/library/assets': { success: true, items: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } } }[u.pathname];
  if (EMPTY) return json(200, EMPTY);
  return json(404, { success: false, error: 'not found' });
};
p.on('request', handler);
const main = () => p.$eval('#main', (e) => e.innerText).catch(() => '');
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));
const nav = async (h) => { await p.evaluate((x) => (location.hash = x), h); await settle(); };
const cv = () => p.evaluate(() => window.XENO_CANVAS.state());
const box = (sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, r: r.right, b: r.bottom }; });
const waitSaved = async () => { for (let i = 0; i < 30; i++) { const s = await cv(); if (!s.dirty) { await settle(250); return s; } await settle(150); } return cv(); };
try {
  await p.goto(base + '/workspace/studio/tasks', { waitUntil: 'domcontentloaded' }); await settle(1500);
  ok(!!(await p.$('[data-tk="layout"][data-arg="canvas"]')), 'Tasks offers Board | List | Canvas');
  await p.click('[data-tk="layout"][data-arg="canvas"]'); await settle();
  ok(p.url().endsWith('/workspace/studio/tasks/canvas') && /No canvases in/.test(await main()), 'Canvas opens its own address, with a first-use explanation');

  // create
  await p.click('[data-cv-act="new"]'); await p.waitForSelector('.xd input', { timeout: 3000 }); await p.type('.xd input', 'Launch plan'); await p.click('.xd [data-xd-submit]'); await settle(1200);
  const id = db.canvases[0]?.id;
  ok(id && p.url().endsWith(`/workspace/studio/tasks/canvas/${id}`) && !!(await p.$('[data-cv-stage]')), 'a new canvas opens at an id-based address (parent in the path)');

  // put tasks on it
  await p.click('[data-cv-act="add-task"]'); await p.waitForSelector('.xd .xd-checks', { timeout: 3000 });
  await p.click('.xd [data-v="T-1"]'); await p.click('.xd [data-v="T-2"]'); await p.click('.xd [data-xd-submit]'); await settle();
  ok((await p.$$('[data-cv-task]')).length === 2 && /Design the onboarding/.test(await main()), 'tasks go on the canvas as cards');
  let s = await waitSaved();
  ok(s.rev === '2' && db.puts.at(-1).revision === '1' && db.canvases[0].content.nodes.every((n) => n.type !== 'xeno-ref' || !n.title), 'the change autosaves with the revision it was loaded at, storing references only');

  // a note, by double-clicking the board
  const st = await box('[data-cv-stage]');
  await p.mouse.click(st.l + 120, st.b - 120); await p.mouse.click(st.l + 120, st.b - 120); await settle(300);
    ok(!!(await p.$('[data-cv-text]')), 'double-clicking the board makes a note and opens it for writing');
  await p.keyboard.type('Ship by **Friday**'); await p.mouse.click(st.r - 40, st.t + 40); await settle(300);
  await waitSaved();
  ok(db.canvases[0].content.nodes.some((n) => n.type === 'text' && n.text === 'Ship by **Friday**') && /Ship by Friday/.test(await main()), 'the note is saved and rendered');

  // move a card by dragging it
  const before = db.canvases[0].content.nodes.find((n) => n.ref?.id === 'T-1');
  const c1 = await box('[data-cv-task="T-1"] .cv-task-t');
  await p.mouse.move(c1.x, c1.y); await p.mouse.down(); await p.mouse.move(c1.x + 60, c1.y + 90, { steps: 6 }); await p.mouse.up(); await waitSaved();
  const after = db.canvases[0].content.nodes.find((n) => n.ref?.id === 'T-1');
  ok(after.x !== before.x && after.y !== before.y, 'dragging a card moves it, and the position is saved');

  // connect T-1 → T-2 and make it a real task link
  await p.hover('[data-cv-task="T-1"]'); const w = await box('[data-cv-task="T-1"] [data-cv-wire]'); const t2 = await box('[data-cv-task="T-2"] .cv-task-t');
  await p.mouse.move(w.x, w.y); await p.mouse.down(); await p.mouse.move(t2.x, t2.y, { steps: 8 }); await p.mouse.up(); await settle(300);
  ok((await p.$$('[data-cv-edge]')).length === 1, 'dragging the ＋ handle onto another task connects them');
  ok(/Just a line/.test(await p.$eval('[data-cv-insp]', (e) => e.textContent)), 'the connection offers to become a real task link');
  await p.click('[data-cv-act="edge-kind"][data-arg="blocks"]'); await waitSaved();
  ok(db.links.some(([a, k, z]) => a === 'T-1' && k === 'blocks' && z === 'T-2') && /blocks/.test(await main()), 'choosing "Blocks" makes it a real task link, saved through the server');

  // live task data
  db.tasks[0].title = 'Design the onboarding v2'; db.tasks[0].status = 'in_review';
  await p.evaluate(() => { const id = window.XENO_CANVAS.state().id; window.XENO_CANVAS.open(null); return window.XENO_CANVAS.open(id); }); await settle(); await p.evaluate(() => window.XENO_CANVAS.state());
  await p.reload({ waitUntil: 'domcontentloaded' }); await settle(1800);
  ok(p.url().endsWith(`/canvas/${id}`) && /Design the onboarding v2/.test(await main()) && /In review/.test(await main()), 'refresh lands on the same canvas, and a task renamed elsewhere shows its new title and status');

  if (process.env.CANVAS_SHOT) await p.screenshot({ path: process.env.CANVAS_SHOT });
  ok(/Tasks\s*\/\s*Canvases\s*\/\s*Launch plan/.test(await p.$eval('#main .crumbs', (e) => e.innerText)), 'the breadcrumb reads Tasks / Canvases / Launch plan — names, never the id');
  // undo, delete
  await p.click('[data-cv-task="T-2"] .cv-task-t'); await p.keyboard.press('Delete'); await settle(200);
  ok(!(await p.$('[data-cv-task="T-2"]')) && (await p.$$('[data-cv-edge]')).length === 0, 'Delete removes the card (and its wires) from the canvas');
  await p.keyboard.down('Control'); await p.keyboard.press('z'); await p.keyboard.up('Control'); await settle(200);
  ok(!!(await p.$('[data-cv-task="T-2"]')), 'Ctrl+Z brings it back'); await waitSaved();
  ok(db.tasks.some((t) => t.key === 'T-2'), 'removing a card never deletes the task');

  // zoom
  const z0 = (await cv()).view.z; await p.mouse.move(st.x, st.y); await p.keyboard.down('Control'); await p.mouse.wheel({ deltaY: -300 }); await p.keyboard.up('Control'); await settle(200);
  ok((await cv()).view.z > z0, 'Ctrl+scroll zooms');

  // conflict: someone else saves meanwhile
  db.canvases[0].revision += 5;
  await p.click('[data-cv-act="add-note"]'); await settle(1500);
  ok((await cv()).conflict && /Someone else saved this canvas/.test(await main()), 'a save over someone else’s newer version is refused and the page says so — nothing is overwritten');
  await p.click('[data-cv-act="reload"]'); await settle(800);
  ok(!(await cv()).conflict, '"Load their version" recovers');

  // Back / forward, and a fresh tab
  await p.goBack(); await settle(800);
  ok(p.url().endsWith('/workspace/studio/tasks/canvas'), 'Back returns to the list of canvases');
  await p.goForward(); await settle(1200);
  ok(!!(await p.$('[data-cv-stage]')), 'Forward reopens the canvas');
  const p2 = await br.newPage(); await p2.setRequestInterception(true); p2.on('request', handler);
  await p2.goto(base + `/workspace/studio/tasks/canvas/${id}`, { waitUntil: 'domcontentloaded' }); await new Promise((r) => setTimeout(r, 1800));
  ok(!!(await p2.$('[data-cv-stage]')) && /Launch plan/.test(await p2.$eval('#main', (e) => e.innerText)), 'the address opens the canvas in a fresh tab');
  await p2.close();

  // library files and chats as live cards
  db.canvases[0].content.nodes.push({ id: 'rf1', type: 'xeno-ref', ref: { kind: 'file', id: 'f0000000-0000-4000-8000-000000000001' }, x: 0, y: 900, width: 260, height: 100 }, { id: 'rf2', type: 'xeno-ref', ref: { kind: 'file', id: 'f0000000-0000-4000-8000-000000000002' }, x: 300, y: 900, width: 260, height: 100 }, { id: 'rc1', type: 'xeno-ref', ref: { kind: 'chat', id: 'c0000000-0000-4000-8000-000000000001' }, x: 600, y: 900, width: 260, height: 100 });
  db.canvases[0].revision++; await p.reload({ waitUntil: 'domcontentloaded' }); await settle(1800);
  const cardTxt = async (id) => p.$eval(`[data-cv-node="${id}"]`, (e) => e.innerText).catch(() => '');
  ok(/brief\.pdf/.test(await cardTxt('rf1')) && /2\.4 MB/.test(await cardTxt('rf1')), 'a library file shows as a card with its live name and size');
  ok(/Kickoff notes/.test(await cardTxt('rc1')) && !!(await p.$('[data-cv-node="rc1"] a[href="/workspace/apps/chat/c0000000-0000-4000-8000-000000000001"]')), 'a chat shows as a card that opens the chat');
  ok(/Not available/.test(await cardTxt('rf2')), 'a file the reader cannot open says Not available, never its name');
  ok(!!(await p.$('[data-cv-act="add-file"]')) && !!(await p.$('[data-cv-act="add-chat"]')), 'the toolbar can put files and chats on the canvas');

  // dependency graph (xeno-orchestrator on the platform): lay out the project's graph, readiness on each card
  db.canvases[0].project = { id: 'a0000000-0000-4000-8000-000000000001', name: 'Launch' }; db.canvases[0].revision++;
  await p.reload({ waitUntil: 'domcontentloaded' }); await settle(1800);
  ok(!!(await p.$('[data-cv-act="deps"]')), 'a project canvas offers Dependencies');
  await p.click('[data-cv-act="deps"]'); await settle(1200);
  const sd = await waitSaved();
  const doc = db.canvases[0].content;
  const nodeOf = (k) => doc.nodes.find((x) => x.type === 'xeno-ref' && x.ref.id === k);
  ok(['T-1', 'T-2', 'T-3'].every((k) => nodeOf(k)), 'every task in the graph is on the canvas');
  ok(doc.edges.filter((e) => e.xeno && e.xeno.link === 'blocks').length >= 2, 'its dependencies are real “blocks” links');
  ok(nodeOf('T-1').x < nodeOf('T-2').x && nodeOf('T-2').x < nodeOf('T-3').x, 'laid out left → right in the order the work can happen');
  ok(!!(await p.$('[data-cv-task="T-1"] [data-cv-ready="yes"]')) && !!(await p.$('[data-cv-task="T-3"] [data-cv-ready="no"]')), 'cards say Ready / Waiting, from the server’s ready set');
  ok(!sd.conflict, 'and the layout saved');

  // view-only
  db.canvases[0].readonly = true; await p.reload({ waitUntil: 'domcontentloaded' }); await settle(1800);
  ok(/View only/.test(await main()) && !(await p.$('[data-cv-act="add-note"]')), 'a canvas you may only view shows no editing tools');
  ok((await p.$$('[data-cv-wire]')).length === 0, 'and no connect handles');

  // missing
  await nav('#/studio/g/tasks/canvas/00000000-0000-4000-8000-0000000000ff'); await settle(800);
  ok(/doesn’t exist, or it hasn’t been shared with you/.test(await main()), 'an unknown canvas says so');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);
