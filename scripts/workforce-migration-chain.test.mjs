/**
 * The workforce migration chain must be APPLIABLE from an empty database.
 *
 * This gate exists because it was already broken. On 2026-09-22 `origin/main` carried three
 * workforce migrations — team-membership snapshots, divisions, handoffs — whose foundation
 * (`20260905120000-workforce-resources` and two siblings) had never been committed. Two of the
 * three failed on their FIRST statement with `relation "workforce_resources" does not exist`, and
 * nothing reported it, because every workforce suite builds its own predecessors by name: each
 * one passes in a world where the chain as a whole cannot run.
 *
 * So this asserts the property no per-migration suite can: that applying every workforce migration
 * in timestamp order, on an empty database, succeeds. A migration that lands without its
 * predecessor fails HERE even though its own suite is green.
 *
 * Run: WORKFORCE_TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/workforceproof \
 *      node --test scripts/workforce-migration-chain.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { requireProofDatabase, workforceProofUnavailable } from './lib/workforce-proof-database.mjs';

const MIGRATIONS = new URL('../src/server/database/migrations/', import.meta.url);

/** Tables the workforce chain legitimately depends on but does not own. */
const PLATFORM_PRELUDE = `
  CREATE TABLE users(id UUID PRIMARY KEY);
  CREATE TABLE workspaces(
    id UUID PRIMARY KEY, owner_user_id UUID REFERENCES users(id),
    name TEXT NOT NULL, slug TEXT NOT NULL);
  CREATE TABLE api_keys(id UUID PRIMARY KEY, user_id UUID REFERENCES users(id));
  -- chat_projects as the chat migrations (20260825120000, 20260829120000) leave it, both of which
  -- precede the whole workforce chain in production. Modelled because ASN-09's project
  -- participation references it: from 20260924180000 on, the workforce chain has a real
  -- dependency outside itself, and a prelude that omits it would test a schema nobody runs.
  CREATE TABLE chat_projects(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID,
    owner_user_id UUID REFERENCES users(id), workspace_id UUID REFERENCES workspaces(id),
    name TEXT NOT NULL DEFAULT 'p', is_archived BOOLEAN NOT NULL DEFAULT false,
    CHECK ((owner_user_id IS NULL) <> (workspace_id IS NULL)));
`;

