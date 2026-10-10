// Workspaces and projects on the platform: the real lists, where each project lives, real saves, and honest gaps.
// A Vite server serves the workspace; the test answers /api/ from a small in-memory platform. Nothing real is touched.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5189, base = `http://127.0.0.1:${PORT}`;
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
  calls: [], next: 10,
};
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
function answer(q) {
  const u = new URL(q.url()), m = q.method(), p = u.pathname; let body = null; try { body = JSON.parse(q.postData() || 'null'); } catch {}
  if (m !== 'GET') db.calls.push({ m, p, body, ws: q.headers()['x-xeno-workspace'] || null, csrf: q.headers()['x-xeno-csrf'] || null });
  if (p === '/api/auth/me') return json(200, { success: true, user: db.user });
  if (p === '/api/account/overview') return json(200, { success: true, overview: { user: db.user, credits: { balance: 0 }, workspace_count: 2 } });
  if (p === '/api/account/sessions') return json(200, { success: true, sessions: [] });
  if (p === '/api/account/security') return json(200, { success: true, security: { confirmation: { confirmed: false, available: true, expires_at: null }, methods: ['password'], has_password: true, email: '', pending_email: null } });
  if (p === '/api/account/exports') return json(200, { success: true, exports: [] });
  if (p === '/api/auth/linked-accounts') return json(200, { success: true, accounts: [] });
  if (p === '/api/billing/overview') return json(200, { success: true, overview: { credits: { balance: 0 }, subscription: null } });
  if (p === '/api/workspace/needs') return json(200, { success: true, items: [] });
  if (p === '/api/workspace/summary') return json(200, { success: true, days: 7, areas: {} });
  if (p === '/api/workspace/pins') return json(200, { success: true, items: [] });
  if (p === '/api/v2/ledger/usage') return json(200, { rows: [] });
  if (p === '/api/dashboard/stats') return json(200, { success: true, stats: { usage_available: false, usage_by_surface: [] } });
  if (p === '/api/user-data/settings') return json(200, { success: true, settings: {} });
  if (p === '/api/workspaces' && m === 'GET') return json(200, { success: true, workspaces: db.workspaces });
  if (p === '/api/workspaces' && m === 'POST') { const w = { id: `44444444-4444-4444-8444-${String(db.next++).padStart(12, '0')}`, workspace_type: 'team', name: body.name, member_role: 'owner', member_count: 1 }; db.workspaces.push(w); return json(200, { success: true, workspace: w }); }
  if (p === '/api/library/assets') return json(200, { success: true, items: [] });
  const inArea = (x) => { const a = u.searchParams.get('area'); return a === null || (a === 'none' ? !x.area : x.area === a); };
  if (p === '/api/chat/conversations') { const rows = db.conversations.filter((c) => inArea({ area: c.project_id ? (db.projects.find((x) => x.id === c.project_id) || {}).area : c.area })); return json(200, { success: true, conversations: rows, total: rows.length }); }
  if (p === '/api/chat/projects' && m === 'GET') { (db.projectAsks = db.projectAsks || []).push(u.searchParams.get('area')); return json(200, { success: true, projects: db.projects.filter(inArea), limit: 100, offset: 0 }); }
  if (p === '/api/chat/projects' && m === 'POST') {
    if (body.name === 'Refused') return json(400, { success: false, error: 'Project name is not allowed' });
    const ws = q.headers()['x-xeno-workspace'], team = ws && ws !== WP ? ws : null;
    const pr = { id: pid(db.next++), name: body.name, description: body.description || '', settings: body.settings || {}, area: body.area || null, is_archived: false, owner_user_id: team ? null : U, workspace_id: team, file_count: 0, chat_count: 0, updated_at: new Date().toISOString(), capabilities: { viewer: true, owner: true } };
    db.projects.unshift(pr); return json(200, { success: true, project: pr });
  }
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
  const mm = p.match(/^\/api\/chat\/projects\/([^/]+)$/);
  if (mm && m === 'PUT') { const pr = db.projects.find((x) => x.id === decodeURIComponent(mm[1])); if (!pr) return json(404, { success: false, error: 'Project not found' }); if (body.name !== undefined) pr.name = body.name; if (body.area !== undefined) pr.area = body.area; if (body.is_archived !== undefined) pr.is_archived = !!body.is_archived; if (body.settings) pr.settings = { ...pr.settings, ...body.settings }; return json(200, { success: true, project: pr }); }
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

try {
  // Overview: every project (an area shows only its own, checked further down)
  await p.goto(base + '/workspace/#/overview', { waitUntil: 'networkidle0' }); await wait(700);
  const st = await p.evaluate(() => window.XENO_WORK.state());
  ok(st.scope === 'ready' && st.projects === 'ready', 'workspaces and projects load from the platform (' + JSON.stringify(st) + ')');

  const ws = await p.evaluate(() => window.XA.workspaces().map((w) => `${w.name}|${w.sub}`));
  ok(JSON.stringify(ws) === JSON.stringify(['Personal|Just you', 'Analytical Engines|Company · you are an admin']), 'the workspace list is the real one, with your role in each (' + JSON.stringify(ws) + ')');

  await goProjects(); let t = await main();
  const list = await names();
  ok(list.length === 3 && !SAMPLE.test(t) && !SAMPLE.test(list.join()), 'the projects are the real ones and no sample project is shown (' + list.length + ')');
  ok(list.includes('Website (Personal)|active|Personal') && list.includes('Website (Analytical Engines)|active|Analytical Engines'), 'two projects with one name are told apart by where they live (' + JSON.stringify(list.slice(0, 2)) + ')');
  ok(list.includes('Old notes|archived|Personal') && !/Old notes/.test(t), 'an archived project is kept out of the active list');
  ok(await p.evaluate(() => window.XENO_PG_PROJECTS.items.every((x) => /^[0-9a-f-]{36}$/.test(x.id))), 'every project carries the platform id');
  ok(!/undefined|On track|At risk/.test(t), 'no health is shown for a project that has none recorded');

  await goProjects('Website (Personal)'); t = await main();
  ok(/Ship the new site/.test(t) && /Lives in/.test(t) && /Personal/.test(t) && /1\s*Conversation/.test(t) && /3\s*Files/.test(t), 'the project page shows its goal, where it lives, and real counts');
  await goProjects('Website (Personal)/Conversations'); t = await main();
  ok(/Homepage copy/.test(t) && !/Loose chat/.test(t), 'Conversations lists the chats that belong to this project');
  await goProjects('Website (Personal)/Tasks'); t = await main();
  const off = await p.evaluate(() => [...document.querySelectorAll('#main [data-xa="newTask"], #main [data-xa="budget"]')].map((el) => el.getAttribute('aria-disabled')));
  ok(/Tasks aren’t available yet/.test(t) && off.every((v) => v === 'true'), 'a tab with no platform API says so, and any control for it is shown unavailable (' + off.length + ' controls)');
  await goProjects('Website (Personal)/Funding'); ok(/Funding isn’t available yet/.test(await main()), 'Funding shows no sample campaign on a real project');

  // ---- create, in the current workspace ----
  await goProjects(); db.calls.length = 0;
  await p.evaluate(() => { window.XA.newProject(); }); await wait(350);
  await p.evaluate(() => { const i = document.querySelector('#xdf-name'); i.value = 'Difference Engine'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('.xd [data-xd-submit]'); await settle();
  let c = db.calls.find((x) => x.m === 'POST' && x.p === '/api/chat/projects');
  ok(!!c && c.body.name === 'Difference Engine' && c.ws === WP && c.csrf === 'csrf-test-token' && c.body.settings?.xw?.icon, 'creating a project sends it to the platform, in the current workspace (' + JSON.stringify(c && { ws: c.ws, name: c.body.name }) + ')');
  ok((await names()).some((n) => n.startsWith('Difference Engine|active|Personal')) && await p.evaluate(() => /^[0-9a-f-]{36}$/.test(window.XENO_PG_PROJECTS.items.find((x) => x.name === 'Difference Engine').id)), 'the new project is listed with the id the platform gave it');

  await p.evaluate(() => window.XA.switchWorkspace('33333333-3333-4333-8333-333333333333')); await wait(300); db.calls.length = 0;
  await p.evaluate(() => { window.XA.newProject(); }); await wait(350);
  await p.evaluate(() => { const i = document.querySelector('#xdf-name'); i.value = 'Team plan'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('.xd [data-xd-submit]'); await settle();
  c = db.calls.find((x) => x.m === 'POST' && x.p === '/api/chat/projects');
  ok(!!c && c.ws === WT && (await names()).includes('Team plan|active|Analytical Engines'), 'in a company workspace, the new project is created there and listed as living there');

  // ---- a refusal is rolled back ----
  db.calls.length = 0; const before = (await names()).length;
  await p.evaluate(() => { window.XA.newProject(); }); await wait(350);
  await p.evaluate(() => { const i = document.querySelector('#xdf-name'); i.value = 'Refused'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('.xd [data-xd-submit]'); await wait(800);
  const said = await p.evaluate(() => document.querySelector('.xd')?.innerText || '');
  await p.evaluate(() => document.querySelector('.xd [data-xd-ok]')?.click()); await settle();
  ok(/not allowed/.test(said) && (await names()).length === before && !(await names()).some((n) => n.startsWith('Refused')), 'a project the platform refuses is not left in the list (' + said.replace(/\s+/g, ' ').slice(0, 60) + ')');

  // ---- rename and archive ----
  db.calls.length = 0;
  await p.evaluate(() => { window.XA.renameProject('Difference Engine'); }); await wait(350);
  await p.evaluate(() => { const i = document.querySelector('#xdf-name'); i.value = 'Analytical Engine'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('.xd [data-xd-submit]'); await settle();
  c = db.calls.find((x) => x.m === 'PUT');
  ok(!!c && c.body.name === 'Analytical Engine' && db.projects.some((x) => x.name === 'Analytical Engine') && (await names()).some((n) => n.startsWith('Analytical Engine|')), 'renaming a project renames it on the platform, by id');

  db.calls.length = 0;
  await p.evaluate(() => { window.XA.archiveProject('Analytical Engine'); }); await wait(350);
  await p.click('.xd [data-xd-ok]'); await settle();
  c = db.calls.find((x) => x.m === 'PUT');
  ok(!!c && c.body.is_archived === true && (await names()).some((n) => n.startsWith('Analytical Engine|archived')), 'archiving a project archives it on the platform');

  // ---- what the platform cannot do yet ----
  db.calls.length = 0; const n0 = (await names()).length;
  await p.evaluate(() => { window.XA.deleteProject('Team plan'); }); await wait(400);
  ok(db.calls.length === 0 && (await names()).length === n0 && !(await p.evaluate(() => !!document.querySelector('.xd'))), 'deleting a project that is not archived is refused up front and nothing changes');

  // ---- create a company ----
  db.calls.length = 0;
  await p.evaluate(() => { window.XA.newCompany(); }); await wait(350);
  await p.evaluate(() => { const i = document.querySelector('#xdf-name'); i.value = 'Babbage Works'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('.xd [data-xd-submit]'); await settle();
  c = db.calls.find((x) => x.m === 'POST' && x.p === '/api/workspaces');
  const cur = await p.evaluate(() => { const w = window.XA.currentWorkspace(); return `${w.name}|${w.sub}|${/^[0-9a-f-]{36}$/.test(w.id)}`; });
  ok(!!c && c.body.name === 'Babbage Works' && cur === 'Babbage Works|Company · you are the owner|true', 'creating a company creates the workspace on the platform and switches to it (' + cur + ')');

  // ---- areas: each has its own projects; Overview shows them all ----
  await p.evaluate(() => window.XA.switchWorkspace('personal')); await wait(300);
  db.projects.find((x) => x.id === pid(1)).area = 'studio';
  const goArea = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await wait(1300); };
  await goArea('#/overview/g/projects'); await p.evaluate(() => window.XENO_WORK.reload()); await wait(500);
  ok(db.projectAsks.at(-1) === null, 'on Overview the projects asked for are everything');
  const studioName = await p.evaluate(() => window.XENO_PG_PROJECTS.items.find((x) => x.realName === 'Website' && x.area === 'studio')?.mode);
  ok(studioName === 'Studio', 'a project says which area it lives in, by name (' + studioName + ')');
  await goArea('#/studio/g/projects');
  ok(db.projectAsks.at(-1) === 'studio' && JSON.stringify(await p.evaluate(() => window.XENO_PG_PROJECTS.items.map((x) => x.realName))) === JSON.stringify(['Website']), 'in Studio the Projects page asks for Studio’s and shows only them');
  db.calls.length = 0;
  await p.evaluate(() => { window.XA.newProject(); }); await wait(350);
  await p.evaluate(() => { const i = document.querySelector('#xdf-name'); i.value = 'Moodboard'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('.xd [data-xd-submit]'); await settle();
  c = db.calls.find((x) => x.m === 'POST' && x.p === '/api/chat/projects');
  ok(!!c && c.body.area === 'studio' && c.body.settings?.xw?.mode === undefined, 'a project made in Studio is made in Studio (its home is the real area, not a label in its settings)');
  await goArea('#/office/g/projects');
  ok(db.projectAsks.at(-1) === 'office' && (await p.evaluate(() => window.XENO_PG_PROJECTS.items.length)) === 0, 'an area with no projects shows none; it does not fall back to everything');
  await goArea('#/studio/g/projects'); db.calls.length = 0;
  const moving = p.evaluate(() => window.XENO_WORK.moveProject(window.XENO_PG_PROJECTS.items.find((x) => x.realName === 'Moodboard').name)); await wait(500);
  const choices = await p.evaluate(() => [...document.querySelectorAll('[role=radio][data-v]')].filter((n) => n.offsetParent).map((n) => n.dataset.v + (n.getAttribute('aria-checked') === 'true' ? '*' : '')).join(','));
  ok(/^none,/.test(choices) && /studio\*/.test(choices) && /office/.test(choices), 'Move to area offers no area and every area, the current one chosen (' + choices + ')');
  await p.evaluate(() => [...document.querySelectorAll('[role=radio][data-v="office"]')].find((n) => n.offsetParent).click()); await p.click('.xd [data-xd-submit]'); await moving; await wait(500);
  const put = db.calls.find((x) => x.m === 'PUT' && /\/api\/chat\/projects\//.test(x.p));
  ok(!!put && put.body.area === 'office' && put.csrf === 'csrf-test-token' && !(await p.evaluate(() => window.XENO_PG_PROJECTS.items.some((x) => x.realName === 'Moodboard'))), 'moving it to Office tells the platform and it leaves Studio’s list');

  // ---- share a project, and delete one for good ----
  await p.evaluate(() => { location.hash = '#/overview'; }); await wait(700); await goProjects(); await wait(500); db.calls.length = 0;
  const nameOf = (real) => p.evaluate((r) => (window.XENO_PG_PROJECTS.items.find((x) => x.realName === r) || {}).name, real);
  const web = await p.evaluate(() => window.XENO_PG_PROJECTS.items.find((x) => x.realName === 'Website' && x.place === 'Personal').name);
  p.evaluate((n) => { window.XA.assign(n); }, web); await wait(700);
  const share = () => p.evaluate(() => { const sh = [...document.querySelectorAll('.xd')].at(-1); return { title: sh.querySelector('.xd-head b')?.textContent || '', state: sh.querySelector('[data-share-state]')?.dataset.shareState || null, rows: [...sh.querySelectorAll('[data-share]')].map((li) => li.querySelector('b').innerHTML + '|' + (li.querySelector('select')?.value || li.querySelector('.xd-share-owner')?.textContent || '')), err: sh.querySelector('[data-share-error]')?.textContent || '' }; });
  let sv = await share();
  ok(/Share “Website”/.test(sv.title) && sv.rows.join() === 'Ada (you)|Owner' && sv.state === null, 'Share opens the real access list: the owner, who cannot be changed (' + sv.rows.join() + ')');
  const addShare = async (email, role) => { await p.evaluate((e, r) => { const sh = [...document.querySelectorAll('.xd')].at(-1), f = sh.querySelector('[data-share-add]'); f.querySelector('input').value = e; f.querySelector('select').value = r; f.requestSubmit(); }, email, role); await wait(700); };
  await addShare('nobody@example.test', 'viewer'); sv = await share();
  ok(/No XENO account uses that email/.test(sv.err) && sv.rows.length === 1, 'an email with no account is refused in words, and nothing is added');
  await addShare('bob@example.test', 'editor'); sv = await share();
  const by = db.calls.filter((x) => x.m === 'PUT' && /\/access\/user\/by-email$/.test(x.p)).at(-1);
  ok(by && by.body.email === 'bob@example.test' && by.body.relation === 'editor' && sv.rows[1] === 'Bob &lt;b&gt;B&lt;/b&gt;|editor' && sv.err === '', 'sharing by email tells the platform and lists the person with their role, as text (' + sv.rows[1] + ')');
  await p.evaluate(() => { const s = [...document.querySelectorAll('.xd')].at(-1).querySelector('[data-share-role="bob-id"]'); s.value = 'viewer'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(700); sv = await share();
  ok(db.calls.some((x) => x.m === 'PUT' && /\/access\/user\/bob-id$/.test(x.p) && x.body.relation === 'viewer') && sv.rows[1].endsWith('|viewer'), 'changing a role tells the platform');
  db.refuseShare = true; await p.evaluate(() => [...document.querySelectorAll('.xd')].at(-1).querySelector('[data-share-remove="bob-id"]').click()); await wait(700); db.refuseShare = false;
  ok(await p.evaluate(() => document.body.textContent.includes('That couldn’t be removed. They still have access.')), 'when removing is refused the person is told they still have access');
  await p.evaluate(() => [...document.querySelectorAll('.xd')].at(-1).querySelector('[data-share-retry]')?.click()); await wait(700);
  await p.evaluate(() => [...document.querySelectorAll('.xd')].at(-1).querySelector('[data-share-remove="bob-id"]').click()); await wait(700); sv = await share();
  ok(db.calls.some((x) => x.m === 'DELETE' && /\/access\/user\/bob-id$/.test(x.p)) && sv.rows.length === 1, 'Stop sharing removes them');
  await p.evaluate(() => [...document.querySelectorAll('.xd')].at(-1).querySelector('[data-xd-close]').click()); await wait(400);

  const del = async (real, typed) => { const n = await nameOf(real); p.evaluate((x) => { window.XA.deleteProject(x); }, n); await wait(500); const asked = await p.evaluate(() => !!document.querySelector('.xd #xd-type')); if (!asked) return false;
    await p.evaluate((v) => { const i = document.querySelector('.xd #xd-type'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, typed); await wait(150); await p.evaluate(() => document.querySelector('.xd [data-xd-ok]').click()); await wait(900); return true; };
  db.projects.push({ id: pid(8), name: 'Full archive', description: '', settings: {}, is_archived: true, owner_user_id: U, workspace_id: null, file_count: 0, chat_count: 1, updated_at: '2026-09-02T10:00:00Z', capabilities: { viewer: true, owner: true } }); db.conversations.push({ id: 'c9', title: 'still here', project_id: pid(8) });
  await p.evaluate(() => window.XENO_WORK.reload()); await wait(700); db.calls.length = 0;
  ok(await del('Full archive', 'Full archive') && db.calls.some((x) => x.m === 'DELETE' && /\/permanent$/.test(x.p)) && db.projects.some((x) => x.name === 'Full archive') && (await p.evaluate(() => document.body.textContent.includes('still holds 1 chat. Move or delete them first.'))), 'an archived project that still holds a chat is not deleted, and the person is told what is in it');
  db.calls.length = 0;
  ok(await del('Old notes', 'Old notes') && !db.projects.some((x) => x.name === 'Old notes') && !(await p.evaluate(() => window.XENO_PG_PROJECTS.items.some((x) => x.realName === 'Old notes'))) && (await p.evaluate(() => document.body.textContent.includes('Deleted “Old notes” for good'))), 'an archived, empty project is deleted for good after its name is typed, and leaves the list');

  ok(missing.length === 0, 'the workspace asked for no route the platform lacks (' + JSON.stringify([...new Set(missing)].slice(0, 3)) + ')');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { ok(false, 'threw: ' + String(e.message).split('\n')[0]); }
await b.close(); await server.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
