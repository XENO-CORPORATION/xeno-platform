/**
 * XENO-WORKFORCE-01 ASN-09: "A project participation target is a discriminated personal-project OR
 * workspace-project scope. Workspace-project participation must reference an accepted workspace
 * assignment; personal-project participation binds directly to its canonical personal owner/project
 * and consent. Do not fabricate workspace membership to make personal/public projects fit a
 * workspace-only record. External offers create narrow engagements under either target, not
 * corporate memberships."
 *
 * Implemented by 20260924180000-workforce-project-participation.sql. Real PostgreSQL, the real
 * workforce migration chain (so assignments, their guard and the ASN-06 effective-policy view are
 * the real ones), real chat_projects rows owned both ways.
 *
 * Asserted:
 *   1. THE DISCRIMINATOR. Each variant has exactly its own columns: a workspace participation with
 *      no assignment, a personal one carrying a workspace or an assignment, is unrepresentable.
 *   2. WORKSPACE VARIANT. It must reference an ACCEPTED, CURRENT assignment of THIS resource into
 *      THIS workspace, and target a project that workspace owns. A proposal, a revoked or expired
 *      assignment, another resource's assignment, and a project owned elsewhere are all refused.
 *      Its policy may only NARROW what the assignment grants -- and when the assignment later dies,
 *      the participation grants nothing without anyone touching its row.
 *   3. PERSONAL VARIANT. It targets a PERSONAL project, names that project's canonical owner, and
 *      carries that owner's consent. A workspace project, a stand-in owner and missing consent are
 *      refused.
 *   4. NO FABRICATED MEMBERSHIP. Creating either variant writes no workspace, no relationship tuple
 *      and no team membership -- counted, not assumed. An external contributor's agent joins a
 *      personal project without anybody becoming a member of anything.
 *
 * Run: WORKFORCE_TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/workforceproof \
 *      node --test scripts/workforce-project-participation.test.mjs
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - the variant CHECK allows a workspace on a personal row -> "a personal participation carries no workspace lineage"
 *   - the guard accepts a proposed assignment              -> "a workspace participation needs an ACCEPTED assignment"
 *   - the guard ignores the project's owning workspace     -> "the project must be owned by the target workspace"
 *   - the guard lets a participation widen its assignment  -> "a participation may only narrow its assignment"
 *   - the effective view ignores the assignment's liveness -> "a dead assignment leaves its participations with nothing"
 *   - the guard accepts a stand-in personal owner          -> "a personal participation names the project's canonical owner"
 *   - the guard drops the consent check                    -> "a personal participation carries its owner's consent"
 *   - the composite FK is dropped                          -> "the assignment must be of this resource into this workspace"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { requireProofDatabase, workforceProofUnavailable } from './lib/workforce-proof-database.mjs';

const MIGRATIONS = new URL('../src/server/database/migrations/', import.meta.url);

test('project participation has a discriminated personal-or-workspace target (ASN-09)', { skip: workforceProofUnavailable() }, async (t) => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);
  const schema = `workforce_participation_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 });
  let created = false;

  const [owner, guestOwner, approver, stranger] = Array.from({ length: 4 }, () => randomUUID());
  const [company, otherCompany] = [randomUUID(), randomUUID()];
  const explicit = (capabilities) => ({ schemaVersion: 1, mode: 'explicit', capabilities });
  const deny = (promise, pattern, message) => assert.rejects(promise,
    (e) => ['23514', '23503'].includes(e.code) && (!pattern || pattern.test(e.message)), message);
  const count = async (table) => Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

  const resource = async (kind, { ownerUser = null, ownerWorkspace = null } = {}) => (await pool.query(
    `INSERT INTO workforce_resources(kind,owner_user_id,owner_workspace_id,name) VALUES($1,$2::uuid,$3::uuid,'r') RETURNING id`,
    [kind, ownerUser, ownerWorkspace])).rows[0].id;
  const project = async ({ ownerUser = null, workspace = null } = {}) => (await pool.query(
    `INSERT INTO chat_projects(user_id, owner_user_id, workspace_id, name) VALUES($1::uuid,$2::uuid,$3::uuid,'p') RETURNING id`,
    [ownerUser ?? owner, ownerUser, workspace])).rows[0].id;
  const assign = async (resourceId, workspace, capabilities, { accept = true, sourceOwner = company } = {}) => {
    const row = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,
      source_owner_workspace_id,resource_revision,created_by_user_id,policy) VALUES($1,'agent',$2,$3,1,$4,$5) RETURNING *`,
    [resourceId, workspace, sourceOwner, owner, explicit(capabilities)])).rows[0];
    if (!accept) return row;
    return (await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted',revision=revision+1,
      source_approved_by_user_id=$2,source_approved_at=clock_timestamp(),target_accepted_by_user_id=$2,
      accepted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING *`, [row.id, approver])).rows[0];
  };
  const participateInWorkspace = (resourceId, projectId, workspace, assignmentId, capabilities = ['files.read']) => pool.query(
    `INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,workspace_id,assignment_id,
       responsibility,policy,created_by_user_id) VALUES($1,'agent',$2,'workspace',$3,$4,'reviewer',$5,$6) RETURNING *`,
    [resourceId, projectId, workspace, assignmentId, explicit(capabilities), owner]);
  const participateInPersonal = (resourceId, projectId, personalOwner, consenter = personalOwner, extra = {}) => pool.query(
    `INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,
       consented_by_user_id,consented_at,workspace_id,assignment_id,responsibility,policy,created_by_user_id)
     VALUES($1,'agent',$2,'personal',$3,$4,clock_timestamp(),$5::uuid,$6::uuid,'contributor',$7,$8) RETURNING *`,
    [resourceId, projectId, personalOwner, consenter, extra.workspace ?? null, extra.assignment ?? null, explicit(['files.read']), owner]);
  const effective = async (id) => (await pool.query(
    'SELECT effective_capabilities FROM workforce_participation_effective_policy WHERE participation_id=$1', [id])).rows[0].effective_capabilities;

  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
    await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY);
      CREATE TABLE api_keys(id UUID PRIMARY KEY, user_id UUID REFERENCES users(id))`);
    for (const id of [owner, guestOwner, approver, stranger]) await pool.query('INSERT INTO users VALUES($1)', [id]);
    const chain = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')
      && (/workforce/.test(f) || f === '20260711120000-workspaces.sql')).sort()
      // Only what came BEFORE this migration: later workforce migrations (handoff disclosure, team
      // project responsibility, run admissions) reference chat_projects, which this proof creates
      // below, so applying them first failed the whole proof with `relation "chat_projects" does
      // not exist` from the moment they landed.
      .filter((f) => f < '20260924180000-workforce-project-participation.sql');
    for (const f of chain) await pool.query((await readFile(new URL(f, MIGRATIONS), 'utf8')).split('-- DOWN')[0]);
    // chat_projects as the chat migrations leave it: exactly one of a personal owner or a workspace.
    await pool.query(`CREATE TABLE chat_projects(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID,
      owner_user_id UUID REFERENCES users(id), workspace_id UUID REFERENCES workspaces(id), name TEXT NOT NULL,
      is_archived BOOLEAN NOT NULL DEFAULT false, CHECK ((owner_user_id IS NULL) <> (workspace_id IS NULL)))`);
    await pool.query(`INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,'Company','company'),($3,$2,'Other','other')`,
      [company, owner, otherCompany]);
    const [up, down] = (await readFile(new URL('20260924180000-workforce-project-participation.sql', MIGRATIONS), 'utf8')).split('-- DOWN');
    await pool.query(up); await pool.query(down); await pool.query(up);

    const agent = await resource('agent', { ownerWorkspace: company });
    const companyProject = await project({ workspace: company });
    const accepted = await assign(agent, company, ['files.read', 'git.push']);

    await t.test('the discriminator: each variant has exactly its own columns', async () => {
      await deny(pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,workspace_id,
        responsibility,policy) VALUES($1,'agent',$2,'workspace',$3,'x',$4)`, [agent, companyProject, company, explicit([])]),
      /variant/, 'a workspace participation without an assignment is unrepresentable');
      const personal = await project({ ownerUser: guestOwner });
      await deny(participateInPersonal(agent, personal, guestOwner, guestOwner, { workspace: company }),
        /variant/, 'a personal participation carries no workspace lineage');
      await deny(participateInPersonal(agent, personal, guestOwner, guestOwner, { workspace: company, assignment: accepted.id }),
        /variant|foreign key/, 'a personal participation carries no workspace lineage');
    });

    await t.test('workspace variant: an accepted assignment of this resource, into the workspace that owns the project', async () => {
      const row = (await participateInWorkspace(agent, companyProject, company, accepted.id)).rows[0];
      assert.equal(row.target_kind, 'workspace');
      assert.deepEqual(await effective(row.id), ['files.read']);

      const proposedAgent = await resource('agent', { ownerWorkspace: company });
      const proposal = await assign(proposedAgent, company, ['files.read'], { accept: false });
      await deny(participateInWorkspace(proposedAgent, companyProject, company, proposal.id),
        /accepted, current/, 'a workspace participation needs an ACCEPTED assignment');

      const elsewhere = await project({ workspace: otherCompany });
      const other = await resource('agent', { ownerWorkspace: company });
      const acceptedOther = await assign(other, company, ['files.read']);
      await deny(participateInWorkspace(other, elsewhere, company, acceptedOther.id),
        /owned by that workspace/, 'the project must be owned by the target workspace');

      const third = await resource('agent', { ownerWorkspace: company });
      await deny(participateInWorkspace(third, companyProject, company, accepted.id),
        /foreign key/, 'the assignment must be of this resource into this workspace');
    });

    await t.test('a participation may only narrow its assignment, and dies with it', async () => {
      const a = await resource('agent', { ownerWorkspace: company });
      const grant = await assign(a, company, ['files.read']);
      await deny(participateInWorkspace(a, companyProject, company, grant.id, ['files.read', 'deploy.prod']),
        /only narrow/, 'a participation may only narrow its assignment');
      const row = (await participateInWorkspace(a, companyProject, company, grant.id, ['files.read'])).rows[0];
      assert.deepEqual(await effective(row.id), ['files.read']);
      await pool.query(`UPDATE workforce_workspace_assignments SET state='revoked',revision=revision+1,revoked_at=clock_timestamp(),
        updated_at=clock_timestamp() WHERE id=$1`, [grant.id]);
      assert.deepEqual(await effective(row.id), [], 'a dead assignment leaves its participations with nothing');
      assert.equal((await pool.query('SELECT state FROM workforce_project_participations WHERE id=$1', [row.id])).rows[0].state, 'active',
        '-- without anybody rewriting the participation row');
    });

    await t.test('personal variant: the canonical personal owner, with that owner\'s consent', async () => {
      const guestAgent = await resource('agent', { ownerUser: stranger });
      const personal = await project({ ownerUser: guestOwner });
      await deny(participateInPersonal(guestAgent, personal, stranger), /canonical owner|names its owner/,
        "a personal participation names the project's canonical owner");
      await deny(participateInPersonal(guestAgent, personal, guestOwner, stranger), /consent/,
        "a personal participation carries its owner's consent");
      await deny(participateInPersonal(guestAgent, companyProject, owner), /personal project/,
        'a workspace project is not a personal target');
      const row = (await participateInPersonal(guestAgent, personal, guestOwner)).rows[0];
      assert.equal(row.target_kind, 'personal');
      assert.equal(row.consented_by_user_id, guestOwner);
      assert.equal(row.workspace_id, null);
      assert.deepEqual(await effective(row.id), ['files.read']);
    });

    await t.test('an engagement fabricates no membership of any kind', async () => {
      const before = await Promise.all(['workspaces', 'relationship_tuples', 'workforce_team_memberships', 'workforce_workspace_assignments'].map(count));
      const outsiderAgent = await resource('agent', { ownerUser: stranger });
      const personal = await project({ ownerUser: guestOwner });
      await participateInPersonal(outsiderAgent, personal, guestOwner);
      const after = await Promise.all(['workspaces', 'relationship_tuples', 'workforce_team_memberships', 'workforce_workspace_assignments'].map(count));
      assert.deepEqual(after, before, 'no workspace, tuple, team membership or assignment was created to host the guest');
    });

    await t.test('a participation only ends; its target and terms are immutable; history is retained', async () => {
      const a = await resource('agent', { ownerWorkspace: company });
      const grant = await assign(a, company, ['files.read']);
      const row = (await participateInWorkspace(a, companyProject, company, grant.id)).rows[0];
      await deny(pool.query(`UPDATE workforce_project_participations SET policy=$2, revision=revision+1 WHERE id=$1`,
        [row.id, explicit(['files.read', 'git.push'])]), /immutable/);
      const ended = (await pool.query(`UPDATE workforce_project_participations SET state='ended', revision=revision+1,
        ended_at=clock_timestamp(), ended_by_user_id=$2 WHERE id=$1 RETURNING *`, [row.id, owner])).rows[0];
      assert.equal(ended.state, 'ended');
      assert.deepEqual(await effective(row.id), [], 'an ended participation grants nothing');
      await deny(pool.query('DELETE FROM workforce_project_participations WHERE id=$1', [row.id]), /history is retained/);
      await deny(pool.query(down), /rollback refused/);
    });
  } finally {
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
