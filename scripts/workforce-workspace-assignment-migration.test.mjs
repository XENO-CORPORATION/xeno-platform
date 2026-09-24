/* ✅ ASN-06 IS BUILT AND CITED ELSEWHERE -- scripts/workforce-assignment-inherit-parent.test.mjs,
 * against 20260924150000-workforce-assignment-inherit-parent.sql. This suite applies only the
 * FOUNDATION migration, whose grammar knew two modes, so its policy-grammar case below still pins
 * that foundation truthfully: under it `inherit_parent` is refused. The later migration replaces
 * the grammar with three declared modes and a BOUND parent, and is where the requirement is proven.
 *
 * ⚠️ Recorded because it was the reason this note used to exist: the foundation refused
 * `inherit_parent`, which made ASN-06's first sentence false in code while its second ("empty
 * collections do not encode all three") was already true. The gap was closed upward -- the mode
 * was built, with its parent bound and a dead parent granting nothing -- not by editing the
 * requirement to match the two modes that happened to exist.
 *
 * ⚠️ ALSO NOT CITED, for the ordinary reason that nothing is built:
 *   ASN-02  "a team may target several projects; several teams may target one project". The
 *           workspace half (explicit records, never inferred from path prefixes) is proven.
 *           CORRECTED 2026-09-23: this note said "the project half has no table". It has one --
 *           `workspace_team_projects` (20260904140000-workspace-operational-teams.sql), an explicit
 *           many-to-many team<->chat_projects record, composite-keyed to one workspace. But it binds
 *           `workspace_teams`, a SECOND team model that predates `workforce_resources` kind='team'
 *           by eighteen days and is linked to it by nothing. Citing ASN-02 against it would decide
 *           which of the two is the spec's "team", and that is an owner decision, not a test
 *           outcome. Recorded as spec evidence row E16.
 *   ASN-07  directory bindings carrying host/environment identity and a canonical root. Measured:
 *           zero occurrences of canonical_root / host_identity anywhere under src/.
 *   ASN-08  reconciling Interface directory projections with `chat_projects` by explicit id
 *           mapping. No mapping table exists.
 *   ASN-09  a discriminated personal-project OR workspace-project participation target. The
 *           composite-FK case below proves the SCHEMA AFFORDANCE a participation record would
 *           bind to -- deliberately, using a fixture table -- which is a precondition and not the
 *           requirement. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { requireProofDatabase, workforceProofUnavailable } from './lib/workforce-proof-database.mjs';

test('workspace assignment schema on owned isolated PostgreSQL', { skip: workforceProofUnavailable() }, async t => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);
  const target = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  assert.equal(target.pathname, '/workforceproof'); assert.equal(target.search, '');
  const schema = `workforce_assignment_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  const migration = await readFile(new URL('../src/server/database/migrations/20260905122000-workforce-workspace-assignments.sql', import.meta.url), 'utf8');
  const [up, down] = migration.split('-- DOWN');
  const sourceOwner = randomUUID(), creator = randomUUID(), sourceApprover = randomUUID(), targetAcceptor = randomUUID(), otherOwner = randomUUID();
  const sourceWorkspace = randomUUID(), targetWorkspace = randomUUID(), foreignWorkspace = randomUUID();
  const agent = randomUUID(), team = randomUUID(), companyAgent = randomUUID();
  const policy = { schemaVersion: 1, mode: 'explicit', capabilities: ['files.read'] };
  let createdSchema = false;
  const deny = (sql, values = [], code = '23514') => assert.rejects(pool.query(sql, values), error => error.code === code);
  const propose = async ({ resource = agent, kind = 'agent', workspace = targetWorkspace, ownerUser = sourceOwner, ownerWorkspace = null, revision = 1, selectedPolicy = policy } = {}) => (await pool.query(`
    INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_user_id,source_owner_workspace_id,resource_revision,created_by_user_id,policy)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [resource, kind, workspace, ownerUser, ownerWorkspace, revision, creator, selectedPolicy])).rows[0];
  const acceptSql = `UPDATE workforce_workspace_assignments SET state='accepted',revision=revision+1,
    source_approved_by_user_id=$2,source_approved_at=clock_timestamp(),target_accepted_by_user_id=$3,accepted_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=$1 RETURNING *`;
  const accept = async (id, db = pool) => (await db.query(acceptSql, [id, sourceApprover, targetAcceptor])).rows[0];
  const revoke = id => pool.query("UPDATE workforce_workspace_assignments SET state='revoked',revision=revision+1,revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1", [id]);
  let acceptedAgent;
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); createdSchema = true;
    await pool.query('CREATE TABLE users(id UUID PRIMARY KEY)');
    for (const id of [sourceOwner, creator, sourceApprover, targetAcceptor, otherOwner]) await pool.query('INSERT INTO users VALUES($1)', [id]);
    for (const filename of ['20260711120000-workspaces.sql', '20260905120000-workforce-resources.sql']) await pool.query((await readFile(new URL(`../src/server/database/migrations/${filename}`, import.meta.url), 'utf8')).split('-- DOWN')[0]);
    for (const [id, slug] of [[sourceWorkspace, 'source'], [targetWorkspace, 'target'], [foreignWorkspace, 'foreign']]) await pool.query('INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,$3,$3)', [id, sourceOwner, slug]);
    await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Agent'),($3,'team',$2,'Team')", [agent, sourceOwner, team]);
    await pool.query("INSERT INTO workforce_resources(id,kind,owner_workspace_id,name) VALUES($1,'agent',$2,'Company agent')", [companyAgent, sourceWorkspace]);

    // ASN-03: a direct agent assignment must not manufacture a General team. This is the half
    // that proves nothing is created implicitly -- no same-owner assignment, no ReBAC edge.
    await t.test('empty rollback/reapply is additive and creates no automatic same-owner assignment or ReBAC edges (ASN-03)', async () => {
      await pool.query(up); await pool.query(down); await pool.query(up);
      assert.equal((await pool.query('SELECT count(*) FROM workforce_resources')).rows[0].count, '3');
      assert.equal((await pool.query('SELECT count(*) FROM workforce_workspace_assignments')).rows[0].count, '0');
      assert.equal((await pool.query('SELECT count(*) FROM relationship_tuples')).rows[0].count, '0');
    });
    // ASN-03 (a direct agent assignment is first-class, not routed through a team) and ASN-04
    // (a cross-owner assignment needs the source owner's approval AND the target's acceptance,
    // and BOTH are recorded): the proposal carries neither, acceptance carries both, and
    // neither may later be nulled -- see the immutability case below.
    await t.test('direct agent follows explicit proposal/dual approval/acceptance with independent creator (ASN-03, ASN-04)', async () => {
      const proposal = await propose();
      assert.equal(proposal.state, 'proposed'); assert.equal(proposal.revision, '1');
      assert.equal(proposal.created_by_user_id, creator); assert.equal(proposal.source_owner_user_id, sourceOwner);
      assert.equal(proposal.source_approved_at, null); assert.equal(proposal.target_accepted_by_user_id, null);
      await deny("UPDATE workforce_workspace_assignments SET state='accepted',revision=2,accepted_at=clock_timestamp() WHERE id=$1", [proposal.id]);
      acceptedAgent = await accept(proposal.id);
      assert.equal(acceptedAgent.state, 'accepted'); assert.equal(acceptedAgent.revision, '2');
      assert.equal(acceptedAgent.source_approved_by_user_id, sourceApprover);
      assert.equal(acceptedAgent.target_accepted_by_user_id, targetAcceptor);
      assert.equal((await pool.query('SELECT count(*) FROM relationship_tuples')).rows[0].count, '0');
    });
    await t.test('canonical resource/target/source FKs, XOR, kind and revisions reject invalid rows', async () => {
      for (const options of [{ resource: randomUUID() }, { workspace: randomUUID() }, { ownerUser: randomUUID() }]) await assert.rejects(propose({ workspace: foreignWorkspace, ...options }), error => error.code === '23503');
      for (const options of [{ ownerUser: null }, { ownerWorkspace: sourceWorkspace }, { revision: 0 }, { selectedPolicy: { schemaVersion: 1, mode: 'all', capabilities: [] } }]) await assert.rejects(propose({ workspace: foreignWorkspace, ...options }), error => error.code === '23514');
      await assert.rejects(propose({ resource: team, kind: 'agent' }), error => error.code === '23503');
      await deny(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_user_id,resource_revision,policy,state,revision)
        VALUES($1,'agent',$2,$3,1,$4,'revoked',2)`, [agent, foreignWorkspace, sourceOwner, policy]);
    });
    await t.test('policy grammar rejects null/unknown/wildcard/duplicate/unbounded fields and empty means no implicit access', async () => {
      const invalid = [null, [], {}, { schemaVersion: 1, mode: null, capabilities: [] }, { ...policy, token: 'PRIVATE' },
        { ...policy, capabilities: ['*'] }, { ...policy, capabilities: ['all'] }, { ...policy, capabilities: ['files.*'] },
        { ...policy, capabilities: ['files.read', 'files.read'] }, { ...policy, capabilities: Array.from({ length: 65 }, (_, i) => `cap.${i}`) },
        { ...policy, capabilities: [{}] }, { ...policy, mode: 'inherit_parent' }, { ...policy, mode: 'none' },
        { ...policy, capabilities: ['x'.repeat(129)] }];
      for (const value of invalid) assert.equal((await pool.query('SELECT workforce_assignment_policy_valid($1::jsonb) AS valid', [JSON.stringify(value)])).rows[0].valid, false);
      for (const mode of ['none', 'explicit']) assert.equal((await pool.query('SELECT workforce_assignment_policy_valid($1::jsonb) AS valid', [{ schemaVersion: 1, mode, capabilities: [] }])).rows[0].valid, true);
      assert.equal((await pool.query('SELECT workforce_assignment_policy_valid($1::jsonb) AS valid', [{ ...policy, capabilities: ['3d.generate'] }])).rows[0].valid, true);
    });
    // ASN-01: an agent may hold MULTIPLE workspace assignments. The uniqueness is per
    // (resource, workspace) PAIR, not per resource -- this agent is already assigned to
    // targetWorkspace above and takes foreignWorkspace here -- and assignment never moves
    // ownership, which stays on source_owner_* and survives independently.
    await t.test('one live assignment per pair survives concurrent proposals; revoked history permits a distinct new proposal (ASN-01)', async () => {
      const results = await Promise.allSettled([propose({ workspace: foreignWorkspace }), propose({ workspace: foreignWorkspace })]);
      assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
      assert.equal(results.find(value => value.status === 'rejected').reason.code, '23505');
      const original = results.find(value => value.status === 'fulfilled').value;
      await revoke(original.id);
      const next = await propose({ workspace: foreignWorkspace }); assert.notEqual(next.id, original.id);
      assert.equal((await pool.query('SELECT count(*) FROM workforce_workspace_assignments WHERE resource_id=$1 AND workspace_id=$2', [agent, foreignWorkspace])).rows[0].count, '2');
      await deny("UPDATE workforce_workspace_assignments SET state='proposed',revoked_at=NULL,revision=revision+1 WHERE id=$1", [original.id]);
      await revoke(next.id);
    });
    await t.test('source-approved terms and endpoints are immutable; revision and lifecycle cannot regress', async () => {
      for (const sql of ["workspace_id=$2", "resource_id=$2", "source_owner_user_id=$2", "created_by_user_id=$2"]) await deny(`UPDATE workforce_workspace_assignments SET ${sql},revision=revision+1 WHERE id=$1`, [acceptedAgent.id, otherOwner]);
      await deny('UPDATE workforce_workspace_assignments SET policy=$2,revision=revision+1 WHERE id=$1', [acceptedAgent.id, { ...policy, capabilities: ['files.write'] }]);
      await deny("UPDATE workforce_workspace_assignments SET state='proposed',accepted_at=NULL,target_accepted_by_user_id=NULL,revision=revision+1 WHERE id=$1", [acceptedAgent.id]);
      await deny("UPDATE workforce_workspace_assignments SET state='revoked',revoked_at=clock_timestamp() WHERE id=$1", [acceptedAgent.id]);
      const proposal = await propose({ resource: companyAgent, ownerUser: null, ownerWorkspace: sourceWorkspace });
      await pool.query('UPDATE workforce_workspace_assignments SET source_approved_by_user_id=$2,source_approved_at=clock_timestamp(),revision=2 WHERE id=$1', [proposal.id, sourceApprover]);
      await deny('UPDATE workforce_workspace_assignments SET policy=$2,revision=3 WHERE id=$1', [proposal.id, { ...policy, capabilities: [] }]);
      await revoke(proposal.id);
    });
    await t.test('team acceptance stays closed until real team memberships and admitted-member-set persistence exist', async () => {
      const proposal = await propose({ resource: team, kind: 'team' });
      await pool.query('UPDATE workforce_workspace_assignments SET member_set_revision=1,revision=2 WHERE id=$1', [proposal.id]);
      await assert.rejects(accept(proposal.id), error => error.code === '23514');
      assert.equal((await pool.query('SELECT state FROM workforce_workspace_assignments WHERE id=$1', [proposal.id])).rows[0].state, 'proposed');
      await revoke(proposal.id);
    });
    await t.test('stale owner, stale resource revision, archived source/target and expired validity refuse acceptance', async () => {
      for (const options of [{ ownerUser: otherOwner }, { revision: 2 }]) {
        const row = await propose({ ...options, workspace: foreignWorkspace }); await assert.rejects(accept(row.id), error => error.code === '23514'); await revoke(row.id);
      }
      const row = await propose({ workspace: foreignWorkspace });
      await pool.query("UPDATE workforce_resources SET status='archived' WHERE id=$1", [agent]);
      await assert.rejects(accept(row.id), error => error.code === '23514');
      await pool.query("UPDATE workforce_resources SET status='active' WHERE id=$1", [agent]);
      await pool.query("UPDATE workspaces SET status='archived' WHERE id=$1", [foreignWorkspace]);
      await assert.rejects(accept(row.id), error => error.code === '23514');
      await pool.query("UPDATE workspaces SET status='active' WHERE id=$1", [foreignWorkspace]);
      await pool.query("UPDATE workforce_workspace_assignments SET valid_from=now()-interval '2 days',valid_until=now()-interval '1 day',revision=2 WHERE id=$1", [row.id]);
      await assert.rejects(accept(row.id), error => error.code === '23514'); await revoke(row.id);
    });
    await t.test('resource ownership transaction serializes acceptance and stale consent loses after transfer commits', async () => {
      const row = await propose({ resource: companyAgent, ownerUser: null, ownerWorkspace: sourceWorkspace, workspace: foreignWorkspace });
      const writer = await pool.connect(), reader = await pool.connect();
      let pending;
      try {
        await writer.query('BEGIN'); await reader.query('BEGIN');
        await writer.query('UPDATE workforce_resources SET owner_workspace_id=$2,revision=revision+1 WHERE id=$1', [companyAgent, targetWorkspace]);
        const pid = (await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending = accept(row.id, reader).then(value => ({ value }), error => ({ error }));
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const state = (await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
          if (state?.wait_event_type === 'Lock') { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(blocked, true, 'acceptance must wait on the resource ownership row lock');
        await writer.query('COMMIT');
        const outcome = await pending; assert.equal(outcome.error?.code, '23514');
        await reader.query('ROLLBACK');
        assert.equal((await pool.query('SELECT state FROM workforce_workspace_assignments WHERE id=$1', [row.id])).rows[0].state, 'proposed');
      } finally {
        await writer.query('ROLLBACK'); await reader.query('ROLLBACK'); if (pending) await pending;
        writer.release(); reader.release();
      }
      await revoke(row.id);
    });
    await t.test('future participation composite FK binds exact resource/target/assignment together', async () => {
      await pool.query(`CREATE TABLE future_participation_fixture(resource_id UUID,workspace_id UUID,assignment_id UUID,
        FOREIGN KEY(resource_id,workspace_id,assignment_id) REFERENCES workforce_workspace_assignments(resource_id,workspace_id,id))`);
      await pool.query('INSERT INTO future_participation_fixture VALUES($1,$2,$3)', [agent, targetWorkspace, acceptedAgent.id]);
      await deny('INSERT INTO future_participation_fixture VALUES($1,$2,$3)', [team, targetWorkspace, acceptedAgent.id], '23503');
      await deny('INSERT INTO future_participation_fixture VALUES($1,$2,$3)', [agent, foreignWorkspace, acceptedAgent.id], '23503');
    });
    await t.test('creator/approver deletion clears attribution only; ownership and accepted history survive', async () => {
      const before = (await pool.query('SELECT * FROM workforce_workspace_assignments WHERE id=$1', [acceptedAgent.id])).rows[0];
      await deny('UPDATE workforce_workspace_assignments SET source_approved_by_user_id=NULL WHERE id=$1', [acceptedAgent.id]);
      for (const id of [creator, sourceApprover, targetAcceptor]) await pool.query('DELETE FROM users WHERE id=$1', [id]);
      const after = (await pool.query('SELECT * FROM workforce_workspace_assignments WHERE id=$1', [acceptedAgent.id])).rows[0];
      assert.deepEqual(after, { ...before, created_by_user_id: null, source_approved_by_user_id: null, target_accepted_by_user_id: null });
      await deny('DELETE FROM users WHERE id=$1', [sourceOwner], '23503');
      await deny('DELETE FROM workspaces WHERE id=$1', [targetWorkspace], '23503');
      await deny('DELETE FROM workforce_resources WHERE id=$1', [agent], '23503');
    });
    await t.test('deletion/truncation/populated rollback cannot erase assignment history', async () => {
      await revoke(acceptedAgent.id);
      await deny('DELETE FROM workforce_workspace_assignments'); await deny('TRUNCATE workforce_workspace_assignments CASCADE');
      await deny(down);
      assert.equal((await pool.query('SELECT count(*) FROM relationship_tuples')).rows[0].count, '0');
      assert.ok(Number((await pool.query('SELECT count(*) FROM workforce_workspace_assignments')).rows[0].count) > 0);
    });
  } finally {
    if (createdSchema) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
