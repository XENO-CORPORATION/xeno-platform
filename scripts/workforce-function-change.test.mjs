/**
 * XENO-WORKFORCE-01 LIFE-05: "Promotion and demotion change a FUNCTION, never authority directly.
 * Changing a team function (8.2a ROLE-02) or a division head (DIV-06) is a membership revision with a
 * recorded actor and reason. ROLE-05 still holds: the effective right is the intersection, so a
 * promotion grants nothing the principal's owner does not already hold."
 *
 * Implemented by 20260924190000-workforce-function-change-is-decided.sql. Before it, a role changed
 * with a plain UPDATE: the membership row recorded who CREATED it, never who changed its function or
 * why, and nothing required a decision record to exist. Real PostgreSQL, the real workforce chain.
 *
 * Asserted:
 *   1. A function change WITHOUT a decision is refused -- for a team role and for a division head.
 *   2. The decision must be a `member.promote` ABOUT THIS membership (or division): another
 *      membership's decision, another kind, or a decision already used for an earlier change are all
 *      refused, so no change can be passed off under somebody else's reason.
 *   3. The record reads back: who decided, the account that answers for it (LIFE-07), the authority
 *      and the reason -- and it is immutable, so it cannot be edited afterwards.
 *   4. It is a RECORD, not a grant (ROLE-05): the decided promotion writes no tuple and admits no
 *      member -- the only rows it adds are the decision itself.
 *   5. Account erasure is not a decision: a head nulled because its account was deleted needs none.
 *
 * Run: WORKFORCE_TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/workforceproof \
 *      node --test scripts/workforce-function-change.test.mjs
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - the guard lets a role change without a decision   -> "a function change needs its decision"
 *   - the guard accepts another membership's decision   -> "a decision about another membership does not decide this one"
 *   - the guard accepts a reused decision               -> "a decision already used cannot decide a second change"
 *   - the guard accepts a decision of another kind      -> "only a member.promote decision changes a function"
 *   - the division trigger is removed                   -> "a division head change needs its decision"
 *   - erasure is treated as a change                    -> "erasing a head's account needs no decision"
 *   - the subject-type check is dropped                 -> "a membership-scoped decision does not appoint a head"
 *   - a decision may move without its function          -> "the decision cannot be detached from the function it decided"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { requireProofDatabase, workforceProofUnavailable } from './lib/workforce-proof-database.mjs';

const MIGRATIONS = new URL('../src/server/database/migrations/', import.meta.url);

test('a change of team function or division head is decided, with its actor and reason (LIFE-05)', { skip: workforceProofUnavailable() }, async (t) => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);
  const schema = `workforce_function_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 });
  let created = false;

  const [owner, lead, erasable] = Array.from({ length: 3 }, () => randomUUID());
  const workspace = randomUUID();
  const refuse = (promise, pattern, message) => assert.rejects(promise,
    (e) => ['23514', '23503'].includes(e.code) && (!pattern || pattern.test(e.message)), message);

  /** A decision record, the way the membership authority would write one. */
  const decide = async ({ subjectType = 'membership', subjectId, kind = 'member.promote', rationale = 'leads the review work' }) => {
    const operationId = randomUUID();
    await pool.query(`INSERT INTO workforce_operations(actor_user_id,client_id,operation_id,request_hash,kind,subject_type,subject_id,
      deciding_principal_id,responsible_account_id,authority,rationale,workspace_id)
      VALUES($1,'workforce-test',$2,$3,$4,$5,$6,$1,$1,$7,$8,$9)`,
    [owner, operationId, randomBytes(32).toString('hex'), kind, subjectType, subjectId, `workspace:${workspace}#admin`, rationale, workspace]);
    return { actor: owner, client: 'workforce-test', id: operationId };
  };
  const setRole = (membershipId, role, decision) => pool.query(
    `UPDATE workforce_team_memberships SET role=$2, revision=revision+1, updated_at=clock_timestamp(),
       role_decision_actor_user_id=$3, role_decision_client_id=$4, role_decision_operation_id=$5 WHERE id=$1 RETURNING *`,
    [membershipId, role, decision?.actor ?? null, decision?.client ?? null, decision?.id ?? null]);
  const setHead = (divisionId, headId, decision) => pool.query(
    `UPDATE workforce_divisions SET head_principal_id=$2, revision=revision+1,
       head_decision_actor_user_id=$3, head_decision_client_id=$4, head_decision_operation_id=$5 WHERE id=$1 RETURNING *`,
    [divisionId, headId, decision?.actor ?? null, decision?.client ?? null, decision?.id ?? null]);

  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
    await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY);
      CREATE TABLE api_keys(id UUID PRIMARY KEY, user_id UUID REFERENCES users(id));
      CREATE TABLE chat_projects(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID, owner_user_id UUID REFERENCES users(id),
        workspace_id UUID, name TEXT NOT NULL DEFAULT 'p', is_archived BOOLEAN NOT NULL DEFAULT false)`);
    for (const id of [owner, lead, erasable]) await pool.query('INSERT INTO users VALUES($1)', [id]);
    const chain = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')
      && (/workforce/.test(f) || f === '20260711120000-workspaces.sql')).sort()
      .filter((f) => f !== '20260924190000-workforce-function-change-is-decided.sql');
    for (const f of chain) await pool.query((await readFile(new URL(f, MIGRATIONS), 'utf8')).split('-- DOWN')[0]);
    await pool.query(`INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,'Studio','studio')`, [workspace, owner]);
    const [up, down] = (await readFile(new URL('20260924190000-workforce-function-change-is-decided.sql', MIGRATIONS), 'utf8')).split('-- DOWN');
    await pool.query(up); await pool.query(down); await pool.query(up);

    const team = (await pool.query(`INSERT INTO workforce_resources(kind,owner_workspace_id,name) VALUES('team',$1,'Review') RETURNING id`, [workspace])).rows[0].id;
    const member = async () => {
      const agent = (await pool.query(`INSERT INTO workforce_resources(kind,owner_workspace_id,name) VALUES('agent',$1,'a') RETURNING id`, [workspace])).rows[0].id;
      return (await pool.query(`INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,role,created_by_user_id)
        VALUES($1,$2,'agent','worker',$3) RETURNING *`, [team, agent, owner])).rows[0];
    };

    await t.test('a team function change needs its decision, about this very membership', async () => {
      const m = await member();
      await refuse(setRole(m.id, 'manager', null), /requires the decision/, 'a function change needs its decision');

      const other = await member();
      const aboutOther = await decide({ subjectId: other.id });
      await refuse(setRole(m.id, 'manager', aboutOther), /about this very membership/,
        'a decision about another membership does not decide this one');

      await refuse(setRole(m.id, 'manager', { actor: owner, client: 'workforce-test', id: randomUUID() }), null,
        'a decision that was never recorded cannot be cited');

      const wrongKind = await decide({ subjectId: m.id, kind: 'member.admit' });
      await refuse(setRole(m.id, 'manager', wrongKind), /member\.promote/, 'only a member.promote decision changes a function');

      const promoted = await decide({ subjectId: m.id, rationale: 'owns the release checklist now' });
      const row = (await setRole(m.id, 'manager', promoted)).rows[0];
      assert.equal(row.role, 'manager');
      await refuse(setRole(m.id, 'worker', promoted), /requires the decision/,
        'a decision already used cannot decide a second change');
      const demoted = await decide({ subjectId: m.id, rationale: 'handed the checklist back' });
      assert.equal((await setRole(m.id, 'worker', demoted)).rows[0].role, 'worker', 'a demotion is decided the same way');
    });

    await t.test('the record reads back: actor, responsible account, authority, reason -- immutable', async () => {
      const m = await member();
      const decision = await decide({ subjectId: m.id, rationale: 'leads incident review' });
      await setRole(m.id, 'observer', decision);
      const change = (await pool.query(`SELECT * FROM workforce_function_changes WHERE scope='membership' AND subject_id=$1`, [m.id])).rows[0];
      assert.equal(change.function_now, 'observer');
      assert.equal(change.deciding_principal_id, owner);
      assert.equal(change.responsible_account_id, owner, 'LIFE-07: the account that answers for it');
      assert.equal(change.authority, `workspace:${workspace}#admin`);
      assert.equal(change.rationale, 'leads incident review');
      await assert.rejects(pool.query(`UPDATE workforce_operations SET rationale='rewritten' WHERE operation_id=$1`, [decision.id]),
        /immutable/, 'the reason cannot be edited afterwards');
      await refuse(pool.query(`UPDATE workforce_team_memberships SET revision=revision+1, updated_at=clock_timestamp(),
        role_decision_operation_id=NULL, role_decision_client_id=NULL, role_decision_actor_user_id=NULL WHERE id=$1`, [m.id]),
      /recorded only with the change/, 'the decision cannot be detached from the function it decided');
    });

    await t.test('a decided promotion is a record, not a grant (ROLE-05 still holds)', async () => {
      const m = await member();
      const tables = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname=$1`, [schema])).rows.map((r) => r.tablename);
      const census = async () => Object.fromEntries(await Promise.all(tables.map(async (tb) =>
        [tb, Number((await pool.query(`SELECT count(*) c FROM "${tb}"`)).rows[0].c)])));
      const before = await census();
      await setRole(m.id, 'manager', await decide({ subjectId: m.id }));
      const after = await census();
      const moved = Object.keys(after).filter((tb) => after[tb] !== before[tb]);
      assert.deepEqual(moved, ['workforce_operations'], 'the only row a decided promotion adds is the decision itself');
      assert.equal(after.workforce_operations - before.workforce_operations, 1);
    });

    await t.test('a division head change needs its decision; erasing the head\'s account does not', async () => {
      const division = (await pool.query(`INSERT INTO workforce_divisions(workspace_id,key,name,created_by_user_id)
        VALUES($1,'dev','Dev',$2) RETURNING *`, [workspace, owner])).rows[0];
      await refuse(setHead(division.id, lead, null), /requires the decision/, 'a division head change needs its decision');
      await refuse(setHead(division.id, lead, await decide({ subjectType: 'membership', subjectId: division.id })),
        /about this very membership or division/, 'a membership-scoped decision does not appoint a head');
      const appointed = (await setHead(division.id, lead, await decide({ subjectType: 'division', subjectId: division.id,
        rationale: 'runs the platform team' }))).rows[0];
      assert.equal(appointed.head_principal_id, lead);
      const change = (await pool.query(`SELECT * FROM workforce_function_changes WHERE scope='division' AND subject_id=$1`, [division.id])).rows[0];
      assert.equal(change.rationale, 'runs the platform team');

      const erasableDivision = (await pool.query(`INSERT INTO workforce_divisions(workspace_id,key,name,created_by_user_id)
        VALUES($1,'ops','Ops',$2) RETURNING *`, [workspace, owner])).rows[0];
      await setHead(erasableDivision.id, erasable, await decide({ subjectType: 'division', subjectId: erasableDivision.id }));
      await assert.doesNotReject(pool.query('DELETE FROM users WHERE id=$1', [erasable]),
        "erasing a head's account needs no decision");
      assert.equal((await pool.query('SELECT head_principal_id FROM workforce_divisions WHERE id=$1', [erasableDivision.id])).rows[0].head_principal_id,
        null, 'the head is cleared by the erasure itself');
    });
  } finally {
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
