// support-test — Help ▸ Contact support in the workspace, against a stand-in /api/support that returns what the real
// service returns for each viewer (the customer's response has no internal notes or drafts; staff see them).
// Proves: Help's Contact support opens the form; a request is sent and its page is /workspace/support/T-<n>; refresh,
// Back and a fresh tab land on the same view; the customer reply posts; staff see the queue, an internal note marked
// as internal, an agent draft that is NOT sent until a person presses Send (and Send posts the ratification), and the
// console's triage/assign/task actions call the API; no page errors.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const PORT = 5243, base = 'http://127.0.0.1:' + PORT;
let failed = 0;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const now = () => new Date().toISOString();
let STAFF = false;
const USER = () => ({ id: 'u1', username: STAFF ? 'mod' : 'ada', email: 'a@x.test', display_name: STAFF ? 'Mod' : 'Ada', avatar_url: null, email_verified: true, role: STAFF ? 'moderator' : 'user' });
const db = { tickets: [], calls: [] };
const sla = { firstResponseDueAt: now(), firstRespondedAt: null, resolutionDueAt: now(), firstResponseBreached: false, resolutionBreached: false };
const shape = (t) => {
  const inner = STAFF;
  return { key: t.key, number: t.number, kind: t.kind, title: t.title, body: t.body, status: t.status, priority: t.priority, createdAt: t.createdAt, updatedAt: t.updatedAt, url: '/workspace/support/' + t.key, thread: null, mergedInto: null, sla, engineering: t.task ? (inner ? { task: t.task, status: 'todo' } : { status: 'in progress' }) : null, you: inner ? 'staff' : 'requester',
    ...(inner ? { requester: { id: 'u1', name: 'Ada' }, assignee: t.assignee || null, delegate: { id: 'a1', name: 'Support bot', kind: 'agent' } } : {}),
    messages: t.messages.filter((m) => inner || (m.visibility === 'public' && m.state === 'sent')).map((m) => (inner ? m : { id: m.id, kind: m.kind, body: m.body, createdAt: m.createdAt, author: m.author })), attachments: [] };
};

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
  db.calls.push([method, u.pathname, b]);
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER() });
  if (u.pathname === '/api/notifications') return json(200, { success: true, unread: 0, items: [] });
  if (u.pathname === '/api/support/tickets/queue') return STAFF ? json(200, { success: true, tickets: db.tickets.map(shape) }) : json(403, { success: false, error: 'Only XENO staff and support agents see the queue', code: 'not_allowed' });
  if (u.pathname === '/api/support/tickets/mine') return json(200, { success: true, tickets: db.tickets.map(shape) });
  if (u.pathname === '/api/support/macros') return STAFF ? json(200, { success: true, macros: [{ id: 'm1', title: 'Refund issued', body: 'We refunded the charge.' }] }) : json(403, { success: false });
  if (u.pathname === '/api/support/tickets' && method === 'POST') {
    const n = db.tickets.length + 1, t = { key: 'T-' + n, number: n, kind: b.kind, title: b.title, body: b.body || '', status: 'new', priority: 'normal', createdAt: now(), updatedAt: now(), messages: [] };
    db.tickets.push(t); return json(200, { success: true, ticket: shape(t) });
  }
  const m = u.pathname.match(/^\/api\/support\/tickets\/(T-\d+)(?:\/(\w+))?(?:\/([\w-]+)\/(\w+))?$/);
  if (m) {
    const t = db.tickets.find((x) => x.key === m[1]); if (!t) return json(404, { success: false, error: 'Ticket not found' });
    if (!m[2]) return json(200, { success: true, ticket: shape(t) });
    if (m[2] === 'messages') { const internal = !!b.internal && STAFF; t.messages.push({ id: 'x' + Math.random(), kind: internal ? 'note' : 'reply', body: b.body, createdAt: now(), visibility: internal ? 'internal' : 'public', state: 'sent', agentDrafted: false, author: { kind: 'human', name: STAFF ? 'Mod' : 'Ada', requester: !STAFF } }); return json(200, { success: true, message: { state: 'sent' } }); }
    if (m[2] === 'drafts' && m[4] === 'send') { const d = t.messages.find((x) => x.id === m[3]); d.state = 'sent'; d.body = b.body || d.body; d.ratifiedBy = { id: 'u1', name: 'Mod' }; return json(200, { success: true, ticket: shape(t) }); }
    if (m[2] === 'triage') { if (b.priority) t.priority = b.priority; if (b.kind) t.kind = b.kind; return json(200, { success: true, ticket: shape(t) }); }
    if (m[2] === 'status') { t.status = b.status; return json(200, { success: true, ticket: shape(t) }); }
    if (m[2] === 'assign') { t.assignee = { id: b.assigneeId, name: 'Mod' }; return json(200, { success: true, ticket: shape(t) }); }
    if (m[2] === 'task') { t.task = 'T-9'; return json(200, { success: true, ticket: shape(t) }); }
  }
  const EMPTY = { '/api/forum/threads': { success: true, threads: [], total: 0 }, '/api/forum/me': { success: true, actor: {}, capabilities: {} }, '/api/workspace/summary': { success: true, days: 7, areas: {} }, '/api/workspace/pins': { success: true, items: [] }, '/api/v2/ledger/usage': { rows: [] }, '/api/account/overview': { success: true, overview: { user: USER(), credits: { balance: 0 }, workspace_count: 1 } }, '/api/user-data/settings': { success: true, settings: {} }, '/api/workspaces': { success: true, workspaces: [] }, '/api/chat/projects': { success: true, projects: [] }, '/api/chat/conversations': { success: true, conversations: [] }, '/api/library/assets': { success: true, items: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } }, '/api/tasks': { success: true, tasks: [] } }[u.pathname];
  if (EMPTY) return json(200, EMPTY);
  return json(404, { success: false, error: 'not found' });
};
p.on('request', handler);
const main = () => p.$eval('#main', (e) => e.innerText).catch(() => '');
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const posted = (re) => db.calls.some(([mm, pth]) => mm !== 'GET' && re.test(pth));
try {
  await p.goto(base + '/workspace/support', { waitUntil: 'domcontentloaded' }); await settle(1800);
  ok(/No requests yet/.test(await main()), 'the support page opens at /workspace/support and says there are no requests yet');
  ok(!(await main()).includes('Queue'), 'a customer sees no staff queue');
  await p.click('#main [data-sp-go="new"]'); await settle();
  ok(new URL(p.url()).pathname === '/workspace/support/new' && /Contact support/.test(await main()), 'Contact support has its own address');
  await p.select('#main select[name="kind"]', 'billing');
  await p.type('#main input[name="title"]', 'Charged twice');
  await p.type('#main textarea[name="body"]', 'Two charges on my card.');
  await p.click('#main [data-sp-form="new"] button[type="submit"]'); await settle(1000);
  ok(new URL(p.url()).pathname === '/workspace/support/T-1', 'sending a request lands on its id address /workspace/support/T-1');
  ok(/T-1 · Charged twice/.test(await main()) && /Two charges/.test(await main()), 'the request page shows it');
  await p.reload({ waitUntil: 'domcontentloaded' }); await settle(1800);
  ok(/Charged twice/.test(await main()), 'refresh lands on the same request');
  const p2 = await br.newPage(); await p2.setRequestInterception(true); p2.on('request', handler);
  await p2.goto(base + '/workspace/support/T-1', { waitUntil: 'domcontentloaded' }); await new Promise((r) => setTimeout(r, 1800));
  ok(/Charged twice/.test(await p2.$eval('#main', (e) => e.innerText).catch(() => '')), 'a fresh tab on the link opens the same request'); await p2.close();
  await p.type('#main [data-sp-form="reply"] textarea', 'Any update?'); await p.click('#main [data-sp-form="reply"] button[type="submit"]'); await settle();
  ok(posted(/\/tickets\/T-1\/messages$/) && /Any update\?/.test(await main()), 'the customer’s reply posts and appears');
  ok(!(await p.$('#main [name="internal"]')), 'the customer has no internal-note option');
  // XENO puts an internal note and an agent draft on it; the customer's view never carries them
  db.tickets[0].messages.push({ id: 'note1', kind: 'note', body: 'Stripe shows a duplicate auth', createdAt: now(), visibility: 'internal', state: 'sent', agentDrafted: false, author: { kind: 'human', name: 'Mod' } });
  db.tickets[0].messages.push({ id: 'draft1', kind: 'reply', body: 'We refunded it.', createdAt: now(), visibility: 'public', state: 'draft', agentDrafted: true, author: { kind: 'agent', name: 'Support bot' } });
  await p.evaluate(() => window.XENO_SUPPORT.open(null)); await settle(); await p.goBack(); await settle(1000);
  ok(new URL(p.url()).pathname === '/workspace/support/T-1' && !/duplicate auth|We refunded it/.test(await main()), 'Back returns to the request, and the customer sees neither the internal note nor the unsent draft');

  // staff
  STAFF = true;
  await p.goto(base + '/workspace/support/queue', { waitUntil: 'domcontentloaded' }); await settle(1800);
  ok(!!(await p.$('#main [data-sp-filter="breached"], #main .pg-top-left [data-sp-filter], [data-sp-filter="breached"]')) && /T-1/.test(await main()), 'staff see the queue at /workspace/support/queue');
  await p.click('#main [data-sp-go="T-1"]'); await settle(1000);
  const txt = await main();
  ok(/Internal — the customer never sees this/.test(txt) && /duplicate auth/.test(txt), 'staff see the internal note, marked internal');
  ok(/Agent draft — not sent/.test(txt) && !!(await p.$('#main [data-sp-ratify="draft1"]')), 'staff see the agent draft, marked not sent, with Edit & send');
  ok(db.tickets[0].messages.find((x) => x.id === 'draft1').state === 'draft', 'the draft is still unsent');
  await p.click('#main [data-sp-ratify="draft1"]'); await settle(300);
  ok(/Sending an agent’s draft/.test(await main()) && (await p.$eval('#main [data-sp-form="reply"] textarea', (e) => e.value)) === 'We refunded it.', 'Edit & send puts the draft in the composer to read');
  await p.$eval('#main [data-sp-form="reply"] textarea', (e) => { e.value = 'We refunded it today.'; });
  await p.click('#main [data-sp-form="reply"] button[type="submit"]'); await settle(1000);
  const sent = db.calls.find(([mm, pth]) => mm === 'POST' && /\/drafts\/draft1\/send$/.test(pth));
  ok(sent && sent[2].body === 'We refunded it today.', 'Send posts the ratification with the edited words');
  await p.select('#main [data-sp-set="priority"]', 'urgent'); await settle(800);
  ok(db.calls.some(([mm, pth, bb]) => mm === 'POST' && /\/triage$/.test(pth) && bb.priority === 'urgent'), 'staff set priority');
  await p.click('#main [data-sp-assign-me]'); await settle(800);
  ok(db.calls.some(([mm, pth, bb]) => /\/assign$/.test(pth) && bb.assigneeId === 'u1'), 'Assign to me assigns the signed-in staff member');
  await p.click('#main [data-sp-task]'); await settle(800);
  ok(posted(/\/tickets\/T-1\/task$/) && /Engineering: T-9/.test(await main()), 'Raise a task links a XENO Tasks task');
  await p.type('#main [data-sp-form="reply"] textarea', 'checked logs'); await p.click('#main [data-sp-form="reply"] [name="internal"]'); await p.click('#main [data-sp-form="reply"] button[type="submit"]'); await settle(800);
  ok(db.calls.some(([mm, pth, bb]) => /\/messages$/.test(pth) && bb.internal === true && bb.body === 'checked logs'), 'an internal note posts as internal');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);
