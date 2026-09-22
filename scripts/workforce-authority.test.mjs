import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeOwnerManagement, WorkforceAuthorityError } from '../src/server/services/workforceAuthority.js';

const human = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const agent = '33333333-3333-4333-8333-333333333333';
const service = '44444444-4444-4444-8444-444444444444';
const workspace = '55555555-5555-4555-8555-555555555555';
const foreignWorkspace = '66666666-6666-4666-8666-666666666666';
const missing = '77777777-7777-4777-8777-777777777777';
const personal = { type: 'user', id: human };
const company = { type: 'workspace', id: workspace };

/** Query-aware in-memory relational fixture; REAL resolvePrincipal and check run.
 * Unexpected SQL throws. State transitions change lookup results, not verdicts.
 * This is unit evidence, not PostgreSQL locking/concurrency qualification. */
function fixture() {
  const users = new Map([human, other, agent, service].map(id => [id, {
    id, username: id, display_name: id, is_active: true, status: 'active', role: id === service ? 'service' : 'user',
  }]));
  const agents = new Map([[agent, { owner_user_id: human, status: 'active', agent_role: 'personal', agent_origin: 'manual' }]]);
  const workspaces = new Map([[workspace, { id: workspace, status: 'active' }], [foreignWorkspace, { id: foreignWorkspace, status: 'active' }]]);
  const tuples = [];
  const queries = [];
  const grant = (objectType, objectId, relation, subjectType, subjectId) => tuples.push({ object_type: objectType, object_id: objectId, relation, subject_type: subjectType, subject_id: subjectId });
  const db = {
    async query(source, values = []) {
      const sql = source.replace(/\s+/g, ' ').trim();
      queries.push({ sql, values });
      let rows;
      if (sql.startsWith('SELECT pg_advisory_xact_lock(')) rows = [{}];
      else if (sql.startsWith('SELECT id, status FROM workspaces WHERE id=$1')) rows = workspaces.has(values[0]) ? [{ ...workspaces.get(values[0]) }] : [];
      else if (sql.startsWith('SELECT id FROM users WHERE id = ANY(')) {
        const ids = new Set(values[0]);
        for (const id of values[0]) if (agents.has(id)) ids.add(agents.get(id).owner_user_id);
        rows = [...ids].filter(id => users.has(id)).sort().map(id => ({ id }));
      } else if (sql.startsWith('SELECT user_id FROM agent_identities WHERE user_id = ANY(')) {
        rows = values[0].filter(id => agents.has(id)).sort().map(user_id => ({ user_id }));
      } else if (sql.startsWith('SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.status,') && sql.includes('LEFT JOIN agent_identities a ON a.user_id = u.id')) {
        const u = users.get(values[0]);
        const a = agents.get(values[0]);
        const o = users.get(a?.owner_user_id);
        rows = u ? [{ ...u, owner_user_id: a?.owner_user_id ?? null,
          agent_role: a?.agent_role, agent_origin: a?.agent_origin, agent_status: a?.status,
          owner_handle: o?.username, owner_display_name: o?.display_name,
          owner_is_active: o?.is_active, owner_status: o?.status, owner_role: o?.role }] : [];
      } else if (sql.startsWith('SELECT relation FROM relationship_tuples')) {
        const [ot, oi, st, si] = values;
        rows = tuples.filter(t => t.object_type === ot && t.object_id === oi && t.subject_type === st && t.subject_id === si).map(t => ({ relation: t.relation }));
      } else if (sql.startsWith('SELECT subject_type, subject_id FROM relationship_tuples') && sql.includes("relation='parent'")) {
        const [ot, oi] = values;
        rows = tuples.filter(t => t.object_type === ot && t.object_id === oi && t.relation === 'parent').map(t => ({ subject_type: t.subject_type, subject_id: t.subject_id }));
      } else throw new Error(`Unmodeled SQL: ${sql}`);
      return { rows, rowCount: rows.length };
    },
  };
  return { db, users, agents, workspaces, tuples, queries, grant };
}

