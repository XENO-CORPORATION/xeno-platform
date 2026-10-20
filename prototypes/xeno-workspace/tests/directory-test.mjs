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
  ok(![p, p2, p3].some((x) => x.errs.length), `no page errors (${[p, p2, p3].flatMap((x) => x.errs).slice(0, 3).join(' | ')})`);
} finally { await br.close(); await server.close(); real.close(); await pool.end(); }
console.log(failed ? `${failed} failed` : 'directory-test: all passed');
process.exit(failed ? 1 : 0);
