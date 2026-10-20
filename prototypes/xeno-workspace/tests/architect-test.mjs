// architect-test — "Start from your documents or your idea" end to end, in a real browser: the setup and plan/apply
// calls answered by the REAL routes (routes/modesRoutes.js → services/modeApply.js) on real Postgres, the proposal by
// the REAL services/workspaceArchitect.js with a deterministic model and meter in place of the provider. Only sign-in
// and the Library listing are stood in. Proves: the tile opens the step; a picked file + an idea become a proposal
// whose parts cite the file; the person renames it and removes a task; Next plans it; Set it up applies exactly the
// edited version (one receipt, pack proposal:<id>); and Division home offers "Propose this division from documents".
//   DATABASE_URL=postgresql://…/<disposable> node prototypes/xeno-workspace/tests/architect-test.mjs
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import http from 'node:http';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(path.join(repo, 'src/server/package.json'));
const puppeteer = createRequire(import.meta.url)('puppeteer'), express = require('express'), pg = require('pg');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const { runAllMigrations } = await import('../../../src/server/services/migrationRunner.js');
const { writeTuples } = await import('../../../src/server/utils/authzReBAC.js');
const { meModesRouter, workspaceModesRouter } = await import('../../../src/server/routes/modesRoutes.js');
const architect = await import('../../../src/server/services/workspaceArchitect.js');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await runAllMigrations(pool);
const tag = `ar${process.pid}`;
const uid = (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at) VALUES ($1,$2,'Ana',true,true,'x',now()) RETURNING id`, [tag, `${tag}@xeno.test`])).rows[0].id;
const USER = { id: uid, username: tag, email: `${tag}@xeno.test`, display_name: 'Ana', avatar_url: null, email_verified: true };
const fid = (await pool.query(`INSERT INTO user_files (user_id, owner_user_id, filename, original_name, file_type, mime_type, file_size, storage_path, storage_type) VALUES ($1,$1,'plan.txt','plan.txt','text','text/plain',5,'/tmp/x','platform-upload') RETURNING id`, [uid])).rows[0].id;
const ing = (await pool.query(`INSERT INTO library_asset_ingestions (asset_id, content_sha256, mime_type, state) VALUES ($1,$2,'text/plain','ready') RETURNING id`, [fid, 'b'.repeat(64)])).rows[0].id;
await pool.query(`INSERT INTO library_asset_chunks (ingestion_id, asset_id, ordinal, content, token_count) VALUES ($1,$2,0,'We repair bicycles and sell spare parts online.',10)`, [ing, fid]);
await writeTuples(pool, { writes: [{ object: `library_asset:${fid}`, relation: 'owner', subject: `user:${uid}` }] });

let modelSaw = '';
const complete = async ({ messages }) => { modelSaw = messages.map((m) => m.content).join('\n'); return { choices: [{ message: { content: JSON.stringify({
  title: 'Bike workshop', summary: 'Repairs and a parts shop.', mode: { name: 'Bike shop', products: ['scheduling', 'sites', 'crm'], cites: ['S1', 'S2'] },
  tasks: [{ title: 'List your repair prices', cites: ['S2'] }, { title: 'Open the parts shop', cites: ['S2'] }, { title: 'Remove me', cites: ['S1'] }],
  divisions: [{ name: 'Workshop', purpose: 'Repairs', cites: ['S2'] }] }) } }] }; };
const meter = async (_db, _who, o) => ({ result: await o.run({ maxOutputTokens: 1000 }), creditsCharged: 0.3, costMicro: 300_000 });

const app = express();
app.use((req, _res, next) => { req.db = pool; req.user = { id: uid }; next(); });
app.post('/api/v2/workspaces/:wid/architect/proposals', express.json(), (req, res) => architect.propose(pool, { id: uid }, { ...req.body, workspaceId: req.params.wid }, { complete, meter })
  .then((o) => res.json({ success: true, ...o })).catch((e) => res.status(e.status || 500).json({ success: false, error: e.code, message: e.message })));
app.use('/api/v2/me/modes', meModesRouter); app.use('/api/v2/workspaces', workspaceModesRouter);
const real = http.createServer(app); await new Promise((r) => real.listen(0, '127.0.0.1', r));
const REAL = `http://127.0.0.1:${real.address().port}`;