const authorize = (f, actor = human, owner = personal, options = {}) => authorizeOwnerManagement(f.db, actor, owner, { action: 'create_resource', ...options });
const denies = promise => assert.rejects(promise, error => error instanceof WorkforceAuthorityError && error.code === 'denied' && error.status === 403);

test('usable canonical human creates under own personal owner; UUID is normalized', async () => {
  const f = fixture();
  const result = await authorize(f, human.toUpperCase(), personal);
  assert.equal(result.principal.kind, 'human');
  assert.equal(result.subject, `user:${human}`);
  assert.equal(result.relation, 'self');
  assert.deepEqual(result.owner, personal);
  assert.ok(Object.isFrozen(result));
  assert.ok(!f.queries.some(q => q.sql.includes('FOR SHARE') || q.sql.includes('advisory')));
});

test('foreign human personal owner, unknown principal and unknown owner fail closed', async () => {
  const f = fixture();
  f.grant('user', human, 'owner', 'user', other);
  await denies(authorize(f, other));
  await denies(authorize(f, missing));
  await denies(authorize(f, human, { type: 'user', id: missing }));
});

test('agent-as-user cannot turn its UUID into personal human ownership or workspace hierarchy', async () => {
  const f = fixture();
  f.grant('workspace', workspace, 'owner', 'user', agent);
  await denies(authorize(f, agent, { type: 'user', id: agent }));
  await denies(authorize(f, agent));
  await denies(authorize(f, agent, company));
  f.grant('workspace', workspace, 'owner', 'agent', agent);
  await denies(authorize(f, agent, company));
  f.grant('workspace', workspace, 'editor', 'agent', agent);
  const result = await authorize(f, agent, company);
  assert.equal(result.subject, `agent:${agent}`);
  assert.equal(result.principal.kind, 'agent');
});

test('service principals cannot become human owners or workspace managers', async () => {
  const f = fixture();
  f.grant('workspace', workspace, 'editor', 'user', service);
  await denies(authorize(f, service, { type: 'user', id: service }));
  await denies(authorize(f, service, company));
});

test('suspension, owner suspension and retirement revoke the next agent check', async () => {
  const f = fixture();
  f.grant('workspace', workspace, 'editor', 'agent', agent);
  await authorize(f, agent, company);
  f.users.get(agent).is_active = false;
  await denies(authorize(f, agent, company));
  f.users.get(agent).is_active = true;
  f.users.get(human).status = 'suspended';
  await denies(authorize(f, agent, company));
  await denies(authorize(f));
  f.users.get(human).status = 'active';
  f.agents.get(agent).status = 'retired';
  await denies(authorize(f, agent, company));
  f.agents.get(agent).status = 'active';
  await authorize(f, agent, company);
});

test('personal agent creation requires exact direct scoped delegation and live human owner', async () => {
  const f = fixture();
  f.grant('user', human, 'owner', 'agent', agent);
  f.grant('user', human, 'workforce_resource_creator', 'user', agent);
  await denies(authorize(f, agent));
  f.grant('user', human, 'workforce_resource_creator', 'agent', agent);
  assert.equal((await authorize(f, agent)).relation, 'workforce_resource_creator');
  f.grant('user', other, 'workforce_resource_creator', 'agent', agent);
  await denies(authorize(f, agent, { type: 'user', id: other }));
  f.users.get(human).is_active = false;
  await denies(authorize(f, agent));
  f.users.get(human).is_active = true;
  f.users.get(human).role = 'service';
  await denies(authorize(f, agent));
});

test('orphan or service-owned agent cannot exploit missing owner-cascade join as workspace manager', async () => {
  const f = fixture();
  f.grant('workspace', workspace, 'editor', 'agent', agent);
  f.agents.get(agent).owner_user_id = missing;
  await denies(authorize(f, agent, company));
  f.agents.get(agent).owner_user_id = service;
  await denies(authorize(f, agent, company));
});

