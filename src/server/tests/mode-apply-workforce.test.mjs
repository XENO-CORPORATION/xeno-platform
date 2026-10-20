/**
 * modeApply's workforce half (services/modeApplyWorkforce.js) on real Postgres: a pack that creates divisions (nested),
 * platform agents (company-owned, the applier accountable), projects in divisions, teams of those agents, objectives,
 * goals linked to them, tasks in a pack project and a Places layout hint — each through its existing service, in ONE
 * transaction, listed on the receipt — and a revert that undoes what nobody touched and KEEPS what a person changed.
 * Also: a pack with a bad reference is refused at plan; a failure half-way leaves nothing behind; an agent cannot
 * apply; a legacy pack (no workforce fields) plans exactly as before; the architect's suggestions become pack fields.
 * Mutation-checked by scripts/mode-apply-workforce-mutation.mjs.
 * Run: DATABASE_URL=postgresql://…/<disposable> node tests/mode-apply-workforce.test.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as modes from '../services/modeApply.js';
import * as divisions from '../services/workforceDivisions.js';
import * as agents from '../services/platformAgents.js';
import * as architect from '../services/workspaceArchitect.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `mw${process.pid}`;
let seq = 0, passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log('PASS', m); };
const n = async (sql, a = []) => Number((await pool.query(sql, a)).rows[0].n);
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const company = async (owner) => {
  const w = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'company',$2,$3) RETURNING id`, [owner, `${tag} co ${seq += 1}`, `${tag}-${seq}`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${w}`, subject: `user:${owner}`, relation: 'owner' }] });
  return w;
};
// a pack stored as an architect proposal, so modeApply resolves it as `proposal:<id>` (the same path the architect uses)
const stored = async (ws, owner, pack) => {
  const id = (await pool.query(`INSERT INTO architect_proposals (workspace_id, created_by_user_id, proposal, pack) VALUES ($1,$2,'{}',$3) RETURNING id`, [ws, owner, JSON.stringify({})])).rows[0].id;
  await pool.query(`UPDATE architect_proposals SET pack = $2 WHERE id = $1`, [id, JSON.stringify({ format: 'xeno-mode-pack', schemaVersion: 1, status: 'draft', id: `proposal:${id}`, version: '1', questions: [], ...pack })]);
  return `proposal:${id}`;
};
const PACK = (name) => ({ title: name, mode: { id: `c-${name.toLowerCase()}`, name, products: ['crm', 'scheduling'] },
  divisions: [{ key: 'ops', name: 'Operations' }, { key: 'kitchen', name: 'Kitchen', parent: 'ops' }],
  agents: [{ key: 'orders', name: 'Order taker', description: 'Answers order messages', division: 'kitchen' }, { key: 'books', name: 'Bookkeeper', description: 'Keeps the books' }],
  projects: [{ key: 'menu', name: 'Seasonal menu', division: 'kitchen' }],
  teams: [{ key: 'front', name: 'Front of house', description: 'Orders and tables', agents: ['orders'] }],
  objectives: [{ key: 'grow', title: 'Grow weekday orders', successEvidence: '30% more weekday orders', division: 'kitchen' }],
  goals: [{ title: 'Ship the autumn menu', successEvidence: 'Menu is live', project: 'menu', objective: 'grow' }],
  tasks: [{ title: 'Price the new dishes', project: 'menu' }, { title: 'Invite the team' }],
  places: { bays: 6 } });

async function main() {
  await runAllMigrations(pool); await migrateAccountV2(pool);
  const owner = await user('owner'), agentUser = await user('agent');
  await pool.query(`INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)`, [agentUser, owner]);
  const ws = await company(owner);
  await pool.query('SELECT places_provision($1)', [ws]);
  const me = { id: owner };

  // ── legacy packs are unchanged
  const salon = await modes.plan(pool, me, { workspaceId: ws, packId: 'salon', answers: { businessName: 'Ana' } });
  ok(salon.plan.records.map((r) => r.type).join(',') === 'mode,project,task,task,task', 'a pack without workforce fields plans exactly as before');

  // ── refused at plan
  const bad = await stored(ws, owner, { ...PACK('Bad'), teams: [{ key: 't', name: 'X', agents: ['nobody'] }] });
  await assert.rejects(modes.plan(pool, me, { workspaceId: ws, packId: bad }), (e) => e.code === 'unknown_reference');
  ok(true, 'a team naming an agent not in the setup is refused at plan');
  const loop = await stored(ws, owner, { ...PACK('Loop'), divisions: [{ key: 'a', name: 'A', parent: 'b' }, { key: 'b', name: 'B', parent: 'a' }] });
  await assert.rejects(modes.plan(pool, me, { workspaceId: ws, packId: loop }), (e) => e.code === 'unknown_reference');
  ok(true, 'divisions inside each other in a circle are refused');

  // ── plan
  const pid = await stored(ws, owner, PACK('Bakery'));
  const { plan, planHash } = await modes.plan(pool, me, { workspaceId: ws, packId: pid });
  const types = plan.records.map((r) => r.type);
  ok(['division', 'agent', 'project', 'team', 'objective', 'goal', 'places', 'task'].every((t) => types.includes(t)), 'plan lists divisions, agents, projects, teams, objectives, goals, Places and tasks');
  ok(await n(`SELECT count(*) n FROM workforce_divisions WHERE workspace_id = $1`, [ws]) === 0, 'planning writes nothing');

  // ── an agent cannot apply; no confirm is refused
  await assert.rejects(modes.apply(pool, { id: agentUser }, { workspaceId: ws, packId: pid, planHash, idempotencyKey: 'wf-agent-1', confirm: true }), (e) => e.code === 'human_admin_must_confirm');
  await assert.rejects(modes.apply(pool, me, { workspaceId: ws, packId: pid, planHash, idempotencyKey: 'wf-noconf-1' }), (e) => e.code === 'confirmation_required');
  ok(true, 'an agent cannot apply, and applying needs confirm');

  // ── a failure half-way leaves nothing
  const half = await stored(ws, owner, { ...PACK('Half'), objectives: [{ key: 'g', title: 'x'.repeat(5), successEvidence: 'y', division: 'kitchen' }], goals: [], teams: [{ key: 'front', name: 'Front', agents: ['orders', 'orders'] }] });
  const hp = await modes.plan(pool, me, { workspaceId: ws, packId: half });
  await pool.query(`INSERT INTO workforce_resources (kind, owner_workspace_id, created_by_user_id, name, description) VALUES ('team',$1,$2,'Front','clash')`, [ws, owner]);
  const before = { d: await n(`SELECT count(*) n FROM workforce_divisions WHERE workspace_id = $1`, [ws]), a: await n(`SELECT count(*) n FROM agent_identities WHERE owner_user_id = $1`, [owner]) };
  await assert.rejects(modes.apply(pool, me, { workspaceId: ws, packId: half, planHash: hp.planHash, idempotencyKey: 'wf-half-1', confirm: true }));
  ok(await n(`SELECT count(*) n FROM workforce_divisions WHERE workspace_id = $1`, [ws]) === before.d && await n(`SELECT count(*) n FROM agent_identities WHERE owner_user_id = $1`, [owner]) === before.a
    && await n(`SELECT count(*) n FROM workspace_mode_applications WHERE workspace_id = $1`, [ws]) === 0, 'a setup that fails half-way leaves no division, agent or receipt behind');
  await pool.query(`DELETE FROM workforce_resources WHERE kind = 'team' AND owner_workspace_id = $1 AND description = 'clash'`, [ws]);

  // ── apply
  const layoutBefore = (await pool.query(`SELECT l.bays, l.revision FROM places p JOIN place_layouts l ON l.place_id = p.id WHERE p.workspace_id = $1`, [ws])).rows[0];
  const { receipt } = await modes.apply(pool, me, { workspaceId: ws, packId: pid, planHash, idempotencyKey: 'wf-apply-1', confirm: true });
  const of = (t) => receipt.records.filter((r) => r.type === t);
  const dRows = (await pool.query(`SELECT id, name, parent_division_id FROM workforce_divisions WHERE workspace_id = $1 ORDER BY name`, [ws])).rows;
  const kitchen = dRows.find((d) => d.name === 'Kitchen'), opsD = dRows.find((d) => d.name === 'Operations');
  ok(of('division').length === 2 && String(kitchen.parent_division_id) === String(opsD.id), 'divisions are created, Kitchen inside Operations');
  const ag = (await pool.query(`SELECT ai.user_id, ai.owner_user_id, r.owner_workspace_id, r.created_by_user_id FROM agent_identities ai JOIN workforce_resources r ON r.id = ai.workforce_resource_id WHERE ai.user_id = ANY($1::uuid[])`, [of('agent').map((a) => a.userId)])).rows;
  ok(ag.length === 2 && ag.every((a) => String(a.owner_workspace_id) === String(ws) && String(a.owner_user_id) === String(owner)), 'agents are platform agents owned by the company, the applier the accountable human');
  const orders = of('agent').find((a) => a.key === 'orders');
  ok((await agents.get(pool, { id: owner, kind: 'human' }, orders.id)).division?.id === String(kitchen.id), 'the order taker works in Kitchen');
  const menu = of('project').find((p) => p.key === 'menu');
  ok((await divisions.projectDivision(pool, menu.id))?.id === String(kitchen.id), 'the project belongs to Kitchen');
  ok(await n(`SELECT count(*) n FROM workforce_team_memberships m WHERE m.team_id = $1 AND m.member_principal_id = $2 AND m.state = 'active'`, [of('team')[0].id, orders.userId]) === 1, 'the team has the order taker as a member');
  const obj = of('objective')[0];
  ok(await n(`SELECT count(*) n FROM project_objectives WHERE id = $1 AND division_id = $2`, [obj.id, kitchen.id]) === 1, 'the objective is set for Kitchen');
  ok(await n(`SELECT count(*) n FROM project_goals WHERE id = $1 AND objective_id = $2 AND project_id = $3`, [of('goal')[0].id, obj.id, menu.id]) === 1, 'the goal sits in the project, linked to the objective');
  ok(await n(`SELECT count(*) n FROM tasks WHERE project_id = $1 AND title = 'Price the new dishes' AND deleted_at IS NULL`, [menu.id]) === 1, 'a task with a pack project lands in it');
  ok(of('project').length === 2, 'loose tasks still get the getting-started project');
  const layoutAfter = (await pool.query(`SELECT l.bays FROM places p JOIN place_layouts l ON l.place_id = p.id WHERE p.workspace_id = $1`, [ws])).rows[0];
  ok(layoutAfter.bays === 6 && layoutBefore.bays !== 6, 'the Places hint is saved through Places');
  const replay = await modes.apply(pool, me, { workspaceId: ws, packId: pid, planHash, idempotencyKey: 'wf-apply-1', confirm: true });
  ok(replay.replayed && await n(`SELECT count(*) n FROM workforce_divisions WHERE workspace_id = $1`, [ws]) === 2, 'the same key again returns the receipt and creates nothing');

  // ── a person changes some of it
  await divisions.update(pool, { id: owner, kind: 'human' }, opsD.id, { name: 'Operations & Finance' });
  await agents.update(pool, { id: owner, kind: 'human' }, of('agent').find((a) => a.key === 'books').id, { description: 'Keeps the books and pays suppliers' });
  await pool.query(`UPDATE project_objectives SET title = 'Grow weekday and weekend orders' WHERE id = $1`, [obj.id]);

  // ── revert
  const rv = (await modes.revert(pool, me, { workspaceId: ws, applicationId: receipt.applicationId })).receipt.revertReport;
  const keptIds = new Set(rv.kept.map((k) => String(k.id))), gone = new Set(rv.archived.map((k) => String(k.id)));
  ok(keptIds.has(String(opsD.id)) && (await pool.query(`SELECT lifecycle FROM workforce_divisions WHERE id = $1`, [opsD.id])).rows[0].lifecycle === 'active', 'the division a person renamed is kept');
  ok(gone.has(String(kitchen.id)) && (await pool.query(`SELECT lifecycle FROM workforce_divisions WHERE id = $1`, [kitchen.id])).rows[0].lifecycle === 'archived', 'the untouched division is archived');
  ok(keptIds.has(of('agent').find((a) => a.key === 'books').id), 'the agent a person edited is kept');
  ok((await pool.query(`SELECT status FROM agent_identities WHERE user_id = $1`, [orders.userId])).rows[0].status === 'retired', 'the untouched agent is retired');
  ok((await pool.query(`SELECT status FROM workforce_resources WHERE id = $1`, [of('team')[0].id])).rows[0].status === 'archived', 'the team is archived');
  ok(rv.kept.find((k) => String(k.id) === String(obj.id))?.reason === 'changed by a person' && await n(`SELECT count(*) n FROM project_objectives WHERE id = $1`, [obj.id]) === 1, 'the objective a person changed is kept');
  ok((await pool.query(`SELECT is_archived FROM chat_projects WHERE id = $1`, [menu.id])).rows[0].is_archived, 'the project with no work left is archived');
  ok((await pool.query(`SELECT l.bays FROM places p JOIN place_layouts l ON l.place_id = p.id WHERE p.workspace_id = $1`, [ws])).rows[0].bays === layoutBefore.bays, 'the Places layout is restored');

  // ── the architect's suggestions become pack fields
  const prop = await architect.propose(pool, me, { workspaceId: ws, idea: 'A bakery with a kitchen and a shop.' }, {
    meter: async (_d, _u, o) => ({ result: await o.run({ maxOutputTokens: 1000 }), creditsCharged: 0 }),
    complete: async () => ({ choices: [{ message: { content: JSON.stringify({ title: 'Shop', mode: { name: 'Shop', products: ['crm'], cites: ['S1'] },
      divisions: [{ name: 'Shop floor', cites: ['S1'] }, { name: 'Operations & Finance', cites: ['S1'] }], teams: [{ name: 'Counter', division: 'Shop floor', cites: ['S1'] }],
      agents: [{ name: 'Greeter', role: 'Says hello', team: 'Counter', cites: ['S1'] }], projects: [{ name: 'Opening week', goal: 'Open', cites: ['S1'] }], objectives: [{ title: 'Open the shop', measure: 'Doors open', cites: ['S1'] }] }) } }] }) });
  const pk = prop.proposal.pack;
  ok(pk.divisions.length === 1 && pk.divisions[0].name === 'Shop floor', 'a suggested division already in the workspace is left out; the new one is in the pack');
  ok(pk.agents[0].division === pk.divisions[0].key && pk.teams[0].agents[0] === pk.agents[0].key, 'the agent sits in its team’s division and is the team’s member');
  const p2 = await modes.plan(pool, me, { workspaceId: ws, packId: prop.proposal.packId });
  const r2 = await modes.apply(pool, me, { workspaceId: ws, packId: prop.proposal.packId, planHash: p2.planHash, idempotencyKey: 'wf-arch-1', confirm: true });
  ok(r2.receipt.records.some((r) => r.type === 'division') && r2.receipt.records.some((r) => r.type === 'team') && r2.receipt.records.some((r) => r.type === 'objective'), 'the architect’s proposal applies its divisions, teams, agents, projects and objectives');
  console.log(`mode-apply-workforce: ${passed} passed`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
