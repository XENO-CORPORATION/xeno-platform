/**
 * XENO Orchestrator on the platform (xeno-orchestrator/SPEC.md + INTEGRATION.md, owner-approved 2026-10-16;
 * "full development", 2026-10-20). A THIN ADAPTER: every decision — readiness, the ready set, dependency order, cycle
 * refusal, the next attempt — is made by the engine (`@xenosystem/orchestrator`, through ./orchestratorEngine.js, with
 * the SDK WorkflowPlanner injected). Owner, 2026-10-23: the platform must not re-invent the product; it had. This file
 * only reads and writes the platform's OWN records through the existing owners and keeps no second work-item, session
 * or agent-loop store:
 *
 *   work items   are XENO Tasks (tasks), project goals (project_goals) and objectives (project_objectives)
 *   task→task    dependencies are Tasks' own `blocks` links (task_links) — written through xenoTasks.addLink, so the
 *                task page, the canvas and the orchestrator read ONE edge
 *   other edges  (a goal or an objective at one end) are orchestrator_edges
 *   cycles       are refused by the engine (wouldCycle) before a write, and again by the DATABASE on both tables
 *                under one lock (orchestrator_refuse_cycle) — defence in depth against a concurrent writer
 *   an attempt   is bound to a RUN ADMISSION (workforceRunAdmission) — the run's authority is the run's; the attempt's
 *                state is derived from the run's own rows (result, fence), never stored, so it cannot disagree
 *   execution    stays with the run's runtime and Box; nothing here dispatches
 *
 * The rules (ready = every dependency done; next attempt = previous + 1, never past the ceiling, never beside a live
 * one; closed steps take no more) are the engine's `planGraph` / `attemptDecision`, the same ones its own tick() uses.
 * Do not restate them here: src/server/tests/orchestrator-engine.test.mjs swaps the engine and fails if you do.
 *
 * Who may do what (each the owning service's own rule, read here, never restated looser):
 *   read a graph / plan     a viewer of the project (or of the objective's workspace)
 *   add or remove an edge   task end: whoever may link the task (xenoTasks); goal end: a project editor;
 *                           objective end: a workspace admin or the objective's owner
 *   create a plan, attempt  a project editor; an attempt binds a run the caller themself admitted on that project
 */
import { check } from '../utils/authzReBAC.js';
import * as tasks from './xenoTasks.js';
import { readRunAdmission } from './workforceRunAdmission.js';
import * as engine from './orchestratorEngine.js';

export class OrchestratorError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'OrchestratorError'; this.code = code; this.status = status; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['task', 'goal', 'objective'];
const notFound = (what = 'Not found') => new OrchestratorError(what, 'not_found', 404);
const uuid = (v, what) => { if (!UUID.test(String(v || ''))) throw notFound(`${what} not found`); return String(v).toLowerCase(); };
const allowed = async (db, object, relation, userId) => (await check(db, { object, relation, subject: `user:${userId}` })).allowed;
const DONE_TASK = new Set(['done', 'wont_do']);

/** Postgres refused the edge because it closes a loop → a typed conflict. */
export function isCycle(e) { return e && e.code === '23514' && /orchestrator_cycle/.test(String(e.message)); }

async function projectRole(db, me, projectId) {
  const view = await allowed(db, `project:${projectId}`, 'viewer', me.id);
  return { view, edit: view && await allowed(db, `project:${projectId}`, 'editor', me.id) };
}