test('missing, archived and reactivated workspace state gates even direct managers', async () => {
  const f = fixture();
  f.grant('workspace', workspace, 'editor', 'user', human);
  await authorize(f, human, company);
  f.workspaces.get(workspace).status = 'archived';
  await denies(authorize(f, human, company));
  f.workspaces.delete(workspace);
  await denies(authorize(f, human, company));
  f.workspaces.set(workspace, { id: workspace, status: 'active' });
  await authorize(f, human, company);
});

test('workspace creator ownership is not a grant; unrelated member relations do not manage', async () => {
  const f = fixture();
  f.workspaces.get(workspace).owner_user_id = human;
  for (const relation of ['member', 'viewer', 'reviewer', 'client', 'funding_contributor', 'parent']) {
    f.tuples.length = 0;
    f.grant('workspace', workspace, relation, 'user', human);
    await denies(authorize(f, human, company));
  }
});

test('workspace editor/admin/owner authorizes creation; removing grant revokes next request', async () => {
  const f = fixture();
  for (const relation of ['editor', 'admin', 'owner']) {
    f.grant('workspace', workspace, relation, 'user', human);
    assert.equal((await authorize(f, human, company)).relation, 'editor');
    f.tuples.length = 0;
    await denies(authorize(f, human, company));
  }
});

test('parent edges cannot union foreign workspace or personal management authority', async () => {
  const f = fixture();
  f.grant('workspace', foreignWorkspace, 'owner', 'user', human);
  f.grant('workspace', workspace, 'parent', 'workspace', foreignWorkspace);
  await denies(authorize(f, human, company));
  f.grant('user', human, 'parent', 'workspace', foreignWorkspace);
  f.grant('workspace', foreignWorkspace, 'workforce_resource_creator', 'agent', agent);
  await denies(authorize(f, agent));
});

test('mutation takes canonical workspace gate before workspace and principal locks/checks', async () => {
  const f = fixture();
  f.grant('workspace', workspace, 'editor', 'user', human);
  await authorize(f, human, company, { forMutation: true });
  assert.equal(f.queries[0].sql, 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))');
  assert.deepEqual(f.queries[0].values, [`workspace-authority-operations:${workspace}`]);
  assert.match(f.queries[1].sql, /FROM workspaces.*FOR SHARE$/);
  assert.match(f.queries[2].sql, /FROM users.*ORDER BY id FOR SHARE$/);
  assert.match(f.queries[3].sql, /FROM agent_identities.*FOR SHARE$/);
  assert.ok(f.queries[4].sql.includes('LEFT JOIN agent_identities'));
  assert.ok(!f.queries.some(q => /^(BEGIN|COMMIT|ROLLBACK)/.test(q.sql)));
});

test('personal mutation locks actor and owner without manufacturing workspace lock', async () => {
  const f = fixture();
  f.grant('user', human, 'workforce_resource_creator', 'agent', agent);
  await authorize(f, agent, personal, { forMutation: true });
  assert.deepEqual(f.queries[0].values, [[agent, human]]);
  assert.ok(!f.queries.some(q => q.sql.includes('advisory') || q.sql.includes('FROM workspaces')));
});

test('missing/unknown actions cannot broaden create into other management operations', async () => {
  const f = fixture();
  for (const action of [undefined, 'delete_resource', 'transfer_owner', 'delegate', 'spend', 'manage']) {
    await assert.rejects(authorizeOwnerManagement(f.db, human, personal, { action }), { code: 'bad_input' });
  }
  assert.equal(f.queries.length, 0);
});

test('renderer principal objects and contradictory owner shapes are not identity proof', async () => {
  const f = fixture();
  await assert.rejects(authorize(f, { id: human, type: 'user', kind: 'human', usable: true }), { code: 'bad_input' });
  await assert.rejects(authorize(f, human, { ...personal, principalType: 'human' }), { code: 'bad_input' });
  assert.equal(f.queries.length, 0);
});
