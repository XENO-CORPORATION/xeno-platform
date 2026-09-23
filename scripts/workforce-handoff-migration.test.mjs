/**
 * XENO-WORKFORCE-01 §8.2c handoffs (HAND-01..HAND-06) and §8.2d LIFE-06/LIFE-07 under D19.
 *
 * Real PostgreSQL, owned isolated schema, no skipped proof.
 *
 * Run: WORKFORCE_TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/workforceproof \
 *      node --test scripts/workforce-handoff-migration.test.mjs
 */
/* ⚠️ NOT CITED FROM THIS SUITE, AND WHY. These are the acts §8.2d names; this migration LOGS
 * decisions about them, which is not the same as performing them.
 *   LIFE-01  joining is an ADMISSION, not a creation. `member.admit` is a recordable decision
 *            here; admission itself lives in the membership model.
 *   LIFE-02  removal is REVOCATION plus SETTLEMENT, and the two are separate. There is no
 *            settlement anywhere -- it is FUND-domain and unbuilt.
 *   LIFE-03  removal never deletes history. OWN-06 governs it and the membership suite proves it;
 *            this suite proves only that an OPERATION cannot be deleted.
 *   LIFE-04  evaluation is EVIDENCE-DERIVED, never a rating column. `evidence` being a real array
 *            is a precondition, proven above. Nothing derives an evaluation from it.
 *   LIFE-05  promotion changes a FUNCTION, never authority directly. `member.promote` is a
 *            loggable kind; the act belongs to the membership model.
 *   LIFE-08  objectives as the top of the work tree -- no table.
 *   LIFE-09  capacity is DERIVED, never declared -- nothing derives it.
 *
 *   NFR-03   "at most one effective contribution, reservation, settlement and result delivery per
 *            logical operation under duplicate requests/restarts." The durable-operation identity
 *            (actor_user_id, client_id, operation_id) genuinely delivers at-most-once and is
 *            proven above -- but NFR-03's four nouns are all FUND-domain concepts with no tables,
 *            so citing it would claim the funding half on the strength of the plumbing half. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { requireProofDatabase, workforceProofUnavailable } from './lib/workforce-proof-database.mjs';

test('handoffs and decision records on owned isolated PostgreSQL', { skip: workforceProofUnavailable() }, async (t) => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);

  const schema = `workforce_handoff_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  const read = f => readFile(new URL(`../src/server/database/migrations/${f}`, import.meta.url), 'utf8');
  const draft = await read('20260922130000-workforce-handoffs-and-decisions.sql');
  const [up, down] = draft.split('-- DOWN');

  const owner = randomUUID(), creator = randomUUID();
  const humanManager = randomUUID(), agentManager = randomUUID(), worker = randomUUID();
  const companyWs = randomUUID();
  let createdSchema = false;

  const deny = (sql, values = [], code = '23514') =>
    assert.rejects(pool.query(sql, values), error => error.code === code);
  const sha = s => createHash('sha256').update(s).digest('hex');

  const record = ({ kind = 'member.admit', subject = randomUUID(), subjectType = 'membership',
                    decider = humanManager, responsible = humanManager, authority = 'team:manager',
                    rationale = null, evidence = [], supersedes = null, op = randomUUID(),
                    client = 'test-client' } = {}) => pool.query(
    `INSERT INTO workforce_operations(actor_user_id,client_id,operation_id,request_hash,kind,
       subject_type,subject_id,deciding_principal_id,responsible_account_id,authority,rationale,
       evidence,supersedes_operation_id,workspace_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [decider, client, op, sha(op), kind, subjectType, subject, decider, responsible, authority,
     rationale, JSON.stringify(evidence), supersedes, companyWs]);

  const offer = ({ source = worker, target = humanManager, workType = 'task', work = randomUUID(),
                   srcDiv = null, tgtDiv = null } = {}) => pool.query(
    `INSERT INTO workforce_handoffs(source_principal_id,target_principal_id,work_ref_type,work_ref_id,
       source_workspace_id,target_workspace_id,source_division_id,target_division_id)
     VALUES($1,$2,$3,$4,$5,$5,$6,$7) RETURNING *`,
    [source, target, workType, work, companyWs, srcDiv, tgtDiv]);

  const accept = (id, payer) => pool.query(
    `UPDATE workforce_handoffs SET state='accepted',accepted_at=now(),payer_account_id=$2,
       revision=revision+1 WHERE id=$1 RETURNING *`, [id, payer]);

  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); createdSchema = true;
    await pool.query('CREATE TABLE users(id UUID PRIMARY KEY)');
    for (const id of [owner, creator, humanManager, agentManager, worker])
      await pool.query('INSERT INTO users VALUES($1)', [id]);
    for (const f of ['20260711120000-workspaces.sql', '20260905120000-workforce-resources.sql',
                     '20260922120000-workforce-divisions.sql'])
      await pool.query((await read(f)).split('-- DOWN')[0]);
    await pool.query(
      `INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,'company','company')`, [companyWs, owner]);

    await pool.query(up);

    await t.test('the decision record is a VIEW, not a second write path (D19)', async () => {
      // D19's whole point: §12.1 forbids "two independently writable authorities", so a decision
      // cannot exist without its effect. If this ever becomes a table, that guarantee is gone.
      const kind = (await pool.query(
        `SELECT table_type FROM information_schema.tables WHERE table_schema=$1 AND table_name='workforce_decision_records'`,
        [schema])).rows[0];
      assert.equal(kind.table_type, 'VIEW', 'workforce_decision_records must be a projection');

      const op = (await record({ rationale: 'headcount approved for Q4' })).rows[0];
      const projected = (await pool.query(
        'SELECT * FROM workforce_decision_records WHERE operation_id=$1', [op.operation_id])).rows[0];
      assert.equal(projected.decided, 'member.admit');
      assert.equal(projected.rationale, 'headcount approved for Q4');
      assert.equal(projected.committed_at.toISOString(), op.committed_at.toISOString());
    });

    // LIFE-06 enumerates six elements: who decided, WHAT was decided, under which AUTHORITY, on
    // what EVIDENCE, when, and what it SUPERSEDED. "Who" is the case below (LIFE-07) and "when" is
    // asserted by the D19 projection above; the three in the middle had nothing.
    // 🔴 `authority` is the one that decides whether this table is the DELIBERATIVE layer the
    // requirement asks for or just a second operational log. §15 already records state changes and
    // authorization reasons. What a decision record adds is the reasoning a successor agent needs,
    // and a blank authority makes the row indistinguishable from the log it was meant to improve
    // on -- so emptiness is refused, not merely discouraged.
    await t.test('a decision records its authority, its evidence and what it superseded (LIFE-06)', async () => {
      const first = (await record({ authority: 'team:manager', evidence: [{ kind: 'review', ref: 'r-1' }],
                                    rationale: 'sustained delivery over two cycles' })).rows[0];
      assert.equal(first.authority, 'team:manager');
      assert.deepEqual(first.evidence, [{ kind: 'review', ref: 'r-1' }],
        'evidence survives the round trip as structured data, not as prose about evidence');

      // Superseding is a LINK, so a later reader can follow why a decision was replaced rather
      // than finding two unrelated rows and guessing which one is current.
      const second = (await record({ kind: 'member.promote', supersedes: first.operation_id })).rows[0];
      assert.equal(second.supersedes_operation_id, first.operation_id);

      // Authority is NOT NULL **and** non-blank. NOT NULL alone is satisfied by a space.
      await assert.rejects(record({ authority: '   ' }), e => e.code === '23514',
        'whitespace is not an authority -- the CHECK trims before measuring');
      await deny(
        `INSERT INTO workforce_operations(actor_user_id,client_id,operation_id,request_hash,kind,
           subject_type,subject_id,deciding_principal_id,responsible_account_id)
         VALUES($1,'c',$2,$3,'member.admit','membership',$4,$1,$1)`,
        [humanManager, randomUUID(), sha('a'), randomUUID()], '23502');

      // Evidence is an ARRAY. A bare object would read as "one piece of evidence" and quietly
      // break every consumer that iterates, which is worse than refusing it.
      await deny(
        `INSERT INTO workforce_operations(actor_user_id,client_id,operation_id,request_hash,kind,
           subject_type,subject_id,deciding_principal_id,responsible_account_id,authority,evidence)
         VALUES($1,'c',$2,$3,'member.admit','membership',$4,$1,$1,'x','{"kind":"review"}'::jsonb)`,
        [humanManager, randomUUID(), sha('b'), randomUUID()]);

      // ...and it COVERS the acts LIFE-06 names, rather than just the handoff ones this migration
      // was written for. Each is accepted by a real insert; the suite would otherwise never write
      // one and the enumeration could be narrowed with nothing failing.
      for (const [kind, subjectType] of [['member.admit', 'membership'], ['member.remove', 'membership'],
        ['member.promote', 'membership'], ['division.assign', 'division'], ['budget.set', 'budget']]) {
        const row = (await record({ kind, subjectType })).rows[0];
        assert.equal(row.kind, kind, `${kind} is a recordable decision`);
      }
      await deny(
        `INSERT INTO workforce_operations(actor_user_id,client_id,operation_id,request_hash,kind,
           subject_type,subject_id,deciding_principal_id,responsible_account_id,authority)
         VALUES($1,'c',$2,$3,'member.vibe','membership',$4,$1,$1,'x')`,
        [humanManager, randomUUID(), sha('c'), randomUUID()]);
    });

    await t.test('a decision names BOTH the deciding principal and the responsible account (LIFE-07)', async () => {
      // "An agent decided" is not an accountability answer. An agent manager records under its own
      // principal while its owner remains answerable.
      const op = (await record({ decider: agentManager, responsible: humanManager,
                                 authority: 'division:head', kind: 'division.assign',
                                 subjectType: 'division' })).rows[0];
      assert.equal(op.deciding_principal_id, agentManager);
      assert.equal(op.responsible_account_id, humanManager);
      assert.notEqual(op.deciding_principal_id, op.responsible_account_id,
        'the two are independently recorded, not one inferred from the other');

      // Both are NOT NULL: a decision with no responsible account is unrepresentable.
      await deny(
        `INSERT INTO workforce_operations(actor_user_id,client_id,operation_id,request_hash,kind,
           subject_type,subject_id,deciding_principal_id,authority)
         VALUES($1,'c',$2,$3,'member.admit','membership',$4,$1,'x')`,
        [agentManager, randomUUID(), sha('x'), randomUUID()], '23502');
    });

    await t.test('operations are immutable and idempotent per logical request (§12.1)', async () => {
      const op = randomUUID();
      await record({ op });
      // A retry of the SAME logical request collides rather than repeating the effect.
      await assert.rejects(record({ op }), e => e.code === '23505',
        'the same (actor, client, operation) is one row, however many times it is retried');
      await deny(`UPDATE workforce_operations SET rationale='rewritten' WHERE operation_id=$1`, [op]);
      await deny(`DELETE FROM workforce_operations WHERE operation_id=$1`, [op]);
    });

    await t.test('a handoff carries NO authority column (HAND-02)', async () => {
      // Said by the schema rather than by a comment: there is no grant, capability or scope column
      // to carry from source to target. The receiver executes under its OWN admitted rights.
      const cols = (await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='workforce_handoffs'`,
        [schema])).rows.map(r => r.column_name);
      for (const forbidden of ['granted_scope', 'capabilities', 'authority', 'permissions', 'grants']) {
        assert.ok(!cols.includes(forbidden),
          `a handoff must not carry ${forbidden} -- that would be the runtime inventing an entitlement`);
      }
      assert.ok(cols.includes('payer_account_id') && cols.includes('state'));
    });

    await t.test('offered until accepted; an unaccepted handoff never executes (HAND-03)', async () => {
      const h = (await offer()).rows[0];
      assert.equal(h.state, 'offered');
      assert.equal(h.accepted_at, null);
      assert.equal(h.payer_account_id, null, 'an offer has no payer -- nothing has executed');

      // Accepting without a payer is unrepresentable: HAND-05 is a shape constraint, not a habit.
      await deny(`UPDATE workforce_handoffs SET state='accepted',accepted_at=now(),revision=revision+1 WHERE id=$1`,
        [h.id]);

      const accepted = (await accept(h.id, humanManager)).rows[0];
      assert.equal(accepted.state, 'accepted');
      assert.equal(accepted.payer_account_id, humanManager);

      // Terminal is terminal -- re-opening would execute work nobody currently agreed to.
      await deny(`UPDATE workforce_handoffs SET state='declined',resolved_at=now(),revision=revision+1 WHERE id=$1`,
        [accepted.id]);

      // ⚠️ The assertion above passes even with the terminal-state guard DELETED, because the
      // accepted-shape CHECK refuses that same transition -- found by mutation sweep, not by
      // reading. The case that isolates the GUARD is one the CHECKs permit on both sides:
      // declined -> offered carries no accepted_at and no payer either way.
      const declined = (await offer()).rows[0];
      await pool.query(`UPDATE workforce_handoffs SET state='declined',resolved_at=now(),revision=revision+1
        WHERE id=$1`, [declined.id]);
      await deny(`UPDATE workforce_handoffs SET state='offered',resolved_at=NULL,revision=revision+1 WHERE id=$1`,
        [declined.id]);
    });

    await t.test('an expired handoff is resolved without ever executing (HAND-03)', async () => {
      const h = (await offer()).rows[0];
      const expired = (await pool.query(
        `UPDATE workforce_handoffs SET state='expired',resolved_at=now(),revision=revision+1
         WHERE id=$1 RETURNING *`, [h.id])).rows[0];
      assert.equal(expired.state, 'expired');
      assert.equal(expired.accepted_at, null);
      assert.equal(expired.payer_account_id, null, 'expiry leaves no payer -- nothing was executed to bill');
    });

    await t.test('consumption is billed to the EXECUTING side, never the sender (HAND-05)', async () => {
      const h = (await offer({ source: worker, target: humanManager })).rows[0];
      // "Bill the sender" is the natural-looking mistake, which is why it is a constraint.
      await deny(`UPDATE workforce_handoffs SET state='accepted',accepted_at=now(),
        payer_account_id=$2, revision=revision+1 WHERE id=$1`, [h.id, worker]);
      const ok = (await accept(h.id, humanManager)).rows[0];
      assert.equal(ok.payer_account_id, humanManager);
    });

    // DIV-09 is cited here because this case proves its load-bearing half: a cross-division
    // handoff is ACCEPTED (not refused as an error case) and the crossing is RECORDED as the two
    // division ids rather than a boolean. Its three remaining clauses are proven by neighbouring
    // cases in this same suite -- moves work never authority (HAND-02), bills the executing side
    // (HAND-05), offered until accepted (HAND-03) -- and are cited there.
    await t.test('endpoints and crossed scopes are immutable (HAND-04, DIV-09)', async () => {
      const creative = (await pool.query(
        `INSERT INTO workforce_divisions(workspace_id,key,name,created_by_user_id)
         VALUES($1,'creative','creative',$2) RETURNING *`, [companyWs, creator])).rows[0];
      const office = (await pool.query(
        `INSERT INTO workforce_divisions(workspace_id,key,name,created_by_user_id)
         VALUES($1,'office','office',$2) RETURNING *`, [companyWs, creator])).rows[0];

      // DIV-09: cross-division handoff is the NORMAL case, and the crossing is recorded.
      const h = (await offer({ srcDiv: creative.id, tgtDiv: office.id })).rows[0];
      assert.equal(h.source_division_id, creative.id);
      assert.equal(h.target_division_id, office.id);

      // Changing what was crossed would make an accepted handoff a different handoff.
      await deny(`UPDATE workforce_handoffs SET target_division_id=$2, revision=revision+1 WHERE id=$1`,
        [h.id, creative.id]);
      await deny(`UPDATE workforce_handoffs SET work_ref_id=$2, revision=revision+1 WHERE id=$1`,
        [h.id, randomUUID()]);
    });

    // HAND-01 is the requirement that says a handoff is a RECORD, not a message -- and the whole
    // force of that distinction is that the record cannot be incomplete. A message can omit its
    // subject and still be sent; a row that permits NULL where the requirement enumerates a field
    // is a message with a table around it. So this asserts the enumerated elements are STRUCTURAL:
    // who handed off, to whom, and about what are each refused when absent, and the work reference
    // is a typed pair rather than free text.
    await t.test('a handoff cannot exist without its who, to-whom and about-what (HAND-01)', async () => {
      const work = randomUUID();
      for (const [column, sql] of [
        ['source_principal_id',
         `INSERT INTO workforce_handoffs(target_principal_id,work_ref_type,work_ref_id) VALUES($1,'task',$2)`],
        ['target_principal_id',
         `INSERT INTO workforce_handoffs(source_principal_id,work_ref_type,work_ref_id) VALUES($1,'task',$2)`],
        ['work_ref_type',
         `INSERT INTO workforce_handoffs(source_principal_id,target_principal_id,work_ref_id) VALUES($1,$2,$2)`],
      ]) {
        await deny(sql, column === 'work_ref_type' ? [worker, humanManager] : [worker, work], '23502',
          `${column} is NOT NULL, so an incomplete handoff is unrepresentable`);
      }
      // work_ref_id has no default either -- listed separately because the three-argument shape above
      // cannot express it without also omitting a second column, which would prove nothing about
      // WHICH omission was refused.
      await deny(
        `INSERT INTO workforce_handoffs(source_principal_id,target_principal_id,work_ref_type)
         VALUES($1,$2,'task')`, [worker, humanManager], '23502');

      // The work reference is a TYPED pair. `task|project|run` are the three things §8.2c hands off;
      // a fourth would be invented rather than derived, exactly as with ROLE-02's three functions.
      await deny(
        `INSERT INTO workforce_handoffs(source_principal_id,target_principal_id,work_ref_type,work_ref_id)
         VALUES($1,$2,'message',$3)`, [worker, humanManager, work]);

      // And the elements that make it durable rather than transient: a fresh handoff is `offered`
      // with a revision, carries its own identity, and records the scopes it crossed -- read back
      // from the row rather than assumed from the insert.
      const h = (await offer({ work })).rows[0];
      assert.equal(h.state, 'offered', 'a handoff begins un-accepted -- HAND-03');
      assert.equal(Number(h.revision), 1);
      assert.equal(h.work_ref_id, work);
      assert.equal(h.source_workspace_id, companyWs);
      assert.ok(h.id && h.created_at, 'it is a row with an identity, not an event that was emitted');
    });

    await t.test('a principal cannot hand work to itself', async () => {
      await deny(
        `INSERT INTO workforce_handoffs(source_principal_id,target_principal_id,work_ref_type,work_ref_id)
         VALUES($1,$1,'task',$2)`, [worker, randomUUID()]);
    });

    // NFR-02 has two halves and they fail in opposite directions.
    //   "no silent truncation of retained history" -- proven by the immutability and no-TRUNCATE
    //     triggers, and by the populated-rollback refusal in the case below.
    //   "zero acknowledged-record loss across FORCED PROCESS TERMINATION" -- proven by nothing,
    //     because every existing case closes its connection politely. A graceful close is the one
    //     shutdown that says nothing about durability.
    // So this kills the socket outright, mid-session, with no client-side cleanup, and asserts
    // both directions: what was ACKNOWLEDGED survives, and what was never acknowledged does NOT
    // come back. The second half matters as much as the first -- a store that resurrected an
    // uncommitted write would also be losing the guarantee, just in the flattering direction.
    await t.test('an acknowledged decision survives a killed connection; an unacknowledged one does not (NFR-02)', async () => {
      const kill = async prepare => {
        const client = new pg.Client({ connectionString, options: `-c search_path=${schema}` });
        client.on('error', () => {});           // the destroy below surfaces here; it is expected
        await client.connect();
        const op = await prepare(client);
        // Not `client.end()`. That flushes and says goodbye, which is exactly the shutdown this
        // case is NOT about. Destroying the stream is the closest thing to `kill -9` reachable
        // from a test: the server sees the connection vanish with no termination message.
        client.connection.stream.destroy();
        await new Promise(resolve => setTimeout(resolve, 50));
        return op;
      };
      const present = async op => Number((await pool.query(
        'SELECT count(*) c FROM workforce_operations WHERE operation_id=$1', [op])).rows[0].c);

      // ACKNOWLEDGED: the INSERT committed and the server said so before the socket died.
      const kept = await kill(async client => {
        const op = randomUUID();
        await client.query(
          `INSERT INTO workforce_operations(actor_user_id,client_id,operation_id,request_hash,kind,
             subject_type,subject_id,deciding_principal_id,responsible_account_id,authority)
           VALUES($1,'killed',$2,$3,'member.admit','membership',$4,$1,$1,'team:manager')`,
          [humanManager, op, sha(op), randomUUID()]);
        return op;
      });
      assert.equal(await present(kept), 1,
        'a committed decision is still there after the connection was destroyed, not closed');

      // UNACKNOWLEDGED: the same INSERT, inside a transaction that never reached COMMIT.
      const lost = await kill(async client => {
        const op = randomUUID();
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO workforce_operations(actor_user_id,client_id,operation_id,request_hash,kind,
             subject_type,subject_id,deciding_principal_id,responsible_account_id,authority)
           VALUES($1,'killed',$2,$3,'member.admit','membership',$4,$1,$1,'team:manager')`,
          [humanManager, op, sha(op), randomUUID()]);
        return op;                               // no COMMIT -- the client dies holding it open
      });
      assert.equal(await present(lost), 0,
        'an uncommitted write is rolled back by the server when the connection dies, never resurrected');

      // ...and the surviving row is still subject to the retention rules, so "it came back" and
      // "it can now be quietly removed" are not two ways of passing this case.
      await deny(`DELETE FROM workforce_operations WHERE operation_id=$1`, [kept]);
      await deny('TRUNCATE workforce_operations');
    });

    await t.test('populated rollback is refused; empty rollback is clean and re-appliable', async () => {
      await assert.rejects(pool.query(down), e => e.code === '23514');
      // The operations table refuses DELETE by design, so prove the refusal, then drop the
      // immutability trigger deliberately to clear the fixture -- an operator act, not a code path.
      await deny(`DELETE FROM workforce_operations`, []);
      await pool.query('DROP TRIGGER workforce_operations_immutable ON workforce_operations');
      await pool.query('DELETE FROM workforce_operations');
      await pool.query('DELETE FROM workforce_handoffs');
      await pool.query(`CREATE TRIGGER workforce_operations_immutable
        BEFORE UPDATE OR DELETE ON workforce_operations
        FOR EACH ROW EXECUTE FUNCTION workforce_operation_immutable()`);
      await pool.query(down);
      assert.equal((await pool.query(
        `SELECT count(*) c FROM information_schema.tables
         WHERE table_schema=$1 AND table_name IN ('workforce_operations','workforce_handoffs')`,
        [schema])).rows[0].c, '0', 'DOWN removed both tables');
      await pool.query(up);
      assert.equal((await pool.query('SELECT count(*) c FROM workforce_handoffs')).rows[0].c, '0');
    });
  } finally {
    if (createdSchema) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
