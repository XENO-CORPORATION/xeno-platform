// agents-test — the workspace's Agents pages are the person's REAL agents (platform-agents.js), against a stand-in
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
const db = { agents: [], calls: [] };
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
  { const m = u.pathname.match(/^\/api\/agents\/(agt_[0-9a-f]{32})\/activity$/); if (m) return json(200, { success: true, agent: { id: m[1] }, presence: (db.agents.find((x) => x.id === m[1]) || {}).pres || { state: 'cloud', label: 'Runs in the cloud', canTakeWork: true }, items: [{ id: 'e1', at: new Date(Date.now() - 120000).toISOString(), kind: 'task', what: 'comment', task: 'T-7', title: 'Ship the notes', detail: 'Done, checked in the preview' }, { id: 'c1', at: new Date(Date.now() - 180000).toISOString(), kind: 'call', what: 'tasks_claim_task', detail: 'ok · 41 ms', where: 'Claude Code', ok: true }], next: null }); }
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
    if (!rest && method === 'PATCH') { if (b.runtime !== undefined) { a.runtime = b.runtime; a.version = (a.version || 1) + 1; } if (b.name) a.name = b.name; if (b.description !== undefined) a.description = b.description; return json(200, { success: true, agent: view(a) }); }
    if (!rest && method === 'DELETE') { db.agents = db.agents.filter((x) => x !== a); return json(200, { success: true, id: a.id, deleted: true }); }
    if (rest === '/credentials' && method === 'POST') { const c = { id: 'c' + a.creds.length, token: 'xtk_abcdefabcdef_' + hex(), hint: 'xtk_abcdefabcdef_…', label: b.label, scopes: ['tasks:read', 'tasks:write'], expiresAt: new Date(Date.now() + b.ttlHours * 3600e3).toISOString(), lastUsedAt: null, createdAt: new Date().toISOString() }; a.creds.push(c); return json(201, { success: true, credential: { id: c.id, token: c.token, expiresAt: c.expiresAt, scopes: c.scopes } }); }
    const cr = rest.match(/^\/credentials\/(.+)$/); if (cr && method === 'DELETE') { const c = a.creds.find((x) => x.id === cr[1]); c.revoked = true; return json(200, { success: true, revoked: true }); }
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
  if (u.pathname === '/api/tasks' && method === 'GET') return json(200, { success: true, tasks: [{ key: 'T-7', title: 'Ship the header', status: 'todo', project: { id: PROJ[0].id, name: PROJ[0].name } }, { key: 'T-8', title: 'Elsewhere', status: 'todo', project: { id: 'zz', name: 'Other' } }] });
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
  ok(/spawn profiles bind/.test(await main()) && /aria-selected="true"[^>]*data-k="spawn"/.test(await p.$eval('.xag-tabs', (e) => e.outerHTML).catch(() => '')), 'choosing this computer lands on its Spawn setup');
  await p.click('[data-xag="tab"][data-k="claude"]'); await settle(300);
  const a = db.agents[0];
  ok(a && a.name === 'Release Bot' && a.description === 'Takes release tasks and reports back', 'New agent creates it on the platform with its name and purpose');
  ok(new URL(p.url()).pathname === `/workspace/workspace/Agents/${a.id}`, `it opens at its id address (${new URL(p.url()).pathname})`);
  t = await main();
  ok(/Run Release Bot anywhere/.test(t) && /Works on/.test(t) && /Where it has run/.test(t) && /Credentials/.test(t), 'its page shows where it runs, what it works on, where it ran and its credentials');
  const crumb = await p.$eval('.crumbs', (e) => e.innerText).catch(() => '');
  ok(/Agents\s*\/\s*Release Bot/.test(crumb) && !crumb.includes(a.id), `the breadcrumb names it, never its id (${crumb.replace(/\s+/g, ' ')})`);

  // address: fresh tab, back/forward
  await fresh(`/workspace/workspace/Agents/${a.id}`);
  ok(/Run Release Bot anywhere/.test(await main()) && new URL(p.url()).pathname.endsWith(a.id), 'a fresh tab on the id address lands on the same agent, and the address keeps its id');
  await p.click('.crumbs a[data-crumb="Agents"]'); await settle();
  ok(/Release Bot/.test(await main()) && new URL(p.url()).pathname === '/workspace/workspace/Agents', 'the trail goes back to the list');
  await p.goBack(); await settle();
  ok(/Run Release Bot anywhere/.test(await main()), 'Back returns to the agent');

  // the status mark: a square with a small radius (never a circle), green and blinking while it works — pushed live
  await settle(900);
  const mark = await p.evaluate(() => { const d = document.querySelector('.xag-mono--lg .xag-dot'); if (!d) return null; const c = getComputedStyle(d); return { cls: d.className, radius: c.borderTopLeftRadius, w: c.width, bg: c.backgroundColor, anim: c.animationName }; });
  ok(mark && /xag-dot--working/.test(mark.cls) && parseFloat(mark.radius) > 0 && parseFloat(mark.radius) < parseFloat(mark.w) / 2 && mark.bg === 'rgb(34, 197, 94)' && mark.anim === 'xag-blink' && db.streamOpen >= 1, `the status mark is a green square that blinks while the agent works, pushed live (${JSON.stringify(mark)})`);
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  ok((await p.$eval('.xag-mono--lg .xag-dot', (d) => getComputedStyle(d).animationName)) === 'none', 'and it stops blinking for people who turn motion off');
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  // presence and activity
  ok((await p.$eval('[data-xag-presence]', (e) => e.dataset.xagPresence).catch(() => '')) === 'working' && /Working in the cloud/.test(await main()) && /Can take work now/.test(await main()), 'the agent says whether it can take work, from the server’s presence');
  ok(/Activity/.test(await main()) && /commented on\s*T-7/.test(await main()) && /tasks_claim_task/.test(await main()), 'its activity lists what it did on tasks and the tools it called');
  await fresh('/workspace/workspace');
  ok(!!(await p.$('#panel .side-dot.xag-dot--working')) && /Release Bot/.test(await p.$eval('#panel', (e) => e.innerText)) && parseFloat(await p.$eval('#panel .side-dot', (d) => getComputedStyle(d).borderTopLeftRadius)) < 4, 'the sidebar lists your agents with the same square status mark');
  { const g = await p.evaluate(() => { const row = [...document.querySelectorAll('#panel .row')].find((x) => x.querySelector('.side-dot')); const d = row.querySelector('.side-dot').getBoundingClientRect(), t = row.querySelector('.t').getBoundingClientRect(), r = row.getBoundingClientRect(); return { leftOfText: d.right <= t.left, inRowStart: d.left - r.left < 16, lowHalf: d.top >= t.top + t.height / 2 - 1 && d.bottom <= t.bottom, w: d.width }; });
    ok(g.leftOfText && g.inRowStart && g.lowHalf && g.w <= 7, `the sidebar mark is small, at the start of the row, before the name and level with its bottom (${JSON.stringify(g)})`); }
  // Overview's sidebar lists them too, and a row opens the agent's own page by its id
  await fresh('/workspace'); await settle(1500);
  { const side = await p.$eval('#panel', (e) => e.innerText).catch(() => '');
    ok(/Your agents/.test(side) && /Release Bot/.test(side) && !!(await p.$('#panel [data-ws-item] .side-dot')), `Overview's sidebar lists your agents with their status mark (${side.replace(/\s+/g, ' ').slice(0, 160)})`);
    await p.click(`#panel [data-ws-item="Agents/${a.id}"]`); await settle(900);
    ok(new URL(p.url()).pathname === `/workspace/workspace/Agents/${a.id}` && /Run Release Bot anywhere/.test(await main()), 'clicking it there opens the agent at its id address'); }
  await fresh(`/workspace/workspace/Agents/${a.id}`);

  // projects
  await p.click('[data-xag-proj="p-1111"]'); await settle(900);
  ok(db.calls.some(([m, u, b]) => m === 'PUT' && u === `/api/agents/${a.id}/projects/p-1111` && b.access === 'editor') && a.pids.includes('p-1111'), 'ticking a project gives it to the agent on the platform');

  // credential: shown once, filled into each CLI's setup
  t = await main();
  ok(/Make a credential to fill this in/.test(t) && !/xtk_/.test(t), 'before a credential exists, the setup says to make one');
  await p.click('[data-xag="mint"]'); await settle(1000);
  const tok = a.creds[0].token; t = await main();
  ok(t.includes(tok) && /never shown again/.test(t), 'New credential shows the secret once, and says so');
  ok(t.includes(`claude mcp add --transport http xeno ${base}/api/mcp --header "Authorization: Bearer ${tok}"`), 'the Claude Code command is filled in with the credential');
  await p.click('[data-xag="tab"][data-k="codex"]'); await settle(300);
  ok((await main()).includes(`export XENO_AGENT_TOKEN=${tok}`) && /bearer-token-env-var XENO_AGENT_TOKEN/.test(await main()), 'Codex uses an environment variable, not the command line');
  await p.click('[data-xag="tab"][data-k="spawn"]'); await settle(300);
  ok((await main()).includes(`spawn profiles bind ${a.id}`) && /secure store/.test(await main()), 'Spawn binds a profile by the agent id');
  await fresh(`/workspace/workspace/Agents/${a.id}`);
  ok(!(await main()).includes(tok) && /xtk_abcdefabcdef_…/.test(await main()), 'after leaving, the secret is never shown again — only its hint');

  // revoke
  await p.click('[data-xag="revoke"]'); await settle(400); await submit();
  ok(a.creds[0].revoked && /No live credential/.test(await main()), 'Revoke, after confirming, stops the credential');

  // webhook: where it hears about new work; the signing secret is shown once
  await p.click('[data-xag="webhook"]'); await settle(500); await fill(['https://agent.example.com/xeno']); await submit();
  let t2 = await main();
  ok(a.webhook === 'https://agent.example.com/xeno' && /whsec_SIGNING/.test(t2) && /never shown again/.test(t2), 'a webhook is saved and its signing secret shown once');
  await fresh(`/workspace/workspace/Agents/${a.id}`);
  t2 = await main();
  ok(/agent\.example\.com/.test(t2) && !/whsec_SIGNING/.test(t2), 'afterwards the address is listed and the secret is gone');

  // how it runs: model, reasoning, tools — saved as a new version
  ok(/Runs with/.test(await main()) && /CLI it runs in picks the model/.test(await main()), 'an agent with no runtime says the CLI chooses');
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

  // run it in the cloud on one of its tasks
  ok(/Runs in the cloud/.test(await main()) && /no CLI, no computer of yours/.test(await main()), 'the agent page offers cloud runs, and says what they are');
  if (!a.pids.length) { await p.evaluate(() => document.querySelector('.xag [data-xag-proj]')?.click()); await settle(500); }
  await p.click('[data-xag="run-cloud"]'); await settle(600);
  const offered = await p.evaluate(() => [...document.querySelectorAll('.xd [data-f="task"] [data-v]')].map((x) => x.dataset.v));
  ok(offered.includes('T-7') && !offered.includes('T-8'), 'Run offers only tasks in its projects');
  await submit();
  const started = db.calls.filter((c) => c[0] === 'POST' && /\/runs$/.test(c[1])).pop();
  ok(started && started[2].task === 'T-7' && started[2].budgetCredits === 50, 'it starts a run on the chosen task with the budget');
  await settle(500);
  ok(/T-7 · Queued/.test(await main()) && await p.$('[data-xag="stop-run"]'), 'the run shows on the page, live, with Stop');
  await p.click('[data-xag="stop-run"]'); await settle(900);
  ok(/T-7 · Stopped/.test(await main()) && /You stopped it/.test(await main()), 'Stop stops it and says so');

  // ownership: a personal agent can be offered to a company, after confirming it is you
  ok(/Owner and access/.test(await main()) && /You, personally/.test(await main()), 'the page says who owns it and who answers for it');
  await p.click('[data-xag="move"]'); await settle(500);
  await p.evaluate(() => document.querySelector('.xd [data-v="w-acme"], .xd [value="w-acme"]')?.click()); await submit();
  ok(db.calls.some(([m, u, b]) => m === 'POST' && u === `/api/agents/${a.id}/transfers` && b.workspaceId === 'w-acme'), 'Move to a company offers it to the chosen company (personal workspaces are not offered)');
  ok(/Offered to its new owner/.test(await main()), 'the pending move is shown on its page');
  // a company agent whose accountable admin left: paused, and an admin takes it over
  Object.assign(a, { owner: { kind: 'company', workspaceId: 'w-acme', name: 'Acme' }, accountable: { userId: 'u-bea', name: 'Bea' }, paused: 'needs_owner', transfers: [] });
  await fresh(`/workspace/workspace/Agents/${a.id}`); let tt = await main();
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT, fullPage: false });
  ok(/is paused/.test(tt) && /Nothing is lost/.test(tt) && /Owned by\s*Acme/.test(tt), 'a company agent whose accountable person left shows as paused, kept, owned by the company');
  await p.click('[data-xag="takeover"]'); await settle(500); await fill(['Bea left']); await submit();
  tt = await main();
  ok(!/is paused/.test(tt) && db.calls.some(([m, u, b]) => m === 'POST' && u.endsWith('/accountable') && b.note === 'Bea left'), 'Take over clears the pause and records why');
  await p.click('[data-xag="grant"]'); await settle(500);
  await p.evaluate(() => { document.querySelector('.xd [data-f="who"] [data-v="u-cal"]')?.click(); document.querySelector('.xd [data-f="right"] [data-v="runner"]')?.click(); }); await submit();
  ok(db.calls.some(([m, u]) => m === 'PUT' && u === `/api/agents/${a.id}/access/u-cal/runner`) && /Cal/.test(await main()), 'Give access grants a member one of the four rights, and lists them');
  // someone with only the run right sees no edit or delete
  Object.assign(a, { rights: { viewer: true, runner: true, editor: false, exporter: false, manage: false } });
  await fresh(`/workspace/workspace/Agents/${a.id}`); tt = await main();
  ok(!(await p.$('[data-xag="edit"]')) && !(await p.$('[data-xag="delete"]')) && /You can\s*See, Run/.test(tt), 'a person who may only run it sees what they can do, and no Edit or Delete');
  Object.assign(a, { owner: { kind: 'personal' }, accountable: { userId: 'u1', name: 'Me' }, paused: null, rights: ALL, people: [], history: [] });
  await fresh(`/workspace/workspace/Agents/${a.id}`);

  // edit keeps the id
  await p.click('[data-xag="edit"]'); await settle(500);
  await fill(['Ship Bot']); await submit();
  ok(a.name === 'Ship Bot' && new URL(p.url()).pathname.endsWith(a.id) && /Ship Bot/.test(await p.$eval('.crumbs', (e) => e.innerText)), 'renaming keeps its id address; the breadcrumb follows the new name');

  // delete, then the gone address
  await p.click('[data-xag="delete"]'); await settle(400); await submit();
  ok(!db.agents.length && new URL(p.url()).pathname === '/workspace/workspace/Agents', 'Delete, after confirming, removes it and returns to the list');
  await fresh(`/workspace/workspace/Agents/${a.id}`);
  ok(/This agent is gone/.test(await main()), 'an address to a deleted agent says it is gone, with a way back');
  await fresh('/workspace/workspace/Agents/Atlas');
  ok(/not valid/.test(await main()), 'an address by NAME is not a valid agent address');
  fail = true; await fresh('/workspace/workspace/Agents');
  ok(/could not be loaded/.test(await main()) && await p.$('[data-xag="retry"]'), 'a failed load says so and offers to try again'); fail = false;


  // ── EVERY STATE OF ONE AGENT'S PAGE (the redesign, 2026-10-18). Each status line must come from a measured field
  // (presence state / seenAt / runs) or say "never"; nothing shows a status nobody measured.
  const before = (ms) => new Date(Date.now() - ms).toISOString();
  const seed = (name, extra) => { const x = { id: 'agt_' + hex(), userId: 'x', name, description: '', createdAt: new Date().toISOString(), status: 'active', pids: [], creds: [], connections: [], ...extra }; db.agents.push(x); return x; };
  const sNew = seed('Fresh Bot', { pres: { state: 'new', label: 'Not connected yet', canTakeWork: false, seenAt: null } });
  const sNever = seed('Idle Bot', { creds: [{ id: 'c0', token: 'xtk_n', hint: 'xtk_n…', label: 'Credential', expiresAt: new Date(Date.now() + 864e5).toISOString(), lastUsedAt: null, createdAt: before(1000) }], pres: { state: 'cloud', label: 'Runs in the cloud', canTakeWork: true, seenAt: null } });
  const sRan = seed('Busy Bot', { connections: [{ id: 'k1', client: 'Claude Code', createdAt: before(864e5), lastUsedAt: before(180e3) }], pres: { state: 'online', label: 'Online', canTakeWork: true, seenAt: before(180e3) } });
  const sOff = seed('Away Bot', { connections: [{ id: 'k2', client: 'Codex', createdAt: before(5 * 864e5), lastUsedAt: before(2 * 864e5) }], pres: { state: 'offline', label: 'Offline — work waits until it connects', canTakeWork: false, seenAt: before(2 * 864e5) } });
  const sSus = seed('Kept Bot', { owner: { kind: 'company', workspaceId: 'w-acme', name: 'Acme' }, accountable: { userId: 'u-bea', name: 'Bea' }, paused: 'needs_owner', pres: { state: 'paused', label: 'Paused — needs an owner', canTakeWork: false, seenAt: null } });
  const sRo = seed('Shared Bot', { rights: { viewer: true, runner: false, editor: false, exporter: false, manage: false }, pres: { state: 'offline', label: 'Offline — work waits until it connects', canTakeWork: false, seenAt: before(3600e3) } });
  await p.setViewport({ width: 1440, height: 900 });
  const avail = () => p.$eval('.xag-id', (e) => e.innerText).catch(() => '');
  const one = (s) => s.replace(/\s+/g, ' '); const ce0 = cerrs.length;

  await fresh(`/workspace/workspace/Agents/${sNew.id}`); await shot('new');
  { const id = await avail(); ok(/Not connected yet/.test(id) && /Last seen never/.test(id) && !/Can take work/.test(id), `new: not connected, never seen (${one(id)})`); }
  { const order = await p.evaluate(() => { const t = document.querySelector('#main').innerText; return ['Run Fresh Bot anywhere', 'Where it has run', 'Works on', 'Runs in the cloud', 'Activity', 'Instructions', 'Owner and access', 'Credentials'].map((s) => t.indexOf(s)); });
    ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), `the page reads: run it, where it ran, give it work, settings, access (${order})`); }
  await p.click('[data-xag="tab"][data-k="spawn"]'); await settle(300); await shot('spawn-tab');
  ok(!(await p.$('[data-xag="mint"]')) && !(await p.$('[data-xag-ttl]')), 'the Spawn tab shows no credential controls: Spawn makes its own');
  { const sp = await p.evaluate(() => { const e = document.querySelector('.xag-spawn'); if (!e) return null; const c = getComputedStyle(e); const l = getComputedStyle(e.querySelector('a.pg-btn')); return { display: c.display, pad: parseFloat(c.paddingTop), border: c.borderTopStyle, bg: c.backgroundColor, ink: l.color, btn: l.backgroundColor }; });
    ok(sp && sp.display === 'flex' && sp.pad > 0 && sp.border !== 'none' && sp.bg !== 'rgb(255, 255, 255)' && sp.ink !== sp.btn, `the Open in Spawn block is styled and its button label is readable (${JSON.stringify(sp)})`); }
  { const tx = await main(); const vs = [...new Set((tx.match(/XENO Spawn 0\.1\.0-rc\.\d+/g) || []))];
    ok(vs.length === 1 && vs[0] === 'XENO Spawn 0.1.0-rc.42' && (tx.match(/XENO Spawn 0\.1\.0-rc/g) || []).length >= 2, `every Spawn version on the page is the same one (${JSON.stringify(vs)})`); }
  await p.click('[data-xag="tab"][data-k="claude"]'); await settle(300);
  ok(!!(await p.$('[data-xag="mint"]')) && !!(await p.$('[data-xag-ttl]')), 'the Claude Code tab keeps its credential controls');
  { const ov = await p.evaluate(async () => { const n = document.getElementById('xp-note'); if (!n) return { note: false };
      for (const el of [document.scrollingElement, ...document.querySelectorAll('#main, #main *')]) if (el && el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
      await new Promise((r) => setTimeout(r, 250)); const secs = [...document.querySelectorAll('#main .pg-sec')]; const last = secs[secs.length - 1].getBoundingClientRect(), nr = n.getBoundingClientRect();
      return { note: true, lastBottom: Math.round(last.bottom), noteTop: Math.round(nr.top) }; });
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `${TAG}-bottom.png`) }).catch(() => {});
    ok(ov.note && ov.lastBottom <= ov.noteTop, `the Preview note does not cover the last section (${JSON.stringify(ov)})`); }

  await fresh(`/workspace/workspace/Agents/${sNever.id}`); await shot('never-run');
  { const id = await avail(); ok(/Never run/.test(id) && /Last seen never/.test(id) && !/Can take work now/.test(id) && !/Runs in the cloud/.test(id), `never run: says so, not "runs in the cloud, can take work now" (${one(id)})`); }
  await fresh(`/workspace/workspace/Agents/${sRan.id}`); await shot('ran');
  { const id = await avail(); ok(/Online/.test(id) && /seen 3 min ago/.test(id) && /Can take work now/.test(id), `ran: online, seen 3 min ago (${one(id)})`); }
  await fresh(`/workspace/workspace/Agents/${sOff.id}`); await shot('offline');
  { const id = await avail(); ok(/Offline/.test(id) && /seen 2 d ago/.test(id) && /waits until it connects/.test(id), `offline: seen 2 d ago, work waits (${one(id)})`); }
  await fresh(`/workspace/workspace/Agents/${sSus.id}`); await shot('suspended');
  { const first = await p.evaluate(() => { const c = document.querySelector('.pg-cols--item > div'); return c && c.firstElementChild ? c.firstElementChild.className : ''; });
    ok(/xag-paused/.test(first) && /Can’t take work/.test(await avail()), `suspended: the pause comes first, it can’t take work (${first})`); }
  await fresh(`/workspace/workspace/Agents/${sRo.id}`); await shot('no-permission');
  ok(!(await p.$('.xag-run')) && !(await p.$('[data-xag="edit"]')) && /You can\s*See/.test(await main()), 'no permission to run: no run section, no Edit, says what you can do');

  if (process.env.AXE_PATH) {
    await fresh(`/workspace/workspace/Agents/${sRan.id}`); await p.addScriptTag({ path: process.env.AXE_PATH });
    const ax = await p.evaluate(async () => { const r = await window.axe.run(document.querySelector('#main'), { resultTypes: ['violations'] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, t: v.nodes.slice(0, 2).map((x) => x.target.join(' ')) })); });
    console.log('AXE', JSON.stringify(ax));
    ok(!ax.some((v) => v.impact === 'critical' || v.impact === 'serious'), `axe: no serious or critical violations (${ax.map((v) => v.id + ':' + v.impact).join(', ') || 'none'})`);
  } else console.log('SKIP axe — set AXE_PATH to an axe.min.js');

  await p.setViewport({ width: 390, height: 844 }); await fresh(`/workspace/workspace/Agents/${sRan.id}`); await shot('mobile-390');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1) && !!(await p.$('.xag-run')), 'at 390px the agent page fits and still leads with running it');
  ok(cerrs.length === ce0, `no console error on any agent state (${JSON.stringify(cerrs.slice(ce0, ce0 + 3))})`);
  db.agents = [];

  await p.setViewport({ width: 390, height: 844 }); await fresh('/workspace/workspace/Agents');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at phone width');

  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
  // the deleted-agent (404) and failed-load (500) steps provoke their responses on purpose; anything else is a defect
  { const real = cerrs.filter((m) => !/status of (404|500) .*\/api\/agents/.test(m)); ok(real.length === 0, 'no console errors beyond the deliberate 404/500 steps (' + JSON.stringify(real.slice(0, 3)) + ')'); }
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);
