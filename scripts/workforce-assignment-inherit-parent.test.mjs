/**
 * XENO-WORKFORCE-01 ASN-06: "Permissions use explicit modes such as `none`, `explicit`,
 * `inherit_parent`. Empty collections do not encode all three. The legacy empty=inherited policy is
 * migrated with its effective parent bound, never changed implicitly."
 *
 * Implemented by 20260924150000-workforce-assignment-inherit-parent.sql. The foundation shipped two
 * modes and refused the third, so the first sentence was false and the legacy policy -- the
 * Interface's `allowedDirectories: []` meaning "everything my parent has" -- could not be written
 * down without either widening or narrowing it.
 *
 * What is asserted, and why each half matters:
 *   1. THREE MODES, NO EMPTINESS. `none`, `explicit` and `inherit_parent` are each a declared word;
 *      an empty capability list means exactly "nothing" under `explicit`, and a list beside `none`
 *      or `inherit_parent` is refused as the contradiction it is.
 *   2. BOUND, NOT RESOLVED LATER. An inheriting policy names the exact parent assignment AND the
 *      revision whose approval it inherits. A stale revision, a sibling scope, another resource,
 *      another workspace, a chain, or a workspace-level child with nothing above it are refused.
 *   3. THE LEGACY MIGRATION, END TO END. An Interface team whose grant was `[]` becomes a child
 *      assignment that effectively holds exactly its parent's set -- the same answer the Interface
 *      computes -- while a team whose grant was a list keeps that list, not a widened one.
 *   4. NEVER CHANGED IMPLICITLY, in both directions. The parent's terms cannot change under the
 *      child (revoke and repropose is the only route); and when the bound parent stops being live,
 *      the child grants NOTHING -- it does not keep the old set and does not fall through to some
 *      other ancestor. Its own revocation or expiry likewise grants nothing.
 *
 * Real PostgreSQL, owned isolated schema, the real migration chain in timestamp order.
 *
 * Run: WORKFORCE_TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/workforceproof \
 *      node --test scripts/workforce-assignment-inherit-parent.test.mjs
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - grammar allows capabilities beside inherit_parent  -> "a list beside inherit_parent is a contradiction"
 *   - grammar allows inherit_parent with no parent        -> "an unbound inherit_parent is refused"
 *   - guard skips the revision pin                        -> "a stale parent revision is refused"
 *   - guard skips the ancestor walk                       -> "a sibling division cannot be inherited from"
 *   - guard allows an inheriting parent                   -> "inheritance is one hop, never a chain"
 *   - view keeps the old set after the parent is revoked  -> "a revoked parent leaves the child with nothing"
 *   - view ignores the child's own state                  -> "a revoked child grants nothing"
 *   - view falls through to the parent's parent           -> "a revoked parent leaves the child with nothing"
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { requireProofDatabase, workforceProofUnavailable } from './lib/workforce-proof-database.mjs';

const CHAIN = ['20260711120000-workspaces.sql', '20260905120000-workforce-resources.sql',
  '20260905122000-workforce-workspace-assignments.sql', '20260905123000-workforce-team-membership-snapshots.sql',
  '20260922120000-workforce-divisions.sql', '20260923130000-workforce-assignment-division-target.sql'];
const TARGET = '20260924150000-workforce-assignment-inherit-parent.sql';

/**
 * The Interface's legacy resolution, COPIED VERBATIM in shape from
 * xeno-agent-interface packages/ui/src/components/agent/workspaceHierarchy.ts `resolveTeamDirectories`:
 *   if (!team.allowedDirectories.length) return workspace.directories
 *   return team.allowedDirectories.filter(dir => workspace.directories.some(root => contains(root, dir)))
 * The migration must reproduce its ANSWER without reproducing its encoding.
 */
const legacyResolve = (parentGrant, childGrant) => (childGrant.length
  ? childGrant.filter((c) => parentGrant.includes(c)) : parentGrant);

/** The migration of one legacy row: empty => inherit, bound to the parent; a list => explicit. */
const migrateLegacy = (legacyGrant, parent) => (legacyGrant.length
  ? { schemaVersion: 1, mode: 'explicit', capabilities: legacyGrant }
  : { schemaVersion: 1, mode: 'inherit_parent', capabilities: [], parent: { assignmentId: parent.id, revision: Number(parent.revision) } });

