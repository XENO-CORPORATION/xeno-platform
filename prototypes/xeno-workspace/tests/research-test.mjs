// XENO Research in the workspace: the seventh mode (Research) and its home at /workspace/research; a notebook, a research
// run and a claim each at an id address with the project in the path, surviving a fresh tab and Back; a refused run shows
// its reason; Lock/Run/Verify/Export/Claim/Re-check ask the platform. Harness copied from corpus-test.mjs (a fake /api/).
// A Vite server serves the workspace; the test answers /api/ from a small in-memory platform. Nothing real is touched.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5297, base = `http://127.0.0.1:${PORT}`;
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

// ───────── the research half of the fake platform: the server's shapes (ids rr_/nb_, refusals recorded with a reason)
const NBID = 'nb_' + 'a'.repeat(32), RID = 'rr_' + 'b'.repeat(32), VID = 'rr_' + 'c'.repeat(32), XID = 'rr_' + 'd'.repeat(32), CL = 'cdcdcdcd-cdcd-4dcd-8dcd-0000000000c1';
const WFRUN = 'eeeeeeee-eeee-4eee-8eee-000000000001';
const R = { runs: [], refuse: false, claimed: false, exported: false };
const cellsOf = (i) => [{ index: 1, status: 'ok', source_sha256: 'e'.repeat(64), output_sha256: (i ? 'f' : '9').repeat(64) }, { index: 2, status: 'ok', source_sha256: 'e'.repeat(64), output_sha256: '8'.repeat(64) }];
const runOf = (id, x = {}) => ({ id, notebookId: NBID, projectId: pid(1), kind: 'run', status: 'done', reasonCode: null, reason: null, verifyOf: null, verdict: null, comparison: null, complete: true, cells: cellsOf(0), executor: { kind: 'xeno-box', image: 'sci:1', isolation: 'container' }, signed: true, createdAt: '2026-10-20T09:00:00Z', finishedAt: '2026-10-20T09:01:00Z', ...x });
const RUNS = { [RID]: runOf(RID), [VID]: runOf(VID, { kind: 'verify', verifyOf: RID, verdict: 'not-reproduced', comparison: { verdict: 'not-reproduced', findings: [], cells: [{ index: 1, reproduced: false }, { index: 2, reproduced: true }] }, cells: cellsOf(1) }),
  [XID]: runOf(XID, { status: 'refused', reasonCode: 'box_unqualified', reason: 'XENO Box reports host safety "unqualified". Until it is qualified, notebooks run only for the XENO workspace.', cells: null, complete: null, executor: null, signed: false }) };
const nbDoc = () => ({ success: true, notebook: { id: NBID, projectId: pid(1), title: 'Heat flux', locked: true, image: 'sci:1', lockedAt: '2026-10-20T08:00:00Z', lockStale: false, canEdit: true, updatedAt: '2026-10-20T09:00:00Z',
  cells: [{ index: 0, type: 'markdown', source: '# Heat flux study', outputs: [] }, { index: 1, type: 'code', source: 'print(1 + 1)', outputs: [{ output_type: 'stream', name: 'stdout', text: ['2\n'] }] }, { index: 2, type: 'code', source: 'print(2 * 21)', outputs: [{ output_type: 'stream', name: 'stdout', text: ['42\n'] }] }] },
  runs: [...R.runs, RUNS[VID], RUNS[RID]] });
