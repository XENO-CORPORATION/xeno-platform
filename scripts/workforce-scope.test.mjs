import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkforceScopeError,
  normalizeOwnerScope,
  normalizeProjectParticipationTarget,
  normalizeWorkforceParticipant,
  assertProjectParticipationTargetAgreement,
} from '../src/server/services/workforceScope.js';

const user = '11111111-1111-4111-8111-111111111111';
const workspace = '22222222-2222-4222-8222-222222222222';
const assignment = '33333333-3333-4333-8333-333333333333';
const project = '44444444-4444-4444-8444-444444444444';
const agent = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const team = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const other = 'cccccccc-cccc-7ccc-9ccc-cccccccccccc';
const personalTarget = { type: 'personal-project', ownerUserId: user, projectId: project };
const workspaceTarget = {
  type: 'workspace-project', workspaceId: workspace,
  workspaceAssignmentId: assignment, projectId: project,
};

function refuses(fn, reason, field) {
  assert.throws(fn, error => {
    assert.ok(error instanceof WorkforceScopeError);
    assert.equal(error.name, 'WorkforceScopeError');
    assert.equal(error.code, 'bad_input');
    assert.equal(error.status, 400);
    assert.equal(error.details.schemaVersion, 1);
    assert.equal(error.details.reason, reason);
    if (field) assert.equal(error.details.field, field);
    assert.ok(Object.isFrozen(error.details));
    return true;
  });
}

test('canonical owner scopes retain their distinct user/workspace kind', () => {
  for (const type of ['user', 'workspace']) {
    assert.deepEqual(normalizeOwnerScope({ type, id: agent.toUpperCase() }), { type, id: agent });
  }
  for (const type of ['personal', 'company', 'global', undefined]) {
    refuses(() => normalizeOwnerScope({ type, id: user }), 'invalid_variant');
  }
});

test('both participation variants normalize without fabricating workspace lineage', () => {
  assert.deepEqual(normalizeProjectParticipationTarget(personalTarget), personalTarget);
  assert.deepEqual(normalizeProjectParticipationTarget(workspaceTarget), workspaceTarget);
  assert.deepEqual(normalizeProjectParticipationTarget({ ...personalTarget, projectId: other.toUpperCase() }),
    { ...personalTarget, projectId: other });
});

test('personal participation refuses workspace/assignment fields even null or undefined', () => {
  for (const key of ['workspaceId', 'workspaceAssignmentId']) {
    for (const value of [workspace, null, undefined]) {
      refuses(() => normalizeProjectParticipationTarget({ ...personalTarget, [key]: value }),
        'contradictory_variant');
    }
  }
  refuses(() => normalizeProjectParticipationTarget({ ...workspaceTarget, ownerUserId: user }),
    'contradictory_variant');
});

test('workspace-project requires its own assignment, workspace and project; personal requires owner/project', () => {
  for (const target of [personalTarget, workspaceTarget]) {
    for (const key of Object.keys(target).filter(key => key !== 'type')) {
      const missing = { ...target };
      delete missing[key];
      refuses(() => normalizeProjectParticipationTarget(missing), 'invalid_id', `target.${key}`);
    }
  }
  refuses(() => normalizeProjectParticipationTarget({ ...workspaceTarget, type: 'workspace' }), 'invalid_variant');
});

test('direct agent has no team, contextual agent selects one team, and team is independent', () => {
  assert.deepEqual(normalizeWorkforceParticipant({ type: 'agent', id: agent }), { type: 'agent', id: agent });
  assert.deepEqual(normalizeWorkforceParticipant({ type: 'agent', id: agent, teamId: team }),
    { type: 'agent', id: agent, teamId: team });
  assert.deepEqual(normalizeWorkforceParticipant({ type: 'team', id: team }), { type: 'team', id: team });
  refuses(() => normalizeWorkforceParticipant({ type: 'team', id: team, teamId: team }), 'contradictory_variant');
  refuses(() => normalizeWorkforceParticipant({ type: 'human', id: user }), 'invalid_variant');
  refuses(() => normalizeWorkforceParticipant({ type: 'agent', id: agent, teamId: null }), 'invalid_id');
});

test('exact target agreement compares every owner/workspace/project/assignment field', () => {
  for (const target of [personalTarget, workspaceTarget]) {
    assert.deepEqual(assertProjectParticipationTargetAgreement(target, { ...target }), target);
    for (const key of Object.keys(target).filter(key => key !== 'type')) {
      refuses(() => assertProjectParticipationTargetAgreement(target, { ...target, [key]: other }),
        'scope_mismatch');
    }
  }
  refuses(() => assertProjectParticipationTargetAgreement(personalTarget, workspaceTarget), 'scope_mismatch');
  refuses(() => assertProjectParticipationTargetAgreement(workspaceTarget, personalTarget), 'scope_mismatch');
  assert.deepEqual(assertProjectParticipationTargetAgreement(
    { ...personalTarget, projectId: other.toUpperCase() }, { ...personalTarget, projectId: other }),
  { ...personalTarget, projectId: other });
  refuses(() => assertProjectParticipationTargetAgreement(personalTarget, { ...personalTarget, accepted: true }),
    'unknown_field');
});

