import { shot } from './shot.mjs';
// Workspace › Teams, Automations and Activity show what the server holds, not the picture's rows.
//   1. Teams lists the server's teams; a viewer gets no New team button
//   2. creating a team POSTs it and opens it at Teams/<id>, with the name in the breadcrumb; a refresh lands there again
//   3. editing sends the version the server gave; a conflict says so
//   4. archiving sends the version and the team leaves the list
//   5. Automations lists the real workflows and opens them in Dev > Automate; Activity lists recorded events and counts hidden ones
//   6. a failed load says so with a way to retry; an empty list says it is empty; nothing from the sample shows
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5221, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { port: PORT, host: '127.0.0.1', strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const WS = '33333333-3333-4333-8333-333333333333', T1 = '44444444-4444-4444-8444-444444444444', T2 = '55555555-5555-4555-8555-555555555555', AG = '66666666-6666-4666-8666-666666666666', PJ = '77777777-7777-4777-8777-777777777777';
const db = { canManage: true, fail: new Set(), conflict: false, writes: [],
  teams: [{ id: T1, name: 'Real Team', description: 'Does real work', version: 3, agents: [{ id: AG, name: 'Real Agent', status: 'active' }], projects: [{ id: PJ, name: 'Real Project' }] }],
  workflows: [{ id: 'wf1', name: 'Real Workflow', state: 'enabled', lastRun: 'succeeded' }],
  events: [{ id: '9', type: 'team.created', actorUserId: '7', at: new Date(Date.now() - 60000).toISOString(), data: {} }], hidden: 2 };
const SAMPLES = /Lead enrich|Growth pod|Core team/;

async function open(url) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); if (process.env.TDBG) p.on('console', (c) => console.log('  page:', c.text().slice(0, 160)));
  await p.setRequestInterception(true);
  p.on('request', async (q) => {
    const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const m = q.method(), bodyOf = () => JSON.parse(q.postData() || '{}');
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [{ id: WS, name: 'Real Co', slug: 'real-co', member_role: 'owner', workspace_type: 'company' }] });
    if (u.pathname === `/api/workspaces/${WS}/teams`) {
      if (m === 'POST') { const x = bodyOf(); db.writes.push(['POST', x]); db.teams.push({ id: T2, name: x.name, description: x.description, version: 1, agents: [], projects: [] }); return json({ success: true, id: T2 }, 201); }
      if (db.fail.has('teams')) return json({ error: 'nope' }, 500);
      return json({ success: true, teams: db.teams, projects: [{ id: PJ, name: 'Real Project' }], available_agents: [{ id: AG, name: 'Real Agent' }], can_manage: db.canManage });
    }
    const one = u.pathname.match(new RegExp(`^/api/workspaces/${WS}/teams/(.+)$`));
    if (one) {
      const x = bodyOf(); db.writes.push([m, one[1], x]);
      if (db.conflict) return json({ success: false, error: 'This team changed in another session.', code: 'team_version_conflict' }, 409);
      const t = db.teams.find((y) => y.id === one[1]);
      if (m === 'DELETE') db.teams = db.teams.filter((y) => y !== t); else { t.name = x.name; t.version++; }
      return json({ success: true, id: one[1] });
    }
    if (u.pathname === '/api/automate') return db.fail.has('auto') ? json({ error: 'nope' }, 500) : json({ success: true, workflows: db.workflows, canEdit: true, configured: true });
    if (u.pathname === '/api/audit/events') return db.fail.has('act') ? json({ error: 'nope' }, 500) : json({ success: true, events: db.events, hidden: db.hidden, cursor: null, more: false });
    return json({ success: false, error: 'not found' }, 404);
  });
  await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await wait(1800);
  return { p, errs };
}
const mainText = (p) => p.evaluate(() => document.querySelector('#main')?.innerText || '');
const click = (p, sel) => p.evaluate((s) => document.querySelector(s)?.click(), sel);
const address = (p) => p.evaluate(() => location.pathname + location.hash);
const typeName = (p, v) => p.evaluate((val) => { const i = document.querySelector('[data-f="name"] input'); i.value = val; i.dispatchEvent(new Event('input', { bubbles: true })); }, v);
const submit = (p) => p.evaluate(() => { const s = document.querySelector('[data-xd-submit], [data-xd-ok]'); s?.click(); return !!s; });
const goItem = (p, item) => p.evaluate((i) => window.XW.go('global', { global: 'workspace', item: i }), item);