/** Resolve one end: { kind, id } (a task may be given by key T-n). Returns the node with the caller's rights on it. */
async function node(db, me, end) {
  if (!end || !KINDS.includes(end.kind)) throw new OrchestratorError('An edge end is { kind: task | goal | objective, id }', 'bad_input');
  if (end.kind === 'task') {
    const ref = end.key || end.id;
    const n = /^T-\d+$/i.test(String(ref)) ? Number(String(ref).slice(2)) : null;
    const row = n ? (await db.query('SELECT id, number FROM tasks WHERE number=$1 AND deleted_at IS NULL', [n])).rows[0]
      : UUID.test(String(ref)) ? (await db.query('SELECT id, number FROM tasks WHERE id=$1 AND deleted_at IS NULL', [ref])).rows[0] : null;
    if (!row) throw notFound('Task not found');
    const t = await tasks.getTask(db, me, `T-${row.number}`).catch(() => { throw notFound('Task not found'); });
    return { kind: 'task', id: String(row.id), key: `T-${row.number}`, edit: !!(t.canLink ?? (t.extras && t.extras.canLink)), task: t };
  }
  if (end.kind === 'goal') {
    const g = (await db.query('SELECT id, project_id FROM project_goals WHERE id=$1', [uuid(end.id, 'Goal')])).rows[0];
    if (!g) throw notFound('Goal not found');
    const r = await projectRole(db, me, g.project_id); if (!r.view) throw notFound('Goal not found');
    return { kind: 'goal', id: String(g.id), edit: r.edit, projectId: String(g.project_id) };
  }
  const o = (await db.query('SELECT id, workspace_id, owner_user_id FROM project_objectives WHERE id=$1', [uuid(end.id, 'Objective')])).rows[0];
  if (!o || !(await allowed(db, `workspace:${o.workspace_id}`, 'viewer', me.id))) throw notFound('Objective not found');
  const edit = String(o.owner_user_id) === String(me.id) || (me.kind === 'human' && await allowed(db, `workspace:${o.workspace_id}`, 'admin', me.id));
  return { kind: 'objective', id: String(o.id), edit, workspaceId: String(o.workspace_id) };
}

/** orchestrator.edge.add — `from` must be done before `to` can start. */
export async function addEdge(db, me, { from, to } = {}) {
  const a = await node(db, me, from), b = await node(db, me, to);
  if (a.kind === b.kind && a.id === b.id) throw new OrchestratorError('Something cannot depend on itself', 'conflict', 409);
  if (a.kind === 'task' && b.kind === 'task') {
    // ONE edge: Tasks' own `blocks` link. xenoTasks.addLink decides the right to link, and maps a cycle to 409.
    await tasks.addLink(db, me, a.key, { kind: 'blocks', to: b.key });
    const l = (await db.query("SELECT id FROM task_links WHERE from_task=$1 AND to_task=$2 AND kind='blocks'", [a.id, b.id])).rows[0];
    return { edge: { id: String(l.id), store: 'task_links', from: { kind: 'task', id: a.id, key: a.key }, to: { kind: 'task', id: b.id, key: b.key } } };
  }
  if (!a.edit || !b.edit) throw new OrchestratorError('You can only connect work you may change', 'not_allowed', 403);
  // the engine decides: would a→b close a loop over everything `b` already leads to?
  if (await engine.closesLoop(db, a, b)) {
    throw new OrchestratorError('That would make a loop: the other side already depends on this one', 'cycle', 409);
  }
  try {
    const r = await db.query(`INSERT INTO orchestrator_edges (from_kind, from_id, to_kind, to_id, created_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (from_kind, from_id, to_kind, to_id) DO UPDATE SET from_kind = EXCLUDED.from_kind RETURNING id`, [a.kind, a.id, b.kind, b.id, me.id]);
    return { edge: { id: String(r.rows[0].id), store: 'orchestrator_edges', from: { kind: a.kind, id: a.id, ...(a.key ? { key: a.key } : {}) }, to: { kind: b.kind, id: b.id, ...(b.key ? { key: b.key } : {}) } } };
  } catch (e) {
    if (isCycle(e)) throw new OrchestratorError('That would make a loop: the other side already depends on this one', 'cycle', 409);
    throw e;
  }
}

/** orchestrator.edge.remove — an orchestrator edge, or a task→task `blocks` link (removed through Tasks). */
export async function removeEdge(db, me, { edgeId } = {}) {
  const id = uuid(edgeId, 'Edge');
  const e = (await db.query('SELECT * FROM orchestrator_edges WHERE id=$1', [id])).rows[0];
  if (e) {
    const a = await node(db, me, { kind: e.from_kind, id: e.from_id }).catch(() => null), b = await node(db, me, { kind: e.to_kind, id: e.to_id }).catch(() => null);
    if (!a || !b) throw notFound('Edge not found');
    if (!a.edit || !b.edit) throw new OrchestratorError('You can only disconnect work you may change', 'not_allowed', 403);
    await db.query('DELETE FROM orchestrator_edges WHERE id=$1', [id]);
    return { removed: true };
  }
  const l = (await db.query("SELECT l.id, t.number FROM task_links l JOIN tasks t ON t.id = l.to_task WHERE l.id=$1 AND l.kind='blocks'", [id])).rows[0];
  if (!l) throw notFound('Edge not found');
  await tasks.removeLink(db, me, `T-${l.number}`, id);
  return { removed: true };
}

