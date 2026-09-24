/**
 * Qualification of 20260905123000-workforce-team-membership-snapshots.sql.
 *
 * This migration was preserved as unqualified WIP: its worker stopped at a
 * checkpoint before any test report, and it was the only migration in the set
 * that nothing exercised. It is also the one that DROPS a shipped constraint --
 * `workforce_assignment_team_admission_pending`, today the only thing preventing
 * a team assignment from ever reaching `accepted` -- and replaces it with trigger
 * logic. A constraint traded for a function is exactly the trade that has to be
 * proven rather than reviewed, so this suite exists to decide whether the
 * replacement is at least as strong. It is not.
 *
 * Scenarios marked KNOWN DEFECT assert the CURRENT behaviour and state the
 * correct behaviour in a comment. They are written that way deliberately: an
 * inverted assertion would leave a red suite indistinguishable from a broken
 * fixture, and the job of qualification is to make each defect reproducible and
 * unmissable, not to make the migration unrunnable. Each one is a failing
 * requirement with a named fix, not an accepted behaviour.
 */
/* ⚠️ NOT CITED HERE, AND WHY.
 *   LIFE-05  ✅ NOW CITED, in workforce-function-change.test.mjs, against
 *            20260924190000-workforce-function-change-is-decided.sql. The gap this note recorded
 *            was real: the row said who CREATED the membership, never who changed its role or why,
 *            and nothing required a `member.promote` record to exist. A role change now carries a
 *            composite reference to the decision it was taken under, and the database refuses the
 *            change without one -- a decision about another membership, of another kind, or already
 *            used for an earlier change is refused too. Cited THERE rather than here because the
 *            decision record is created by the handoff migration, which this suite does not load.
 *            Kept as a correction rather than deleted, like the ROLE-05 note below.
 *   RUN-02   the intersection ROLE-05 defers to. No authorizer computes it; there is no run model.
 *
 * ✅ ROLE-05 ITSELF IS NOW CITED, above, by the promotion census. An earlier version of this note
 * refused it on the grounds that "the claim is about what an authorizer COMPUTES" -- which was
 * true and was the wrong conclusion. A schema cannot show what an authorizer computes, but it CAN
 * show that a promotion wrote no row anywhere, and "grants nothing" is exactly that. Kept as a
 * correction rather than deleted, because the reasoning that nearly lost it generalises. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { requireProofDatabase, workforceProofUnavailable } from './lib/workforce-proof-database.mjs';

test('team membership and admitted member snapshots on owned isolated PostgreSQL', { skip: workforceProofUnavailable() }, async t => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);
  const schema = `workforce_membership_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  const read = f => readFile(new URL(`../src/server/database/migrations/${f}`, import.meta.url), 'utf8');
  const draft = await read('20260905123000-workforce-team-membership-snapshots.sql');
  const [up, down] = draft.split('-- DOWN');

  const owner = randomUUID(), creator = randomUUID(), approver = randomUUID(), human = randomUUID();
  /* One live assignment is permitted per (resource, workspace) pair, so each
   * scenario that proposes for the same team gets its own target workspace.
   * Sharing one and relying on revocation couples the scenarios: a scenario that
   * fails before its cleanup then fails the next one for the wrong reason. */
  const sourceWorkspace = randomUUID(), targetWorkspace = randomUUID();
  const emptySetWorkspace = randomUUID(), snapshotWorkspace = randomUUID(), shadowWorkspace = randomUUID();
  const team = randomUUID(), memberAgent = randomUUID(), loneAgent = randomUUID(), backfilledTeam = randomUUID();
  const policy = { schemaVersion: 1, mode: 'explicit', capabilities: ['files.read'] };
  let createdSchema = false;

  const deny = (sql, values = [], code = '23514') =>
    assert.rejects(pool.query(sql, values), error => error.code === code);
  const addMember = (resource = memberAgent, teamId = team, role = 'worker') => pool.query(
    `INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,role,created_by_user_id)
     VALUES($1,$2,'agent',$3,$4) RETURNING *`, [teamId, resource, role, creator]);
  const teamRevision = async (id = team) =>
    Number((await pool.query('SELECT team_membership_revision r FROM workforce_resources WHERE id=$1', [id])).rows[0].r);
  const propose = async ({ resource = team, kind = 'team', snapshot = 1, workspace = targetWorkspace } = {}) => (await pool.query(
    `INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_user_id,
       resource_revision,created_by_user_id,policy,member_set_revision) VALUES($1,$2,$3,$4,1,$5,$6,$7) RETURNING *`,
    [resource, kind, workspace, owner, creator, policy, snapshot])).rows[0];
  const ACCEPT = `UPDATE workforce_workspace_assignments SET state='accepted',revision=revision+1,
    source_approved_by_user_id=$2,source_approved_at=clock_timestamp(),target_accepted_by_user_id=$2,
    accepted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING *`;
  const REVOKE = `UPDATE workforce_workspace_assignments SET state='revoked',revision=revision+1,
    revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`;
  const describe = (assignmentId, teamId, count, revision, snapshot = 1, workspace = targetWorkspace) => pool.query(
    `INSERT INTO workforce_assignment_member_sets(assignment_id,snapshot_revision,team_id,workspace_id,
       team_membership_revision,member_count,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [assignmentId, snapshot, teamId, workspace, revision, count, creator]);

  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); createdSchema = true;
    await pool.query('CREATE TABLE users(id UUID PRIMARY KEY)');
    for (const id of [owner, creator, approver, human]) await pool.query('INSERT INTO users VALUES($1)', [id]);
    for (const f of ['20260711120000-workspaces.sql', '20260905120000-workforce-resources.sql',
      '20260905122000-workforce-workspace-assignments.sql']) await pool.query((await read(f)).split('-- DOWN')[0]);
    for (const [id, slug] of [[sourceWorkspace, 'source'], [targetWorkspace, 'target'],
      [emptySetWorkspace, 'empty-set'], [snapshotWorkspace, 'snapshot'], [shadowWorkspace, 'shadow']])
      await pool.query('INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,$3,$3)', [id, owner, slug]);
    /* Created BEFORE the draft so the ALTER/UPDATE backfill path is exercised; the
     * trigger path is exercised by the resources created after it. Fixture order
     * silently decides which of the two initialisation paths a test sees. */
    await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'team',$2,'Backfilled')", [backfilledTeam, owner]);

    await t.test('empty rollback and reapply is additive and initialises revisions by both paths', async () => {
      await pool.query(up); await pool.query(down); await pool.query(up);
      assert.equal(await teamRevision(backfilledTeam), 1, 'a pre-existing team is backfilled to revision one');
      await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'team',$2,'Team'),($3,'agent',$2,'Member'),($4,'agent',$2,'Lone')",
        [team, owner, memberAgent, loneAgent]);
      assert.equal(await teamRevision(team), 1, 'a team created after the migration is stamped by the trigger');
      assert.equal((await pool.query('SELECT team_membership_revision r FROM workforce_resources WHERE id=$1', [memberAgent])).rows[0].r, null,
        'an agent never carries a team membership revision');
      assert.equal((await pool.query('SELECT count(*) FROM workforce_team_memberships')).rows[0].count, '0');
    });

    await t.test('an initial revision cannot be dictated and a direct revision bump is refused', async () => {
      await deny("INSERT INTO workforce_resources(id,kind,owner_user_id,name,team_membership_revision) VALUES($1,'team',$2,'Forged',7)", [randomUUID(), owner]);
      await deny('UPDATE workforce_resources SET team_membership_revision=team_membership_revision+1 WHERE id=$1', [team]);
      assert.equal(await teamRevision(team), 1);
    });

    // OWN-04: a membership carries its ROLE and moves the team's REVISION -- the two things the
    // requirement names -- so a reader can tell which generation of the team they are seeing.
    await t.test('membership creation advances the team revision and stamps join and change together (OWN-04)', async () => {
      const before = await teamRevision(team);
      const membership = (await addMember()).rows[0];
      assert.equal(membership.state, 'active'); assert.equal(membership.revision, '1');
      assert.equal(membership.role, 'worker'); assert.equal(membership.created_by_user_id, creator);
      assert.equal(Number(membership.joined_team_revision), before + 1);
      assert.equal(membership.changed_team_revision, membership.joined_team_revision, 'a new member joined and changed at one revision');
      assert.equal(await teamRevision(team), before + 1, 'the team counter and the membership stamp agree');
      await deny(`INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,joined_team_revision)
        VALUES($1,$2,'agent',9)`, [team, loneAgent]);
    });

    await t.test('role is the ROLE-02 team function -- exactly three, and no default (ROLE-01)', async () => {
      // Without these, the CHECK could be deleted and every other assertion here would still pass:
      // the suite only ever writes valid values. A constraint nothing tries to violate is a
      // constraint nobody is verifying.
      // One LIVE membership per member is enforced by `workforce_team_active_resource`, so revoke
      // between attempts rather than adding the same agent three times. The point is that each of
      // the three functions is accepted by a real insert, not that a member can hold them at once.
      for (const fn of ['manager', 'worker', 'observer']) {
        const row = (await addMember(loneAgent, team, fn)).rows[0];
        assert.equal(row.role, fn, `${fn} is accepted`);
        await pool.query(`UPDATE workforce_team_memberships SET state='revoked',revision=revision+1,
          revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`, [row.id]);
      }
      // The value this column used to DEFAULT to. ROLE-02 does not define it, so the database
      // must refuse it rather than leave it as a value nothing could map later.
      await deny(
        `INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,role,created_by_user_id)
         VALUES($1,$2,'agent','member',$3)`, [team, loneAgent, creator]);
      // A PLATFORM role name. ROLE-01 keeps the three axes separate; mixing their vocabularies is
      // how a team function silently reads as an authority grant.
      await deny(
        `INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,role,created_by_user_id)
         VALUES($1,$2,'agent','admin',$3)`, [team, loneAgent, creator]);
      // NOT NULL with no default: an omitted function fails the insert rather than silently
      // picking one, because `manager` carries real authority under ROLE-02.
      await deny(
        `INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,created_by_user_id)
         VALUES($1,$2,'agent',$3)`, [team, loneAgent, creator], '23502');
    });

    // 🔴 ROLE-03 HOLDS ONLY BY THE SHAPE OF AN INDEX, AND NOTHING SAID SO UNTIL NOW.
    // `workforce_team_active_resource` is UNIQUE on (team_id, member_resource_id) -- per TEAM.
    // Drop `team_id` from it, which reads like tightening a uniqueness rule, and a principal
    // becomes admissible to exactly one team ecosystem-wide: §7.4's *"an agent can also belong to
    // multiple teams with contextual roles"* silently becomes false, and every existing case here
    // still passes, because they all operate on one team. A constraint whose CORRECTNESS nothing
    // exercises is a constraint nobody is verifying -- the same reasoning as the case above.
    await t.test('the same principal is a manager in one team and an observer in another (ROLE-03)', async () => {
      const teamA = randomUUID(), teamB = randomUUID(), dualAgent = randomUUID();
      await pool.query(
        "INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'team',$4,'Alpha'),($2,'team',$4,'Beta'),($3,'agent',$4,'Dual')",
        [teamA, teamB, dualAgent, owner]);

      const asManager = (await addMember(dualAgent, teamA, 'manager')).rows[0];
      const asObserver = (await addMember(dualAgent, teamB, 'observer')).rows[0];

      // Both live AT ONCE. Revoking one to add the other would prove the opposite of ROLE-03.
      const live = (await pool.query(
        `SELECT team_id, role FROM workforce_team_memberships
          WHERE member_resource_id=$1 AND state='active' ORDER BY role`, [dualAgent])).rows;
      assert.deepEqual(live, [{ team_id: teamA, role: 'manager' }, { team_id: teamB, role: 'observer' }],
        'two live memberships, two different functions, neither merged into a principal-level role');

      // The functions are independent: demoting the manager leaves the observer untouched. If a
      // function were a property OF THE PRINCIPAL, one write here would move both.
      await pool.query(`UPDATE workforce_team_memberships SET role='worker',revision=revision+1,
        updated_at=clock_timestamp() WHERE id=$1`, [asManager.id]);
      assert.equal((await pool.query('SELECT role FROM workforce_team_memberships WHERE id=$1',
        [asObserver.id])).rows[0].role, 'observer', 'the other membership is unmoved');

      // ...and one live membership per member IS still enforced -- per team. Said here so that
      // this case cannot be read as licence to drop the uniqueness index it depends on.
      await assert.rejects(addMember(dualAgent, teamA, 'observer'), error => error.code === '23505');
    });

    await t.test('one live membership per member, and endpoints must be exactly one kind', async () => {
      await assert.rejects(addMember(), error => error.code === '23505');
      await assert.rejects(pool.query(
        `INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,role) VALUES($1,$2,'agent','worker')`,
        [team, team]), error => error.code === '23503');
      await deny(`INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,member_principal_id,role)
         VALUES($1,$2,'agent',$3,'worker')`, [team, loneAgent, human]);
    });

    await t.test('endpoints and creator are immutable and history is retained, never deleted', async () => {
      const { rows: [m] } = await pool.query('SELECT * FROM workforce_team_memberships WHERE team_id=$1 LIMIT 1', [team]);
      await deny('UPDATE workforce_team_memberships SET member_resource_id=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1', [m.id, loneAgent]);
      await deny('UPDATE workforce_team_memberships SET joined_team_revision=1,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1', [m.id]);
      await deny('UPDATE workforce_team_memberships SET revision=revision+5,updated_at=clock_timestamp() WHERE id=$1', [m.id]);
      await deny('DELETE FROM workforce_team_memberships WHERE id=$1', [m.id]);
      await deny('TRUNCATE workforce_team_memberships CASCADE');
    });

    await t.test('a human member can be erased, leaving a tombstone and the membership intact', async () => {
      const { rows: [m] } = await pool.query(
        `INSERT INTO workforce_team_memberships(team_id,member_principal_id,role) VALUES($1,$2,'worker') RETURNING *`, [backfilledTeam, human]);
      assert.equal(m.member_principal_id, human);
      assert.equal(m.member_principal_erased_at, null);
      /* Regression test for the defect that made a membership pin its member's
       * account against deletion forever: member_principal_id was ON DELETE
       * RESTRICT and also listed immutable, so erasure could neither cascade nor
       * be applied by hand. It is now SET NULL with a tombstone, matching what
       * created_by_user_id already does. Reverting the FK to RESTRICT makes the
       * DELETE below fail and this test go red. */
      await deny('UPDATE workforce_team_memberships SET member_principal_erased_at=now(),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1', [m.id]);
      await pool.query('DELETE FROM users WHERE id=$1', [human]);
      const after = (await pool.query('SELECT * FROM workforce_team_memberships WHERE id=$1', [m.id])).rows[0];
      assert.equal(after.member_principal_id, null, 'the erased account is no longer referenced');
      assert.ok(after.member_principal_erased_at, 'and the row records that it was erased, not that it never had a member');
      assert.equal(after.state, 'active');
      assert.equal(after.revision, m.revision, 'erasure is not a membership revision and does not rewrite history');
      assert.equal(after.joined_team_revision, m.joined_team_revision);
    });

    await t.test('team acceptance is refused until an explicit member descriptor is persisted', async () => {
      const proposal = await propose();
      assert.equal(proposal.state, 'proposed');
      await deny(ACCEPT, [proposal.id, approver]);
      await deny(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_user_id,
        resource_revision,created_by_user_id,policy,member_set_revision,source_approved_at)
        VALUES($1,'team',$2,$3,1,$4,$5,1,clock_timestamp())`, [team, sourceWorkspace, owner, creator, policy]);
      await pool.query(REVOKE, [proposal.id]);
    });

    await t.test('an explicit empty approved set is a real decision and grants nobody', async () => {
      const proposal = await propose({ workspace: emptySetWorkspace });
      await describe(proposal.id, team, 0, await teamRevision(team), 1, emptySetWorkspace);
      const accepted = (await pool.query(ACCEPT, [proposal.id, approver])).rows[0];
      assert.equal(accepted.state, 'accepted', 'an explicitly empty member set is approvable');
      assert.equal((await pool.query(
        'SELECT count(*) FROM workforce_assignment_active_member_candidates WHERE assignment_id=$1', [proposal.id])).rows[0].count, '0');
      await pool.query(REVOKE, [proposal.id]);
    });

    await t.test('a later member set is captured, admitted by the target, and only then effective (ASN-05)', async () => {
      /* D02: "later members require target admission". Previously UNIQUE(assignment_id)
       * made snapshot_revision a dead column, so a later member could only be added by
       * revoking and re-proposing -- a NEW grant needing fresh source approval, which
       * is not the admission D02 describes. This is the whole loop, end to end. */
      const proposal = await propose({ workspace: snapshotWorkspace });
      const firstMember = (await pool.query('SELECT * FROM workforce_team_memberships WHERE team_id=$1 AND state=$2 LIMIT 1', [team, 'active'])).rows[0];
      await describe(proposal.id, team, 1, await teamRevision(team), 1, snapshotWorkspace);
      await pool.query(`INSERT INTO workforce_assignment_members(assignment_id,snapshot_revision,team_id,membership_id,membership_revision,role)
        VALUES($1,1,$2,$3,$4,$5)`, [proposal.id, team, firstMember.id, firstMember.revision, firstMember.role]);
      const accepted = (await pool.query(ACCEPT, [proposal.id, approver])).rows[0];
      assert.equal(accepted.state, 'accepted');
      assert.equal((await pool.query('SELECT count(*) FROM workforce_assignment_active_member_candidates WHERE assignment_id=$1',
        [proposal.id])).rows[0].count, '1', 'the originally accepted member set is effective');

      // The team gains a second member AFTER the assignment is already live.
      const later = (await addMember(loneAgent, team)).rows[0];
      await describe(proposal.id, team, 2, await teamRevision(team), 2, snapshotWorkspace);
      for (const m of [firstMember, later])
        await pool.query(`INSERT INTO workforce_assignment_members(assignment_id,snapshot_revision,team_id,membership_id,membership_revision,role)
          VALUES($1,2,$2,$3,$4,$5)`, [proposal.id, team, m.id, m.revision, m.role]);
      assert.equal((await pool.query('SELECT count(*) FROM workforce_assignment_active_member_candidates WHERE assignment_id=$1',
        [proposal.id])).rows[0].count, '1',
        'capturing a later set grants nobody until the target admits it -- the source cannot widen its own grant');

      // A captured set cannot be born admitted, and a gap cannot skip one.
      await deny(`INSERT INTO workforce_assignment_member_sets(assignment_id,snapshot_revision,team_id,workspace_id,
        team_membership_revision,member_count,created_by_user_id,admitted_at,admitted_by_user_id)
        VALUES($1,3,$2,$3,$4,0,$5,clock_timestamp(),$5)`, [proposal.id, team, snapshotWorkspace, await teamRevision(team), creator]);
      await deny(`INSERT INTO workforce_assignment_member_sets(assignment_id,snapshot_revision,team_id,workspace_id,
        team_membership_revision,member_count,created_by_user_id) VALUES($1,9,$2,$3,$4,0,$5)`,
        [proposal.id, team, snapshotWorkspace, await teamRevision(team), creator]);

      // The target admits it. Only now do both members become effective.
      const ADMIT = `UPDATE workforce_assignment_member_sets SET admitted_at=clock_timestamp(),admitted_by_user_id=$3
        WHERE assignment_id=$1 AND snapshot_revision=$2 RETURNING *`;
      const admitted = (await pool.query(ADMIT, [proposal.id, 2, approver])).rows[0];
      assert.ok(admitted.admitted_at); assert.equal(admitted.admitted_by_user_id, approver);
      assert.equal((await pool.query('SELECT count(*) FROM workforce_assignment_active_member_candidates WHERE assignment_id=$1',
        [proposal.id])).rows[0].count, '2', 'after target admission the later member is effective');
      // An admitted set is immutable again, and admission cannot be replayed.
      await deny(`UPDATE workforce_assignment_member_sets SET member_count=99 WHERE assignment_id=$1 AND snapshot_revision=2`, [proposal.id]);
      await deny(ADMIT.replace(' RETURNING *', ''), [proposal.id, 2, creator]);
      await pool.query(REVOKE, [proposal.id]);
    });

    // 🔴 ASN-05's LAST CLAUSE -- "removals revoke eligibility PROMPTLY" -- is held entirely by the
    // tail of `workforce_assignment_active_member_candidates` and by nothing else:
    //   membership.state='active' AND membership.revision=admitted.membership_revision
    //                              AND membership.role=admitted.role
    // Remove that tail, which reads like simplifying a join onto the membership row, and a revoked
    // member keeps exercising the assignment until somebody remembers to rewrite the admitted set.
    // The requirement's own words for that are "no unchecked future-member access expansion".
    // It is DERIVED, not propagated -- which is why it is worth pinning at all. Write-time
    // propagation is how this estate already shipped a suspension that held on password login and
    // not on OAuth.
    //
    // ⚠️ THE THREE PREDICATES ARE MUTUALLY REDUNDANT, AND THIS CASE CANNOT ISOLATE ANY ONE OF THEM.
    // Measured, not assumed: deleting `state='active'`, or the revision pin, or the role pin, each
    // leaves this case GREEN, because every membership mutation advances the revision by exactly
    // one (pinned two cases above), so a revocation trips the state pin AND the revision pin, and a
    // promotion trips the role pin AND the revision pin. Only removing all three fails it. That is
    // recorded here rather than left for the next person to rediscover: a single-line mutation
    // against overlapping defences proves nothing, and a gate is only as good as the change it can
    // actually catch.
    await t.test('revoking a member ends its eligibility at once, and so does changing its role (ASN-05)', async () => {
      const ws = randomUUID();
      await pool.query('INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,$3,$3)',
        [ws, owner, `revoke-${ws.slice(0, 8)}`]);
      const held = (await pool.query(
        `SELECT * FROM workforce_team_memberships WHERE team_id=$1 AND state='active' ORDER BY created_at`,
        [team])).rows;
      const proposal = await propose({ workspace: ws });
      await describe(proposal.id, team, held.length, await teamRevision(team), 1, ws);
      for (const m of held)
        await pool.query(`INSERT INTO workforce_assignment_members(assignment_id,snapshot_revision,team_id,
          membership_id,membership_revision,role) VALUES($1,1,$2,$3,$4,$5)`,
          [proposal.id, team, m.id, m.revision, m.role]);
      await pool.query(ACCEPT, [proposal.id, approver]);

      const live = async () => Number((await pool.query(
        'SELECT count(*) c FROM workforce_assignment_active_member_candidates WHERE assignment_id=$1',
        [proposal.id])).rows[0].c);
      assert.equal(await live(), held.length, 'the admitted set is effective to begin with');

      // Revoke one. No admission step, no rewrite of the admitted set -- eligibility ends here.
      await pool.query(`UPDATE workforce_team_memberships SET state='revoked',revision=revision+1,
        revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`, [held[0].id]);
      assert.equal(await live(), held.length - 1,
        'a revoked member is no longer a candidate the moment it is revoked');

      // And a surviving member whose ROLE changes drops out too: the target admitted this member
      // AT THIS ROLE, so a promotion is a new grant to be admitted, not a detail of an old one.
      if (held.length > 1) {
        await pool.query(`UPDATE workforce_team_memberships SET role='manager',revision=revision+1,
          updated_at=clock_timestamp() WHERE id=$1`, [held[1].id]);
        assert.equal(await live(), held.length - 2,
          'an admitted grant is for a member at a revision AND a role, never for the member alone');
      }
      await pool.query(REVOKE, [proposal.id]);
    });

    // ROLE-05's operative claim: "function never widens platform or workspace authority ...
    // promotion to `manager` grants nothing the principal's owner does not already hold."
    //
    // 🔴 THE ONLY WAY A SCHEMA CAN PROVE A GRANT DID NOT HAPPEN IS TO SHOW NOTHING WAS WRITTEN.
    // So this promotes a worker to manager -- the single most authority-flavoured change the
    // model allows, since ROLE-02 gives `manager` real powers -- and asserts the row count of
    // EVERY table in the schema is unchanged. A grant is a row somewhere. If a future change
    // wires the team function into `relationship_tuples`, or into any grant, lease or capability
    // table that does not exist yet, a row appears and this fails without anyone having to
    // remember to extend it: the table list is enumerated from the catalog, not hard-coded.
    //
    // ⚠️ The team's `team_membership_revision` DOES advance, and that is asserted rather than
    // excluded, because it is the distinction the requirement turns on: bookkeeping about the
    // membership having changed is not a grant of authority. Measured before it was written --
    // the probe reported zero row-count deltas and that counter moving by one.
    await t.test('promotion to manager writes no row anywhere, so it grants nothing (ROLE-05)', async () => {
      const subject = randomUUID(), t2 = randomUUID();
      await pool.query(
        "INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'team',$3,'Promote'),($2,'agent',$3,'Subject')",
        [t2, subject, owner]);
      const m = (await addMember(subject, t2, 'worker')).rows[0];

      const census = async () => {
        const tables = (await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename`, [schema])).rows;
        const counts = {};
        for (const { tablename } of tables)
          counts[tablename] = Number((await pool.query(`SELECT count(*) c FROM "${tablename}"`)).rows[0].c);
        return counts;
      };
      const before = await census();
      assert.ok(Object.keys(before).length >= 8,
        'the census must actually see the schema -- an empty table list would pass vacuously');
      const teamRevBefore = await teamRevision(t2);

      await pool.query(`UPDATE workforce_team_memberships SET role='manager',revision=revision+1,
        updated_at=clock_timestamp() WHERE id=$1`, [m.id]);
      assert.equal((await pool.query('SELECT role FROM workforce_team_memberships WHERE id=$1',
        [m.id])).rows[0].role, 'manager', 'the promotion really happened');

      assert.deepEqual(await census(), before,
        'a promotion wrote a row somewhere. A team function says what a member is FOR, never what ' +
        'it may DO -- any new row is an authority grant the intersection never authorised.');

      // The one thing that DOES move, asserted rather than ignored: bookkeeping is not a grant.
      assert.equal(await teamRevision(t2), teamRevBefore + 1,
        'the team records that its membership changed -- which is a revision, not a right');
    });

    await t.test('a temporary table cannot shadow the descriptor and forge team admission', async () => {
      const client = await pool.connect();
      try {
        const proposal = await propose({ workspace: shadowWorkspace });
        await assert.rejects(client.query(ACCEPT, [proposal.id, approver]), error => error.code === '23514');
        /* This is the regression test for the defect that made the replacement
         * WEAKER than the CHECK constraint this migration drops. PostgreSQL searches
         * pg_temp FIRST for relation names; the guards are SECURITY INVOKER; so
         * before `SET search_path = <schema>, pg_temp` was pinned on each function,
         * this exact sequence was ADMITTED -- a team assignment accepted through a
         * descriptor that exists only in the caller's temporary schema, with no real
         * member set and no admitted members. Verified against a real fixture in
         * both directions: forged before the fix, refused after it.
         * Removing the DO $harden$ block from the migration makes this test fail. */
        await client.query(`CREATE TEMP TABLE workforce_assignment_member_sets(
          assignment_id UUID, snapshot_revision BIGINT, team_id UUID, team_kind TEXT, workspace_id UUID,
          team_membership_revision BIGINT, member_count INTEGER, created_by_user_id UUID, created_at TIMESTAMPTZ)`);
        await client.query(`CREATE TEMP TABLE workforce_assignment_members(
          assignment_id UUID, snapshot_revision BIGINT, team_id UUID, membership_id UUID,
          membership_revision BIGINT, role TEXT, created_at TIMESTAMPTZ)`);
        await client.query(`INSERT INTO pg_temp.workforce_assignment_member_sets VALUES($1,1,$2,'team',$3,1,0,NULL,now())`,
          [proposal.id, team, shadowWorkspace]);
        /* The shadow really is in effect for the caller -- otherwise this test could
         * pass because the temp table was never consulted, which would prove nothing. */
        assert.equal((await client.query('SELECT count(*) FROM workforce_assignment_member_sets WHERE assignment_id=$1',
          [proposal.id])).rows[0].count, '1', 'the unqualified name resolves to the caller temp table');
        await assert.rejects(client.query(ACCEPT, [proposal.id, approver]), error => error.code === '23514',
          'admission reads the real descriptor, not the caller temporary one');
        await client.query('DROP TABLE pg_temp.workforce_assignment_member_sets, pg_temp.workforce_assignment_members');
        assert.equal((await pool.query(
          'SELECT state FROM workforce_workspace_assignments WHERE id=$1', [proposal.id])).rows[0].state, 'proposed');
        await pool.query(REVOKE, [proposal.id]);
      } finally { client.release(); }
    });

    // OWN-04: archive, member removal and deletion are SEPARATE operations with separate
    // read-back, not one cascade. An archived team still permits revocation of a sitting
    // member, which is only expressible if the two verbs are actually distinct.
    await t.test('an archived team admits nobody new, but its existing members can still be revoked (OWN-04)', async () => {
      const { rows: [existing] } = await addMember(loneAgent, backfilledTeam);
      await pool.query("UPDATE workforce_resources SET status='archived',revision=revision+1 WHERE id=$1", [backfilledTeam]);
      /* OWN-06: archive blocks new admissions. Previously no guard read
       * workforce_resources.status -- only the candidates view filtered on it, and a
       * view is a projection, not a gate -- so an archived team went on gaining
       * members. Removing either status check from the migration makes this red. */
      await assert.rejects(addMember(memberAgent, backfilledTeam), error => error.code === '23514');
      const proposal = await propose({ resource: backfilledTeam, workspace: sourceWorkspace });
      await assert.rejects(describe(proposal.id, backfilledTeam, 0, await teamRevision(backfilledTeam), 1, sourceWorkspace),
        error => error.code === '23514', 'an archived team cannot enter a new approved member set either');
      await pool.query(REVOKE, [proposal.id]);
      /* Revocation must remain available: removing a member from an archived team
       * cannot require un-archiving it, which would put the team back into a state
       * where it can be assigned again. */
      const revoked = await pool.query(`UPDATE workforce_team_memberships SET state='revoked',revision=revision+1,
        revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING *`, [existing.id]);
      assert.equal(revoked.rows[0].state, 'revoked');
      await pool.query("UPDATE workforce_resources SET status='active',revision=revision+1 WHERE id=$1", [backfilledTeam]);
    });

    await t.test('populated rollback is refused and the dropped constraint stays dropped while applied', async () => {
      await deny(down);
      assert.ok(Number((await pool.query('SELECT count(*) FROM workforce_team_memberships')).rows[0].count) > 0);
      /* Scoped to THIS schema: pg_constraint is database-wide and the sibling
       * suites run concurrently in their own schemas, where the constraint is
       * still installed. An unscoped count reads their state, not ours. */
      assert.equal((await pool.query(
        `SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
         WHERE c.conname='workforce_assignment_team_admission_pending' AND n.nspname=$1`, [schema])).rows[0].count, '0',
        'the shipped admission constraint is gone for as long as this migration is applied');
    });
  } finally {
    if (createdSchema) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