const PORT = 5289, base = 'http://127.0.0.1:' + PORT;
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
  if (u.pathname === '/api/library/assets') return json(200, { success: true, items: [{ source: 'file', id: fid, name: 'plan.txt' }], total: 1, has_more: false });
  if (u.pathname.startsWith('/api/v2/me/modes') || u.pathname.startsWith('/api/v2/workspaces/')) {
    const r = await fetch(REAL + u.pathname + u.search, { method: q.method(), headers: { 'content-type': 'application/json' }, body: ['GET', 'HEAD'].includes(q.method()) ? undefined : q.postData() });
    return q.respond({ status: r.status, contentType: 'application/json', body: await r.text() });
  }
  return json(404, { success: false, error: 'not found' });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (f, ...a) => p.evaluate(f, ...a);
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(f).catch(() => false)) return true; await wait(100); } return false; };
const n = async (sql, a = []) => Number((await pool.query(sql, a)).rows[0].n);

try {
  await p.goto(base + '/workspace/?setup=business#/overview', { waitUntil: 'domcontentloaded' });
  ok(await until(() => !!document.querySelector('[data-xsu="docs"]')), 'the setup offers “Start from your documents or your idea”');
  await ev(() => document.querySelector('[data-xsu="docs"]').click());
  ok(await until(() => !!document.querySelector('[data-xsu="pick"]')), 'it lists the person’s files to pick');
  await p.type('[data-xsu-idea]', 'A bicycle repair shop.');
  await ev(() => document.querySelector('[data-xsu="pick"]').click());
  ok(await n(`SELECT count(*) n FROM architect_proposals`) === 0, 'nothing is proposed before asking');
  await ev(() => document.querySelector('[data-xsu="propose"]').click());
  ok(await until(() => !!document.querySelector('[data-xsu-mname]'), 10000), 'the proposal is shown, to edit');
  ok(modelSaw.includes('We repair bicycles') && modelSaw.includes('A bicycle repair shop.'), 'the model was given the picked file and the idea');
  const txt = await ev(() => document.querySelector('.xsu').innerText);
  ok(/plan\.txt/.test(txt) && /Workshop/.test(txt), 'its parts cite the file, and suggested divisions are shown');
  await ev(() => { const i = document.querySelector('[data-xsu-mname]'); i.value = 'Spoke & Chain'; });
  await ev(() => [...document.querySelectorAll('[data-xsu-task]')].find((i) => i.value === 'Remove me').closest('li').querySelector('[data-xsu="task-del"]').click());
  ok(await until(() => document.querySelectorAll('[data-xsu-task]').length === 2), 'a task can be removed');
  await ev(() => document.querySelector('[data-xsu="use"]').click());
  ok(await until(() => /Here is your workspace/.test(document.querySelector('.xsu')?.innerText || ''), 10000), 'Next plans it');
  const pr = (await pool.query(`SELECT * FROM architect_proposals`)).rows[0];
  ok(pr.edited_at && pr.pack.mode.name === 'Spoke & Chain' && pr.pack.tasks.length === 2, 'the person’s edits are kept on the proposal');
  ok(await n(`SELECT count(*) n FROM workspace_mode_applications`) === 0, 'planning applied nothing');
  await ev(() => document.querySelector('[data-xsu="apply"]').click());
  ok(await until(async () => true, 300) && await (async () => { for (let i = 0; i < 80; i++) { if (await n(`SELECT count(*) n FROM workspace_mode_applications`)) return true; await wait(100); } return false; })(), 'Set it up applies it');
  const rec = (await pool.query(`SELECT * FROM workspace_mode_applications`)).rows[0];
  ok(rec.pack_id === `proposal:${pr.id}` && rec.applied_by_user_id === uid, 'one receipt, for the proposal, applied by the person');
  ok((await pool.query(`SELECT name FROM custom_modes WHERE source_application_id = $1`, [rec.id])).rows[0]?.name === 'Spoke & Chain', 'the applied mode is the edited one');
  ok(await n(`SELECT count(*) n FROM tasks t JOIN chat_projects c ON c.id = t.project_id WHERE c.workspace_id = $1 AND t.deleted_at IS NULL`, [rec.workspace_id]) === 2, 'only the tasks the person kept were created');
  ok(await n(`SELECT count(*) n FROM workforce_divisions WHERE workspace_id = $1 AND name = 'Workshop' AND lifecycle = 'active'`, [rec.workspace_id]) === 1, 'the suggested division was set up with it');
  // Division home entry
  await ev(() => { const b = document.createElement('button'); b.dataset.xsu = 'open-docs'; b.dataset.idea = 'The Sales division: '; b.id = 'probe'; document.body.appendChild(b); b.click(); });
  ok(await until(() => (document.querySelector('[data-xsu-idea]')?.value || '').startsWith('The Sales division')), 'the Division home entry opens the documents step with the division named');
  ok(!errs.length, `no page errors (${errs.slice(0, 3).join(' | ')})`);
} finally { await br.close(); await server.close(); real.close(); await pool.end(); }
console.log(failed ? `${failed} failed` : 'architect-test: all passed');
process.exit(failed ? 1 : 0);
