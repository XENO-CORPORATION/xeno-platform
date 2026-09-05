import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import express from 'express';
import teamRouter from '../src/server/routes/workspaceTeamRoutes.js';
import { validateTeamInput, saveWorkspaceTeam, listWorkspaceTeams } from '../src/server/services/workspaceTeams.js';
import { writeTuples } from '../src/server/utils/authzReBAC.js';

const draft = (name = 'Engineering') => ({ name, description: '', project_ids: [], agent_ids: [] });
test('team input rejects malformed and oversized assignments, normalizes duplicates', () => {
  for (const input of [null, {}, { ...draft(), name: ' ' }, { ...draft(), description: 42 }, { ...draft(), project_ids: ['bad'] }, { ...draft(), agent_ids: new Array(201).fill(randomUUID()) }]) {
    assert.throws(() => validateTeamInput(input), error => error.status === 400);
  }
  const id = randomUUID();
  assert.deepEqual(validateTeamInput({ ...draft(' Team '), project_ids: [id, id.toUpperCase()] }).projectIds, [id]);
});

test('HTTP routes reject malformed and conflicting contexts before querying the database', async () => {
  const app = express(); app.use(express.json()); app.use('/api/workspaces/:id/teams', teamRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const id = randomUUID(), origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${origin}/api/workspaces/bad/teams`)).status, 400);
    assert.equal((await fetch(`${origin}/api/workspaces/${id}/teams`, { headers: { 'x-xeno-workspace': randomUUID() } })).status, 409);
    assert.equal((await fetch(`${origin}/api/workspaces/${id}/teams?workspace_id=`)).status, 400);
    assert.equal((await fetch(`${origin}/api/workspaces/${id}/teams`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: null }) })).status, 400);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('real Postgres operational teams: tenancy, roles, audit, versions, agents, archive', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  // Service transactions become savepoints so ALL fixture rows and schema roll back.
  const db = { query: (sql, params) => client.query(sql === 'BEGIN' ? 'SAVEPOINT team_operation' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT team_operation' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT team_operation' : sql, params) };
  try {
    const exists = (await client.query("SELECT to_regclass('workspace_teams') AS name")).rows[0].name;
    if (!exists) await client.query(await readFile(new URL('../src/server/database/migrations/20260904140000-workspace-operational-teams.sql', import.meta.url), 'utf8'));
    const marker = `teams-${randomUUID().slice(0, 20)}`;
    async function user(suffix) { return (await client.query("INSERT INTO users(username,email,password_hash,display_name) VALUES($1,$2,'fixture-only',$1) RETURNING id", [`${marker}-${suffix}`, `${marker}-${suffix}@xeno.test`])).rows[0].id; }
    const owner = await user('owner'), viewer = await user('viewer'), agent = await user('agent'), foreignAgent = await user('foreign-agent');
    const workspaces = [];
    for (const suffix of ['A','B']) {
      const id = (await client.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-${suffix}`])).rows[0].id;
      workspaces.push(id);
      await writeTuples(client, { writes: [{ object: `workspace:${id}`, relation: 'owner', subject: `user:${owner}` }, { object: `workspace:${id}`, relation: 'viewer', subject: `user:${viewer}` }] });
    }
    const [workspaceId, otherWorkspace] = workspaces;
    const project = (await client.query("INSERT INTO chat_projects(workspace_id,name) VALUES($1,'Shared project') RETURNING id", [workspaceId])).rows[0].id;
    const foreignProject = (await client.query("INSERT INTO chat_projects(workspace_id,name) VALUES($1,'Foreign project') RETURNING id", [otherWorkspace])).rows[0].id;
    for (const [id, agentOwner] of [[agent, owner], [foreignAgent, viewer]]) await client.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role,agent_origin) VALUES($1,$2,'other','team-fixture')", [id, agentOwner]);
    const save = (input, extra = {}) => saveWorkspaceTeam(db, { workspaceId, userId: owner, input, ...extra });
    const first = await save({ ...draft(), project_ids: [project], agent_ids: [agent] });
    await t.test('multiple teams share a workspace project; list does not grant permissions', async () => {
      await save({ ...draft('QA'), project_ids: [project] });
      const list = await listWorkspaceTeams(db, workspaceId, viewer);
      assert.equal(list.teams.length, 2); assert.equal(list.can_manage, false); assert.deepEqual(list.available_agents, []);
      assert.equal(list.teams[0].projects[0].id, project);
      assert.equal((await client.query("SELECT count(*)::int AS n FROM relationship_tuples WHERE subject_id=$1", [agent])).rows[0].n, 0);
      assert.equal((await listWorkspaceTeams(db, otherWorkspace, owner)).teams.length, 0);
    });
    await t.test('viewer cannot mutate; foreign projects and foreign teams are refused', async () => {
      await assert.rejects(save(draft(), { userId: viewer }), e => e.status === 403);
      await assert.rejects(save({ ...draft('Wrong project'), project_ids: [foreignProject] }), e => e.code === 'invalid_project_assignment');
      await assert.rejects(save({ ...draft('Wrong team'), version: 1 }, { workspaceId: otherWorkspace, teamId: first.id }), e => e.status === 404);
      assert.equal((await listWorkspaceTeams(db, workspaceId, owner)).teams.length, 2);
    });
    await t.test('agents need ownership and cannot belong to two teams in a workspace', async () => {
      await assert.rejects(save({ ...draft('Foreign agent'), agent_ids: [foreignAgent] }), e => e.code === 'invalid_agent_assignment');
      await assert.rejects(save({ ...draft('Duplicate agent'), agent_ids: [agent] }), e => e.status === 409);
      assert.equal((await listWorkspaceTeams(db, workspaceId, owner)).teams.length, 2);
    });
    await t.test('optimistic version check rejects stale updates and archive', async () => {
      await save({ ...draft('Engineering updated'), version: 1, project_ids: [project], agent_ids: [agent] }, { teamId: first.id });
      await assert.rejects(save({ ...draft('Stale'), version: 1 }, { teamId: first.id }), e => e.code === 'team_version_conflict');
      await assert.rejects(save({ version: 1 }, { teamId: first.id, archive: true }), e => e.code === 'team_version_conflict');
    });
    await t.test('composite foreign key rejects direct cross-tenant assignment', async () => {
      await client.query('SAVEPOINT direct_fk');
      await assert.rejects(client.query('INSERT INTO workspace_team_projects(workspace_id,team_id,project_id) VALUES($1,$2,$3)', [workspaceId, first.id, foreignProject]), e => e.code === '23503');
      await client.query('ROLLBACK TO SAVEPOINT direct_fk');
    });
    await t.test('audit failure rolls back the team mutation instead of reporting success', async () => {
      const brokenAudit = { query: (sql, params) => sql.includes('INSERT INTO workspace_audit') ? Promise.reject(new Error('audit unavailable')) : db.query(sql, params) };
      await assert.rejects(saveWorkspaceTeam(brokenAudit, { workspaceId, userId: owner, input: draft('Must roll back') }), /audit unavailable/);
      assert.equal((await client.query('SELECT id FROM workspace_teams WHERE workspace_id=$1 AND name=$2', [workspaceId, 'Must roll back'])).rowCount, 0);
    });
    await t.test('archive keeps projects and agents; committed changes have audit records', async () => {
      await save({ version: 2 }, { teamId: first.id, archive: true });
      assert.equal((await listWorkspaceTeams(db, workspaceId, owner)).teams.length, 1);
      assert.equal((await client.query('SELECT id FROM chat_projects WHERE id=$1', [project])).rowCount, 1);
      assert.equal((await client.query('SELECT user_id FROM agent_identities WHERE user_id=$1', [agent])).rowCount, 1);
      assert.equal((await client.query('SELECT action FROM workspace_audit WHERE workspace_id=$1 AND target=$2', [workspaceId, `team:${first.id}`])).rowCount, 3);
      assert.equal((await listWorkspaceTeams(db, workspaceId, owner)).available_agents[0].id, agent);
    });
  } finally { await client.query('ROLLBACK'); await client.end(); }
});
