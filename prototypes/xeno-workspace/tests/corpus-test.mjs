// XENO Corpus on the platform: a project's Corpus tab and a division's Corpus section (tenets with the latest signed verdict,
// inherited doctrine, narrower scopes by reference, proposals a PERSON ratifies), each tenet at an id address with its parent
// in the path, surviving a fresh load; and a tenet as a live verdict card on a project Canvas. Harness copied from wfscreens-test.mjs.
// A Vite server serves the workspace; the test answers /api/ from a small in-memory platform. Nothing real is touched.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5291, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();

const U = '11111111-1111-4111-8111-111111111111', WP = '22222222-2222-4222-8222-222222222222', WT = '33333333-3333-4333-8333-333333333333';
const pid = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const db = {
  user: { id: U, username: 'ada', email: 'ada@example.test', display_name: 'Ada Lovelace', email_verified: true },
  workspaces: [{ id: WP, workspace_type: 'personal', name: 'ada', member_role: 'owner', member_count: 1 }, { id: WT, workspace_type: 'team', name: 'Analytical Engines', member_role: 'admin', member_count: 4 }],
  projects: [
    { id: pid(1), name: 'Website', description: 'Ship the new site', settings: { xw: { mode: 'Studio', icon: 'globe' } }, is_archived: false, owner_user_id: U, workspace_id: null, file_count: 3, chat_count: 1, updated_at: '2026-10-07T10:00:00Z', capabilities: { viewer: true, owner: true } },
    { id: pid(2), name: 'Website', description: 'The company site', settings: {}, is_archived: false, owner_user_id: null, workspace_id: WT, file_count: 0, chat_count: 0, updated_at: '2026-10-06T10:00:00Z', capabilities: { viewer: true } },
    { id: pid(3), name: 'Old notes', description: '', settings: {}, is_archived: true, owner_user_id: U, workspace_id: null, file_count: 0, chat_count: 0, updated_at: '2026-09-01T10:00:00Z', capabilities: { viewer: true, owner: true } },
  ],
  conversations: [{ id: 'c1', title: 'Homepage copy', project_id: pid(1) }, { id: 'c2', title: 'Loose chat', project_id: null }],
  // a file on its second version: the FILE id stays, the version (source_id) is new
  files: [{ id: 'file:bbbbbbbb-bbbb-4bbb-8bbb-000000000002', source: 'file', source_id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', file_id: 'ffffffff-ffff-4fff-8fff-000000000001', name: 'brief.txt', mime_type: 'text/plain', size_bytes: 12, updated_at: '2026-10-16T10:00:00Z', mine: true }],
  calls: [], next: 10,
};
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
function answer(q) {
  const u = new URL(q.url()), m = q.method(), p = u.pathname; let body = null; try { body = JSON.parse(q.postData() || 'null'); } catch {}
  if (m !== 'GET') db.calls.push({ m, p, body, ws: q.headers()['x-xeno-workspace'] || null, csrf: q.headers()['x-xeno-csrf'] || null });
  if (p === '/api/auth/me') return json(200, { success: true, user: db.user });
  if (p === '/api/agents/presence/stream') return { status: 200, contentType: 'text/event-stream', body: 'event: ready\ndata: {}\n\n' };
  if (/^\/api\/library\/assets\/file\/[0-9a-f-]{36}\/star$/.test(p)) return json(200, { success: true, starred: true });
  if (p === '/api/agents/presence') return json(200, { success: true, agents: [] });
  // one agent per workspace, so the sidebar can be seen to follow a switch
  if (p === '/api/agents' && m === 'GET') { const w = u.searchParams.get('workspace'); const a = w === WT ? { id: 'agt_' + 'c'.repeat(32), name: 'Company Agent' } : { id: 'agt_' + 'a'.repeat(32), name: 'Own Agent' }; return json(200, { success: true, agents: [{ ...a, description: '', credentials: [], projects: [], owner: { kind: w === WT ? 'company' : 'personal' } }] }); }
  if (p === '/api/account/overview') return json(200, { success: true, overview: { user: db.user, credits: { balance: 0 }, workspace_count: 2 } });
  if (p === '/api/account/sessions') return json(200, { success: true, sessions: [] });
  if (p === '/api/account/security') return json(200, { success: true, security: { confirmation: { confirmed: false, available: true, expires_at: null }, methods: ['password'], has_password: true, email: '', pending_email: null } });
  if (p === '/api/account/exports') return json(200, { success: true, exports: [] });
  if (p === '/api/auth/linked-accounts') return json(200, { success: true, accounts: [] });
  if (p === '/api/billing/overview') return json(200, { success: true, overview: { credits: { balance: 0 }, subscription: null } });
  if (p === '/api/workspace/needs') return json(200, { success: true, items: [] });
  if (p === '/api/tasks') return json(200, { success: true, tasks: [] });
  if (p === '/api/notifications') return json(200, { success: true, unread: 0, items: [] });
  if (p === '/api/tasks/views') return json(200, { success: true, views: [] });
  if (p === '/api/forum/threads') return json(200, { success: true, threads: [], total: 0 });
  if (p === '/api/forum/me') return json(200, { success: true, actor: {}, capabilities: {} });
  if (p === '/api/workspace/summary') return json(200, { success: true, days: 7, areas: {} });
  if (p === '/api/workspace/pins') return json(200, { success: true, items: [] });
  if (p === '/api/v2/ledger/usage') return json(200, { rows: [] });
  if (p === '/api/dashboard/stats') return json(200, { success: true, stats: { usage_available: false, usage_by_surface: [] } });
  if (p === '/api/user-data/settings') return json(200, { success: true, settings: {} });
  if (p === '/api/workspaces' && m === 'GET') return json(200, { success: true, workspaces: db.workspaces });
  if (p === '/api/workspaces' && m === 'POST') { const w = { id: `44444444-4444-4444-8444-${String(db.next++).padStart(12, '0')}`, workspace_type: 'team', name: body.name, member_role: 'owner', member_count: 1 }; db.workspaces.push(w); return json(200, { success: true, workspace: w }); }
  if (p === '/api/library/assets') return json(200, { success: true, items: u.searchParams.get('folder') === 'root' && u.searchParams.get('owned') === 'mine' ? db.files : [] });
  if (p === '/api/tasks/projects') return json(200, { success: true, projects: [] });
  if (p === '/api/models') return json(200, { success: true, models: [] });
  if (p === '/api/agents/lends/inbox') return json(200, { success: true, lends: [] });
  if (p === '/api/agents/transfers/inbox') return json(200, { success: true, transfers: [] });
  if (p === '/api/mcp/services') return json(200, { success: true, services: [] });
  if (p === '/api/mcp/connections') return json(200, { success: true, connections: [] });
  if (p === '/api/library/folders') return json(200, { success: true, folders: [] });
  if (p === '/api/library/storage') return json(200, { success: true, storage: { usedBytes: 51 * 1024 * 1024, allowanceBytes: 100 * 1024 ** 3, remainingBytes: 100 * 1024 ** 3 - 51 * 1024 * 1024, files: 12, byKind: [], full: false } });
  { const mf = p.match(/^\/api\/chat\/projects\/([^/]+)\/files(?:\/([^/]+))?$/); if (mf) { db.pfiles = db.pfiles || [{ id: 'pf1', name: 'brief.pdf', file_type: 'application/pdf', file_size: 20480, content_url: '/api/library/assets/a1/content', created_at: '2026-09-02T10:00:00Z', ingestion_state: 'ready' }]; if (m === 'DELETE') { db.pfiles = db.pfiles.filter((x) => x.id !== mf[2]); return json(200, { success: true }); } return json(200, { success: true, files: db.pfiles }); } }
  const inArea = (x) => { const a = u.searchParams.get('area'); return a === null || (a === 'none' ? !x.area : x.area === a); };
  if (p === '/api/chat/conversations') { const rows = db.conversations.filter((c) => inArea({ area: c.project_id ? (db.projects.find((x) => x.id === c.project_id) || {}).area : c.area })); return json(200, { success: true, conversations: rows, total: rows.length }); }
  if (p === '/api/chat/projects' && m === 'GET') { (db.projectAsks = db.projectAsks || []).push(u.searchParams.get('area')); const sws = q.headers()['x-xeno-workspace']; (db.projectScopes = db.projectScopes || []).push(sws || null); return json(200, { success: true, projects: db.projects.filter(inArea).filter((x) => !sws || x.workspace_id === sws), limit: 100, offset: 0 }); }
  if (p === '/api/chat/projects' && m === 'POST') {
    if (body.name === 'Refused') return json(400, { success: false, error: 'Project name is not allowed' });
    const ws = q.headers()['x-xeno-workspace'], team = ws && ws !== WP ? ws : null;
    const pr = { id: pid(db.next++), name: body.name, description: body.description || '', settings: body.settings || {}, area: body.area || null, is_archived: false, owner_user_id: team ? null : U, workspace_id: team, file_count: 0, chat_count: 0, updated_at: new Date().toISOString(), capabilities: { viewer: true, owner: true } };
    db.projects.unshift(pr); return json(200, { success: true, project: pr });
  }
  if (/^\/api\/tasks\/T-\d+$/.test(p)) { const key = p.split('/').pop(), now = new Date().toISOString(); return json(200, { success: true, task: { id: 't-' + key, key, number: +key.slice(2), title: 'Task ' + key.slice(2), body: '', kind: 'task', priority: 'none', status: 'in_progress', area: null, project: null, assignee: null, reviewer: null, delegate: null, session: null, reporter: { id: U, name: 'Ada', kind: 'human' }, labels: [], attachments: [], children: [], links: [], watchers: [], events: [], can: { moves: [], edit: false, attach: false, delete: false }, createdAt: now, updatedAt: now } }); }
  { const ins = p.match(/^\/api\/chat\/projects\/([^/]+)\/(summary|people|activity)$/);
    if (ins) { const pr = db.projects.find((x) => x.id === ins[1]); if (!pr) return json(404, { success: false, error: 'Project not found', code: 'project_not_found' });
      if (db.insightFail) return json(500, { success: false, error: 'Internal server error' });
      if (ins[2] === 'summary') return json(200, { success: true, project: { id: pr.id, name: pr.name }, tasks: { open: 3, triage: 1, in_progress: 1, blocked: 0, in_review: 1, done: 1, wont_do: 0, done_week: 1, overdue: 1, unassigned: 1, with_agents: 1, total: 4, progress: 25 }, conversations: 1, files: 3, people: 2, agents: 1, lastActivityAt: new Date().toISOString() });
      if (ins[2] === 'people') return json(200, { success: true, project: { id: pr.id, name: pr.name }, you: { relation: 'owner', canManage: true }, people: [
        { id: U, name: 'Ada', username: 'ada', kind: 'human', relation: 'owner', me: true, email: 'ada@x.test' }, { id: 'u2', name: 'Bob', username: 'bob', kind: 'human', relation: 'editor', email: 'bob@x.test' },
        { id: 'a1', name: 'Builder', username: 'builder', kind: 'agent', relation: 'editor', owner: { id: U, name: 'Ada' } }] });
      const before = u.searchParams.get('before'); const all = Array.from({ length: 35 }, (_, i) => ({ id: 'task:e' + i, type: 'task', kind: i % 3 ? 'status' : 'comment', at: new Date(Date.now() - i * 60000).toISOString(), actor: { id: U, name: 'Ada', kind: 'human' }, task: { key: 'T-' + (i + 1), title: 'Task ' + (i + 1), status: 'in_progress' }, to: 'in_progress', ...(i % 3 ? {} : { note: 'Looks good ' + i }) }));
      all.splice(2, 0, { id: 'member:m1', type: 'member', kind: 'joined', at: new Date(Date.now() - 90000).toISOString(), actor: { id: 'a1', name: 'Builder', kind: 'agent' }, relation: 'editor' });
      const rows = all.filter((x) => !before || Date.parse(x.at) < Date.parse(before)); const page = rows.slice(0, 30);
      (db.feedAsks = db.feedAsks || []).push(before || '');
      return json(200, { success: true, items: page, next: rows.length > 30 ? page[page.length - 1].at : null }); } }
  { const acc = p.match(/^\/api\/chat\/projects\/([^/]+)\/access(?:\/user\/([^/]+))?$/), perm = p.match(/^\/api\/chat\/projects\/([^/]+)\/permanent$/);
    if (acc) { const pr = db.projects.find((x) => x.id === decodeURIComponent(acc[1])); if (!pr) return json(404, { success: false, error: 'Project not found' }); pr.grants = pr.grants || [{ subject: 'user:' + U, relation: 'owner', identity: { id: U, display_name: 'Ada', email: 'ada@example.test' } }];
      if (db.refuseShare) return json(500, { success: false, error: 'Internal server error' });
      if (m === 'GET') return json(200, { success: true, grants: pr.grants });
      if (acc[2] === 'by-email') { if (body.email !== 'bob@example.test') return json(404, { success: false, error: 'Account not found', code: 'account_not_found' }); pr.grants = pr.grants.filter((g) => g.subject !== 'user:bob-id'); pr.grants.push({ subject: 'user:bob-id', relation: body.relation, identity: { id: 'bob-id', display_name: 'Bob <b>B</b>', email: 'bob@example.test' } }); return json(200, { success: true, grant: {} }); }
      const g = pr.grants.find((x) => x.subject === 'user:' + decodeURIComponent(acc[2])); if (!g) return json(404, { success: false, error: 'Not found' });
      if (m === 'PUT') { g.relation = body.relation; return json(200, { success: true }); }
      if (m === 'DELETE') { pr.grants = pr.grants.filter((x) => x !== g); return json(200, { success: true }); } }
    if (perm && m === 'DELETE') { const pr = db.projects.find((x) => x.id === decodeURIComponent(perm[1])); if (!pr) return json(404, { success: false, error: 'Project not found' }); if (!pr.is_archived) return json(409, { success: false, code: 'archive_first', error: 'Archive the project first.' });
      const n = db.conversations.filter((c) => c.project_id === pr.id).length; if (n) return json(409, { success: false, code: 'project_not_empty', conversations: n, scheduled: 0, error: 'This project still holds chats.' });
      db.projects = db.projects.filter((x) => x !== pr); return json(200, { success: true, deleted: true }); } }
  { const wm = p.match(/^\/api\/workspaces\/([^/]+)\/(members|invites)(?:\/([^/]+))?$/);
    if (wm && wm[1] === WT) { db.people = db.people || { members: [{ id: U, user_id: U, member_role: 'admin', user: { display_name: 'Ada Lovelace', email: 'ada@example.test' } }, { id: 'u-own', user_id: 'u-own', member_role: 'owner', user: { display_name: 'Charles <i>B</i>', email: 'charles@example.test' } }, { id: 'u-bob', user_id: 'u-bob', member_role: 'member', user: { display_name: 'Bob', email: 'bob@example.test' } }], invites: [{ id: 'i-1', invited_email: 'pending@example.test', role: 'viewer', status: 'pending' }] };
      const PP = db.people; if (db.refusePeople && m !== 'GET') return json(403, { success: false, error: 'Admin required' });
      if (wm[2] === 'members' && m === 'GET') return json(200, { success: true, workspace: { id: WT, name: 'Analytical Engines', member_role: 'admin' }, members: PP.members });
      if (wm[2] === 'invites' && m === 'GET') return json(200, { success: true, invites: PP.invites });
      if (wm[2] === 'invites' && m === 'POST') { if (body.email === 'dup@example.test') return json(409, { success: false, error: 'Already invited' }); PP.invites.push({ id: 'i-' + (db.next++), invited_email: body.email, role: body.role, status: 'pending' }); return json(200, { success: true }); }
      if (wm[2] === 'invites' && m === 'DELETE') { PP.invites = PP.invites.filter((i) => i.id !== wm[3]); return json(200, { success: true }); }
      if (wm[2] === 'members' && m === 'PATCH') { const x = PP.members.find((y) => y.id === wm[3]); if (!x) return json(404, { success: false, error: 'Not found' }); x.member_role = body.member_role; return json(200, { success: true }); }
      if (wm[2] === 'members' && m === 'DELETE') { PP.members = PP.members.filter((y) => y.id !== wm[3]); return json(200, { success: true }); } } }
  const mm = p.match(/^\/api\/chat\/projects\/([^/]+)$/);
  if (mm && m === 'PUT') { const pr = db.projects.find((x) => x.id === decodeURIComponent(mm[1])); if (!pr) return json(404, { success: false, error: 'Project not found' }); if (body.name !== undefined) pr.name = body.name; if (body.area !== undefined) pr.area = body.area; if (body.is_archived !== undefined) pr.is_archived = !!body.is_archived; if (body.settings) pr.settings = { ...pr.settings, ...body.settings }; return json(200, { success: true, project: pr }); }
  { const w = cp(q, m, p, body); if (w) return w; }
  return json(404, { success: false, error: 'not in the fake platform: ' + m + ' ' + p });
}

const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 950 });
const errs = [], missing = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.startsWith('/api/')) { const r = answer(q); if (r.status === 404 && !String(r.body || '').includes('account_not_found')) missing.push(q.method() + ' ' + u.pathname); return q.respond(r); } if (u.host.includes('fonts.g')) return q.abort(); q.continue(); });
await p.setCookie({ name: 'xeno_csrf', value: 'csrf-test-token', url: base });
const main = () => p.evaluate(() => document.querySelector('#main')?.innerText || '');
const goProjects = async (item) => { await p.evaluate((it) => window.XW.go('global', { global: 'projects', item: it }), item || null); await wait(400); };
const settle = async () => { await p.evaluate(() => window.XENO_NET.idle()); await wait(500); };
const names = () => p.evaluate(() => window.XENO_PG_PROJECTS.items.map((x) => `${x.name}|${x.status}|${x.place}`));
const SAMPLE = /Brand refresh|Q4 planning|Launch week|Auth gate|XENO launch|XENO Corp|Lumen Studio/;

