/**
 * XENO-WORKFORCE-01 VIEW-03 -- create-plus-assign is ONE durable command, and a failure retains the draft.
 *
 *   VIEW-03: "Global creation requires explicit/default-displayed owner and optional assignments. Workspace
 *            creation displays owner and performs create-plus-assign as one durable command. Failure retains
 *            the draft and does not create duplicates on retry."
 *
 * Runs on the migrated schema (TEST_DATABASE_URL) against services/workforceResources.js
 * (createAndAssignWorkforceResource, the create path with an assignment set -- the SAME receipt, idempotency and
 * authority as a plain create, not a second command) and 20260927140000-workforce-create-and-assign.sql, which
 * binds the assignments a creation made to that creation's receipt. Real workspaces, real ReBAC grants, real
 * assignment rows under every guard that table already enforces, and a real run admission against the result.
 *
 * Each clause, and the wrong implementation it rules out:
 *   explicit owner         a create with no owner that the server defaults to somebody
 *   optional assignments   a create that cannot be made without assigning, or assigns without being asked
 *   displays owner         a reply that leaves the client to infer who owns what it just made
 *   one durable command    a create that commits while its assignment fails, leaving an orphan in no workspace
 *   ASN-04 both checks     an assignment into a workspace the creator does not run, silently accepted
 *   no duplicates          a retry that makes a second resource, or a second assignment
 *   retains the draft      a refused command that half-writes, so resubmitting the same draft collides
 *
 * The CLIENT half of "failure retains the draft" is proven where the draft lives -- xeno-agent-interface's creation
 * view, packages/ui/src/components/agent/ownedWorkforceView.dom.test.ts, in a real Electron DOM: "uncertain response
 * preserves draft", "draft frozen while pending", "explicit retry retains ID and requires reconciliation", and
 * "re-entered lost draft uses the same saved identity instead of creating another". What those need from the
 * platform is proven here: a refused command writes NOTHING, so the retained draft can be resubmitted under the same
 * operation id; and the same id always returns the same result, so a retry can never duplicate.
 *
 * Mutation-checked 2026-09-27, each fails the named assertion; restored passes:
 *   - the owner is defaulted to the actor when absent          -> "a creation names its owner; none is defaulted"
 *   - assignments are ignored                                  -> "the assignment is made in the same command"
 *   - a failed assignment does not roll the creation back      -> "a refused assignment leaves nothing behind"
 *   - the target side is accepted without a target admin       -> "an assignment the creator cannot accept stays proposed"
 *   - a proposed assignment is reported as accepted            -> "the reply says which side is still owed"
 *   - the assignment set is not part of the request hash       -> "a retry asking for other assignments conflicts"
 *   - a replay makes a second assignment                       -> "a retry returns the same assignment and writes nothing"
 *   - the receipt accepts an assignment it did not make        -> "a creation records only the assignments it made"
 *   - a team is accepted without its approved member set       -> "a team is assigned with its approved member set"
 *   - the reply's owner is taken from the request, not the row -> "the reply's owner is the owner of what was made"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;

test('a resource is created and assigned as one durable command, and a refusal writes nothing (VIEW-03)', { skip: !url, timeout: 120000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  t.after(() => pool.end());
  assert.ok((await pool.query("SELECT to_regclass('workforce_resource_operation_assignments') AS v")).rows[0].v, 'this suite runs on the migrated schema');
  const { createWorkforceResource, createAndAssignWorkforceResource } = await import('../src/server/services/workforceResources.js');
  const { admitRun } = await import('../src/server/services/workforceRunAdmission.js');

  const marker = `ca-${randomUUID().slice(0, 8)}`;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$1,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const ctx = (actorUserId) => ({ actorUserId, clientId: 'xeno-agent-interface' });
  // A reason is matched wherever the error carries one: a resource error on details.reason, a scope error on its own.
  const rejects = (p, code, reason, message) => assert.rejects(p, (e) => e.code === code && (!reason || (e.details?.reason ?? e.reason) === reason), message);
  const tuple = (object, rel, u) => pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
    VALUES('workspace',$1,$2,'user',$3)`, [object, rel, u]);
  const workspace = async (ownerId, s) => {
    const id = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [ownerId, `${marker}-${s}`])).rows[0].id;
    await tuple(id, 'owner', ownerId);
    return id;
  };
  // Every table the command can write. A refused command must leave all of them exactly as they were.
  const TABLES = ['workforce_resources', 'workforce_agent_versions', 'workforce_resource_operations', 'workforce_workspace_assignments',
    'workforce_assignment_member_sets', 'workforce_assignment_members', 'workforce_resource_operation_assignments', 'workspace_audit'];
  const counts = async () => Object.fromEntries(await Promise.all(TABLES.map(async (tb) =>
    [tb, (await pool.query(`SELECT count(*)::int AS n FROM ${tb}`)).rows[0].n])));
  const none = { schemaVersion: 1, mode: 'none', capabilities: [] };
  const explicit = (caps) => ({ schemaVersion: 1, mode: 'explicit', capabilities: caps });
  const agentDraft = (owner, assignments, extra = {}) => ({ operationId: randomUUID(), owner, kind: 'agent', name: `${marker} researcher`,
    definition: { schemaVersion: 1, instructions: 'research', skills: [], requestedCapabilities: ['files.read'] },
    ...(assignments ? { assignments } : {}), ...extra });

  const alice = await user('alice'), bob = await user('bob'), carol = await user('carol');
  await pool.query('INSERT INTO credit_accounts(user_id,balance) VALUES($1,90000000),($2,90000000)', [alice, bob]);
  const studio = await workspace(alice, 'studio');      // alice administers it
  const partner = await workspace(bob, 'partner');      // alice does not
  await tuple(partner, 'editor', alice);                // alice may work there, but not accept into it
  const archived = await workspace(alice, 'archived');
  await pool.query("UPDATE workspaces SET status='archived' WHERE id=$1", [archived]);

  await t.test('VIEW-03: a creation names its owner explicitly -- none is defaulted -- and assignment is optional', async () => {
    const before = await counts();
    const draft = agentDraft({ type: 'user', id: alice }, [{ workspaceId: studio, policy: none }]);
    delete draft.owner;
    await rejects(createAndAssignWorkforceResource(pool, ctx(alice), draft), 'bad_input', null, 'a creation names its owner; none is defaulted');
    assert.deepEqual(await counts(), before, 'an ownerless create writes nothing');
    // Assignment is optional: the same command with no assignments is a plain creation, owner and all.
    const plain = await createAndAssignWorkforceResource(pool, ctx(alice), agentDraft({ type: 'user', id: alice }));
    assert.deepEqual([plain.owner, plain.assignments], [{ type: 'user', id: alice }, []], 'a creation may assign nowhere');
  });

  let made, draft;
  await t.test('VIEW-03: a workspace creation displays its owner and creates-plus-assigns in one command', async () => {
    const before = await counts();
    draft = agentDraft({ type: 'user', id: alice }, [{ workspaceId: studio, policy: explicit(['files.read']) }, { workspaceId: partner, policy: none }]);
    made = await createAndAssignWorkforceResource(pool, ctx(alice), draft);
    assert.deepEqual(made.owner, { type: 'user', id: alice }, 'the reply names the owner');
    assert.deepEqual(made.resource.owner, made.owner, 'the reply\'s owner is the owner of what was made');
    assert.equal(made.assignments.length, 2, 'the assignment is made in the same command');
    const [inStudio, inPartner] = made.assignments;
    // ASN-04: alice runs studio, so both checks are hers and BOTH are recorded.
    assert.deepEqual([inStudio.workspaceId, inStudio.state, inStudio.sourceApprovedByUserId, inStudio.targetAcceptedByUserId, inStudio.awaiting],
      [studio, 'accepted', alice, alice, null], 'a creator who runs both sides satisfies both checks, and both are recorded');
    // alice does not run partner: her half is recorded, partner's is owed and nothing is granted.
    assert.deepEqual([inPartner.workspaceId, inPartner.state, inPartner.sourceApprovedByUserId, inPartner.targetAcceptedByUserId],
      [partner, 'proposed', alice, null], 'an assignment the creator cannot accept stays proposed');
    assert.equal(inPartner.awaiting, 'target_acceptance', 'the reply says which side is still owed');
    const stored = (await pool.query('SELECT state, source_approved_by_user_id, target_accepted_by_user_id FROM workforce_workspace_assignments WHERE id=$1',
      [inPartner.assignmentId])).rows[0];
    assert.deepEqual([stored.state, stored.source_approved_by_user_id, stored.target_accepted_by_user_id], ['proposed', alice, null],
      'an assignment the creator cannot accept stays proposed');
    const after = await counts();
    const grew = Object.fromEntries(TABLES.map((tb) => [tb, after[tb] - before[tb]]));
    assert.deepEqual(grew, { workforce_resources: 1, workforce_agent_versions: 1, workforce_resource_operations: 1, workforce_workspace_assignments: 2,
      workforce_assignment_member_sets: 0, workforce_assignment_members: 0, workforce_resource_operation_assignments: 2, workspace_audit: 2 },
    'one command wrote one resource, one receipt and exactly the two assignments it was asked for');
    // And the proposed one grants nothing: a run against it is refused.
    const v = (await pool.query('SELECT content_hash FROM workforce_agent_versions WHERE resource_id=$1 AND version=1', [made.resource.id])).rows[0];
    await rejects(admitRun(pool, ctx(alice), { operationId: randomUUID(), agent: { resourceId: made.resource.id, version: 1, contentHash: v.content_hash },
      target: { kind: 'workspace', assignmentId: inPartner.assignmentId }, capabilities: [], budget: { ceilingMicro: '1000' } }),
    'denied', 'assignment_not_live', 'a proposed assignment grants nothing until the target accepts it');
  });

  await t.test('VIEW-03: a retry does not create duplicates -- the same command returns what it made, and writes nothing', async () => {
    const before = await counts();
    const again = await createAndAssignWorkforceResource(pool, ctx(alice), draft);
    assert.equal(again.replayed, true);
    assert.equal(again.resource.id, made.resource.id, 'a retry returns the same resource');
    assert.deepEqual(again.assignments.map((a) => a.assignmentId), made.assignments.map((a) => a.assignmentId),
      'a retry returns the same assignment and writes nothing');
    assert.deepEqual(await counts(), before, 'a retry returns the same assignment and writes nothing');
    // The same id asking for other assignments is a different command, and is refused rather than merged.
    await rejects(createAndAssignWorkforceResource(pool, ctx(alice), { ...draft, assignments: [{ workspaceId: studio, policy: none }] }),
      'conflict', 'operation_payload_conflict', 'a retry asking for other assignments conflicts');
    assert.deepEqual(await counts(), before, 'a conflicting retry writes nothing');
  });

  await t.test('VIEW-03: concurrent submissions of one draft make exactly one resource', async () => {
    const before = await counts();
    const once = agentDraft({ type: 'user', id: alice }, [{ workspaceId: studio, policy: none }]);
    const results = await Promise.all(Array.from({ length: 5 }, () => createAndAssignWorkforceResource(pool, ctx(alice), once)));
    assert.equal(new Set(results.map((r) => r.resource.id)).size, 1, 'concurrent submissions of one draft make one resource');
    assert.equal(new Set(results.map((r) => r.assignments[0].assignmentId)).size, 1, 'and one assignment');
    assert.deepEqual(results.map((r) => r.replayed).sort(), [false, true, true, true, true], 'one made it; the rest observed it');
    const after = await counts();
    assert.equal(after.workforce_resources - before.workforce_resources, 1);
    assert.equal(after.workforce_workspace_assignments - before.workforce_workspace_assignments, 1);
  });

  await t.test('VIEW-03: a failure anywhere in the command leaves nothing behind, so the retained draft resubmits cleanly', async () => {
    // Three different failure points, each after something has already been written in the transaction.
    const failures = [
      ['an archived target', [{ workspaceId: studio, policy: none }, { workspaceId: archived, policy: none }], 'denied', 'assignment_target_unavailable'],
      ['an unknown target', [{ workspaceId: studio, policy: none }, { workspaceId: randomUUID(), policy: none }], 'denied', 'assignment_target_unavailable'],
      // The database refuses this one AFTER the resource, its version, its receipt and the first assignment are
    // written: 'all' passes the request's shape check, and the assignment table's own policy grammar refuses it.
    ['a policy the database refuses', [{ workspaceId: studio, policy: none }, { workspaceId: partner, policy: explicit(['all']) }], 'bad_input', 'invalid_assignment_policy'],
    ];
    for (const [label, assignments, code, reason] of failures) {
      const before = await counts();
      const refused = agentDraft({ type: 'user', id: alice }, assignments);
      const outcome = await createAndAssignWorkforceResource(pool, ctx(alice), refused).then((r) => r, (e) => e);
      // The defect this rules out succeeds rather than fails: it commits the creation and drops the refused
      // assignment, leaving a resource in fewer workspaces than asked. So the rows are checked FIRST, whatever the
      // command returned -- a partial success is caught here, not by a missing rejection further down.
      assert.deepEqual(await counts(), before, 'a refused assignment leaves nothing behind');
      assert.ok(outcome instanceof Error && outcome.code === code && outcome.details?.reason === reason, `${label} is refused`);
      // The draft is intact client-side; resubmitted under the SAME id once corrected, it succeeds -- nothing of the
      // failed attempt collides with it.
      const fixed = await createAndAssignWorkforceResource(pool, ctx(alice), { ...refused, assignments: [{ workspaceId: studio, policy: none }] });
      assert.deepEqual([fixed.replayed, fixed.assignments.length], [false, 1], `the same draft resubmits cleanly after ${label}`);
    }
    // A creator who may not manage the owner is refused before anything is written.
    const before = await counts();
    await rejects(createAndAssignWorkforceResource(pool, ctx(carol), agentDraft({ type: 'user', id: alice }, [{ workspaceId: studio, policy: none }])),
      'denied', null, 'a creator who may not manage the owner is refused');
    assert.deepEqual(await counts(), before, 'a refused assignment leaves nothing behind');
  });

  await t.test('VIEW-03: a team is created and assigned with its explicit approved member set (ASN-05)', async () => {
    // A team's source approval is refused by the database without an explicit member set, so a command that skipped
    // capturing one fails outright -- the assertion is that the command SUCCEEDS, which it can only do with the set.
    const team = await createAndAssignWorkforceResource(pool, ctx(alice), { operationId: randomUUID(), owner: { type: 'workspace', id: studio },
      kind: 'team', name: `${marker} crew`, assignments: [{ workspaceId: studio, policy: none }] })
      .catch((e) => assert.fail(`a team is assigned with its approved member set: ${e.message}`));
    const a = team.assignments[0];
    assert.equal(a.state, 'accepted');
    const set = (await pool.query('SELECT member_count FROM workforce_assignment_member_sets WHERE assignment_id=$1 AND snapshot_revision=1', [a.assignmentId])).rows[0];
    assert.deepEqual(set, { member_count: 0 }, 'a team is assigned with its approved member set');
  });

  await t.test('VIEW-03: the database holds the binding -- a receipt records only the assignments its own command made', async () => {
    // An assignment some OTHER act made, of the same resource into the same workspace, cannot be attached afterwards.
    const plain = await createWorkforceResource(pool, ctx(alice), agentDraft({ type: 'user', id: alice }));
    const rev = (await pool.query('SELECT revision FROM workforce_resources WHERE id=$1', [plain.resource.id])).rows[0].revision;
    const later = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_user_id,resource_revision,created_by_user_id,policy)
      VALUES($1,'agent',$2,$3,$4,$3,$5) RETURNING id`, [plain.resource.id, studio, alice, rev, none])).rows[0].id;
    await assert.rejects(pool.query(`INSERT INTO workforce_resource_operation_assignments(actor_user_id,client_id,operation_id,position,assignment_id,workspace_id)
      VALUES($1,'xeno-agent-interface',$2,0,$3,$4)`, [alice, plain.operation.operationId, later, studio]),
    (e) => e.code === '23514', 'a creation records only the assignments it made');
    await assert.rejects(pool.query('DELETE FROM workforce_resource_operation_assignments WHERE assignment_id=$1', [made.assignments[0].assignmentId]),
      (e) => e.code === '23514', 'a creation\'s assignment record is retained');
  });

  await t.test('VIEW-03: a plain create is untouched -- its reply and its receipt are exactly what they were', async () => {
    const plain = await createWorkforceResource(pool, ctx(alice), agentDraft({ type: 'user', id: alice }));
    assert.deepEqual(Object.keys(plain).sort(), ['operation', 'replayed', 'resource', 'resourceAccess', 'state', 'version'],
      'a plain create replies in the shape shipped clients parse strictly');
    assert.equal(hash(JSON.stringify(plain.operation.owner)), hash(JSON.stringify({ type: 'user', id: alice })));
  });
});
