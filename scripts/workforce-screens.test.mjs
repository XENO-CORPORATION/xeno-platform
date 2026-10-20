/**
 * The workspace's workforce screens read through these, against real PostgreSQL (TEST_DATABASE_URL):
 *   - POST /api/workforce/run-admissions/list   listRunAdmissions   (the Runs tab and the agent page's runs)
 *   - POST /api/workforce/coordination/projects/tree, /objectives/update   (the Objectives tab)
 *   - POST /api/workforce/forge/change-requests/list|read   (the Changes tab)
 *   - POST /api/workforce/sessions/branch-intents/list      (branch intents on the Changes tab)
 *
 * Each list applies the SAME visibility rule as the single read it lists, so a stranger sees nothing.
 * Mutation-checked 2026-10-20: dropping the per-row visibility check in listRunAdmissions fails
 * "a stranger lists none of them"; restored passes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';

const url = process.env.TEST_DATABASE_URL; if (url) requireProofDatabase(url);

async function call(router, actor, path, body) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = router.pool; req.workforceContext = { actorUserId: actor }; next(); });
  app.use(router.r);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, d: await res.json() };
  } finally { server.close(); }
}

test('workforce screens list exactly what their single reads would show', { skip: !url, timeout: 180000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 6 }); t.after(() => pool.end());
  const { runAllMigrations } = await import('../src/server/services/migrationRunner.js');
  await runAllMigrations(pool);
  const accountV2 = await import('../src/server/database/migrate-account-v2.js');
  await (accountV2.migrateAccountV2 || accountV2.default)(pool);
  const { admitRun, listRunAdmissions } = await import('../src/server/services/workforceRunAdmission.js');
  const goals = await import('../src/server/services/projectWorktree.js');
  const forge = await import('../src/server/services/forgeAdapter.js');
  const { createForgeRouter } = await import('../src/server/routes/workforceForgeRoutes.js');
  const { createWorkforceSessionRouter } = await import('../src/server/routes/workforceSessionRoutes.js');
  const { createWorkforceCoordinationRouter } = await import('../src/server/routes/workforceCoordinationRoutes.js');

  const marker = `scr-${randomUUID().slice(0, 8)}`;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$1,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const tuple = (type, id, rel, u) => pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES($1,$2,$3,'user',$4)`, [type, id, rel, u]);
  const fund = async (u, micro) => {
    await pool.query('INSERT INTO credit_accounts(user_id,balance) VALUES($1,$2) ON CONFLICT (user_id) DO UPDATE SET balance=EXCLUDED.balance', [u, micro]);
    await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true) ON CONFLICT (user_id) DO UPDATE SET enabled=true', [u]);
    await pool.query(`INSERT INTO credit_grants(id,user_id,amount_micro,remaining_micro,kind,source_ref) VALUES(md5('test-fund:'||$1::text)::uuid,$1::uuid,$2,$2,'paid','test-fund')
      ON CONFLICT (id) DO UPDATE SET amount_micro=EXCLUDED.amount_micro, remaining_micro=EXCLUDED.remaining_micro`, [u, micro]);
  };
  const owner = await user('owner'), stranger = await user('stranger');
  await fund(owner, 9_000_000n);
  const ws = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-ws`])).rows[0].id;
  await tuple('workspace', ws, 'owner', owner);
  const lender = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [stranger, `${marker}-lender`])).rows[0].id;
  const id = randomUUID();
  await pool.query(`INSERT INTO workforce_resources(id,kind,owner_workspace_id,name) VALUES($1,'agent',$2,'Alpha')`, [id, lender]);
  await pool.query('INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)',
    [id, { instructions: 'a', skills: [], requestedCapabilities: ['files.read'], secretReferences: [] }, hash(`${id}:1`)]);
  const rev = (await pool.query('SELECT revision FROM workforce_resources WHERE id=$1', [id])).rows[0].revision;
  const asg = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,resource_revision,policy)
    VALUES($1,'agent',$2,$3,$4,$5) RETURNING id`, [id, ws, lender, rev, { schemaVersion: 1, mode: 'explicit', capabilities: ['files.read'] }])).rows[0].id;
  await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted', revision=revision+1, source_approved_by_user_id=$2, source_approved_at=clock_timestamp(),
    target_accepted_by_user_id=$2, accepted_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [asg, owner]);
  const ctx = (a) => ({ actorUserId: a, clientId: 'xeno-agent-interface' });
  for (let i = 0; i < 2; i++) await admitRun(pool, ctx(owner), { operationId: randomUUID(), agent: { resourceId: id, version: 1, contentHash: hash(`${id}:1`) },
    target: { kind: 'workspace', assignmentId: asg }, capabilities: ['files.read'], budget: { ceilingMicro: '100000' } });

  await t.test('runs: the owner lists both admissions, newest first; a stranger lists none', async () => {
    const mine = await listRunAdmissions(pool, ctx(owner), { agentResourceId: id });
    assert.equal(mine.admissions.length, 2);
    assert.ok(mine.admissions[0].admittedAt >= mine.admissions[1].admittedAt);
    const theirs = await listRunAdmissions(pool, ctx(stranger), { agentResourceId: id });
    assert.equal(theirs.admissions.length, 0, 'a stranger lists none of them');
    await assert.rejects(listRunAdmissions(pool, ctx(owner), {}), (e) => e.code === 'bad_input', 'a filter is required');
  });

  const project = (await pool.query('INSERT INTO chat_projects(user_id,name,workspace_id) VALUES($1,$2,$3) RETURNING id', [owner, 'Atlas', ws])).rows[0].id;
  await tuple('project', project, 'owner', owner);
  const coord = { pool, r: createWorkforceCoordinationRouter() };
  await t.test('objectives: the tree shows the workspace objectives above the project goals, and edits apply', async () => {
    const o = await goals.createObjective(pool, { actorUserId: owner, workspaceId: ws, title: 'Ship v1', successEvidence: 'Released', windowStart: '2026-10-01', windowEnd: '2026-12-31' });
    const g = await goals.createGoal(pool, { actorUserId: owner, projectId: project, title: 'Build it', successEvidence: 'done' });
    await goals.linkGoalToObjective(pool, { actorUserId: owner, goalId: g.goalId ?? g.id, objectiveId: o.objectiveId });
    const tree = await call(coord, owner, '/projects/tree', { projectId: project });
    assert.equal(tree.status, 200);
    assert.equal(tree.d.result.objectives.length, 1);
    assert.equal(tree.d.result.objectives[0].windowStart, '2026-10-01');
    assert.equal(tree.d.result.objectives[0].progress.goals, 1);
    assert.equal(tree.d.result.goals[0].objectiveId, o.objectiveId);
    const up = await call(coord, owner, '/objectives/update', { objectiveId: o.objectiveId, title: 'Ship v1.0', windowEnd: '2027-01-31' });
    assert.equal(up.status, 200);
    assert.equal((await goals.readObjective(pool, { actorUserId: owner, objectiveId: o.objectiveId })).title, 'Ship v1.0');
    assert.equal((await call(coord, stranger, '/projects/tree', { projectId: project })).status, 404, 'a stranger cannot see the project');
    assert.equal((await call(coord, stranger, '/objectives/update', { objectiveId: o.objectiveId, title: 'x' })).status, 403);
  });

  await t.test('changes: change requests and branch intents list for the project, not for a stranger', async () => {
    const b = await forge.bindRepository(pool, { projectId: project, actorUserId: owner, provider: 'local', remoteId: `local:${marker}`, displayName: 'atlas' });
    const bindingId = b.id ?? b.bindingId;
    await pool.query(`INSERT INTO forge_change_requests(binding_id,source_branch,target_ref,title,head_rev,created_by_user_id) VALUES($1,'feat','main','Add thing','r1',$2)`, [bindingId, owner]);
    const fr = { pool, r: createForgeRouter() };
    const list = await call(fr, owner, '/change-requests/list', { projectId: project });
    assert.equal(list.status, 200); assert.equal(list.d.result.length, 1); assert.equal(list.d.result[0].bindingName, 'atlas');
    const one = await call(fr, owner, '/change-requests/read', { crId: list.d.result[0].id });
    assert.equal(one.d.result.title, 'Add thing');
    assert.equal((await call(fr, stranger, '/change-requests/list', { projectId: project })).status, 404);
    const conv = (await pool.query("INSERT INTO chat_conversations(user_id,title,project_id) VALUES($1,'Plan',$2) RETURNING id", [owner, project])).rows[0].id;
    await tuple('conversation', conv, 'owner', owner);
    await pool.query("INSERT INTO conversation_branch_intents(conversation_id,branch,intent,actor_user_id) VALUES($1,'main','abandon',$2)", [conv, owner]);
    const sr = { pool, r: createWorkforceSessionRouter({ env: {} }) };
    const bi = await call(sr, owner, '/branch-intents/list', { projectId: project });
    assert.equal(bi.status, 200); assert.equal(bi.d.result.intents.length, 1); assert.equal(bi.d.result.intents[0].conversationTitle, 'Plan');
    assert.equal((await call(sr, stranger, '/branch-intents/list', { projectId: project })).d.result.intents.length, 0, 'a stranger sees no intents');
  });
});
