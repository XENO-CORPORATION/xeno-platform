/**
 * The platform's Orchestrator is a THIN ADAPTER over `@xenosystem/orchestrator` (owner, 2026-10-23: "why are you
 * inventing stuff that we already have as products?"). This proves the platform's readiness, order and cycle answers
 * ARE the engine's — not a second copy that merely agrees with it today.
 *
 *   1. the adapter hands the engine the SDK WorkflowPlanner and returns the package's own decisions
 *   2. SWAP THE ENGINE and the platform's answer follows it — a platform computing readiness itself would not move
 *   3. no hand-written ready rule, attempt ceiling or topological sort is left in the platform's services
 *
 * Mutation (2026-10-23): ORCH_ENGINE_MUTATE=1 swaps in an engine that calls everything ready → the "platform's ready
 * set is the package's" assertions fail (3 fail). Restored: all pass.
 *
 * Run: node src/server/tests/orchestrator-engine.test.mjs   (no database needed)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as pkg from '@xenosystem/orchestrator';
import { WorkflowPlanner } from '@xenosystem/agent-sdk/control-plane';
import * as adapter from '../services/orchestratorEngine.js';
import { taskReadiness } from '../services/workforceOrchestrator.js';

const allReady = { ...pkg, planGraph: ({ nodes }) => ({ waves: [nodes.map((n) => n.id)], order: nodes.map((n) => n.id), ready: nodes.map((n) => n.id),
  nodes: Object.fromEntries(nodes.map((n) => [n.id, { done: n.done, ready: true, blockedBy: [] }])) }) };
if (process.env.ORCH_ENGINE_MUTATE === '1') adapter.engineForTests(allReady);

// taskReadiness reads two rows sets from its owners; everything after that is the engine's
const fakeDb = (blockerDone) => ({ query: async (sql) => (/FROM task_links/.test(sql) ? { rows: blockerDone.map((done) => ({ done })) } : { rows: [] }) });
const planner = new WorkflowPlanner();
const graph = { nodes: [{ id: 'a', done: true }, { id: 'b', done: false }, { id: 'c', done: false }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] };

test("the platform's ready set is the package's (with the SDK planner)", () => {
  assert.deepEqual(adapter.planGraph(graph), pkg.planGraph({ ...graph, planner }));
  assert.deepEqual(adapter.planGraph(graph).ready, ['b']);
});
test("the platform's cycle refusal is the package's", () => {
  assert.equal(adapter.wouldCycle({ edges: graph.edges, from: 'c', to: 'a' }), true);
  assert.equal(adapter.wouldCycle({ edges: graph.edges, from: 'a', to: 'c' }), false);
});
test("a task's readiness on the platform is the package's: an open blocker blocks", async () => {
  assert.deepEqual(await taskReadiness(fakeDb([false, true]), 't'), { openBlockers: 1, ready: false });
  assert.deepEqual(await taskReadiness(fakeDb([true]), 't'), { openBlockers: 0, ready: true });
});
test('swapping the engine changes the platform answer (it follows the engine, it does not decide)', async () => {
  const before = await taskReadiness(fakeDb([false]), 't');
  adapter.engineForTests(allReady);
  try {
    const after = await taskReadiness(fakeDb([false]), 't');
    assert.notDeepEqual(after, before);
    assert.deepEqual(after, { openBlockers: 0, ready: true });
  } finally { adapter.engineForTests(process.env.ORCH_ENGINE_MUTATE === '1' ? allReady : null); }
});
test("attempt decisions are the package's", () => {
  const input = { open: true, live: false, attempts: 2, maxAttempts: 2, dependenciesSatisfied: true };
  assert.deepEqual(adapter.attemptDecision(input), pkg.attemptDecision(input));
  assert.equal(adapter.attemptDecision(input).reason, 'exhausted');
});
test('no second copy of the kernel rules is left in the platform', () => {
  const orch = readFileSync(new URL('../services/workforceOrchestrator.js', import.meta.url), 'utf8');
  const tasks = readFileSync(new URL('../services/xenoTasks.js', import.meta.url), 'utf8');
  assert.equal(adapter.realEngine.planGraph, pkg.planGraph);
  assert.doesNotMatch(orch, /indeg|blockedBy\.length\s*===\s*0|attempts\.length\s*<\s*s\.max_attempts|prev\.length\s*>=\s*s\.max_attempts/);
  assert.doesNotMatch(tasks, /open\s*===\s*0/);
  assert.match(orch, /engine\.planGraph/); assert.match(orch, /engine\.attemptDecision/); assert.match(orch, /engine\.closesLoop\(/);
  assert.match(tasks, /readinessOf\(/); assert.match(tasks, /closesLoop\(/);
});
