// The workforce screens on the platform: a project's Objectives, Runs and Changes tabs, each record at an id address with its
// parent in the path, surviving refresh, Back and a fresh tab. Harness copied from work-test.mjs.
// A Vite server serves the workspace; the test answers /api/ from a small in-memory platform. Nothing real is touched.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5193, base = `http://127.0.0.1:${PORT}`;
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
  if (p === '/api/divisions' && m === 'GET') return json(200, { success: true, workspaceId: null, canManage: true, divisions: [] });
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
  if (p === '/api/canvases') return json(200, { success: true, canvases: [] });
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
  { const w = wf(p, body); if (w) return w; }
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

// ───────── the workforce half of the fake platform
const AID = 'dddddddd-dddd-4ddd-8ddd-000000000001', OID = 'eeeeeeee-eeee-4eee-8eee-000000000001', CRID = 'cccccccc-cccc-4ccc-8ccc-000000000001', RES = '99999999-9999-4999-8999-000000000001';
const W = { revoked: false, objective: { objectiveId: OID, workspaceId: WT, divisionId: null, title: 'Ship v1', successEvidence: 'Released to customers', ownerUserId: U, status: 'open', windowStart: '2026-10-01', windowEnd: '2026-12-31' }, reviews: [] };
const admission = () => ({ schemaVersion: 1, admissionId: AID, operationId: AID, agent: { resourceId: RES, version: 3, contentHash: 'a'.repeat(64) }, target: { kind: 'project', projectId: pid(1) }, team: null, conversationId: null, root: null, entitlementId: null,
  payer: { kind: 'user', userId: U }, budget: { ceilingMicro: '5000000' }, parent: null, taskRef: 'T-7', capabilities: { requested: ['files.read'], effective: ['files.read'], terms: {} }, memoryNamespace: 'm', admittedAt: '2026-10-19T10:00:00.000Z' });