test('every workforce migration applies in order from an empty database', { skip: workforceProofUnavailable() }, async (t) => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);

  const schema = `workforce_chain_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 });

  const files = (await readdir(MIGRATIONS))
    .filter(f => f.endsWith('.sql') && /workforce/.test(f))
    .sort();                       // filenames are timestamp-prefixed, so lexical IS chronological

  let createdSchema = false;
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); createdSchema = true;
    await pool.query(PLATFORM_PRELUDE);

    await t.test('the chain is non-empty and starts at the foundation', () => {
      assert.ok(files.length >= 7, `expected the full workforce chain, found ${files.length}`);
      assert.ok(files[0].includes('workforce-resources'),
        `the chain must begin with the resource table, not ${files[0]} -- everything else FKs into it`);
    });

    await t.test('each migration applies on the state its predecessors left', async () => {
      const applied = [];
      for (const file of files) {
        const [up] = (await readFile(new URL(file, MIGRATIONS), 'utf8')).split('-- DOWN');
        try {
          await pool.query(up);
        } catch (error) {
          assert.fail(
            `${file} could not apply after [${applied.join(', ') || 'nothing'}]: ${error.message}\n` +
            `A migration that cannot apply from an empty database is unreachable in production ` +
            `however green its own suite is.`);
        }
        applied.push(file);
      }
      assert.equal(applied.length, files.length);
    });

    await t.test('the chain leaves no dangling foreign key', async () => {
      // A FK whose target is missing cannot exist in PostgreSQL -- so the real risk is the
      // inverse: a workforce table nobody references and nothing creates. Assert instead that
      // every workforce FK resolves to a table this chain or the prelude created.
      const { rows } = await pool.query(`
        SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.contype = 'f' AND n.nspname = $1`, [schema]);
      assert.ok(rows.length > 0, 'the workforce chain declares no foreign keys at all -- implausible');
      // `chat_projects` joined 2026-09-24 (ASN-09): project participation targets an EXISTING project,
      // because ASN-08 forbids a second project product. It is named here individually, and added to
      // the prelude above, rather than matched by a looser pattern -- a new external dependency of the
      // workforce chain is exactly the thing this gate exists to make somebody write down.
      for (const { parent } of rows) {
        const bare = parent.replace(/^.*\./, '');
        assert.ok(/^(workforce_|users$|workspaces$|api_keys$|chat_projects$)/.test(bare),
          `workforce schema references ${bare}, which is neither workforce-owned nor in the prelude`);
      }
    });

    await t.test('the foundation tables exist once the chain has run', async () => {
      const { rows } = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename LIKE 'workforce%'`, [schema]);
      const present = new Set(rows.map(r => r.tablename));
      for (const required of ['workforce_resources', 'workforce_workspace_assignments',
                              'workforce_team_memberships', 'workforce_divisions',
                              'workforce_handoffs', 'workforce_operations']) {
        assert.ok(present.has(required), `${required} missing after the full chain`);
      }
    });
    // 🔴 THE WHOLE WORKFORCE SCHEMA, PINNED — because a claim about what does NOT exist is the
    // easiest kind to be quietly wrong about, and this estate currently rests on one.
    //
    // XENO-WORKFORCE-01 carries 145 numbered requirements. Most are uncited by any test, and the
    // honest reason is NOT that somebody forgot to write tests: eight whole families — VIEW, SES,
    // RUN, MKT, FUND, ACCT, PUB, FORGE — create no tables between them, so there is nothing to
    // assert against and writing tests for them would be fabricating proof.
    //
    // That reasoning is load-bearing, and until now it was an assumption re-derived by hand every
    // time somebody asked. This turns it into a checked fact. The day a `workforce_funding_*` or
    // `workforce_listing_*` table lands, this fails — and the fix is NOT to widen the list. It is
    // that the requirements the new table implements have stopped being unbuildable and now need
    // real citations, which is exactly the moment that decision should be forced into the open.
    await t.test('the workforce schema is exactly these tables, and a new one invalidates the coverage premise', async () => {
      const { rows } = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename`, [schema]);
      const workforce = rows.map(r => r.tablename).filter(t => t.startsWith('workforce_'));

      assert.deepEqual(workforce, [
        'workforce_agent_versions',
        'workforce_assignment_member_sets',
        'workforce_assignment_members',
        'workforce_division_funding',
        'workforce_division_ownership',
        'workforce_divisions',
        'workforce_handoffs',
        // D21, 2026-09-25 -- the id mapping kept when `workspace_teams` was absorbed into the canonical
        // team model, cited by workforce-team-project-responsibility.test.mjs (the absorption case).
        'workforce_legacy_team_migration',
        'workforce_operations',
        // OWN-05, 2026-09-24 -- widened only because the requirement it implements is now cited by
        // a real test (workforce-ownership-transfer.test.mjs), exactly as the message below asks.
        'workforce_ownership_transfers',
        // ASN-09, 2026-09-24 -- the discriminated project-participation record, cited by
        // workforce-project-participation.test.mjs.
        'workforce_project_participations',
        'workforce_resource_operations',
        'workforce_resources',
        // RUN-01/RUN-02, 2026-09-25 -- one run's admission, resolved from authoritative state as the
        // intersection of every right it runs under; cited by workforce-run-admission.test.mjs.
        'workforce_run_admissions',
        // RUN-03/NFR-06/NFR-10, 2026-09-25 -- every run-authority lease ever issued (at most 60 s, monotonic
        // per admission) and the durable revocation that fences them; cited by workforce-run-authority.test.mjs.
        'workforce_run_leases',
        'workforce_run_revocations',
        'workforce_team_memberships',
        'workforce_workspace_assignments',
      ], 'the workforce schema changed. If a table was ADDED, the requirements it implements are ' +
         'no longer unimplementable and must be cited by real tests before this list is widened; ' +
         'if one was REMOVED, the citations that rest on it are now claiming something absent.');

      // The two api_key_* tables are workforce-scoped but deliberately NOT prefixed, because they
      // extend an existing platform table rather than standing alone. Asserted separately so the
      // list above stays a statement about the workforce schema and not about a naming accident.
      const apiKeyScoped = rows.map(r => r.tablename).filter(t => t.startsWith('api_key_workforce'));
      assert.deepEqual(apiKeyScoped, ['api_key_workforce_capabilities', 'api_key_workforce_operations']);
    });

    // LIFE-01's operative claim is the last sentence: "NO NEW CONSENT SHAPE -- this reuses
    // admission rather than inventing employment." Its other clauses are proven and cited
    // elsewhere (two-sided acceptance ASN-04, the admitted member set ASN-05, an explicit team
    // function ROLE-02, an owning division DIV-04). This is the one nothing could assert from
    // inside a single suite, because it is a claim about the ABSENCE of a mechanism anywhere in
    // the schema -- and the schema only exists in one place once the whole chain has run.
    //
    // 🔴 THE TELL IS THAT `workforce_team_memberships` HAS NO CONSENT COLUMN AT ALL. Joining a
    // team carries no acceptance of its own; a principal is put to work through machinery that
    // already existed. An `employment_accepted_by` appearing here would be the requirement's
    // exact failure -- inventing employment -- and it would look perfectly reasonable in review.
    await t.test('putting a principal to work invents no consent shape beyond the existing three (LIFE-01)', async () => {
      const { rows } = await pool.query(`
        SELECT c.table_name || '.' || c.column_name AS ref
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = $1 AND t.table_type = 'BASE TABLE'
          AND c.column_name ~ '(approv|accept|admit|consent|signed|agree|employ)'
        ORDER BY ref`, [schema]);

      // Deliberately NOT matching on 'sign': it hits as-SIGN-ment_id and reports four columns that
      // have nothing to do with consent. Found by running the query before writing the assertion,
      // which is the only reason this list is the real one.
      assert.deepEqual(rows.map(r => r.ref), [
        'workforce_assignment_member_sets.admitted_at',
        'workforce_assignment_member_sets.admitted_by_user_id',
        'workforce_handoffs.accepted_at',
        // OWN-05's DESTINATION ACCEPTANCE of an ownership move -- added 2026-09-24 with
        // 20260924160000-workforce-ownership-transfer.sql, and recorded here on purpose rather than
        // filtered out. It is a consent shape the spec REQUIRES ("ownership transfer requires ...
        // destination acceptance") and it is not a way of JOINING: it admits no principal to work,
        // grants no membership and touches no roster. It could not reuse the three below -- an
        // assignment never moves ownership (ASN-01) and a handoff "moves work, never authority".
        'workforce_ownership_transfers.accepted_at',
        'workforce_ownership_transfers.accepted_by_user_id',
        // ASN-09's personal-project CONSENT -- "personal-project participation binds directly to its
        // canonical personal owner/project and consent". Required by the spec, and like the transfer
        // acceptance above it is not a way of JOINING: the spec's own words are "External offers
        // create narrow engagements ... not corporate memberships", and the participation suite
        // asserts that creating one writes no workspace, tuple, team membership or assignment.
        'workforce_project_participations.consented_at',
        'workforce_project_participations.consented_by_user_id',
        // RUN-01's ADMISSION -- added 2026-09-25 with 20260925130000-workforce-run-admissions.sql. Not a
        // consent at all, and not a way of JOINING: it is the platform's DECISION that one run may start,
        // taken from rights that were already consented elsewhere (the assignment's two-sided acceptance,
        // the admitted member set, the participation's consent). It writes no membership, tuple or roster,
        // names no *_by_user_id of its own, and is immutable -- so it records WHEN, never a new WHO agreed.
        'workforce_run_admissions.admitted_at',
        'workforce_workspace_assignments.accepted_at',
        'workforce_workspace_assignments.source_approved_at',
        'workforce_workspace_assignments.source_approved_by_user_id',
        'workforce_workspace_assignments.target_accepted_by_user_id',
      ], 'a new consent-bearing column means a new consent shape. LIFE-01 forbids one for JOINING: ' +
         'a principal joins through the EXISTING two-sided assignment acceptance, the admitted ' +
         'member set, and -- for work already in flight -- handoff acceptance. If this list grew, ' +
         'either employment was invented rather than reused, or a new act that is not joining needs ' +
         'its consent recorded here with the requirement that demands it -- as OWN-05 transfer is.');

      // Said the other way round, because the assertion above would also pass if somebody deleted
      // the membership table outright: the table exists, and it holds no consent of its own.
      const membership = await pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
        [schema, 'workforce_team_memberships']);
      assert.equal(membership.rowCount, 1, 'the membership table must exist for its silence to mean anything');
    });

    // A resource's OWNER cannot move without its REVISION moving too.
    //
    // 🔴 IT COULD, measured before `20260923120000-workforce-owner-change-advances-revision`
    // existed: a plain UPDATE of `owner_user_id` succeeded and left `revision` at 1. Every
    // snapshot check in this chain compares revisions -- assignment acceptance refuses when
    // `resource.revision <> NEW.resource_revision` -- so an owner moved without a bump produces a
    // materially different resource that every version-based consumer believes is unchanged.
    // Tested HERE because the guard is a trigger on a table created many migrations earlier, and
    // this is the only suite in which the whole chain, and therefore the trigger, exists.
    //
    // ⚠️ NOT CITED AS OWN-05 HERE -- OWN-05 is proven in workforce-ownership-transfer.test.mjs,
    // against 20260924160000-workforce-ownership-transfer.sql, which builds the obligations this
    // note used to list as unbuilt: source authorization, destination acceptance, a review checked
    // against the declared secrets and licences, and a decision record the move commits under.
    // This case stays the smaller, true thing it always was -- a revision bump on ANY owner change,
    // including the transfer's own -- and the reason it was never titled OWN-05 still holds: the
    // first draft froze the owner columns, which would have claimed the requirement while making
    // the transfer impossible.
    await t.test('a resource owner cannot change without its revision advancing', async () => {
      const [humanA, humanB] = ['00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000a002'];
      const co = '00000000-0000-4000-8000-00000000c001';
      const personal = '00000000-0000-4000-8000-00000000e001';
      await pool.query('INSERT INTO users VALUES ($1), ($2)', [humanA, humanB]);
      await pool.query(`INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES ($1,$2,'co','co')`, [co, humanA]);
      await pool.query(`INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES ($1,'agent',$2,'p')`, [personal, humanA]);
      const revisionOf = async () => Number((await pool.query(
        'SELECT revision FROM workforce_resources WHERE id=$1', [personal])).rows[0].revision);

      const silent = (sql, values) => assert.rejects(pool.query(sql, values),
        e => e.code === '23514' && /without advancing revision/.test(e.message));
      // To another person, no bump.
      await silent('UPDATE workforce_resources SET owner_user_id=$2 WHERE id=$1', [personal, humanB]);
      // Personal -> company in ONE statement that keeps the XOR satisfied -- the tidiest form of
      // the defect, and the one a "move this to my company" feature writes first.
      await silent('UPDATE workforce_resources SET owner_user_id=NULL, owner_workspace_id=$2 WHERE id=$1', [personal, co]);
      assert.equal(await revisionOf(), 1, 'nothing moved and nothing was recorded');

      // The visible form is allowed -- transfer is meant to exist (OWN-01: "permanent until an
      // explicit, audited transfer"), so this must not be an immutability rule in disguise.
      await pool.query('UPDATE workforce_resources SET owner_user_id=NULL, owner_workspace_id=$2, revision=revision+1 WHERE id=$1',
        [personal, co]);
      assert.equal(await revisionOf(), 2);

      // And an edit that does not touch the owner is untouched by the rule.
      await pool.query(`UPDATE workforce_resources SET name='renamed' WHERE id=$1`, [personal]);
      assert.equal(await revisionOf(), 2, 'a rename is not an ownership change and carries no obligation here');
    });

  } finally {
    if (createdSchema) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
