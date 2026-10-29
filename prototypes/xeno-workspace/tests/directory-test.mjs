// directory-test — Workspace → Directory in a real browser, answered by the REAL /api/people routes
// (routes/workforcePeopleRoutes.js → services/workforcePeople.js) on real Postgres. Only sign-in and the workspace list
// are stood in. Proves: the directory lists the workspace's people; a person opens at their id; refresh, Back and a fresh
// tab land on the same view; a PEER never sees another person's private fields (not in the page, not in the response);
// the person themself does (positive control, so "hidden" is not just "never rendered").
//   DATABASE_URL=postgresql://…/<disposable> node prototypes/xeno-workspace/tests/directory-test.mjs
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import http from 'node:http';
import { shot } from './shot.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(path.join(repo, 'src/server/package.json'));
const puppeteer = createRequire(import.meta.url)('puppeteer'), express = require('express'), pg = require('pg');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const { runAllMigrations } = await import('../../../src/server/services/migrationRunner.js');
const { writeTuples } = await import('../../../src/server/utils/authzReBAC.js');
const people = await import('../../../src/server/services/workforcePeople.js');
const peopleRoutes = (await import('../../../src/server/routes/workforcePeopleRoutes.js')).default;
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await runAllMigrations(pool);
const tag = `dir${process.pid}`;
const mk = async (s, name) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at) VALUES ($1,$2,$3,true,true,'x',now()) RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, name])).rows[0].id;
const owner = await mk('owner', 'Olga Owner'), emp = await mk('emp', 'Emil Employee'), peer = await mk('peer', 'Pia Peer');
const W = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'company','Dir Co',$2) RETURNING id`, [owner, `${tag}-co`])).rows[0].id;
await writeTuples(pool, { writes: [{ object: `workspace:${W}`, subject: `user:${owner}`, relation: 'owner' }, { object: `workspace:${W}`, subject: `user:${emp}`, relation: 'editor' }, { object: `workspace:${W}`, subject: `user:${peer}`, relation: 'editor' }] });
await people.updateProfile(pool, { id: owner }, { workspaceId: W, principalId: emp, title: 'Sound engineer', managerId: owner, privatePhone: '+49 555 0101', privateNotes: 'SECRET-NOTE-42' });
// Work report evidence: the employee made two tasks in a project of this workspace and closed one without a review.
const { readWorkforceEvaluation, readWorkforceRoster } = await import('../../../src/server/services/workforceEvaluation.js');
const proj = (await pool.query(`INSERT INTO chat_projects(user_id,owner_user_id,workspace_id,created_by_user_id,updated_by_user_id,name) VALUES(NULL,NULL,$1,$2,$2,'Mix') RETURNING id`, [W, owner])).rows[0].id;
for (const done of [true, false]) {
  const tid = (await pool.query(`INSERT INTO tasks(title,project_id,reporter_id,assignee_id,status) VALUES('Master the track',$1,$2,$2,$3) RETURNING id`, [proj, emp, done ? 'done' : 'todo'])).rows[0].id;
  await pool.query(`INSERT INTO task_events(task_id,actor_id,actor_kind,kind) VALUES($1,$2,'human','created')`, [tid, emp]);
  if (done) await pool.query(`INSERT INTO task_events(task_id,actor_id,actor_kind,kind,from_value,to_value) VALUES($1,$2,'human','status','in_progress','done')`, [tid, emp]);
}

const app = express(); app.use(express.json());
app.use('/api/people', (req, _res, next) => { req.db = pool; req.owner = req.get('x-test-user'); next(); }, peopleRoutes);
const real = http.createServer(app); await new Promise((r) => real.listen(0, '127.0.0.1', r));
const REAL = `http://127.0.0.1:${real.address().port}`;

