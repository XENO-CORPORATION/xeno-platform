/**
 * XENO-WORKFORCE-01 LIFE-09 -- capacity is DERIVED, never declared.
 *
 *   LIFE-09: "How much a workforce can take on is a projection over active admissions, remaining
 *            budget envelopes (RUN-10) and in-flight runs -- the same discipline as DIV-07's
 *            ledger-derived balance. A stored headcount or capacity number is a cache with no
 *            invalidation, which is the failure mode this estate records most often."
 *
 * Runs on the migrated schema (TEST_DATABASE_URL) against services/workforceCapacity.js and the views in
 * 20260927100000-workforce-derived-capacity.sql, with real admissions, leases, revocations and ledger holds
 * -- the rows capacity is derived from -- produced by the real services that write them.
 *
 * What is asserted is the requirement's own shape, both halves:
 *   DERIVED  every figure moves the instant the row it is derived from moves -- a lease issued, a lease
 *            expiring, a run revoked, a hold placed -- with nothing written in between. A cache would
 *            lag at least one of these; the test changes each and reads straight back.
 *   NEVER DECLARED  there is no capacity column or table anywhere in the schema to declare one in, and a
 *            read writes nothing.
 *
 * Mutation-checked 2026-09-27, each fails the named assertion; restored passes:
 *   - a revoked admission still counts as active        -> "a revoked run stops counting at once"
 *   - an expired lease still counts as in flight        -> "a lease that expired is not work in flight"
 *   - committed spend counts revoked runs                -> "committed spend is the ceilings of ACTIVE runs"
 *   - headroom ignores live holds                        -> "headroom is the balance less live holds"
 *   - a viewer sees another payer's balance              -> "a viewer learns that a run is funded, not how much"
 *   - the read is not authorized like the catalog        -> "an unreadable scope answers like a missing one"
 *   - capacity is stored in a table                      -> "no capacity is stored anywhere in the schema"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, generateKeyPairSync } from 'node:crypto';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;

test('capacity is derived from live admissions, leases and holds, and never stored (LIFE-09)', { skip: !url, timeout: 120000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(() => pool.end());
  assert.ok((await pool.query("SELECT to_regclass('workforce_scope_capacity') AS v")).rows[0].v, 'this suite runs on the migrated schema');
  const { admitRun } = await import('../src/server/services/workforceRunAdmission.js');
  const { authorizeRunStep, revokeRun } = await import('../src/server/services/workforceRunAuthority.js');
  const { readWorkforceCapacity } = await import('../src/server/services/workforceCapacity.js');

  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signingKey = { kid: 'capacity-test', privatePem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const marker = `cap-${randomUUID().slice(0, 8)}`;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const explicit = (caps) => ({ schemaVersion: 1, mode: 'explicit', capabilities: caps });
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$1,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const fund = (u, micro) => pool.query(`INSERT INTO credit_accounts(user_id,balance) VALUES($1,$2)
    ON CONFLICT (user_id) DO UPDATE SET balance=EXCLUDED.balance`, [u, micro]);
  const tuple = (type, id, rel, u) => pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
    VALUES($1,$2,$3,'user',$4)`, [type, id, rel, u]);
  const ctx = (actorUserId) => ({ actorUserId, clientId: 'xeno-agent-interface' });
  const rejects = (p, code, message) => assert.rejects(p, (e) => e.code === code, message);

  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), stranger = await user('stranger');
  await fund(owner, 9_000_000n); await fund(editor, 7_000_000n);
  const ws = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-ws`])).rows[0].id;
  await tuple('workspace', ws, 'owner', owner); await tuple('workspace', ws, 'editor', editor); await tuple('workspace', ws, 'viewer', viewer);
  const lender = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [stranger, `${marker}-lender`])).rows[0].id;
  const agent = async (name) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO workforce_resources(id,kind,owner_workspace_id,name) VALUES($1,'agent',$2,$3)`, [id, lender, name]);
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)`,
      [id, { instructions: name, skills: [], requestedCapabilities: ['files.read'], secretReferences: [] }, hash(`${id}:1`)]);
    const rev = (await pool.query('SELECT revision FROM workforce_resources WHERE id=$1', [id])).rows[0].revision;
    const a = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,
      resource_revision,policy) VALUES($1,'agent',$2,$3,$4,$5) RETURNING id`, [id, ws, lender, rev, explicit(['files.read'])])).rows[0].id;
    await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted', revision=revision+1, source_approved_by_user_id=$2,
      source_approved_at=clock_timestamp(), target_accepted_by_user_id=$2, accepted_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [a, owner]);
    return { id, assignment: a };
  };
  const admit = async (actor, a, ceiling) => (await admitRun(pool, ctx(actor), { operationId: randomUUID(),
    agent: { resourceId: a.id, version: 1, contentHash: hash(`${a.id}:1`) }, target: { kind: 'workspace', assignmentId: a.assignment },
    capabilities: ['files.read'], budget: { ceilingMicro: String(ceiling) } })).admission.admissionId;
  const read = (actor = owner) => readWorkforceCapacity(pool, ctx(actor), { owner: { type: 'workspace', id: ws }, expectedActorAccountId: actor });

  const alpha = await agent('Alpha'), beta = await agent('Beta');

  await t.test('an idle workspace reads as zero, derived rather than defaulted', async () => {
    const c = await read();
    assert.deepEqual([c.activeAdmissions, c.inFlightRuns, c.activeAgents, c.committedCeilingMicro, c.funding], [0, 0, 0, '0', []]);
    assert.ok(Number.isFinite(Date.parse(c.derivedAt)), 'every read says when it was derived');
  });

  let first, second;
  await t.test('admitting and stepping runs moves capacity with no write in between', async () => {
    first = await admit(editor, alpha, 1_000_000);
    second = await admit(owner, beta, 2_500_000);
    let c = await read();
    assert.equal(c.activeAdmissions, 2);
    assert.equal(c.activeAgents, 2);
    assert.equal(c.committedCeilingMicro, '3500000', 'committed spend is the ceilings of ACTIVE runs');
    assert.equal(c.inFlightRuns, 0, 'an admitted run with no lease is not yet doing anything');
    await authorizeRunStep(pool, ctx(editor), { admissionId: first, operation: 'provider_dispatch' }, { signingKey });
    c = await read();
    assert.equal(c.inFlightRuns, 1, 'a live lease is work in flight, the moment it is issued');
  });

  await t.test('a lease that expires stops counting, with nothing recomputed', async () => {
    // Leases are immutable, so a live one cannot be aged. A run whose only lease was a real, valid lease
    // that has since run out is exactly the case: same row shape, same 60 s bound, just in the past.
    const lapsed = await admit(owner, alpha, 100_000);
    await pool.query(`INSERT INTO workforce_run_leases(admission_id,sequence,operation,effective_capabilities,issued_at,expires_at,signing_kid,token_hash)
      VALUES($1,1,'provider_dispatch','["files.read"]',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '90 seconds','k',$2)`,
    [lapsed, hash(`lapsed:${lapsed}`)]);
    const c = await read();
    assert.equal(c.activeAdmissions, 3, 'the lapsed run is still admitted');
    assert.equal(c.inFlightRuns, 1, 'a lease that expired is not work in flight');
    await revokeRun(pool, ctx(owner), lapsed);
  });

  await t.test('a revoked run stops counting at once, and its committed ceiling with it', async () => {
    await revokeRun(pool, ctx(owner), second);
    const c = await read();
    assert.equal(c.activeAdmissions, 1, 'a revoked run stops counting at once');
    assert.equal(c.committedCeilingMicro, '1000000', 'committed spend is the ceilings of ACTIVE runs');
    assert.deepEqual(c.funding.map((f) => f.payerUserId), [editor], 'only payers of runs still active are listed');
  });

  await t.test('headroom is the payer\'s balance less its live holds, as admission computes it', async () => {
    assert.equal((await read()).funding[0].availableMicro, '7000000');
    await pool.query(`INSERT INTO credit_holds(user_id,hold_id,surface,operation,amount_micro,settled_micro,state,expires_at)
      VALUES($1,$2,'test','test',2500000,500000,'held',now()+interval '1 hour')`, [editor, randomUUID()]);
    assert.equal((await read()).funding[0].availableMicro, '5000000', 'headroom is the balance less live holds');
    await pool.query(`INSERT INTO credit_holds(user_id,hold_id,surface,operation,amount_micro,state,expires_at)
      VALUES($1,$2,'test','test',9000000,'held',now()-interval '1 minute')`, [editor, randomUUID()]);
    assert.equal((await read()).funding[0].availableMicro, '5000000', 'an expired hold holds nothing');
    await pool.query('UPDATE credit_accounts SET is_frozen=true WHERE user_id=$1', [editor]);
    assert.equal((await read()).funding[0].canFund, false, 'a frozen payer cannot fund');
    await pool.query('UPDATE credit_accounts SET is_frozen=false WHERE user_id=$1', [editor]);
  });

  await t.test('who may read it, and what each reader learns', async () => {
    const asEditor = (await read(editor)).funding[0];
    assert.equal(asEditor.availableMicro, '5000000', 'a payer sees its own headroom');
    const asViewer = (await read(viewer)).funding[0];
    assert.equal(asViewer.canFund, true);
    assert.ok(!Object.hasOwn(asViewer, 'availableMicro'), 'a viewer learns that a run is funded, not how much');
    assert.equal((await read(owner)).funding[0].availableMicro, '5000000', 'a workspace administrator sees what funds its runs');
    const refusal = (p) => p.then(() => 'allowed', (e) => JSON.stringify({ code: e.code, details: e.details }));
    const unreadable = await refusal(read(stranger));
    const missing = await refusal(readWorkforceCapacity(pool, ctx(stranger), { owner: { type: 'workspace', id: randomUUID() }, expectedActorAccountId: stranger }));
    assert.notEqual(unreadable, 'allowed', 'an unreadable scope answers like a missing one');
    assert.equal(unreadable, missing, 'an unreadable scope answers like a missing one');
    await rejects(readWorkforceCapacity(pool, ctx(editor), { owner: { type: 'workspace', id: ws }, expectedActorAccountId: owner }), 'denied',
      'the expected-actor precondition holds');
    await rejects(readWorkforceCapacity(pool, ctx(editor), { owner: { type: 'workspace', id: ws }, expectedActorAccountId: editor, capacity: 9 }), 'bad_input',
      'there is no way to declare a capacity');
  });

  await t.test('no capacity is stored anywhere in the schema, and reading writes nothing', async () => {
    const stored = (await pool.query(`SELECT c.table_name || '.' || c.column_name AS ref FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
      WHERE c.table_schema = current_schema() AND t.table_type='BASE TABLE'
        AND (c.column_name ~ '(capacity|headcount|head_count)' OR (c.table_name LIKE 'workforce%' AND c.table_name ~ 'capacity'))`)).rows;
    assert.deepEqual(stored, [], 'no capacity is stored anywhere in the schema');
    const kinds = (await pool.query(`SELECT table_name, table_type FROM information_schema.tables
      WHERE table_schema=current_schema() AND table_name IN ('workforce_scope_capacity','workforce_admission_activity') ORDER BY 1`)).rows;
    assert.deepEqual(kinds.map((r) => r.table_type), ['VIEW', 'VIEW'], 'capacity is a view -- a query with a name -- never a table');
    const counts = async () => (await pool.query(`SELECT (SELECT count(*) FROM workforce_run_admissions) a, (SELECT count(*) FROM workforce_run_leases) l,
      (SELECT count(*) FROM workforce_run_revocations) r, (SELECT count(*) FROM credit_holds) h`)).rows[0];
    const before = await counts();
    await read(); await read(editor); await read(viewer);
    assert.deepEqual(await counts(), before, 'a capacity read admits, leases, revokes and holds nothing');
  });
});
