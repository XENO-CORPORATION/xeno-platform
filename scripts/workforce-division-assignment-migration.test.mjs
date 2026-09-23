/**
 * XENO-WORKFORCE-01 DIV-05: "a team owned by one division MAY be assigned to another ... Each such
 * assignment is a separate record, separately accepted, separately revocable, and it does NOT move
 * ownership (ASN-01) or the funding scope (DIV-07)."
 *
 * Implemented by 20260923130000-workforce-assignment-division-target.sql as a division TARGET on the
 * existing assignment record (§12 "Workspace assignment", ADOPTED 8.2b) -- the assignment edge. The
 * owning and funding edges are the separate tables the divisions migration already has; this suite
 * asserts they are untouched by every assignment operation, because "moves neither" is the half of
 * DIV-05 a plausible implementation gets wrong.
 *
 * Real PostgreSQL, owned isolated schema, the real migration chain in timestamp order.
 *
 * Run: WORKFORCE_TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/workforceproof \
 *      node --test scripts/workforce-division-assignment-migration.test.mjs
 *
 * Mutation-checked (each fails the named case, restored passes):
 *   - drop the composite FK                  -> "a division of another workspace is unrepresentable"
 *   - live-pair index back to (resource, ws) -> "one team, several divisions of one workspace"
 *   - remove the immutability clause         -> "the division target is part of the assignment's identity"
 *   - remove the archived-division clause    -> "an archived division admits no new assignment"
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { requireProofDatabase, workforceProofUnavailable } from './lib/workforce-proof-database.mjs';

const CHAIN = ['20260711120000-workspaces.sql', '20260905120000-workforce-resources.sql',
  '20260905122000-workforce-workspace-assignments.sql', '20260905123000-workforce-team-membership-snapshots.sql',
  '20260922120000-workforce-divisions.sql'];
const TARGET = '20260923130000-workforce-assignment-division-target.sql';

test('division-targeted assignments on owned isolated PostgreSQL (DIV-05)', { skip: workforceProofUnavailable() }, async (t) => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);
  const schema = `workforce_divassign_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 });
  const read = (f) => readFile(new URL(`../src/server/database/migrations/${f}`, import.meta.url), 'utf8');
  let created = false;

  const owner = randomUUID(), approver = randomUUID();
  const ws = randomUUID(), otherWs = randomUUID();
  const policy = { schemaVersion: 1, mode: 'explicit', capabilities: ['files.read'] };
  const deny = (sql, values, code = '23514') => assert.rejects(pool.query(sql, values), (e) => e.code === code,
    `expected ${code} from: ${sql.slice(0, 70)}`);

  const division = async (workspace, key) => (await pool.query(
    `INSERT INTO workforce_divisions(workspace_id,key,name,created_by_user_id) VALUES($1,$2,$2,$3) RETURNING id`,
    [workspace, key, owner])).rows[0].id;
  const resource = async (kind, name) => (await pool.query(
    `INSERT INTO workforce_resources(kind,owner_workspace_id,created_by_user_id,name) VALUES($1,$2,$3,$4) RETURNING id`,
    [kind, ws, owner, name])).rows[0].id;
  const propose = async (resourceId, kind, divisionId) => (await pool.query(
    `INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,
       resource_revision,created_by_user_id,policy,target_division_id)
     VALUES($1,$2,$3,$3,1,$4,$5,$6) RETURNING *`, [resourceId, kind, ws, owner, policy, divisionId])).rows[0];
  const ACCEPT = `UPDATE workforce_workspace_assignments SET state='accepted',revision=revision+1,
    source_approved_by_user_id=$2,source_approved_at=clock_timestamp(),target_accepted_by_user_id=$2,
    accepted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING *`;
  const REVOKE = `UPDATE workforce_workspace_assignments SET state='revoked',revision=revision+1,
    revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING *`;
  const edges = async (resourceId) => ({
    owning: (await pool.query('SELECT division_id, revision FROM workforce_division_ownership WHERE resource_id=$1', [resourceId])).rows[0] ?? null,
    funding: (await pool.query('SELECT division_id, revision FROM workforce_division_funding WHERE resource_id=$1', [resourceId])).rows[0] ?? null,
  });

  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
    await pool.query('CREATE TABLE users(id UUID PRIMARY KEY)');
    for (const id of [owner, approver]) await pool.query('INSERT INTO users VALUES($1)', [id]);
    for (const f of CHAIN) await pool.query((await read(f)).split('-- DOWN')[0]);
    for (const [id, slug] of [[ws, 'studio'], [otherWs, 'elsewhere']]) {
      await pool.query('INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,$3,$3)', [id, owner, slug]);
    }
    const [up, down] = (await read(TARGET)).split('-- DOWN');

    await t.test('the migration rolls back and reapplies while no division assignment exists', async () => {
      await pool.query(up); await pool.query(down); await pool.query(up);
      const cols = (await pool.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema=$1 AND table_name='workforce_workspace_assignments' AND column_name='target_division_id'`, [schema])).rows;
      assert.equal(cols.length, 1);
    });

    const creative = await division(ws, 'creative'), office = await division(ws, 'office'), dev = await division(ws, 'dev');
    const foreignDivision = await division(otherWs, 'creative');

    await t.test('a team owned by one division is assigned to another, and neither ownership nor funding moves', async () => {
      const platformTeam = await resource('team', 'Platform');
      await pool.query('INSERT INTO workforce_division_ownership(resource_id,resource_kind,division_id,created_by_user_id) VALUES($1,$2,$3,$4)',
        [platformTeam, 'team', creative, owner]);
      const before = await edges(platformTeam);
      assert.equal(before.owning.division_id, creative, 'fixture: owned by creative');
      assert.equal(before.funding.division_id, creative, 'fixture: funding defaults to the owning division (D17)');

      const assignment = await propose(platformTeam, 'team', office);
      assert.equal(assignment.target_division_id, office);
      assert.equal(assignment.state, 'proposed', 'an assignment to a division is its own record, born proposed');
      assert.deepEqual(await edges(platformTeam), before, 'proposing moved neither edge');

      await pool.query(REVOKE, [assignment.id]);
      assert.deepEqual(await edges(platformTeam), before, 'revoking moved neither edge');
    });

    await t.test('one agent, several divisions of one workspace: each assignment accepted and revoked on its own', async () => {
      // An agent is used here because a DIRECT agent assignment has no member-set step, so the whole
      // lifecycle -- propose, accept, revoke -- runs on the assignment record alone. That keeps this
      // case about DIV-05 rather than about team admission, which ASN-05 already proves.
      const shared = await resource('agent', 'Shared reviewer');
      await pool.query('INSERT INTO workforce_division_ownership(resource_id,resource_kind,division_id,created_by_user_id) VALUES($1,$2,$3,$4)',
        [shared, 'agent', dev, owner]);
      const before = await edges(shared);

      const toOffice = await propose(shared, 'agent', office);
      const toCreative = await propose(shared, 'agent', creative);
      const workspaceLevel = await propose(shared, 'agent', null);
      assert.equal(new Set([toOffice.id, toCreative.id, workspaceLevel.id]).size, 3, 'three separate records');
      assert.equal(workspaceLevel.target_division_id, null, 'workspace-level is an explicit NULL target, a state of its own');

      // Separately ACCEPTED: accepting one leaves the others proposed.
      const accepted = (await pool.query(ACCEPT, [toOffice.id, approver])).rows[0];
      assert.equal(accepted.state, 'accepted');
      const states = async () => Object.fromEntries((await pool.query(
        'SELECT id,state FROM workforce_workspace_assignments WHERE resource_id=$1', [shared])).rows.map((r) => [r.id, r.state]));
      assert.deepEqual(await states(), { [toOffice.id]: 'accepted', [toCreative.id]: 'proposed', [workspaceLevel.id]: 'proposed' });

      // Separately REVOCABLE: revoking the accepted one leaves the rest as they were.
      await pool.query(REVOKE, [toOffice.id]);
      assert.deepEqual(await states(), { [toOffice.id]: 'revoked', [toCreative.id]: 'proposed', [workspaceLevel.id]: 'proposed' });
      assert.deepEqual(await edges(shared), before, 'accept and revoke moved neither the owning nor the funding edge');

      // One LIVE assignment per (resource, workspace, division): a second live one to the same division
      // is refused, while the revoked slot may be proposed again.
      await deny(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,
        resource_revision,created_by_user_id,policy,target_division_id) VALUES($1,'agent',$2,$2,1,$3,$4,$5)`,
        [shared, ws, owner, policy, creative], '23505');
      const again = await propose(shared, 'agent', office);
      assert.equal(again.state, 'proposed', 'a revoked division assignment can be proposed again');
    });

    await t.test('a division of another workspace is unrepresentable', async () => {
      const agent = await resource('agent', 'Cross');
      await deny(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,
        resource_revision,created_by_user_id,policy,target_division_id) VALUES($1,'agent',$2,$2,1,$3,$4,$5)`,
        [agent, ws, owner, policy, foreignDivision], '23503');
    });

    await t.test("the division target is part of the assignment's identity", async () => {
      const agent = await resource('agent', 'Pinned');
      const a = await propose(agent, 'agent', office);
      await deny(`UPDATE workforce_workspace_assignments SET target_division_id=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,
        [a.id, creative]);
      await deny(`UPDATE workforce_workspace_assignments SET target_division_id=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,
        [a.id]);
    });

    await t.test('an archived division admits no new assignment, and existing ones are not cascaded', async () => {
      const agent = await resource('agent', 'Late');
      const existing = await propose(agent, 'agent', dev);
      await pool.query(`UPDATE workforce_divisions SET lifecycle='archived',archived_at=now(),revision=revision+1 WHERE id=$1`, [dev]);
      const other = await resource('agent', 'Later');
      await deny(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,
        resource_revision,created_by_user_id,policy,target_division_id) VALUES($1,'agent',$2,$2,1,$3,$4,$5)`,
        [other, ws, owner, policy, dev]);
      await deny(ACCEPT, [existing.id, approver]);
      const still = (await pool.query('SELECT state FROM workforce_workspace_assignments WHERE id=$1', [existing.id])).rows[0];
      assert.equal(still.state, 'proposed', 'archiving did not touch the existing assignment');
      assert.equal((await pool.query(REVOKE, [existing.id])).rows[0].state, 'revoked', 'and it can still be revoked');
    });

    await t.test('rollback refuses while a division assignment exists', async () => {
      await deny(down, []);
    });
  } finally {
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