const PORT = 5293, base = 'http://127.0.0.1:' + PORT;
let failed = 0; const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
let who = peer; const seen = [];
const page = async () => {
  const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.errs = errs;
  await p.setRequestInterception(true);
  p.on('request', async (q) => {
    const u = new URL(q.url());
    if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
    const user = (await pool.query('SELECT id, username, email, display_name FROM users WHERE id = $1', [who])).rows[0];
    if (u.pathname === '/api/auth/me') return json(200, { success: true, user: { ...user, avatar_url: null, email_verified: true } });
    if (u.pathname === '/api/workspaces') return json(200, { success: true, workspaces: [{ id: W, workspace_type: 'company', name: 'Dir Co', member_role: 'editor' }] });
    if (u.pathname === '/api/workforce/evaluation/roster') {
      try { const d = await readWorkforceRoster(pool, { actorUserId: who, clientId: 'legacy-workforce-session' }, JSON.parse(q.postData())); seen.push(JSON.stringify(d)); return json(200, d); }
      catch (e) { return json(e.status || 500, { success: false, code: e.code }); }
    }
    if (u.pathname === '/api/workforce/evaluation') {
      // the REAL service, as the signed-in user (its route's own shape checks are proven in scripts/workforce-routes.test.mjs)
      try { const d = await readWorkforceEvaluation(pool, { actorUserId: who, clientId: 'legacy-workforce-session' }, JSON.parse(q.postData())); seen.push(JSON.stringify(d)); return json(200, d); }
      catch (e) { return json(e.status || 500, { success: false, code: e.code }); }
    }
    if (u.pathname.startsWith('/api/people')) {
      const r = await fetch(REAL + u.pathname + u.search, { method: q.method(), headers: { 'content-type': 'application/json', 'x-test-user': who }, body: ['GET', 'HEAD'].includes(q.method()) ? undefined : q.postData() });
      const body = await r.text(); seen.push(body);
      return q.respond({ status: r.status, contentType: 'application/json', body });
    }
    return json(200, { success: true });
  });
  return p;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (p, f, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(f).catch(() => false)) return true; await wait(150); } return false; };
const text = (p) => p.$eval('#main', (e) => e.innerText).catch(() => '');

