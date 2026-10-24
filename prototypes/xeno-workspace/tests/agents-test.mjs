// agents-test — the workspace's Agents pages are the person's REAL agents (platform-agents.js; redesigned 2026-10-24:
// header tabs with their own addresses, Right now, Needs you, a message box, per-place pause, a spending cap), against a stand-in
// /api/agents that keeps the server's rules. Proves: a first-run explainer, create, an address by id (never a
// name) that survives refresh, Back and a fresh tab, giving it projects, making a credential that is shown once with
// each CLI's setup filled in, revoking, edit keeping the id, delete, and that a gone agent and a failure say so.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const PORT = 5199, base = 'http://127.0.0.1:' + PORT;
const USER = { id: 'u1', username: 'me', email: 'me@x.test', display_name: 'Me', avatar_url: null, email_verified: true };
let failed = 0, fail = false;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const PROJ = [{ id: 'p-1111', name: 'Releases', canEdit: true }, { id: 'p-2222', name: 'Website', canEdit: true }];
const hex = () => [...Array(32)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const db = { agents: [], calls: [], skills: [], mkt: { dev: null, listings: [], owned: new Set() } };
const skView = (k) => { const v = k.versions[k.versions.length - 1]; return { id: k.id, name: k.name, description: k.description, owner: { kind: 'personal' }, version: v.version, hash: v.hash, files: [{ path: 'SKILL.md', content: v.md }], versions: [...k.versions].reverse().map((x) => ({ version: x.version, hash: x.hash, createdAt: new Date().toISOString() })), canEdit: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; };
const mdMeta = (md) => ({ name: (String(md).match(/^name: (.+)$/m) || [])[1], description: (String(md).match(/^description: (.+)$/m) || [])[1] });
const ALL = { viewer: true, runner: true, editor: true, exporter: true, manage: true };
const view = (a) => ({ webhook: null, owner: { kind: 'personal' }, accountable: { userId: 'u1', name: 'Me' }, paused: null, rights: ALL, ...a, projects: PROJ.filter((p) => a.pids.includes(p.id)).map((p) => ({ id: p.id, name: p.name, access: 'editor' })), credentials: a.creds.filter((c) => !c.revoked).map(({ token, revoked, ...c }) => c) });

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 }); const errs = [], cerrs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') cerrs.push(m.text() + ' @ ' + ((m.location() || {}).url || '')); });
// the Open in Spawn link renders only on the two real issuers; the test serves from 127.0.0.1, so it names its own origin as one
await p.evaluateOnNewDocument((o) => { window.XENO_SPAWN_TEST_ISSUER = o; }, base);
const SHOTS = process.env.AGENT_SHOTS || '', TAG = process.env.AGENT_SHOTS_TAG || 'after';
const shot = async (name) => { if (!SHOTS) return; const fs = await import('node:fs'); fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `${TAG}-${name}.png`), fullPage: true }); };
await p.setRequestInterception(true);
p.on('request', (q) => {
  const u = new URL(q.url());
  if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const method = q.method(); let b = {}; try { b = q.postData() ? JSON.parse(q.postData()) : {}; } catch { b = {}; }
  db.calls.push([method, u.pathname, b]);
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER });
  if (u.pathname === '/api/tasks/projects') return json(200, { success: true, projects: PROJ });
  if (u.pathname === '/api/mcp/services') return json(200, { success: true, services: [{ category: 'tasks', title: 'Tasks', description: 'Projects and tasks.', tools: 10 }] });
  if (u.pathname === '/api/agents/presence/stream') { db.streamOpen = (db.streamOpen || 0) + 1; return q.respond({ status: 200, contentType: 'text/event-stream', headers: { 'Cache-Control': 'no-cache' }, body: db.agents.map((a) => `event: presence\ndata: ${JSON.stringify(a.pres ? { id: a.id, name: a.name, ...a.pres } : { id: a.id, name: a.name, state: 'working', label: 'Working in the cloud', canTakeWork: true, run: { state: 'running' } })}\n\n`).join('') + 'retry: 600000\nevent: ready\ndata: {}\n\n' }); }
  if (u.pathname === '/api/agents/presence') return json(200, { success: true, agents: db.agents.map((a) => (a.pres ? { id: a.id, name: a.name, ...a.pres } : { id: a.id, name: a.name, state: 'cloud', label: 'Runs in the cloud', canTakeWork: true, seenAt: null })) });
  { const m = u.pathname.match(/^\/api\/agents\/(agt_[0-9a-f]{32})\/activity$/); if (m) {
    const raw = [{ id: 'e1', at: new Date(Date.now() - 120000).toISOString(), kind: 'task', what: 'comment', task: 'T-7', title: 'Ship the notes', detail: 'Done, checked in the preview' }, { id: 'c1', at: new Date(Date.now() - 180000).toISOString(), kind: 'call', what: 'tasks_claim_task', detail: 'ok · 41 ms', where: 'Claude Code', ok: true }];
    const items = u.searchParams.get('grouped') === '1' ? raw.map((x) => (x.kind === 'call' ? { kind: 'calls', at: x.at, from: x.at, to: x.at, where: x.where, count: 1, failed: 0, task: null, tools: [{ name: x.what, n: 1 }] } : x)) : raw;
    return json(200, { success: true, agent: { id: m[1] }, presence: (db.agents.find((x) => x.id === m[1]) || {}).pres || { state: 'cloud', label: 'Runs in the cloud', canTakeWork: true }, items, next: null }); } }
  if (u.pathname === '/api/agents' && method === 'GET') { if (fail) return json(500, { success: false }); return json(200, { success: true, agents: db.agents.map(view) }); }
  if (u.pathname === '/api/agents' && method === 'POST') {
    const a = { id: 'agt_' + hex(), userId: 'x', name: b.name, description: b.description || '', createdAt: new Date().toISOString(), status: 'active', pids: [], creds: [], connections: [] };
    db.agents.push(a); return json(201, { success: true, agent: view(a) });
  }
  const m = u.pathname.match(/^\/api\/agents\/(agt_[0-9a-f]{32})(\/.*)?$/);
  if (m) {
    const a = db.agents.find((x) => x.id === m[1]); if (!a) return json(404, { success: false, error: 'Agent not found', code: 'agent_not_found' });
    const rest = m[2] || '';
    if (!rest && method === 'GET') return json(200, { success: true, agent: view(a) });
    if (!rest && method === 'PATCH' && b.skills !== undefined) { a.skills = b.skills.map((p) => { const k = db.skills.find((x) => x.id === p.id); const v = p.version ? k.versions.find((x) => x.version === p.version) : k.versions[k.versions.length - 1]; return { id: k.id, version: v.version, hash: v.hash }; }); a.version = (a.version || 1) + 1; return json(200, { success: true, agent: view(a) }); }
    if (!rest && method === 'PATCH') { if (b.persona !== undefined) { a.persona = b.persona; a.version = (a.version || 1) + 1; } if (b.runtime !== undefined) { a.runtime = b.runtime; a.version = (a.version || 1) + 1; } if (b.name) a.name = b.name; if (b.description !== undefined) a.description = b.description; return json(200, { success: true, agent: view(a) }); }
    if (!rest && method === 'DELETE') { db.agents = db.agents.filter((x) => x !== a); return json(200, { success: true, id: a.id, deleted: true }); }
    if (rest === '/credentials' && method === 'POST') { const c = { id: 'c' + a.creds.length, token: 'xtk_abcdefabcdef_' + hex(), hint: 'xtk_abcdefabcdef_…', label: b.label, scopes: ['tasks:read', 'tasks:write'], expiresAt: new Date(Date.now() + b.ttlHours * 3600e3).toISOString(), lastUsedAt: null, createdAt: new Date().toISOString() }; a.creds.push(c); return json(201, { success: true, credential: { id: c.id, token: c.token, expiresAt: c.expiresAt, scopes: c.scopes } }); }
    const cr = rest.match(/^\/credentials\/(.+)$/); if (cr && method === 'DELETE') { const c = a.creds.find((x) => x.id === cr[1]); c.revoked = true; return json(200, { success: true, revoked: true }); }
    if (rest === '/brief') return json(200, { success: true, layers: a.persona ? ['identity', 'xeno'] : ['xeno'], text: (a.persona ? `Who you are:\nYou are ${a.name}, ${a.persona.role}.\n\n${a.persona.body}\n\n` : '') + 'How to work a XENO task:\nWork in small, checkable steps.' });
    if (rest === '/mind' && method === 'GET') return json(200, { success: true, filename: 'agent.mind.xeno', text: `---\nxeno_mind_version: 1\nid: agent\nname: ${a.name}\nrole: ${(a.persona || {}).role || ''}\n---\n\n${(a.persona || {}).body || ''}\n` });
    if (rest === '/mind' && method === 'POST') { const m = String(b.text || '').match(/role:\s*(.+)\n---\n\n([\s\S]*)$/); if (!m) return json(400, { success: false, error: 'This is not a valid mind.xeno', code: 'invalid_mind', details: ['manifest.name: required'] }); a.persona = { role: m[1].trim(), body: m[2].trim() }; a.version = (a.version || 1) + 1; return json(200, { success: true, agent: view(a) }); }
    if (rest === '/overview') {
      const pres = a.pres || { state: 'working', label: 'Working in the cloud', canTakeWork: true, run: { state: 'running' } };
      const days = [...Array(14)].map((_, i) => ({ day: new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10), credits: i === 13 ? (a.spent || 0) : 0 }));
      return json(200, { success: true, agentId: a.id, presence: pres, today: { taskActions: 1, toolCalls: 1 }, queue: a.queue || [], needsYou: a.needs || [],
        spend: { days, windowDays: 30, spentCredits: a.spent || 0, capCredits: a.cap === undefined ? null : a.cap, covers: 'images, video and model calls through XENO tools' },
        groups: [{ kind: 'calls', at: new Date(Date.now() - 180000).toISOString(), from: new Date(Date.now() - 180000).toISOString(), to: new Date(Date.now() - 180000).toISOString(), where: 'Claude Code', count: 1, failed: 0, task: null, tools: [{ name: 'tasks_claim_task', n: 1 }] }],
        versions: [{ version: a.version || 1, createdAt: a.createdAt, by: 'Me', runs: (a.runs || []).length, completed: 0, failed: 0, stopped: 0, tasksDone: 0, tasksInReview: 0, tasksBlocked: 0 }], connections: a.connections });
    }
    if (rest === '/message' && method === 'POST') {
      if (!String(b.body || '').trim()) return json(400, { success: false, error: 'Write the message', code: 'invalid_body' });
      const doing = a.pres && (a.pres.asking || a.pres.doing);
      if (!doing) return json(409, { success: false, error: `${a.name} is not on a task right now.`, code: 'no_current_task' });
      (a.msgs = a.msgs || []).push(b.body); return json(200, { success: true, task: doing.task });
    }
    const pz = rest.match(/^\/connections\/([^/]+)\/(pause|resume)$/);
    if (pz && method === 'POST') { const c = (a.connections || []).find((x) => x.id === pz[1]); if (!c) return json(404, { success: false, code: 'connection_not_found' }); c.pausedAt = pz[2] === 'pause' ? new Date().toISOString() : null; return json(200, { success: true, connection: { id: c.id, client: c.client, lastUsedAt: c.lastUsedAt, pausedAt: c.pausedAt } }); }
    if (rest === '/spend-cap' && method === 'PUT') { if (b.credits !== null && !(Number(b.credits) >= 0)) return json(400, { success: false, error: 'The cap is between 0 and 10,000,000 credits', code: 'invalid_cap' }); a.cap = b.credits === null ? null : Number(b.credits); return json(200, { success: true, capCredits: a.cap }); }
    if (rest === '/runs' && method === 'GET') return json(200, { success: true, runs: (a.runs || []) });
    if (rest === '/runs' && method === 'POST') { a.runs = a.runs || []; const r = { id: 'r' + a.runs.length, state: 'queued', task: b.task, version: 1, budgetCredits: b.budgetCredits, createdAt: new Date().toISOString() }; a.runs.unshift(r); return json(201, { success: true, run: r }); }
    if (rest === '/access' && method === 'GET') return json(200, { success: true, access: { owner: a.owner || { kind: 'personal' }, accountable: a.accountable || { userId: 'u1', name: 'Me' }, people: a.people || [], history: a.history || [] } });
    const ar = rest.match(/^\/access\/(.+)\/(viewer|runner|editor|exporter)$/);
    if (ar) { a.people = a.people || []; let pp = a.people.find((x) => x.userId === ar[1]); if (!pp) { pp = { userId: ar[1], name: 'Cal', rights: [] }; a.people.push(pp); } if (method === 'PUT') pp.rights.push(ar[2]); else pp.rights = pp.rights.filter((x) => x !== ar[2]); a.people = a.people.filter((x) => x.rights.length); return json(200, { success: true, access: { owner: a.owner, accountable: a.accountable, people: a.people, history: a.history || [] } }); }
    if (rest === '/accountable' && method === 'POST') { a.paused = null; a.accountable = { userId: 'u1', name: 'Me' }; a.history = [{ reason: 'takeover', note: b.note || null, at: new Date().toISOString(), from: 'Bea', to: 'Me', by: 'Me' }]; return json(200, { success: true, access: {} }); }
    if (rest === '/transfers' && method === 'GET') return json(200, { success: true, transfers: a.transfers || [] });
    if (rest === '/transfers' && method === 'POST') { a.transfers = [{ id: 't1', state: 'authorized', authorizedAt: new Date().toISOString(), to: { type: 'workspace', id: b.workspaceId } }]; return json(200, { success: true, transfer: a.transfers[0] }); }
    if (rest === '/webhook') { a.webhook = b.url || null; return json(200, { success: true, ...(b.url ? { url: b.url, secret: 'whsec_SIGNING' } : { removed: true }) }); }
    const pr = rest.match(/^\/projects\/(.+)$/);
    if (pr) { if (method === 'PUT') a.pids.push(pr[1]); else a.pids = a.pids.filter((x) => x !== pr[1]); return json(200, { success: true, agent: view(a) }); }
  }
  const stopM = u.pathname.match(/^\/api\/agents\/runs\/(.+)\/stop$/);
  if (stopM) { for (const a of db.agents) for (const r of a.runs || []) if (r.id === stopM[1]) { r.state = 'cancelled'; r.reason = 'stopped_by_owner'; r.endedAt = new Date().toISOString(); } return json(200, { success: true, run: {} }); }
  { const tk = u.pathname.match(/^\/api\/tasks\/(T-\d+)$/); if (tk && method === 'PATCH') return json(200, { success: true, task: { key: tk[1], delegate: { id: b.delegateId, kind: 'agent' } } }); }
  if (u.pathname === '/api/tasks' && method === 'GET') return json(200, { success: true, tasks: [{ key: 'T-7', title: 'Ship the header', status: 'todo', project: { id: PROJ[0].id, name: PROJ[0].name } }, { key: 'T-8', title: 'Elsewhere', status: 'todo', project: { id: 'zz', name: 'Other' } }] });
  if (u.pathname === '/api/skills' && method === 'GET') return json(200, { success: true, skills: db.skills.filter((k) => !k.archived).map(skView) });
  if (u.pathname === '/api/skills' && method === 'POST') { const mdIn = b.skillMd || (b.files && b.files[0] && b.files[0].content); b.skillMd = mdIn; const m = mdMeta(mdIn); if (!/^[a-z0-9][a-z0-9-]*$/.test(m.name || '')) return json(400, { success: false, error: 'bad name', code: 'invalid_skill_name' }); const k = { id: 'skl_' + hex(), name: m.name, description: m.description, versions: [{ version: '1.0.0', hash: hex() + hex(), md: b.skillMd }] }; db.skills.push(k); return json(201, { success: true, skill: skView(k) }); }
  { const sm = u.pathname.match(/^\/api\/skills\/(skl_[0-9a-f]{32})(\/versions)?$/); if (sm) { const k = db.skills.find((x) => x.id === sm[1]); if (!k) return json(404, { success: false, code: 'skill_not_found' });
    if (sm[2] && method === 'POST') { const md = b.files[0].content, last = k.versions[k.versions.length - 1].version.split('.').map(Number); k.versions.push({ version: `${last[0]}.${last[1]}.${last[2] + 1}`, hash: hex() + hex(), md }); k.description = mdMeta(md).description; return json(201, { success: true, skill: skView(k) }); }
    if (method === 'DELETE') { k.archived = true; return json(200, { success: true, id: k.id, archived: true }); }
    return json(200, { success: true, skill: skView(k) }); } }
  if (u.pathname === '/api/marketplace/developer/skill-listings') return json(200, { success: true, developer: db.mkt.dev, listings: db.mkt.listings.filter((l) => l.mine).map((l) => ({ id: l.id, title: l.title, status: l.status, currentVersion: l.current, sourceSkill: l.sourceSkill, lastSubmission: l.sub })) });
  if (u.pathname === '/api/marketplace/developer/register' && method === 'POST') { db.mkt.dev = { id: 'd1', name: b.displayName, handle: b.slug, trustTier: 'community' }; return json(201, { success: true, developer: db.mkt.dev }); }
  if (u.pathname === '/api/marketplace/listings' && method === 'POST') { const l = { id: '11111111-2222-4333-8444-' + hex().slice(0, 12), title: b.title, summary: b.summary, license: b.license, pricing: b.pricing, mine: true, status: 'draft', versions: [] }; db.mkt.listings.push(l); return json(201, { success: true, listing: { id: l.id, kind: 'skill' } }); }
  { const lm = u.pathname.match(/^\/api\/marketplace\/listings\/([0-9a-f-]{36})\/(versions|submit|purchase|install-skill)$/); if (lm) { const l = db.mkt.listings.find((x) => x.id === lm[1]); if (!l) return json(404, { success: false });
    if (lm[2] === 'versions') { const k = db.skills.find((x) => x.id === b.skillId); const v = k.versions.find((x) => x.version === b.skillVersion); l.sourceSkill = k.id; l.versions.push({ id: 'v' + l.versions.length, version: v.version, hash: v.hash, md: v.md, name: k.name, description: k.description }); return json(201, { success: true, version: { id: 'v' + (l.versions.length - 1), version: v.version } }); }
    if (lm[2] === 'submit') { l.sub = { state: 'in_review', version: l.versions[l.versions.length - 1].version }; return json(202, { success: true, submission: { id: 's-' + l.id, state: 'in_review' } }); }
    if (lm[2] === 'purchase') { db.mkt.owned.add(l.id); return json(200, { success: true, entitlement: { type: 'owned' } }); }
    if (lm[2] === 'install-skill') { if (!db.mkt.owned.has(l.id)) return json(402, { success: false, code: 'not_entitled', error: 'Get it first' }); const v = l.versions.find((x) => x.version === l.current); const name = b.name || v.name;
      if (db.skills.some((x) => x.name === name && x.origin !== l.id)) return json(409, { success: false, code: 'skill_name_taken', error: `Your library already has a skill named ${name}. Install it under another name.` });
      const k = { id: 'skl_' + hex(), name, description: v.description, origin: l.id, versions: [{ version: v.version, hash: v.hash, md: v.md }] }; db.skills.push(k); const sv = skView(k); return json(201, { success: true, skill: { ...sv, origin: { listingId: l.id, version: v.version, latest: l.current }, installed: 'new' } }); } } }
  if (u.pathname === '/api/marketplace/catalog') return json(200, { success: true, listings: db.mkt.listings.filter((l) => l.status === 'published').map((l) => ({ id: l.id, kind: 'skill', title: l.title, summary: l.summary, developerSlug: db.mkt.dev.handle, trustTier: 'community', currentVersion: l.current, installCount: 0, pricing: [{ model: 'free', priceCredits: 0 }] })) });
  if (u.pathname === '/api/marketplace/me/entitlements') return json(200, { success: true, entitlements: [...db.mkt.owned].map((id) => ({ listingId: id, status: 'active' })) });
  { const pm = u.pathname.match(/^\/api\/marketplace\/skills\/([0-9a-f-]{36})\/preview$/); if (pm) { const l = db.mkt.listings.find((x) => x.id === pm[1]); if (!l || l.status !== 'published') return json(404, { success: false }); const v = l.versions.find((x) => x.version === l.current);
    return json(200, { success: true, listing: { id: l.id, title: l.title, summary: l.summary, license: l.license, trustTier: 'community', installCount: 0, publisher: { name: db.mkt.dev.name, handle: db.mkt.dev.handle }, pricing: [{ model: 'free', priceCredits: 0 }] },
      current: { id: 'v', version: v.version, hash: v.hash, name: v.name, description: v.description, skillMd: v.md, files: ['SKILL.md', 'scripts/check.sh'], scripts: ['scripts/check.sh'] }, versions: [{ id: 'v', version: v.version, publishedAt: new Date().toISOString() }] }); } }
  if (u.pathname === '/api/workspaces') return json(200, { success: true, workspaces: [{ id: 'w-acme', name: 'Acme', workspace_type: 'team' }, { id: 'w-me', name: 'Mine', workspace_type: 'personal' }] });
  if (u.pathname === '/api/workspaces/w-acme/members') return json(200, { success: true, members: [{ user_id: 'u1', display_name: 'Me', role: 'owner' }, { user_id: 'u-cal', display_name: 'Cal', role: 'editor' }] });
  if (u.pathname === '/api/account/security') return json(200, { success: true, security: { confirmation: { confirmed: true }, methods: ['password'] } });
  if (u.pathname === '/api/notifications') return json(200, { success: true, unread: 0, items: [] });
  if (u.pathname === '/api/workspace/search') return json(200, { success: true, results: [], counts: {} });
  if (u.pathname === '/api/workspace/needs') return json(200, { success: true, items: [] });
  return json(200, { success: true });
});
const main = () => p.$eval('#main', (e) => e.innerText).catch(() => '');
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const fresh = async (url) => { await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await settle(1800); };
const fill = async (vals) => { await p.evaluate((v) => { const fs = [...document.querySelectorAll('.xd input, .xd textarea')]; fs.forEach((f, i) => { if (v[i] !== undefined) { f.value = v[i]; f.dispatchEvent(new Event('input', { bubbles: true })); } }); }, vals); };
const submit = async () => { await p.evaluate(() => (document.querySelector('.xd [data-xd-submit]') || document.querySelector('.xd [data-xd-ok]'))?.click()); await settle(1200); };