/**
 * The graph of one project: its tasks and goals, the objectives its goals roll up to, every dependency edge among
 * them, and per node `done` / `ready` / `blockedBy` (the open blockers). Ready = not done, and every blocker done.
 */
export async function readGraph(db, me, { projectId } = {}) {
  const pid = uuid(projectId, 'Project');
  if (!(await projectRole(db, me, pid)).view) throw notFound('Project not found');
  const ts = (await db.query(`SELECT id, number, title, status, assignee_id FROM tasks WHERE project_id=$1 AND deleted_at IS NULL ORDER BY number`, [pid])).rows;
  const gs = (await db.query('SELECT id, title, status, objective_id FROM project_goals WHERE project_id=$1 ORDER BY created_at, id', [pid])).rows;
  const objIds = [...new Set(gs.map((g) => g.objective_id).filter(Boolean).map(String))];
  const os = objIds.length ? (await db.query('SELECT id, title, status, workspace_id FROM project_objectives WHERE id = ANY($1::uuid[])', [objIds])).rows : [];
  const seenObj = [];
  for (const o of os) if (await allowed(db, `workspace:${o.workspace_id}`, 'viewer', me.id)) seenObj.push(o);
  const nodes = new Map();
  const k = (kind, id) => `${kind}:${id}`;
  for (const t of ts) nodes.set(k('task', t.id), { kind: 'task', id: String(t.id), key: `T-${t.number}`, title: t.title, status: t.status, done: DONE_TASK.has(t.status) });
  for (const g of gs) nodes.set(k('goal', g.id), { kind: 'goal', id: String(g.id), title: g.title, status: g.status, done: g.status === 'completed' });
  for (const o of seenObj) nodes.set(k('objective', o.id), { kind: 'objective', id: String(o.id), title: o.title, status: o.status, done: o.status === 'completed' });
  const ids = [...nodes.values()].map((n) => n.id);
  const edgeRows = ids.length ? (await db.query(`SELECT l.id, 'task' AS from_kind, l.from_task AS from_id, 'task' AS to_kind, l.to_task AS to_id, 'task_links' AS store
      FROM task_links l WHERE l.kind='blocks' AND (l.from_task = ANY($1::uuid[]) OR l.to_task = ANY($1::uuid[]))
    UNION ALL SELECT e.id, e.from_kind, e.from_id, e.to_kind, e.to_id, 'orchestrator_edges' FROM orchestrator_edges e
      WHERE e.from_id = ANY($1::uuid[]) OR e.to_id = ANY($1::uuid[])`, [ids])).rows : [];
  // a blocker OUTSIDE this project (another project's task) still blocks: read its done-ness, show it closed
  const external = new Map();
  for (const e of edgeRows) {
    const fk = k(e.from_kind, e.from_id);
    if (!nodes.has(fk) && !external.has(fk)) external.set(fk, await externalDone(db, e.from_kind, e.from_id));
  }
  const edges = [], engineEdges = [];
  for (const e of edgeRows) {
    const fk = k(e.from_kind, e.from_id), tk = k(e.to_kind, e.to_id);
    if (!nodes.has(tk)) continue;
    engineEdges.push({ from: fk, to: tk });
    if (nodes.has(fk)) edges.push({ id: String(e.id), store: e.store, from: fk, to: tk });
  }
  // the engine decides readiness; an outside blocker is a node it sees as done or not, shown here as 'outside'
  let g;
  try {
    g = engine.planGraph({ nodes: [...[...nodes].map(([ref, n]) => ({ id: ref, done: n.done })), ...[...external].map(([ref, done]) => ({ id: ref, done: !!done }))], edges: engineEdges });
  } catch (err) {
    if (err && err.message === 'GRAPH_CYCLE') throw new OrchestratorError('This project’s dependencies form a loop', 'cycle', 409);
    throw err;
  }
  for (const [key, n] of nodes) {
    n.blockedBy = g.nodes[key].blockedBy.map((ref) => (nodes.has(ref) ? ref : 'outside'));
    n.ready = g.nodes[key].ready;
  }
  return { projectId: pid, nodes: [...nodes.values()].map((n) => ({ ...n, ref: k(n.kind, n.id) })), edges, ready: [...nodes.values()].filter((n) => n.ready).map((n) => k(n.kind, n.id)) };
}
async function externalDone(db, kind, id) {
  if (kind === 'task') { const r = (await db.query('SELECT status FROM tasks WHERE id=$1', [id])).rows[0]; return !r || DONE_TASK.has(r.status); }
  const r = (await db.query(`SELECT status FROM ${kind === 'goal' ? 'project_goals' : 'project_objectives'} WHERE id=$1`, [id])).rows[0];
  return !r || r.status === 'completed';
}

