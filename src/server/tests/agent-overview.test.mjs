/**
 * The agent page's Overview and its controls (services/agentOverview.js), end to end against a real database and
 * the real routers:
 *
 *  - GET /api/agents/:id/overview answers from measured records only: 14 days of spend, no cap until one is set,
 *    its XENO tool calls folded into one sitting, its work waiting for review in "needs you";
 *  - a message is a comment on the task it is on; with no task it is refused, and a task that is not its own is refused;
 *  - pausing one connection refuses that connection's next call, and resuming lets it answer again;
 *  - the spending cap is enforced where every spend is reserved: a spend past it is refused with the reason, removing
 *    the cap lets it through, and a cap nearly spent shows in "needs you";
 *  - someone who cannot see the agent gets agent_not_found on every one of these.
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/agent-overview.test.mjs
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import xenoTasksRoutes, { taskTokenAuth, unlessTaskToken, mcpChallenge } from '../routes/xenoTasksRoutes.js';
import platformAgentRoutes from '../routes/platformAgentRoutes.js';
import xenoMcpRoutes, { management, personOnly } from '../routes/xenoMcpRoutes.js';
import { stopListening } from '../services/agentPresenceStream.js';
import * as media from '../services/agentMedia.js';
import * as tasks from '../services/xenoTasks.js';
import { groupActivity } from '../services/agentOverview.js';
import { authMiddleware } from '../middleware/auth.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
process.env.JWT_SECRET = JWT_SECRET;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };

async function main() {
  // the grouping alone: two sittings 30 minutes apart, the second beside one task
  const t0 = Date.parse('2026-10-24T10:00:00Z'), at = (min) => new Date(t0 + min * 60e3).toISOString();
  const g = groupActivity([
    { kind: 'call', at: at(0), what: 'tasks_get', where: 'Claude Code', ok: true },
    { kind: 'call', at: at(3), what: 'tasks_get', where: 'Claude Code', ok: true },
    { kind: 'call', at: at(40), what: 'storage_move', where: 'Claude Code', ok: true },
    { kind: 'call', at: at(44), what: 'storage_move', where: 'Claude Code', ok: false },
    { kind: 'task', at: at(45), what: 'status', task: 'T-9' },
  ]);
  const sittings = g.filter((x) => x.kind === 'calls');
  check(sittings.length === 2 && sittings[0].count === 2 && sittings[0].failed === 1 && sittings[0].task === 'T-9' && sittings[1].task === null,
    'tool calls fold into sittings; a sitting names the one task it worked on, and counts what failed');

  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  await migrateOidcClients(pool);
  const mk = async (m) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW())
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [m, `${m}@example.test`])).rows[0].id;
  const ada = await mk('aov-ada'), eve = await mk('aov-eve');
  const session = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });

  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/tasks', mcpChallenge, taskTokenAuth, unlessTaskToken(authMiddleware), xenoTasksRoutes);
  app.use('/api/mcp', (req, res, next) => (req.path === '/' ? xenoMcpRoutes(req, res, next) : next()));
  app.use('/api/mcp', authMiddleware, personOnly, management);
  app.use('/api/agents', authMiddleware, personOnly, platformAgentRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body } = {}) => {
    const r = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; const t = await r.text(); try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    return { s: r.status, j };
  };
  let rid = 0;
  const rpc = (token, method, params) => call('POST', '/api/mcp', { token, body: { jsonrpc: '2.0', id: ++rid, method, params } });

  try {
    const me = { id: ada, kind: 'human', name: 'aov-ada' };
    const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Acme', 'acme-aov') RETURNING id`, [ada])).rows[0].id;
    await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, relation: 'owner', subject: `user:${ada}` }, { object: `workspace:${ws}`, relation: 'admin', subject: `user:${ada}` }] });
    const proj = (await pool.query(`INSERT INTO chat_projects (user_id, owner_user_id, workspace_id, name) VALUES ($1, NULL, $2, 'Payments') RETURNING id`, [ada, ws])).rows[0].id;
    await writeTuples(pool, { writes: [{ object: `project:${proj}`, relation: 'parent', subject: `workspace:${ws}` }] });
    const ag = (await call('POST', '/api/agents', { token: session(ada), body: { name: 'Atlas', instructions: 'Work through the ledger.' } })).j.agent;
    await call('PUT', `/api/agents/${ag.id}/projects/${proj}`, { token: session(ada), body: {} });
    const tok = (await call('POST', `/api/agents/${ag.id}/credentials`, { token: session(ada), body: { ttlHours: 24 } })).j.credential.token;
    const actor = { id: ag.userId, kind: 'agent' };
    const O = () => call('GET', `/api/agents/${ag.id}/overview`, { token: session(ada) });

    // 1. the overview, before anything happened
    const o1 = await O();
    check(o1.s === 200 && o1.j.spend.days.length === 14 && o1.j.spend.capCredits === null && o1.j.spend.spentCredits === 0, 'the overview has 14 days of spend, all zero, and no cap until one is set');
    check(o1.j.needsYou.some((n) => n.kind === 'expires') && o1.j.versions.length === 1 && o1.j.versions[0].runs === 0, 'a credential expiring within a week needs renewing; version 1 has no cloud runs yet');
    check((await call('GET', `/api/agents/${ag.id}/overview`, { token: session(eve) })).s === 404, 'someone who cannot see the agent gets agent_not_found');

    // 2. its XENO tool calls show as one sitting
    for (let i = 0; i < 3; i++) await rpc(tok, 'tools/call', { name: 'tasks_list_projects', arguments: {} });
    const o2 = await O();
    const sit = o2.j.groups.find((x) => x.kind === 'calls');
    check(sit && sit.count === 3 && sit.tools[0].name === 'tasks_list_projects' && sit.tools[0].n === 3, 'three calls in a row are one sitting, with the tool counted');
    const conn = o2.j.connections[0];
    check(conn && conn.pausedAt === null, 'the place it runs is listed, not paused');

    // 3. a message: refused with no task, refused on a task not its own, posted on its own task
    const noTask = await call('POST', `/api/agents/${ag.id}/message`, { token: session(ada), body: { body: 'Start on the ledger' } });
    check(noTask.s === 409 && noTask.j.code === 'no_current_task', 'with no task, a message is refused and says how to give it one');
    const other = await tasks.createTask(pool, me, { title: 'Someone else’s', projectId: proj });
    const notIts = await call('POST', `/api/agents/${ag.id}/message`, { token: session(ada), body: { body: 'Hi', task: other.key } });
    check(notIts.s === 409 && notIts.j.code === 'not_its_task', 'a task that is not its own is refused');
    const work = await tasks.createTask(pool, me, { title: 'Migrate billing webhooks', projectId: proj });
    if (work.status === 'raised') await tasks.transitionTask(pool, me, work.key, { to: 'todo' });
    await tasks.updateTask(pool, me, work.key, { delegateId: ag.userId });
    const sent = await call('POST', `/api/agents/${ag.id}/message`, { token: session(ada), body: { body: 'Use the ledger queue for retries' } });
    check(sent.s === 200 && sent.j.task === work.key, 'with a task, the message goes to the task it is on');
    const ev = (await pool.query(`SELECT e.actor_id, e.note FROM task_events e JOIN tasks t ON t.id = e.task_id WHERE 'T-' || t.number = $1 AND e.kind = 'comment' ORDER BY e.created_at DESC LIMIT 1`, [work.key])).rows[0];
    check(ev && ev.actor_id === ada && ev.note === 'Use the ledger queue for retries', 'it is a comment by the person on that task');

    // 4. its work waiting for review needs you
    await tasks.transitionTask(pool, actor, work.key, { to: 'in_progress' });
    await tasks.transitionTask(pool, actor, work.key, { to: 'in_review' });
    check((await O()).j.needsYou.some((n) => n.kind === 'review' && n.task === work.key), 'work it sent for review shows in "needs you"');
    const o4 = (await O()).j;
    check(o4.queue.some((q) => q.task === work.key && q.status === 'in_review') && !o4.queue.some((q) => q.task === other.key), 'what is waiting for it lists its own tasks, not others');
    check(o4.today.toolCalls >= 3 && o4.today.taskActions >= 2, 'today counts its XENO tool calls and its task actions');
    const grouped = (await call('GET', `/api/agents/${ag.id}/activity?grouped=1`, { token: session(ada) })).j.items;
    check(grouped.some((x) => x.kind === 'calls' && x.count >= 3) && !grouped.some((x) => x.kind === 'call'), 'the Activity list, grouped, folds its calls into sittings');

    // 5. pause one place it runs: the next call is refused, resume and it answers
    check((await call('POST', `/api/agents/${ag.id}/connections/${conn.id}/pause`, { token: session(eve) })).s === 404, 'someone else cannot pause it');
    const p = await call('POST', `/api/agents/${ag.id}/connections/${conn.id}/pause`, { token: session(ada) });
    check(p.s === 200 && p.j.connection.pausedAt, 'its owner pauses that connection');
    const refused = await rpc(tok, 'tools/call', { name: 'tasks_list_projects', arguments: {} });
    check(refused.s === 403 && refused.j.error && /paused/.test(refused.j.error.message), 'a paused connection is refused on its next call, and says why');
    await call('POST', `/api/agents/${ag.id}/connections/${conn.id}/resume`, { token: session(ada) });
    const back = await rpc(tok, 'tools/call', { name: 'tasks_list_projects', arguments: {} });
    check(back.s === 200 && back.j.result, 'resumed, it answers again');

    // 6. the spending cap, enforced where every spend is reserved
    check((await call('PUT', `/api/agents/${ag.id}/spend-cap`, { token: session(ada), body: { credits: -1 } })).s === 400, 'a negative cap is refused');
    check((await call('PUT', `/api/agents/${ag.id}/spend-cap`, { token: session(eve), body: { credits: 5 } })).s === 404, 'someone else cannot set its cap');
    const cap = await call('PUT', `/api/agents/${ag.id}/spend-cap`, { token: session(ada), body: { credits: 1 } });
    check(cap.s === 200 && cap.j.capCredits === 1, 'its owner caps it at 1 credit over 30 days');
    const meter = async (db, who, o) => ({ result: await o.run({ maxOutputTokens: 100 }), creditsCharged: 0.5, costMicro: 500_000 });
    const complete = async () => ({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } });
    const a1 = await media.ask(pool, actor, { prompt: 'One' }, { meter, complete, maxMicro: 600_000 });
    check(a1.answer === 'ok', 'a spend inside the cap goes through');
    let over = null; try { await media.ask(pool, actor, { prompt: 'Two' }, { meter, complete, maxMicro: 600_000 }); } catch (e) { over = e; }
    check(over && over.code === 'agent_cap_reached' && /spending cap/.test(over.message), 'a spend past the cap is refused, and says why');
    const o6 = await O();
    check(o6.j.spend.spentCredits === 0.5 && o6.j.spend.capCredits === 1 && o6.j.spend.days[13].credits === 0.5, 'the overview shows what it spent today against its cap');
    await call('PUT', `/api/agents/${ag.id}/spend-cap`, { token: session(ada), body: { credits: 0.6 } });
    check((await O()).j.needsYou.some((n) => n.kind === 'cap'), 'a cap more than 80% spent needs you');
    await call('PUT', `/api/agents/${ag.id}/spend-cap`, { token: session(ada), body: { credits: null } });
    const a3 = await media.ask(pool, actor, { prompt: 'Three' }, { meter, complete, maxMicro: 600_000 });
    check(a3.answer === 'ok' && (await O()).j.spend.capCredits === null, 'with the cap removed it spends again');
  } finally {
    server.close(); try { await stopListening(); } catch { /* already stopped */ } await pool.end();
  }
  console.log(`\nagent-overview: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
