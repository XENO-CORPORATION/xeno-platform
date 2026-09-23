/**
 * XENO-WORKFORCE-01 §8.2b divisions (DIV-01..DIV-10), decisions D15/D16/D17.
 *
 * Real PostgreSQL, owned isolated schema, no skipped proof. Every assertion here exists because
 * the constraint it exercises could otherwise be deleted with nothing failing.
 *
 * Run: WORKFORCE_TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/workforceproof \
 *      node --test scripts/workforce-division-migration.test.mjs
 */
/* ⚠️ THE DIVISION REQUIREMENTS THIS SUITE DELIBERATELY DOES NOT CITE, AND WHY.
 * Recorded here rather than in a commit message, because a reason nobody can find is a reason
 * nobody has. Each is checked against the schema, not assumed.
 *
 *   DIV-05  NOW CITED -- by scripts/workforce-division-assignment-migration.test.mjs, against
 *           20260923130000-workforce-assignment-division-target.sql (2026-09-23). The assignment
 *           record gained a division target; the suite proves each division assignment is its own
 *           record, separately accepted and revoked, and that neither edge here moves.
 *   DIV-07  "a division's budget is a scope on the existing ledger" and "the division a run
 *           SPENDS against is read from the team's FUNDING SCOPE, never its owning division."
 *           The funding EDGE is proven above and is a precondition, not the requirement: nothing
 *           reads it at spend time, because there is no spend path. Citing DIV-07 would claim the
 *           half that decides who actually pays.
 *   DIV-08  "a division scope is a VISIBILITY and an EXECUTION boundary, ENFORCED AT ADMISSION."
 *           Nothing enforces it; RUN-02's intersection does not exist. This is precisely the
 *           *"UI label mistaken for pool enforcement"* failure §21 names, so a citation here
 *           would be the exact mistake the requirement warns about. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { requireProofDatabase, workforceProofUnavailable } from './lib/workforce-proof-database.mjs';

test('divisions on owned isolated PostgreSQL', { skip: workforceProofUnavailable() }, async (t) => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);

  const schema = `workforce_division_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  const read = f => readFile(new URL(`../src/server/database/migrations/${f}`, import.meta.url), 'utf8');
  const draft = await read('20260922120000-workforce-divisions.sql');
  const [up, down] = draft.split('-- DOWN');

  const owner = randomUUID(), creator = randomUUID(), head = randomUUID(), agentHead = randomUUID();
  const companyWs = randomUUID(), personalWs = randomUUID(), otherWs = randomUUID();
  const teamA = randomUUID(), teamB = randomUUID(), personalTeam = randomUUID();
  let createdSchema = false;

  const deny = (sql, values = [], code = '23514') =>
    assert.rejects(pool.query(sql, values), error => error.code === code);
  const mkDivision = (ws, key, { parent = null, name = null } = {}) => pool.query(
    `INSERT INTO workforce_divisions(workspace_id,key,name,parent_division_id,created_by_user_id)
     VALUES($1,$2,$3,$4,$5) RETURNING *`, [ws, key, name ?? key, parent, creator]);
  const own = (resource, division) => pool.query(
    `INSERT INTO workforce_division_ownership(resource_id,resource_kind,division_id,created_by_user_id)
     VALUES($1,'team',$2,$3) RETURNING *`, [resource, division, creator]);
  const fundingOf = async (resource) => (await pool.query(
    'SELECT division_id, revision FROM workforce_division_funding WHERE resource_id=$1', [resource])).rows[0];

  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); createdSchema = true;
    await pool.query('CREATE TABLE users(id UUID PRIMARY KEY)');
    for (const id of [owner, creator, head, agentHead]) await pool.query('INSERT INTO users VALUES($1)', [id]);
    for (const f of ['20260711120000-workspaces.sql', '20260905120000-workforce-resources.sql'])
      await pool.query((await read(f)).split('-- DOWN')[0]);

    // D16: a PERSONAL workspace is an ordinary workspaces row, which is the whole reason divisions
    // may live there. If this INSERT ever fails, D16's premise is wrong and the decision must be
    // revisited rather than the test relaxed.
    await pool.query(
      `INSERT INTO workspaces(id,owner_user_id,name,slug,workspace_type) VALUES($1,$2,'company','company','team')`,
      [companyWs, owner]);
    await pool.query(
      `INSERT INTO workspaces(id,owner_user_id,name,slug,workspace_type) VALUES($1,$2,'personal','personal','personal')`,
      [personalWs, owner]);
    await pool.query(
      `INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,'other','other')`, [otherWs, owner]);
    for (const [id, ws] of [[teamA, companyWs], [teamB, companyWs], [personalTeam, personalWs]])
      await pool.query(
        `INSERT INTO workforce_resources(id,kind,owner_workspace_id,name,created_by_user_id)
         VALUES($1,'team',$2,'t',$3)`, [id, ws, creator]);

    await pool.query(up);

    await t.test('the migration seeds NO divisions in any workspace (DIV-03, D16)', async () => {
      // "Optional everywhere and present nowhere by default" is the constraint that survived D16's
      // reversal. A workspace showing departments nobody created is worse than one with none.
      assert.equal((await pool.query('SELECT count(*) c FROM workforce_divisions')).rows[0].c, '0');
    });

    await t.test('a division belongs to exactly one workspace, personal as well as company (DIV-02, D16)', async () => {
      const company = (await mkDivision(companyWs, 'creative')).rows[0];
      assert.equal(company.workspace_id, companyWs);
      assert.equal(company.lifecycle, 'active');
      assert.equal(company.revision, '1');
      // D16, the assertion the first version of that decision would have failed.
      const personal = (await mkDivision(personalWs, 'creative')).rows[0];
      assert.equal(personal.workspace_id, personalWs,
        'a PERSONAL workspace may have divisions -- it is already a workspaces row');
      // DIV-03: the key is unique per workspace, not globally -- both workspaces just used
      // 'creative' and both succeeded.
      await deny(
        `INSERT INTO workforce_divisions(workspace_id,key,name,created_by_user_id) VALUES($1,'creative','dup',$2)`,
        [companyWs, creator], '23505');
      // The workspace is the tenancy fact; moving a division would re-tenant everything pointing
      // at it.
      await deny(`UPDATE workforce_divisions SET workspace_id=$2, revision=revision+1 WHERE id=$1`,
        [company.id, otherWs]);
    });

    // DIV-01's structural half: the record carries an optional parent FROM THE START, because
    // retrofitting a parent edge onto live grants is a security migration rather than an addition.
    // Its remaining clauses -- a division owns teams, has a head, carries a budget scope -- are
    // proven by the three cases below, not by this one.
    await t.test('divisions NEST, and a nested one cannot cross workspaces or cycle (DIV-01, D15)', async () => {
      const dev = (await mkDivision(companyWs, 'dev')).rows[0];
      const platform = (await mkDivision(companyWs, 'platform', { parent: dev.id })).rows[0];
      assert.equal(platform.parent_division_id, dev.id,
        'the parent column exists from day one -- v1 may refuse depth at the API, not in the schema');

      // A cross-workspace parent is UNREPRESENTABLE (composite FK), not merely checked: a trigger
      // could be bypassed by a direct UPDATE, and one-workspace-per-division is what the whole
      // tenancy argument rests on.
      const personalDev = (await mkDivision(personalWs, 'dev')).rows[0];
      await deny(
        `INSERT INTO workforce_divisions(workspace_id,key,name,parent_division_id,created_by_user_id)
         VALUES($1,'apps','apps',$2,$3)`, [companyWs, personalDev.id, creator], '23503');

      // Self-parent, then a real cycle two hops up. The composite FK pins the workspace; it cannot
      // see a loop.
      await deny(`UPDATE workforce_divisions SET parent_division_id=id, revision=revision+1 WHERE id=$1`, [dev.id]);
      await deny(`UPDATE workforce_divisions SET parent_division_id=$2, revision=revision+1 WHERE id=$1`,
        [dev.id, platform.id]);
    });

    // DIV-04 is asserted at the end of this case: at most ONE owning division per resource, said
    // by a primary key rather than by a trigger, so a second owner is unrepresentable. Its
    // containment half -- inside the resource's OWN workspace -- is the DIV-02 case below.
    // ⚠️ DIV-04's transfer clause (permanent until an explicit AUDITED transfer, OWN-05) has no
    // case here; an owner can be re-pointed by a plain UPDATE and nothing records who did it.
    await t.test('OWNING and FUNDING are two independent edges, defaulted not fused (DIV-04, D17)', async () => {
      const dev = (await pool.query(`SELECT id FROM workforce_divisions WHERE workspace_id=$1 AND key='dev'`,
        [companyWs])).rows[0];
      const office = (await mkDivision(companyWs, 'office')).rows[0];

      // Creating the owning edge DEFAULTS the funding edge -- the ergonomic half, so a small
      // workspace never meets the second concept.
      await own(teamA, dev.id);
      assert.equal((await fundingOf(teamA)).division_id, dev.id, 'funding defaults to the owning division');

      // ...and a DEFAULT IS NOT A FUSION. Re-point funding alone; ownership must not move.
      await pool.query(
        `UPDATE workforce_division_funding SET division_id=$2, revision=revision+1 WHERE resource_id=$1`,
        [teamA, office.id]);
      assert.equal((await fundingOf(teamA)).division_id, office.id, 'funding moved');
      assert.equal(
        (await pool.query('SELECT division_id FROM workforce_division_ownership WHERE resource_id=$1',
          [teamA])).rows[0].division_id, dev.id,
        'a team reports to dev while office pays for it -- the ordinary case, and the whole point of D17');

      // The reverse: moving the reporting line must not silently re-attribute spend.
      await pool.query(
        `UPDATE workforce_division_ownership SET division_id=$2, revision=revision+1 WHERE resource_id=$1`,
        [teamA, office.id]);
      assert.equal((await fundingOf(teamA)).division_id, office.id,
        'ownership moved without dragging the funding scope with it');

      // DIV-04: at most ONE owning division per resource, said by the primary key.
      await deny(
        `INSERT INTO workforce_division_ownership(resource_id,resource_kind,division_id,created_by_user_id)
         VALUES($1,'team',$2,$3)`, [teamA, dev.id, creator], '23505');
    });

    await t.test('an existing funding choice is never overwritten by a later ownership default (D17)', async () => {
      const dev = (await pool.query(`SELECT id FROM workforce_divisions WHERE workspace_id=$1 AND key='dev'`,
        [companyWs])).rows[0];
      const office = (await pool.query(`SELECT id FROM workforce_divisions WHERE workspace_id=$1 AND key='office'`,
        [companyWs])).rows[0];
      // Fund first, own second. The default must not clobber a scope somebody chose -- otherwise
      // the order of two independent acts would silently decide who pays.
      await pool.query(
        `INSERT INTO workforce_division_funding(resource_id,resource_kind,division_id,created_by_user_id)
         VALUES($1,'team',$2,$3)`, [teamB, office.id, creator]);
      await own(teamB, dev.id);
      assert.equal((await fundingOf(teamB)).division_id, office.id,
        'the deliberate funding choice survives a later ownership default');
    });

    await t.test('a resource cannot belong to another workspace\'s division (DIV-02)', async () => {
      const personalDev = (await pool.query(
        `SELECT id FROM workforce_divisions WHERE workspace_id=$1 AND key='dev'`, [personalWs])).rows[0];
      // teamA is owned by the company workspace; the division is in the personal one.
      await deny(
        `INSERT INTO workforce_division_ownership(resource_id,resource_kind,division_id,created_by_user_id)
         VALUES($1,'team',$2,$3)`, [teamA, personalDev.id, creator]);
      // ...and the personal team in its own workspace's division is fine, which is what makes the
      // assertion above about the WORKSPACE rather than about personal workspaces being special.
      const ok = await own(personalTeam, personalDev.id);
      assert.equal(ok.rows[0].division_id, personalDev.id);
    });

    await t.test('a head may be a human OR an agent, and its departure does not delete the division (DIV-06, ROLE-04)', async () => {
      const d = (await mkDivision(companyWs, 'comms')).rows[0];
      await pool.query(`UPDATE workforce_divisions SET head_principal_id=$2, revision=revision+1 WHERE id=$1`,
        [d.id, head]);
      // ROLE-04: an agent head is representable and intended. Both are rows in `users`; the model
      // does not distinguish them here, which is the point.
      await pool.query(`UPDATE workforce_divisions SET head_principal_id=$2, revision=revision+1 WHERE id=$1`,
        [d.id, agentHead]);
      await pool.query('DELETE FROM users WHERE id=$1', [agentHead]);
      const after = (await pool.query('SELECT head_principal_id, lifecycle FROM workforce_divisions WHERE id=$1',
        [d.id])).rows[0];
      assert.equal(after.head_principal_id, null, 'SET NULL: a headless division is a state, not a deletion');
      assert.equal(after.lifecycle, 'active', 'the division survived its head (OWN-05 continuity)');
    });

    await t.test('archive blocks new admissions, retains existing ones, and is one-way (OWN-06)', async () => {
      const d = (await mkDivision(companyWs, 'corpo')).rows[0];
      const resident = randomUUID();
      await pool.query(
        `INSERT INTO workforce_resources(id,kind,owner_workspace_id,name,created_by_user_id)
         VALUES($1,'team',$2,'resident',$3)`, [resident, companyWs, creator]);
      await own(resident, d.id);

      await pool.query(
        `UPDATE workforce_divisions SET lifecycle='archived', archived_at=now(), revision=revision+1 WHERE id=$1`,
        [d.id]);

      // Retained, not cascaded: the history stays attributable.
      assert.equal((await pool.query(
        'SELECT division_id FROM workforce_division_ownership WHERE resource_id=$1', [resident])).rows[0].division_id,
        d.id, 'archiving a division does not erase who belonged to it');

      const late = randomUUID();
      await pool.query(
        `INSERT INTO workforce_resources(id,kind,owner_workspace_id,name,created_by_user_id)
         VALUES($1,'team',$2,'late',$3)`, [late, companyWs, creator]);
      await deny(
        `INSERT INTO workforce_division_ownership(resource_id,resource_kind,division_id,created_by_user_id)
         VALUES($1,'team',$2,$3)`, [late, d.id, creator]);

      // Re-activating would silently re-admit work to a scope somebody deliberately closed.
      await deny(`UPDATE workforce_divisions SET lifecycle='active', revision=revision+1 WHERE id=$1`, [d.id]);
    });

    await t.test('revisions advance by exactly one, on the division and on both edges', async () => {
      const d = (await mkDivision(companyWs, 'platform-ops')).rows[0];
      await deny(`UPDATE workforce_divisions SET name='x', revision=revision+5 WHERE id=$1`, [d.id]);
      await deny(`UPDATE workforce_divisions SET name='x' WHERE id=$1`, [d.id]);
      await deny(`UPDATE workforce_division_ownership SET revision=revision+3 WHERE resource_id=$1`, [teamA]);
      await deny(`UPDATE workforce_division_funding SET revision=revision+3 WHERE resource_id=$1`, [teamA]);
    });

    // 🔴 DIV-10 IS THE ONE DIVISION RULE THAT ROTS SILENTLY, so it gets a gate rather than prose.
    // Every other requirement here fails loudly when broken -- a cycle is refused, a second owner
    // is refused. "Reuse the existing model" fails by ADDITION: somebody needing a division budget
    // adds `division_wallets`, it works, every test stays green, and the ecosystem now has a second
    // wallet whose balance can disagree with the ledger. That is the `organizations` mistake
    // (xeno-company SPEC §4.1) and the *"UI label mistaken for pool enforcement"* failure in one.
    await t.test('divisions add NO second wallet, roster, permission engine or audit stream (DIV-10)', async () => {
      const introduced = (await pool.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema=$1 AND table_name LIKE 'workforce_division%' ORDER BY table_name`,
        [schema])).rows.map((r) => r.table_name);
      // The division migration is allowed exactly three records: the division itself and its two
      // independent edges (D17). Anything else is a parallel mechanism wearing a division prefix.
      assert.deepEqual(introduced,
        ['workforce_division_funding', 'workforce_division_ownership', 'workforce_divisions'],
        'a fourth division table is a second mechanism -- extend an existing record instead');

      // Said again by MEANING rather than by name, because the rule is about the concept and a
      // table called `workforce_division_budgets` would pass the list above if it were added to it.
      const forbidden = (await pool.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema=$1
            AND table_name ~ '(wallet|balance|budget|roster|member|permission|role|grant|audit|event)'
            AND table_name LIKE '%division%'`, [schema])).rows.map((r) => r.table_name);
      assert.deepEqual(forbidden, [],
        'budget reuses the ledger allocation, authority reuses ReBAC, membership reuses the team record');

      // And the edges REUSE the canonical resource rather than describing their own: a row here
      // cannot name a resource the workforce model does not already own, which is what makes the
      // owning-division edge an attribute of the existing record instead of a second roster.
      await deny(
        `INSERT INTO workforce_division_ownership(resource_id,resource_kind,division_id,created_by_user_id)
         VALUES($1,'team',$2,$3)`,
        ['00000000-0000-4000-8000-0000000000dd',
         (await pool.query(`SELECT id FROM workforce_divisions WHERE workspace_id=$1 AND key='dev'`,
           [companyWs])).rows[0].id, creator], '23503');
    });

    await t.test('populated rollback is refused; empty rollback is clean and re-appliable', async () => {
      await assert.rejects(pool.query(down), error => error.code === '23514',
        'a rollback that would drop live structure is refused');
      await pool.query('DELETE FROM workforce_division_funding');
      await pool.query('DELETE FROM workforce_division_ownership');
      await pool.query('DELETE FROM workforce_divisions WHERE parent_division_id IS NOT NULL');
      await pool.query('DELETE FROM workforce_divisions');
      await pool.query(down);
      assert.equal((await pool.query(
        `SELECT count(*) c FROM information_schema.tables WHERE table_schema=$1 AND table_name LIKE 'workforce_division%'`,
        [schema])).rows[0].c, '0', 'DOWN removed every division table it created');
      await pool.query(up);
      assert.equal((await pool.query('SELECT count(*) c FROM workforce_divisions')).rows[0].c, '0',
        're-apply is clean and still seeds nothing');
    });
  } finally {
    if (createdSchema) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
