/**
 * People in a company workspace (services/workforcePeople.js; migration 20261022090000; xeno-company SPEC §7.3 D-EMP)
 * and the company blueprint through services/modeApply.js, on real Postgres, through the REAL routes:
 *   1. the migration's DOWN and UP run; the lifecycle receipts are append-only;
 *   2. PRIVATE fields: the person, a human admin and a manager above them read them; a peer and an agent never do;
 *   3. HR fields are a human admin's; the person edits their own details; an agent edits nothing (also over MCP);
 *   4. the org chart is the roster + the manager edge (humans and agents), and a reporting loop is refused;
 *   5. time off makes someone unavailable — to People and to Places — without leaking its note;
 *   6. onboarding makes a project of XENO Tasks assigned to the new member, once; "my work" shows them;
 *   7. offboarding moves reports and headships to the manager, then removes access through member removal;
 *   8. the xeno-corporation blueprint: plan writes nothing and states counts; an agent cannot apply it; a human admin's
 *      apply creates exactly the planned divisions, teams and agents in one receipt; revert keeps the structure.
 *
 * Mutation-checked with scripts/workforce-people-mutation.mjs.
 * Run: DATABASE_URL=postgresql://…/<disposable> node src/server/tests/workforce-people.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples, check } from '../utils/authzReBAC.js';
import { createAgent } from '../services/agentIdentity.js';
import * as people from '../services/workforcePeople.js';
import * as peopleMcp from '../services/peopleMcp.js';
import * as modes from '../services/modeApply.js';
import * as divisions from '../services/workforceDivisions.js';
import { buildSnapshot } from '../services/places.js';
import peopleRoutes from '../routes/workforcePeopleRoutes.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const here = path.dirname(fileURLToPath(import.meta.url));
const [UPRAW, DOWN] = fs.readFileSync(path.join(here, '../database/migrations/20261022090000-workforce-people.sql'), 'utf8').split(/^-- DOWN\s*$/m);
const UP = UPRAW.replace(/^-- UP\s*$/m, '');
const tag = `pp${process.pid}`;
let seq = 0;
const n = async (sql, a = []) => Number((await pool.query(sql, a)).rows[0].n);
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const workspace = async (owner, type = 'team') => {
  const w = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [owner, type, `${tag} ws ${seq += 1}`, `${tag}-${seq}`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${w}`, subject: `user:${owner}`, relation: 'owner' }] });
  return w;
};
const join = (w, u, relation = 'editor') => writeTuples(pool, { writes: [{ object: `workspace:${w}`, subject: `user:${u}`, relation }] });
const refused = async (p, code, why) => { await assert.rejects(p, (e) => { assert.equal(e.code, code, `${why}: got ${e.code} ${e.message}`); return true; }, why); };

async function serve() {
  const app = express(); app.use(express.json());
  app.use('/api/people', (req, _res, next) => { req.db = pool; req.owner = req.get('x-test-user'); next(); }, peopleRoutes);
  const s = http.createServer(app); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const call = async (who, method, url, body) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-test-user': who }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  return { s, call };
}

async function main() {
  await runAllMigrations(pool);
  // 1. DOWN then UP restore the schema; receipts are append-only
  await pool.query(DOWN); assert.equal(await n(`SELECT count(*) n FROM pg_tables WHERE tablename = 'workforce_employee_profiles'`), 0, 'DOWN drops the profiles');
  await pool.query(UP); assert.equal(await n(`SELECT count(*) n FROM pg_tables WHERE tablename LIKE 'workforce_%' AND tablename IN ('workforce_employee_profiles','workforce_time_off','workforce_lifecycle_events')`), 3, 'UP restores');

  const owner = await user('owner'), mgr = await user('manager'), emp = await user('employee'), peer = await user('peer');
  const W = await workspace(owner);
  for (const u of [mgr, emp, peer]) await join(W, u);
  const ownerRow = (await pool.query('SELECT id, username FROM users WHERE id=$1', [owner])).rows[0];
  const ag = await createAgent(pool, { id: owner, kind: 'human', handle: ownerRow.username }, { name: `${tag}-bot`, displayName: 'Bot', agentRole: 'other', agentOrigin: 'platform' });
  const agent = (await pool.query('SELECT id FROM users WHERE username = $1', [ag.agent.handle])).rows[0].id;
  await join(W, agent);
  const me = (id) => ({ id });
  const { s, call } = await serve();
  try {
    // 3. HR fields: admin only; own details: the person; an agent: nothing
    await people.updateProfile(pool, me(owner), { workspaceId: W, principalId: mgr, title: 'Head of Platform', managerId: owner, startDate: '2026-01-05' });
    await people.updateProfile(pool, me(owner), { workspaceId: W, principalId: emp, title: 'Engineer', managerId: mgr, privateNotes: 'salary band 3' });
    await refused(people.updateProfile(pool, me(emp), { workspaceId: W, principalId: emp, title: 'CEO' }), 'admin_required', 'a person cannot give themself a title');
    await refused(people.updateProfile(pool, me(peer), { workspaceId: W, principalId: emp, location: 'Mars' }), 'not_allowed', 'a peer cannot edit someone else');
    await refused(people.updateProfile(pool, me(agent), { workspaceId: W, principalId: agent, timezone: 'UTC' }), 'human_only', 'an agent edits no HR data');
    await assert.rejects(peopleMcp.callTool(pool, { id: agent }, 'update_profile', { workspace: W, person: emp, fields: { title: 'x' } }), (e) => e.code === 'human_only', 'nor over MCP');
    const r = await call(emp, 'PATCH', `/api/people/${emp}`, { workspaceId: W, timezone: 'Europe/Berlin', privatePhone: '+49 1', workingHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' } });
    assert.equal(r.status, 200, `own details via the route: ${JSON.stringify(r.body)}`);
    assert.equal((await call(emp, 'PATCH', `/api/people/${emp}`, { workspaceId: W, title: 'CEO' })).status, 403, 'the route refuses a self-promotion');

    // 2. private fields
    const seen = async (who) => (await people.getPerson(pool, me(who), { workspaceId: W, principalId: emp })).person.private;
    assert.equal((await seen(emp))?.phone, '+49 1', 'the person reads their own private fields');
    assert.equal((await seen(owner))?.notes, 'salary band 3', 'an admin reads them');
    assert.equal((await seen(mgr))?.phone, '+49 1', 'their manager reads them');
    assert.equal(await seen(peer), null, 'a peer does not');
    assert.equal(await seen(agent), null, 'an agent does not');
    assert.equal((await people.getPerson(pool, me(emp), { workspaceId: W, principalId: mgr })).person.private, null, 'a report does not read their manager');
    const dirPeer = (await call(peer, 'GET', `/api/people?workspace=${W}`)).body.people;
    assert.ok(dirPeer.find((p) => p.id === emp) && dirPeer.every((p) => p.id === peer || p.private === null), 'the directory hides everyone else’s private fields from a peer');
    assert.equal((await call(await user('stranger'), 'GET', `/api/people?workspace=${W}`)).status, 404, 'a non-member is told it does not exist');

    // 4. org chart + loops
    const chart = await people.orgChart(pool, me(peer), { workspaceId: W });
    assert.ok(chart.roots.includes(owner) && chart.reportsOf[mgr].includes(emp) && chart.nodes.some((x) => x.id === agent && x.kind === 'agent'), 'chart: owner at the root, employee under manager, the agent present');
    await refused(people.updateProfile(pool, me(owner), { workspaceId: W, principalId: owner, managerId: emp }), 'manager_cycle', 'a reporting loop is refused');
    assert.ok((await people.directory(pool, me(peer), { workspaceId: W, q: 'engineer' })).people.some((p) => p.id === emp), 'search finds by title');

    // 5. time off → unavailable, note private, Places shows away
    const now = Date.now();
    await refused(people.addTimeOff(pool, me(peer), { workspaceId: W, principalId: emp, startsAt: new Date(now - 1e3), endsAt: new Date(now + 864e5) }), 'not_allowed', 'a peer cannot book someone’s time off');
    await people.addTimeOff(pool, me(emp), { workspaceId: W, startsAt: new Date(now - 1e3), endsAt: new Date(now + 864e5), kind: 'sick', note: 'flu' });
    assert.equal((await people.availability(pool, W, emp)).reason, 'time_off', 'unavailable while away');
    const peerView = (await people.getPerson(pool, me(peer), { workspaceId: W, principalId: emp })).person;
    assert.equal(peerView.availability.available, false); assert.equal(JSON.stringify(peerView).includes('flu'), false, 'the note never reaches a peer');
    const place = (await pool.query(`SELECT p.*, w.workspace_type, w.owner_user_id FROM places p JOIN workspaces w ON w.id = p.workspace_id WHERE p.workspace_id = $1 AND p.lifecycle='active'`, [W])).rows[0];
    assert.equal((await people.availabilityMap(pool, W, [emp, peer]))[emp].reason, 'time_off', 'the map Places reads says away');
    if (place) {
      const snap = await buildSnapshot(pool, { id: owner, kind: 'human', name: 'Owner' }, place, { scope: 'all', permissions: ['watch', 'edit'] });
      const desk = snap.principals.find((p) => p.id === emp);
      if (desk) assert.equal(desk.away, 'time_off', 'Places shows the desk as away');
      assert.equal(snap.principals.find((p) => p.id === owner)?.away, undefined, 'a present person is not away');
    }
    assert.equal(people.availabilityAt({ working_hours: { days: [1], start: '09:00', end: '10:00' }, timezone: 'UTC' }, [], new Date('2026-10-20T12:00:00Z')).reason, 'outside_hours', 'outside stated hours');

    // 6. onboarding (once) + my work
    await refused(people.onboard(pool, me(mgr), { workspaceId: W, principalId: peer }), 'admin_required', 'a non-admin cannot onboard');
    const ob = await people.onboard(pool, me(owner), { workspaceId: W, principalId: peer });
    assert.equal(ob.onboarding.tasks.length, people.ONBOARDING_TASKS.length, 'the checklist became tasks');
    assert.equal(await n(`SELECT count(*) n FROM tasks WHERE project_id = $1 AND assignee_id = $2`, [ob.onboarding.projectId, peer]), people.ONBOARDING_TASKS.length, 'assigned to the new member, in a project of the workspace');
    assert.equal((await people.onboard(pool, me(owner), { workspaceId: W, principalId: peer })).replayed, true, 'a second onboarding returns the first');
    assert.equal((await people.myWork(pool, me(peer), { workspaceId: W })).tasks.length, people.ONBOARDING_TASKS.length, 'my work shows them');
    await assert.rejects(pool.query(`UPDATE workforce_lifecycle_events SET report = '{}'`), /append-only/, 'receipts are append-only');

    // 7. offboarding
    const div = await divisions.create(pool, { id: owner, kind: 'human' }, { workspaceId: W, name: `${tag} Platform` });
    await divisions.update(pool, { id: owner, kind: 'human' }, div.id, { headId: mgr });
    const plan = await people.offboardPlan(pool, me(owner), { workspaceId: W, principalId: mgr });
    assert.equal(plan.successorId, owner); assert.deepEqual(plan.reportsToSuccessor, [emp]);
    await refused(people.offboard(pool, me(owner), { workspaceId: W, principalId: mgr }), 'confirmation_required', 'offboarding needs confirm');
    await refused(people.offboard(pool, me(peer), { workspaceId: W, principalId: mgr, confirm: true }), 'admin_required', 'a peer cannot offboard');
    await people.offboard(pool, me(owner), { workspaceId: W, principalId: mgr, confirm: true });
    assert.equal((await check(pool, { object: `workspace:${W}`, relation: 'viewer', subject: `user:${mgr}` })).allowed, false, 'access removed');
    assert.equal((await pool.query(`SELECT manager_principal_id FROM workforce_employee_profiles WHERE workspace_id=$1 AND principal_id=$2`, [W, emp])).rows[0].manager_principal_id, owner, 'the report moved to the successor');
    assert.equal((await pool.query('SELECT head_principal_id FROM workforce_divisions WHERE id=$1', [div.id])).rows[0].head_principal_id, owner, 'the headship moved');
    await refused(people.directory(pool, me(mgr), { workspaceId: W }), 'workspace_not_found', 'a removed member sees nothing');

    // 8. the company blueprint
    const C = await workspace(owner, 'company');
    const before = await n(`SELECT count(*) n FROM workforce_divisions WHERE workspace_id = $1`, [C]);
    const { plan: bp, planHash } = await modes.plan(pool, me(owner), { workspaceId: C, packId: 'xeno-corporation' });
    assert.equal(await n(`SELECT count(*) n FROM workforce_divisions WHERE workspace_id = $1`, [C]), before, 'plan writes nothing');
    assert.ok(bp.counts.divisions >= 9 && bp.counts.teams >= 50 && bp.counts.agents === bp.counts.teams, `counts: ${JSON.stringify(bp.counts)}`);
    if (process.env.PLAN_OUT) fs.writeFileSync(process.env.PLAN_OUT, JSON.stringify({ counts: bp.counts, planHash, records: bp.records }, null, 2));
    await refused(modes.apply(pool, me(agent), { workspaceId: C, packId: 'xeno-corporation', planHash, idempotencyKey: `${tag}-k1`, confirm: true }), 'human_admin_must_confirm', 'an agent cannot apply');
    const P = await workspace(owner, 'personal');
    assert.ok((await modes.plan(pool, me(owner), { workspaceId: P, packId: 'xeno-corporation' })).plan.conflicts.length, 'a personal workspace is refused as a company');
    // the per-account agent limit is stated in the plan and refuses the whole apply — never half a company
    assert.ok(bp.conflicts.some((c) => c.startsWith('agents:')), 'the plan says the agent limit is in the way');
    await refused(modes.apply(pool, me(owner), { workspaceId: C, packId: 'xeno-corporation', planHash, idempotencyKey: `${tag}-k0`, confirm: true }), 'agent_cap_reached', 'apply refuses over the agent limit');
    assert.equal(await n(`SELECT count(*) n FROM workforce_divisions WHERE workspace_id = $1`, [C]), before, 'and wrote nothing');
    const noAgents = await modes.plan(pool, me(owner), { workspaceId: C, packId: 'xeno-corporation', answers: { agents: 'no' } });
    bp.counts = noAgents.plan.counts;
    assert.equal(bp.counts.agents, 0); assert.deepEqual(noAgents.plan.conflicts, []);
    const applied = await modes.apply(pool, me(owner), { workspaceId: C, packId: 'xeno-corporation', answers: { agents: 'no' }, planHash: noAgents.planHash, idempotencyKey: `${tag}-k2`, confirm: true });
    const recs = applied.receipt.records;
    assert.equal(recs.filter((x) => x.type === 'division').length, bp.counts.divisions);
    assert.equal(await n(`SELECT count(*) n FROM workforce_divisions WHERE workspace_id = $1 AND head_principal_id = $2`, [C, owner]), bp.counts.divisions, 'the owner heads every division');
    assert.equal(await n(`SELECT count(*) n FROM workforce_resources WHERE owner_workspace_id = $1 AND kind = 'team'`, [C]), bp.counts.teams, 'one team per product');
    assert.equal(await n(`SELECT count(*) n FROM workforce_division_ownership o JOIN workforce_divisions d ON d.id = o.division_id WHERE d.workspace_id = $1 AND o.resource_kind = 'agent'`, [C]), bp.counts.agents, 'one agent per product, in its division');
    assert.equal((await modes.apply(pool, me(owner), { workspaceId: C, packId: 'xeno-corporation', answers: { agents: 'no' }, planHash: noAgents.planHash, idempotencyKey: `${tag}-k2`, confirm: true })).replayed, true, 'a retry is the same receipt');
    const rv = await modes.revert(pool, me(owner), { workspaceId: C, applicationId: applied.receipt.applicationId });
    assert.equal(await n(`SELECT count(*) n FROM workforce_divisions WHERE workspace_id = $1 AND lifecycle = 'active'`, [C]), bp.counts.divisions, 'revert keeps the company structure');
    assert.ok(rv.receipt.revertReport.kept.some((k) => k.type === 'division'), 'and lists it as kept');
    console.log(`workforce-people: all checks passed (blueprint: ${JSON.stringify(bp.counts)})`);
  } finally { s.close(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