/** The ready set: what can start now. `kind` narrows it (default: tasks). */
export async function readReady(db, me, { projectId, kind = 'task' } = {}) {
  const g = await readGraph(db, me, { projectId });
  return { projectId: g.projectId, ready: g.nodes.filter((n) => n.ready && (kind === 'any' || n.kind === kind)).map(({ ref, kind: nk, id, key, title, status }) => ({ ref, kind: nk, id, key, title, status })) };
}

/** Is one task ready (every `blocks` link into it is from a done task)? Used by the task page. */
export async function taskReadiness(db, taskId) {
  const blockers = (await db.query(`SELECT f.status IN ('done','wont_do') AS done FROM task_links l JOIN tasks f ON f.id = l.from_task
    WHERE l.to_task=$1 AND l.kind='blocks'`, [taskId])).rows.map((r) => ({ done: r.done }));
  for (const e of (await db.query(`SELECT e.from_kind, e.from_id FROM orchestrator_edges e WHERE e.to_kind='task' AND e.to_id=$1`, [taskId])).rows) {
    blockers.push({ done: await externalDone(db, e.from_kind, e.from_id) });
  }
  return engine.readinessOf({ blockers });
}

// ───────────────────────────── plans and attempts

/** The state an attempt is in, derived from its run's rows: never stored, so it always follows the run. */
export async function attemptState(db, admissionId) {
  const res = (await db.query('SELECT outcome, interrupted_reason FROM workforce_run_results WHERE admission_id=$1', [admissionId])).rows[0];
  if (res) return { state: res.outcome, reason: res.interrupted_reason || null };
  const fence = (await db.query('SELECT reason FROM workforce_run_revocations WHERE admission_id = workforce_run_admission_fence($1)', [admissionId])).rows[0];
  if (fence) return { state: 'cancelled', reason: fence.reason };
  return { state: 'running', reason: null };
}
const LIVE = new Set(['running']);

/** orchestrator.plan.create — { projectId, name, steps: [{ task: 'T-n', maxAttempts? }] } */
export async function createPlan(db, me, { projectId, name, steps } = {}) {
  const pid = uuid(projectId, 'Project');
  const role = await projectRole(db, me, pid);
  if (!role.view) throw notFound('Project not found');
  if (!role.edit) throw new OrchestratorError('Only a project editor plans its work', 'not_allowed', 403);
  const nm = String(name || '').trim(); if (!nm || nm.length > 200) throw new OrchestratorError('A plan needs a name (up to 200 characters)', 'bad_input');
  if (!Array.isArray(steps) || !steps.length || steps.length > 1000) throw new OrchestratorError('A plan has 1 to 1000 steps', 'bad_input');
  const resolved = [];
  for (const s of steps) {
    const n = await node(db, me, { kind: 'task', id: s && (s.task || s.key || s.id) });
    const max = s.maxAttempts === undefined ? 3 : Number(s.maxAttempts);
    if (!Number.isInteger(max) || max < 1 || max > 10) throw new OrchestratorError('maxAttempts is 1 to 10', 'bad_input');
    if (resolved.some((r) => r.id === n.id)) throw new OrchestratorError(`${n.key} is in the plan twice`, 'bad_input');
    resolved.push({ ...n, max });
  }
  const c = await db.connect?.() || db;
  try {
    if (c !== db) await c.query('BEGIN');
    const p = (await c.query('INSERT INTO orchestrator_plans (project_id, name, created_by) VALUES ($1,$2,$3) RETURNING id', [pid, nm, me.id])).rows[0];
    for (const r of resolved) await c.query('INSERT INTO orchestrator_plan_steps (plan_id, task_id, max_attempts) VALUES ($1,$2,$3)', [p.id, r.id, r.max]);
    if (c !== db) await c.query('COMMIT');
    return getPlan(db, me, { planId: p.id });
  } catch (e) {
    if (c !== db) await c.query('ROLLBACK').catch(() => {});
    if (e.code === '23514') throw new OrchestratorError('Every step must be a task of the plan’s own project', 'bad_input');
    throw e;
  } finally { if (c !== db) c.release(); }
}