try {
  const p = await page();
  await p.goto(`${base}/workspace/workspace/Directory?ws=${W}`, { waitUntil: 'domcontentloaded' });
  ok(await until(p, () => /Emil Employee/.test(document.querySelector('#main')?.innerText || '') && /Sound engineer/.test(document.querySelector('#main')?.innerText || '')), 'the directory lists the workspace’s people with their titles');
  await shot(p, 'directory');
  ok(await p.evaluate(() => !!document.querySelector('#main .topbar .pg-top-tabs [data-xdir="tab"][data-to="Directory/org-chart"]') && !document.querySelector('#main .mview [data-xdir="tab"]')), 'Directory · Org chart · My work are tabs in the header bar, not a row in the body');
  await p.evaluate((id) => document.querySelector(`[data-xdir="open"][data-id="${id}"]`).click(), emp);
  ok(await until(p, (id) => location.pathname.endsWith(`/Directory/${id}`), 8000, emp) || new URL(p.url()).pathname.endsWith(`/Directory/${emp}`), 'a person opens at their id');
  ok(await until(p, () => /Reports to/.test(document.querySelector('#main')?.innerText || '')), 'the person page shows the reporting line');
  const t1 = await text(p);
  ok(!/SECRET-NOTE-42|555 0101/.test(t1) && !(await p.$('[data-private]')), 'a peer does not see private fields on the page');
  ok(!seen.some((b) => /SECRET-NOTE-42|555 0101/.test(b)), 'and the server never sent them to a peer');
  const at = p.url();
  await p.reload({ waitUntil: 'domcontentloaded' });
  ok(await until(p, () => /Emil Employee/.test(document.body.innerText || '') && /Reports to/.test(document.querySelector('#main')?.innerText || '')) && p.url() === at, 'refresh lands on the same person');
  await p.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  ok(await until(p, () => /\/Directory$/.test(location.pathname) && /Pia Peer/.test(document.querySelector('#main')?.innerText || '')), 'Back returns to the directory');
  const p2 = await page();
  await p2.goto(at, { waitUntil: 'domcontentloaded' });
  ok(await until(p2, () => /Emil Employee/.test(document.body.innerText || '') && /Reports to/.test(document.querySelector('#main')?.innerText || '')), 'a fresh tab opens the same person');
  // positive control: the person themself sees their private fields
  who = emp;
  const p3 = await page();
  await p3.goto(at, { waitUntil: 'domcontentloaded' });
  ok(await until(p3, () => /SECRET-NOTE-42/.test(document.querySelector('#main')?.innerText || '') && !!document.querySelector('[data-private]')), 'the person sees their own private fields');
  // ── work report: what a person directed, did, checked and answers for; counts, never a score
  await p3.evaluate(() => [...document.querySelectorAll('[data-xdir="tab"]')].find((b) => /Work report/.test(b.textContent))?.click());
  await until(p3, () => /\/work\/30$/.test(location.pathname));
  ok(new URL(p3.url()).pathname.endsWith(`/Directory/${emp}/work/30`), 'Work report opens at /Directory/<id>/work/30');
  ok(await until(p3, () => /Work report/.test(document.querySelector('#main')?.innerText || '') && /Emil Employee/.test(document.querySelector('#main')?.innerText || '') && /Tasks created/.test(document.querySelector('#main')?.innerText || '')), 'the person sees their own work report');
  const rep = await p3.evaluate(() => Object.fromEntries([...document.querySelectorAll('.xdir-tile')].map((t) => [t.querySelector('span').textContent, t.querySelector('b').textContent])));
  ok(rep['Tasks created'] === '2' && rep['Closed without review'] === '1' && rep.Finished === '1' && rep['Never reviewed'] === '1', `the counts are the records' (${JSON.stringify(rep)})`);
  ok(/None of the 1 finished tasks went through a review/.test(await text(p3)), 'a fact is stated plainly, not as a verdict');
  ok(!/(score|rating)\s*[:=]?\s*\d/i.test(await text(p3)) && /no score/.test(await text(p3)), 'no score, and the page says so');
  ok(await p3.evaluate(() => !!document.querySelector('#main .topbar .pg-top-tabs [data-to$="/work/7"]')), 'the periods are tabs in the header bar');
  await p3.evaluate(() => document.querySelector('[data-to$="/work/7"]').click());
  // the breadcrumb names the period: … / Work report / 7 days
  ok(await until(p3, () => /\/work\/7$/.test(location.pathname) && /Work report\s*\/\s*7 days/.test(document.querySelector('#main')?.innerText || '')), 'a period has its own address, named in the breadcrumb');
  const wat = p3.url();
  await p3.reload({ waitUntil: 'domcontentloaded' });
  ok(await until(p3, () => /Work report\s*\/\s*7 days/.test(document.querySelector('#main')?.innerText || '') && /Tasks created/.test(document.querySelector('#main')?.innerText || '')) && p3.url() === wat, 'refresh lands on the same report and period');
  who = owner;
  const p4 = await page(); await p4.goto(wat, { waitUntil: 'domcontentloaded' });
  ok(await until(p4, () => /Work report/.test(document.querySelector('#main')?.innerText || '') && /Emil Employee/.test(document.querySelector('#main')?.innerText || '')), 'an admin of the workspace sees it (fresh tab)');
  who = peer; seen.length = 0;
  const p5 = await page(); await p5.goto(wat, { waitUntil: 'domcontentloaded' });
  ok(await until(p5, () => /You cannot see this report/.test(document.querySelector('#main')?.innerText || '')), 'a peer is told they cannot see it');
  ok(!seen.some((b) => /closedWithoutReview|"tasks"/.test(b)), 'and no figure of it was sent to the peer');
  ok(/Credits/.test(await text(p4)) && /Runs charged/.test(await text(p4)) && /billed to the person/.test(await text(p4)), 'credits in a workspace are the run charges, and the page says why');
  // ── group work: one row per member; the owner manages the employee
  who = owner;
  const p6 = await page(); await p6.goto(`${base}/workspace/workspace/Directory/reports/${owner}/30?ws=${W}`, { waitUntil: 'domcontentloaded' });
  ok(await until(p6, () => /Emil Employee/.test(document.querySelector('#main')?.innerText || '') && /Never reviewed/.test(document.querySelector('#main')?.innerText || '')), 'a manager sees their reports’ work, one row each');
  // Name | Created 2 | To agents 0 | Reviews 0 | Within a minute 0 | Finished 1 | Never reviewed 1 | Closed by agent 0 | Runs 0 | Credits 0
  const row = await p6.evaluate((id) => [...document.querySelector(`[data-to="Directory/${id}/work/30"]`).children].map((c) => c.textContent.trim()), emp);
  ok(row.slice(1).join(',') === '2,0,0,0,1,1,0,0,0', `the row carries the member's counts (${row.join(' | ')})`);
  ok(await p6.evaluate(() => /Reports work\s*\/\s*Olga Owner\s*\/\s*30 days/.test(document.querySelector('#main')?.innerText || '')), 'the breadcrumb names the group and period');
  await p6.evaluate((id) => document.querySelector(`[data-to="Directory/${id}/work/30"]`).click(), emp);
  ok(await until(p6, (id) => /\/work\/30$/.test(location.pathname) && /Tasks created/.test(document.querySelector('#main')?.innerText || '')), 'a row opens that member’s own report');
  who = peer; seen.length = 0;
  const p7 = await page(); await p7.goto(`${base}/workspace/workspace/Directory/reports/${owner}/30?ws=${W}`, { waitUntil: 'domcontentloaded' });
  ok(await until(p7, () => /You cannot see this report/.test(document.querySelector('#main')?.innerText || '')), 'a peer cannot read someone else’s reports');
  ok(!seen.some((b) => /tasksCreated/.test(b)), 'and no row was sent to them');
  ok(![p, p2, p3, p4, p5, p6, p7].some((x) => x.errs.length), `no page errors (${[p, p2, p3, p4, p5, p6, p7].flatMap((x) => x.errs).slice(0, 3).join(' | ')})`);
} finally { await br.close(); await server.close(); real.close(); await pool.end(); }
console.log(failed ? `${failed} failed` : 'directory-test: all passed');
process.exit(failed ? 1 : 0);
