/**
 * XENO Orchestrator on the platform + the §15 workforce event stream, end to end on a real Postgres and the REAL routers
 * (/api/orchestrator, /api/audit) with real run admissions.
 *
 *   1. edges: task→task is Tasks' own `blocks` link (one edge, seen on the task page); goal/objective edges are
 *      orchestrator_edges; a loop is refused — through the route, through Tasks, and by the DATABASE itself
 *   2. the graph and the ready set: ready = open with every blocker done; finishing a blocker readies the next
 *   3. plans: order is the graph; an attempt on a blocked step is refused; an attempt binds a run the caller admitted
 *      on the plan's project — another project's run, someone else's run, a second live attempt are refused
 *   4. attempt state FOLLOWS the run: running → completed (reported result) / cancelled (revoked)
 *   5. events: admissions, leases-free revocations, results, edges, plans, attempts and divisions each append a typed
 *      event in the same transaction; a rolled-back change leaves none; the stream is append-only
 *   6. the audit view is scoped PER ROW: a project viewer sees the project's events, a workspace viewer who cannot see
 *      the project gets them as `hidden`, a stranger gets 404
 *
 * Mutation-checked 2026-10-20 (each fails the named assertions when the protection is removed; restored passes):
 *   ORCH_MUTATE=cycle-trigger    drop both cycle triggers             -> 6 fail, from "C→A would close A→B→C→A"
 *   ORCH_MUTATE=attempt-project  drop the attempt guard trigger       -> "the DATABASE refuses an attempt bound to another project’s run"
 *   mayRead() returns true       (workforceEvents.js, edited by hand) -> "never the secret project’s", "counted as hidden"
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/orchestrator.test.mjs
 */
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import orchestratorRoutes from '../routes/orchestratorRoutes.js';
import workforceEventRoutes from '../routes/workforceEventRoutes.js';
import { authMiddleware } from '../middleware/auth.js';
import { personOnly } from '../routes/xenoMcpRoutes.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { admitRun } from '../services/workforceRunAdmission.js';
import { revokeRun } from '../services/workforceRunAuthority.js';
import { reportRunResult } from '../services/workforceRunResults.js';
import * as tasks from '../services/xenoTasks.js';
import { createGoal } from '../services/projectWorktree.js';
import * as wfEvents from '../services/workforceEvents.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
const MUTATE = process.env.ORCH_MUTATE || '';
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  if (MUTATE === 'cycle-trigger') { await pool.query('DROP TRIGGER IF EXISTS task_links_refuse_cycle ON task_links'); await pool.query('DROP TRIGGER IF EXISTS orchestrator_edges_refuse_cycle ON orchestrator_edges'); }
  if (MUTATE === 'attempt-project') await pool.query('DROP TRIGGER IF EXISTS orchestrator_attempt_guard ON orchestrator_attempts');

  const marker = `orc-${randomUUID().slice(0, 8)}`;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const explicit = (caps) => ({ schemaVersion: 1, mode: 'explicit', capabilities: caps });
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
    VALUES($1,$2,'x',$1,TRUE,NOW()) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), stranger = await user('stranger'), lenderOwner = await user('lender');
  for (const u of [owner, editor]) {
    await pool.query('INSERT INTO credit_accounts(user_id,balance) VALUES($1,50000000) ON CONFLICT (user_id) DO NOTHING', [u]);
    await pool.query(`INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true) ON CONFLICT (user_id) DO UPDATE SET enabled=true`, [u]);
    await pool.query(`INSERT INTO credit_grants(id,user_id,amount_micro,remaining_micro,kind,source_ref) VALUES(md5('orc-fund:'||$1::text)::uuid,$1::uuid,50000000,50000000,'paid','orc-fund')
      ON CONFLICT (id) DO NOTHING`, [u]);
  }
  const ws = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-ws`])).rows[0].id;
  const lender = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [lenderOwner, `${marker}-l`])).rows[0].id;
  const tuple = (type, id, rel, u) => pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES($1,$2,$3,'user',$4) ON CONFLICT DO NOTHING`, [type, id, rel, u]);
  await tuple('workspace', ws, 'owner', owner); await tuple('workspace', ws, 'editor', editor); await tuple('workspace', ws, 'viewer', viewer);
  const agent = randomUUID();
  await pool.query(`INSERT INTO workforce_resources(id,kind,owner_workspace_id,name) VALUES($1,'agent',$2,'Crew')`, [agent, lender]);
  await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)`,
    [agent, { instructions: 'Crew', skills: [], requestedCapabilities: ['files.read'], secretReferences: [] }, hash(`${agent}:1`)]);
  const rev = (await pool.query('SELECT revision FROM workforce_resources WHERE id=$1', [agent])).rows[0].revision;
  const assignment = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,resource_revision,policy)
    VALUES($1,'agent',$2,$3,$4,$5) RETURNING id`, [agent, ws, lender, rev, explicit(['files.read'])])).rows[0].id;
  await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted', revision=revision+1, source_approved_by_user_id=$2, source_approved_at=clock_timestamp(),
    target_accepted_by_user_id=$2, accepted_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [assignment, owner]);
  const mkProject = async (name) => (await pool.query('INSERT INTO chat_projects(workspace_id,name) VALUES($1,$2) RETURNING id', [ws, `${marker}-${name}`])).rows[0].id;
  const P = await mkProject('main'), Q = await mkProject('other'), S = await mkProject('secret');
  // the viewer views P but not S; the editor edits P and Q
  await tuple('project', P, 'viewer', viewer);
  for (const p of [P, Q, S]) { await tuple('project', p, 'admin', owner); }
  for (const p of [P, Q]) await tuple('project', p, 'editor', editor);
  const participation = async (project) => (await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,workspace_id,assignment_id,responsibility,policy)
    VALUES($1,'agent',$2,'workspace',$3,$4,'reviewer',$5) RETURNING id`, [agent, project, ws, assignment, explicit(['files.read'])])).rows[0].id;
  const partP = await participation(P), partQ = await participation(Q), partS = await participation(S);
  const ctx = (actorUserId) => ({ actorUserId, clientId: 'xeno-agent-interface' });
  const admit = async (project, part, actor = editor) => (await admitRun(pool, ctx(actor), {
    operationId: randomUUID(), agent: { resourceId: agent, version: 1, contentHash: hash(`${agent}:1`) },
    target: { kind: 'project', projectId: project, participationId: part }, capabilities: ['files.read'], budget: { ceilingMicro: '100000' } })).admission;

  const app = express(); app.use(express.json());
  app.use((req, _r, n) => { req.db = pool; n(); });
  app.use('/api/orchestrator', authMiddleware, personOnly, orchestratorRoutes);
  app.use('/api/audit', authMiddleware, personOnly, workforceEventRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const session = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });
  const call = async (method, path, as, body) => {
    const r = await fetch(origin + path, { method, headers: { authorization: 'Bearer ' + session(as), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; } return { s: r.status, j };
  };
  const me = (id) => ({ id, kind: 'human' });

  try {
    const mk = async (title, project = P) => (await tasks.createTask(pool, me(editor), { title, projectId: project })).key;
    const A = await mk('Design'), B = await mk('Build'), C = await mk('Ship'), X = await mk('Elsewhere', Q);
    const T = (key) => ({ kind: 'task', key });

    // ── 1. edges and cycles
    let r = await call('POST', '/api/orchestrator/edges', editor, { from: T(A), to: T(B) });
    if (r.s !== 201) console.log('edge reply', r.s, JSON.stringify(r.j));
    ok(r.s === 201 && r.j.edge.store === 'task_links', 'a task→task dependency is the task’s own “blocks” link');
    ok((await call('POST', '/api/orchestrator/edges', editor, { from: T(B), to: T(C) })).s === 201, 'B blocks C');
    const bPage = await tasks.getTask(pool, me(editor), B);
    ok(bPage.links.some((l) => l.label === 'blocked by' && l.task.key === A) && bPage.links.some((l) => l.label === 'blocks' && l.task.key === C), 'the task page shows blocked by / blocks from the same edge');
    ok(bPage.readiness && bPage.readiness.ready === false && bPage.readiness.openBlockers === 1, 'the task page says B is waiting on one unfinished blocker');
    r = await call('POST', '/api/orchestrator/edges', editor, { from: T(C), to: T(A) });
    ok(r.s === 409 && (r.j.code === 'link_cycle' || r.j.code === 'cycle'), 'C→A would close A→B→C→A: refused 409');
    const viaTasks = await tasks.addLink(pool, me(editor), A, { kind: 'blocked_by', to: C }).then(() => 'linked', (e) => e.code);
    ok(viaTasks === 'link_cycle', 'the same loop through the Tasks link UI is refused too (blocked_by)');
    const raw = await pool.query("INSERT INTO task_links(from_task,to_task,kind) SELECT c.id, a.id, 'blocks' FROM tasks c, tasks a WHERE c.number=$1 AND a.number=$2",
      [Number(C.slice(2)), Number(A.slice(2))]).then(() => 'inserted', (e) => e.code);
    ok(raw === '23514', 'and the DATABASE refuses it from any writer (mutation: cycle-trigger)');
    const goal = (await createGoal(pool, { actorUserId: editor, projectId: P, title: 'Launch', successEvidence: 'Live' })).goalId;
    ok((await call('POST', '/api/orchestrator/edges', editor, { from: T(C), to: { kind: 'goal', id: goal } })).s === 201, 'a task can block a goal (orchestrator_edges)');
    r = await call('POST', '/api/orchestrator/edges', editor, { from: { kind: 'goal', id: goal }, to: T(A) });
    ok(r.s === 409 && r.j.code === 'cycle', 'a loop across both edge stores (A→B→C→goal→A) is refused');
    ok((await call('POST', '/api/orchestrator/edges', viewer, { from: { kind: 'goal', id: goal }, to: T(X) })).s >= 403, 'a viewer cannot add dependencies');

    // ── 2. graph and ready set
    let g = (await call('GET', `/api/orchestrator/graph?project=${P}`, viewer)).j.graph;
    const node = (key) => g.nodes.find((n) => n.key === key);
    ok(g.edges.length === 3 && node(A).ready && !node(B).ready && node(B).blockedBy.length === 1, 'graph: A ready, B blocked by A, three edges');
    ok(JSON.stringify((await call('GET', `/api/orchestrator/ready?project=${P}`, viewer)).j.ready.map((n) => n.key)) === JSON.stringify([A]), 'the ready set is [A]');
    ok((await call('GET', `/api/orchestrator/graph?project=${P}`, stranger)).s === 404, 'a stranger gets 404 for the graph');

    // ── 3. plans and attempts
    r = await call('POST', '/api/orchestrator/plans', editor, { projectId: P, name: 'Release', steps: [{ task: C }, { task: A }, { task: B, maxAttempts: 2 }] });
    ok(r.s === 201 && r.j.plan.steps.map((s) => s.task.key).join() === [A, B, C].join(), 'a plan’s order comes from the graph (A, B, C)');
    const plan = r.j.plan.id;
    ok((await call('POST', '/api/orchestrator/plans', editor, { projectId: P, name: 'Bad', steps: [{ task: X }] })).s === 400, 'a step from another project is refused');
    ok((await call('POST', '/api/orchestrator/plans', viewer, { projectId: P, name: 'Nope', steps: [{ task: A }] })).s === 403, 'a viewer cannot plan');
    const runB = await admit(P, partP);
    r = await call('POST', `/api/orchestrator/plans/${plan}/attempts`, editor, { task: B, admissionId: runB.admissionId });
    ok(r.s === 409 && r.j.code === 'blocked', 'an attempt on a blocked step is refused');
    const runQ = await admit(Q, partQ);
    r = await call('POST', `/api/orchestrator/plans/${plan}/attempts`, editor, { task: A, admissionId: runQ.admissionId });
    ok(r.s === 400, 'a run admitted on ANOTHER project cannot be an attempt of this plan (mutation: attempt-project)');
    const rawAttempt = await pool.query(`INSERT INTO orchestrator_attempts(step_id,attempt,admission_id,started_by) SELECT s.id, 1, $2, $3 FROM orchestrator_plan_steps s WHERE s.plan_id=$1 LIMIT 1`,
      [plan, runQ.admissionId, editor]).then(() => 'inserted', (e) => e.code);
    ok(rawAttempt === '23514', 'and the DATABASE refuses an attempt bound to another project’s run from any writer (mutation: attempt-project)');
    const runOwner = await admit(P, partP, owner);
    r = await call('POST', `/api/orchestrator/plans/${plan}/attempts`, editor, { task: A, admissionId: runOwner.admissionId });
    ok(r.s === 404 || r.s === 400, 'someone else’s run cannot be bound by me');
    const runA = await admit(P, partP);
    r = await call('POST', `/api/orchestrator/plans/${plan}/attempts`, editor, { task: A, admissionId: runA.admissionId });
    ok(r.s === 201 && r.j.attempt.attempt === 1 && r.j.attempt.state === 'running', 'attempt 1 of A binds runA and reads running');
    const runA2 = await admit(P, partP);
    ok((await call('POST', `/api/orchestrator/plans/${plan}/attempts`, editor, { task: A, admissionId: runA2.admissionId })).s === 409, 'a second attempt while one runs is refused');

    // ── 4. attempt state follows the run
    await revokeRun(pool, ctx(editor), runA.admissionId);
    let p = (await call('GET', `/api/orchestrator/plans/${plan}`, viewer)).j.plan;
    ok(p.steps[0].attempts[0].state === 'cancelled', 'revoking the run cancels the attempt — no attempt write involved');
    r = await call('POST', `/api/orchestrator/plans/${plan}/attempts`, editor, { task: A, admissionId: runA2.admissionId });
    ok(r.s === 201 && r.j.attempt.attempt === 2, 'after the run stopped, attempt 2 starts');
    await reportRunResult(pool, ctx(editor), { admissionId: runA2.admissionId, outcome: 'completed', summary: 'done', artifacts: [] });
    p = (await call('GET', `/api/orchestrator/plans/${plan}`, viewer)).j.plan;
    ok(p.steps[0].attempts[1].state === 'completed', 'reporting the run’s result completes the attempt');
    await pool.query("UPDATE tasks SET status='done' WHERE number=$1", [Number(A.slice(2))]);
    g = (await call('GET', `/api/orchestrator/graph?project=${P}`, viewer)).j.graph;
    ok(g.nodes.find((n) => n.key === B).ready, 'finishing A readies B');
    p = (await call('GET', `/api/orchestrator/plans/${plan}`, viewer)).j.plan;
    ok(p.steps[1].ready && p.steps[1].canAttempt === false, 'B is ready in the plan; the viewer may not start it');

    // ── 5. events
    const ev = (await pool.query('SELECT type FROM workforce_events WHERE project_id=$1 ORDER BY id', [P])).rows.map((x) => x.type);
    for (const t of ['run.admitted', 'run.revoked', 'run.result_reported', 'orchestrator.edge_added', 'orchestrator.plan_created', 'orchestrator.attempt_started'])
      ok(ev.includes(t), `the project’s stream carries ${t}`);
    const c = await pool.connect();
    try { await c.query('BEGIN'); await c.query("INSERT INTO workforce_divisions(workspace_id,key,name) VALUES($1,'ghost','Ghost')", [ws]); await c.query('ROLLBACK'); } finally { c.release(); }
    ok(!(await pool.query("SELECT 1 FROM workforce_events WHERE type='division.created' AND workspace_id=$1", [ws])).rowCount, 'a rolled-back change leaves no event');
    await pool.query("INSERT INTO workforce_divisions(workspace_id,key,name) VALUES($1,'dev','Dev')", [ws]);
    ok((await pool.query("SELECT 1 FROM workforce_events WHERE type='division.created' AND workspace_id=$1", [ws])).rowCount === 1, 'a committed division appends division.created');
    ok(await pool.query('DELETE FROM workforce_events WHERE project_id=$1', [P]).then(() => false, (e) => e.code === '23514'), 'the stream is append-only');

    // ── 6. scoped audit view
    const runS = await admit(S, partS, owner);
    const wsAsViewer = (await call('GET', `/api/audit/events?scope=workspace:${ws}&limit=200`, viewer)).j;
    ok(wsAsViewer.events.length > 0 && wsAsViewer.events.every((e) => e.projectId !== S), 'a workspace viewer sees the workspace’s events, never the secret project’s (mutation: scoped-read)');
    ok(wsAsViewer.hidden > 0, 'and the ones they may not see are counted as hidden');
    const wsAsOwner = (await call('GET', `/api/audit/events?scope=workspace:${ws}&limit=200`, owner)).j;
    ok(wsAsOwner.events.some((e) => e.subject.id === runS.admissionId), 'the owner sees the secret project’s run');
    ok((await call('GET', `/api/audit/events?scope=project:${S}`, viewer)).s === 404, 'the secret project’s audit view is 404 to the viewer');
    ok((await call('GET', `/api/audit/events?scope=workspace:${ws}`, stranger)).s === 404, 'a stranger gets 404 for the workspace audit view');
    const proj = (await call('GET', `/api/audit/events?scope=project:${P}&types=orchestrator`, viewer)).j;
    ok(proj.events.length > 0 && proj.events.every((e) => e.type.startsWith('orchestrator.')), 'the project view filters by type');
    ok(!JSON.stringify(wsAsOwner).match(/"summary"|"instructions"/), 'events carry metadata only — no run summaries or agent instructions');
    const page2 = (await call('GET', `/api/audit/events?scope=project:${P}&limit=2`, editor)).j;
    const page3 = (await call('GET', `/api/audit/events?scope=project:${P}&limit=2&before=${page2.cursor}`, editor)).j;
    ok(page2.events.length === 2 && page3.events.every((e) => Number(e.id) < Number(page2.events[1].id)), 'paging by id is stable');
  } finally {
    server.close();
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed${MUTATE ? ` (mutation ${MUTATE})` : ''}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