async function planRow(db, me, planId) {
  const p = (await db.query('SELECT * FROM orchestrator_plans WHERE id=$1', [uuid(planId, 'Plan')])).rows[0];
  if (!p) throw notFound('Plan not found');
  const role = await projectRole(db, me, p.project_id);
  if (!role.view) throw notFound('Plan not found');
  return { p, role };
}

/** orchestrator.plan.get — steps in dependency order, each with readiness and its attempts (state from the run). */
export async function getPlan(db, me, { planId } = {}) {
  const { p, role } = await planRow(db, me, planId);
  const steps = (await db.query(`SELECT s.id, s.task_id, s.max_attempts, t.number, t.title, t.status FROM orchestrator_plan_steps s JOIN tasks t ON t.id = s.task_id
    WHERE s.plan_id=$1 ORDER BY t.number`, [p.id])).rows;
  const atts = (await db.query('SELECT * FROM orchestrator_attempts WHERE step_id = ANY($1::uuid[]) ORDER BY attempt', [steps.map((s) => s.id)])).rows;
  const out = [];
  for (const s of steps) {
    const attempts = [];
    for (const a of atts.filter((x) => x.step_id === s.id)) attempts.push({ id: String(a.id), attempt: a.attempt, admissionId: String(a.admission_id), startedAt: a.created_at, ...(await attemptState(db, a.admission_id)) });
    const rd = await taskReadiness(db, s.task_id);
    const done = DONE_TASK.has(s.status), live = attempts.some((a) => LIVE.has(a.state));
    const decision = engine.attemptDecision({ open: !done, live, attempts: attempts.length, maxAttempts: s.max_attempts, dependenciesSatisfied: rd.ready });
    out.push({ id: String(s.id), task: { id: String(s.task_id), key: `T-${s.number}`, title: s.title, status: s.status }, maxAttempts: s.max_attempts,
      done, ready: !done && rd.ready, openBlockers: rd.openBlockers, attempts,
      canAttempt: role.edit && decision.allowed });
  }
  // dependency order over the plan's own steps: the engine's (planner) waves; within a wave, by task number
  const ids = out.map((s) => s.task.id);
  const deps = (await db.query("SELECT from_task, to_task FROM task_links WHERE kind='blocks' AND from_task = ANY($1::uuid[]) AND to_task = ANY($1::uuid[])", [ids])).rows;
  const g = engine.planGraph({ nodes: out.map((s) => ({ id: s.task.id, done: s.done })), edges: deps.map((d) => ({ from: String(d.from_task), to: String(d.to_task) })) });
  const wave = new Map(); g.waves.forEach((w, i) => w.forEach((id) => wave.set(id, i)));
  out.sort((a, b) => (wave.get(a.task.id) - wave.get(b.task.id)) || (Number(a.task.key.slice(2)) - Number(b.task.key.slice(2))));
  return { plan: { id: String(p.id), projectId: String(p.project_id), name: p.name, state: p.state, createdAt: p.created_at, canEdit: role.edit,
    complete: out.every((s) => s.done), steps: out } };
}