test('unknown fields cannot smuggle authority or incidental UI context', () => {
  const cases = [
    [normalizeOwnerScope, { type: 'user', id: user }],
    [normalizeProjectParticipationTarget, personalTarget],
    [normalizeProjectParticipationTarget, workspaceTarget],
    [normalizeWorkforceParticipant, { type: 'agent', id: agent }],
  ];
  for (const [normalize, valid] of cases) {
    for (const key of ['allowed', 'accepted', 'consent', 'selectedWorkspaceId', 'unexpected']) {
      refuses(() => normalize({ ...valid, [key]: true }), 'unknown_field');
    }
    refuses(() => normalize({ ...valid, [Symbol('hidden')]: true }), 'unknown_field');
    refuses(() => normalize(Object.defineProperty({ ...valid }, 'hidden', { value: true })), 'unknown_field');
  }
});

test('all ID fields reject malformed/local IDs, coercion, nil UUID and invalid UUID layout', () => {
  const invalid = [null, undefined, 42, {}, ['uuid'], new String(user), '', 'local-agent-1',
    ` ${user}`, `${user}\n`, user.replaceAll('-', ''), '00000000-0000-0000-0000-000000000000',
    '11111111-1111-0111-8111-111111111111', '11111111-1111-4111-7111-111111111111'];
  const cases = [
    [normalizeOwnerScope, { type: 'user', id: user }, ['id']],
    [normalizeProjectParticipationTarget, personalTarget, ['ownerUserId', 'projectId']],
    [normalizeProjectParticipationTarget, workspaceTarget, ['workspaceId', 'workspaceAssignmentId', 'projectId']],
    [normalizeWorkforceParticipant, { type: 'agent', id: agent, teamId: team }, ['id', 'teamId']],
  ];
  for (const [normalize, valid, keys] of cases) {
    for (const key of keys) for (const value of invalid) {
      refuses(() => normalize({ ...valid, [key]: value }), 'invalid_id');
    }
  }
});

test('non-record shapes and inherited fields fail without executing accessors', () => {
  for (const normalize of [normalizeOwnerScope, normalizeProjectParticipationTarget, normalizeWorkforceParticipant]) {
    for (const invalid of [null, undefined, [], 'scope', 5, new Date(), Object.create(personalTarget)]) {
      refuses(() => normalize(invalid), 'invalid_shape');
    }
  }
  let calls = 0;
  const accessor = { get type() { calls += 1; return 'user'; }, id: user };
  refuses(() => normalizeOwnerScope(accessor), 'invalid_shape');
  assert.equal(calls, 0);
  assert.deepEqual(normalizeOwnerScope(Object.assign(Object.create(null), { type: 'user', id: user })),
    { type: 'user', id: user });
});

test('normalizers return fresh immutable values, never mutate input or grant permission', () => {
  for (const [normalize, value] of [
    [normalizeOwnerScope, { type: 'user', id: user }],
    [normalizeProjectParticipationTarget, personalTarget],
    [normalizeProjectParticipationTarget, workspaceTarget],
    [normalizeWorkforceParticipant, { type: 'agent', id: agent }],
    [normalizeWorkforceParticipant, { type: 'agent', id: agent, teamId: team }],
  ]) {
    const input = Object.freeze({ ...value });
    const before = JSON.stringify(input);
    const result = normalize(input);
    assert.notEqual(result, input);
    assert.ok(Object.isFrozen(result));
    assert.equal(JSON.stringify(input), before);
    assert.deepEqual(result, value);
    assert.equal(Object.hasOwn(result, 'allowed'), false);
    assert.throws(() => { result.type = 'changed'; }, TypeError);
  }
  const result = assertProjectParticipationTargetAgreement(personalTarget, personalTarget);
  assert.notEqual(result, personalTarget);
  assert.ok(Object.isFrozen(result));
  const mutable = { ...personalTarget };
  normalizeProjectParticipationTarget(mutable);
  assert.equal(Object.isFrozen(mutable), false);
  refuses(() => normalizeProjectParticipationTarget({ ...mutable, workspaceId: workspace }), 'contradictory_variant');
  assert.deepEqual(mutable, personalTarget);
});
