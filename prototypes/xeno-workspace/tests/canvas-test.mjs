const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// canvas-test — canvases in the workspace (platform-canvas.js) against a stand-in /api/canvases that validates content
// with the SERVER's own cleanContent, so a canvas the page saves is one the server would accept. Headless.
// Proves: Board | List | Canvas switch, the id-based address (refresh, Back, a fresh tab), creating a canvas, putting
// tasks on it, notes, links, groups, connecting two tasks and making the wire a real link, task data read live,
// autosave with the revision, a conflict refused (never overwritten), view-only canvases, undo, and no page errors.
import fs from 'node:fs'; import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
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
const LIVE_CLIENT = fs.readFileSync(path.join(repo, 'prototypes/xeno-workspace/live-client.js'), 'utf8');
const FAKE_HUB = `;XenoLive = { ...XenoLive, joinLive: ({ id, ticket, Y, doc }) => {
  const ch = new BroadcastChannel('live' + id), conn = Math.random().toString(36).slice(2), peers = new Map(), L = new Map();
  const emit = (e, v) => (L.get(e) || []).forEach((f) => f(v));
  const me = { conn, sub: conn, name: 'P' + conn.slice(0, 3), kind: 'human', role: 'editor', act: null, state: null };
  const api = { doc, status: 'connecting', self: null, ended: null, participants: () => [...peers.values()], leases: () => ({}), setPresence(s) { me.state = s; ch.postMessage({ k: 'hello', p: me }); }, signal() {}, on(e, f) { L.set(e, [...(L.get(e) || []), f]); return () => {}; }, close() { ch.postMessage({ k: 'bye', conn }); ch.close(); } };
  doc.on('update', (u, o) => { if (o !== 'remote') ch.postMessage({ k: 'u', u }); });
  ch.onmessage = ({ data: m }) => {
    if (m.k === 'u') Y.applyUpdate(doc, m.u, 'remote');
    else if (m.k === 'hello') { peers.set(m.p.conn, m.p); emit('participants', [...peers.values()]); if (m.reply) { ch.postMessage({ k: 'hello', p: me }); ch.postMessage({ k: 'u', u: Y.encodeStateAsUpdate(doc) }); } }
    else if (m.k === 'bye') { peers.delete(m.conn); emit('participants', [...peers.values()]); }
    else if (m.k === 'changed') emit('signal', { data: { changed: 'project' } });
    else if (m.k === 'end' && m.conn === conn) { api.status = 'ended'; api.ended = { code: m.code, reason: 'your access to this has ended' }; emit('status', 'ended'); }
  };
  ticket('workspace.canvas/' + id).then(() => { api.status = 'open'; api.self = me; ch.postMessage({ k: 'hello', p: me, reply: true }); emit('status', 'open'); });
  window.__live = api; window.__hub = ch; return api;
} };`;
const db = { joined: [], tickets: [], liveOn: false, tasks: [], seq: 0, canvases: [], links: [], puts: [], docs: [], moved: [], chats: [], generated: [], done: false };
const GEN = 'e0000000-0000-4000-8000-000000000001', GF = 'd0000000-0000-4000-8000-00000000000a';
const mk = (b) => { const t = { key: 'T-' + ++db.seq, number: db.seq, title: b.title, status: b.status || 'todo', kind: 'task', priority: b.priority || 'none', area: 'studio', project: null, assignee: null, labels: [], events: [], links: [], reporter: ME, createdAt: now(), updatedAt: now(), can: { edit: true, moves: [] } }; db.tasks.push(t); return t; };
mk({ title: 'Design the onboarding', status: 'in_progress', priority: 'high' }); mk({ title: 'Write the copy' }); mk({ title: 'Ship it' });
const recs = (c) => Object.fromEntries(c.content.nodes.filter((n) => n.type === 'xeno-ref').map((n) => { const t = db.tasks.find((x) => x.key === n.ref.id); return [n.ref.id, t ? { key: t.key, title: t.title, status: t.status, priority: t.priority, project: null, assignee: null } : { key: n.ref.id, missing: true }]; }));
const out = (c) => ({ id: c.id, name: c.name, area: 'studio', project: c.project || null, revision: String(c.revision), items: c.content.nodes.length, updatedAt: now(), can: { edit: !c.readonly, delete: !c.readonly }, content: c.content, records: { tasks: recs(c), generations: { [GEN]: { id: GEN, state: db.done ? 'succeeded' : 'running', prompt: 'a bunker at dawn', files: db.done ? [GF] : [] } }, files: { 'c0000000-0000-4000-8000-00000000000d': { id: 'c0000000-0000-4000-8000-00000000000d', doc: true, name: 'Plan', type: 'Document', url: '/workspace/office/spaces/write/c0000000-0000-4000-8000-00000000000d' }, [GF]: { id: GF, version: GF, name: 'dawn.png', type: 'image/png', url: '/workspace/library' }, 'f0000000-0000-4000-8000-000000000001': { id: 'f0000000-0000-4000-8000-000000000001', name: 'brief.pdf', type: 'application/pdf', bytes: 2400000, url: '/workspace/library?sel=f0000000-0000-4000-8000-000000000001' }, 'f0000000-0000-4000-8000-000000000002': { id: 'f0000000-0000-4000-8000-000000000002', missing: true } }, chats: { 'c0000000-0000-4000-8000-000000000001': { id: 'c0000000-0000-4000-8000-000000000001', title: 'Kickoff notes', url: '/workspace/apps/chat/c0000000-0000-4000-8000-000000000001' } }, runs: { 'a1000000-0000-4000-8000-000000000001': { id: 'a1000000-0000-4000-8000-000000000001', agent: 'Scout', status: 'live', admittedAt: now(), url: '/workspace/projects/x/runs/a1' } }, tenets: { 'a2000000-0000-4000-8000-000000000001': { key: 'TEN-1', claim: 'Signup stays closed', state: 'held', at: now() } } } });

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
const handler = (q) => {
  const u = new URL(q.url());
  // XENO Multiplayer stands in here: the real Yjs from live-client.js, passed between two pages by a BroadcastChannel
  if (u.pathname.endsWith('/live-client.js')) return db.liveOn ? q.respond({ status: 200, contentType: 'text/javascript', body: LIVE_CLIENT + FAKE_HUB }) : q.respond({ status: 503, body: '' });
  if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const method = q.method(); let b = {}; try { b = q.postData() ? JSON.parse(q.postData()) : {}; } catch { b = {}; }
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER });
  if (u.pathname === '/api/workspace-docs' && method === 'POST') { db.docs.push(b); return json(200, { success: true, doc: { id: 'c0000000-0000-4000-8000-00000000000d', versionId: 'v-doc-1', title: b.title } }); }
  const mv = u.pathname.match(/^\/api\/library\/assets\/file\/([\w-]+)\/project$/); if (mv) { db.moved.push(mv[1]); return json(200, { success: true }); }
  if (u.pathname === '/api/chat/conversations' && method === 'POST') { db.chats.push(b); return json(200, { success: true, conversation: { id: 'c0000000-0000-4000-8000-00000000000e' } }); }
  if (u.pathname === '/api/generations/catalog') return json(200, { types: [{ type: 'image', models: [{ id: 'gpt-image-2', name: 'GPT Image', settings: { ratio: { values: ['1:1', '16:9'], default: '1:1' }, quality: { values: ['low', 'medium'], default: 'medium' } }, references: { max: 8 }, tariff: { maxRetailCredits: 12 } }] }, { type: 'video', models: [{ id: 'veo', name: 'Veo', settings: { ratio: { values: ['16:9', '9:16'], default: '16:9' }, mode: { values: ['text_to_video', 'start_image'], default: 'text_to_video' } }, references: { max: 1 }, tariff: { maxRetailCredits: 80 } }] }] });
  if (u.pathname === '/api/generations/quote') return json(200, { quoteToken: 'q', maxRetailCredits: 12 });
  if (u.pathname === '/api/generations' && method === 'POST') { db.generated.push(b); return json(202, { generation: { id: GEN, state: 'queued' } }); }
  if (u.pathname === '/api/tasks/assignees') return json(200, { success: true, assignees: [{ id: 'u2', name: 'Ada' }] });
  const dg = u.pathname.match(/^\/api\/workspace-docs\/([\w-]+)$/); if (dg) { if (method === 'PUT') { db.docPut = b; return json(200, { success: true, doc: { versionId: 'v-doc-2' } }); } return json(200, { success: true, doc: { id: dg[1], versionId: 'v-doc-1', title: 'Plan', markdown: 'First line' } }); }
  const ts = u.pathname.match(/^\/api\/tasks\/(T-\d+)\/transition$/); if (ts) { (db.moves = db.moves || []).push(b.to); const t = db.tasks.find((x) => x.key === ts[1]); t.status = b.to; return json(200, { success: true, task: t }); }
  const pt = u.pathname.match(/^\/api\/tasks\/(T-\d+)$/); if (pt && method === 'PATCH' && b.assigneeId) { db.assigned = { key: pt[1], body: b }; return json(200, { success: true, task: { key: pt[1], title: 'x', status: 'todo', assignee: { id: 'u2', name: 'Ada' } } }); }
  const jf = u.pathname.match(/^\/api\/chat\/projects\/([\w-]+)\/files$/); if (jf) { db.joined.push({ kind: 'file', project: jf[1], id: b.storage_key }); return json(200, { success: true, file: {} }); }
  if (/\/move\/preview$/.test(u.pathname)) return json(200, { success: true, move: { consentRevision: 'c'.repeat(64) } });
  const jc = u.pathname.match(/^\/api\/chat\/conversations\/([\w-]+)\/move$/); if (jc) { db.joined.push({ kind: 'chat', project: b.project_id, id: jc[1], consent: b.consent_revision }); return json(200, { success: true, conversation: {} }); }
  if (u.pathname === '/api/library/assets' && method === 'GET') return json(200, { success: true, items: [{ id: 'aa000000-0000-4000-8000-000000000001', name: 'old.pdf', mime_type: 'application/pdf' }] });
  if (u.pathname === '/api/chat/conversations' && method === 'GET') return json(200, { success: true, conversations: [{ id: 'bb000000-0000-4000-8000-000000000001', title: 'Old chat' }] });
  if (u.pathname === '/api/live/tickets') { db.tickets.push(b.resource); return json(200, { success: true, ticket: 't' }); }
  if (u.pathname === '/api/canvases/open-as' && method === 'POST') { db.openAs = b.id; return json(200, { success: true, created: false, canvas: { ...out(db.canvases[0]), content: db.canvases[0].content, records: { tasks: recs(db.canvases[0]) } } }); }
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
  const EMPTY = { '/api/notifications': { success: true, unread: 0, items: [] }, '/api/workspace/needs': { success: true, items: [] }, '/api/workspace/search': { success: true, results: [], counts: {} }, '/api/forum/threads': { success: true, threads: [], total: 0 }, '/api/forum/me': { success: true, actor: {}, capabilities: {} }, '/api/workspace/summary': { success: true, days: 7, areas: {} }, '/api/workspace/pins': { success: true, items: [] }, '/api/v2/ledger/usage': { rows: [] }, '/api/account/overview': { success: true, overview: { user: USER, credits: { balance: 0 }, workspace_count: 1 } }, '/api/user-data/settings': { success: true, settings: {} }, '/api/workspaces': { success: true, workspaces: [] }, '/api/chat/projects': { success: true, projects: [{ id: 'a0000000-0000-4000-8000-000000000001', name: 'BUNKERVERSE LAUNCH PROGRAMME', owner_user_id: 'u1', area: null }] }, '/api/chat/conversations': { success: true, conversations: [] }, '/api/library/assets': { success: true, items: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } } }[u.pathname];
  if (EMPTY) return json(200, EMPTY);
  return json(404, { success: false, error: 'not found' });
};
p.on('request', handler);
const main = () => p.$eval('#main', (e) => e.innerText).catch(() => '');
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));
const nav = async (h) => { await p.evaluate((x) => (location.hash = x), h); await settle(); };
const cv = () => p.evaluate(() => window.XENO_CANVAS.state());
const box = (sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, r: r.right, b: r.bottom }; });
const waitSaved = async () => { for (let i = 0; i < 30; i++) { const s = await cv(); if (!s.dirty) { await settle(250); return cv(); } await settle(150); } return cv(); };
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
  await p.evaluate(() => XENO_CANVAS.act('add-task')); await p.waitForSelector('.xd .xd-checks', { timeout: 3000 });
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
  await p.evaluate(() => XENO_CANVAS.act('add-note')); await settle(1500);
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
  await p.click('[data-cv-act="add"]'); await settle(200);
  ok(!!(await p.$('.xn-menu [data-add="add-file"]')) && !!(await p.$('.xn-menu [data-add="add-chat"]')), 'Add can put files and chats on the canvas'); await p.keyboard.press('Escape'); await settle(150);

  // every kind of node is drawn the same way: the name outside the object, a drawn selection line, soft corner grips
  const EXTRA = [{ id: 'rl1', type: 'link', url: 'https://jsoncanvas.org/spec', x: 900, y: 900, width: 280, height: 90 }, { id: 'rg1', type: 'group', label: 'Later', x: -40, y: 1100, width: 600, height: 300 },
    { id: 'rr1', type: 'xeno-ref', ref: { kind: 'run', id: 'a1000000-0000-4000-8000-000000000001' }, x: 0, y: 1160, width: 260, height: 110 }, { id: 'rt1', type: 'xeno-ref', ref: { kind: 'tenet', id: 'a2000000-0000-4000-8000-000000000001' }, x: 300, y: 1160, width: 260, height: 120 },
    { id: 'rx1', type: 'xeno-ref', ref: { kind: 'generation', id: GEN }, x: 1200, y: 900, width: 260, height: 260 }];
  db.canvases[0].content.nodes.push(...EXTRA); db.canvases[0].revision++; await p.reload({ waitUntil: 'domcontentloaded' }); await settle(1800);
  const shapes = await p.$$eval('[data-cv-node]', (els) => els.map((e) => ({ id: e.dataset.cvNode, xn: e.classList.contains('xn'), label: !!e.querySelector(':scope > .xn-label'), obj: !!e.querySelector(':scope > .xn-edge > .xn-obj'), old: e.classList.contains('cv-n--task') || e.classList.contains('cv-n--link') || e.classList.contains('cv-n--group') })));
  const oddOnes = shapes.filter((s) => !s.xn || !s.label || !s.obj || s.old).map((s) => s.id);
  ok(shapes.length >= 9 && !oddOnes.length, `every node — file, link, group, run, verdict, older image, gone — is the node design, label outside (${oddOnes.join() || 'all'})`);
  ok(/brief\.pdf/.test(await cardTxt('rf1')) && /PDF/.test(await cardTxt('rf1')) && /2\.4 MB/.test(await cardTxt('rf1')) && /jsoncanvas\.org/.test(await cardTxt('rl1')) && /Scout/.test(await cardTxt('rr1')) && /Live/.test(await cardTxt('rr1')) && /Signup stays closed/.test(await cardTxt('rt1')) && /Held/.test(await cardTxt('rt1')) && /Later/.test(await cardTxt('rg1')), 'each still says what it is, live');
  ok(!!(await p.$('[data-cv-node="rr1"][data-cv-kind="run"]')) && !!(await p.$('[data-cv-node="rx1"][data-cv-generation]')) && !!(await p.$('[data-cv-node="rf2"].xn--gone')), 'and keeps the attributes agents and tests read');
  ok(await p.$$eval('[data-cv-node="rl1"] [data-cv-grip], [data-cv-node="rg1"] [data-cv-grip]', (e) => e.length) === 6, 'links and groups take the curved corner grips too');
  await p.evaluate(() => XENO_CANVAS.act('fit')); await settle(300);
  if (process.env.CANVAS_SHOT_NODES) await p.screenshot({ path: process.env.CANVAS_SHOT_NODES });
  { const lb = await box('[data-cv-node="rl1"] .xn-obj'); await p.mouse.click(lb.x, lb.t + 16); await settle(250); }   // its corner, not the address in it
  const selLine = await p.$eval('[data-cv-node="rl1"]', (e) => ({ f: getComputedStyle(e).filter, fo: getComputedStyle(e.querySelector('.xn-obj')).filter, line: getComputedStyle(e.querySelector('.xn-edge'), '::before').opacity }));
  ok(selLine.f === 'none' && selLine.fo === 'none' && Number(selLine.line) === 0.5, `selecting draws a 1px line at .5, never a filter (${JSON.stringify(selLine)})`);
  await p.mouse.click(st.r - 40, st.t + 40); await settle(200);
  db.canvases[0].content.nodes = db.canvases[0].content.nodes.filter((n) => !EXTRA.some((x) => x.id === n.id)); db.canvases[0].revision++;

  // dependency graph (xeno-orchestrator on the platform): lay out the project's graph, readiness on each card
  db.canvases[0].project = { id: 'a0000000-0000-4000-8000-000000000001', name: 'Launch' }; db.canvases[0].revision++;
  await p.reload({ waitUntil: 'domcontentloaded' }); await settle(1800);
  await p.click('[data-cv-act="menu"]'); await settle(300);
  ok(/Lay out dependencies/.test(await p.$eval('.xcm', (e) => e.innerText).catch(() => '')), 'a project canvas offers Dependencies'); await p.keyboard.press('Escape'); await settle(150);
  await p.evaluate(() => XENO_CANVAS.act('deps')); await settle(1200);
  const sd = await waitSaved();
  const doc = db.canvases[0].content;
  const nodeOf = (k) => doc.nodes.find((x) => x.type === 'xeno-ref' && x.ref.id === k);
  ok(['T-1', 'T-2', 'T-3'].every((k) => nodeOf(k)), 'every task in the graph is on the canvas');
  ok(doc.edges.filter((e) => e.xeno && e.xeno.link === 'blocks').length >= 2, 'its dependencies are real “blocks” links');
  ok(nodeOf('T-1').x < nodeOf('T-2').x && nodeOf('T-2').x < nodeOf('T-3').x, 'laid out left → right in the order the work can happen');
  ok(!!(await p.$('[data-cv-task="T-1"] [data-cv-ready="yes"]')) && !!(await p.$('[data-cv-task="T-3"] [data-cv-ready="no"]')), 'cards say Ready / Waiting, from the server’s ready set');
  ok(!sd.conflict, 'and the layout saved');

  // a project's canvas lives in the project, at the project's address
  const pid = db.canvases[0].project.id, pc = db.canvases[0].id;
  await p.goto(`${base}/workspace/tasks/canvas/${pc}`, { waitUntil: 'domcontentloaded' }); await settle(2000);
  ok(await p.evaluate(() => location.pathname) === `/workspace/projects/${pid}/canvas/${pc}`, `an old link under Tasks lands in the project (${await p.evaluate(() => location.pathname)})`);
  ok(!!(await p.$('[data-cv-project] [data-cv-stage]')) && !(await p.$('[data-cv-root] .tk-seg')), 'it is the infinite canvas, inside the project, without the Tasks layout switch');
  ok(await p.$eval('.pg--canvas [data-cv-stage]', (e) => e.getBoundingClientRect().height > 300), 'and it fills the page');
  // the project's name shows whole in the header at a normal width, beside its tabs — never "Projects / BUNK…"
  const crumb = await p.$eval('#main .crumbs', (e) => ({ text: e.innerText, cut: [...e.querySelectorAll('*')].some((x) => x.scrollWidth > x.clientWidth + 1) || e.scrollWidth > e.clientWidth + 1, tabs: !!document.querySelector('.pg-top-tabs') }));
  ok(crumb.tabs && /BUNKERVERSE LAUNCH PROGRAMME/.test(crumb.text) && /Launch plan/.test(crumb.text) && !/[0-9a-f]{8}-[0-9a-f]{4}/.test(crumb.text) && !crumb.cut, `the header path names the project and the canvas, whole, beside the tabs — never an id (${JSON.stringify(crumb)})`);
  await p.reload({ waitUntil: 'domcontentloaded' }); await settle(1800);
  ok(await p.evaluate(() => location.pathname) === `/workspace/projects/${pid}/canvas/${pc}` && !!(await p.$('[data-cv-project] [data-cv-stage]')), 'refresh lands on the same canvas');
  await p.goto(`${base}/workspace/projects/${pid}/canvas`, { waitUntil: 'domcontentloaded' }); await settle(2000);
  ok(db.openAs === pid && !!(await p.$('[data-cv-project] [data-cv-stage]')), 'the Canvas tab opens the projectâ€™s own map');

  // made on the canvas, it is the project's
  await p.evaluate(() => XENO_CANVAS.act('new-doc')); await settle(500);
  await p.type('.xd-sh [data-f="title"] input, .xd-sh input', 'Plan'); await p.click('.xd-sh [data-xd-submit]'); await settle(1200);
  ok(db.docs.length === 1 && db.moved.at(-1) === 'v-doc-1', 'New doc makes a real document and moves it into the project');
  await p.evaluate(() => XENO_CANVAS.act('new-chat')); await settle(500);
  await p.type('.xd-sh [data-f="title"] input, .xd-sh input', 'Ideas'); await p.click('.xd-sh [data-xd-submit]'); await settle(1200);
  ok(db.chats.at(-1)?.project_id === pid, 'New chat starts a chat in the project');
  const kinds = () => db.canvases[0].content.nodes.filter((n) => n.type === 'xeno-ref').map((n) => n.ref.kind);
  const saved2 = async () => { await settle(1200); return kinds(); };
  const k2 = await saved2(); ok(k2.includes('file') && k2.includes('chat'), `and both land on the canvas (${k2.join()})`);
  // the board's own menu, where you asked for it
  const bd = await box('[data-cv-stage]'), spot = { x: bd.l + 120, y: bd.b - 120 };
  await p.mouse.click(spot.x, spot.y, { button: 'right' }); await settle(250);
  const mn = await box('.xn-menu'); ok(Math.abs(mn.l - spot.x) < 4, 'right-clicking the board opens the menu where you clicked');
  await p.type('.xn-menu input', 'ima'); await settle(100);
  ok((await p.$$eval('.xn-menu [data-add]', (e) => e.map((x) => x.dataset.add))).join() === 'media-image', 'typing narrows it');
  await p.keyboard.press('Enter'); await settle(600);
  const med = () => db.canvases[0].content.nodes.find((n) => n.type === 'media');
  const mel = await box('[data-cv-media="image"] .xn-obj'); ok(Math.abs(mel.l - spot.x) < 200, 'Image drops an image node where you clicked');
  ok(!!(await p.$('[data-cv-prompt]')) && await p.evaluate(() => document.activeElement?.dataset?.cvPrompt != null), 'its panel opens under it with the prompt in your hand');
  await p.keyboard.type('a bunker at dawn'); await settle(1200);
  ok(med()?.media.prompt === 'a bunker at dawn', 'what you type is kept on the node');
  ok(/up to 12 credits/.test(await p.$eval('[data-cv-dock]', (e) => e.innerText)), 'the panel says the most it can cost before it starts');
  ok(!db.generated.length, 'and nothing has been spent yet');
  await p.click('[data-cv-act="media-go"]'); await settle(1300);
  ok(db.generated[0]?.projectId === pid && db.generated[0].quoteToken === 'q' && db.generated[0].settings.quality === 'medium', 'Generate runs it into the project, with the settings shown');
  ok(med()?.media.generation === GEN && !!(await p.$('.xn-run')), 'and the node shows it running, with no second card');
  db.done = true; await settle(4500);
  ok(med()?.media.versions.includes('d0000000-0000-4000-8000-00000000000a') && !med()?.media.generation, 'when it finishes the file becomes the node’s version');
  ok(!kinds().includes('generation'), 'and nothing is left waiting');
  // a picture keeps its shape, a page does not, and a corner never selects
  await p.mouse.click(bd.l + 30, bd.t + 30); await settle(200);
  const shape = (el) => p.$eval(el, (e) => [e.offsetWidth, e.offsetHeight]);
  const pull = async (el, dx, dy) => { const c = await p.$eval(el + ' [data-c="br"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); await p.mouse.move(c.x, c.y); await p.mouse.down(); await p.mouse.move(c.x + dx, c.y + dy, { steps: 6 }); await p.mouse.up(); await settle(200); };
  const pic = '[data-cv-media="image"]', w0 = await shape(pic); await pull(pic, 80, 8); const w1 = await shape(pic);
  ok(w1[0] > w0[0] && Math.abs(w1[0] / w1[1] - w0[0] / w0[1]) < 0.02, `a picture scales on its ratio (${w0} → ${w1})`);
  ok(!(await p.$(pic + '.cv-n--sel')), 'pulling a corner doesn’t select the node');
  await p.evaluate(() => XENO_CANVAS.act('fit')); await settle(300);
  const pg = '.xn--doc', d0 = await shape(pg); await pull(pg, 64, -48); const d1 = await shape(pg);
  ok(d1[0] > d0[0] && d1[1] < d0[1], `a document takes any size (${d0} → ${d1})`);
  // a document is a page you write on
  const dp = await box(pg + ' .xn-page');
  await p.mouse.click(dp.x, dp.y); await p.mouse.click(dp.x, dp.y); await settle(500);
  ok(!!(await p.$(pg + ' [data-cv-text]')), 'double-clicking a document writes on it, in place');
  await p.keyboard.type(' more'); await settle(1500);
  ok(db.docPut?.expectedVersion === 'v-doc-1' && /more/.test(db.docPut.markdown), 'and it saves to the real document, against the version it opened');
  await p.mouse.click(bd.l + 30, bd.t + 30); await settle(300);
  // a task moves from its card, one allowed step at a time
  const stepKey = db.canvases[0].content.nodes.find((n) => n.ref?.kind === 'task').ref.id, moved0 = (db.moves || []).length; db.tasks.find((t) => t.key === stepKey).status = 'todo'; await p.evaluate(() => XENO_CANVAS.act('reload')); await settle(700);
  await p.evaluate((k) => XENO_CANVAS.act('step', k + '|in_review'), stepKey); await settle(500);
  ok((db.moves || []).slice(moved0).join() === 'in_progress,in_review', `a task steps forward through the real state machine (${(db.moves || []).slice(moved0)})`);
  ok(!!(await p.$('.xn-who')), 'every node has a place for who it’s with');

  // a task card can be assigned from the canvas
  const taskNode = db.canvases[0].content.nodes.find((n) => n.ref?.kind === 'task');
  await p.click(`[data-cv-node="${taskNode.id}"] .cv-task-t`); await settle(400);
  await p.click('[data-cv-act="assign"]'); await settle(600);
  await p.select('.xd-sh [data-f="who"] select', 'u2'); await p.click('.xd-sh [data-xd-submit]'); await settle(800);
  ok(db.assigned?.key === taskNode.ref.id && db.assigned.body.assigneeId === 'u2', 'a task card is assigned from the canvas, on the real task');

  // an existing file or chat put on a project's canvas joins the project
  await p.evaluate(() => XENO_CANVAS.act('add-file')); await settle(700);
  await p.click('.xd [data-v]'); await p.click('.xd [data-xd-submit]'); await settle(900);
  ok(db.joined.some((x) => x.kind === 'file' && x.project === pid && x.id), `a file put on the canvas joins the project (${JSON.stringify(db.joined)})`);
  await p.evaluate(() => XENO_CANVAS.act('add-chat')); await settle(700);
  await p.click('.xd [data-v]'); await p.click('.xd [data-xd-submit]'); await settle(900);
  ok(!db.joined.some((x) => x.kind === 'chat'), 'a chat asks first: people on the project will be able to read it');
  await p.click('.xd-sh [data-xd-ok]'); await settle(900);
  ok(db.joined.some((x) => x.kind === 'chat' && x.project === pid && x.consent === 'c'.repeat(64)), 'and moves with the consent its preview gave');

  // two people on one canvas, live
  db.liveOn = true; await p.goto(base + '/workspace/tasks', { waitUntil: 'domcontentloaded' }); await settle(800);
  const pair = []; db.writers = new Set();
  for (let i = 0; i < 2; i++) { const page = await br.newPage(); await page.setViewport({ width: 1400, height: 900 }); page.on('pageerror', (e) => errs.push(e.message)); await page.setRequestInterception(true); page.on('request', handler); page.on('request', (q) => { if (q.method() === 'PUT' && /\/api\/canvases\//.test(q.url())) db.writers.add(i); }); await page.goto(`${base}/workspace/projects/${pid}/canvas/${pc}`, { waitUntil: 'domcontentloaded' }); pair.push(page); }
  await settle(3000);
  const [a, b2] = pair;
  const ids = (page) => page.$$eval('[data-cv-node]', (els) => els.map((e) => e.dataset.cvNode).sort());
  const same = async () => JSON.stringify(await ids(a)) === JSON.stringify(await ids(b2));
  ok(db.tickets.includes(`workspace.canvas/${pc}`) && !!(await a.$('[data-cv-live]')) && !!(await b2.$('[data-cv-live]')), 'both join the canvas live');
  ok((await b2.$$('[data-cv-people] .tk-face')).length === 1, 'and each sees the other is here');
  const startCount = (await ids(a)).length;
  await a.bringToFront(); await a.evaluate(() => XENO_CANVAS.act('add-note')); await settle(300); await a.keyboard.type('from A'); await a.keyboard.press('Escape'); await a.mouse.click(700, 800); await settle(700);
  ok((await ids(b2)).length === startCount + 1 && await same(), 'a note added by one appears for the other without a reload');
  await a.evaluate(() => XENO_CANVAS.act('add-note')); await b2.evaluate(() => XENO_CANVAS.act('add-note')); await settle(900);
  await a.keyboard.press('Escape'); await a.mouse.click(700, 800); await b2.bringToFront(); await b2.keyboard.press('Escape'); await b2.mouse.click(700, 800); await settle(400); await a.bringToFront(); await settle(900);
  ok((await ids(a)).length === startCount + 3 && await same(), 'two people adding at the same moment both land');
  const target = await a.evaluate(() => [...document.querySelectorAll('[data-cv-node]')].filter((e) => /^[a-z0-9]{8}$/.test(e.dataset.cvNode)).find((e) => { const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit && hit.closest('[data-cv-node]') === e; })?.dataset.cvNode);
  const bb = await (await a.$(`[data-cv-node="${target}"]`)).boundingBox();
  const was = await b2.$eval(`[data-cv-node="${target}"]`, (e) => e.style.left + e.style.top);
  await a.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await a.mouse.down(); await a.mouse.move(bb.x + 140, bb.y + 90, { steps: 6 }); await settle(200);
  ok(await b2.$eval(`[data-cv-node="${target}"]`, (e) => e.style.left + e.style.top) !== was, 'a card being moved moves on the other screen as it goes');
  await a.mouse.up(); await settle(500);
  ok(await a.$eval(`[data-cv-node="${target}"]`, (e) => e.style.left + e.style.top) === await b2.$eval(`[data-cv-node="${target}"]`, (e) => e.style.left + e.style.top), 'and both end in the same place');
  await b2.bringToFront(); await b2.evaluate(() => XENO_CANVAS.act('add-note')); await settle(400); await b2.keyboard.type('still typing');
  await a.bringToFront(); await a.evaluate(() => XENO_CANVAS.act('add-note')); await settle(500); await a.mouse.click(700, 800); await settle(900);
  ok((await ids(b2)).length === (await ids(a)).length, 'someone typing in a note still sees what others do');
  ok(/still typing/.test(await b2.$eval('[data-cv-text]', (e) => e.value).catch(() => '')) || await b2.$$eval('.cv-n--text', (els) => els.some((e) => /still typing/.test(e.innerText || e.textContent))), 'and keeps what they typed');
  await b2.bringToFront(); await b2.keyboard.press('Escape'); await b2.mouse.click(700, 800); await settle(400); await a.bringToFront(); await settle(700);
  await a.mouse.move(600, 500); await settle(300); await a.mouse.move(620, 520); await settle(500);
  ok(!!(await b2.$('[data-cv-cursor]')), 'each sees where the other is pointing');
  await a.click(`[data-cv-node="${target}"]`); await settle(200); await a.keyboard.press('Delete'); await settle(700);
  ok(!(await ids(b2)).includes(target), 'a card removed by one goes for the other');
  await settle(1500);
  const putsAt = db.puts.length, conflicts = await a.$('.cv-conflict') || await b2.$('.cv-conflict');
  ok(!conflicts && db.canvases[0].content.nodes.length === (await ids(a)).length, 'it is written down once, whole, with no conflict for anyone');
  await settle(1200); ok(db.puts.length === putsAt, 'and nothing saves when nothing changed');
  ok(db.writers.size === 1, `one screen writes the shared canvas down, not everyone (${db.writers.size})`);
  const onCanvas = db.tasks.find((x) => db.canvases[0].content.nodes.some((n) => n.ref?.id === x.key)); onCanvas.title = 'Renamed elsewhere'; await a.evaluate(() => window.__hub.postMessage({ k: 'changed' })); await b2.evaluate(() => window.__hub.postMessage({ k: 'changed' })); await settle(900);
  ok(/Renamed elsewhere/.test(await a.$eval('[data-cv-stage]', (e) => e.textContent)), 'told something changed in the project, the cards update');
  // access taken away while it is open: the service closes that seat (4403) and the page reads the canvas again as who they are now
  db.canvases[0].readonly = true; const bConn = await b2.evaluate(() => window.__live.self.conn); await a.evaluate((c) => window.__hub.postMessage({ k: 'end', conn: c, code: 4403 }), bConn); await settle(1500);
  ok(/View only/.test(await b2.$eval('#main', (e) => e.innerText)) && !(await b2.$('[data-cv-act="add"]')) && !(await a.evaluate(() => /View only/.test(document.querySelector('#main').innerText))), 'a seat closed because access changed reopens as what is left (view only), and only for them');
  db.canvases[0].readonly = false;
  await a.close(); await b2.close(); db.liveOn = false;

  // view-only
  db.canvases[0].readonly = true; await p.bringToFront(); await p.goto(`${base}/workspace/projects/${pid}/canvas/${pc}`, { waitUntil: 'domcontentloaded' }); await settle(1800);
  ok(/View only/.test(await main()) && !(await p.$('[data-cv-act="add"]')), 'a canvas you may only view shows no editing tools');
  ok((await p.$$('[data-cv-wire]')).length === 0, 'and no connect handles');

  // missing
  await nav('#/studio/g/tasks/canvas/00000000-0000-4000-8000-0000000000ff'); await settle(800);
  ok(/doesn’t exist, or it hasn’t been shared with you/.test(await main()), 'an unknown canvas says so');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);