export async function listPlans(db, me, { projectId } = {}) {
  const pid = uuid(projectId, 'Project');
  if (!(await projectRole(db, me, pid)).view) throw notFound('Project not found');
  const rows = (await db.query(`SELECT p.id, p.name, p.state, p.created_at, count(s.id)::int AS steps FROM orchestrator_plans p LEFT JOIN orchestrator_plan_steps s ON s.plan_id = p.id
    WHERE p.project_id=$1 GROUP BY p.id ORDER BY p.created_at DESC LIMIT 100`, [pid])).rows;
  return { plans: rows.map((r) => ({ id: String(r.id), name: r.name, state: r.state, steps: r.steps, createdAt: r.created_at })) };
}

/**
 * orchestrator.attempt.start — bind the next attempt of a step to a run the caller admitted on the plan's project.
 * Refused unless the step is ready, has no live attempt, and has attempts left. The run itself was admitted (and is
 * governed) by workforceRunAdmission; this only records which attempt it is.
 */
export async function startAttempt(db, me, { planId, task, admissionId } = {}) {
  const { p, role } = await planRow(db, me, planId);
  if (!role.edit) throw new OrchestratorError('Only a project editor starts work on a plan', 'not_allowed', 403);
  const n = await node(db, me, { kind: 'task', id: task });
  const adm = uuid(admissionId, 'Run');
  // the admission must be one the caller may read — i.e. theirs (readRunAdmission refuses anyone else as not found)
  const a = await readRunAdmission(db, { actorUserId: String(me.id), clientId: 'xeno-orchestrator' }, adm).catch(() => null);
  if (!a) throw notFound('Run not found');
  // seeing a run (a project viewer may) is not owning it: an attempt binds only a run the caller themself admitted
  const own = (await db.query('SELECT actor_user_id, project_id FROM workforce_run_admissions WHERE id=$1', [adm])).rows[0];
  if (!own || String(own.actor_user_id) !== String(me.id)) throw notFound('Run not found');
  if (String(own.project_id || '') !== String(p.project_id)) throw new OrchestratorError('That run was not admitted on this plan’s project', 'bad_input');
  const c = await db.connect?.() || db;
  try {
    if (c !== db) await c.query('BEGIN');
    const s = (await c.query('SELECT * FROM orchestrator_plan_steps WHERE plan_id=$1 AND task_id=$2 FOR UPDATE', [p.id, n.id])).rows[0];
    if (!s) throw notFound('That task is not a step of this plan');
    const rd = await taskReadiness(c, n.id);
    const prev = (await c.query('SELECT admission_id, attempt FROM orchestrator_attempts WHERE step_id=$1 ORDER BY attempt', [s.id])).rows;
    let live = false;
    for (const x of prev) if (LIVE.has((await attemptState(c, x.admission_id)).state)) { live = true; break; }
    // the engine decides whether this step may take its next attempt, and which number it is
    const d = engine.attemptDecision({ open: !DONE_TASK.has(n.task.status), live, attempts: prev.length, maxAttempts: s.max_attempts, dependenciesSatisfied: rd.ready });
    if (!d.allowed) {
      if (d.reason === 'closed') throw new OrchestratorError('That step is already done', 'conflict', 409);
      if (d.reason === 'blocked') throw new OrchestratorError(`${n.key} is still blocked by ${rd.openBlockers} unfinished item${rd.openBlockers === 1 ? '' : 's'}`, 'blocked', 409);
      if (d.reason === 'live') throw new OrchestratorError('An attempt on this step is still running', 'conflict', 409);
      throw new OrchestratorError('This step has no attempts left', 'conflict', 409);
    }
    const r = (await c.query('INSERT INTO orchestrator_attempts (step_id, attempt, admission_id, started_by) VALUES ($1,$2,$3,$4) RETURNING id, attempt',
      [s.id, d.attempt, adm, me.id])).rows[0];
    if (c !== db) await c.query('COMMIT');
    return { attempt: { id: String(r.id), planId: String(p.id), task: n.key, attempt: r.attempt, admissionId: adm, ...(await attemptState(db, adm)) } };
  } catch (e) {
    if (c !== db) await c.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') throw new OrchestratorError('That run is already bound to an attempt', 'conflict', 409);
    if (e.code === '23514') throw new OrchestratorError('That run was not admitted on this plan’s project by you', 'bad_input');
    throw e;
  } finally { if (c !== db) c.release(); }
}