test('assignment permission modes: none, explicit, and a BOUND inherit_parent (ASN-06)', { skip: workforceProofUnavailable() }, async (t) => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);
  const schema = `workforce_inherit_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 });
  const read = (f) => readFile(new URL(`../src/server/database/migrations/${f}`, import.meta.url), 'utf8');
  let created = false;

  const owner = randomUUID(), approver = randomUUID();
  const ws = randomUUID(), otherWs = randomUUID();
  const explicit = (capabilities) => ({ schemaVersion: 1, mode: 'explicit', capabilities });
  const inherit = (parent, revision = Number(parent.revision)) => ({
    schemaVersion: 1, mode: 'inherit_parent', capabilities: [], parent: { assignmentId: parent.id, revision } });
  const deny = (promise, pattern) => assert.rejects(promise, (e) => e.code === '23514' && (!pattern || pattern.test(e.message)),
    `expected a 23514 refusal${pattern ? ` matching ${pattern}` : ''}`);

  const division = async (key, parent = null, workspace = ws) => (await pool.query(
    `INSERT INTO workforce_divisions(workspace_id,parent_division_id,key,name,created_by_user_id) VALUES($1,$2,$3,$3,$4) RETURNING id`,
    [workspace, parent, key, owner])).rows[0].id;
  const agentOf = async (name, workspace = ws) => (await pool.query(
    `INSERT INTO workforce_resources(kind,owner_workspace_id,created_by_user_id,name) VALUES('agent',$1,$2,$3) RETURNING id`,
    [workspace, owner, name])).rows[0].id;
  const propose = async (resourceId, divisionId, policy, workspace = ws) => (await pool.query(
    `INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,
       resource_revision,created_by_user_id,policy,target_division_id)
     VALUES($1,'agent',$2,$3,1,$4,$5,$6) RETURNING *`, [resourceId, workspace, ws, owner, policy, divisionId])).rows[0];
  const accept = async (id) => (await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted',revision=revision+1,
    source_approved_by_user_id=$2,source_approved_at=clock_timestamp(),target_accepted_by_user_id=$2,
    accepted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING *`, [id, approver])).rows[0];
  const revoke = async (id) => (await pool.query(`UPDATE workforce_workspace_assignments SET state='revoked',revision=revision+1,
    revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING *`, [id])).rows[0];
  const effective = async (id) => (await pool.query(
    'SELECT effective_mode, effective_capabilities, inherited_from, inherited_revision FROM workforce_assignment_effective_policy WHERE assignment_id=$1', [id])).rows[0];
  const valid = async (value) => (await pool.query('SELECT workforce_assignment_policy_valid($1::jsonb) AS v', [JSON.stringify(value)])).rows[0].v;

  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
    await pool.query('CREATE TABLE users(id UUID PRIMARY KEY)');
    for (const id of [owner, approver]) await pool.query('INSERT INTO users VALUES($1)', [id]);
    for (const f of CHAIN) await pool.query((await read(f)).split('-- DOWN')[0]);
    for (const [id, slug] of [[ws, 'studio'], [otherWs, 'elsewhere']]) {
      await pool.query('INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,$3,$3)', [id, owner, slug]);
    }
    const [up, down] = (await read(TARGET)).split('-- DOWN');

    await t.test('the migration rolls back and reapplies while nothing inherits', async () => {
      await pool.query(up); await pool.query(down);
      assert.equal(await valid({ schemaVersion: 1, mode: 'inherit_parent', capabilities: [], parent: { assignmentId: randomUUID(), revision: 1 } }),
        false, 'after DOWN the foundation grammar is back and refuses inherit_parent');
      await pool.query(up);
    });

    // dev > platform > api: a nested org chart (D15), plus a sibling of platform.
    const dev = await division('dev'), platform = await division('platform', dev), api = await division('api', platform);
    const apps = await division('apps', dev);

    await t.test('three declared modes; an empty list encodes none of them by itself', async () => {
      const parentId = randomUUID();
      for (const mode of ['none', 'explicit']) assert.equal(await valid({ schemaVersion: 1, mode, capabilities: [] }), true, mode);
      assert.equal(await valid({ schemaVersion: 1, mode: 'inherit_parent', capabilities: [], parent: { assignmentId: parentId, revision: 3 } }), true,
        'inherit_parent is a mode, not a refusal');
      assert.equal(await valid({ schemaVersion: 1, mode: 'inherit_parent', capabilities: ['files.read'], parent: { assignmentId: parentId, revision: 3 } }),
        false, 'a list beside inherit_parent is a contradiction');
      assert.equal(await valid({ schemaVersion: 1, mode: 'none', capabilities: ['files.read'] }), false, 'a list beside none is a contradiction');
      assert.equal(await valid({ schemaVersion: 1, mode: 'inherit_parent', capabilities: [] }), false, 'an unbound inherit_parent is refused');
      assert.equal(await valid({ schemaVersion: 1, mode: 'explicit', capabilities: [], parent: { assignmentId: parentId, revision: 3 } }),
        false, 'an explicit policy carrying a parent is two answers to one question');
      for (const parent of [{ assignmentId: 'not-a-uuid', revision: 1 }, { assignmentId: parentId, revision: 0 },
        { assignmentId: parentId, revision: 1.5 }, { assignmentId: parentId, revision: '1' }, { assignmentId: parentId },
        { assignmentId: parentId, revision: 1, scope: 'all' }, [parentId, 1], null]) {
        assert.equal(await valid({ schemaVersion: 1, mode: 'inherit_parent', capabilities: [], parent }), false, JSON.stringify(parent));
      }
    });

    await t.test('the bound parent is checked: resource, workspace, ancestor scope, one hop, and the revision', async () => {
      const agent = await agentOf('Reviewer');
      const workspaceLevel = await accept((await propose(agent, null, explicit(['files.read', 'git.push']))).id);
      const atDev = await accept((await propose(agent, dev, explicit(['files.read']))).id);

      await deny(propose(agent, null, inherit(workspaceLevel)), /workspace-level assignment has no parent/);
      await deny(propose(agent, api, inherit(workspaceLevel, Number(workspaceLevel.revision) - 1)), /stale/,
        'a stale parent revision is refused');
      await deny(propose(agent, apps, inherit({ id: (await accept((await propose(agent, platform, explicit(['files.read']))).id)).id, revision: 2 })),
        /ancestor scope/, 'a sibling division cannot be inherited from');

      const other = await agentOf('Other');
      const otherAssignment = await accept((await propose(other, dev, explicit(['files.read']))).id);
      await deny(propose(agent, api, inherit(otherAssignment)), /same resource/, 'another resource cannot be inherited from');
      await deny(propose(agent, api, inherit({ id: randomUUID(), revision: 1 })), /same resource/, 'a nonexistent parent is refused');

      const child = await propose(agent, api, inherit(atDev));
      await deny(propose(agent, api, inherit(child)), /concrete policy/, 'inheritance is one hop, never a chain');
      await deny(pool.query(`UPDATE workforce_workspace_assignments SET policy=$2, revision=revision+1, updated_at=clock_timestamp() WHERE id=$1`,
        [child.id, inherit(child)]), /inherit from itself|concrete policy/, 'an assignment cannot inherit from itself');

      const unapproved = await propose(await agentOf('Unapproved'), dev, explicit(['files.read']));
      await deny(propose(unapproved.resource_id, platform, inherit(unapproved)), /must be accepted/,
        'only an approval that exists can be inherited');

      // Any ANCESTOR may be bound directly, which is why refusing chains costs no expressiveness:
      // api, two levels below dev, binds the workspace-level assignment with nothing in between.
      const deep = await agentOf('Nested');
      const deepWorkspace = await accept((await propose(deep, null, explicit(['files.read']))).id);
      await propose(deep, api, inherit(deepWorkspace));
    });

    await t.test('the legacy empty=inherited policy migrates with its parent bound, reproducing the legacy answer', async () => {
      // Two legacy teams under the same parent: one with `allowedDirectories: []`, one with a list.
      const parentGrant = ['files.read', 'files.write', 'git.push'];
      const inheritingAgent = await agentOf('Legacy empty'), narrowedAgent = await agentOf('Legacy list');
      const parentFor = async (resource) => accept((await propose(resource, dev, explicit(parentGrant))).id);
      const parentA = await parentFor(inheritingAgent), parentB = await parentFor(narrowedAgent);

      const legacyEmpty = [], legacyList = ['files.read'];
      const childA = await accept((await propose(inheritingAgent, platform, migrateLegacy(legacyEmpty, parentA))).id);
      const childB = await accept((await propose(narrowedAgent, platform, migrateLegacy(legacyList, parentB))).id);

      const a = await effective(childA.id), b = await effective(childB.id);
      assert.deepEqual(a.effective_capabilities, legacyResolve(parentGrant, legacyEmpty),
        'the empty legacy grant effectively holds exactly its parent set -- the answer the Interface computes');
      assert.equal(a.effective_mode, 'explicit');
      assert.equal(a.inherited_from, parentA.id, 'and says which parent it is bound to');
      assert.equal(Number(a.inherited_revision), Number(parentA.revision), 'at the approval it inherited');
      assert.deepEqual(b.effective_capabilities, legacyResolve(parentGrant, legacyList),
        'a legacy list keeps that list, never the parent set');
      assert.equal(b.inherited_from, null, 'and binds nothing');

      // The stored policy says what was MEANT. Reading it cannot confuse the two.
      const stored = (await pool.query('SELECT policy FROM workforce_workspace_assignments WHERE id=$1', [childA.id])).rows[0].policy;
      assert.equal(stored.mode, 'inherit_parent');
      assert.deepEqual(stored.capabilities, [], 'the empty list is still stored -- and still means nothing on its own');
    });

    await t.test('never changed implicitly: the parent terms are frozen, and a dead parent grants the child nothing', async () => {
      const agent = await agentOf('Lifecycle');
      const grand = await accept((await propose(agent, null, explicit(['files.read', 'deploy.prod']))).id);
      const parent = await accept((await propose(agent, dev, explicit(['files.read']))).id);
      const child = await accept((await propose(agent, platform, inherit(parent))).id);
      assert.deepEqual((await effective(child.id)).effective_capabilities, ['files.read']);

      await deny(pool.query(`UPDATE workforce_workspace_assignments SET policy=$2, revision=revision+1, updated_at=clock_timestamp() WHERE id=$1`,
        [parent.id, explicit(['files.read', 'deploy.prod'])]), /immutable/, "the parent's terms cannot be widened under an accepted child");

      await revoke(parent.id);
      const after = await effective(child.id);
      assert.deepEqual(after.effective_capabilities, [], 'a revoked parent leaves the child with nothing');
      assert.equal(after.effective_mode, 'none', 'a revoked parent leaves the child with nothing');
      assert.ok(Number((await effective(grand.id)).effective_capabilities.length) > 0,
        'fixture: the grandparent is still live, so falling through to it would have granted deploy.prod');

      await deny(propose(agent, api, inherit(parent)), /revoked/, 'a revoked parent cannot be bound afresh');
      const pending = await propose(agent, api, inherit(grand));
      await revoke(grand.id);
      await deny(accept(pending.id), /revoked/, 'an inherited assignment cannot be accepted after its parent dies');
      assert.equal((await revoke(child.id)).state, 'revoked', 'and a child whose parent died can still be revoked');
    });

    await t.test("the child's own lifecycle bounds what it grants", async () => {
      const agent = await agentOf('Own lifecycle');
      const parent = await accept((await propose(agent, dev, explicit(['files.read']))).id);
      const proposed = await propose(agent, platform, inherit(parent));
      assert.deepEqual((await effective(proposed.id)).effective_capabilities, [], 'a proposed child grants nothing yet');
      const child = await accept(proposed.id);
      assert.deepEqual((await effective(child.id)).effective_capabilities, ['files.read']);
      await revoke(child.id);
      assert.deepEqual((await effective(child.id)).effective_capabilities, [], 'a revoked child grants nothing');
      assert.equal((await effective(parent.id)).effective_mode, 'explicit', 'and revoking the child does not touch the parent');
    });

    await t.test('rollback is refused once an inherited assignment exists', async () => {
      await deny(pool.query(down), /inherit_parent rollback refused/);
    });
  } finally {
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