// ───────── the corpus half of the fake platform: the server's rules, kept (a person ratifies; doctrine binds down)
const DIV = 'dddddddd-dddd-4ddd-8ddd-00000000000d', T1 = 'abababab-abab-4bab-8bab-000000000001', TD = 'abababab-abab-4bab-8bab-00000000000d', PR = 'cdcdcdcd-cdcd-4dcd-8dcd-000000000001', CV = 'efefefef-efef-4fef-8fef-000000000001';
const K = { ratified: false, rejected: false, tenets: [], canvas: null, funding: { canPropose: true, canDecide: false, campaigns: [], budgets: [], grants: [], ceiling: { activeId: null, limitMicro: null, proposalId: null, proposedMicro: null, proposedByMe: false } } };
const tenet1 = { id: T1, key: 'site#builds', kind: 'tenet', subject: `project:${pid(1)}`, claim: 'The site builds from main.', assay: { kind: 'shell', run: 'npm run build' }, expect: '0', cadence: '24h', origin: 'authored',
  latest: { id: 'v2', state: 'lapsed', observed: '1', at: '2026-10-20T08:00:00.000Z', hash: 'b'.repeat(64), kid: 'k1' }, freshness: 'fresh' };
const corpusOf = (kind, id) => ({ success: true, corpus: { id: 'c-' + id, scope: kind, scopeId: id, subject: `${kind}:${id}`, workspaceId: WT }, canManage: true,
  tenets: kind === 'project' ? [tenet1, ...K.tenets] : [{ id: TD, key: 'edit-the-existing-document', kind: 'doctrine', subject: `division:${DIV}`, claim: 'Edit the existing document.', origin: 'authored', latest: null, freshness: 'doctrine' }],
  inheritedDoctrine: kind === 'project' ? [{ id: TD, key: 'edit-the-existing-document', kind: 'doctrine', claim: 'Edit the existing document.', from: `division:${DIV}` }] : [],
  aggregated: kind === 'division' ? [{ id: T1, key: 'site#builds', subject: `project:${pid(1)}`, from: `project:${pid(1)}`, state: 'lapsed', freshness: 'fresh' }] : [],
  proposals: kind === 'project' && !K.ratified && !K.rejected ? [{ id: PR, action: 'add', tenet: { key: 'site#tests-green', claim: 'Every test passes on main.' }, rationale: 'Green for a week.', proposerKind: 'agent', state: 'proposed' }] : [] });