try {
  {
    const { p, errs } = await open('/workspace/workspace/Teams?ws=' + WS);
    console.log('scope', await p.evaluate(() => window.XENO_SCOPE?.uuid?.() || null));
    let t = await mainText(p);
    ok(/Real Team/.test(t) && !SAMPLES.test(t), `Teams lists the server's team and no sample names (${t.slice(0, 80).replace(/\n/g, ' | ')})`);
    await shot(p, 'teams-list');
    ok(await p.evaluate(() => !!document.querySelector('[data-xteam="new"]')), 'an admin gets New team');
    await click(p, `[data-xteam="open"][data-id="${T1}"]`); await wait(600);
    t = await mainText(p);
    ok(/Real Team/.test(t) && /Real Agent/.test(t) && /Real Project/.test(t), 'a team page shows its agents and projects');
    ok((await address(p)).includes(`Teams/${T1}`), 'a team is addressed by its id, not its name');
    await p.reload({ waitUntil: 'domcontentloaded' }); await wait(1800);
    ok(/Real Agent/.test(await mainText(p)), 'a refresh lands on the same team');

    db.conflict = true;
    await click(p, `[data-xteam="edit"][data-id="${T1}"]`); await wait(400);
    await typeName(p, 'Renamed Team');
    await submit(p, 'Save'); await wait(700);
    const put = db.writes.find((x) => x[0] === 'PUT');
    ok(put && put[2].version === 3 && put[2].name === 'Renamed Team', `edit sends the server's version (${put?.[2]?.version})`);
    ok(/changed in another session/.test(await p.evaluate(() => document.body.innerText)), 'a version conflict says so');
    db.conflict = false;

    await goItem(p, 'Teams'); await wait(500);
    await click(p, '[data-xteam="new"]'); await wait(400);
    await typeName(p, 'Fresh Team');
    await submit(p, 'Create team'); await wait(900);
    const post = db.writes.find((x) => x[0] === 'POST');
    ok(post && post[1].name === 'Fresh Team' && Array.isArray(post[1].agent_ids), 'creating a team POSTs it');
    ok((await address(p)).includes(`Teams/${T2}`), 'and opens it at its address');

    await click(p, `[data-xteam="archive"][data-id="${T2}"]`); await wait(400);
    await submit(p, 'Archive'); await wait(900);
    const del = db.writes.find((x) => x[0] === 'DELETE');
    ok(del && del[1] === T2 && del[2].version === 1, 'archiving sends the version');
    ok(!/Fresh Team/.test(await mainText(p)), 'an archived team leaves the list');
    ok(errs.length === 0, `no page errors (${errs[0] || ''})`);
    await p.close();
  }
  {
    db.canManage = false;
    const { p } = await open('/workspace/workspace/Teams?ws=' + WS);
    ok(await p.evaluate(() => !document.querySelector('[data-xteam="new"]')), 'a viewer gets no New team');
    await p.close(); db.canManage = true;
  }
  {
    const { p, errs } = await open('/workspace/workspace/Automations?ws=' + WS);
    let t = await mainText(p);
    ok(/Real Workflow/.test(t) && !SAMPLES.test(t), 'Automations lists the real workflows and no sample');
    await shot(p, 'teams-automations');
    await click(p, '[data-xteam="workflow"][data-id="wf1"]'); await wait(800);
    ok(/automate/.test(await address(p)), 'a workflow opens in Dev › Automate');
    await goItem(p, 'Activity'); await wait(900);
    t = await mainText(p);
    ok(/Team created/.test(t) && /You/.test(t), `Activity lists recorded events (${t.slice(0, 90).replace(/\n/g, ' | ')})`);
    ok(/2 events here are not visible to you/.test(t), 'and says how many it could not show');
    await shot(p, 'teams-activity');
    ok(errs.length === 0, `no page errors (${errs[0] || ''})`);
    await p.close();
  }
  {
    db.fail.add('teams'); db.fail.add('act');
    const { p } = await open('/workspace/workspace/Teams?ws=' + WS);
    ok(/could not be loaded/.test(await mainText(p)), 'a failed load says so');
    db.fail.delete('teams');
    await click(p, '[data-xteam="retry"]'); await wait(700);
    ok(/Real Team/.test(await mainText(p)), 'Try again loads it');
    await goItem(p, 'Activity'); await wait(800);
    ok(/could not be loaded/.test(await mainText(p)), 'Activity says so too');
    db.fail.delete('act'); db.teams = []; db.events = []; db.hidden = 0;
    await p.reload({ waitUntil: 'domcontentloaded' }); await wait(1800);
    ok(/Nothing recorded yet/.test(await mainText(p)), 'an empty Activity says so');
    await goItem(p, 'Teams'); await wait(800);
    ok(/No teams yet/.test(await mainText(p)), 'an empty Teams says so');
    await p.close();
  }
} catch (e) { fails++; console.log('FAIL threw', e.message); }
finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
