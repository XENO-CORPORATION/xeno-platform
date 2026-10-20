/**
 * Corpo › Analytics (services/analytics.js + analyticsMcp.js) on real Postgres.
 *
 *   - every metric reads ONLY its workspace: a second workspace full of data changes nothing;
 *   - tasks: created / done in the window, open by status, median cycle time; personal tasks count in the
 *     Personal workspace and never in a team one; a division narrows tasks and runs to its projects;
 *   - credits read the workspace wallet (credit_accounts keyed by the workspace id), spend only;
 *   - support counts tickets raised from the workspace; storage counts its files;
 *   - §8.11: a viewer reads, an editor saves/changes/deletes dashboards, a stranger is refused, an agent reads as
 *     its owner and cannot write; a widget may only name a known metric; delete is soft and restore undoes it;
 *   - MCP: three read-only tools, no write tool.
 *
 * Run: DATABASE_URL=postgresql://… node tests/workspace-analytics.test.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { ensurePersonalWorkspace } from '../services/personalWorkspace.js';
import * as A from '../services/analytics.js';
import * as Mcp from '../services/analyticsMcp.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `an${process.pid}`; let seq = 0;
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const refuses = async (p, code) => { await assert.rejects(p, (e) => { assert.ok(e instanceof A.AnalyticsError || e instanceof Mcp.AnalyticsMcpError, String(e)); assert.equal(e.code, code); return true; }); };
const team = async (owner, name) => (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team',$2,$3) RETURNING id`, [owner, name, `${tag}-${seq += 1}`])).rows[0].id;
const project = async (ws, name) => (await pool.query(`INSERT INTO chat_projects (workspace_id, name) VALUES ($1,$2) RETURNING id`, [ws, name])).rows[0].id;
const task = async (fields) => {
  const f = { status: 'todo', created_at: new Date(), closed_at: null, ...fields };
  return (await pool.query(`INSERT INTO tasks (title, status, project_id, owner_user_id, created_at, closed_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [`t${seq += 1}`, f.status, f.project_id || null, f.owner_user_id || null, f.created_at, f.closed_at])).rows[0].id;
};
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000);

async function main() {
  await runAllMigrations(pool);
  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), stranger = await user('stranger'), agentU = await user('agent');
  await pool.query(`INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)`, [agentU, editor]);
  const ws = await team(owner, 'Analytics'), other = await team(stranger, 'Other');
  await writeTuples(pool, { writes: [['owner', owner], ['editor', editor], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation }))
    .concat([{ object: `workspace:${other}`, subject: `user:${stranger}`, relation: 'owner' }]) });
  const O = { id: owner, kind: 'human' }, E = { id: editor, kind: 'human' }, V = { id: viewer, kind: 'human' }, S = { id: stranger, kind: 'human' }, AG = { id: agentU, kind: 'agent' };
  const w = { workspace: ws };

  // ── data: two projects in ws (one in a division), one in the other workspace, one personal task
  const pA = await project(ws, 'Alpha'), pB = await project(ws, 'Beta'), pX = await project(other, 'Elsewhere');
  const div = (await pool.query(`INSERT INTO workforce_divisions (workspace_id, key, name) VALUES ($1,'eng','Engineering') RETURNING id`, [ws])).rows[0].id;
  await pool.query(`INSERT INTO workforce_project_divisions (project_id, division_id) VALUES ($1,$2)`, [pA, div]);
  await task({ project_id: pA, status: 'done', created_at: hoursAgo(10), closed_at: hoursAgo(6) });   // 4 h
  await task({ project_id: pA, status: 'done', created_at: hoursAgo(30), closed_at: hoursAgo(10) });  // 20 h
  await task({ project_id: pA, status: 'in_progress' });
  await task({ project_id: pB, status: 'blocked' });
  await task({ project_id: pB, status: 'done', created_at: hoursAgo(24 * 60), closed_at: hoursAgo(24 * 50) });   // outside a 30-day window
  for (let i = 0; i < 5; i++) await task({ project_id: pX, status: 'done', created_at: hoursAgo(5), closed_at: hoursAgo(1) });
  await task({ owner_user_id: owner, status: 'todo' });   // the owner's personal task

  const t = (await A.queryMetric(pool, V, { ...w, metric: 'tasks.throughput', days: 30 })).value;
  assert.equal(t.created, 4, 'four tasks created in the window, none from the other workspace, not the personal one');
  assert.equal(t.closed, 2); assert.deepEqual(t.open, { blocked: 1, in_progress: 1 });
  assert.equal(t.medianCycleHours, 12, 'median of 4 h and 20 h');
  assert.equal(t.closedSeries.reduce((n, p) => n + p.value, 0), 2);
  const tDiv = await A.queryMetric(pool, V, { ...w, metric: 'tasks.throughput', days: 30, division: div });
  assert.equal(tDiv.scope, 'division'); assert.equal(tDiv.division.name, 'Engineering');
  assert.equal(tDiv.value.created, 3); assert.deepEqual(tDiv.value.open, { in_progress: 1 }, 'the division sees only Alpha');
  await refuses(A.queryMetric(pool, V, { ...w, metric: 'credits.spend', division: div }), 'not_division_scoped');
  const otherDiv = (await pool.query(`INSERT INTO workforce_divisions (workspace_id, key, name) VALUES ($1,'ops','Ops') RETURNING id`, [other])).rows[0].id;
  await refuses(A.queryMetric(pool, V, { ...w, metric: 'tasks.throughput', division: otherDiv }), 'division_not_found');

  const personal = String((await ensurePersonalWorkspace(pool, owner)).id);
  const tp = (await A.queryMetric(pool, O, { workspace: personal, metric: 'tasks.throughput' })).value;
  assert.deepEqual(tp.open, { todo: 1 }, 'the personal task counts in the Personal workspace');

  // ── credits: the workspace wallet
  assert.equal((await A.queryMetric(pool, V, { ...w, metric: 'credits.spend' })).value.wallet, false);
  const acct = (await pool.query(`INSERT INTO credit_accounts (user_id, balance, owner_kind) VALUES ($1, 900, 'workspace') RETURNING id`, [ws])).rows[0].id;
  const tx = (amount, at) => pool.query(`INSERT INTO credit_transactions (user_id, account_id, type, amount, balance_after, created_at) VALUES ($1,$2,'usage',$3,0,$4)`, [ws, acct, amount, at]);
  await tx(-70, hoursAgo(2)); await tx(-30, hoursAgo(26)); await tx(1000, hoursAgo(48)); await tx(-500, hoursAgo(24 * 40));
  const oacct = (await pool.query(`INSERT INTO credit_accounts (user_id, balance, owner_kind) VALUES ($1, 5, 'workspace') RETURNING id`, [other])).rows[0].id;
  await pool.query(`INSERT INTO credit_transactions (user_id, account_id, type, amount, balance_after) VALUES ($1,$2,'usage',-999,0)`, [other, oacct]);
  const c = (await A.queryMetric(pool, V, { ...w, metric: 'credits.spend', days: 30 })).value;
  assert.equal(c.balance, 900); assert.equal(c.spent, 100, 'spend only, in the window, this wallet only');
  assert.equal(c.series.length, 2);

  // ── support
  const ticket = (wsId, status, created, first) => pool.query(`INSERT INTO support_tickets (requester_id, workspace_id, kind, title, status, first_response_due_at, resolution_due_at, created_at, first_responded_at) VALUES ($1,$2,'bug','x',$3,now(),now(),$4,$5)`, [owner, wsId, status, created, first]);
  await ticket(ws, 'new', hoursAgo(5), null); await ticket(ws, 'triaged', hoursAgo(8), hoursAgo(6)); await ticket(ws, 'resolved', hoursAgo(20), hoursAgo(16)); await ticket(other, 'new', hoursAgo(1), null);
  const s = (await A.queryMetric(pool, V, { ...w, metric: 'support.tickets' })).value;
  assert.equal(s.openTotal, 2); assert.deepEqual(s.open, { new: 1, triaged: 1 }); assert.equal(s.created, 3); assert.equal(s.medianFirstResponseHours, 3);

  // ── storage
  const file = (wsId, size, mime) => pool.query(`INSERT INTO user_files (user_id, created_by_user_id, workspace_id, filename, file_id, file_size, mime_type) VALUES ($1,$1,$2,'f',gen_random_uuid(),$3,$4)`, [owner, wsId, size, mime]);
  await file(ws, 1000, 'image/png'); await file(ws, 500, 'application/pdf'); await file(other, 99999, 'image/png');
  const st = (await A.queryMetric(pool, V, { ...w, metric: 'storage.usage' })).value;
  assert.equal(st.usedBytes, 1500); assert.equal(st.files, 2);

  // ── runs: on the workspace's tasks only
  const rTask = await task({ project_id: pA, status: 'in_progress' });
  // fixture only: an admission (workforce_run_admissions) is not what this suite tests, so its guard is set aside
  // for these two historical rows and put straight back
  await pool.query('ALTER TABLE agent_cloud_runs DISABLE TRIGGER agent_cloud_runs_admission_guard');
  try { await pool.query(`INSERT INTO agent_cloud_runs (owner_user_id, agent_user_id, task_id, agent_version, state, budget_credits) VALUES ($1,$2,$3,1,'completed',5),($1,$2,$3,1,'failed',2)`, [editor, agentU, rTask]); }
  finally { await pool.query('ALTER TABLE agent_cloud_runs ENABLE TRIGGER agent_cloud_runs_admission_guard'); }
  const r = (await A.queryMetric(pool, V, { ...w, metric: 'runs.agents' })).value;
  assert.equal(r.total, 2); assert.deepEqual(r.byState, { completed: 1, failed: 1 }); assert.equal(r.budgetCredits, 7);
  assert.equal((await A.queryMetric(pool, V, { ...w, metric: 'runs.agents', division: div })).value.total, 2);

  // ── who
  await refuses(A.queryMetric(pool, S, { ...w, metric: 'tasks.throughput' }), 'not_a_member');
  await refuses(A.queryMetric(pool, V, { ...w, metric: 'drop table' }), 'unknown_metric');
  assert.equal((await A.queryMetric(pool, AG, { ...w, metric: 'tasks.throughput' })).value.created, 5, 'the agent reads as its owner (one more task since)');

  // ── dashboards
  await refuses(A.createDashboard(pool, V, { ...w, name: 'Mine', widgets: [] }), 'editor_required');
  await refuses(A.createDashboard(pool, AG, { ...w, name: 'Mine', widgets: [] }), 'person_required');
  await refuses(A.createDashboard(pool, E, { ...w, name: 'Bad', widgets: [{ metric: 'users.all' }] }), 'unknown_metric');
  await refuses(A.createDashboard(pool, E, { ...w, name: '  ', widgets: [] }), 'invalid_name');
  const d = (await A.createDashboard(pool, E, { ...w, name: 'Ops', widgets: [{ metric: 'tasks.throughput', days: 9999 }, { metric: 'support.tickets' }] })).dashboard;
  assert.deepEqual(d.widgets, [{ metric: 'tasks.throughput', days: 365 }, { metric: 'support.tickets', days: 30 }], 'windows are clamped');
  assert.equal((await A.listDashboards(pool, V, w)).dashboards.length, 1);
  assert.equal((await A.listDashboards(pool, S, { workspace: other })).dashboards.length, 0, 'another workspace sees none');
  await refuses(A.getDashboard(pool, S, { workspace: other, id: d.id }), 'not_found');
  assert.equal((await A.updateDashboard(pool, E, { ...w, id: d.id, name: 'Ops 2' })).dashboard.name, 'Ops 2');
  await refuses(A.deleteDashboard(pool, V, { ...w, id: d.id }), 'editor_required');
  assert.equal((await A.deleteDashboard(pool, E, { ...w, id: d.id })).undo, 'restore');
  assert.equal((await A.listDashboards(pool, V, w)).dashboards.length, 0);
  await refuses(A.getDashboard(pool, V, { ...w, id: d.id }), 'not_found');
  assert.equal((await A.restoreDashboard(pool, E, { ...w, id: d.id })).dashboard.name, 'Ops 2', 'restore undoes the delete');
  assert.equal((await A.listDashboards(pool, V, w)).dashboards.length, 1);

  // ── MCP
  assert.deepEqual(Mcp.TOOLS.map((x) => x.name).sort(), ['list_dashboards', 'list_metrics', 'query_metric']);
  assert.ok(Mcp.TOOLS.every((x) => x.annotations.readOnlyHint === true));
  const m = await Mcp.callTool(pool, AG, 'list_metrics', w);
  assert.equal(m.structuredContent.metrics.length, 5); assert.deepEqual(m.structuredContent.divisions.map((x) => x.name), ['Engineering']);
  assert.equal((await Mcp.callTool(pool, AG, 'query_metric', { ...w, metric: 'support.tickets' })).structuredContent.value.openTotal, 2);
  await refuses(Mcp.callTool(pool, AG, 'create_dashboard', w), 'unknown_tool');

  console.log('workspace-analytics: all checks passed');
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
