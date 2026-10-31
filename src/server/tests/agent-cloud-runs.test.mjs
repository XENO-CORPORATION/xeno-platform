/**
 * Agent cloud runs: a person runs one of their own platform agents on a task, in the cloud.
 *
 *   - the run starts in xeno-agents-api as the PERSON (a delegated token, revoked straight after), carrying the
 *     agent's pinned instructions, its runtime config and a REFERENCE to the run -- never a credential;
 *   - the runner, starting the run, asks for the agent credential once (service-authenticated); a second ask,
 *     an ended run, a wrong hosted run id and a missing service token are all refused;
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
import { stopListening } from '../services/agentPresenceStream.js';
import { createServiceLedgerRouter } from '../routes/serviceLedgerRoutes.js';
import { authMiddleware } from '../middleware/auth.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';
import { addGrant } from '../utils/creditLedgerV2.js';
import { revokeRun } from '../services/workforceRunAuthority.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const RUN = (n) => 'run_' + String(n).padStart(32, '0');
const check_ = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  await migrateOidcClients(pool);
  const mk = async (m) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW())
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [m, `${m}@example.test`])).rows[0].id;
  const ada = await mk('acr-ada'), bob = await mk('acr-bob'), poor = await mk('acr-poor');
  // RUN-01: an admission reserves the run's ceiling on the canonical ledger, so the person needs credits to start one
  await addGrant(pool, ada, { amountMicro: 100_000_000, kind: 'paid', sourceRef: 'seed:acr-ada' });
  const heldMicro = async () => BigInt((await pool.query(`SELECT coalesce(sum(amount_micro - settled_micro),0)::text AS h FROM credit_holds WHERE user_id=$1 AND state='held'`, [ada])).rows[0].h);
  const session = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });

  // the stand-in agents-api: records each request, answers as the real one does
  const seen = [];
  let mode = 'ok', capable = true, claimUrl = '', claimToken = '', claimed = null;
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
      const id = 'run_' + String(runs.size + 1).padStart(32, '0'); runs.set(id, 'queued');
      // the real runner can start the run and claim its credential BEFORE its answer reaches the platform
      if (mode === 'claim-first') { const c = await fetch(claimUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + claimToken }, body: JSON.stringify({ runRef: body.platformAgent.runRef, runId: id }) }); claimed = { s: c.status, j: await c.json().catch(() => null) }; }
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
  const SERVICE = 'svc-' + Math.random().toString(36).slice(2);
  app.use('/api/v2/ledger/service', createServiceLedgerRouter({ getServiceToken: () => SERVICE }));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body } = {}) => {
    const r = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; const t = await r.text(); try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    return { s: r.status, j };
  };
  const A = session(ada), B = session(bob);
  // what the runner does when it starts a run: ask for the agent credential by the run's reference
  claimUrl = origin + '/api/v2/ledger/service/agent-runs/credential'; claimToken = SERVICE;
  const issue = (runRef, runId, token = SERVICE) => call('POST', '/api/v2/ledger/service/agent-runs/credential', { token, body: { runRef, runId } });

  try {
    const proj = String((await call('POST', '/api/chat/projects', { body: { name: 'Runs project' } })).j.project?.id
      || (await pool.query(`SELECT id FROM chat_projects WHERE name = 'Runs project' ORDER BY created_at DESC LIMIT 1`)).rows[0].id);
    const ag = (await call('POST', '/api/agents', { token: A, body: { name: 'Runner', instructions: 'Keep it small.', runtime: { model: 'gpt-5.5', effort: 'medium', tools: { deny: ['Bash'] } } } })).j.agent;
    await call('PUT', `/api/agents/${ag.id}/projects/${proj}`, { token: A, body: {} });
    const task = (await call('POST', '/api/tasks', { token: A, body: { title: 'Fix the header', body: 'It is too tall.', projectId: proj } })).j.task;
    check_(task && /^T-\d+$/.test(task.key), 'a task to run on');

    // start
    const st = await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: task.key, budgetCredits: 5 } });
    check_(st.s === 201 && st.j.run.state === 'queued' && st.j.run.runId === RUN(1) && st.j.run.version === ag.version, `a run starts and is recorded against the pinned version (${st.s} ${st.j && st.j.code})`);
    check_(!JSON.stringify(st.j).includes('xtk_'), 'the agent credential is never returned to the browser');
    // RUN-01: the press that started it ADMITTED it, through the one admission service
    const adm = (await pool.query('SELECT a.* FROM agent_cloud_runs r JOIN workforce_run_admissions a ON a.id = r.admission_id WHERE r.id = $1', [st.j.run.id])).rows[0];
    check_(adm && st.j.run.admissionId === adm.id && adm.actor_user_id === ada && adm.target_kind === 'personal' && adm.agent_resource_id === ag.definitionId
      && adm.agent_version === ag.version && adm.task_ref === task.key && adm.budget_ceiling_micro === '5000000', `the run was admitted by its person, for its agent's pinned definition, with its budget (${JSON.stringify(adm && { k: adm.target_kind, b: adm.budget_ceiling_micro })})`);
    check_(await heldMicro() === 5_000_000n, 'and its ceiling is reserved on the ledger');
    let noAdm = null; try { await pool.query(`INSERT INTO agent_cloud_runs (owner_user_id, agent_user_id, task_id, agent_version, budget_credits) VALUES ($1,$2,$3,1,1)`, [ada, ag.userId, task.id]); } catch (e) { noAdm = e; }
    check_(noAdm && noAdm.code === '23514', 'the database refuses a cloud run that was never admitted');
    const sent = seen.find((x) => x.method === 'POST' && x.url === '/runs');
    const claims = jwt.decode(String(sent.auth).slice(7));
    check_(claims && claims.sub === ada && claims.client_id === 'xeno-agent-runs' && claims.act && claims.act.agent_run_id === st.j.run.id, 'the runner is asked AS the person, by the agent-runs broker, naming this run');
    check_(sent.idem === `agent-run:${st.j.run.id}`, 'with an idempotency key fixed to this run, so a lost reply never starts a second run');
    const pa = sent.body.platformAgent;
    check_(pa && pa.agentId === ag.id && pa.runRef === st.j.run.id && pa.issuer && pa.tools && pa.tools.deny[0] === 'Bash', 'the run is told which agent it is, the XENO origin, the tool scope and its run reference');
    check_(!JSON.stringify(sent.body).includes('xtk_') && !('credential' in pa), 'and NO credential: a queued run holds no live secret, not even in the runner');
    check_((await issue(pa.runRef, RUN(1), 'wrong')).s === 401, 'only the runner (the service token) may ask for a credential');
    check_((await issue(pa.runRef, RUN(999))).j.error.code === 'run_not_found', 'and only for the hosted run the platform started');
    const got = await issue(pa.runRef, RUN(1));
    check_(got.s === 200 && /^xtk_/.test(got.j.token) && got.j.agentId === ag.id && got.j.expiresAt, 'the runner, starting the run, gets the agent credential');
    check_((await issue(pa.runRef, RUN(1))).j.error.code === 'credential_issued', 'once: a second ask is refused, so a leaked reference mints nothing');
    pa.credential = got.j.token;
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

    // presence and activity: is it available, and what has it done?
    const pres = (await call('GET', '/api/agents/presence', { token: A })).j.agents.find((x) => x.id === ag.id);
    check_(pres && pres.state === 'working' && pres.canTakeWork === true && pres.run && pres.run.state === 'running', `a live cloud run shows the agent as working (${JSON.stringify(pres)})`);
    const log = (await call('GET', `/api/agents/${ag.id}/activity`, { token: A })).j;
    check_(log.items.some((x) => x.kind === 'task' && x.task === task.key && /reading the CSS/.test(x.detail)), 'its activity shows what it reported on the task');
    check_(log.items.some((x) => x.kind === 'run' && x.task === task.key), 'and the cloud run');
    check_(log.presence && log.presence.state === 'working', 'with its presence');
    check_((await call('GET', `/api/agents/${ag.id}/activity`, { token: B })).s === 404, 'someone else cannot read its log');

    // LIVE: the stream sends a snapshot, then a change the moment it happens (NOTIFY from the database)
    {
      const ctl = new AbortController(); const got = [];
      const res = await fetch(`${origin}/api/agents/presence/stream`, { headers: { authorization: `Bearer ${A}`, accept: 'text/event-stream' }, signal: ctl.signal });
      check_(res.status === 200 && /text\/event-stream/.test(res.headers.get('content-type') || ''), 'the presence stream opens as Server-Sent Events');
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
      const until = async (pred, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await Promise.race([reader.read(), new Promise((ok) => setTimeout(() => ok({ wait: true }), end - Date.now()))]); if (r.wait || r.done) break; buf += dec.decode(r.value); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /event: (\w+)/.exec(block), d = /data: (.*)/.exec(block); if (ev) got.push({ event: ev[1], data: d ? JSON.parse(d[1]) : null }); } if (pred()) return true; } return pred(); };
      check_(await until(() => got.some((x) => x.event === 'ready'), 5000) && got.some((x) => x.event === 'presence' && x.data.id === ag.id && x.data.state === 'working'), 'it starts with a snapshot: the agent is working');
      const t0 = Date.now();
      await call('POST', `/api/tasks/${task.key}/activity`, { token: pa.credential, body: { type: 'ask', body: 'Which export size?' } });
      check_(await until(() => got.some((x) => x.event === 'presence' && x.data.id === ag.id && x.data.state === 'asking'), 5000), 'when the agent asks a question, the stream says so at once');
      const asked = got.find((x) => x.event === 'presence' && x.data.state === 'asking');
      check_(asked && /Needs you on T-\d+/.test(asked.data.label) && asked.data.asking.note === 'Which export size?' && Date.now() - t0 < 3000, `with what it asked, within a moment (${Date.now() - t0} ms)`);
      ctl.abort();
    }
    await call('POST', `/api/tasks/${task.key}/activity`, { token: pa.credential, body: { type: 'action', body: 'exporting at 1080p' } });
    const back = (await call('GET', '/api/agents/presence', { token: A })).j.agents.find((x) => x.id === ag.id);
    check_(back.state === 'working' && back.doing && back.doing.note === 'exporting at 1080p', 'once it carries on, it is working again, and says on what');

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
    const told = (await pool.query(`SELECT kind, ref, actor_kind FROM user_notifications WHERE source = 'agents' AND dedupe_key = $1`, [`run:${st.j.run.id}`])).rows;
    check_(told.length === 1 && told[0].kind === 'run_finished' && told[0].ref.endsWith(`/Agents/${ag.id}/Work`) && told[0].actor_kind === 'agent', 'its owner is told, once, with the agent page as the address');
    await call('GET', `/api/agents/${ag.id}/runs`, { token: A });
    check_((await pool.query(`SELECT 1 FROM user_notifications WHERE source = 'agents' AND dedupe_key = $1`, [`run:${st.j.run.id}`])).rowCount === 1, 'reading its runs again tells nobody again');
    check_((await pool.query('SELECT 1 FROM workforce_run_revocations WHERE admission_id = $1', [adm.id])).rowCount === 1 && await heldMicro() === 0n, 'its admission is closed and its reservation released');
    check_((await call('GET', '/api/tasks/agent/me', { token: pa.credential })).s === 401, 'and its credential stops working');
    const pres2 = (await call('GET', '/api/agents/presence', { token: A })).j.agents.find((x) => x.id === ag.id);
    check_(pres2 && pres2.state !== 'working' && !pres2.run, `when the run ends it is no longer shown as working (${pres2 && pres2.state})`);

    // stop
    const task2 = (await call('POST', '/api/tasks', { token: A, body: { title: 'Second', projectId: proj } })).j.task;
    const r2 = (await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: task2.key } })).j.run;
    const ref2 = seen.find((x) => x.url === '/runs').body.platformAgent.runRef;
    const cred2 = (await issue(ref2, r2.runId)).j.token;
    const stopped = await call('POST', `/api/agents/runs/${r2.id}/stop`, { token: A });
    check_(stopped.s === 200 && stopped.j.run.state === 'cancelled' && seen.some((x) => x.url === `/runs/${r2.runId}/stop`), 'Stop stops the hosted run');
    check_((await call('GET', '/api/tasks/agent/me', { token: cred2 })).s === 401, 'and revokes its credential at once');
    check_((await call('POST', `/api/agents/runs/${r2.id}/stop`, { token: B })).s === 404, "someone else cannot stop it");
    check_((await issue(ref2, r2.runId)).j.error.code === 'run_ended', 'a stopped run can never be issued a credential');

    // RUN-03: revoking the ADMISSION (from anywhere: /run-admissions/revoke) ends the run end to end
    {
      const t = (await call('POST', '/api/tasks', { token: A, body: { title: 'Revoked', projectId: proj } })).j.task;
      seen.length = 0;
      const r = (await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: t.key } })).j.run;
      const ref = seen.find((x) => x.url === '/runs').body.platformAgent.runRef;
      await revokeRun(pool, { actorUserId: ada }, r.admissionId);
      const denied = await issue(ref, r.runId);
      check_(denied.s === 409 && denied.j.error.code === 'run_revoked', `a revoked admission mints no credential (${denied.s} ${denied.j && denied.j.error && denied.j.error.code})`);
      let dbRefused = null; try { await pool.query(`UPDATE agent_cloud_runs SET credential_id = gen_random_uuid(), state = 'running' WHERE id = $1`, [r.id]); } catch (e) { dbRefused = e; }
      check_(dbRefused && dbRefused.code === '23514', 'and the database refuses one written past the service');
      const t2 = (await call('POST', '/api/tasks', { token: A, body: { title: 'Revoked live', projectId: proj } })).j.task;
      seen.length = 0;
      const r2 = (await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: t2.key } })).j.run;
      const c2 = (await issue(seen.find((x) => x.url === '/runs').body.platformAgent.runRef, r2.runId)).j.token;
      await revokeRun(pool, { actorUserId: ada }, r2.admissionId);
      const listed = (await call('GET', `/api/agents/${ag.id}/runs`, { token: A })).j.runs.find((x) => x.id === r2.id);
      check_(listed.state === 'cancelled' && listed.reason === 'admission_revoked' && seen.some((x) => x.url === `/runs/${r2.runId}/stop`), 'a live run whose admission is revoked is stopped at the runner');
      check_((await call('GET', '/api/tasks/agent/me', { token: c2 })).s === 401, 'and its credential stops working');
      // a ceiling beyond what the person can fund (the free allowance is 50) is refused before anything starts
      const P = session(poor);
      const pag = (await call('POST', '/api/agents', { token: P, body: { name: 'Poor runner', instructions: 'x' } })).j.agent;
      const pt = (await call('POST', '/api/tasks', { token: P, body: { title: 'Unfunded' } })).j.task;
      seen.length = 0;
      const pr = await call('POST', `/api/agents/${pag.id}/runs`, { token: P, body: { task: pt.key, budgetCredits: 150 } });
      check_(pr.s === 403 && pr.j.code === 'budget_exceeds_available' && !seen.some((x) => x.url === '/runs'), `an unfunded run is not admitted and nothing starts (${pr.s} ${pr.j && pr.j.code})`);
    }

    // the runner refuses / is down: recorded, credential revoked
    mode = 'refuse'; seen.length = 0;
    const task3 = (await call('POST', '/api/tasks', { token: A, body: { title: 'Third', projectId: proj } })).j.task;
    const r3 = (await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: task3.key } })).j.run;
    check_(r3.state === 'refused' && r3.reason === 'insufficient_credits', 'a refusal by the runner is recorded with its reason (not enough credits)');
    check_((await issue(seen.find((x) => x.url === '/runs').body.platformAgent.runRef, 'x')).s === 404, 'and a refused run has nothing to issue');
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
    // the race: the runner claims the credential before the platform has stored the run id it was given
    mode = 'claim-first';
    const task5 = (await call('POST', '/api/tasks', { token: A, body: { title: 'Fifth', projectId: proj } })).j.task;
    const raced = await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: task5.key, budgetCredits: 5 } });
    mode = 'ok';
    const rr = (await pool.query('SELECT run_id, state FROM agent_cloud_runs WHERE id = $1', [raced.j.run && raced.j.run.id])).rows[0];
    check_(claimed && claimed.s === 200 && /^xtk_/.test(claimed.j.token) && rr && rr.run_id === raced.j.run.runId && rr.state === 'running', `a runner that claims its credential before the platform stored the run id still gets it, and the run stays running (${JSON.stringify({ claim: claimed && claimed.s, rr })})`);
    await call('POST', `/api/agents/runs/${raced.j.run.id}/stop`, { token: A, body: {} });
    capable = false; seen.length = 0;
    const old = await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: task4.key } });
    check_(old.s === 503 && old.j.code === 'runner_lacks_agents' && !seen.some((x) => x.url === '/runs'), 'a runner that does not advertise platform agents is refused BEFORE anything starts or is charged');
    capable = true;
    const saved = process.env.AGENTS_API_BASE_URL; delete process.env.AGENTS_API_BASE_URL;
    check_((await call('POST', `/api/agents/${ag.id}/runs`, { token: A, body: { task: task4.key } })).j.code === 'cloud_runs_unavailable', 'without a runner configured, it says cloud runs are unavailable');
    process.env.AGENTS_API_BASE_URL = saved;
  } finally {
    stopListening(); server.closeAllConnections?.(); server.close(); runner.close();
    await pool.end();
  }
  console.log(`\nagent-cloud-runs: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
