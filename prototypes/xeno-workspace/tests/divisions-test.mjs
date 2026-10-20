// divisions-test — the workspace's Divisions pages and the division on an agent, on the platform, against a stand-in
// /api that keeps the server's rules (a project and an agent in different divisions cannot meet).
// Proves: first-run explainer, create (top level and inside), an org chart, a division page by id that survives a
// fresh tab and Back, the breadcrumb names it, set a head with a reason, move an agent and a project in, an agent
// page shows its division and only lets you give it projects in that division, instructions save as a new version,
// archive, the sidebar lists the real divisions, and an address by NAME is not a division address.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const PORT = 5202, base = 'http://127.0.0.1:' + PORT;
const USER = { id: 'u1', username: 'me', email: 'me@x.test', display_name: 'Me', avatar_url: null, email_verified: true };
let failed = 0;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]);
const hex = () => [...Array(32)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const WS = uuid();
const db = { objs: [], runs: [], hiddenProjects: 1, lends: [], offers: [], calls: [], divs: [], proj: [{ id: uuid(), name: 'Website', div: null }, { id: uuid(), name: 'Brand film', div: null }], agents: [], agentProj: {} };
const ad = (a) => ({ id: a.id, userId: a.userId, name: a.name, description: a.description, division: a.div ? { id: a.div, name: db.divs.find((d) => d.id === a.div).name, archived: false } : null,
  workspace: { id: WS, name: 'Me', personal: true }, instructions: a.versions[0].instructions, version: a.versions[0].version, versions: a.versions, createdAt: a.createdAt, status: 'active',
  projects: (db.agentProj[a.id] || []).map((pid) => { const p = db.proj.find((x) => x.id === pid); return { id: p.id, name: p.name, access: 'editor', division: p.div ? { id: p.div, name: db.divs.find((d) => d.id === p.div).name } : null }; }),
  credentials: [], connections: [], lentTo: db.lends.filter((l) => l.agent === a.id && l.state !== 'revoked').map((l) => ({ id: l.id, state: l.state, workspace: { id: WS, name: 'Me' }, division: { id: l.div, name: db.divs.find((d) => d.id === l.div).name }, acceptedAt: new Date().toISOString() })) });
const dd = (d) => ({ id: d.id, workspaceId: WS, parentId: d.parent, key: d.name.toLowerCase(), name: d.name, lifecycle: d.archived ? 'archived' : 'active', revision: 1,
  head: d.head ? { id: d.head, name: d.headName, kind: d.headKind } : null, createdAt: new Date().toISOString(), archivedAt: null,
  agents: db.agents.filter((a) => a.div === d.id).length, projects: db.proj.filter((p) => p.div === d.id).length });

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
  db.calls.push([method, u.pathname, b]);
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  const path = u.pathname;
  if (path === '/api/auth/me') return json(200, { success: true, user: USER });
  if (path === '/api/tasks/projects') return json(200, { success: true, projects: db.proj.map((x) => ({ id: x.id, name: x.name, canEdit: true })) });
  if (path === '/api/mcp/services') return json(200, { success: true, services: [{ category: 'tasks', title: 'Tasks', tools: 10 }] });
  if (path === `/api/workspaces/${WS}/members`) return json(200, { success: true, members: [{ user_id: 'u1', display_name: 'Me' }] });
  if (path === '/api/divisions' && method === 'GET') return json(200, { success: true, workspaceId: WS, canManage: true, divisions: db.divs.filter((d) => u.searchParams.get('archived') === '1' || !d.archived).map(dd) });
  if (path === '/api/divisions' && method === 'POST') { const d = { id: uuid(), name: b.name, parent: b.parentId || null, archived: false }; db.divs.push(d); return json(201, { success: true, division: dd(d) }); }
  const pm = path.match(/^\/api\/divisions\/projects\/(.+)$/);
  if (pm) { const pr = db.proj.find((x) => x.id === pm[1]); pr.div = b.divisionId; let removed = 0; for (const a of db.agents) { const l = db.agentProj[a.id] || []; if (l.includes(pr.id) && a.div !== pr.div) { db.agentProj[a.id] = l.filter((x) => x !== pr.id); removed++; } } return json(200, { success: true, projectId: pr.id, division: null, agentsRemoved: removed }); }
  const bm = path.match(/^\/api\/divisions\/([0-9a-f-]{36})\/agent-budget$/);
  if (bm) {
    if (method === 'PUT') db.budget = { limitCredits: b.credits, spentCredits: 12.5, leftCredits: b.credits - 12.5, windowDays: b.windowDays, autoApprove: b.autoApprove };
    return json(200, { success: true, budget: db.budget || null, spend: db.budget ? [{ agent: { id: 'agt_' + 'a'.repeat(32), name: 'Pixel Bot' }, kind: 'image', credits: 12.5, released: false, at: new Date().toISOString() }] : [], canManage: true });
  }
  // the division HOME: the server decides every row; the stand-in answers as it does, with one project closed
  const hm = path.match(/^\/api\/divisions\/([0-9a-f-]{36})\/home$/);
  if (hm) {
    const d = db.divs.find((x) => x.id === hm[1]); if (!d) return json(404, { success: false, code: 'division_not_found' });
    return json(200, { success: true, state: 'fresh', revision: 1, home: { id: d.id, workspaceId: WS, name: d.name, canManage: true, head: d.head ? { id: d.head, name: d.headName, kind: 'human' } : null,
      teams: [], directMembers: d.head ? [{ id: d.head, name: d.headName, kind: 'human', relation: 'editor', isHead: true }] : [],
      agents: [], objectives: db.objs.filter((o) => o.div === d.id), runs: { rows: db.runs.filter((r) => r.div === d.id && !r.stopped), hidden: 1 },
      spend: { budget: db.budget || null, ledger: [] }, funding: { rows: [], hidden: 0 }, handoffs: { rows: [], hidden: 0 }, decisions: d.reason ? [{ id: uuid(), kind: 'member.promote', by: 'Me', rationale: d.reason, at: new Date().toISOString() }] : [],
      projects: { rows: db.proj.filter((x) => x.div === d.id).map((x) => ({ id: x.id, name: x.name })), hidden: db.hiddenProjects } } });
  }
  // canvases: a division opens as a canvas of live workforce cards (the server's layoutMap shape); one card is closed
  if (path === '/api/canvases/open-as') {
    const d = db.divs.find((x) => x.id === b.id);
    if (!db.map) { const gone = uuid(); db.map = { id: uuid(), name: `${d.name} — map`, revision: '1', area: null, project: null, can: { edit: true, delete: true },
      content: { nodes: [{ id: 'root-division', type: 'xeno-ref', ref: { kind: 'division', id: d.id }, x: 0, y: 0, width: 300, height: 120 },
        { id: 'project-1', type: 'xeno-ref', ref: { kind: 'project', id: db.proj[1].id }, x: 0, y: 220, width: 300, height: 120 },
        { id: 'project-2', type: 'xeno-ref', ref: { kind: 'project', id: gone }, x: 0, y: 360, width: 300, height: 120 },
        { id: 'objective-1', type: 'xeno-ref', ref: { kind: 'objective', id: db.objs[0].id }, x: 380, y: 220, width: 280, height: 120 }], edges: [] },
      records: { tasks: {}, files: {}, chats: {}, runs: {}, divisions: { [d.id]: { id: d.id, name: d.name, status: 'active', head: 'Me', agents: 1, projects: 1, url: `/workspace/divisions/${d.id}` } },
        projects: { [db.proj[1].id]: { id: db.proj[1].id, name: 'Brand film', status: 'active', openTasks: 3, doneTasks: 1, url: `/workspace/projects/${db.proj[1].id}` }, [gone]: { id: gone, missing: true } },
        objectives: { [db.objs[0].id]: { id: db.objs[0].id, title: db.objs[0].title, status: 'open', goals: 2, goalsDone: 1 } } } };
      db.mapCalls = 0; }
    db.mapCalls++; return json(db.mapCalls === 1 ? 201 : 200, { success: true, created: db.mapCalls === 1, canvas: db.map });
  }
  if (db.map && path === `/api/canvases/${db.map.id}`) return json(200, { success: true, canvas: db.map });
  if (path === '/api/canvases') return json(200, { success: true, canvases: db.map ? [{ id: db.map.id, name: db.map.name, revision: '1', items: 4 }] : [] });
  if (path === '/api/workforce/coordination/objectives') { const o = { id: uuid(), div: b.divisionId, title: b.title, successEvidence: b.successEvidence, status: 'open', owner: { id: 'u1', name: 'Me' }, windowStart: b.windowStart, windowEnd: b.windowEnd, goals: 0, goalsDone: 0, progress: 0 }; db.objs.push(o); return json(200, { success: true, result: { objectiveId: o.id } }); }
  if (path === '/api/workforce/run-admissions/revoke') { const r = db.runs.find((x) => x.id === b.admissionId); r.stopped = true; return json(200, { success: true, result: { revoked: true } }); }
  const dm = path.match(/^\/api\/divisions\/([0-9a-f-]{36})(\/archive)?$/);
  if (dm) {
    const d = db.divs.find((x) => x.id === dm[1]); if (!d) return json(404, { success: false, error: 'Division not found', code: 'division_not_found' });
    if (dm[2]) { d.archived = true; }
    else if (method === 'PATCH') { if (b.name) d.name = b.name; if ('headId' in b) { d.head = b.headId; d.headName = 'Me'; d.headKind = 'human'; d.reason = b.reason; } }
    const full = { ...dd(d), canManage: true, agentsList: db.agents.filter((a) => a.div === d.id).map((a) => ({ id: a.id, name: a.name, description: a.description })),
      projectsList: db.proj.filter((x) => x.div === d.id).map((x) => ({ id: x.id, name: x.name })), children: db.divs.filter((x) => x.parent === d.id && !x.archived).map(dd), parent: d.parent ? dd(db.divs.find((x) => x.id === d.parent)) : null };
    return json(200, { success: true, division: full });
  }
  if (path === '/api/agents/lends/inbox') return json(200, { success: true, offers: db.offers });
  const lm = path.match(/^\/api\/agents\/lends\/([0-9a-f-]{36})\/(accept|decline|revoke)$/);
  if (lm) { const o = db.offers.find((x) => x.id === lm[1]); if (o) { o.state = lm[2] === 'accept' ? 'accepted' : 'revoked'; db.offers = db.offers.filter((x) => x !== o); return json(200, { success: true, lend: o }); } const l = db.lends.find((x) => x.id === lm[1]); l.state = 'revoked'; return json(200, { success: true, lend: { id: l.id, state: 'revoked' } }); }
  if (path === '/api/agents' && method === 'GET') return json(200, { success: true, agents: db.agents.map(ad) });
  if (path === '/api/agents' && method === 'POST') { const a = { id: 'agt_' + hex(), userId: uuid(), name: b.name, description: b.description || '', div: b.divisionId || null, createdAt: new Date().toISOString(), versions: [{ version: 1, instructions: '', hash: 'a'.repeat(64), createdAt: new Date().toISOString() }] }; db.agents.push(a); return json(201, { success: true, agent: ad(a) }); }
  const am = path.match(/^\/api\/agents\/(agt_[0-9a-f]{32})(\/.*)?$/);
  if (am) {
    const a = db.agents.find((x) => x.id === am[1]); if (!a) return json(404, { success: false, code: 'agent_not_found' });
    const rest = am[2] || '';
    if (rest === '/lend') { db.lends.push({ id: uuid(), agent: a.id, div: b.divisionId, state: 'accepted' }); return json(201, { success: true, agent: ad(a) }); }
    if (rest === '/division') { a.div = b.divisionId; db.agentProj[a.id] = (db.agentProj[a.id] || []).filter((pid) => db.proj.find((x) => x.id === pid).div === a.div); return json(200, { success: true, agent: ad(a) }); }
    if (rest === '/project-choices') return json(200, { success: true, projects: db.proj.map((x) => ({ id: x.id, name: x.name, admin: true, division: x.div ? { id: x.div, name: db.divs.find((d) => d.id === x.div).name } : null, canGive: x.div === a.div || db.lends.some((l) => l.agent === a.id && l.div === x.div && l.state === 'accepted') })) });
    const pr = rest.match(/^\/projects\/(.+)$/);
    if (pr) { const x = db.proj.find((y) => y.id === pr[1]); if (method === 'PUT') { if (x.div !== a.div) return json(409, { success: false, code: 'division_mismatch', error: 'That project is in another division' }); (db.agentProj[a.id] = db.agentProj[a.id] || []).push(x.id); } else db.agentProj[a.id] = (db.agentProj[a.id] || []).filter((y) => y !== x.id); return json(200, { success: true, agent: ad(a) }); }
    if (!rest && method === 'PATCH') { if (b.instructions !== undefined) a.versions.unshift({ version: a.versions[0].version + 1, instructions: b.instructions, hash: 'b'.repeat(64), createdAt: new Date().toISOString() }); return json(200, { success: true, agent: ad(a) }); }
    if (!rest) return json(200, { success: true, agent: ad(a) });
  }
  if (path === '/api/notifications') return json(200, { success: true, unread: 0, items: [] });
  if (path === '/api/workspace/search') return json(200, { success: true, results: [], counts: {} });
  if (path === '/api/workspace/needs') return json(200, { success: true, items: [] });
  return json(200, { success: true });
});
const main = () => p.$eval('#main', (e) => e.innerText).catch(() => '');
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const fresh = async (url) => { await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await settle(1900); };
const fill = async (vals) => { await p.evaluate((v) => { const fs = [...document.querySelectorAll('.xd input:not([type=hidden]), .xd textarea')]; fs.forEach((f, i) => { if (v[i] !== undefined) { f.value = v[i]; f.dispatchEvent(new Event('input', { bubbles: true })); } }); }, vals); };
const choose = async (label) => { await p.evaluate((l) => { const r = [...document.querySelectorAll('.xd [role="radio"]')].find((x) => x.innerText.trim().startsWith(l)); r && r.click(); }, label); await settle(150); };
const submit = async () => { await p.evaluate(() => (document.querySelector('.xd [data-xd-submit]') || document.querySelector('.xd [data-xd-ok]'))?.click()); await settle(1300); };

