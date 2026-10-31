// Places on the platform shows the workspace's real building, from XENO Places' own service, and no sample people.
//   1. floors, pods and desks come from the snapshot; a closed floor has no name; sample names never show
//   2. a body's state comes from its records: a run, a run waiting, time off
//   3. a person opens at an address by id, and a refresh lands there; a floor has its own address
//   4. the list view holds the same people, and an agent's desk opens the agent by its stable id
//   5. nothing here writes: no Arrange, and "Walk in" goes to XENO Places
//   6. a failed load says so with a retry; a workspace with no teams says what to do; denied says so
import { shot } from './shot.mjs';
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5224, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { port: PORT, host: '127.0.0.1', strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const ME = '11111111-1111-4111-8111-111111111111', WS = '33333333-3333-4333-8333-333333333333', PL = '44444444-4444-4444-8444-444444444444', DIV = '55555555-5555-4555-8555-555555555555', CLOSED = '66666666-6666-4666-8666-666666666666';
const AG = '77777777-7777-4777-8777-777777777777', AW = '88888888-8888-4888-8888-888888888888', TA = '99999999-9999-4999-8999-999999999999', TB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = { id: ME, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const SNAP = () => ({ schemaVersion: 1, seq: 0, building: { workspaceId: WS, name: 'Real Co', workspaceType: 'company' }, viewer: { principalId: ME, scope: { divisionIds: [DIV] } },
  divisions: [{ id: DIV, key: 'eng', name: 'Real Floor', parentDivisionId: null, headPrincipalId: ME }],
  teams: [{ id: TA, name: 'Real Pod', owningDivisionId: DIV }, { id: TB, name: 'Lobby Pod', owningDivisionId: null }],
  memberships: [{ id: 'm1', teamId: TA, principalId: ME, role: 'manager' }, { id: 'm2', teamId: TA, principalId: AG, role: 'worker' }, { id: 'm3', teamId: TB, principalId: AW, role: 'worker' }, { id: 'm4', teamId: TB, principalId: AG, role: 'worker' }],
  principals: [{ id: ME, displayName: 'Test Person', isAgent: false }, { id: AG, displayName: 'Real Agent', isAgent: true, publicId: 'agt_realagent' }, { id: AW, displayName: 'Away Person', isAgent: false, away: 'time_off' }],
  runs: [{ id: 'r1', principalId: AG, membershipId: 'm2', title: 'Real run', status: 'running' }], handoffs: [{ id: 'h1', sourceMembershipId: 'm2', targetMembershipId: 'm3', state: 'offered', workRef: 'task' }], closedDivisionIds: [CLOSED] });
const PLACE = () => ({ id: PL, name: 'Real Co', workspaceId: WS, workspaceType: 'company', counts: { floors: 2, teams: 2, agents: 1, humans: 2, working: 1, needs: 0 }, access: { permissions: ['view'] } });
let mode = 'ok', snap = SNAP(), writes = [];
const SAMPLES = /Mira Chen|Atlas|Growth pod|Core team/;

async function open(url) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => {
    const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [{ id: WS, name: 'Real Co', slug: 'real-co', member_role: 'owner', workspace_type: 'company' }] });
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    if (u.pathname.startsWith('/api/places') && q.method() !== 'GET') { writes.push(u.pathname); return json({ ok: true, result: {} }); }
    if (u.pathname === '/api/places') { if (mode === 'error') return json({ ok: false, error: { code: 'internal' } }, 500); if (mode === 'denied') return json({ ok: false, error: { code: 'denied' } }, 403); return json({ ok: true, result: { items: [PLACE()] } }); }
    if (u.pathname === '/api/places/' + PL) return json({ ok: true, result: { place: PLACE(), spec: { snap, record: {} }, access: { permissions: ['view'] }, campus: [] } });
    return json({ success: false, error: 'not found' }, 404);
  });
  await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await wait(1800);
  return { p, errs };
}
const main = (p) => p.evaluate(() => document.querySelector('#main')?.innerText || '');
const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); e?.click(); return !!e; }, sel);
const address = (p) => p.evaluate(() => location.pathname);
const has = (p, sel) => p.evaluate((s) => !!document.querySelector(s), sel);