function wf(p, body) {
  if (!p.startsWith('/api/workforce/')) return null;
  const r = p.slice('/api/workforce'.length);
  if (r === '/run-admissions/list') return json(200, { success: true, schemaVersion: 1, admissions: body.projectId === pid(1) ? [admission()] : [] });
  if (r === '/run-admissions/read') return body.admissionId === AID ? json(200, { success: true, admission: admission() }) : json(404, { success: false, code: 'not_found' });
  if (r === '/run-admissions/authority') return json(200, { success: true, schemaVersion: 1, admissionId: AID, revoked: W.revoked, state: W.revoked ? 'revoked' : 'running', remainingMicro: '3500000', revokedAt: W.revoked ? '2026-10-20T08:00:00.000Z' : undefined });
  if (r === '/run-admissions/revoke') { W.revoked = true; return json(200, { success: true, schemaVersion: 1, admissionId: AID, revoked: true }); }
  const o = () => ({ ...W.objective, progress: { goals: 1, completed: 0 } });
  if (r === '/coordination/projects/tree') return json(200, { success: true, result: { projectId: body.projectId, workspaceId: WT, objectives: [o()], goals: [{ goalId: 'g1', title: 'Build the site', status: 'open', objectiveId: OID }, { goalId: 'g2', title: 'Write docs', status: 'open', objectiveId: null }] } });
  if (r === '/coordination/objectives/read') return body.objectiveId === OID ? json(200, { success: true, result: { ...o(), goals: [{ goalId: 'g1', projectId: pid(2), title: 'Build the site', status: 'open' }] } }) : json(404, { success: false, code: 'not_found' });
  if (r === '/coordination/objectives/update') { Object.assign(W.objective, { title: body.title, successEvidence: body.successEvidence }); return json(200, { success: true, result: { objectiveId: OID } }); }
  if (r === '/forge/change-requests/list') return json(200, { success: true, result: [{ id: CRID, bindingName: 'site', provider: 'local', sourceBranch: 'feat/hero', targetRef: 'main', title: 'New hero', status: 'open', approvals: W.reviews.length, failingChecks: 0, createdAt: '2026-10-19T10:00:00Z' }] });
  if (r === '/forge/change-requests/read') return json(200, { success: true, result: { id: CRID, bindingName: 'site', provider: 'local', sourceBranch: 'feat/hero', targetRef: 'main', title: 'New hero', body: 'Replaces the hero', status: 'open', headRev: 'abc123', createdAt: '2026-10-19T10:00:00Z' } });
  if (r === '/forge/change-requests/checks') return json(200, { success: true, result: [{ name: 'build', status: 'pass', detail: '' }] });
  if (r === '/forge/change-requests/reviews') return json(200, { success: true, result: W.reviews });
  if (r === '/forge/change-requests/review') { W.reviews.push({ decision: body.decision, body: body.body, createdAt: '2026-10-20T09:00:00Z' }); return json(200, { success: true, result: {} }); }
  if (r === '/sessions/branch-intents/list') return json(200, { success: true, result: { intents: [{ intentId: 'i1', conversationId: 'c1', conversationTitle: 'Homepage copy', branch: 'alt', intent: 'abandon', targetTurn: null, createdAt: '2026-10-19T11:00:00Z' }] } });
  return null;
}
const path0 = () => p.evaluate(() => location.pathname);
const fresh = async () => { await p.goto(base + (await path0()), { waitUntil: 'domcontentloaded' }); await wait(1800); };
try {
  await p.goto(base + '/workspace/#/overview', { waitUntil: 'networkidle0' }); await wait(800);
  const tabs = await p.evaluate(() => window.XENO_PROJECT_TABS.join());
  ok(/Objectives/.test(tabs) && /Runs/.test(tabs) && /Changes/.test(tabs), 'a project has Objectives, Runs and Changes tabs (' + tabs + ')');

  // Runs: list → detail at /workspace/projects/<pid>/runs/<admission id>
  await goProjects('Website/Runs'); await wait(500); let t = await main();
  ok(await path0() === `/workspace/projects/${pid(1)}/runs` && /Run dddddddd/.test(t) && /5 credits/.test(t), 'Runs lists the project’s admissions at /workspace/projects/<pid>/runs');
  await p.click('#main [data-xwp="open"][data-to$="' + AID + '"]'); await wait(900); t = await main();
  ok(await path0() === `/workspace/projects/${pid(1)}/runs/${AID}` && /Live authority/.test(t) && /Running/.test(t) && /3\.5 credits left of 5/.test(t) && /files\.read/.test(t), 'a run opens at …/runs/<admission id> with its live authority, budget left and capabilities');
  await fresh(); t = await main();
  ok(await path0() === `/workspace/projects/${pid(1)}/runs/${AID}` && /Live authority/.test(t), 'a refresh / fresh tab on the run address opens the same run');
  await p.goBack({ waitUntil: 'domcontentloaded' }); await wait(1500);
  ok(await path0() === `/workspace/projects/${pid(1)}/runs`, 'Back returns to the Runs list');
  await p.goForward({ waitUntil: 'domcontentloaded' }); await wait(1500);
  await p.evaluate(() => { window.XD.confirm = async () => true; });
  await p.click('#main [data-xwp="revoke"]'); await wait(900); t = await main();
  ok(db.calls.some((c) => c.p === '/api/workforce/run-admissions/revoke' && c.body.admissionId === AID) && /Revoked/.test(t) && !(await p.$('#main [data-xwp="revoke"]')), 'Revoke stops the run and the page shows it revoked');
  // the same run from the agent page
  await p.evaluate((a) => window.XW.go('global', { global: 'workspace', item: `Agents/agt_${'a'.repeat(32)}/runs/${a}` }), AID); await wait(1200); t = await main();
  ok((await path0()).endsWith(`/workspace/Agents/agt_${'a'.repeat(32)}/runs/${AID}`) && /Live authority/.test(t), 'the run is also at /workspace/workspace/Agents/<agent id>/runs/<admission id>');
  await fresh(); ok(/Live authority/.test(await main()), 'and that address survives a fresh load');

  // Changes: change requests + branch intents → detail with review actions
  await goProjects('Website/Changes'); await wait(600); t = await main();
  ok(await path0() === `/workspace/projects/${pid(1)}/changes` && /New hero/.test(t) && /feat\/hero → main/.test(t) && /Abandoned a branch/.test(t) && /Homepage copy/.test(t), 'Changes lists change requests and branch intents');
  await p.click('#main [data-xwp="open"][data-to$="' + CRID + '"]'); await wait(900); t = await main();
  ok(await path0() === `/workspace/projects/${pid(1)}/changes/${CRID}` && /Replaces the hero/.test(t) && /build/.test(t) && /Passed/.test(t), 'a change request opens at …/changes/<id> with its checks');
  await p.evaluate(() => { window.XD.form = async () => ({ body: 'Looks good' }); });
  await p.click('#main [data-xwp="review"][data-v="approve"]'); await wait(900); t = await main();
  ok(db.calls.some((c) => c.p === '/api/workforce/forge/change-requests/review' && c.body.decision === 'approve') && /Approved — Looks good/.test(t), 'Approve records a review and it appears');
  await fresh(); ok(/Approved — Looks good/.test(await main()), 'the change request address survives a fresh load');

  // Objectives live in a workspace: the personal project says so, the company project lists them
  await goProjects('Website/Objectives'); await wait(400);
  ok(/Objectives live in a workspace/.test(await main()), 'a personal project explains that objectives live in a workspace');
  await p.evaluate((id) => window.XA.switchWorkspace(id), WT); await wait(1200);
  await goProjects('Website/Objectives'); await wait(700); t = await main();
  ok(await path0() === `/workspace/projects/${pid(2)}/objectives` && /Ship v1/.test(t) && /2026-10-01 → 2026-12-31/.test(t) && /Write docs/.test(t), 'Objectives lists the workspace’s objectives and the goals not yet under one');
  await p.click('#main [data-xwp="open"][data-to$="' + OID + '"]'); await wait(900); t = await main();
  ok(await path0() === `/workspace/projects/${pid(2)}/objectives/${OID}` && /Released to customers/.test(t) && /Build the site/.test(t), 'an objective opens at …/objectives/<id> with its evidence and goals');
  await p.evaluate(() => { window.XD.form = async () => ({ title: 'Ship v1.0', ev: 'Released to customers', end: '' }); });
  await p.click('#main [data-xwp="edit-objective"]'); await wait(900);
  ok(db.calls.some((c) => c.p === '/api/workforce/coordination/objectives/update' && c.body.title === 'Ship v1.0') && /Ship v1\.0/.test(await main()), 'Edit saves the objective');
  await p.goBack({ waitUntil: 'domcontentloaded' }); await wait(1500);
  ok(await path0() === `/workspace/projects/${pid(2)}/objectives`, 'Back returns to the Objectives list');
  await p.goForward({ waitUntil: 'domcontentloaded' }); await wait(1500);
  await fresh(); ok(/Ship v1\.0/.test(await main()) && (await path0()).endsWith(`/objectives/${OID}`), 'the objective address survives a fresh load');

  const mine = missing.filter((x) => /workforce/.test(x));
  ok(mine.length === 0, 'the workforce screens asked for no route the platform lacks (' + JSON.stringify([...new Set(mine)].slice(0, 3)) + ')');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { ok(false, 'threw: ' + String(e.message).split('\n')[0]); }
await b.close(); await server.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
