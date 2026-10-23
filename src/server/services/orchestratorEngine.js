/**
 * The platform's ONE seam to the XENO Orchestrator engine (`@xenosystem/orchestrator`, the xeno-orchestrator repo).
 *
 * Owner, 2026-10-23: "why are you inventing stuff that we already have as products?" The platform used to carry its
 * own copy of the kernel's logic (a hand-written ready rule, attempt ceiling and a Kahn topological sort). That logic
 * lives in the engine; this module only injects the engine's required port — the SDK's WorkflowPlanner, which owns DAG
 * topology (cycle refusal, order) per xeno-orchestrator/INTEGRATION.md — and hands the decisions to the platform.
 *
 * The platform owns persistence through the existing owners (Tasks, goals, objectives, run admissions) and keeps the
 * database cycle trigger as defence in depth. It decides NOTHING about readiness, order, cycles or attempts itself.
 *
 * `engineForTests` exists so a test can swap the engine and prove the platform's answers follow it (a platform that
 * computed readiness itself would not change). Production never calls it.
 */
import * as orchestrator from '@xenosystem/orchestrator';
import { WorkflowPlanner } from '@xenosystem/agent-sdk/control-plane';

const planner = new WorkflowPlanner();
let engine = orchestrator;

/** Readiness of a graph: { nodes: [{ id, done }], edges: [{ from, to }] } → { order, nodes: { id: { ready, blockedBy } }, ready } */
export const planGraph = ({ nodes, edges }) => engine.planGraph({ nodes, edges, planner });
/** Would adding from→to close a loop over these edges? */
export const wouldCycle = ({ edges, from, to }) => engine.wouldCycle({ edges, from, to, planner });
/** May a step take its next attempt? → { allowed, attempt } | { allowed: false, reason } */
export const attemptDecision = (input) => engine.attemptDecision(input);

/** One item's readiness from its blockers' done flags: { done, blockers: [{ done }] } → { openBlockers, ready }. */
export function readinessOf({ done = false, blockers = [] } = {}) {
  const g = planGraph({ nodes: [{ id: 'item', done: !!done }, ...blockers.map((b, i) => ({ id: `blocker-${i}`, done: !!b.done }))],
    edges: blockers.map((_, i) => ({ from: `blocker-${i}`, to: 'item' })) });
  return { openBlockers: g.nodes.item.blockedBy.length, ready: g.nodes.item.ready };
}

/**
 * Would a new dependency from → to ({ kind, id }) close a loop? The platform reads every edge `to` already leads to
 * (both stores: Tasks' `blocks` links and orchestrator_edges); the ENGINE decides. The database trigger
 * (orchestrator_refuse_cycle) refuses it again under a lock — defence in depth against a concurrent writer.
 */
export async function closesLoop(db, from, to) {
  const reach = (await db.query(`WITH RECURSIVE e AS (
      SELECT 'task'::text AS fk, from_task AS fi, 'task'::text AS tk, to_task AS ti FROM task_links WHERE kind = 'blocks'
      UNION ALL SELECT from_kind, from_id, to_kind, to_id FROM orchestrator_edges),
    r AS (SELECT * FROM e WHERE fk = $1 AND fi = $2::uuid UNION SELECT e.* FROM e JOIN r ON e.fk = r.tk AND e.fi = r.ti)
    SELECT fk, fi, tk, ti FROM r`, [to.kind, String(to.id)])).rows;
  return wouldCycle({ edges: reach.map((x) => ({ from: `${x.fk}:${x.fi}`, to: `${x.tk}:${x.ti}` })), from: `${from.kind}:${from.id}`, to: `${to.kind}:${to.id}` });
}

/** Test seam: swap the engine (null restores the real one). */
export function engineForTests(next) { engine = next || orchestrator; }
export const realEngine = orchestrator;