try {
  // first run
  await fresh('/workspace/workspace/Agents'); let t = await main();
  ok(/Give work to an agent that is really yours/.test(t) && /Run it anywhere/.test(t) && /Claude Code/.test(t), 'with no agents, the page explains what an agent is and the three steps');
  ok(!/Atlas|Kit|Juno|Echo|Scout/.test(t), 'no sample agents are shown on the platform');

  // create
  await p.click('[data-xag="new"]'); await settle(500);
  await fill(['Release Bot', 'Takes release tasks and reports back']); await submit();
  // the next question is where it runs; the default is this computer, through Spawn
  ok(/Where will Release Bot run\?/.test(await p.$eval('.xd', (e) => e.innerText).catch(() => '')) && /XENO Spawn/.test(await p.$eval('.xd', (e) => e.innerText).catch(() => '')) && /In the cloud/.test(await p.$eval('.xd', (e) => e.innerText).catch(() => '')), 'after creating, it asks where the agent will run: this computer, the cloud, or another CLI');
  await submit();
  const a = db.agents[0];
  ok(new URL(p.url()).pathname === `/workspace/workspace/Agents/${a.id}/Connect` && /spawn profiles bind/.test(await main()) && (await p.$eval('[data-xag="place"][data-k="spawn"]', (e) => e.getAttribute('aria-checked')).catch(() => '')) === 'true', `choosing this computer lands on its Connect tab with Spawn chosen (${new URL(p.url()).pathname})`);
  ok(a && a.name === 'Release Bot' && a.description === 'Takes release tasks and reports back', 'New agent creates it on the platform with its name and purpose');
  // the header: its name, the six tabs IN the header bar, Hand it a task on the right
  { const hd = await p.evaluate(() => { const tabs = [...document.querySelectorAll('#main [data-xag-tab][role="tab"]')]; const hand = document.querySelector('#main [data-xag="hand"]'); const top = document.querySelector('#main .pg-tabs'); return { tabs: tabs.map((t) => t.innerText.trim()), sel: (tabs.find((t) => t.getAttribute('aria-selected') === 'true') || {}).innerText, hand: !!hand, tabsTop: top ? Math.round(top.getBoundingClientRect().top) : -1 }; });
    ok(hd.tabs.join() === 'Overview,Identity,Work,Activity,Connect,Settings,Access' && hd.sel === 'Connect' && hd.hand && hd.tabsTop < 140, `the header carries its seven tabs and Hand it a task (${JSON.stringify(hd)})`); }
  const crumb = await p.$eval('.crumbs', (e) => e.innerText).catch(() => '');
  ok(/Agents\s*\/\s*Release Bot\s*\/\s*Connect/.test(crumb) && !crumb.includes(a.id), `the breadcrumb names it and its tab, never its id (${crumb.replace(/\s+/g, ' ')})`);
  await p.click('[data-xag="place"][data-k="cli"]'); await settle(300);
  ok(/Connect a CLI/.test(await main()) && (await p.$eval('.xag-tabs [aria-selected="true"]', (e) => e.dataset.k).catch(() => '')) === 'claude', 'On a computer shows the CLI setup, Claude Code first');

  // the Overview of an agent that never ran: three steps, not empty sections
  await fresh(`/workspace/workspace/Agents/${a.id}`);
  t = await main();
  ok(/Three steps and Release Bot starts working/.test(t) && /Give it projects/.test(t) && /Choose where it runs/.test(t) && /Hand it a task/.test(t), 'a fresh tab on its id address lands on its Overview: three steps for an agent that never ran');
  await p.click('.crumbs a[data-crumb="Agents"]'); await settle();
  ok(/Release Bot/.test(await main()) && new URL(p.url()).pathname === '/workspace/workspace/Agents', 'the trail goes back to the list');
  await p.goBack(); await settle();
  ok(/Three steps and Release Bot/.test(await main()), 'Back returns to the agent');

  // the status mark: a square with a small radius (never a circle), green and blinking while it works — pushed live
  await settle(900);
  const mark = await p.evaluate(() => { const d = document.querySelector('.xag-mono--lg .xag-dot'); if (!d) return null; const c = getComputedStyle(d); return { cls: d.className, radius: c.borderTopLeftRadius, w: c.width, bg: c.backgroundColor, anim: c.animationName }; });
  ok(mark && /xag-dot--working/.test(mark.cls) && parseFloat(mark.radius) > 0 && parseFloat(mark.radius) < parseFloat(mark.w) / 2 && mark.bg === 'rgb(34, 197, 94)' && mark.anim === 'xag-blink' && db.streamOpen >= 1, `the status mark is a green square that blinks while the agent works, pushed live (${JSON.stringify(mark)})`);
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  ok((await p.$eval('.xag-mono--lg .xag-dot', (d) => getComputedStyle(d).animationName)) === 'none', 'and it stops blinking for people who turn motion off');
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  ok((await p.$eval('[data-xag-presence]', (e) => e.dataset.xagPresence).catch(() => '')) === 'working' && /Working in the cloud/.test(await main()) && /Can take work now/.test(await main()), 'the agent says whether it can take work, from the server’s presence');

  // step 1 gives it a project, from the Overview
  await p.click('[data-xag="proj-toggle"][data-id="p-1111"]'); await settle(900);
  ok(db.calls.some(([m, u, b]) => m === 'PUT' && u === `/api/agents/${a.id}/projects/p-1111` && b.access === 'editor') && a.pids.includes('p-1111'), 'the first step gives it a project on the platform');

  // keys: 4 opens Activity, at its own address; its tool calls are folded into sittings
  await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.keyboard.press('4'); await settle(900);
  t = await main();
  ok(new URL(p.url()).pathname === `/workspace/workspace/Agents/${a.id}/Activity` && /commented on\s*T-7/.test(t) && /1 XENO tool call from Claude Code/.test(t) && /tasks_claim_task/.test(t), `4 opens Activity at its address: task actions, and XENO tool calls as sittings (${new URL(p.url()).pathname})`);
  await fresh('/workspace/workspace');
  ok(!!(await p.$('#panel .side-dot.xag-dot--working')) && /Release Bot/.test(await p.$eval('#panel', (e) => e.innerText)) && parseFloat(await p.$eval('#panel .side-dot', (d) => getComputedStyle(d).borderTopLeftRadius)) < 4, 'the sidebar lists your agents with the same square status mark');
  { const g = await p.evaluate(() => { const row = [...document.querySelectorAll('#panel .row')].find((x) => x.querySelector('.side-dot')); const d = row.querySelector('.side-dot').getBoundingClientRect(), t = row.querySelector('.t').getBoundingClientRect(), r = row.getBoundingClientRect(); return { leftOfText: d.right <= t.left, inRowStart: d.left - r.left < 16, lowHalf: d.top >= t.top + t.height / 2 - 1 && d.bottom <= t.bottom, w: d.width }; });
    ok(g.leftOfText && g.inRowStart && g.lowHalf && g.w <= 7, `the sidebar mark is small, at the start of the row, before the name and level with its bottom (${JSON.stringify(g)})`); }
  await fresh('/workspace'); await settle(1500);
  { const side = await p.$eval('#panel', (e) => e.innerText).catch(() => '');
    ok(/Your agents/.test(side) && /Release Bot/.test(side) && !!(await p.$('#panel [data-ws-item] .side-dot')), `Overview's sidebar lists your agents with their status mark (${side.replace(/\s+/g, ' ').slice(0, 160)})`);
    await p.click(`#panel [data-ws-item="Agents/${a.id}"]`); await settle(900);
    ok(new URL(p.url()).pathname === `/workspace/workspace/Agents/${a.id}` && /Release Bot/.test(await main()), 'clicking it there opens the agent at its id address'); }

  // Identity: who it is, as an Anima Mind — saved as a version, shown in what it is told, exported and imported
  await fresh(`/workspace/workspace/Agents/${a.id}/Identity`); await settle(400);
  t = await main();
  ok(/stored as an Anima Mind/.test(t) && /What it is told/.test(t) && /How to work a XENO task/.test(t) && ['Role', 'Voice', 'Style', 'Boundaries', 'Output'].every((x) => t.includes(x)), 'Identity shows role, voice, style, boundaries and output, beside what the agent is told');
  await p.type('.xag-idform input[name="role"]', 'a careful release engineer');
  await p.type('.xag-idform textarea[name="s_Voice"]', 'Plain and short.');
  await p.type('.xag-idform textarea[name="s_Output"]', 'What changed and how it was checked.');
  await p.click('.xag-idform [type="submit"]'); await settle(900);
  { const sv = db.calls.filter((c) => c[0] === 'PATCH' && c[2].persona).pop();
    ok(sv && sv[2].persona.role === 'a careful release engineer' && sv[2].persona.body === '# Voice\n\nPlain and short.\n\n# Output\n\nWhat changed and how it was checked.', `Save version sends the role and the Mind body (${sv ? JSON.stringify(sv[2].persona) : 'none'})`); }
  ok(/You are Release Bot, a careful release engineer/.test(await main()) && /Saved as version/.test(await p.evaluate(() => document.body.innerText)), 'what it is told now starts with who it is, and the save is a new version');
  await p.click('[data-xag="mind-export"]'); await settle(500);
  ok(db.calls.some(([m, u]) => m === 'GET' && u === `/api/agents/${a.id}/mind`), 'Export mind.xeno fetches it as an Anima Mind');
  await p.click('[data-xag="mind-import"]'); await settle(500);
  await fill(['---\nxeno_mind_version: 1\nid: x\nname: Other\nrole: a meticulous ledger engineer\n---\n\n# Voice\n\nExact.']); await submit();
  ok(a.persona && a.persona.role === 'a meticulous ledger engineer' && (await p.$eval('.xag-idform input[name="role"]', (e) => e.value)) === 'a meticulous ledger engineer', 'Import a Mind makes its role and sections the next version');
  await shot('identity');

  // Skills: written once, given to the agent at a fixed version, moved on deliberately
  ok(/No skills yet/.test(await main()), 'with no skills, the Identity tab says so and offers to add one');
  await p.click('[data-xag="skill-new"]'); await settle(700);
  ok(new URL(p.url()).pathname === '/workspace/workspace/Skills/new' && /Skills\s*\/\s*New skill/.test(await p.$eval('.crumbs', (e) => e.innerText).catch(() => '')) && /When to use it/.test(await main()) && /Checks/.test(await main()) && /What an agent sees/.test(await main()), 'New skill opens the skill editor page — files, checks and what an agent sees — not a pop-up');
  ok(!!(await p.$('[data-xsk="ed-save"][disabled]')), 'it cannot be saved before it has a name, when to use it, and steps');
  await p.type('.xsk [data-xsk-ed="name"]', 'ledger-review');
  await p.type('.xsk [data-xsk-ed="description"]', 'Use when a change touches money.');
  await p.type('.xsk [data-xsk-ed="body"]', '1. Run the ledger tests.\n2. Report what changed.');
  ok(/- ledger-review: Use when a change touches money\./.test(await main()) && !(await p.$('[data-xsk="ed-save"][disabled]')), 'the preview shows the line every agent sees, and it can be saved');
  await shot('skill-editor');
  await p.click('[data-xsk="ed-save"]'); await settle(1200);
  { const made = db.calls.filter((c) => c[0] === 'POST' && c[1] === '/api/skills').pop(); const pin = db.calls.filter((c) => c[0] === 'PATCH' && c[2].skills).pop();
    ok(made && /^---\nname: ledger-review\ndescription: Use when a change touches money\.\n---\n\n1\. Run the ledger tests\./.test(made[2].files[0].content) && pin && pin[2].skills.length === 1 && pin[2].skills[0].id === db.skills[0].id && new URL(p.url()).pathname.endsWith('/Identity'), 'saving writes the SKILL.md, gives it to the agent, and returns to its Identity tab'); }
  ok(/ledger-review · 1\.0\.0/.test(await main()) && /Use when a change touches money/.test(await main()), 'the agent lists the skill at its version');
  await fresh('/workspace/workspace/Skills');
  ok(/ledger-review/.test(await main()) && /Skills/.test(await p.$eval('#panel', (e) => e.innerText).catch(() => '')), 'the Skills library lists it, and the sidebar has Skills');
  await p.click('[data-xsk="open"]'); await settle(900);
  ok(new URL(p.url()).pathname === `/workspace/workspace/Skills/${db.skills[0].id}` && /Run the ledger tests/.test(await main()) && /Skills\s*\/\s*ledger-review/.test(await p.$eval('.crumbs', (e) => e.innerText).catch(() => '')), 'a skill opens at its id address, with its steps, and the breadcrumb names it');
  await p.click('[data-xsk="edit"]'); await settle(900);
  ok(new URL(p.url()).pathname === `/workspace/workspace/Skills/${db.skills[0].id}/edit` && !!(await p.$('.xsk [data-xsk-ed="name"][readonly]')), 'Edit opens the editor at its own address, keeping the name');
  await p.$eval('.xsk [data-xsk-ed="body"]', (e) => { e.value = '1. Run the ledger tests.\n2. Reconcile.\n3. Report.'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('[data-xsk="ed-save"]'); await settle(1200);
  ok(db.skills[0].versions.length === 2 && /1\.0\.1/.test(await main()), 'Publish version makes 1.0.1 and keeps 1.0.0');
  await fresh(`/workspace/workspace/Agents/${a.id}/Identity`); await settle(600);
  ok(/ledger-review · 1\.0\.0/.test(await main()) && /1\.0\.1 available/.test(await main()), 'the agent stays on 1.0.0 and is told 1.0.1 is available');
  await p.click('[data-xag="skill-update"]'); await settle(800);
  ok(a.skills[0].version === '1.0.1' && /ledger-review · 1\.0\.1/.test(await main()), 'Use 1.0.1 moves it, as a new version of the agent');
  await p.click('[data-xag="skill-remove"]'); await settle(800);
  ok(!a.skills.length && /No skills yet/.test(await main()), 'Remove takes the skill away from the agent');

  // the Marketplace: publish from the library (publisher, listing, checks, review), find it, read it, get it, install it
  await fresh(`/workspace/workspace/Skills/${db.skills[0].id}`); await settle(400);
  await p.click('[data-xsk="publish"]'); await settle(500); await fill(['Ada Labs', 'ada-labs']); await submit(); await settle(500);
  await submit(); await settle(1200);
  { const L = db.mkt.listings[0];
    ok(db.mkt.dev && db.mkt.dev.handle === 'ada-labs' && L && L.sourceSkill === db.skills[0].id && L.versions[0].version === '1.0.1' && L.sub.state === 'in_review' && /in review/.test(await p.evaluate(() => document.body.innerText)), 'Publish to Marketplace sets up the publisher once, lists the skill, adds this version and sends it for review'); }
  db.mkt.listings[0].status = 'published'; db.mkt.listings[0].current = '1.0.1';   // a person approved it
  await fresh('/workspace/workspace/Skills/Marketplace'); await settle(600);
  ok(/Ledger review/.test(await main()) && /@ada-labs/.test(await main()) && /Free/.test(await main()), 'the Marketplace tab lists it under @ada-labs, free');
  await shot('skill-market');
  await p.click('[data-xsk="listing"]'); await settle(900);
  ok(/This skill includes scripts/.test(await main()) && /scripts\/check\.sh/.test(await main()) && /Reconcile/.test(await main()), 'a listing is read before getting it: its steps, its files, and a clear note that it carries scripts');
  await shot('skill-listing');
  if (process.env.AXE_PATH) { await p.addScriptTag({ path: process.env.AXE_PATH }); const ax = await p.evaluate(async () => (await window.axe.run(document.querySelector('#main'), { resultTypes: ['violations'] })).violations.map((v) => v.id + ':' + v.impact)); ok(!ax.some((v) => /critical|serious/.test(v)), `axe on a Marketplace listing: no serious or critical violations (${ax.join(', ') || 'none'})`); }
  await p.click('[data-xsk="get"]'); await settle(900);
  await settle(300); await fill(['ledger-review-2']); await submit(); await settle(1200);
  { const inst = db.skills.find((x) => x.origin === db.mkt.listings[0].id);
    ok(db.mkt.owned.has(db.mkt.listings[0].id) && inst && inst.name === 'ledger-review-2' && new URL(p.url()).pathname === `/workspace/workspace/Skills/${inst.id}`, 'Get adds it, and a name already in the library is installed under another name'); }

  // import a folder: it opens in the editor first, so it is read before it is saved
  { const fs = await import('node:fs'), os = await import('node:os'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-'));
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: pdf-forms\ndescription: Use when filling in PDF forms for customers.\n---\n\nFill each field from the task.\n');
    fs.writeFileSync(path.join(dir, 'fields.md'), '- name\n- date\n');
    await fresh('/workspace/workspace/Skills'); await settle(400);
    await p.click('[data-xsk="import"]'); await settle(300);
    const inp = await p.$('.xsk [data-xsk-in="folder"]'); await inp.evaluate((e) => e.removeAttribute('webkitdirectory')); await inp.uploadFile(path.join(dir, 'SKILL.md'), path.join(dir, 'fields.md')); await settle(900);
    ok(new URL(p.url()).pathname === '/workspace/workspace/Skills/new' && (await p.$eval('.xsk [data-xsk-ed="name"]', (e) => e.value)) === 'pdf-forms' && /fields\.md/.test(await main()), 'an uploaded folder opens in the editor with its SKILL.md and files, not saved yet');
    fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]));
    await fresh('/workspace/workspace/Skills'); await settle(400);
    await p.click('[data-xsk="import"]'); await settle(300);
    const inp2 = await p.$('.xsk [data-xsk-in="folder"]'); await inp2.evaluate((e) => e.removeAttribute('webkitdirectory')); await inp2.uploadFile(path.join(dir, 'SKILL.md'), path.join(dir, 'logo.png')); await settle(900);
    ok(new URL(p.url()).pathname === '/workspace/workspace/Skills' && /logo\.png is a binary file/.test(await p.evaluate(() => document.body.innerText)), 'a folder with a binary file is refused by name instead of being decoded into text'); }

  // Connect: a credential shown once, filled into each CLI's setup
  await fresh(`/workspace/workspace/Agents/${a.id}/Connect`);
  t = await main();
  ok(/Make a credential to fill this in/.test(t) && !/xtk_/.test(t), 'before a credential exists, the setup says to make one');
  await p.click('[data-xag="mint"]'); await settle(1000);
  const tok = a.creds[0].token; t = await main();
  ok(t.includes(tok) && /never shown again/.test(t), 'Make credential shows the secret once, and says so');
  ok(t.includes(`claude mcp add --transport http xeno ${base}/api/mcp --header "Authorization: Bearer ${tok}"`), 'the Claude Code command is filled in with the credential');
  await p.click('[data-xag="tab"][data-k="codex"]'); await settle(300);
  ok((await main()).includes(`export XENO_AGENT_TOKEN=${tok}`) && /bearer-token-env-var XENO_AGENT_TOKEN/.test(await main()), 'Codex uses an environment variable, not the command line');
  await p.click('[data-xag="place"][data-k="spawn"]'); await settle(300);
  ok((await main()).includes(`spawn profiles bind ${a.id}`) && /secure store/.test(await main()), 'Spawn binds a profile by the agent id');
  await fresh(`/workspace/workspace/Agents/${a.id}/Access`);
  ok(!(await main()).includes(tok) && /xtk_abcdefabcdef_…/.test(await main()), 'after leaving, the secret is never shown again — Access lists only its hint');

  // revoke (Access)
  await p.click('[data-xag="revoke"]'); await settle(400); await submit();
  ok(a.creds[0].revoked && /No live credential/.test(await main()), 'Revoke, after confirming, stops the credential');

  // Settings: webhook, signing secret shown once
  await fresh(`/workspace/workspace/Agents/${a.id}/Settings`);
  await p.click('[data-xag="webhook"]'); await settle(500); await fill(['https://agent.example.com/xeno']); await submit();
  let t2 = await main();
  ok(a.webhook === 'https://agent.example.com/xeno' && /whsec_SIGNING/.test(t2) && /never shown again/.test(t2), 'a webhook is saved and its signing secret shown once');
  await fresh(`/workspace/workspace/Agents/${a.id}/Settings`);
  t2 = await main();
  ok(/agent\.example\.com/.test(t2) && !/whsec_SIGNING/.test(t2), 'afterwards the address is listed and the secret is gone');

  // Settings: model, reasoning, tools — saved as a new version
  ok(/Model and tools/.test(await main()) && /CLI it runs in picks the model/.test(await main()), 'an agent with no runtime says the CLI chooses');
  await p.click('[data-xag="runtime"]'); await settle(500);
  await fill(['gpt-5.5', 'Read, Edit, XenoTaskComment', 'Bash']);
  await p.evaluate(() => [...document.querySelectorAll('.xd [data-f="effort"] [data-v]')].find((x) => x.dataset.v === 'high')?.click()); await settle(200);
  await submit();
  const rt = db.calls.filter((c) => c[0] === 'PATCH' && c[2].runtime).pop();
  ok(rt && rt[2].runtime.model === 'gpt-5.5' && rt[2].runtime.effort === 'high' && rt[2].runtime.tools.allow.join() === 'Read,Edit,XenoTaskComment' && rt[2].runtime.tools.deny.join() === 'Bash', 'Set saves model, reasoning and allowed/blocked tools');
  const t3 = await main();
  ok(/gpt-5\.5/.test(t3) && /High/.test(t3) && /Never these tools/.test(t3) && /Saved as version/.test(await p.evaluate(() => document.body.innerText)), 'the page shows how it runs, and says it is a new version');
  await p.click('[data-xag="runtime"]'); await settle(500);
  ok(await p.evaluate(() => document.querySelector('.xd input')?.value === 'gpt-5.5'), 'Change opens with the current values');
  await fill(['', '', '']); await p.evaluate(() => [...document.querySelectorAll('.xd [data-f="effort"] [data-v]')].find((x) => x.dataset.v === '')?.click()); await submit();
  ok(JSON.stringify(db.calls.filter((c) => c[0] === 'PATCH' && c[2].runtime).pop()[2].runtime) === '{}', 'clearing everything hands the choice back to the CLI');
  { const st = await main(); ok(/cloud runs, which record the version/i.test(st) && /Spending cap/.test(st) && /All 1 XENO services/.test(st), `Settings shows how each version did, its spending cap and its services in one line (${[/cloud runs, which record the version/i.test(st), /Spending cap/.test(st), /All 1 XENO services/.test(st)]})`); }

  // Settings: the spending cap
  await p.click('[data-xag="cap"]'); await settle(500); await fill(['250']); await submit();
  ok(db.calls.some(([m, u, b]) => m === 'PUT' && u === `/api/agents/${a.id}/spend-cap` && b.credits === 250) && a.cap === 250, 'a cap is saved in credits');
  await p.click('[data-xag="cap"]'); await settle(500); await fill(['']); await submit();
  ok(db.calls.some(([m, u, b]) => m === 'PUT' && u === `/api/agents/${a.id}/spend-cap` && b.credits === null) && a.cap === null, 'emptying it removes the cap');

  // Work: run it in the cloud on one of its tasks
  await fresh(`/workspace/workspace/Agents/${a.id}/Work`);
  ok(/Cloud runs/.test(await main()) && /no CLI, no computer of yours/.test(await main()), 'Work offers cloud runs, and says what they are');
  await p.click('.xag-runs [data-xag="run-cloud"]'); await settle(600);
  const offered = await p.evaluate(() => [...document.querySelectorAll('.xd [data-f="task"] [data-v]')].map((x) => x.dataset.v));
  ok(offered.includes('T-7') && !offered.includes('T-8'), 'Run offers only tasks in its projects');
  await submit();
  const started = db.calls.filter((c) => c[0] === 'POST' && /\/runs$/.test(c[1])).pop();
  ok(started && started[2].task === 'T-7' && started[2].budgetCredits === 50, 'it starts a run on the chosen task with the budget');
  await settle(500);
  ok(/T-7 · Queued/.test(await main()) && await p.$('[data-xag="stop-run"]'), 'the run shows on the page, live, with Stop');
  await p.click('[data-xag="stop-run"]'); await settle(900);
  ok(/T-7 · Stopped/.test(await main()) && /You stopped it/.test(await main()), 'Stop stops it and says so');

  // Hand it a task: T, from any tab, offers only its projects' tasks and hands one over
  await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.keyboard.press('t'); await settle(700);
  const offered2 = await p.evaluate(() => [...document.querySelectorAll('.xd [data-f="task"] [data-v]')].map((x) => x.dataset.v));
  ok(offered2.includes('T-7') && !offered2.includes('T-8'), 'T opens Hand it a task with only its projects’ tasks');
  await submit();
  ok(db.calls.some(([m, u, b]) => m === 'PATCH' && u === '/api/tasks/T-7' && b.delegateId === a.userId), 'it hands the task to the agent');

  // Access: ownership — a personal agent can be offered to a company, after confirming it is you
  await fresh(`/workspace/workspace/Agents/${a.id}/Access`);
  ok(/Owner and access/.test(await main()) && /You, personally/.test(await main()), 'Access says who owns it and who answers for it');
  await p.click('[data-xag="move"]'); await settle(500);
  await p.evaluate(() => document.querySelector('.xd [data-v="w-acme"], .xd [value="w-acme"]')?.click()); await submit();
  ok(db.calls.some(([m, u, b]) => m === 'POST' && u === `/api/agents/${a.id}/transfers` && b.workspaceId === 'w-acme'), 'Move to a company offers it to the chosen company (personal workspaces are not offered)');
  ok(/Offered to its new owner/.test(await main()), 'the pending move is shown on its page');
  // a company agent whose accountable admin left: paused, and an admin takes it over
  Object.assign(a, { owner: { kind: 'company', workspaceId: 'w-acme', name: 'Acme' }, accountable: { userId: 'u-bea', name: 'Bea' }, paused: 'needs_owner', transfers: [] });
  await fresh(`/workspace/workspace/Agents/${a.id}/Access`); let tt = await main();
  ok(/is paused/.test(tt) && /Nothing is lost/.test(tt) && /Owned by\s*Acme/.test(tt), 'a company agent whose accountable person left shows as paused, kept, owned by the company');
  await p.click('[data-xag="takeover"]'); await settle(500); await fill(['Bea left']); await submit();
  tt = await main();
  ok(!/is paused/.test(tt) && db.calls.some(([m, u, b]) => m === 'POST' && u.endsWith('/accountable') && b.note === 'Bea left'), 'Take over clears the pause and records why');
  await p.click('[data-xag="grant"]'); await settle(500);
  await p.evaluate(() => { document.querySelector('.xd [data-f="who"] [data-v="u-cal"]')?.click(); document.querySelector('.xd [data-f="right"] [data-v="runner"]')?.click(); }); await submit();
  ok(db.calls.some(([m, u]) => m === 'PUT' && u === `/api/agents/${a.id}/access/u-cal/runner`) && /Cal/.test(await main()), 'Give access grants a member one of the four rights, and lists them');
  // someone with only the run right sees no edit or delete
  Object.assign(a, { rights: { viewer: true, runner: true, editor: false, exporter: false, manage: false } });
  await fresh(`/workspace/workspace/Agents/${a.id}/Access`); tt = await main();
  ok(!(await p.$('[data-xag="edit"]')) && /You can\s*See, Run/.test(tt), 'a person who may only run it sees what they can do, and no Edit');
  await fresh(`/workspace/workspace/Agents/${a.id}/Settings`);
  ok(!(await p.$('[data-xag="delete"]')) && !(await p.$('[data-xag="cap"]')), 'and no Delete or spending cap in Settings');
  Object.assign(a, { owner: { kind: 'personal' }, accountable: { userId: 'u1', name: 'Me' }, paused: null, rights: ALL, people: [], history: [] });
  await fresh(`/workspace/workspace/Agents/${a.id}`);

  // edit keeps the id
  await p.click('[data-xag="edit"]'); await settle(500);
  await fill(['Ship Bot']); await submit();
  ok(a.name === 'Ship Bot' && new URL(p.url()).pathname.endsWith(a.id) && /Ship Bot/.test(await p.$eval('.crumbs', (e) => e.innerText)), 'renaming keeps its id address; the breadcrumb follows the new name');

  // delete (Settings), then the gone address
  await fresh(`/workspace/workspace/Agents/${a.id}/Settings`);
  await p.click('[data-xag="delete"]'); await settle(400); await submit();
  ok(!db.agents.length && new URL(p.url()).pathname === '/workspace/workspace/Agents', 'Delete, after confirming, removes it and returns to the list');
  await fresh(`/workspace/workspace/Agents/${a.id}`);
  ok(/This agent is gone/.test(await main()), 'an address to a deleted agent says it is gone, with a way back');
  await fresh('/workspace/workspace/Agents/Atlas');
  ok(/not valid/.test(await main()), 'an address by NAME is not a valid agent address');
  fail = true; await fresh('/workspace/workspace/Agents');
  ok(/could not be loaded/.test(await main()) && await p.$('[data-xag="retry"]'), 'a failed load says so and offers to try again'); fail = false;


  // ── EVERY STATE OF ONE AGENT'S PAGE (the redesign, 2026-10-24). Each status line must come from a measured field
  // (presence state / seenAt / runs) or say "never"; nothing shows a status nobody measured.
  const before = (ms) => new Date(Date.now() - ms).toISOString();
  const seed = (name, extra) => { const x = { id: 'agt_' + hex(), userId: 'x', name, description: '', createdAt: new Date().toISOString(), status: 'active', pids: [], creds: [], connections: [], ...extra }; db.agents.push(x); return x; };
  const sNew = seed('Fresh Bot', { pres: { state: 'new', label: 'Not connected yet', canTakeWork: false, seenAt: null } });
  const sNever = seed('Idle Bot', { creds: [{ id: 'c0', token: 'xtk_n', hint: 'xtk_n…', label: 'Credential', expiresAt: new Date(Date.now() + 864e5).toISOString(), lastUsedAt: null, createdAt: before(1000) }], pres: { state: 'cloud', label: 'Runs in the cloud', canTakeWork: true, seenAt: null } });
  const sRan = seed('Busy Bot', { pids: ['p-1111'], connections: [{ id: 'k1', client: 'Claude Code', createdAt: before(864e5), lastUsedAt: before(180e3), pausedAt: null }], pres: { state: 'online', label: 'Online', canTakeWork: true, seenAt: before(180e3), doing: { task: 'T-7', title: 'Ship the header', note: 'Header built; checking it at phone width', at: before(120e3) } },
    queue: [{ task: 'T-7', title: 'Ship the header', status: 'in_progress', at: before(120e3) }, { task: 'T-9', title: 'Fix the footer', status: 'in_review', at: before(600e3) }],
    needs: [{ kind: 'review', task: 'T-9', title: 'Fix the footer', at: before(600e3) }, { kind: 'asks', task: 'T-7', title: 'Ship the header', note: 'Which logo goes in the header?', at: before(60e3) }], spent: 12.5, cap: 100 });
  const sOff = seed('Away Bot', { connections: [{ id: 'k2', client: 'Codex', createdAt: before(5 * 864e5), lastUsedAt: before(2 * 864e5) }], pres: { state: 'offline', label: 'Offline — work waits until it connects', canTakeWork: false, seenAt: before(2 * 864e5) } });
  const sSus = seed('Kept Bot', { owner: { kind: 'company', workspaceId: 'w-acme', name: 'Acme' }, accountable: { userId: 'u-bea', name: 'Bea' }, paused: 'needs_owner', pres: { state: 'paused', label: 'Paused — needs an owner', canTakeWork: false, seenAt: null } });
  const sRo = seed('Shared Bot', { rights: { viewer: true, runner: false, editor: false, exporter: false, manage: false }, pres: { state: 'offline', label: 'Offline — work waits until it connects', canTakeWork: false, seenAt: before(3600e3) } });
  await p.setViewport({ width: 1440, height: 900 });
  const avail = () => p.$eval('.xag-id', (e) => e.innerText).catch(() => '');
  const one = (s) => s.replace(/\s+/g, ' '); const ce0 = cerrs.length;

  await fresh(`/workspace/workspace/Agents/${sNew.id}`); await shot('new');
  { const id = await avail(); ok(/Not connected yet/.test(id) && /Last seen never/.test(id) && !/Can take work/.test(id), `new: not connected, never seen (${one(id)})`); }
  ok(/Three steps and Fresh Bot starts working/.test(await main()), 'new: its Overview is the three steps');
  await fresh(`/workspace/workspace/Agents/${sNew.id}/Connect`);
  await p.click('[data-xag="place"][data-k="spawn"]'); await settle(300); await shot('spawn-tab');
  ok(!(await p.$('[data-xag="mint"]')) && !(await p.$('[data-xag-ttl]')), 'In Spawn shows no credential controls: Spawn makes its own');
  { const sp = await p.evaluate(() => { const e = document.querySelector('.xag-spawn'); if (!e) return null; const c = getComputedStyle(e); const l = getComputedStyle(e.querySelector('a.pg-btn')); return { display: c.display, pad: parseFloat(c.paddingTop), border: c.borderTopStyle, bg: c.backgroundColor, ink: l.color, btn: l.backgroundColor }; });
    ok(sp && sp.display === 'flex' && sp.pad > 0 && sp.border !== 'none' && sp.bg !== 'rgb(255, 255, 255)' && sp.ink !== sp.btn, `the Open in Spawn block is styled and its button label is readable (${JSON.stringify(sp)})`); }
  { const tx = await main(); const vs = [...new Set((tx.match(/XENO Spawn 0\.1\.0-rc\.\d+/g) || []))];
    ok(vs.length === 1 && vs[0] === 'XENO Spawn 0.1.0-rc.42' && (tx.match(/XENO Spawn 0\.1\.0-rc/g) || []).length >= 2, `every Spawn version on the page is the same one (${JSON.stringify(vs)})`); }
  await p.click('[data-xag="place"][data-k="cli"]'); await settle(300);
  ok(!!(await p.$('[data-xag="mint"]')) && !!(await p.$('[data-xag-ttl]')), 'On a computer keeps its credential controls');
  { const ov = await p.evaluate(async () => { const n = document.getElementById('xp-note'); if (!n) return { note: false };
      for (const el of [document.scrollingElement, ...document.querySelectorAll('#main, #main *')]) if (el && el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
      await new Promise((r) => setTimeout(r, 250)); const secs = [...document.querySelectorAll('#main .xag-one > *, #main .pg-sec')]; const last = secs[secs.length - 1].getBoundingClientRect(), nr = n.getBoundingClientRect();
      return { note: true, lastBottom: Math.round(last.bottom), noteTop: Math.round(nr.top) }; });
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `${TAG}-bottom.png`) }).catch(() => {});
    ok(ov.note && ov.lastBottom <= ov.noteTop, `the Preview note does not cover the last section (${JSON.stringify(ov)})`); }

  await fresh(`/workspace/workspace/Agents/${sNever.id}`); await shot('never-run');
  { const id = await avail(); ok(/Never run/.test(id) && /Last seen never/.test(id) && !/Can take work now/.test(id) && !/Runs in the cloud/.test(id), `never run: says so, not "runs in the cloud, can take work now" (${one(id)})`); }

  // working: Right now, Needs you, the message box, its place controls and its spend
  await fresh(`/workspace/workspace/Agents/${sRan.id}`); await shot('ran');
  { const id = await avail(); ok(/Online/.test(id) && /seen 3 min ago/.test(id) && /Can take work now/.test(id), `ran: online, seen 3 min ago (${one(id)})`); }
  t = await main();
  ok(/Right now/i.test(t) && /Ship the header/.test(t) && /Header built; checking it at phone width/.test(t) && /Live/i.test(t), 'Right now shows the task it is on and the note it last reported, marked live');
  { const n = await p.$$eval('.xag-needs .xag-att', (xs) => xs.map((x) => x.innerText.replace(/\s+/g, ' ')));
    ok(n.length === 2 && /Review T-9/i.test(n[0]) && /Asks “Which logo goes in the header\?”/i.test(n[1]), `Needs you lists its review and its question, each with its own button (${JSON.stringify(n)})`); }
  ok(/12\.5 credits/.test(t) && /of 100 cap/.test(t) && (await p.$$('.xag-spark i')).length === 14, 'its spend shows against its cap, with 14 days of bars');
  ok(/Waiting for it/.test(t) && /T-9 · Fix the footer/.test(t), 'what is waiting for it is listed');
  await p.click('[data-xag="watch"]'); await settle(700);
  ok(/Commands it runs on its own computer stay on that computer/.test(await main()) && /tasks_claim_task/.test(await main()), 'Watch shows its XENO tool calls, and says what XENO cannot see');
  await p.type('#xag-ask-in', 'Use the black logo'); await p.click('.xag-ask [type="submit"]'); await settle(700);
  ok((sRan.msgs || []).includes('Use the black logo') && /Sent on T-7/.test(await p.evaluate(() => document.body.innerText)), 'a message goes on the task it is on');
  await p.click('.xag-side [data-xag="pause"][data-id="k1"]'); await settle(900);
  ok(sRan.connections[0].pausedAt && /Paused/.test(await p.$eval('.xag-side', (e) => e.innerText)) && !!(await p.$('.xag-side [data-xag="resume"][data-id="k1"]')), 'Pause stops that one place it runs, and offers Resume');
  await p.click('.xag-side [data-xag="resume"][data-id="k1"]'); await settle(900);
  ok(!sRan.connections[0].pausedAt, 'Resume lets it run there again');
  await fresh(`/workspace/workspace/Agents/${sOff.id}`); await shot('offline');
  { const id = await avail(); ok(/Offline/.test(id) && /seen 2 d ago/.test(id) && /waits until it connects/.test(id), `offline: seen 2 d ago, work waits (${one(id)})`); }
  ok(!!(await p.$('#xag-ask-in[disabled]')), 'with no task, the message box says to hand it one first');
  await fresh(`/workspace/workspace/Agents/${sSus.id}`); await shot('suspended');
  { const first = await p.evaluate(() => { const c = document.querySelector('.xag-one'); return c && c.firstElementChild ? c.firstElementChild.className : ''; });
    ok(/xag-paused/.test(first) && /Can’t take work/.test(await avail()), `suspended: the pause comes first, it can’t take work (${first})`); }
  await fresh(`/workspace/workspace/Agents/${sRo.id}`); await shot('no-permission');
  ok(!(await p.$('#xag-ask-in')) && !(await p.$('[data-xag="edit"]')), 'no permission to run: no message box, no Edit');
  await fresh(`/workspace/workspace/Agents/${sRo.id}/Connect`);
  ok(!(await p.$('.xag-run')) && /not run it/.test(await main()), 'and Connect says it can see the agent but not run it');
  await fresh(`/workspace/workspace/Agents/${sRo.id}/Access`);
  ok(/You can\s*See/.test(await main()), 'Access says what you can do');

  if (process.env.AXE_PATH) {
    await fresh(`/workspace/workspace/Agents/${sRan.id}`); await p.addScriptTag({ path: process.env.AXE_PATH });
    const ax = await p.evaluate(async () => { const r = await window.axe.run(document.querySelector('#main'), { resultTypes: ['violations'] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, t: v.nodes.slice(0, 2).map((x) => x.target.join(' ')) })); });
    console.log('AXE', JSON.stringify(ax));
    ok(!ax.some((v) => v.impact === 'critical' || v.impact === 'serious'), `axe: no serious or critical violations (${ax.map((v) => v.id + ':' + v.impact).join(', ') || 'none'})`);
  } else console.log('SKIP axe — set AXE_PATH to an axe.min.js');

  await p.setViewport({ width: 390, height: 844 }); await fresh(`/workspace/workspace/Agents/${sRan.id}`); await shot('mobile-390');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1) && !!(await p.$('.xag-now')), 'at 390px the agent page fits and still leads with what it is doing now');
  ok(cerrs.length === ce0, `no console error on any agent state (${JSON.stringify(cerrs.slice(ce0, ce0 + 3))})`);
  db.agents = [];

  await p.setViewport({ width: 390, height: 844 }); await fresh('/workspace/workspace/Agents');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at phone width');

  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
  // the deleted-agent (404) and failed-load (500) steps provoke their responses on purpose; anything else is a defect
  { const real = cerrs.filter((m) => !/status of (404|500) .*\/api\/agents/.test(m) && !/status of 409 .*\/install-skill/.test(m)); ok(real.length === 0, 'no console errors beyond the deliberate 404/500/name-clash steps (' + JSON.stringify(real.slice(0, 3)) + ')'); }
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);
