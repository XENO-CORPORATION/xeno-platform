/**
 * XENO-WORKFORCE-01 LIFE-02 -- removal is REVOCATION plus SETTLEMENT, and the two are separate.
 *
 *   LIFE-02: "Revoking eligibility is immediate (ASN-05 'removals revoke eligibility promptly'); settling
 *            what the principal was doing is not. In-flight runs reach a durable resumable state (RUN-07),
 *            reservations settle or release (RUN-10), and only then is the membership archived. A removal
 *            that silently cancels funded work, or silently lets it continue, are both defects."
 *
 * The spec's own test groups for this are T99-T101: a principal "is removed with runs in flight; is removed
 * with a funded reservation open ... removal revokes eligibility immediately while settlement completes
 * separately (LIFE-02) -- a removal that silently cancels funded work AND one that silently lets it
 * continue must both fail this group." Both wrong implementations are asserted against, each by name.
 *
 * Runs on the migrated schema (TEST_DATABASE_URL) against services/workforceMemberRemoval.js and
 * 20260927130000-workforce-member-removal.sql, with a real team, real admitted runs (one with a child),
 * real signed leases, and real results and deliveries.
 *
 * Mutation-checked 2026-09-27, each fails the named assertion; restored passes:
 *   - revoking a seat does not fence its runs              -> "eligibility is revoked at once, not on the next step"
 *   - the fence covers only the seat's own admissions      -> "the agent's work is fenced when its seat is removed"
 *   - a fenced run is also ended: its results are voided   -> "the work is not cancelled silently: it reads as interrupted"
 *   - settlement ignores a live lease                      -> "a run inside a live lease is not settled"
 *   - settlement ignores an unreported run                 -> "an unreported run is not settled"
 *   - the service archives with unsettled runs             -> "archival waits for settlement"
 *   - the database archives with unsettled runs            -> "no writer archives a removal before settlement"
 *   - a removal needs no decision                          -> "a removal is decided, by name"
 *   - a manager may remove itself                          -> "a manager does not remove itself"
 *   - a worker may remove a member                         -> "a worker does not remove members"
 *   - a run may be admitted under a revoked seat           -> "no writer admits a run under a removed seat"
 *   - the teams page revokes without fencing               -> "a seat revoked by any writer fences its work"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, generateKeyPairSync } from 'node:crypto';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;

test('a removal revokes at once and settles separately (LIFE-02)', { skip: !url, timeout: 120000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(() => pool.end());
  assert.ok((await pool.query("SELECT to_regclass('workforce_membership_removals') AS v")).rows[0].v, 'this suite runs on the migrated schema');
  const { admitRun } = await import('../src/server/services/workforceRunAdmission.js');
  const { authorizeRunStep, readRunAuthority } = await import('../src/server/services/workforceRunAuthority.js');
  const { reportRunResult, deliverRunResult, readRunOutcome } = await import('../src/server/services/workforceRunResults.js');
  const { removeTeamMember, readMemberRemoval, archiveMemberRemoval } = await import('../src/server/services/workforceMemberRemoval.js');
  const { saveWorkspaceTeam } = await import('../src/server/services/workspaceTeams.js');

  // An ephemeral signing key for this suite only -- never a machine or operator credential.
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signingKey = { kid: 'removal-test', privatePem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const marker = `rm-${randomUUID().slice(0, 8)}`;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const explicit = (caps) => ({ schemaVersion: 1, mode: 'explicit', capabilities: caps });
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$1,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const ctx = (actorUserId) => ({ actorUserId, clientId: 'xeno-agent-interface' });
  const rejects = (p, code, reason, message) => assert.rejects(p, (e) => e.code === code && e.details?.reason === reason, message);
  const dbRejects = (p, message) => assert.rejects(p, (e) => e.code === '23514', message);
  const tuple = (object, rel, u, type = 'workspace') => pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
    VALUES($1,$2,$3,'user',$4)`, [type, object, rel, u]);

  const owner = await user('owner'), manager = await user('manager'), worker = await user('worker'), stranger = await user('stranger');
  await pool.query('INSERT INTO credit_accounts(user_id,balance) VALUES($1,90000000),($2,90000000),($3,90000000)', [owner, manager, worker]);
  const ws = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-ws`])).rows[0].id;
  await tuple(ws, 'owner', owner); await tuple(ws, 'editor', manager); await tuple(ws, 'editor', worker);

  // A team of three seats -- a manager, a worker, and the agent both of them run -- self-assigned into its
  // workspace with an approved member set, the shape workspaceTeams writes.
  const team = (await pool.query(`INSERT INTO workforce_resources(kind,owner_workspace_id,name) VALUES('team',$1,$2) RETURNING id`, [ws, `${marker}-crew`])).rows[0].id;
  const agentOf = async (name) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO workforce_resources(id,kind,owner_workspace_id,name) VALUES($1,'agent',$2,$3)`, [id, ws, `${marker}-${name}`]);
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)`,
      [id, { instructions: name, skills: [], requestedCapabilities: ['files.read'], secretReferences: [] }, hash(`${id}:1`)]);
    return id;
  };
  const agent = await agentOf('crewagent');
  const seat = async (sql, values) => (await pool.query(sql, values)).rows[0].id;
  const agentSeat = await seat(`INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,role) VALUES($1,$2,'agent','worker') RETURNING id`, [team, agent]);
  const managerSeat = await seat(`INSERT INTO workforce_team_memberships(team_id,member_principal_id,role) VALUES($1,$2,'manager') RETURNING id`, [team, manager]);
  const workerSeat = await seat(`INSERT INTO workforce_team_memberships(team_id,member_principal_id,role) VALUES($1,$2,'worker') RETURNING id`, [team, worker]);
  const rev = (await pool.query('SELECT revision, team_membership_revision FROM workforce_resources WHERE id=$1', [team])).rows[0];
  const assignment = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,resource_revision,policy,member_set_revision)
    VALUES($1,'team',$2,$2,$3,$4,1) RETURNING id`, [team, ws, rev.revision, explicit(['files.read'])])).rows[0].id;
  const seats = (await pool.query("SELECT id, revision, role FROM workforce_team_memberships WHERE team_id=$1 AND state='active' ORDER BY id", [team])).rows;
  await pool.query(`INSERT INTO workforce_assignment_member_sets(assignment_id,snapshot_revision,team_id,workspace_id,team_membership_revision,member_count)
    VALUES($1,1,$2,$3,$4,$5)`, [assignment, team, ws, rev.team_membership_revision, seats.length]);
  for (const s of seats) await pool.query(`INSERT INTO workforce_assignment_members(assignment_id,snapshot_revision,team_id,membership_id,membership_revision,role)
    VALUES($1,1,$2,$3,$4,$5)`, [assignment, team, s.id, s.revision, s.role]);
  await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted', revision=revision+1, source_approved_by_user_id=$2, source_approved_at=clock_timestamp(),
    target_accepted_by_user_id=$2, accepted_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [assignment, owner]);

  const admit = async (actor, ceiling, parent) => (await admitRun(pool, ctx(actor), { operationId: randomUUID(),
    agent: { resourceId: agent, version: 1, contentHash: hash(`${agent}:1`) }, target: { kind: 'workspace', assignmentId: assignment },
    team: { teamId: team }, capabilities: ['files.read'], budget: { ceilingMicro: String(ceiling) },
    ...(parent ? { parent: { admissionId: parent } } : {}) })).admission.admissionId;
  const step = (actor, admissionId) => authorizeRunStep(pool, ctx(actor), { admissionId, operation: 'provider_dispatch' }, { signingKey });
  const remove = (actor, membershipId, operationId = randomUUID(), rationale = 'left the project') =>
    removeTeamMember(pool, ctx(actor), { operationId, membershipId, rationale });
  const committed = async () => (await pool.query(`SELECT committed_ceiling_micro::text AS c FROM workforce_scope_capacity
    WHERE scope_type='workspace' AND scope_id=$1`, [ws])).rows[0]?.c ?? '0';
  const fencedAmong = async (ids) => (await pool.query('SELECT admission_id FROM workforce_run_revocations WHERE admission_id = ANY($1) ORDER BY admission_id',
    [ids])).rows.map((x) => x.admission_id);

  // The worker has work in flight: a funded run inside a live lease, with a child it spawned. The manager
  // has a run of its own, which a removal of the worker must leave alone.
  const run = await admit(worker, 2_000_000);
  // Its lease is a real signed lease, issued with twenty seconds of its sixty left, so the suite can watch
  // it lapse in real time rather than editing an immutable row.
  await authorizeRunStep(pool, ctx(worker), { admissionId: run, operation: 'provider_dispatch' }, { signingKey, now: () => Date.now() - 40_000 });
  const child = await admit(worker, 500_000, run);
  const other = await admit(manager, 1_000_000);
  assert.equal(await committed(), '3000000', 'both root runs are committed before the removal');

  let decisionOperation;
  await t.test('LIFE-02: removal is a decided act, and only a manager or an administrator may take it', async () => {
    await rejects(remove(stranger, workerSeat), 'not_found', 'membership_not_found', 'a stranger cannot remove, and learns nothing');
    await rejects(remove(worker, agentSeat), 'not_found', 'membership_not_found', 'a worker does not remove members');
    await rejects(remove(manager, managerSeat), 'denied', 'manager_cannot_remove_itself', 'a manager does not remove itself');
    assert.deepEqual(await fencedAmong([run, child, other]), [], 'a refused removal fences nothing');
    decisionOperation = randomUUID();
    const removed = await remove(manager, workerSeat, decisionOperation);
    assert.equal(removed.replayed, false);
    const replay = await remove(manager, workerSeat, decisionOperation);
    assert.deepEqual([replay.replayed, replay.removal.removedAt], [true, removed.removal.removedAt], 'a retry returns the same removal');
    await rejects(remove(manager, workerSeat, decisionOperation, 'a different reason'), 'conflict', 'operation_payload_conflict',
      'a retry cannot change the recorded reason');

    const decision = (await pool.query(`SELECT decided, subject_type, subject_id, deciding_principal_id, responsible_account_id, authority, rationale
      FROM workforce_decision_records WHERE operation_id=$1`, [decisionOperation])).rows[0];
    assert.deepEqual(decision, { decided: 'member.remove', subject_type: 'membership', subject_id: workerSeat, deciding_principal_id: manager,
      responsible_account_id: manager, authority: `team:${team}#manager`, rationale: 'left the project' }, 'a removal is decided, by name');
    // No writer records a removal without a member.remove decision about that very seat. A spare seat,
    // revoked by a bare UPDATE, so the only thing wrong with each attempt is its decision.
    const spare = await user('spare');
    const spareSeat = await seat(`INSERT INTO workforce_team_memberships(team_id,member_principal_id,role) VALUES($1,$2,'observer') RETURNING id`, [team, spare]);
    const decide = async (kind, subject) => {
      const id = randomUUID();
      await pool.query(`INSERT INTO workforce_operations(actor_user_id,client_id,operation_id,request_hash,kind,subject_type,subject_id,
        deciding_principal_id,responsible_account_id,authority) VALUES($1,'xeno-agent-interface',$2,$3,$4,'membership',$5,$1,$1,'test')`,
      [owner, id, hash(id), kind, subject]);
      return id;
    };
    const record = (membershipId, operationId) => pool.query(`INSERT INTO workforce_membership_removals(membership_id,team_id,decision_actor_user_id,
      decision_client_id,decision_operation_id,removed_at) VALUES($1,$2,$3,'xeno-agent-interface',$4,clock_timestamp())`, [membershipId, team, owner, operationId]);
    const forSpare = await decide('member.remove', spareSeat);
    await dbRejects(record(spareSeat, forSpare), 'a removal records a seat that has actually been revoked');
    await pool.query(`UPDATE workforce_team_memberships SET state='revoked', revision=revision+1, revoked_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [spareSeat]);
    await dbRejects(record(spareSeat, await decide('member.promote', spareSeat)), 'a removal is decided, by name');
    await dbRejects(record(spareSeat, await decide('member.remove', agentSeat)), 'a removal is decided, by name');
    await record(spareSeat, forSpare);
  });

  await t.test('LIFE-02: eligibility is revoked at once -- the work is fenced now, not when it next asks', async () => {
    // Nobody has asked for a step since the removal. The fence is already there.
    const fenced = await fencedAmong([run, child, other]);
    assert.ok(fenced.includes(run), 'eligibility is revoked at once, not on the next step');
    assert.ok(!fenced.includes(other), 'another member\'s work is not fenced by this removal');
    assert.ok(!fenced.includes(child), 'the child is fenced by its parent, and says so');
    const authority = await readRunAuthority(pool, ctx(worker), child);
    assert.deepEqual([authority.revoked, authority.reason, authority.fencedByAdmissionId], [true, 'authority_lost', run],
      'the child is fenced by its parent, and says so');
    await rejects(step(worker, run), 'denied', 'admission_revoked', 'the removed member authorizes nothing further');
    await rejects(step(worker, child), 'denied', 'admission_revoked', 'nor does anything it spawned');
    await dbRejects(pool.query(`INSERT INTO workforce_run_leases(admission_id,sequence,operation,effective_capabilities,expires_at,signing_kid,token_hash)
      VALUES($1,2,'provider_dispatch','[]',clock_timestamp()+interval '30 seconds','x',$2)`, [run, hash(randomUUID())]),
    'no writer leases the removed member\'s work');
    assert.equal((await step(manager, other)).lease.sequence, '1', 'another member\'s work is untouched');
    // And nobody can start new work under the removed seat -- not the service, and not a writer that bypasses it.
    await rejects(admit(worker, 100_000), 'denied', 'actor_not_an_admitted_member', 'the removed member admits nothing new');
    await dbRejects(pool.query(`INSERT INTO workforce_run_admissions(actor_user_id,client_id,operation_id,request_hash,incarnation_hash,
        agent_resource_id,agent_version,agent_content_hash,target_kind,target_workspace_id,assignment_id,assignment_revision,
        team_id,team_kind,team_membership_id,team_membership_revision,member_set_revision,team_function,
        payer_kind,payer_user_id,budget_ceiling_micro,requested_capabilities,effective_capabilities,rights,memory_namespace)
      SELECT actor_user_id,client_id,$2,request_hash,incarnation_hash,agent_resource_id,agent_version,agent_content_hash,target_kind,
        target_workspace_id,assignment_id,assignment_revision,team_id,team_kind,team_membership_id,team_membership_revision,member_set_revision,
        team_function,payer_kind,payer_user_id,budget_ceiling_micro,requested_capabilities,effective_capabilities,rights,memory_namespace
      FROM workforce_run_admissions WHERE id=$1`, [run, randomUUID()]), 'no writer admits a run under a removed seat');
  });

  await t.test('LIFE-02: the work is not cancelled silently -- it is interrupted, kept, and still owed', async () => {
    const outcome = await readRunOutcome(pool, ctx(worker), { admissionId: run });
    assert.deepEqual([outcome.state, outcome.interruption?.reason, outcome.children], ['interrupted', 'authority_lost', [{ admissionId: child, delivered: false }]],
      'the work is not cancelled silently: it reads as interrupted');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM workforce_run_leases WHERE admission_id=$1', [run])).rows[0].n, 1,
      'its lease history is kept');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM workforce_run_admissions WHERE id = ANY($1)', [[run, child]])).rows[0].n, 2,
      'and so are the runs themselves');
    // RUN-10: a fenced chain commits no NEW capacity, but its child still holds its carve until it settles.
    assert.equal(await committed(), '1000000', 'the removed member\'s run commits no new capacity');
    const carved = (await pool.query('SELECT coalesce(sum(budget_ceiling_micro),0)::text AS s FROM workforce_run_admissions WHERE parent_admission_id=$1', [run])).rows[0].s;
    assert.equal(carved, '500000', 'the child still holds its sub-reservation');
  });

  await t.test('LIFE-02: settlement is separate, and archival waits for it', async () => {
    let state = await readMemberRemoval(pool, ctx(manager), { membershipId: workerSeat });
    assert.deepEqual(state.runs.map((r) => r.admissionId).sort(), [run, child].sort(), 'the removal names every run it fenced');
    assert.deepEqual(state.decision, { actorUserId: manager, clientId: 'xeno-agent-interface', operationId: decisionOperation });
    const inLease = state.runs.find((r) => r.admissionId === run);
    assert.deepEqual([inLease.fenced, inLease.leaseLive, inLease.settled, inLease.owes], [true, true, false, 'lease_expiry'],
      'a run inside a live lease is not settled');
    assert.equal(state.settled, false);
    await rejects(archiveMemberRemoval(pool, ctx(manager), { membershipId: workerSeat }), 'conflict', 'removal_not_settled', 'archival waits for settlement');
    await dbRejects(pool.query('UPDATE workforce_membership_removals SET archived_at=clock_timestamp(), archived_by_user_id=$2 WHERE membership_id=$1',
      [workerSeat, manager]), 'no writer archives a removal before settlement');

    // The lease lapses, in real time: a disconnected worker may be inside it until then (NFR-06).
    const expires = (await pool.query('SELECT max(expires_at) AS e FROM workforce_run_leases WHERE admission_id=$1', [run])).rows[0].e;
    await new Promise((r) => setTimeout(r, Math.max(0, expires.getTime() - Date.now()) + 750));
    state = await readMemberRemoval(pool, ctx(manager), { membershipId: workerSeat });
    assert.equal(state.runs.find((r) => r.admissionId === run).owes, 'report_or_delivery', 'an unreported run is not settled');
    await rejects(archiveMemberRemoval(pool, ctx(manager), { membershipId: workerSeat }), 'conflict', 'removal_not_settled', 'an unreported run is not settled');
    await dbRejects(pool.query('UPDATE workforce_membership_removals SET archived_at=clock_timestamp() WHERE membership_id=$1', [workerSeat]),
      'no writer archives a removal before settlement');

    // Settlement: the runtime reports the interruption, and the child's outcome reaches its parent.
    await reportRunResult(pool, ctx(worker), { admissionId: run, outcome: 'interrupted', interruptedReason: 'authority_lost', summary: 'member removed mid-task' });
    state = await readMemberRemoval(pool, ctx(manager), { membershipId: workerSeat });
    assert.deepEqual(state.runs.filter((r) => !r.settled).map((r) => r.admissionId), [child], 'one run accounted for, one still owed');
    await deliverRunResult(pool, ctx(worker), { childAdmissionId: child, parentAdmissionId: run });
    state = await readMemberRemoval(pool, ctx(manager), { membershipId: workerSeat });
    assert.equal(state.settled, true, 'settled once every run is fenced, out of its lease, and accounted for');
    const archived = await archiveMemberRemoval(pool, ctx(manager), { membershipId: workerSeat });
    assert.ok(archived.removal.archivedAt, 'only then is the membership archived');
    assert.equal((await archiveMemberRemoval(pool, ctx(manager), { membershipId: workerSeat })).replayed, true, 'archival is idempotent');
    await dbRejects(pool.query('UPDATE workforce_membership_removals SET archived_at=clock_timestamp() WHERE membership_id=$1', [workerSeat]),
      'a removal is archived once');
    await dbRejects(pool.query('DELETE FROM workforce_membership_removals WHERE membership_id=$1', [workerSeat]), 'a removal is retained');
  });

  await t.test('LIFE-02: removing the agent\'s seat stops the agent, and an administrator may remove a manager', async () => {
    const managerRun = await admit(manager, 300_000);
    await step(manager, managerRun);
    await removeTeamMember(pool, ctx(owner), { operationId: randomUUID(), membershipId: agentSeat, rationale: 'agent retired' });
    assert.deepEqual(await fencedAmong([managerRun, other]), [other, managerRun].sort(), 'the agent\'s work is fenced when its seat is removed');
    const state = await readMemberRemoval(pool, ctx(owner), { membershipId: agentSeat });
    assert.deepEqual(state.runs.map((r) => r.admissionId).sort(), [other, managerRun, run, child].sort(),
      'the agent\'s removal names all the work the agent was doing, whoever admitted it');
    const admin = await removeTeamMember(pool, ctx(owner), { operationId: randomUUID(), membershipId: managerSeat, rationale: 'reorganised' });
    assert.equal(admin.replayed, false, 'a workspace administrator removes a manager');
    await rejects(remove(owner, managerSeat), 'conflict', 'membership_not_active', 'a removed membership is removed once');
  });

  await t.test('LIFE-02: a seat revoked by ANY writer fences its work -- the teams page included', async () => {
    // The workspace teams page revokes an agent's seat when the owner takes it off a team. It writes no
    // decision -- the page has its own audit row -- but the work that seat was doing must stop all the same.
    const agentUser = await user('page-agent');
    await pool.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role,agent_origin) VALUES($1,$2,'other','life02-fixture')", [agentUser, owner]);
    const saved = await saveWorkspaceTeam(pool, { workspaceId: ws, userId: owner, input: { name: `${marker}-page`, description: '', project_ids: [], agent_ids: [agentUser] } });
    const pageTeam = saved.id;
    const pageSeat = (await pool.query("SELECT id FROM workforce_team_memberships WHERE team_id=$1 AND member_principal_id=$2 AND state='active'", [pageTeam, agentUser])).rows[0].id;
    // A run under that seat, written the way admission writes one.
    const pageAgent = await agentOf('page-runner');
    await pool.query(`INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,role) VALUES($1,$2,'agent','worker')`, [pageTeam, pageAgent]);
    const pageAssignment = (await pool.query(`SELECT id, revision FROM workforce_workspace_assignments WHERE resource_id=$1 AND state='accepted'`, [pageTeam])).rows[0];
    const pageRun = (await pool.query(`INSERT INTO workforce_run_admissions(actor_user_id,client_id,operation_id,request_hash,incarnation_hash,
        agent_resource_id,agent_version,agent_content_hash,target_kind,target_workspace_id,assignment_id,assignment_revision,
        team_id,team_kind,team_membership_id,team_membership_revision,member_set_revision,team_function,
        payer_kind,payer_user_id,budget_ceiling_micro,requested_capabilities,effective_capabilities,rights,memory_namespace)
      VALUES($1,'xeno-agent-interface',$2,$3,$3,$4,1,$5,'workspace',$6,$7,$8,$9,'team',$10,1,1,'worker','user',$11,1000,'[]','[]',
        '{"definition":[],"target":[],"runtime":null,"entitlement":null}',$12)
      RETURNING id`, [agentUser, randomUUID(), hash(randomUUID()), pageAgent, hash(`${pageAgent}:1`), ws, pageAssignment.id, pageAssignment.revision,
      pageTeam, pageSeat, owner, `workspace:${ws}:agent:${pageAgent}`])).rows[0].id;
    const version = (await pool.query('SELECT revision FROM workforce_resources WHERE id=$1', [pageTeam])).rows[0].revision;
    await saveWorkspaceTeam(pool, { workspaceId: ws, userId: owner, teamId: pageTeam,
      input: { name: `${marker}-page`, description: '', version: Number(version), project_ids: [], agent_ids: [] } });
    assert.equal((await pool.query('SELECT state FROM workforce_team_memberships WHERE id=$1', [pageSeat])).rows[0].state, 'revoked');
    assert.deepEqual(await fencedAmong([pageRun]), [pageRun], 'a seat revoked by any writer fences its work');
  });
});