const canvasDoc = () => ({ id: CV, name: 'Truth board', revision: K.canvas ? 2 : 1, project: { id: pid(1), name: 'Website' }, can: { edit: true }, content: K.canvas || { nodes: [], edges: [] },
  records: { tasks: {}, files: {}, chats: {}, tenets: (K.canvas ? K.canvas.nodes : []).filter((n) => n.ref && n.ref.kind === 'tenet').reduce((o, n) => ({ ...o, [n.ref.id]: n.ref.id === T1 ? { key: 'site#builds', claim: 'The site builds from main.', state: 'lapsed', at: '2026-10-20T08:00:00.000Z', freshness: 'fresh' } : { missing: true } }), {}) } });
function cp(q, m, p, body) {
  if (p === '/api/divisions' && m === 'GET') return json(200, { success: true, workspaceId: WT, canManage: true, divisions: [{ id: DIV, workspaceId: WT, parentId: null, key: 'dev', name: 'Dev', lifecycle: 'active', revision: 1, head: null, agents: 0, projects: 1 }] });
  if (p === `/api/divisions/${DIV}` && m === 'GET') return json(200, { success: true, division: { id: DIV, workspaceId: WT, parentId: null, key: 'dev', name: 'Dev', lifecycle: 'active', revision: 1, head: null, agents: 0, projects: 1, canManage: true, agentsList: [], projectsList: [{ id: pid(1), name: 'Website' }], children: [], parent: null } });
  if (p === `/api/divisions/${DIV}/home`) return json(200, { success: true, state: 'fresh', revision: 1, home: { id: DIV, workspaceId: WT, name: 'Dev', canManage: true, head: null, teams: [], directMembers: [], agents: [], objectives: [], runs: { rows: [], hidden: 0 }, spend: { budget: null, ledger: [] }, funding: { rows: [], hidden: 0 }, handoffs: { rows: [], hidden: 0 }, decisions: [], projects: { rows: [{ id: pid(1), name: 'Website' }], hidden: 0 } } });
  if (p === `/api/divisions/${DIV}/agent-budget`) return json(200, { success: true, budget: null, spend: [], canManage: true });
  if (p === '/api/canvases' && m === 'GET') return json(200, { success: true, canvases: [{ id: CV, name: 'Truth board', project: { id: pid(1), name: 'Website' }, updatedAt: '2026-10-20T08:00:00Z' }] });
  if (p === `/api/canvases/${CV}` && m === 'GET') return json(200, { success: true, canvas: canvasDoc() });
  if (p === `/api/canvases/${CV}` && m === 'PUT') { K.canvas = body.content; return json(200, { success: true, canvas: canvasDoc() }); }
  { const q2 = p.match(/^\/api\/corpus\/workspace\/([0-9a-f-]{36})\/query$/); if (q2) { K.asked = new URL(q.url()).searchParams.get('q'); return json(200, { success: true, tenets: K.asked === 'nothing' ? [] : [{ id: TD, key: 'edit-the-existing-document', claim: 'Edit the existing document.' }], inheritedDoctrine: [], aggregated: [] }); } }
  { const fu = p.match(/^\/api\/chat\/projects\/([0-9a-f-]{36})\/funding(?:\/ceiling(?:\/([^/]+)\/decision)?)?$/);
    if (fu && m === 'GET') return json(200, { success: true, ...K.funding });
    if (fu && m === 'POST' && !fu[2]) { K.proposedCeiling = body; K.funding.ceiling = { ...K.funding.ceiling, proposalId: 'ffffffff-ffff-4fff-8fff-000000000001', proposedMicro: body.credits * 1e6, proposedByMe: true }; return json(200, { success: true, proposalId: K.funding.ceiling.proposalId, state: 'proposed' }); }
    if (fu && m === 'POST') { K.decided = body; if (body.approve) K.funding.ceiling = { activeId: fu[2], limitMicro: K.funding.ceiling.proposedMicro, proposalId: null, proposedMicro: null, proposedByMe: false }; return json(200, { success: true, state: body.approve ? 'approved' : 'rejected' }); } }
  const s = p.match(/^\/api\/corpus\/(project|division|workspace)\/([0-9a-f-]{36})$/);
  if (s && m === 'GET') return json(200, corpusOf(s[1], s[2]));
  if (p === `/api/corpus/proposals/${PR}/decision`) {
    if (body.decision === 'ratify') { K.ratified = true; K.tenets.push({ id: 'abababab-abab-4bab-8bab-000000000002', key: 'site#tests-green', kind: 'tenet', claim: 'Every test passes on main.', origin: 'ratified', latest: null, freshness: 'never' }); } else K.rejected = true;
    return json(200, { success: true, proposal: { id: PR, state: body.decision === 'ratify' ? 'ratified' : 'rejected' } });
  }
  const ps = p.match(/^\/api\/corpus\/(project|division)\/([0-9a-f-]{36})\/proposals$/);
  if (ps && m === 'POST') { K.proposed = body; return json(201, { success: true, proposal: { id: 'p2', state: 'proposed' } }); }
  const ts = p.match(/^\/api\/corpus\/tenets\/([0-9a-f-]{36})\/verdicts$/);
  if (ts) {
    if (ts[1] === T1) return json(200, { success: true, tenet: tenet1, verdicts: [{ id: 'v2', state: 'lapsed', observed: '1', at: '2026-10-20T08:00:00.000Z', hash: 'b'.repeat(64), kid: 'k1' }, { id: 'v1', state: 'held', observed: '0', at: '2026-10-19T08:00:00.000Z', hash: 'a'.repeat(64), kid: 'k1' }] });
    if (ts[1] === TD) return json(200, { success: true, tenet: { id: TD, key: 'edit-the-existing-document', kind: 'doctrine', claim: 'Edit the existing document.', assay: null }, verdicts: [] });
    return json(404, { success: false, code: 'tenet_not_found' });
  }
  return null;
}
const path0 = () => p.evaluate(() => location.pathname);
const fresh = async () => { await p.goto(base + (await path0()), { waitUntil: 'domcontentloaded' }); await wait(1800); };
try {
  await p.goto(base + '/workspace/#/overview', { waitUntil: 'networkidle0' }); await wait(800);
  ok(/Corpus/.test(await p.evaluate(() => window.XENO_PROJECT_TABS.join())), 'a project has a Corpus tab');

  // the project's corpus at /workspace/projects/<pid>/corpus
  await goProjects('Website/Corpus'); await wait(900); let t = await main();
  ok(await path0() === `/workspace/projects/${pid(1)}/corpus`, 'the Corpus tab lives at /workspace/projects/<pid>/corpus (' + await path0() + ')');
  ok(/site#builds/.test(t) && /Lapsed/.test(t), 'it lists the tenets with their latest verdict');
  ok(/Doctrine from wider scopes/i.test(t) && /edit-the-existing-document/.test(t), 'doctrine from the division binds the project and shows');
  ok(/Proposals to ratify/i.test(t) && /site#tests-green/.test(t) && /an agent/.test(t), 'an agent’s proposal waits for a person, not applied');
  await p.click('#main [data-xcp="ratify"]'); await wait(1000); t = await main();
  ok(db.calls.some((c) => c.p === `/api/corpus/proposals/${PR}/decision` && c.body.decision === 'ratify') && /site#tests-green/.test(t) && !/Proposals to ratify/i.test(t), 'Ratify records the person’s decision and the tenet appears');
  await p.evaluate(() => { window.XD.form = async () => ({ key: 'site#lint', kind: 'tenet', claim: 'Lint is clean.', run: 'npm run lint', expect: '0', cadence: '24h', rationale: 'Saw it fail once.' }); });
  await p.click('#main [data-xcp="propose"]'); await wait(800);
  ok(K.proposed && K.proposed.tenet.key === 'site#lint' && K.proposed.tenet.assay.run === 'npm run lint' && K.proposed.rationale === 'Saw it fail once.', 'Propose sends a tenet with its assay and the reason');

  // a tenet's history at /workspace/projects/<pid>/corpus/<tenet id>
  await p.click(`#main [data-xcp="open-project"][data-to$="${T1}"]`); await wait(1000); t = await main();
  ok(await path0() === `/workspace/projects/${pid(1)}/corpus/${T1}` && /Lapsed/.test(t) && /Held/.test(t) && /npm run build/.test(t), 'a tenet opens at …/corpus/<tenet id> with its signed history and assay');
  await fresh(); t = await main();
  ok(await path0() === `/workspace/projects/${pid(1)}/corpus/${T1}` && /The site builds from main/.test(t), 'a fresh load on the tenet address opens the same tenet');
  await p.goBack({ waitUntil: 'domcontentloaded' }); await wait(1500);
  ok(await path0() === `/workspace/projects/${pid(1)}/corpus`, 'Back returns to the Corpus tab');

  // the division's corpus section and a division tenet at /workspace/divisions/<id>/corpus/<tid>
  await p.evaluate((d) => window.XW.go('global', { global: 'workspace', item: `Divisions/${d}` }), DIV); await wait(1500); t = await main();
  ok(/Corpus/.test(t) && /edit-the-existing-document/.test(t) && /From narrower scopes/i.test(t) && /site#builds/.test(t), 'a division’s home has a Corpus section: its doctrine and its projects’ tenets by reference');
  await p.click(`#main [data-pg-ws="Divisions/${DIV}/corpus/${TD}"]`); await wait(1200); t = await main();
  ok(await path0() === `/workspace/divisions/${DIV}/corpus/${TD}` && /Doctrine: it binds every narrower scope/.test(t), 'a division tenet opens at /workspace/divisions/<id>/corpus/<tenet id> (' + await path0() + ')');
  await fresh();
  ok(/Edit the existing document/.test(await main()), 'and survives a fresh load');

  // Workspace > Knowledge is the workspace's own corpus
  await p.evaluate(() => window.XW.go('global', { global: 'workspace', item: 'Knowledge' })); await wait(900); t = await main();
  ok(await path0() === '/workspace/workspace/Knowledge', 'Knowledge has its own address (' + await path0() + ')');
  ok(/Tenets/.test(t) && /edit-the-existing-document/.test(t), 'Knowledge shows what this workspace holds to be true');
  ok(!/Brand guidelines|128 sources|Product principles/.test(t + await p.evaluate(() => document.body.innerText)), 'and no sample sources');
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/knowledge.png' });
  await p.evaluate(() => { const i = document.querySelector('#main [data-xcp-search] input'); i.value = 'existing'; i.form.requestSubmit(); }); await wait(500); t = await main();
  ok(K.asked === 'existing' && /Found/.test(t), 'searching it goes to the server and shows what it found');
  await p.evaluate(() => { const i = document.querySelector('[data-xcp-search] input'); i.value = 'nothing'; i.form.requestSubmit(); }); await wait(500);
  ok(/Nothing matches that/.test(await main()), 'and says so when nothing matches');
  await p.evaluate(() => { const i = document.querySelector('[data-xcp-search] input'); i.value = ''; i.form.requestSubmit(); }); await wait(300);
  await p.click(`#main [data-pg-ws="Knowledge/${TD}"]`); await wait(800);
  ok(await path0() === `/workspace/workspace/Knowledge/${TD}` && /Doctrine: it binds every narrower scope/.test(await main()), 'a tenet opens at its own address (' + await path0() + ')');
  ok(/Knowledge/.test(await p.evaluate(() => document.querySelector('.crumbs, #crumbs, [data-crumb]')?.parentElement?.innerText || '')) && !/null/.test(await p.evaluate(() => document.querySelector('[data-crumb]')?.parentElement?.innerText || '')), 'its breadcrumb reads Knowledge, Tenet');
  await fresh(); ok(/Edit the existing document/.test(await main()), 'and survives a fresh load');
  // New tenet: the Kind field is a real choice
  await p.evaluate(() => window.XW.go('global', { global: 'workspace', item: 'Knowledge' })); await wait(800);
  await p.evaluate(() => [...document.querySelectorAll('#main [data-xcp="new-tenet"]')][0].click()); await wait(300);
  ok(await p.evaluate(() => !!document.querySelector('.xd select')), 'a new tenet’s kind is a choice, not a box to type in');
  await p.evaluate(() => document.querySelector('.xd [data-xd-close]').click()); await wait(200);

  // the Funding tab
  await goProjects('Website/Funding'); await wait(900); t = await main();
  ok(/Nothing has been funded here yet/.test(t) && /None set/.test(t) && !/isn’t available yet/.test(t), 'Funding says what is true of a project with no funding');
  await p.evaluate(() => { window.XD.form = async () => ({ n: '700' }); document.querySelector('#main [data-pf="propose"]').click(); }); await wait(600); t = await main();
  ok(K.proposedCeiling?.credits === 700 && typeof K.proposedCeiling.requestId === 'string', 'proposing a ceiling goes to the server, once');
  ok(/700 credits proposed/.test(t) && /Another owner of the project decides it/.test(t) && /None set/.test(t) && !await p.$('#main [data-pf="approve"]'), 'a proposal shows, doesn’t apply, and its proposer can’t approve it');
  K.funding.canDecide = true; K.funding.ceiling.proposedByMe = false;
  K.funding.campaigns = [{ id: 'c1', status: 'open', beneficiary: 'Open fund', refundTerms: 'Credits go back to each person.', cancellationTerms: 'x', license: 'MIT', milestones: [{ id: 'm1', title: 'First step', status: 'open', thresholdMicro: 10e6, budgetMaxMicro: 20e6, raisedMicro: 5e6, contributors: 2, mineMicro: 1e6 }] }];
  K.funding.budgets = [{ id: 'b1', purpose: 'Run the build', maximumMicro: 3e6, perRunMicro: 1e6, state: 'approved', spender: 'Bob' }];
  K.funding.grants = [{ id: 'g1', amountMicro: 2e6, state: 'proposed', task: 'Fix the login' }];
  await fresh(); await wait(1500); t = await main();
  ok(/Open fund/.test(t) && /5 of 10 credits from 2 people/.test(t) && /1 from you/.test(t), 'a campaign shows totals and how many people, and your own part');
  ok(/Run the build/.test(t) && /Fix the login/.test(t) && /Credits go back to each person/.test(t), 'budgets, requests and what happens to the money if it stops');
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/funding.png' });
  await p.click('#main [data-pf="approve"]'); await wait(600); t = await main();
  ok(K.decided?.approve === true && /700 credits/.test(t) && !/proposed/.test(t.split('Monthly ceiling')[1] || ''), 'someone else approves it, and then it applies');

  // a verdict card on the project canvas
  await p.goto(base + `/workspace/tasks/canvas/${CV}`, { waitUntil: 'domcontentloaded' }); await wait(2000);
  const tool = await p.$('[data-cv-act="add-tenet"]');
  ok(!!tool, 'a project canvas offers Verdict cards');
  if (tool) {
    await p.evaluate((id) => { window.XD.form = async () => ({ ids: [id] }); }, T1);
    await tool.click(); await wait(2500); t = await p.evaluate(() => document.body.innerText);
    ok(/site#builds/.test(t) && /Lapsed/.test(t), 'the tenet lands as a card showing its latest verdict');
    ok(K.canvas && K.canvas.nodes.some((n) => n.type === 'xeno-ref' && n.ref.kind === 'tenet' && n.ref.id === T1), 'the canvas saves it as a tenet reference (its id), never a copy');
  }
  const mine = missing.filter((x) => /corpus/.test(x));
  ok(mine.length === 0, 'the corpus screens asked for no route the platform lacks (' + JSON.stringify([...new Set(mine)].slice(0, 3)) + ')');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { ok(false, 'threw: ' + String(e.message).split('\n')[0]); }
await b.close(); await server.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
