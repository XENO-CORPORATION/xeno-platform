/**
 * XENO Tasks — claim leases, typed activity, the agent event feed, and delegation-as-acceptance (2026-10-18),
 * against a real Postgres and the REAL router + MCP service.
 *
 *   node src/server/tests/task-leases.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import chatRoutes from '../routes/chatRoutes.js';
import xenoTasksRoutes, { taskTokenAuth } from '../routes/xenoTasksRoutes.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import * as svc from '../services/xenoTasks.js';
import * as mcp from '../services/tasksMcp.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e.code || e.message; } };

async function main() {
  await runAllMigrations(pool);
  const stamp = Date.now();
  const mk = async (name) => { const m = `${name}${stamp}`; return (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW()) RETURNING id, username`, [m, `${m}@example.test`])).rows[0]; };
  const U = { ada: await mk('la-ada'), bob: await mk('la-bob'), bot: await mk('la-bot'), bot2: await mk('la-bottwo') };
  for (const a of [U.bot, U.bot2]) await pool.query("INSERT INTO agent_identities (user_id, owner_user_id, agent_role, agent_origin) VALUES ($1, $2, 'other', 'xeno')", [a.id, U.ada.id]);
  const P = (u, kind = 'human') => ({ id: u.id, kind, name: u.username });
  const ada = P(U.ada), bob = P(U.bob), bot = P(U.bot, 'agent'), bot2 = P(U.bot2, 'agent');

  let actor = U.ada.id;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; req.user = { id: actor }; next(); });
  app.use('/api/chat', chatRoutes); app.use('/api/tasks', taskTokenAuth, xenoTasksRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const as = (u) => async (method, path, body) => { actor = u.id; const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const A = as(U.ada), B = as(U.bot);
  const feed = async (who, after = '0') => (await svc.agentEvents(pool, who, { after, limit: 200 })).events;
  try {
    const proj = (await A('POST', '/chat/projects', { name: 'Leases', area: 'dev' })).j.project;
    const email = async (id) => (await pool.query('SELECT email FROM users WHERE id = $1', [id])).rows[0].email;
    for (const [u, relation] of [[U.bob, 'viewer'], [U.bot, 'viewer'], [U.bot2, 'viewer']]) await A('PUT', `/chat/projects/${proj.id}/access/user/by-email`, { email: await email(u.id), relation });

    // ── delegation is acceptance, for a triager only
    const t1 = await svc.createTask(pool, ada, { title: 'Delegated by the owner', projectId: proj.id, delegateId: U.bot.id });
    check(t1.status === 'todo' && t1.delegate.id === String(U.bot.id) && t1.events.some((e) => e.kind === 'status' && e.from === 'raised' && e.to === 'todo') && t1.events.some((e) => e.kind === 'delegated'),
      'a triager delegating raised work to an agent accepts it: raised → todo, with the status event and the delegation');
    const t0 = await svc.createTask(pool, bob, { title: 'Delegated by a viewer', projectId: proj.id, delegateId: U.bot.id });
    check(t0.status === 'raised' && t0.delegate.id === String(U.bot.id), 'someone who may not triage still leaves it raised');
    const viaRoute = (await A('POST', '/tasks', { title: 'via /delegate', projectId: proj.id })).j.task;
    check((await A('POST', `/tasks/${viaRoute.key}/delegate`, { agentId: U.bot.id })).j.task.status === 'todo', 'delegating through /delegate accepts it the same way');

    // ── the lease
    const c1 = await svc.claimTask(pool, bot, t1.key, { runId: 'pc-a:1' });
    check(c1.status === 'in_progress' && c1.lease && c1.lease.runId === 'pc-a:1' && c1.lease.agentId === String(U.bot.id), 'the agent claims To do work with a run id: it goes to In progress and the run holds the lease');
    check(await code(svc.claimTask(pool, bot, t1.key, { runId: 'pc-b:1' })) === 'already_claimed', 'the SAME agent on another machine (another run) is refused while the lease lives');
    check(await code(svc.claimTask(pool, bot, t1.key)) === 'already_claimed', 'a claim without a run id is refused while a lease lives');
    check(await code(svc.claimTask(pool, bot2, t1.key, { runId: 'x' })) === 'already_claimed', 'another agent is refused');
    check((await svc.claimTask(pool, bot, t1.key, { runId: 'pc-a:1' })).lease.runId === 'pc-a:1', 'the holding run claiming again is idempotent');
    check(await code(svc.claimTask(pool, bot, t1.key, { runId: 'bad id!' })) === 'invalid_run_id' && await code(svc.claimTask(pool, bot, t1.key, { runId: 'x'.repeat(129) })) === 'invalid_run_id', 'a run id outside 1-128 safe characters is refused');
    const before = (await pool.query('SELECT expires_at FROM task_claim_leases WHERE task_id = $1', [t1.id])).rows[0].expires_at;
    await new Promise((r) => setTimeout(r, 30));
    const hb = await svc.heartbeatTask(pool, bot, t1.key, { runId: 'pc-a:1' });
    check(new Date(hb.lease.expiresAt) > new Date(before) && hb.lease.ttlMs === svc.LEASE_MS && svc.LEASE_MS === 600000, 'a heartbeat renews the lease (10 minutes from now)');
    check(await code(svc.heartbeatTask(pool, bot, t1.key, { runId: 'pc-b:1' })) === 'already_claimed' && await code(svc.heartbeatTask(pool, bot, t1.key, {})) === 'run_id_required', 'only the holding run can heartbeat, and it must say which run it is');
    const restHb = await B('POST', `/tasks/${t1.key}/heartbeat`, { runId: 'pc-a:1' });
    check(restHb.s === 200 && restHb.j.lease.runId === 'pc-a:1', 'REST: POST /api/tasks/:key/heartbeat');

    // ── typed activity
    const act = (kind, data, body) => svc.reportActivity(pool, bot, t1.key, { kind, data, body });
    check(await code(act('plan', { steps: ['read the code', 'fix it'] })) === 'ok', 'plan {steps[]} is accepted');
    check(await code(act('dance', {})) === 'invalid_activity', 'an unknown kind is refused');
    check(await code(act('plan', { steps: [] })) === 'invalid_activity' && await code(act('plan', { steps: Array(51).fill('s') })) === 'invalid_activity' && await code(act('plan', { steps: ['x'.repeat(501)] })) === 'invalid_activity', 'a plan needs 1 to 50 steps of at most 500 characters');
    check(await code(act('plan', { steps: ['a'], extra: 1 })) === 'invalid_activity', 'a field the kind does not take is refused');
    check(await code(act('question', { question: 'x'.repeat(2001) })) === 'invalid_activity' && await code(act('question', { question: 'Which?', options: Array(11).fill('o') })) === 'invalid_activity' && await code(act('question', { question: 7 })) === 'invalid_activity', 'question is bounded text, options at most 10');
    check(await code(act('question', { question: 'Port 80 or 443?', options: ['80', '443'] })) === 'ok', 'question {question, options?} is accepted');
    check(await code(act('handover', { state: 'half done', nextStep: 'run the tests' })) === 'ok' && await code(act('handover', { state: 'x' })) === 'invalid_activity', 'handover {state, nextStep, openQuestions[]} is accepted; without nextStep it is refused');
    check(await code(act('done', { summary: 'fixed' })) === 'invalid_activity' && await code(act('done', { summary: 'fixed', verification: 'tests green' })) === 'ok', 'done needs summary AND verification');
    check(await code(act('action', {})) === 'body_required' && await code(act('action', { summary: 'ran npm test' })) === 'ok', 'action takes a body or a summary');
    check(await code(svc.reportActivity(pool, bot, t1.key, { type: 'thought', body: 'old style' })) === 'ok', 'the older type + body still works');
    const read = await svc.getTask(pool, ada, t1.key);
    const acts = read.events.filter((e) => e.kind === 'activity');
    const ho = acts.find((e) => e.from === 'handover');
    check(acts.find((e) => e.from === 'plan').data.steps.length === 2 && ho.data.nextStep === 'run the tests' && Array.isArray(ho.data.openQuestions) && acts.find((e) => e.from === 'question').data.options.join() === '80,443' && acts.find((e) => e.from === 'done').data.verification === 'tests green',
      'the task read returns each kind with its structured fields');
    check((await feed(bot)).some((e) => e.kind === 'handover' && e.task.handover.nextStep === 'run the tests'), 'a handover lands in the agent’s own feed for the next run');

    // ── an agent never accepts its own work
    check(await code(svc.transitionTask(pool, bot, t1.key, { to: 'done' })) === 'not_allowed', 'an agent never accepts its own work');

    // ── expiry: time injected
    const sw0 = await svc.sweepExpiredLeases(pool, { now: new Date(Date.now() + 5 * 60000) });
    check(sw0.expired === 0 && (await svc.getTask(pool, ada, t1.key)).lease, 'a lease inside its 10 minutes survives the sweep');
    const sw = await svc.sweepExpiredLeases(pool, { now: new Date(Date.now() + 11 * 60000) });
    const after = await svc.getTask(pool, ada, t1.key);
    check(sw.expired === 1 && !after.lease && after.status === 'todo' && after.delegate.id === String(U.bot.id) && after.events.some((e) => e.kind === 'lease_expired'),
      'past 10 minutes without a heartbeat the lease ends: back to To do, a person’s delegation kept, lease_expired in the history');
    check((await svc.sweepExpiredLeases(pool, { now: new Date(Date.now() + 60 * 60000) })).expired === 0, 'the sweep ends a lease once (the DELETE has one winner)');
    check((await feed(bot)).some((e) => e.kind === 'lease_expired' && e.task.runId === 'pc-a:1'), 'the agent is told: lease_expired');
    check(await code(svc.heartbeatTask(pool, bot, t1.key, { runId: 'pc-a:1' })) === 'lease_lost', 'the lapsed run’s heartbeat is told lease_lost');
    const c2 = await svc.claimTask(pool, bot, t1.key, { runId: 'pc-b:1' });
    check(c2.lease.runId === 'pc-b:1' && c2.status === 'in_progress', 'another run can now continue it');

    // ── release
    const rel = await svc.releaseTask(pool, bot, t1.key, { runId: 'pc-b:1' });
    check(rel.released && !rel.task.lease && rel.task.status === 'todo' && rel.task.events.some((e) => e.kind === 'released'), 'release ends the lease and puts the task back in To do');
    check((await svc.releaseTask(pool, bot, t1.key, { runId: 'pc-b:1' })).released === false, 'releasing again is a no-op');

    // a claim of undelegated work: the expiry clears the delegate the claim set
    const t3 = (await A('POST', '/tasks', { title: 'Open work', projectId: proj.id })).j.task;
    await A('POST', `/tasks/${t3.key}/transition`, { to: 'todo' });
    await svc.claimTask(pool, bot2, t3.key, { runId: 'r1' });
    await svc.sweepExpiredLeases(pool, { now: new Date(Date.now() + 11 * 60000) });
    const t3b = await svc.getTask(pool, ada, t3.key);
    check(!t3b.delegate && t3b.status === 'todo', 'an expired claim of open work frees it for anyone: no delegate, To do');
    // a lapsed lease the sweep has not reached does not block a new claim
    await svc.claimTask(pool, bot2, t3.key, { runId: 'r2' });
    await pool.query("UPDATE task_claim_leases SET expires_at = now() - interval '1 second' WHERE task_id = $1", [t3.id]);
    check((await svc.claimTask(pool, bot2, t3.key, { runId: 'r3' })).lease.runId === 'r3', 'a lapsed lease does not block the next claim even before the sweep runs');
    // handing work in ends the claim
    check(!(await svc.transitionTask(pool, bot2, t3.key, { to: 'in_review' })).lease, 'sending it for review ends the lease');

    // ── the event feed: every kind an inbox needs, in order, by cursor
    const cur0 = (await svc.agentEvents(pool, bot, { after: '0', limit: 200 })).cursor;
    await svc.commentTask(pool, ada, t1.key, { body: 'Any news?' });                                     // reply
    await svc.commentTask(pool, ada, t1.key, { body: `@${U.bot.username} please look` });              // mentioned
    await svc.transitionTask(pool, ada, t1.key, { to: 'blocked' });                                      // status_changed
    await svc.transitionTask(pool, ada, t1.key, { to: 'in_progress' });
    await svc.updateTask(pool, ada, t1.key, { reviewerId: U.bot2.id, reviewRequired: true });
    await svc.transitionTask(pool, ada, t1.key, { to: 'in_review' });                                    // bot: status_changed; bot2: review_requested
    await svc.transitionTask(pool, bot2, t1.key, { to: 'in_progress', note: 'tests missing' });          // changes_requested
    await svc.updateTask(pool, ada, t1.key, { reviewerId: null, reviewRequired: false });
    await svc.transitionTask(pool, ada, t1.key, { to: 'in_review' });
    await svc.transitionTask(pool, ada, t1.key, { to: 'done' });                                         // accepted
    await svc.transitionTask(pool, ada, t1.key, { to: 'todo' });
    await svc.delegateTask(pool, ada, t1.key, { agentId: null });                                        // undelegated
    await Promise.all(Array.from({ length: 20 }, (_, i) => svc.commentTask(pool, ada, t0.key, { body: `burst ${i}` })));   // reply ×20, concurrently
    const pages = []; let cur = cur0;
    for (let i = 0; i < 50; i++) { const r = await svc.agentEvents(pool, bot, { after: cur, limit: 3 }); if (!r.events.length) break; pages.push(...r.events); cur = r.cursor; }
    const kinds = new Set(pages.map((e) => e.kind));
    for (const k of ['reply', 'mentioned', 'status_changed', 'changes_requested', 'accepted', 'undelegated']) check(kinds.has(k), `the feed carries ${k}`);
    check(pages.every((e, i) => i === 0 || BigInt(e.id) > BigInt(pages[i - 1].id)) && pages.filter((e) => e.kind === 'reply' && e.task.key === t0.key).length === 20, 'paged by cursor three at a time it is in order, and 20 concurrent replies all arrive');
    const all = await feed(bot); check(all.length === new Set(all.map((e) => e.id)).size && all.some((e) => e.kind === 'delegated'), 'the feed holds delegated too, with no duplicates');
    check((await feed(bot2)).some((e) => e.kind === 'review_requested' && e.task.key === t1.key), 'an agent named reviewer is told review_requested');

    // ── MCP: the same service functions
    const names = mcp.TOOLS.map((t) => t.name);
    check(names.includes('heartbeat') && names.includes('release') && mcp.TOOLS.find((t) => t.name === 'claim_task').inputSchema.properties.run_id, 'MCP lists heartbeat and release, and claim_task takes run_id');
    await svc.delegateTask(pool, ada, t1.key, { agentId: U.bot.id });
    const mc = await mcp.callTool(pool, bot, 'claim_task', { key: t1.key, run_id: 'mcp-1' });
    const mh = await mcp.callTool(pool, bot, 'heartbeat', { key: t1.key, run_id: 'mcp-1' });
    const ma = await mcp.callTool(pool, bot, 'report_activity', { key: t1.key, kind: 'handover', data: { state: 's', nextStep: 'n', openQuestions: ['q'] } });
    const mr = await mcp.callTool(pool, bot, 'release', { key: t1.key, run_id: 'mcp-1' });
    check(mc.structuredContent.task.lease.runId === 'mcp-1' && mh.structuredContent.lease.runId === 'mcp-1' && ma.structuredContent.task.events.at(-1).data.openQuestions[0] === 'q' && mr.structuredContent.released === true,
      'MCP: claim_task with run_id → heartbeat → report_activity handover → release');
    const bad = await mcp.dispatch(pool, bot, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'report_activity', arguments: { key: t1.key, kind: 'plan', data: { steps: 'not a list' } } } });
    check(bad.result.isError && bad.result.structuredContent.code === 'invalid_activity', 'MCP refuses an invalid field with invalid_activity');

    // ── every feed event names who caused it by stable id, not only by display name
    const agt = async (u) => (await pool.query('SELECT public_id FROM agent_identities WHERE user_id = $1', [u.id])).rows[0].public_id;
    const [botAgt, bot2Agt] = [await agt(U.bot), await agt(U.bot2)];
    const mark = (await svc.agentEvents(pool, bot, { after: '0', limit: 200 })).cursor;
    await svc.reportActivity(pool, bot, t1.key, { kind: 'handover', data: { state: 'mine', nextStep: 'n' } });
    await svc.commentTask(pool, bot2, t1.key, { body: 'from the other agent' });
    await svc.commentTask(pool, ada, t1.key, { body: 'from a person' });
    const fresh = (await svc.agentEvents(pool, bot, { after: mark, limit: 50 })).events;
    const self = fresh.find((e) => e.kind === 'handover'), other = fresh.find((e) => e.kind === 'reply' && e.task.comment === 'from the other agent'), human = fresh.find((e) => e.kind === 'reply' && e.task.comment === 'from a person');
    check(/^agt_/.test(botAgt) && self.task.byAgentId === botAgt && self.task.byId === String(U.bot.id) && self.task.byKind === 'agent' && self.task.by, 'a self-authored event carries the agent’s own agt_ id, user id and kind (and still its name)');
    check(other.task.byAgentId === bot2Agt && other.task.byAgentId !== botAgt && other.task.byKind === 'agent', 'another agent’s event carries a different agt_ id');
    check(human.task.byKind === 'human' && human.task.byId === String(U.ada.id) && !('byAgentId' in human.task), 'a person’s event carries byId and byKind human, no agent id');
    const viaMcp = (await mcp.callTool(pool, bot, 'list_events', { after: mark })).structuredContent.events;
    check(viaMcp.find((e) => e.kind === 'handover').task.byAgentId === botAgt, 'MCP list_events carries the same fields');
  } finally { server.close(); }
  console.log(`task-leases: ${passed} checks passed`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e.message || e); await pool.end().catch(() => {}); process.exit(1); });
