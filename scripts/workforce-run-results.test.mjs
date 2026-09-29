/**
 * XENO-WORKFORCE-01 RUN-04 -- a child's result, its explicit interruption, and its delivery to its parent.
 *
 *   RUN-04: "Children inherit a subset of the parent's authorized context, not all memberships or
 *            credentials. Persist parent/task/session IDs, results, artifacts, delivery receipts and
 *            explicit interrupted state. Result delivery is idempotent to the correct parent."
 *
 * Runs on the migrated schema (TEST_DATABASE_URL) against services/workforceRunResults.js,
 * services/workforceRunAdmission.js and 20260927120000-workforce-run-results.sql, with real admissions,
 * revocations and a real project root binding.
 *
 * Each clause is its own case, and each is asserted against the wrong implementation it rules out:
 *   subset          a child naming a root its parent did not have
 *   persisted ids   a child's task and session lost, or only its parent kept
 *   results         a second report overwriting the first; artifact content stored instead of a reference
 *   interrupted     a stopped child reading as `running` forever, or as having finished
 *   idempotent      a retried delivery writing a second receipt
 *   correct parent  a result delivered to a run that is not the child's parent
 *
 * Mutation-checked 2026-09-27, each fails the named assertion; restored passes:
 *   - a child may name a root its parent did not have     -> "a child works in its parent's root, or in none"
 *   - the task reference is not recorded                  -> "parent, task and session ids are recorded together"
 *   - a changed report replaces the first                 -> "a result is reported once; a different one conflicts"
 *   - a stopped child with no report reads as running     -> "a stopped child reads as interrupted, never as running"
 *   - delivery ignores the fence                          -> "the parent is told the child was interrupted, and why"
 *   - a retry is reported as a fresh delivery             -> "delivery is idempotent: a retry returns the same receipt"
 *   - the database keys deliveries other than by child    -> "a child is delivered at most once"
 *   - the service delivers to any parent asked for        -> "a result is delivered only to the child's own parent"
 *   - the database accepts a delivery to another parent   -> "no writer can deliver to another run's parent"
 *   - a late report is accepted after delivery            -> "a delivered run takes no late report"
 *   - another principal may report                        -> "only the admitted actor reports on its run"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;

test('a child run reports once, is delivered once, to its own parent (RUN-04)', { skip: !url, timeout: 120000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(() => pool.end());
  assert.ok((await pool.query("SELECT to_regclass('workforce_run_results') AS v")).rows[0].v, 'this suite runs on the migrated schema');
  const { admitRun } = await import('../src/server/services/workforceRunAdmission.js');
  const { revokeRun } = await import('../src/server/services/workforceRunAuthority.js');
  const { reportRunResult, deliverRunResult, readRunOutcome } = await import('../src/server/services/workforceRunResults.js');

  const marker = `res-${randomUUID().slice(0, 8)}`;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const explicit = (caps) => ({ schemaVersion: 1, mode: 'explicit', capabilities: caps });
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$1,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const ctx = (actorUserId) => ({ actorUserId, clientId: 'xeno-agent-interface' });
  const rejects = (p, code, reason, message) => assert.rejects(p, (e) => e.code === code && e.details?.reason === reason, message);

  const owner = await user('owner'), editor = await user('editor'), lenderOwner = await user('lender');
  await pool.query('INSERT INTO credit_accounts(user_id,balance) VALUES($1,50000000),($2,50000000)', [owner, editor]);
  // Admission's budget term reads eligible credit_grants lots (utils/usageCreditFunding.js
  // allocateFunding), not the cached credit_accounts.balance alone -- fund a real paid lot +
  // overflow-on per payer, idempotently (deterministic grant id, replace not accumulate).
  for (const u of [owner, editor]) {
    await pool.query(`INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)
      ON CONFLICT (user_id) DO UPDATE SET enabled=true`, [u]);
    await pool.query(`INSERT INTO credit_grants(id,user_id,amount_micro,remaining_micro,kind,source_ref)
      VALUES(md5('test-fund:'||$1::text)::uuid,$1::uuid,50000000,50000000,'paid','test-fund')
      ON CONFLICT (id) DO UPDATE SET amount_micro=EXCLUDED.amount_micro, remaining_micro=EXCLUDED.remaining_micro`, [u]);
  }
  const ws = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-ws`])).rows[0].id;
  const lender = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [lenderOwner, `${marker}-l`])).rows[0].id;
  for (const [rel, u] of [['owner', owner], ['editor', editor]]) {
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,$2,'user',$3)`, [ws, rel, u]);
  }
  const agent = randomUUID();
  await pool.query(`INSERT INTO workforce_resources(id,kind,owner_workspace_id,name) VALUES($1,'agent',$2,'Crew')`, [agent, lender]);
  await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)`,
    [agent, { instructions: 'Crew', skills: [], requestedCapabilities: ['files.read'], secretReferences: [] }, hash(`${agent}:1`)]);
  const rev = (await pool.query('SELECT revision FROM workforce_resources WHERE id=$1', [agent])).rows[0].revision;
  const assignment = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,resource_revision,policy)
    VALUES($1,'agent',$2,$3,$4,$5) RETURNING id`, [agent, ws, lender, rev, explicit(['files.read'])])).rows[0].id;
  await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted', revision=revision+1, source_approved_by_user_id=$2, source_approved_at=clock_timestamp(),
    target_accepted_by_user_id=$2, accepted_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [assignment, owner]);
  // A project in the workspace, with two host roots: the parent's, and another on a different host.
  const project = (await pool.query('INSERT INTO chat_projects(workspace_id,name) VALUES($1,$2) RETURNING id', [ws, `${marker}-p`])).rows[0].id;
  const participation = (await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,workspace_id,assignment_id,responsibility,policy)
    VALUES($1,'agent',$2,'workspace',$3,$4,'reviewer',$5) RETURNING id`, [agent, project, ws, assignment, explicit(['files.read'])])).rows[0].id;
  const hostA = 'A'.repeat(43), hostB = 'B'.repeat(43);
  const bind = async (host, root) => (await pool.query(`INSERT INTO project_directory_bindings(project_id,host_installation_id,host_owner_user_id,host_client_id,root_family,canonical_root)
    VALUES($1,$2,$3,'xeno-agent-interface','posix',$4) RETURNING id`, [project, host, editor, root])).rows[0].id;
  const rootA = await bind(hostA, '/work/repo'), rootB = await bind(hostB, '/work/other');
  const conversation = (await pool.query(`INSERT INTO chat_conversations(title,project_id,created_by_user_id) VALUES('t',$1,$2) RETURNING id`, [project, editor])).rows[0].id;

  const target = { kind: 'project', projectId: project, participationId: participation };
  const admit = async ({ parent, taskRef, root, ceiling = 100_000, actor = editor } = {}) => (await admitRun(pool, ctx(actor), {
    operationId: randomUUID(), agent: { resourceId: agent, version: 1, contentHash: hash(`${agent}:1`) }, target,
    capabilities: ['files.read'], budget: { ceilingMicro: String(ceiling) }, conversationId: conversation,
    ...(root ? { root } : {}), ...(parent ? { parent: { admissionId: parent } } : {}), ...(taskRef ? { taskRef } : {}) })).admission;
  const report = (admissionId, body, actor = editor) => reportRunResult(pool, ctx(actor), { admissionId, ...body });
  const deliver = (childAdmissionId, parentAdmissionId, actor = editor) => deliverRunResult(pool, ctx(actor), { childAdmissionId, parentAdmissionId });
  const outcome = (admissionId, actor = editor) => readRunOutcome(pool, ctx(actor), { admissionId });

  const parent = await admit({ ceiling: 5_000_000, taskRef: 'goal-1:task-root', root: { bindingId: rootA, installationId: hostA } });

  await t.test('RUN-04: a child inherits a subset of its parent\'s context -- its root among it, or none', async () => {
    const inRoot = await admit({ parent: parent.admissionId, root: { bindingId: rootA, installationId: hostA } });
    assert.equal(inRoot.root.bindingId, rootA, 'a child may work in its parent\'s root');
    const rootless = await admit({ parent: parent.admissionId });
    assert.equal(rootless.root, null, 'or in none');
    await rejects(admit({ parent: parent.admissionId, root: { bindingId: rootB, installationId: hostB } }), 'conflict', 'child_outside_parent_root',
      'a child works in its parent\'s root, or in none');
    // No writer can record it either: the database holds the same rule.
    await assert.rejects(pool.query(`INSERT INTO workforce_run_admissions(actor_user_id,client_id,operation_id,request_hash,incarnation_hash,
        agent_resource_id,agent_version,agent_content_hash,target_kind,target_workspace_id,project_id,assignment_id,assignment_revision,participation_id,participation_revision,
        conversation_id,root_binding_id,root_binding_revision,host_installation_id,payer_kind,payer_user_id,budget_ceiling_micro,requested_capabilities,effective_capabilities,
        rights,memory_namespace,parent_admission_id,nesting_depth)
      SELECT actor_user_id,client_id,$2,request_hash,incarnation_hash,agent_resource_id,agent_version,agent_content_hash,target_kind,target_workspace_id,project_id,
        assignment_id,assignment_revision,participation_id,participation_revision,conversation_id,$3,1,$4,payer_kind,payer_user_id,1,requested_capabilities,
        effective_capabilities,rights,memory_namespace,parent_admission_id,nesting_depth FROM workforce_run_admissions WHERE id=$1`,
    [rootless.admissionId, randomUUID(), rootB, hostB]), (e) => e.code === '23514', 'a child works in its parent\'s root, or in none');
  });

  let child;
  await t.test('RUN-04: parent, task and session ids are persisted with the run', async () => {
    child = await admit({ parent: parent.admissionId, taskRef: 'goal-1:task-7' });
    assert.equal(child.taskRef, 'goal-1:task-7', 'parent, task and session ids are recorded together');
    const o = await outcome(child.admissionId);
    assert.deepEqual([o.parentAdmissionId, o.taskRef, o.conversationId], [parent.admissionId, 'goal-1:task-7', conversation],
      'parent, task and session ids are recorded together');
    assert.equal(o.state, 'running', 'a live run with no report is running');
    await rejects(admit({ parent: parent.admissionId, taskRef: 'has spaces' }), 'bad_input', 'invalid_task_ref', 'a task reference is an opaque id');
  });

  await t.test('RUN-04: a result and its artifact references are persisted, once', async () => {
    const body = { outcome: 'completed', summary: 'Added the parser and its tests.',
      artifacts: [{ name: 'diff', ref: 'artifact:diff-42', sha256: 'a'.repeat(64) }, { name: 'log', ref: 'https://example.test/log/42' }] };
    const first = await report(child.admissionId, body);
    assert.equal(first.replayed, false);
    assert.deepEqual(first.result.artifacts, body.artifacts, 'artifacts are persisted as references');
    const again = await report(child.admissionId, body);
    assert.deepEqual([again.replayed, again.result.reportedAt], [true, first.result.reportedAt], 'the same report returns the same record');
    await rejects(report(child.admissionId, { ...body, outcome: 'failed' }), 'conflict', 'result_already_reported',
      'a result is reported once; a different one conflicts');
    assert.equal((await outcome(child.admissionId)).result.outcome, 'completed');
    // A reference is a locator, not the artifact: content-shaped input is refused.
    await rejects(report(child.admissionId, { outcome: 'completed', artifacts: [{ name: 'x', ref: 'line one\nline two' }] }), 'bad_input', 'invalid_artifact_ref',
      'an artifact is a reference, never its content');
    await assert.rejects(pool.query('UPDATE workforce_run_results SET summary=$2 WHERE admission_id=$1', [child.admissionId, 'rewritten']),
      (e) => e.code === '23514', 'a result is immutable');
  });

  await t.test('RUN-04: result delivery is idempotent, to the correct parent only', async () => {
    const other = await admit({ ceiling: 1_000_000 });
    await rejects(deliver(child.admissionId, other.admissionId), 'conflict', 'not_this_runs_parent',
      'a result is delivered only to the child\'s own parent');
    await rejects(deliver(parent.admissionId, other.admissionId), 'conflict', 'run_has_no_parent', 'a root run has no parent to deliver to');
    const first = await deliver(child.admissionId, parent.admissionId);
    assert.deepEqual([first.replayed, first.delivery.parentAdmissionId, first.delivery.outcome], [false, parent.admissionId, 'completed']);
    const again = await deliver(child.admissionId, parent.admissionId);
    assert.deepEqual([again.replayed, again.delivery.deliveredAt], [true, first.delivery.deliveredAt], 'delivery is idempotent: a retry returns the same receipt');
    // Held twice: the service returns the first receipt, and the child is the table's key, so no writer can
    // add a second. The mutation list names each layer separately.
    const receipts = (await pool.query('SELECT count(*)::int AS n FROM workforce_run_result_deliveries WHERE child_admission_id=$1', [child.admissionId])).rows[0].n;
    assert.equal(receipts, 1, 'delivery is idempotent: a retry returns the same receipt');
    assert.deepEqual((await outcome(parent.admissionId)).children.find((c) => c.admissionId === child.admissionId), { admissionId: child.admissionId, delivered: true });
    // No writer can deliver to another parent, or deliver twice.
    const sibling = await admit({ parent: parent.admissionId });
    await report(sibling.admissionId, { outcome: 'failed', summary: 'tests red' });
    await assert.rejects(pool.query(`INSERT INTO workforce_run_result_deliveries(child_admission_id,parent_admission_id,delivered_outcome)
      VALUES($1,$2,'failed')`, [sibling.admissionId, other.admissionId]), (e) => e.code === '23514', 'no writer can deliver to another run\'s parent');
    await assert.rejects(pool.query(`INSERT INTO workforce_run_result_deliveries(child_admission_id,parent_admission_id,delivered_outcome)
      VALUES($1,$2,'completed')`, [sibling.admissionId, parent.admissionId]), (e) => e.code === '23514', 'a delivery carries the result that was reported');
    await assert.rejects(pool.query(`INSERT INTO workforce_run_result_deliveries(child_admission_id,parent_admission_id,delivered_outcome)
      VALUES($1,$2,'completed')`, [child.admissionId, parent.admissionId]), (e) => e.code === '23505', 'a child is delivered at most once');
  });

  await t.test('RUN-04: interrupted state is explicit -- reported, or derived from a stop, never "running" forever', async () => {
    // Reported: the runtime says it stopped, and why.
    const reported = await admit({ parent: parent.admissionId });
    await report(reported.admissionId, { outcome: 'interrupted', interruptedReason: 'budget_exhausted', summary: 'ceiling reached' });
    assert.equal((await deliver(reported.admissionId, parent.admissionId)).delivery.interruptedReason, 'budget_exhausted');
    await rejects(report(reported.admissionId, { outcome: 'interrupted' }), 'bad_input', 'interrupted_reason_mismatch', 'an interruption carries its reason');

    // Unreported: the child was stopped and never said so. It is interrupted, not running and not done.
    const silent = await admit({ parent: parent.admissionId });
    await rejects(deliver(silent.admissionId, parent.admissionId), 'conflict', 'result_not_ready', 'a live run with no report has nothing to deliver yet');
    await revokeRun(pool, ctx(editor), silent.admissionId);
    const read = await outcome(silent.admissionId);
    assert.equal(read.state, 'interrupted', 'a stopped child reads as interrupted, never as running');
    assert.deepEqual(read.interruption, { reason: 'stopped', derivedFrom: 'fence', fencedByAdmissionId: silent.admissionId });
    const delivered = await deliver(silent.admissionId, parent.admissionId);
    assert.deepEqual([delivered.delivery.outcome, delivered.delivery.interruptedReason], ['interrupted', 'stopped'],
      'the parent is told the child was interrupted, and why');
    // What the parent consumed is what the record says: no late report can change it.
    await rejects(report(silent.admissionId, { outcome: 'completed', summary: 'actually finished' }), 'conflict', 'result_already_delivered',
      'a delivered run takes no late report');

    // A child fenced because its PARENT stopped is interrupted too, and names the run that fenced it.
    const mid = await admit({ parent: parent.admissionId, ceiling: 200_000 });
    const leaf = await admit({ parent: mid.admissionId, ceiling: 100_000 });
    await revokeRun(pool, ctx(editor), mid.admissionId);
    const leafRead = await outcome(leaf.admissionId);
    assert.deepEqual([leafRead.state, leafRead.interruption.fencedByAdmissionId], ['interrupted', mid.admissionId],
      'a child stopped by its parent\'s stop is interrupted, naming the stop');
    assert.equal((await deliver(leaf.admissionId, mid.admissionId)).delivery.outcome, 'interrupted', 'and it is delivered as such');
  });

  await t.test('RUN-04: only the admitted actor reports on or delivers its run', async () => {
    const run = await admit({ parent: parent.admissionId });
    await rejects(report(run.admissionId, { outcome: 'completed' }, owner), 'not_found', 'admission_not_found', 'only the admitted actor reports on its run');
    await rejects(deliver(run.admissionId, parent.admissionId, owner), 'not_found', 'admission_not_found', 'only the admitted actor delivers it');
    await rejects(outcome(run.admissionId, owner), 'not_found', 'admission_not_found');
    await rejects(report(randomUUID(), { outcome: 'completed' }), 'not_found', 'admission_not_found');
  });
});