try {
  {
    const { p, errs } = await open('/workspace/places?ws=' + WS);
    let t = await main(p);
    ok(/Real Floor/.test(t) && /Real Pod/.test(t) && /Lobby Pod/.test(t) && /Test Person/.test(t) && /Real Agent/.test(t), 'the building shows the real floors, pods and desks');
    ok(!SAMPLES.test(t), 'and no sample people');
    ok(/Closed/.test(t) && (await p.evaluate((id) => !document.body.innerText.includes(id), CLOSED)), 'a closed floor is a closed door, with no name');
    ok(/2 floors and a lobby/.test(t) && /1 working/.test(t), 'the header counts the real building');
    ok(/handing work/.test(t) && /Real Agent/.test(t), 'a handoff in flight is shown');
    ok(await has(p, '.pl-desk.pl-work') && await has(p, '.pl-desk.pl-away') && await has(p, '.pl-desk.pl-you'), 'a body’s state comes from its records: a run, time off, and you');
    ok((await p.evaluate(() => document.querySelectorAll('.pl-desk.pl-ghost').length)) === 1, 'a person on two teams is one body and one empty desk');
    await shot(p, 'places-building');
    ok(!(await p.evaluate(() => /Arrange/.test(document.querySelector('#main').innerText))), 'nothing here pretends to save a layout');
    const walk = await p.evaluate(() => [...document.querySelectorAll('#main a')].find((a) => /Walk in/.test(a.innerText))?.href);
    ok(walk === `https://places.xenosystem.ai/p/${PL}`, 'Walk in opens this building in XENO Places');

    await click(p, `[data-xpl="open"][data-id="${AG}"]`); await wait(400);
    ok((await address(p)).endsWith(`/places/p/${AG}`), `a person has an address by id (${await address(p)})`);
    t = await main(p);
    ok(/Working: Real run/.test(t) && /Agent/.test(t), 'the card says what they are doing');
    await shot(p, 'places-person');
    await p.reload({ waitUntil: 'domcontentloaded' }); await wait(1800);
    ok(/Working: Real run/.test(await main(p)), 'a refresh lands on the same person');
    await click(p, `[data-xpl="profile"][data-id="${AG}"]`); await wait(500);
    ok((await address(p)).endsWith('/workspace/Agents/agt_realagent'), `an agent opens at its stable id (${await address(p)})`);
    await p.goBack(); await wait(600);
    ok(/Working: Real run/.test(await main(p)), 'Back returns to the card');

    await click(p, `[data-xpl="floor"][data-id="${DIV}"]`); await wait(400);
    ok((await address(p)).endsWith(`/places/f/${DIV}`), 'a floor has an address by id');
    t = await main(p);
    ok(/Real Pod/.test(t) && !/Lobby Pod/.test(t), 'and shows only that floor');
    await click(p, '[data-xpl="list"]'); await wait(300);
    t = await main(p);
    ok(/Building view/.test(t) && /Real Agent/.test(t) && /Working: Real run/.test(t), 'the list view holds the same people and states');
    ok(errs.length === 0, `no page errors (${errs[0] || ''})`);
    ok(writes.length === 0, 'reading the building writes nothing');
    await p.close();
  }
  {
    mode = 'error';
    const { p } = await open('/workspace/places?ws=' + WS);
    ok(/could not be loaded/.test(await main(p)) && !SAMPLES.test(await main(p)), 'a failed load says so and shows no sample');
    mode = 'ok';
    await click(p, '[data-xpl="retry"]'); await wait(800);
    ok(/Real Floor/.test(await main(p)), 'Try again loads it');
    await p.close();
    mode = 'denied';
    const d = await open('/workspace/places?ws=' + WS);
    ok(/don’t have access/.test(await main(d.p)), 'no access says so');
    await d.p.close(); mode = 'ok';
    snap = { ...SNAP(), divisions: [], teams: [], memberships: [], runs: [], handoffs: [], closedDivisionIds: [], principals: [SNAP().principals[0]] };
    const e = await open('/workspace/places?ws=' + WS);
    ok(/A lobby/.test(await main(e.p)) && /Set them up/.test(await main(e.p)), 'an empty workspace is a lobby that says how to fill it');
    await e.p.close();
  }
} catch (e) { fails++; console.log('FAIL threw', e.message); }
finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
