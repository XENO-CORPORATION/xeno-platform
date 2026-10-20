/**
 * Time off reaches assignment (services/workforceAvailability.js), on real Postgres:
 *   1. assigning a task to someone on time off is refused (assignee_away) — on create and on update;
 *   2. a PERSON's explicit overrideAway assigns it; an agent's override is refused (override_human_only);
 *   3. delegating to an agent on time off is refused the same way, and overridden the same way;
 *   4. starting a cloud run for an agent on time off is refused before anything is contacted; a person's override
 *      gets past the check (the run then stops at the runner, which this test does not have);
 *   5. assigning yourself is never asked; cancelled or ended time off does not count.
 * Mutation-checked with scripts/time-off-assignment-mutation.mjs.
 * Run: DATABASE_URL=postgresql://…/<disposable> node src/server/tests/time-off-assignment.test.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as tasks from '../services/xenoTasks.js';
import * as people from '../services/workforcePeople.js';
import * as platformAgents from '../services/platformAgents.js';
import * as cloudRuns from '../services/agentCloudRuns.js';
import { createAuthorizedProject } from '../services/chatProjectAuthority.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `to${process.pid}`;
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const refused = async (p, code, why) => { await assert.rejects(p, (e) => { assert.equal(e.code, code, `${why}: got ${e.code} ${e.message}`); return true; }, why); };

async function main() {
  await runAllMigrations(pool);
  const owner = await user('owner'), emp = await user('emp');
  const W = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'company',$2,$2) RETURNING id`, [owner, `${tag}-co`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${W}`, subject: `user:${owner}`, relation: 'owner' }, { object: `workspace:${W}`, subject: `user:${emp}`, relation: 'editor' }] });
  const me = { id: owner, kind: 'human', name: 'Owner' };
  const project = await createAuthorizedProject(pool, { principal: { type: 'user', id: String(owner) }, workspaceId: W, name: `${tag} project` });
  await writeTuples(pool, { writes: [{ object: `project:${project.id}`, subject: `user:${emp}`, relation: 'editor' }] });
  const agent = await platformAgents.create(pool, me, { name: `${tag} bot`, instructions: 'help', workspaceId: W });
  await writeTuples(pool, { writes: [{ object: `workspace:${W}`, subject: `user:${agent.userId}`, relation: 'editor' }] });
  await platformAgents.addProject(pool, me, agent.id, project.id).catch(() => {});

  const now = Date.now();
  await people.addTimeOff(pool, me, { workspaceId: W, principalId: emp, startsAt: new Date(now - 6e4), endsAt: new Date(now + 864e5), kind: 'vacation' });
  await people.addTimeOff(pool, me, { workspaceId: W, principalId: agent.userId, startsAt: new Date(now - 6e4), endsAt: new Date(now + 864e5), kind: 'leave' });

  // 1 + 2: tasks
  await refused(tasks.createTask(pool, me, { title: 'a', projectId: project.id, assigneeId: emp }), 'assignee_away', 'create refuses an absent assignee');
  const t1 = await tasks.createTask(pool, me, { title: 'b', projectId: project.id, assigneeId: emp, overrideAway: true });
  assert.equal(String(t1.assignee?.id), String(emp), 'a person’s override assigns it');
  const t2 = await tasks.createTask(pool, me, { title: 'c', projectId: project.id });
  await refused(tasks.updateTask(pool, me, t2.key, { assigneeId: emp }), 'assignee_away', 'update refuses an absent assignee');
  await tasks.updateTask(pool, me, t2.key, { assigneeId: emp, overrideAway: true });
  const asAgent = { id: agent.userId, kind: 'agent', name: 'Bot' };
  const t3 = await tasks.createTask(pool, asAgent, { title: 'agent-made', projectId: project.id }).catch((e) => ({ skip: e.code }));
  if (!t3.skip) await refused(tasks.createTask(pool, asAgent, { title: 'agent-assigns', projectId: project.id, assigneeId: emp, overrideAway: true }), 'override_human_only', 'an agent cannot override time off');
  else await refused(import('../services/workforceAvailability.js').then((m) => m.assertAvailableOrOverridden(pool, { workspaceId: W, principalId: emp, actorKind: 'agent', override: true })), 'override_human_only', 'an agent cannot override time off');

  // 3: delegation
  const t4 = await tasks.createTask(pool, me, { title: 'd', projectId: project.id });
  await refused(tasks.delegateTask(pool, me, t4.key, { agentId: agent.userId }), 'assignee_away', 'delegating to an agent on leave is refused');
  await tasks.delegateTask(pool, me, t4.key, { agentId: agent.userId, overrideAway: true });

  // 4: cloud run — refused before the runner is even asked
  let contacted = 0;
  const fetchImpl = async () => { contacted += 1; return { ok: false, json: async () => ({}) }; };
  const env = { AGENTS_API_BASE_URL: 'http://127.0.0.1:9' };
  const t5 = await tasks.createTask(pool, me, { title: 'e', projectId: project.id });
  await refused(cloudRuns.start(pool, me, agent.id, { taskKey: t5.key }, { fetchImpl, env }), 'assignee_away', 'a run for an agent on leave is refused');
  assert.equal(contacted, 0, 'nothing was contacted');
  await refused(cloudRuns.start(pool, me, agent.id, { taskKey: t5.key, overrideAway: true }, { fetchImpl, env }), 'runner_lacks_agents', 'a person’s override passes the time-off check');

  // 5: self, cancelled
  const t6 = await tasks.createTask(pool, { id: emp, kind: 'human', name: 'Emp' }, { title: 'mine', projectId: project.id, assigneeId: emp });
  assert.equal(String(t6.assignee?.id), String(emp), 'assigning yourself is never asked');
  await pool.query(`UPDATE workforce_time_off SET cancelled_at = now() WHERE principal_id = $1`, [emp]);
  await tasks.createTask(pool, me, { title: 'f', projectId: project.id, assigneeId: emp });
  console.log('time-off-assignment: all checks passed');
  await pool.end();
}
main().catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