try {
  await fresh('/workspace/divisions'); let t = await main();
  ok(/No divisions — and that’s fine/.test(t) && /real boundary/.test(t) && !/Studio|Office/.test(t), 'with none, Divisions explains what a division is — and shows no sample departments');

  await p.click('[data-xdv="new"]'); await settle(500); await fill(['Creative']); await submit();
  const creative = db.divs.find((d) => d.name === 'Creative');
  ok(creative && new URL(p.url()).pathname === `/workspace/divisions/${creative.id}`, 'New division creates it and opens it at its id');
  const crumb = await p.$eval('.crumbs', (e) => e.innerText).catch(() => '');
  ok(/Divisions\s*\/\s*Creative/.test(crumb) && !crumb.includes(creative.id), `the breadcrumb names it, never its id (${crumb.replace(/\s+/g, ' ')})`);
  await p.click('[data-xdv="new-inside"]'); await settle(500); await fill(['Film']); await submit();
  const film = db.divs.find((d) => d.name === 'Film');
  ok(film && film.parent === creative.id, 'a division is created inside another');

  await fresh('/workspace/divisions'); t = await main();
  ok(/Creative/.test(t) && /Film/.test(t) && /never reaches the divisions inside it/.test(t), 'the org chart shows both, and says a division is a boundary');
  const side = await p.$eval('#panel', (e) => e.innerText).catch(() => '');
  ok(/Creative/.test(side), 'the sidebar lists the real divisions');

  // head, with a reason
  await fresh(`/workspace/divisions/${creative.id}`);
  await p.click('[data-xdv="head"]'); await settle(500); await choose('Me'); await fill(['Leads the studio']); await submit();
  const patch = db.calls.find(([m, u, b]) => m === 'PATCH' && u === `/api/divisions/${creative.id}` && 'headId' in b);
  ok(patch && patch[2].headId === 'u1' && patch[2].reason === 'Leads the studio', 'Set head sends the head and the recorded reason');

  // the agent budget: none, then set to 100 a month, started within it
  ok(/Agent budget/.test(await main()) && /No budget/.test(await main()), 'a division with no agent budget says what that means');
  await p.click('[data-xdv="budget"]'); await settle(500); await fill(['100']);
  await p.evaluate(() => document.querySelector('.xd [data-f="auto"] [data-v="auto"]')?.click()); await submit();
  const put = db.calls.find(([m, u]) => m === 'PUT' && u === `/api/divisions/${creative.id}/agent-budget`);
  ok(put && put[2].credits === 100 && put[2].windowDays === 30 && put[2].autoApprove === true, 'Set a budget sends 100 credits a month, started within it');
  ok(/12\.5 of 100 credits/.test(await main()) && /Pixel Bot/.test(await main()) && /start at once/.test(await main()), 'the page shows what was used, by which agent, and how images are approved');

  // move a project in
  await p.click('[data-xdv="add-project"]'); await settle(500); await choose('Brand film'); await submit();
  ok(db.proj.find((x) => x.name === 'Brand film').div === creative.id && /Brand film/.test(await main()), 'a project is moved into the division');

  // an agent in the division
  await fresh('/workspace/workspace/Agents');
  await p.click('[data-xag="new"]'); await settle(500); await fill(['Cutter', 'Edits films']); await choose('Creative'); await submit();
  const ag = db.agents[0];
  ok(ag && ag.div === creative.id, 'a new agent can be created straight into a division');
  if (!new URL(p.url()).pathname.endsWith(ag.id)) await fresh(`/workspace/workspace/Agents/${ag.id}`); t = await main();
  ok(/Division/.test(t) && /Cutter works only on Creative’s projects/.test(t), 'its page says which division it is in and what that means');
  const film2 = await p.$('[data-xag-proj] '); void film2;
  const disabled = await p.$$eval('[data-xag-proj]', (xs) => xs.map((x) => [x.closest('label').innerText.split('\n')[0], x.disabled]));
  ok(disabled.some(([n, d]) => /Website/.test(n) && d) && disabled.some(([n, d]) => /Brand film/.test(n) && !d), `only the project in its division can be given (${JSON.stringify(disabled)})`);
  await p.$eval(`[data-xag-proj="${db.proj.find((x) => x.name === 'Brand film').id}"]`, (x) => { x.scrollIntoView({ block: 'center' }); x.click(); }); await settle(900);
  ok((db.agentProj[ag.id] || []).length === 1, 'giving it the Creative project works');

  // instructions -> a new version
  await p.click('[data-xag="instr-edit"]'); await settle(300);
  await p.evaluate(() => { const t = document.querySelector('.xag-instr textarea'); t.value = 'Cut to the beat.'; });
  await p.evaluate(() => document.querySelector('.xag-instr button[type="submit"]').click()); await settle(1000);
  ok(ag.versions[0].version === 2 && /Cut to the beat/.test(await main()) && /version 2/.test(await main()), 'saving instructions makes version 2 and shows it');

  // move the agent out: its project goes
  await p.click('[data-xag="division"]'); await settle(500); await choose('No division'); await submit();
  ok(ag.div === null && !(db.agentProj[ag.id] || []).length, 'moving it out of the division takes away its Creative project');

  // lend it to Creative: it keeps its own division (none) and may take Creative's project
  await p.click('[data-xag="lend"]'); await settle(500); await choose('Creative'); await submit();
  ok(db.lends.length === 1 && db.lends[0].div === creative.id && /Also works in[\s\S]*Creative[\s\S]*working there/.test(await main()), 'Lend it adds Creative under Also works in');
  const canNow = await p.$$eval('[data-xag-proj]', (xs) => xs.map((x) => [x.closest('label').innerText.split('\n')[0], x.disabled]));
  ok(canNow.some(([n, d]) => /Brand film/.test(n) && !d), 'once lent, the Creative project can be given');
  await p.click('[data-xag="unlend"]'); await settle(400); await submit();
  ok(db.lends[0].state === 'revoked' && /Only its own division/.test(await main()), 'ending the lend removes it');
  // an offer into my workspace waits on the Agents page
  db.offers.push({ id: uuid(), state: 'proposed', agent: { id: 'agt_' + 'c'.repeat(32), name: 'Visiting bot' }, from: 'Bob', workspace: { id: WS, name: 'Me' }, division: { id: creative.id, name: 'Creative' } });
  await fresh('/workspace/workspace/Agents');
  ok(/agent offered to your workspaces/i.test(await main()) && /Bob offers it to Creative/.test(await main()), 'an agent offered to your workspace waits on the Agents page, saying who offers it and where');
  await p.click('[data-xag="accept"]'); await settle(900);
  ok(!db.offers.length && !/Visiting bot/.test(await main()), 'Accept decides it and it leaves the list');

  // archive the child
  await fresh(`/workspace/divisions/${film.id}`);
  const hasArchive = !!(await p.$('[data-xdv="archive"]')); if (!hasArchive) console.log('archive button missing; acts:', await p.$eval('.pg-top', (e) => e.innerText).catch(() => '?'));
  await p.click('[data-xdv="archive"]'); await settle(400); await submit();
  if (!film.archived || !/Archived/.test(await main())) console.log('archived?', film.archived, JSON.stringify((await main()).slice(0, 400)));
  ok(film.archived && /Archived/.test(await main()), 'Archive, after confirming, archives it');

  // addresses
  await fresh('/workspace/divisions/Creative');
  ok(/not valid/.test(await main()), 'an address by NAME is not a division address');
  await fresh(`/workspace/divisions/${uuid()}`);
  ok(/This division is gone/.test(await main()), 'an unknown division says it is gone');
  await fresh(`/workspace/divisions/${creative.id}`); await p.click('.crumbs a[data-crumb="Divisions"]'); await settle(); await p.goBack(); await settle();
  ok(/Brand film/.test(await main()) && new URL(p.url()).pathname === `/workspace/divisions/${creative.id}`, 'Back returns to the division, at its id address');
  // the old address still opens it, and is rewritten to the new one in place
  await fresh(`/workspace/workspace/Divisions/${creative.id}`);
  ok(/Brand film/.test(await main()) && new URL(p.url()).pathname === `/workspace/divisions/${creative.id}`, `an old /workspace/workspace/Divisions link opens the home and becomes /workspace/divisions/<id> (${new URL(p.url()).pathname})`);
  // the home: closed parts, objectives, runs — in a fresh tab
  db.runs.push({ id: uuid(), div: creative.id, agent: 'Cutter', target: 'project', project: { id: 'x', name: 'Brand film' }, budgetCredits: 2, authority: { state: 'live' }, canStop: true });
  await fresh(`/workspace/divisions/${creative.id}`); t = await main();
  ok(/1 project you cannot see is closed to you/.test(t) && /1 run you cannot see is closed to you/.test(t), 'what the server closed shows as closed, never as rows');
  ok(/Active runs/.test(t) && /Cutter/.test(t) && /Live/.test(t), 'an active run shows with its live authority');
  ok(/Decisions/.test(t) && /Leads the studio/.test(t), 'the head decision shows with its reason');
  await p.click('[data-xdv="obj-new"]'); await settle(500); await fill(['Ship the film', 'Premiere date met']); await submit();
  const objCall = db.calls.find(([m, u]) => m === 'POST' && u === '/api/workforce/coordination/objectives');
  ok(objCall && objCall[2].divisionId === creative.id && objCall[2].workspaceId === WS && /Ship the film/.test(await main()), 'New objective creates a DIVISION objective through the coordination service, and the home shows it');
  await p.click('[data-xdv="run-stop"]'); await settle(400); await submit();
  ok(db.runs[0].stopped && !/Cutter[\s\S]*Live/.test(await main()), 'Stop revokes the run through its own service and it leaves the home');
  await p.reload({ waitUntil: 'domcontentloaded' }); await settle(1900);
  ok(/Ship the film/.test(await main()) && new URL(p.url()).pathname === `/workspace/divisions/${creative.id}`, 'refresh lands on the same home');
  // Open as canvas: live workforce cards; refresh and Back
  await p.click('[data-xcv-open="division"]'); await settle(1800);
  const mapPath = new URL(p.url()).pathname, stage = () => p.$eval('[data-cv-stage]', (e) => e.innerText).catch(() => '');
  ok(db.map && mapPath === `/workspace/tasks/canvas/${db.map.id}`, `Open as canvas opens the division's map at its canvas id (${mapPath})`);
  let st = await stage();
  ok(/Division[\s\S]*Active[\s\S]*Creative/.test(st) && /Head Me/.test(st) && /Brand film/.test(st) && /3 open tasks/.test(st) && /Ship the film/.test(st) && /1 of 2 goals done/.test(st), 'its cards show each record by name with its live status');
  ok(/Not available/.test(st) && (await p.$$('[data-cv-kind]')).length === 3, 'a card the server closed shows as not available, with no name');
  await p.reload({ waitUntil: 'domcontentloaded' }); await settle(1900);
  ok(new URL(p.url()).pathname === mapPath && /Brand film/.test(await stage()), 'refresh lands on the same map');
  await p.goBack(); await settle(1200);
  ok(new URL(p.url()).pathname === `/workspace/divisions/${creative.id}` && /Ship the film/.test(await main()), 'Back returns to the division home');
  await p.click('[data-xcv-open="division"]'); await settle(1500);
  ok(db.mapCalls === 2 && new URL(p.url()).pathname === mapPath, 'opening it again goes to the same canvas');

  if (process.env.SHOTS) { await fresh(`/workspace/divisions`); await p.screenshot({ path: 'X:/xeno-deploy-tmp/dv-list.png' }); await fresh(`/workspace/divisions/${creative.id}`); await p.screenshot({ path: 'X:/xeno-deploy-tmp/dv-one.png' }); await fresh(`/workspace/workspace/Agents/${ag.id}`); await p.screenshot({ path: 'X:/xeno-deploy-tmp/ag-div.png', fullPage: false }); await p.evaluate(() => document.querySelector('#main .pg, #main [class*=scroll]')?.scrollBy?.(0, 600)); await p.screenshot({ path: 'X:/xeno-deploy-tmp/ag-div2.png' }); }
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);