const claimRow = { id: CL, key: `research#${NBID}-cell-2`, claim: 'Cell 2 prints 42', notebookId: NBID, runId: RID, cell: 2, expect: '8'.repeat(64), state: 'lapsed', latest: { state: 'lapsed', at: '2026-10-20T10:00:00Z' } };
function cp(q, m, p, body) {
  if (p === '/api/research/home') return json(200, { success: true, notebooks: [{ id: NBID, projectId: pid(1), projectName: 'Website', title: 'Heat flux', locked: true, image: 'sci:1', updatedAt: '2026-10-20T09:00:00Z' }], attention: [{ ...RUNS[VID], notebookTitle: 'Heat flux' }], claims: [{ ...claimRow, projectId: pid(1) }], box: { configured: true } });
  if (p === `/api/research/projects/${pid(1)}/notebooks` && m === 'GET') return json(200, { success: true, notebooks: [{ id: NBID, title: 'Heat flux', locked: true, image: 'sci:1', updatedAt: '2026-10-20T09:00:00Z', lastRun: RUNS[VID] }] });
  if (p === `/api/research/projects/${pid(1)}/notebooks` && m === 'POST') { R.created = body; return json(201, { success: true, notebook: { id: NBID, title: body.title } }); }
  if (p === `/api/research/notebooks/${NBID}`) return json(200, nbDoc());
  if (p === `/api/research/notebooks/${NBID}/runs` && m === 'POST') { const run = R.refuse ? { ...RUNS[XID], id: 'rr_' + '1'.repeat(32) } : { ...runOf('rr_' + '2'.repeat(32)), status: 'queued', cells: null }; R.runs.unshift(run); return json(201, { success: true, run }); }
  const rr = p.match(/^\/api\/research\/runs\/(rr_[0-9a-f]{32})(\/verify|\/export|\/claims)?$/);
  if (rr) { const run = RUNS[rr[1]]; if (!run) return json(404, { success: false, code: 'not_found', error: 'Run not found' });
    if (!rr[2]) return json(200, { success: true, run, notebook: { id: NBID, title: 'Heat flux', projectId: pid(1) }, signature: run.signed ? { state: rr[1] === VID ? 'invalid' : 'valid', valid: rr[1] !== VID, keyId: 'k-research' } : { state: 'none' } });
    if (rr[2] === '/verify') { R.verified = rr[1]; return json(201, { success: true, run: { ...runOf('rr_' + '3'.repeat(32)), kind: 'verify', status: 'queued' } }); }
    if (rr[2] === '/export') { R.exported = true; return json(200, { name: 'Heat-flux-x.research.json', files: { 'Heat-flux.ipynb': '{}', SHA256SUMS: '' } }); }
    if (rr[2] === '/claims') { R.claimed = body; return json(201, { success: true, claim: claimRow }); } }
  if (p === `/api/research/projects/${pid(1)}/claims`) return json(200, { success: true, claims: [claimRow] });
  if (p === `/api/research/claims/${CL}`) return json(200, { success: true, claim: claimRow, verdicts: [{ id: 'v1', state: 'lapsed', observed: '7'.repeat(64), at: '2026-10-20T10:00:00Z', kid: 'k1' }] });
  if (p === `/api/research/claims/${CL}/recheck`) { R.recheck = body; return json(201, { success: true, run: { ...runOf('rr_' + '4'.repeat(32)), kind: 'verify', status: 'queued' } }); }
  if (p.startsWith('/api/corpus/project/')) return json(200, { success: true, corpus: { id: 'c', scope: 'project', subject: 'p' }, canManage: true, tenets: [], inheritedDoctrine: [], aggregated: [], proposals: [] });
  if (p === `/api/workforce/projects/${pid(1)}/runs` || /^\/api\/workforce\//.test(p)) return null;
  return null;
}
const path0 = () => p.evaluate(() => location.pathname);
const fresh = async () => { await p.goto(base + (await path0()), { waitUntil: 'domcontentloaded' }); await wait(1800); };
try {
  await p.goto(base + '/workspace/#/overview', { waitUntil: 'networkidle0' }); await wait(800);
  ok(await p.evaluate(() => window.XENO_MODES.filter((m) => !m.custom).length === 7 && window.XENO_MODES.findIndex((m) => m.id === 'research') === 6 && window.XENO_MODES[6].key === '7'), 'Research is the seventh mode, on key 7');
  ok(await p.evaluate(() => JSON.stringify(window.XENO_MODES.find((m) => m.id === 'research').sections.map(([n]) => n)) === '["Notebooks","Runs","Claims","Data","Publish"]'), 'its sections are Notebooks · Runs · Claims · Data · Publish');
  ok(await p.evaluate(() => !!window.XENO_MODE_MARKS.research && window.XENO_MODE_ZONES.research.length === 5 && window.XENO_MODE_ZONES.overview.some((z) => z.of === 'research')), 'it has a mark, five areas, and Overview lists them');
  ok(/Notebooks/.test(await p.evaluate(() => window.XENO_PROJECT_TABS.join())) && /Claims/.test(await p.evaluate(() => window.XENO_PROJECT_TABS.join())), 'a project gains Notebooks and Claims tabs');

  // the mode home at /workspace/research, with its intro sheet the first time
  await p.evaluate(() => window.XW.go('mode', { mode: 'research' })); await wait(1500);
  ok(await path0() === '/workspace/research', 'the mode home lives at /workspace/research (' + await path0() + ')');
  const intro = await p.evaluate(() => document.getElementById('modeIntro')?.classList.contains('on') ? document.getElementById('modeIntro').innerText : '');
  ok(/Results that reproduce — and say so\./.test(intro), 'the first visit opens the intro: "Results that reproduce — and say so."');
  await p.keyboard.press('Escape'); await wait(500);
  await settle();
  let t = await main(); 
  ok(/Heat flux/.test(t) && /Runs that need you/.test(t) && /Not reproduced/.test(t) && /Claims not holding/.test(t) && /Lapsed/.test(t), 'the home shows recent notebooks, the run that needs you, and the lapsed claim');
  await p.evaluate(() => window.XW.go('dashboard')); await wait(500);
  await p.keyboard.down('Alt'); await p.keyboard.press('Digit7'); await p.keyboard.up('Alt'); await wait(800);
  ok(await path0() === '/workspace/research', 'Alt 7 opens Research');
  await fresh();
  ok(await path0() === '/workspace/research' && /Heat flux/.test(await main()), 'a fresh load on /workspace/research opens the same home');

  // a notebook at /workspace/projects/<pid>/notebooks/<nb id>
  await p.click(`#main [data-xrs="go"][data-to$="Notebooks/${NBID}"]`); await wait(1200); t = await main();
  ok(await path0() === `/workspace/projects/${pid(1)}/notebooks/${NBID}`, 'a notebook opens at /workspace/projects/<pid>/notebooks/<nb id> (' + await path0() + ')');
  ok(/print\(2 \* 21\)/.test(t) && /42/.test(t) && /Locked/.test(t), 'it shows the cells, their outputs and the lock');
  ok(await p.evaluate(() => ['lock', 'run', 'verify'].every((a) => document.querySelector(`#main [data-xrs="${a}"]`))), 'Lock, Run and Verify are on the page');
  await fresh(); t = await main();
  ok(await path0() === `/workspace/projects/${pid(1)}/notebooks/${NBID}` && /print\(1 \+ 1\)/.test(t), 'a fresh load on the notebook address opens the same notebook');
  R.refuse = true; await p.click('#main [data-xrs="run"]'); await wait(1000); t = await main();
  ok(db.calls.some((c) => c.p === `/api/research/notebooks/${NBID}/runs`) && /Refused/.test(t), 'Run asks the platform, and a refused run shows as Refused');
  R.refuse = false;

  // a run at /workspace/projects/<pid>/runs/<rr id>
  await p.click(`#main [data-xrs="go"][data-to$="Runs/${VID}"]`); await wait(1200); t = await main();
  ok(await path0() === `/workspace/projects/${pid(1)}/runs/${VID}`, 'a research run opens at …/runs/<rr id> (' + await path0() + ')');
  ok(/Not reproduced/.test(t) && /Same code, data and environment/.test(t) && /Signature invalid/.test(t), 'it shows the verdict, why, and the signature check');
  await p.goBack({ waitUntil: 'domcontentloaded' }); await wait(1500);
  ok(await path0() === `/workspace/projects/${pid(1)}/notebooks/${NBID}`, 'Back returns to the notebook');
  await p.goto(base + `/workspace/projects/${pid(1)}/runs/${XID}`, { waitUntil: 'domcontentloaded' }); await wait(1800); t = await main();
  ok(/Refused:/.test(t) && /host safety "unqualified"/.test(t), 'a refused run shows the refusal and its reason');
  await p.goto(base + `/workspace/projects/${pid(1)}/runs/${RID}`, { waitUntil: 'domcontentloaded' }); await wait(1800); t = await main();
  ok(/Signature valid/.test(t) && /Done/.test(t), 'a fresh tab on a run address opens that run with its signature checked');
  await p.click('#main [data-xrs="export"]'); await wait(600);
  ok(R.exported, 'Export downloads the package');
  await p.evaluate(() => { window.XD.form = async () => ({ claim: 'Cell 2 prints 42' }); });
  await p.click('#main [data-xrs="claim"][data-cell="2"]'); await wait(800);
  ok(R.claimed && R.claimed.cell === 2 && R.claimed.claim === 'Cell 2 prints 42', 'Claim opens the dialog and sends the cell');

  // claims at /workspace/projects/<pid>/claims/<tenet id>
  await goProjects('Website/Claims'); await wait(900); t = await main();
  ok(await path0() === `/workspace/projects/${pid(1)}/claims` && /Cell 2 prints 42/.test(t) && /Lapsed/.test(t), 'the Claims tab lists claims with their badge');
  await p.click(`#main [data-xrs="go"][data-to$="Claims/${CL}"]`); await wait(1000);
  ok(await path0() === `/workspace/projects/${pid(1)}/claims/${CL}`, 'a claim opens at …/claims/<tenet id>');
  await p.evaluate(() => { window.XD.form = async () => ({ admission: 'abcdefab-abcd-4bcd-8bcd-abcdefabcdef' }); });
  await p.click('#main [data-xrs="recheck"]'); await wait(800);
  ok(R.recheck && R.recheck.admissionId === 'abcdefab-abcd-4bcd-8bcd-abcdefabcdef', 'Re-check asks for the run admission and sends it');
  await fresh();
  ok(/Cell 2 prints 42/.test(await main()), 'a fresh load on the claim address opens the same claim');

  // a workforce run id in the same tab is NOT taken by research
  ok(await p.evaluate((w) => !window.XENO_RESEARCH.isRun(w), WFRUN), 'a workforce run (a UUID) is never read as a research run');

  // the badges: squares with a small radius, no circles, no animation
  const style = await p.evaluate(() => { const b = document.querySelector('.xrs-b'); if (!b) return null; const s = getComputedStyle(b); return { r: parseFloat(s.borderTopLeftRadius), anim: s.animationName }; });
  ok(style && style.r <= 4 && style.anim === 'none', 'a badge is a square with a small radius and does not move');
  const mine = missing.filter((x) => /research/.test(x));
  ok(mine.length === 0, 'the research screens asked for no route the platform lacks (' + JSON.stringify([...new Set(mine)].slice(0, 3)) + ')');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { ok(false, 'threw: ' + String(e.message).split('\n')[0]); }
await b.close(); await server.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
