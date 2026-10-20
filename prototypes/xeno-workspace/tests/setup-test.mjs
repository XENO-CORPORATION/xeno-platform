// setup-test — the business setup (MODES SPEC §8c.4) end to end: the workspace in a real browser, its custom-mode and
// setup calls answered by the REAL routes (src/server/routes/modesRoutes.js → services/modeApply.js) on real Postgres.
// Only sign-in (/api/auth/me) and unrelated endpoints are stood in. Proves: ?setup=business opens "What do you do?",
// with no AI words on the first screens; pick Salon → name → "Here is your workspace" → Set it up; the workspace lands
// in the Salon mode, the receipt and three starter tasks exist in the database; a reload keeps the mode (served by
// the platform, not this browser); Undo from the same window reverts it.
//   DATABASE_URL=postgresql://…/<disposable> node prototypes/xeno-workspace/tests/setup-test.mjs
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import http from 'node:http';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(path.join(repo, 'src/server/package.json'));
const puppeteer = createRequire(import.meta.url)('puppeteer'), express = require('express'), pg = require('pg');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const { runAllMigrations } = await import('../../../src/server/services/migrationRunner.js');
const { meModesRouter, workspaceModesRouter } = await import('../../../src/server/routes/modesRoutes.js');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await runAllMigrations(pool);
const tag = `su${process.pid}`;
const uid = (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at) VALUES ($1,$2,'Ana',true,true,'x',now()) RETURNING id`, [tag, `${tag}@xeno.test`])).rows[0].id;
const USER = { id: uid, username: tag, email: `${tag}@xeno.test`, display_name: 'Ana', avatar_url: null, email_verified: true };

const app = express();
app.use((req, _res, next) => { req.db = pool; req.user = { id: uid }; next(); });
app.use('/api/v2/me/modes', meModesRouter); app.use('/api/v2/workspaces', workspaceModesRouter);
const real = http.createServer(app); await new Promise((r) => real.listen(0, '127.0.0.1', r));
const REAL = `http://127.0.0.1:${real.address().port}`;

const PORT = 5287, base = 'http://127.0.0.1:' + PORT;
let failed = 0; const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', async (q) => {
  const u = new URL(q.url());
  if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER });
  if (u.pathname.startsWith('/api/v2/me/modes') || u.pathname.startsWith('/api/v2/workspaces/')) {
    const r = await fetch(REAL + u.pathname + u.search, { method: q.method(), headers: { 'content-type': 'application/json' }, body: ['GET', 'HEAD'].includes(q.method()) ? undefined : q.postData() });
    return q.respond({ status: r.status, contentType: 'application/json', body: await r.text() });
  }
  return json(404, { success: false, error: 'not found' });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (f) => p.evaluate(f);
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(f).catch(() => false)) return true; await wait(100); } return false; };
const n = async (sql, a = []) => Number((await pool.query(sql, a)).rows[0].n);

try {
  await p.goto(base + '/workspace/?setup=business#/overview', { waitUntil: 'domcontentloaded' });
  ok(await until(() => document.querySelectorAll('.xsu-trade').length >= 4), 'the setup opens from its address and asks “What do you do?”');
  const first = await ev(() => document.querySelector('.xsu')?.closest('.xd-sh, .xd, [role="dialog"]')?.innerText || document.querySelector('.xsu').innerText);
  ok(!/\b(AI|agents?|models?|prompts?)\b/i.test(first), `no AI words on the first screen (${JSON.stringify(first.slice(0, 120))})`);
  ok(await ev(() => /setup=business/.test(location.search)), 'the open setup is in the address');
  await ev(() => [...document.querySelectorAll('.xsu-trade')].find((b) => /salon/i.test(b.innerText)).click());
  ok(await until(() => !!document.querySelector('.xsu [data-q="businessName"]')), 'Salon asks for the business name');
  await p.type('.xsu [data-q="businessName"]', 'Studio Ana');
  await ev(() => document.querySelector('[data-xsu="next"]').click());
  ok(await until(() => document.querySelectorAll('.xsu-room').length >= 4), 'the plan shows “Here is your workspace” with its rooms');
  const plan = await ev(() => document.querySelector('.xsu').innerText);
  ok(/Here is your workspace/.test(plan) && /Studio Ana/.test(plan) && /Nothing is charged/.test(plan), 'the plan names the business and its cost');
  ok(await n(`SELECT count(*) n FROM workspace_mode_applications`) === 0, 'planning wrote nothing');
  await ev(() => document.querySelector('[data-xsu="apply"]').click());
  ok(await until(() => /c-salon/.test(location.pathname + location.hash), 10000), `the workspace opens in the Salon mode (${await ev(() => location.pathname + location.hash)})`);
  const rec = (await pool.query(`SELECT * FROM workspace_mode_applications`)).rows;
  ok(rec.length === 1 && rec[0].applied_by_user_id === uid && rec[0].pack_id === 'salon', 'one receipt, applied by the person, for the salon pack');
  ok(await n(`SELECT count(*) n FROM tasks t JOIN chat_projects p ON p.id=t.project_id WHERE p.workspace_id=$1 AND t.assignee_id=$2 AND t.deleted_at IS NULL`, [rec[0].workspace_id, uid]) === 3, 'three first tasks are waiting, in the workspace, assigned to the person');
  ok(await ev(() => window.XENO_CUSTOM.list().some((c) => c.id === 'c-salon' && c.workspaceId)), 'the mode is on the shelf, from the workspace');
  ok(await ev(() => !/setup=/.test(location.search)), 'closing the setup takes it out of the address');
  await ev(() => localStorage.removeItem('xw.customs'));   // a fresh browser: nothing cached, only the address
  await p.reload({ waitUntil: 'domcontentloaded' });
  ok(await until(() => window.XENO_CUSTOM?.server && window.XENO_CUSTOM.list().some((c) => c.id === 'c-salon') && /c-salon/.test(location.pathname + location.hash), 10000), 'a fresh browser with only the link opens the mode — it comes from the platform');
  await ev(() => window.XSETUP.open());
  ok(await until(() => !!document.querySelector('[data-xsu="undo"]')), 'the setup window lists what is set up, with Undo');
  await ev(() => document.querySelector('[data-xsu="undo"]').click());
  ok(await until(async () => true, 300) && await (async () => { for (let i = 0; i < 50; i++) { if ((await pool.query(`SELECT reverted_at FROM workspace_mode_applications`)).rows[0].reverted_at) return true; await wait(100); } return false; })(), 'Undo reverts the setup on the server');
  ok(await until(() => !window.XENO_CUSTOM.list().some((c) => c.id === 'c-salon')), 'and the mode leaves the shelf');
  ok(!errs.length, `no page errors (${errs.slice(0, 3).join(' | ')})`);
} finally { await br.close(); await server.close(); real.close(); await pool.end(); }
console.log(failed ? `${failed} failed` : 'setup-test: all passed');
process.exit(failed ? 1 : 0);
