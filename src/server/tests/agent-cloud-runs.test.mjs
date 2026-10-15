/**
 * Agent cloud runs: a person runs one of their own platform agents on a task, in the cloud.
 *
 *   - the run starts in xeno-agents-api as the PERSON (a delegated token, revoked straight after), carrying the
 *     agent's pinned instructions, its runtime config and an agent credential the platform minted for the run;
 *   - the task is delegated to the agent first, under the same rules as the task page;
 *   - the credential works as the agent, and is revoked when the run ends, when it is stopped, or when the
 *     runner refuses or cannot be reached;
 *   - pressing it twice while a run is live returns the same run;
 *   - someone else's agent or a task the person cannot see is refused.
 *
 * Runs against a real database and a stand-in agents-api on a local socket.
 * Run: DATABASE_URL=postgres://… node src/server/tests/agent-cloud-runs.test.mjs
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import chatRoutes from '../routes/chatRoutes.js';
import { personOnly } from '../routes/xenoMcpRoutes.js';
import xenoTasksRoutes, { taskTokenAuth, unlessTaskToken, mcpChallenge } from '../routes/xenoTasksRoutes.js';
import platformAgentRoutes from '../routes/platformAgentRoutes.js';
import { authMiddleware } from '../middleware/auth.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const check_ = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  await migrateOidcClients(pool);
  const mk = async (m) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW())
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [m, `${m}@example.test`])).rows[0].id;
  const ada = await mk('acr-ada'), bob = await mk('acr-bob');
  const session = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });

  // the stand-in agents-api: records each request, answers as the real one does
  const seen = [];
  let mode = 'ok', capable = true;
  const runs = new Map();
  const runner = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, idem: req.headers['idempotency-key'], body });
    const send = (s, j) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.method === 'GET' && req.url === '/status') return send(200, { ok: true, capabilities: ['runs.start', ...(capable ? ['runs.platformAgent'] : [])] });
    if (req.method === 'POST' && req.url === '/runs') {
      if (mode === 'refuse') return send(402, { error: 'insufficient_credits' });
      if (mode === 'down') { res.destroy(); return; }
      const id = 'run_' + (runs.size + 1); runs.set(id, 'queued');
      return send(201, { run: { runId: id, status: 'queued' } });
    }
    const m = req.url.match(/^\/runs\/([^/]+)(\/stop)?$/);
    if (m && req.method === 'GET') return send(200, { run: { runId: m[1], status: runs.get(m[1]) || 'queued' } });
    if (m && m[2]) { runs.set(m[1], 'cancelled'); return send(200, { run: { runId: m[1], status: 'cancelled' } }); }
    send(404, { error: 'not_found' });
  });
  await new Promise((r) => runner.listen(0, '127.0.0.1', r));
  process.env.AGENTS_API_BASE_URL = `http://127.0.0.1:${runner.address().port}`;

  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/chat', (req, _r, n) => { req.user = { id: req.headers['x-as'] || ada }; n(); }, chatRoutes);
  app.use('/api/tasks', mcpChallenge, taskTokenAuth, unlessTaskToken(authMiddleware), xenoTasksRoutes);
  app.use('/api/agents', authMiddleware, personOnly, platformAgentRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body } = {}) => {
    const r = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; const t = await r.text(); try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    return { s: r.status, j };
  };
  const A = session(ada), B = session(bob);

  try {
    const proj = String((await call('POST', '/api/chat/projects', { body: { name: 'Runs project' } })).j.project?.id
      || (await pool.query(`SELECT id FROM chat_projects WHERE name = 'Runs project' ORDER BY created_at DESC LIMIT 1`)).rows[0].id);
    const ag = (await call('POST', '/api/agents', { token: A, body: { name: 'Runner', instructions: 'Keep it small.', runtime: { model: 'gpt-5.5', effort: 'medium', tools: { deny: ['Bash'] } } } })).j.agent;
    await call('PUT', `/api/agents/${ag.id}/projects/${proj}`, { token: A, body: {} });
    const task = (await call('POST', '/api/tasks', { token: A, body: { title: 'Fix the header', body: 'It is too tall.', projectId: proj } })).j.task;
    check_(task && /^T-\d+$/.test(task.key), 'a task to run on');

    // start
    const st = await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: task.key, budgetCredits: 5 } });
    check_(st.s === 201 && st.j.run.state === 'queued' && st.j.run.runId === 'run_1' && st.j.run.version === ag.version, `a run starts and is recorded against the pinned version (${st.s} ${st.j && st.j.code})`);
    check_(!JSON.stringify(st.j).includes('xtk_'), 'the agent credential is never returned to the browser');
    const sent = seen.find((x) => x.method === 'POST' && x.url === '/runs');
    const claims = jwt.decode(String(sent.auth).slice(7));
    check_(claims && claims.sub === ada && claims.client_id === 'xeno-agent-runs' && claims.act && claims.act.agent_run_id === st.j.run.id, 'the runner is asked AS the person, by the agent-runs broker, naming this run');
    check_(sent.idem === `agent-run:${st.j.run.id}`, 'with an idempotency key fixed to this run, so a lost reply never starts a second run');
    const pa = sent.body.platformAgent;
    check_(pa && pa.agentId === ag.id && /^xtk_/.test(pa.credential) && pa.issuer && pa.tools && pa.tools.deny[0] === 'Bash', 'the run is told which agent it is, with a credential, the XENO origin and the tool scope');
    check_(sent.body.model === 'gpt-5.5' && sent.body.effort === 'medium' && sent.body.budget.maxCredits === 5, 'its runtime config and the budget go with it');
    check_(/Keep it small\./.test(sent.body.prompt) && sent.body.prompt.includes(task.key) && /too tall/.test(sent.body.prompt), 'the prompt carries its instructions and the task');
    const sid = (await pool.query('SELECT delegated_sids FROM agent_cloud_runs WHERE id = $1', [st.j.run.id])).rows[0].delegated_sids[0];
    const sess = (await pool.query('SELECT revoked_at FROM oauth_session_state WHERE sid = $1', [sid])).rows[0];
    check_(sess && sess.revoked_at, 'the person’s delegated token is revoked as soon as the runner has answered');

    // the credential acts as the agent; the task is now delegated to it
    const me = await call('GET', '/api/tasks/agent/me', { token: pa.credential });
    check_(me.s === 200 && me.j.agent.agentId === ag.id, 'inside the run, the credential acts as the agent');
    const t1 = (await call('GET', `/api/tasks/${task.key}`, { token: A })).j.task;
    check_(t1.delegate && String(t1.delegate.id) === String(ag.userId), 'the task was delegated to the agent first');
    const rep = await call('POST', `/api/tasks/${task.key}/activity`, { token: pa.credential, body: { type: 'action', body: 'reading the CSS' } });
    check_(rep.s === 200, 'so the run can report on it as its delegate');

    // a second press while it is live returns the same run
    const again = await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: task.key } });
    check_(again.s === 200 && again.j.run.id === st.j.run.id && seen.filter((x) => x.url === '/runs').length === 1, 'pressing Run again while it is live returns the same run, and starts nothing');

    // list shows it, refreshed from the runner
    const list = await call('GET', `/api/agents/${ag.id}/runs`, { token: A });
    check_(list.s === 200 && list.j.runs[0].task === task.key && list.j.runs[0].state === 'queued', 'the agent lists its runs with the task');

    // the runner finishes it: the next refresh ends it and revokes the credential
    runs.set(st.j.run.runId, 'completed'); seen.length = 0;
    const after = await call('GET', `/api/agents/${ag.id}/runs`, { token: A });
    check_(after.j.runs[0].state === 'completed' && after.j.runs[0].endedAt, 'when the runner reports it finished, the run ends');
    check_((await call('GET', '/api/tasks/agent/me', { token: pa.credential })).s === 401, 'and its credential stops working');

    // stop
    const task2 = (await call('POST', '/api/tasks', { token: A, body: { title: 'Second', projectId: proj } })).j.task;
    const r2 = (await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: task2.key } })).j.run;
    const cred2 = seen.find((x) => x.url === '/runs').body.platformAgent.credential;
    const stopped = await call('POST', `/api/agents/runs/${r2.id}/stop`, { token: A });
    check_(stopped.s === 200 && stopped.j.run.state === 'cancelled' && seen.some((x) => x.url === `/runs/${r2.runId}/stop`), 'Stop stops the hosted run');
    check_((await call('GET', '/api/tasks/agent/me', { token: cred2 })).s === 401, 'and revokes its credential at once');
    check_((await call('POST', `/api/agents/runs/${r2.id}/stop`, { token: B })).s === 404, "someone else cannot stop it");

    // the runner refuses / is down: recorded, credential revoked
    mode = 'refuse'; seen.length = 0;
    const task3 = (await call('POST', '/api/tasks', { token: A, body: { title: 'Third', projectId: proj } })).j.task;
    const r3 = (await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: task3.key } })).j.run;
    check_(r3.state === 'refused' && r3.reason === 'insufficient_credits', 'a refusal by the runner is recorded with its reason (not enough credits)');
    check_((await call('GET', '/api/tasks/agent/me', { token: seen.find((x) => x.url === '/runs').body.platformAgent.credential })).s === 401, 'and the credential it was given is revoked');
    mode = 'down'; seen.length = 0;
    const task4 = (await call('POST', '/api/tasks', { token: A, body: { title: 'Fourth', projectId: proj } })).j.task;
    const r4 = (await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: task4.key } })).j.run;
    check_(r4.state === 'uncertain' && r4.reason === 'transport_error', 'an unreachable runner is recorded as uncertain, never as a run that started');
    mode = 'ok';

    // refusals before anything is started
    check_((await call('POST', `/api/agents/${ag.id}/runs`, { token: B, body: { task: task.key } })).s === 404, "someone else's agent cannot be run");
    check_((await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: 'T-999999' } })).s === 404, 'an unknown task is refused');
    check_((await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: task.key, budgetCredits: 5000 } })).j.code === 'invalid_budget', 'a budget beyond the limit is refused');
    let trig = null; try { await pool.query('UPDATE agent_cloud_runs SET task_id = $2 WHERE id = $1', [st.j.run.id, task2.id]); } catch (e) { trig = e; }
    check_(trig && trig.code === '23514', 'the database refuses to re-point a run at another task');
    capable = false; seen.length = 0;
    const old = await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: task4.key } });
    check_(old.s === 503 && old.j.code === 'runner_lacks_agents' && !seen.some((x) => x.url === '/runs'), 'a runner that does not advertise platform agents is refused BEFORE anything starts or is charged');
    capable = true;
    const saved = process.env.AGENTS_API_BASE_URL; delete process.env.AGENTS_API_BASE_URL;
    check_((await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: task4.key } })).j.code === 'cloud_runs_unavailable', 'without a runner configured, it says cloud runs are unavailable');
    process.env.AGENTS_API_BASE_URL = saved;
  } finally {
    server.close(); runner.close();
    await pool.end();
  }
  console.log(`\nagent-cloud-runs: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
