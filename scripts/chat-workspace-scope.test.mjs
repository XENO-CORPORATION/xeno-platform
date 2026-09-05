import test from 'node:test';
import assert from 'node:assert/strict';
import { chatWorkspaceScope, requestedChatWorkspace } from '../src/server/middleware/chatWorkspaceScope.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('explicit workspace locations agree, regardless of UUID case', () => {
  assert.equal(requestedChatWorkspace({ headers: { 'x-xeno-workspace': A }, body: { workspace_id: A.toUpperCase() } }), A);
  assert.equal(requestedChatWorkspace({ query: { workspace_id: B } }), B);
  assert.equal(requestedChatWorkspace({}), null);
});
test('conflicting contexts and malformed explicit scopes never become personal scope', () => {
  assert.throws(() => requestedChatWorkspace({ headers: { 'x-xeno-workspace': A }, query: { workspace_id: B } }), { code: 'workspace_context_mismatch' });
  for (const value of ['', null, ['bad'], 'ws-test']) {
    assert.throws(() => requestedChatWorkspace({ headers: { 'x-xeno-workspace': value } }), { code: 'invalid_workspace_id' });
  }
});

async function invoke({ member = true, resource = true, path = '/projects', body = {}, fail = false } = {}) {
  const queries = [];
  const req = { headers: { 'x-xeno-workspace': A }, query: {}, body, path, user: { id: B }, db: {
    async query(sql, params) {
      queries.push({ sql, params });
      if (fail) throw new Error('database unavailable');
      if (sql.includes('SELECT relation FROM relationship_tuples')) return { rows: member ? [{ relation: 'owner' }] : [] };
      if (sql.includes('relationship_tuples')) return { rows: [] };
      return { rows: resource ? [{ id: P }] : [] };
    },
  } };
  let status = 200, payload, next = false;
  const res = { status(value) { status = value; return this; }, json(value) { payload = value; return this; } };
  await chatWorkspaceScope(req, res, () => { next = true; });
  return { status, payload, next, queries, req };
}
test('authorized workspace context is forwarded to collection handlers', async () => {
  const result = await invoke();
  assert.equal(result.next, true);
  assert.equal(result.req.chatWorkspaceId, A);
});
test('nonmembers cannot enumerate scoped collections', async () => {
  const result = await invoke({ member: false });
  assert.equal(result.status, 404);
  assert.equal(result.next, false);
});
test('project detail, nested files and conversation bindings enforce project workspace', async () => {
  for (const entry of [{ path: `/projects/${P}` }, { path: `/projects/${P}/files` }, { path: '/conversations', body: { project_id: P } }]) {
    const result = await invoke({ ...entry, resource: false });
    assert.equal(result.status, 404);
    assert.equal(result.next, false);
    assert.deepEqual(result.queries.at(-1).params, [P, A]);
  }
});
test('conversation scope derives through its project parent', async () => {
  const result = await invoke({ path: `/conversations/${P}/messages` });
  assert.equal(result.next, true);
  assert.match(result.queries.at(-1).sql, /COALESCE\(p.workspace_id,c.workspace_id\)/);
});
test('foreign conversation cannot be read or written inside another workspace', async () => {
  const result = await invoke({ path: `/conversations/${P}/messages`, resource: false });
  assert.equal(result.status, 404);
  assert.equal(result.next, false);
});
test('scope lookup failure fails closed', async () => {
  const result = await invoke({ fail: true });
  assert.equal(result.status, 500);
  assert.equal(result.next, false);
});
