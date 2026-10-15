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
const db = { lends: [], offers: [], calls: [], divs: [], proj: [{ id: uuid(), name: 'Website', div: null }, { id: uuid(), name: 'Brand film', div: null }], agents: [], agentProj: {} };
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
  await fresh('/workspace/workspace/Divisions'); let t = await main();
  ok(/No divisions — and that’s fine/.test(t) && /real boundary/.test(t) && !/Studio|Office/.test(t), 'with none, Divisions explains what a division is — and shows no sample departments');

  await p.click('[data-xdv="new"]'); await settle(500); await fill(['Creative']); await submit();
  const creative = db.divs.find((d) => d.name === 'Creative');
  ok(creative && new URL(p.url()).pathname === `/workspace/workspace/Divisions/${creative.id}`, 'New division creates it and opens it at its id');
  const crumb = await p.$eval('.crumbs', (e) => e.innerText).catch(() => '');
  ok(/Divisions\s*\/\s*Creative/.test(crumb) && !crumb.includes(creative.id), `the breadcrumb names it, never its id (${crumb.replace(/\s+/g, ' ')})`);
  await p.click('[data-xdv="new-inside"]'); await settle(500); await fill(['Film']); await submit();
  const film = db.divs.find((d) => d.name === 'Film');
  ok(film && film.parent === creative.id, 'a division is created inside another');

  await fresh('/workspace/workspace/Divisions'); t = await main();
  ok(/Creative/.test(t) && /Film/.test(t) && /never reaches the divisions inside it/.test(t), 'the org chart shows both, and says a division is a boundary');
  const side = await p.$eval('#panel', (e) => e.innerText).catch(() => '');
  ok(/Creative/.test(side), 'the sidebar lists the real divisions');

  // head, with a reason
  await fresh(`/workspace/workspace/Divisions/${creative.id}`);
  await p.click('[data-xdv="head"]'); await settle(500); await choose('Me'); await fill(['Leads the studio']); await submit();
  const patch = db.calls.find(([m, u, b]) => m === 'PATCH' && u === `/api/divisions/${creative.id}` && 'headId' in b);
  ok(patch && patch[2].headId === 'u1' && patch[2].reason === 'Leads the studio', 'Set head sends the head and the recorded reason');

  // move a project in
  await p.click('[data-xdv="add-project"]'); await settle(500); await choose('Brand film'); await submit();
  ok(db.proj.find((x) => x.name === 'Brand film').div === creative.id && /Brand film/.test(await main()), 'a project is moved into the division');

  // an agent in the division
  await fresh('/workspace/workspace/Agents');
  await p.click('[data-xag="new"]'); await settle(500); await fill(['Cutter', 'Edits films']); await choose('Creative'); await submit();
  const ag = db.agents[0];
  ok(ag && ag.div === creative.id, 'a new agent can be created straight into a division');
  t = await main();
  ok(/Division/.test(t) && /Cutter works only on Creative’s projects/.test(t), 'its page says which division it is in and what that means');
  const film2 = await p.$('[data-xag-proj] '); void film2;
  const disabled = await p.$$eval('[data-xag-proj]', (xs) => xs.map((x) => [x.closest('label').innerText.split('\n')[0], x.disabled]));
  ok(disabled.some(([n, d]) => /Website/.test(n) && d) && disabled.some(([n, d]) => /Brand film/.test(n) && !d), `only the project in its division can be given (${JSON.stringify(disabled)})`);
  await p.click(`[data-xag-proj="${db.proj.find((x) => x.name === 'Brand film').id}"]`); await settle(900);
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
  await fresh(`/workspace/workspace/Divisions/${film.id}`);
  const hasArchive = !!(await p.$('[data-xdv="archive"]')); if (!hasArchive) console.log('archive button missing; acts:', await p.$eval('.pg-top', (e) => e.innerText).catch(() => '?'));
  await p.click('[data-xdv="archive"]'); await settle(400); await submit();
  if (!film.archived || !/Archived/.test(await main())) console.log('archived?', film.archived, JSON.stringify((await main()).slice(0, 400)));
  ok(film.archived && /Archived/.test(await main()), 'Archive, after confirming, archives it');

  // addresses
  await fresh('/workspace/workspace/Divisions/Creative');
  ok(/not valid/.test(await main()), 'an address by NAME is not a division address');
  await fresh(`/workspace/workspace/Divisions/${uuid()}`);
  ok(/This division is gone/.test(await main()), 'an unknown division says it is gone');
  await fresh(`/workspace/workspace/Divisions/${creative.id}`); await p.click('.crumbs a[data-crumb="Divisions"]'); await settle(); await p.goBack(); await settle();
  ok(/Brand film/.test(await main()), 'Back returns to the division');

  if (process.env.SHOTS) { await fresh(`/workspace/workspace/Divisions`); await p.screenshot({ path: 'X:/xeno-deploy-tmp/dv-list.png' }); await fresh(`/workspace/workspace/Divisions/${creative.id}`); await p.screenshot({ path: 'X:/xeno-deploy-tmp/dv-one.png' }); await fresh(`/workspace/workspace/Agents/${ag.id}`); await p.screenshot({ path: 'X:/xeno-deploy-tmp/ag-div.png', fullPage: false }); await p.evaluate(() => document.querySelector('#main .pg, #main [class*=scroll]')?.scrollBy?.(0, 600)); await p.screenshot({ path: 'X:/xeno-deploy-tmp/ag-div2.png' }); }
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);
