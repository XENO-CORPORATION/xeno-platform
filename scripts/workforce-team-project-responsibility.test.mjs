/**
 * XENO-WORKFORCE-01 D21 + ASN-02 -- ONE canonical team, and its project responsibility is an explicit
 * record.
 *
 *   D21 (2026-09-25): "`workforce_resources` kind='team' is the ONE canonical team. `workspace_teams` is
 *        absorbed into it, and its team->project record is rebuilt on the canonical model as ASN-02's
 *        project responsibility."
 *   ASN-02: "Workspace participation and project responsibility are explicit records, not inferred
 *        from path prefixes. A team may target several projects; several teams may target one project."
 *
 * Runs on the MIGRATED schema test:platform-foundation hands every TEST_DATABASE_URL suite, the REAL
 * teams service and the REAL HTTP router. Proved:
 *   1. ONE TEAM MODEL. On the migrated schema the legacy tables do not exist, and every team the page
 *      shows IS a workforce resource.
 *   2. ABSORPTION. The migration's own absorption block, run on legacy rows recreated from the legacy
 *      migration's DDL inside a rolled-back transaction, turns a `workspace_teams` row into a canonical
 *      team owned by its workspace: an accepted self-assignment with BOTH ASN-04 checks recorded, its
 *      agents as `worker` members in the approved member set, one project responsibility per project --
 *      all granting nothing (policy `none`, as the old model promised) -- then drops the legacy tables
 *      and keeps the id mapping. An archived legacy team arrives archived with nothing live.
 *   3. ASN-02. One team targets several projects and several teams target one project, each an explicit
 *      record bound to an accepted assignment; a project the team is not recorded against is not its
 *      responsibility, and another workspace's project is refused.
 *   4. RETAINED HISTORY. A save revokes a removed agent's membership and ends a removed project's
 *      responsibility instead of deleting either; a changed member set is captured AND admitted;
 *      archiving keeps every row.
 *   5. THE CONTRACT HOLDS. Admin-only writes, viewer reads, workspace isolation, the optimistic version
 *      check, owned-agents-only, one team per agent, unique live names -- and an audit failure rolls the
 *      whole save back (moved here from the retired legacy suite, so that proof was not lost).
 *   6. NOTHING IS GRANTED. No relationship tuple for any member; every team assignment grants nothing.
 *
 * Run: TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/chatproof node --test scripts/workforce-team-project-responsibility.test.mjs
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - the absorption maps agents as manager          -> "as the least-privileged function"
 *   - the absorption grants a capability             -> "the absorbed records grant nothing"
 *   - the absorption drops project links             -> "each legacy project link is a project responsibility"
 *   - the absorption keeps the legacy tables         -> "the legacy tables are dropped"
 *   - a save does not revoke a removed agent         -> "a removed agent is revoked, not deleted"
 *   - a changed member set is never admitted         -> "the new member set was captured AND admitted"
 *   - a viewer may write                             -> "only an admin writes"
 *   - the optimistic version check is skipped        -> "a stale save is refused"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import express from 'express';

const MIGRATIONS = new URL('../src/server/database/migrations/', import.meta.url);
const url = process.env.TEST_DATABASE_URL;

// Carried from the retired workspace-teams suite: the input and HTTP-context rules still hold, and need no database.
const draft = (name = 'Engineering') => ({ name, description: '', project_ids: [], agent_ids: [] });
test('team input rejects malformed and oversized assignments, normalizes duplicates', async () => {
  const { validateTeamInput } = await import('../src/server/services/workspaceTeams.js');
  for (const input of [null, {}, { ...draft(), name: ' ' }, { ...draft(), description: 42 }, { ...draft(), project_ids: ['bad'] }, { ...draft(), agent_ids: new Array(201).fill(randomUUID()) }]) {
    assert.throws(() => validateTeamInput(input), (error) => error.status === 400);
  }
  const id = randomUUID();
  assert.deepEqual(validateTeamInput({ ...draft(' Team '), project_ids: [id, id.toUpperCase()] }).projectIds, [id]);
});

test('HTTP routes reject malformed and conflicting contexts before querying the database', async () => {
  const { default: teamRouter } = await import('../src/server/routes/workspaceTeamRoutes.js');
  const app = express(); app.use(express.json()); app.use('/api/workspaces/:id/teams', teamRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const id = randomUUID(), origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${origin}/api/workspaces/bad/teams`)).status, 400);
    assert.equal((await fetch(`${origin}/api/workspaces/${id}/teams`, { headers: { 'x-xeno-workspace': randomUUID() } })).status, 409);
    assert.equal((await fetch(`${origin}/api/workspaces/${id}/teams?workspace_id=`)).status, 400);
    assert.equal((await fetch(`${origin}/api/workspaces/${id}/teams`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: null }) })).status, 400);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test('one canonical team, and its project responsibility is an explicit record (D21, ASN-02)', { skip: !url, timeout: 120000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(() => pool.end());
  assert.ok((await pool.query("SELECT to_regclass('workforce_legacy_team_migration') AS t")).rows[0].t,
    'this suite runs on the migrated schema, with D21 applied');
  const { listWorkspaceTeams, saveWorkspaceTeam } = await import('../src/server/services/workspaceTeams.js');
  const effective = async (db, sql, params) => (await db.query(sql, params)).rows.map((r) => r.effective_capabilities);

  const marker = `d21-${randomUUID().slice(0, 8)}`;
  const user = async (s, db = pool) => (await db.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$1,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const agentUser = async (s, agentOwner, db = pool) => {
    const id = await user(s, db);
    await db.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role,agent_origin) VALUES($1,$2,'other','d21-fixture')", [id, agentOwner]);
    return id;
  };
  const owner = await user('owner'), viewer = await user('viewer'), stranger = await user('stranger');
  const workspace = async (s, db = pool) => {
    const id = (await db.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-${s}`])).rows[0].id;
    await db.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
      VALUES('workspace',$1,'owner','user',$2),('workspace',$1,'viewer','user',$3)`, [id, owner, viewer]);
    return id;
  };
  const proj = async (w, name, db = pool) => (await db.query('INSERT INTO chat_projects(workspace_id,name) VALUES($1,$2) RETURNING id', [w, name])).rows[0].id;
  const ws = await workspace('a'), otherWs = await workspace('b');
  const alpha = await proj(ws, 'Alpha'), beta = await proj(ws, 'Beta'), gamma = await proj(ws, 'Gamma'), foreign = await proj(otherWs, 'Foreign');

  await t.test('a legacy team is absorbed into the canonical model, whole, granting nothing', async () => {
    const legacyUp = (await readFile(new URL('20260904140000-workspace-operational-teams.sql', MIGRATIONS), 'utf8')).split('-- DOWN')[0];
    const constraint = /ALTER TABLE chat_projects ADD CONSTRAINT chat_projects_workspace_identity UNIQUE \(workspace_id, id\);/;
    assert.match(legacyUp, constraint, 'the legacy DDL is the one on disk');
    const absorb = (await readFile(new URL('20260925110000-workforce-team-project-responsibility.sql', MIGRATIONS), 'utf8')).split('-- DOWN')[0];
    const block = absorb.slice(absorb.indexOf('DO $migrate$'), absorb.indexOf('END $migrate$;') + 'END $migrate$;'.length);
    assert.ok(block.startsWith('DO $migrate$'), 'the absorption block is the one the migration runs');

    // This schema has already been through the real migration chain, so the migration has run once for
    // real: the legacy tables must already be gone before this case rebuilds them to absorb a fixture.
    for (const name of ['workspace_teams', 'workspace_team_projects', 'workspace_team_agents']) {
      assert.equal((await pool.query('SELECT to_regclass($1) AS t', [name])).rows[0].t, null, 'the legacy tables are dropped');
    }

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // The legacy model exactly as its migration built it. Its chat_projects constraint still exists.
      await c.query(legacyUp.replace(constraint, ''));
      const legacyAgent = await agentUser('legacy-agent', owner, c);
      const lws = await workspace('legacy', c);
      const la = await proj(lws, 'L-Alpha', c), lb = await proj(lws, 'L-Beta', c);
      const legacyTeam = (await c.query("INSERT INTO workspace_teams(workspace_id,name,description) VALUES($1,'Legacy Studio','old model') RETURNING id", [lws])).rows[0].id;
      await c.query('INSERT INTO workspace_team_projects(workspace_id,team_id,project_id) VALUES($1,$2,$3),($1,$2,$4)', [lws, legacyTeam, la, lb]);
      await c.query('INSERT INTO workspace_team_agents(workspace_id,team_id,agent_id) VALUES($1,$2,$3)', [lws, legacyTeam, legacyAgent]);
      const retiredLegacy = (await c.query("INSERT INTO workspace_teams(workspace_id,name,archived_at) VALUES($1,'Retired',now()) RETURNING id", [lws])).rows[0].id;

      await c.query(block);

      for (const name of ['workspace_teams', 'workspace_team_projects', 'workspace_team_agents']) {
        assert.equal((await c.query('SELECT to_regclass($1) AS t', [name])).rows[0].t, null, 'the legacy tables are dropped');
      }
      const map = (await c.query('SELECT * FROM workforce_legacy_team_migration WHERE legacy_team_id=$1', [legacyTeam])).rows[0];
      assert.ok(map, 'the old id maps to the new records after the old tables are gone');
      assert.equal(map.member_count, 1);
      const team = (await c.query('SELECT * FROM workforce_resources WHERE id=$1', [map.team_resource_id])).rows[0];
      assert.equal(team.kind, 'team');
      assert.equal(team.owner_workspace_id, lws, 'the absorbed team is owned by its workspace');
      assert.equal(team.name, 'Legacy Studio');
      const a = (await c.query('SELECT * FROM workforce_workspace_assignments WHERE id=$1', [map.assignment_id])).rows[0];
      assert.equal(a.state, 'accepted');
      assert.equal(a.source_owner_workspace_id, lws);
      assert.equal(a.source_approved_by_user_id, owner, 'both ASN-04 checks are recorded, by the workspace owner');
      assert.equal(a.target_accepted_by_user_id, owner);
      const members = (await c.query('SELECT member_principal_id, role, state FROM workforce_team_memberships WHERE team_id=$1', [team.id])).rows;
      assert.deepEqual(members.map((m) => [m.member_principal_id, m.role, m.state]), [[legacyAgent, 'worker', 'active']],
        'the agent became a member through its canonical principal, as the least-privileged function');
      assert.equal((await c.query('SELECT count(*)::int n FROM workforce_assignment_active_member_candidates WHERE assignment_id=$1', [a.id])).rows[0].n, 1,
        'and is in the approved member set');
      const projects = (await c.query("SELECT project_id FROM workforce_project_participations WHERE resource_id=$1 AND state='active'", [team.id])).rows.map((r) => r.project_id);
      assert.deepEqual(projects.sort(), [la, lb].sort(), 'each legacy project link is a project responsibility');
      assert.equal(map.project_count, 2, 'each legacy project link is a project responsibility');
      const caps = await effective(c, 'SELECT effective_capabilities FROM workforce_participation_effective_policy WHERE resource_id=$1', [team.id]);
      const grant = await effective(c, 'SELECT effective_capabilities FROM workforce_assignment_effective_policy WHERE assignment_id=$1', [a.id]);
      assert.deepEqual([...caps, ...grant], [[], [], []], 'the absorbed records grant nothing, exactly as the old model did');
      const retired = (await c.query(`SELECT r.status, m.assignment_id FROM workforce_legacy_team_migration m
        JOIN workforce_resources r ON r.id=m.team_resource_id WHERE m.legacy_team_id=$1`, [retiredLegacy])).rows[0];
      assert.equal(retired.status, 'archived', 'an archived legacy team arrives archived');
      assert.equal(retired.assignment_id, null, 'with nothing live');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  await t.test('there is only one team model left', async () => {
    for (const name of ['workspace_teams', 'workspace_team_projects', 'workspace_team_agents']) {
      assert.equal((await pool.query('SELECT to_regclass($1) AS t', [name])).rows[0].t, null, `${name} no longer exists`);
    }
    const agent = await agentUser('first-agent', owner);
    const created = await saveWorkspaceTeam(pool, { workspaceId: ws, userId: owner, input: { name: 'Studio', description: '', project_ids: [alpha, beta], agent_ids: [agent] } });
    const listed = (await listWorkspaceTeams(pool, ws, owner)).teams.find((x) => x.id === created.id);
    assert.ok(listed, 'the saved team is listed');
    assert.equal((await pool.query('SELECT kind FROM workforce_resources WHERE id=$1', [listed.id])).rows[0].kind, 'team',
      'every team the page shows IS a canonical workforce resource');
    assert.deepEqual(listed.projects.map((p) => p.id).sort(), [alpha, beta].sort());
    assert.deepEqual(listed.agents.map((a) => a.id), [agent]);
  });

  await t.test('ASN-02: one team targets several projects, several teams target one project, each an explicit record', async () => {
    const agentB = await agentUser('agent-b', owner);
    const second = await saveWorkspaceTeam(pool, { workspaceId: ws, userId: owner, input: { name: 'Review', description: '', project_ids: [alpha, gamma], agent_ids: [agentB] } });
    const teamsOnAlpha = (await pool.query(`SELECT DISTINCT pp.resource_id FROM workforce_project_participations pp
      JOIN workforce_workspace_assignments a ON a.id=pp.assignment_id AND a.state='accepted'
      WHERE pp.project_id=$1 AND pp.state='active' AND pp.resource_kind='team'`, [alpha])).rows.map((r) => r.resource_id);
    assert.equal(teamsOnAlpha.length, 2, 'several teams target one project');
    const projectsOfSecond = (await pool.query(`SELECT project_id FROM workforce_project_participations WHERE resource_id=$1 AND state='active'`, [second.id])).rows.map((r) => r.project_id);
    assert.deepEqual(projectsOfSecond.sort(), [alpha, gamma].sort(), 'one team targets several projects');
    assert.equal((await pool.query('SELECT count(*)::int n FROM workforce_project_participations WHERE resource_id=$1 AND project_id=$2', [second.id, beta])).rows[0].n, 0,
      'a project the team is not recorded against is not its responsibility');
    await assert.rejects(saveWorkspaceTeam(pool, { workspaceId: ws, userId: owner, input: { name: 'Cross', description: '', project_ids: [foreign], agent_ids: [] } }),
      (e) => e.code === 'invalid_project_assignment', "a team may not take responsibility for another workspace's project");
  });

  await t.test('a save keeps history: removals revoke and end records instead of deleting them', async () => {
    const team = (await listWorkspaceTeams(pool, ws, owner)).teams.find((x) => x.name === 'Studio');
    const oldAgent = team.agents[0].id;
    const newAgent = await agentUser('agent-c', owner);
    await saveWorkspaceTeam(pool, { workspaceId: ws, userId: owner, teamId: team.id,
      input: { name: 'Studio', description: '', version: team.version, project_ids: [alpha], agent_ids: [newAgent] } });
    const members = (await pool.query('SELECT member_principal_id, state FROM workforce_team_memberships WHERE team_id=$1 ORDER BY created_at, id', [team.id])).rows;
    assert.deepEqual(members.map((m) => [m.member_principal_id, m.state]).sort(), [[oldAgent, 'revoked'], [newAgent, 'active']].sort(),
      'a removed agent is revoked, not deleted');
    const ended = (await pool.query('SELECT state FROM workforce_project_participations WHERE resource_id=$1 AND project_id=$2', [team.id, beta])).rows;
    assert.deepEqual(ended.map((r) => r.state), ['ended'], 'a removed project is ended, not deleted');
    const a = (await pool.query("SELECT id FROM workforce_workspace_assignments WHERE resource_id=$1 AND state='accepted'", [team.id])).rows[0];
    const effectiveMembers = (await pool.query('SELECT member_principal_id FROM workforce_assignment_active_member_candidates WHERE assignment_id=$1', [a.id])).rows.map((r) => r.member_principal_id);
    assert.deepEqual(effectiveMembers, [newAgent], 'the new member set was captured AND admitted');

    const current = (await listWorkspaceTeams(pool, ws, owner)).teams.find((x) => x.id === team.id);
    await saveWorkspaceTeam(pool, { workspaceId: ws, userId: owner, teamId: team.id, archive: true, input: { version: current.version } });
    assert.equal((await pool.query('SELECT status FROM workforce_resources WHERE id=$1', [team.id])).rows[0].status, 'archived');
    assert.equal((await pool.query('SELECT count(*)::int n FROM workforce_team_memberships WHERE team_id=$1', [team.id])).rows[0].n, 2,
      'archiving keeps every membership row');
    assert.equal((await pool.query("SELECT count(*)::int n FROM workforce_project_participations WHERE resource_id=$1 AND state='active'", [team.id])).rows[0].n, 0,
      'and ends every responsibility');
    assert.ok(!(await listWorkspaceTeams(pool, ws, owner)).teams.some((x) => x.id === team.id), 'an archived team leaves the page');
    assert.equal((await pool.query('SELECT count(*)::int n FROM workspace_audit WHERE workspace_id=$1 AND target=$2', [ws, `team:${team.id}`])).rows[0].n, 3,
      'every committed change has its audit record');
  });

  await t.test("the page's contract holds on the canonical model", async () => {
    await assert.rejects(saveWorkspaceTeam(pool, { workspaceId: ws, userId: viewer, input: { name: 'Nope', description: '', project_ids: [], agent_ids: [] } }),
      (e) => e.status === 403, 'only an admin writes');
    const seen = await listWorkspaceTeams(pool, ws, viewer);
    assert.equal(seen.can_manage, false);
    assert.deepEqual(seen.available_agents, [], 'a viewer is offered no agents');
    assert.equal((await listWorkspaceTeams(pool, otherWs, owner)).teams.length, 0, 'teams are isolated per workspace');
    const review = (await listWorkspaceTeams(pool, ws, owner)).teams.find((x) => x.name === 'Review');
    // A real stale write: save once (advancing the version), then retry with the version read before it.
    const keep = { name: 'Review', description: '', project_ids: review.projects.map((p) => p.id), agent_ids: review.agents.map((x) => x.id) };
    await saveWorkspaceTeam(pool, { workspaceId: ws, userId: owner, teamId: review.id, input: { ...keep, version: review.version } });
    await assert.rejects(saveWorkspaceTeam(pool, { workspaceId: ws, userId: owner, teamId: review.id, input: { ...keep, version: review.version } }),
      (e) => e.code === 'team_version_conflict', 'a stale save is refused');
    const foreignAgent = await agentUser('foreign-agent', stranger);
    await assert.rejects(saveWorkspaceTeam(pool, { workspaceId: ws, userId: owner, input: { name: 'Borrowed', description: '', project_ids: [], agent_ids: [foreignAgent] } }),
      (e) => e.code === 'invalid_agent_assignment', 'only your own agents can be newly assigned');
    await assert.rejects(saveWorkspaceTeam(pool, { workspaceId: ws, userId: owner, input: { name: 'Twice', description: '', project_ids: [], agent_ids: [review.agents[0].id] } }),
      (e) => e.status === 409, 'an agent belongs to one team per workspace');
    await assert.rejects(saveWorkspaceTeam(pool, { workspaceId: ws, userId: owner, input: { name: 'review', description: '', project_ids: [], agent_ids: [] } }),
      (e) => e.status === 409, 'a live team name is unique per workspace, case-insensitively');

    // Moved from the retired legacy suite: an audit failure must roll the whole save back, never report success.
    const c = await pool.connect();
    try {
      const broken = { query: (sql, params) => (String(sql).includes('INSERT INTO workspace_audit') ? Promise.reject(new Error('audit unavailable')) : c.query(sql, params)) };
      await assert.rejects(saveWorkspaceTeam(broken, { workspaceId: ws, userId: owner, input: { name: 'Must roll back', description: '', project_ids: [gamma], agent_ids: [] } }), /audit unavailable/);
    } finally { c.release(); }
    assert.equal((await pool.query("SELECT count(*)::int n FROM workforce_resources WHERE owner_workspace_id=$1 AND name='Must roll back'", [ws])).rows[0].n, 0,
      'an audit failure rolls the team mutation back instead of reporting success');
  });

  await t.test('the real HTTP route serves the canonical teams', async () => {
    const { default: teamRouter } = await import('../src/server/routes/workspaceTeamRoutes.js');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.db = pool; req.user = { id: owner }; next(); });
    app.use('/api/workspaces/:id/teams', teamRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/workspaces/${ws}/teams`, { headers: { 'x-xeno-workspace': ws } });
      assert.equal(r.status, 200);
      assert.ok((await r.json()).teams.some((x) => x.name === 'Review'), 'the page reads the canonical team through its unchanged route');
    } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
  });

  await t.test('nothing on this page grants anything', async () => {
    const principals = (await pool.query(`SELECT m.member_principal_id::text AS id FROM workforce_team_memberships m
      JOIN workforce_resources r ON r.id=m.team_id WHERE r.owner_workspace_id=$1 AND m.member_principal_id IS NOT NULL`, [ws])).rows.map((r) => r.id);
    assert.ok(principals.length > 0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM relationship_tuples WHERE subject_id = ANY($1)', [principals])).rows[0].n, 0,
      'no relationship tuple was written for any team member');
    const caps = await effective(pool, `SELECT e.effective_capabilities FROM workforce_assignment_effective_policy e
      JOIN workforce_resources r ON r.id=e.resource_id WHERE r.kind='team' AND r.owner_workspace_id=$1`, [ws]);
    assert.ok(caps.length > 0 && caps.every((x) => Array.isArray(x) && x.length === 0), 'every team assignment grants no capability');
  });
});
