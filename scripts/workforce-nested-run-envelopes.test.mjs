/**
 * XENO-WORKFORCE-01 RUN-10 -- a nested run spends from its parent's envelope, and a stopped parent
 * stops everything beneath it.
 *
 *   RUN-10: "Nested runs share a parent budget through atomic child sub-reservations, not copied full
 *            ceilings. Count each commitment once against the project and count every child in the
 *            remaining parent envelope. Separate definition-version pinning from live permission
 *            ceilings. Durable revocation epochs plus the admission lease fence stale workers; reconnect
 *            cannot reset the lease without renewed authority."
 *
 * Runs on the migrated schema (TEST_DATABASE_URL) against services/workforceRunAdmission.js,
 * services/workforceRunAuthority.js, services/workforceCapacity.js and
 * 20260927110000-workforce-nested-run-envelopes.sql, with real admissions, leases and revocations.
 *
 * Each of RUN-10's five sentences is its own case, and each is asserted against the wrong
 * implementation it rules out: a copied ceiling (a child as large as its parent), a double count (the
 * scope's committed spend including children), a released remainder (a revoked child's ceiling handed
 * to a sibling), a fused pin (a child whose definition follows its parent's), and a stale worker (a
 * child still leased after its parent was stopped, or re-leased on reconnect).
 *
 * Mutation-checked 2026-09-27, each fails the named assertion; restored passes:
 *   - the service copies the ceiling (no envelope check) -> "a child is carved from the parent, never a copy"
 *     (the database guard is mutated WITH it: a writer that skips the service check cannot record the copy)
 *   - the database guard alone is dropped                  -> "the database refuses a child larger than what is left"
 *   - a revoked child's ceiling is released to a sibling  -> "a revoked child still counts in its parent's envelope"
 *   - the database guard does not lock the parent          -> "the database makes a second child wait for the first"
 *   - the service reads the envelope without locking it    -> "a racing child is told the envelope is spent, not a database error"
 *   - capacity counts children as commitments             -> "each commitment is counted once against its scope"
 *   - a child inherits its parent's pin                   -> "a child keeps its own agent pin"
 *   - a child step skips the parent's live authority       -> "a child reaches no further than its parent's live authority"
 *   - the fence reads only the run's own revocation        -> "stopping the parent fences every run beneath it"
 *   - the lease guard reads only the run's own revocation  -> "no writer can lease a child whose parent was stopped"
 *   - a child may target somewhere its parent does not     -> "a child runs for its parent's target"
 *   - a child is not narrowed by its parent's capabilities -> "a child may do nothing its parent may not"
 *   - a revoked parent may still spawn                      -> "a fenced run spawns nothing"
 *   - another actor's parent is disclosed                   -> "another actor's parent answers like a missing one"
 *   - nesting depth is unbounded                            -> "a chain nests at most eight deep"
 * Every mutant of a rule the service AND the database both hold is applied to both: a writer that skips the
 * service check cannot record the violation, so the service half alone is stopped one layer down, and that
 * proves the layer below rather than the one named. Each database rule is also mutated alone.
 *
 * 🔴 A RACE THAT PASSES IS NOT EVIDENCE. The six-way concurrent admission case passed with every lock
 * removed -- the transactions did not happen to interleave inside the window -- so it is kept as a smoke
 * test and is NOT the proof of atomicity. The two cases that are hold a real uncommitted sibling open and
 * assert that the second writer WAITS, which does not depend on the scheduler.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, generateKeyPairSync } from 'node:crypto';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;

test('nested runs share their parent envelope and are fenced by their ancestors (RUN-10)', { skip: !url, timeout: 120000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  t.after(() => pool.end());
  assert.ok((await pool.query("SELECT to_regproc('workforce_run_admission_fence') AS f")).rows[0].f, 'this suite runs on the migrated schema');
  const { admitRun } = await import('../src/server/services/workforceRunAdmission.js');
  const { authorizeRunStep, revokeRun, readRunAuthority } = await import('../src/server/services/workforceRunAuthority.js');
  const { readWorkforceCapacity } = await import('../src/server/services/workforceCapacity.js');

  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signingKey = { kid: 'nested-test', privatePem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const marker = `nest-${randomUUID().slice(0, 8)}`;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const explicit = (caps) => ({ schemaVersion: 1, mode: 'explicit', capabilities: caps });
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$1,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const ctx = (actorUserId) => ({ actorUserId, clientId: 'xeno-agent-interface' });
  const rejects = (p, code, reason, message) => assert.rejects(p, (e) => e.code === code && e.details?.reason === reason, message);
  const dbRejects = (p, message) => assert.rejects(p, (e) => e.code === '23514', message);

  const owner = await user('owner'), editor = await user('editor'), lenderOwner = await user('lender');
  await pool.query('INSERT INTO credit_accounts(user_id,balance) VALUES($1,$2),($3,$2)', [owner, 50_000_000n, editor]);
  // Admission's budget term reads eligible credit_grants lots (utils/usageCreditFunding.js
  // allocateFunding), not the cached credit_accounts.balance alone -- fund a real paid lot +
  // overflow-on per payer, idempotently (deterministic grant id, replace not accumulate).
  for (const u of [owner, editor]) {
    await pool.query(`INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)
      ON CONFLICT (user_id) DO UPDATE SET enabled=true`, [u]);
    await pool.query(`INSERT INTO credit_grants(id,user_id,amount_micro,remaining_micro,kind,source_ref)
      VALUES(md5('test-fund:'||$1::text)::uuid,$1::uuid,50000000,50000000,'paid','test-fund')
      ON CONFLICT (id) DO UPDATE SET amount_micro=EXCLUDED.amount_micro, remaining_micro=EXCLUDED.remaining_micro`, [u]);
  }
  const ws = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-ws`])).rows[0].id;
  const other = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-other`])).rows[0].id;
  const lender = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [lenderOwner, `${marker}-lender`])).rows[0].id;
  for (const [w, rel, u] of [[ws, 'owner', owner], [ws, 'editor', editor], [other, 'owner', owner], [other, 'editor', editor]]) {
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,$2,'user',$3)`, [w, rel, u]);
  }
  const agent = async (name, caps) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO workforce_resources(id,kind,owner_workspace_id,name) VALUES($1,'agent',$2,$3)`, [id, lender, name]);
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)`,
      [id, { instructions: name, skills: [], requestedCapabilities: caps, secretReferences: [] }, hash(`${id}:1`)]);
    return id;
  };
  const assign = async (resourceId, workspaceId, caps) => {
    const rev = (await pool.query('SELECT revision FROM workforce_resources WHERE id=$1', [resourceId])).rows[0].revision;
    const a = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,
      resource_revision,policy) VALUES($1,'agent',$2,$3,$4,$5) RETURNING id`, [resourceId, workspaceId, lender, rev, explicit(caps)])).rows[0].id;
    await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted', revision=revision+1, source_approved_by_user_id=$2,
      source_approved_at=clock_timestamp(), target_accepted_by_user_id=$2, accepted_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [a, owner]);
    return a;
  };
  const pinOf = async (id) => {
    const v = (await pool.query('SELECT version, content_hash FROM workforce_agent_versions WHERE resource_id=$1 ORDER BY version DESC LIMIT 1', [id])).rows[0];
    return { resourceId: id, version: v.version, contentHash: v.content_hash };
  };
  const admit = async (assignment, agentId, ceiling, { parent, capabilities = ['files.read', 'files.write'], actor = editor } = {}) =>
    (await admitRun(pool, ctx(actor), { operationId: randomUUID(), agent: await pinOf(agentId), target: { kind: 'workspace', assignmentId: assignment },
      capabilities, budget: { ceilingMicro: String(ceiling) }, ...(parent ? { parent: { admissionId: parent } } : {}) })).admission;
  const step = (admissionId, operation = 'provider_dispatch', capability) =>
    authorizeRunStep(pool, ctx(editor), { admissionId, operation, ...(capability ? { capability } : {}) }, { signingKey });

  const lead = await agent('Lead', ['files.read', 'files.write']);
  const helper = await agent('Helper', ['files.read', 'files.write']);
  const leadIn = await assign(lead, ws, ['files.read', 'files.write']);
  const helperIn = await assign(helper, ws, ['files.read', 'files.write']);

  await t.test('RUN-10: a child is carved out of its parent\'s ceiling, never given a copy of it', async () => {
    const parent = await admit(leadIn, lead, 1_000_000);
    const child = await admit(leadIn, lead, 400_000, { parent: parent.admissionId });
    assert.deepEqual(child.parent, { admissionId: parent.admissionId, depth: 1 });
    assert.equal(child.budget.ceilingMicro, '400000');
    await rejects(admit(leadIn, lead, 1_000_000, { parent: parent.admissionId }), 'needs_approval', 'budget_exceeds_parent_envelope',
      'a child is carved from the parent, never a copy');
    await assert.rejects(admit(leadIn, lead, 600_001, { parent: parent.admissionId }),
      (e) => e.details?.reason === 'budget_exceeds_parent_envelope' && e.details.remainingMicro === '600000', 'the refusal says what is left');
    const last = await admit(leadIn, lead, 600_000, { parent: parent.admissionId });
    assert.equal(last.budget.ceilingMicro, '600000', 'the whole remainder can be carved, and no more');
    // A grandchild is carved from its OWN parent's envelope, one level down.
    const grandchild = await admit(leadIn, lead, 400_000, { parent: child.admissionId });
    assert.equal(grandchild.parent.depth, 2);
    await rejects(admit(leadIn, lead, 1, { parent: child.admissionId }), 'needs_approval', 'budget_exceeds_parent_envelope',
      'a child is carved from the parent, never a copy');
  });

  await t.test('RUN-10: the database refuses a child larger than what is left, whatever the writer', async () => {
    const parent = await admit(leadIn, lead, 500_000);
    const child = await admit(leadIn, lead, 300_000, { parent: parent.admissionId });
    // A writer that skips the service's check still cannot record the copy: clone the child's row with a
    // ceiling that does not fit and let the trigger decide.
    const insert = (ceiling, extra = {}) => pool.query(`INSERT INTO workforce_run_admissions(actor_user_id,client_id,operation_id,request_hash,incarnation_hash,
        agent_resource_id,agent_version,agent_content_hash,target_kind,target_workspace_id,assignment_id,assignment_revision,
        payer_kind,payer_user_id,budget_ceiling_micro,requested_capabilities,effective_capabilities,rights,memory_namespace,parent_admission_id,nesting_depth)
      SELECT actor_user_id,client_id,$2,request_hash,incarnation_hash,agent_resource_id,agent_version,agent_content_hash,target_kind,
        $4::uuid,assignment_id,assignment_revision,payer_kind,payer_user_id,$3,requested_capabilities,
        $5::jsonb,rights,memory_namespace,parent_admission_id,$6 FROM workforce_run_admissions WHERE id=$1`,
    [child.admissionId, randomUUID(), ceiling, extra.workspace ?? ws, JSON.stringify(extra.effective ?? ['files.read']), extra.depth ?? 1]);
    await dbRejects(insert(200_001), 'the database refuses a child larger than what is left');
    await insert(200_000);
    await dbRejects(insert(1), 'the database refuses a child larger than what is left');
    // The same guard holds the other terms of a sub-reservation.
    const roomy = await admit(leadIn, lead, 900_000);
    const seed = await admit(leadIn, lead, 1, { parent: roomy.admissionId });
    const clone = (extra) => pool.query(`INSERT INTO workforce_run_admissions(actor_user_id,client_id,operation_id,request_hash,incarnation_hash,
        agent_resource_id,agent_version,agent_content_hash,target_kind,target_workspace_id,assignment_id,assignment_revision,
        payer_kind,payer_user_id,budget_ceiling_micro,requested_capabilities,effective_capabilities,rights,memory_namespace,parent_admission_id,nesting_depth)
      SELECT actor_user_id,client_id,$2,request_hash,incarnation_hash,agent_resource_id,agent_version,agent_content_hash,target_kind,
        $3::uuid,assignment_id,assignment_revision,payer_kind,payer_user_id,1,requested_capabilities,
        $4::jsonb,rights,memory_namespace,parent_admission_id,$5 FROM workforce_run_admissions WHERE id=$1`,
    [seed.admissionId, randomUUID(), extra.workspace ?? ws, JSON.stringify(extra.effective ?? ['files.read']), extra.depth ?? 1]);
    await dbRejects(clone({ workspace: other }), 'the database refuses a child in another scope');
    await dbRejects(clone({ effective: ['files.read', 'shell.run'] }), 'the database refuses a child wider than its parent');
    await dbRejects(clone({ depth: 3 }), 'the database refuses a child that skips a level');
  });

  await t.test('RUN-10: every child counts in the remaining envelope -- a revoked one too', async () => {
    const parent = await admit(leadIn, lead, 1_000_000);
    const first = await admit(leadIn, lead, 700_000, { parent: parent.admissionId });
    await revokeRun(pool, ctx(editor), first.admissionId);
    // No settlement record proves what the stopped child spent, and a stale worker may still be finishing
    // a dispatched call (FUND-09). Handing its remainder to a sibling would commit the same money twice.
    await rejects(admit(leadIn, lead, 700_000, { parent: parent.admissionId }), 'needs_approval', 'budget_exceeds_parent_envelope',
      'a revoked child still counts in its parent\'s envelope');
    assert.equal((await admit(leadIn, lead, 300_000, { parent: parent.admissionId })).budget.ceilingMicro, '300000');
  });

  await t.test('RUN-10: the sub-reservation is atomic over the service -- concurrent children never overdraw the parent', async () => {
    // A PERSONAL target, deliberately: a workspace target is already serialized by the workspace authority
    // lock, which would hide a missing parent lock. Here the parent row is the only thing two children share.
    const solo = randomUUID();
    await pool.query(`INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Solo')`, [solo, owner]);
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)`,
      [solo, { instructions: 'Solo', skills: [], requestedCapabilities: ['files.read'], secretReferences: [] }, hash(`${solo}:1`)]);
    const mineAdmit = async (ceiling, parent) => (await admitRun(pool, ctx(owner), { operationId: randomUUID(), agent: await pinOf(solo),
      target: { kind: 'personal', ownerUserId: owner }, capabilities: ['files.read'], budget: { ceilingMicro: String(ceiling) },
      ...(parent ? { parent: { admissionId: parent } } : {}) })).admission;
    const parent = await mineAdmit(1_000_000);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => mineAdmit(400_000, parent.admissionId)));
    const won = results.filter((r) => r.status === 'fulfilled').length;
    const lost = results.filter((r) => r.status === 'rejected');
    assert.equal(won, 2, 'concurrent children never overdraw the parent');
    assert.ok(lost.every((r) => r.reason?.details?.reason === 'budget_exceeds_parent_envelope'), 'each loser is told the envelope is spent');
    const carved = (await pool.query('SELECT sum(budget_ceiling_micro)::text AS s FROM workforce_run_admissions WHERE parent_admission_id=$1',
      [parent.admissionId])).rows[0].s;
    assert.equal(carved, '800000', 'what was carved never exceeds the parent');
  });

  await t.test('RUN-10: each commitment is counted once against its scope, and a child is not a second one', async () => {
    const scope = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-count`])).rows[0].id;
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,'owner','user',$2),
      ('workspace',$1,'editor','user',$3)`, [scope, owner, editor]);
    const inScope = await assign(lead, scope, ['files.read', 'files.write']);
    const root = await admit(inScope, lead, 2_000_000);
    const child = await admit(inScope, lead, 1_500_000, { parent: root.admissionId });
    await admit(inScope, lead, 500_000, { parent: child.admissionId });
    const read = await readWorkforceCapacity(pool, ctx(owner), { owner: { type: 'workspace', id: scope }, expectedActorAccountId: owner });
    assert.equal(read.activeAdmissions, 3, 'every run is a run');
    assert.equal(read.committedCeilingMicro, '2000000', 'each commitment is counted once against its scope');
  });

  await t.test('RUN-10: a child runs inside its parent -- its target, and nothing its parent may not do', async () => {
    const parent = await admit(leadIn, lead, 1_000_000, { capabilities: ['files.read'] });
    const outside = await admit(helperIn, helper, 100_000, { parent: parent.admissionId }).catch((e) => e);
    assert.equal(outside.details?.reason, 'child_outside_parent_target', 'a child runs for its parent\'s target');
    const child = await admit(leadIn, lead, 100_000, { parent: parent.admissionId, capabilities: ['files.read', 'files.write'] });
    assert.deepEqual(child.capabilities.effective, ['files.read'], 'a child may do nothing its parent may not');
    await rejects(step(child.admissionId, 'privileged_call', 'files.write'), 'denied', 'capability_not_live', 'nor can it later');
  });

  await t.test('RUN-10: pinning is separate from the live ceiling -- a child keeps its own pin, and an ancestor that loses authority stops it', async () => {
    // Two personal agents of one owner, run for that owner: a planner, and a worker it spawns.
    const mine = async (name) => {
      const id = randomUUID();
      await pool.query(`INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,$3)`, [id, owner, name]);
      await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)`,
        [id, { instructions: name, skills: [], requestedCapabilities: ['files.read'], secretReferences: [] }, hash(`${id}:1`)]);
      return id;
    };
    const planner = await mine('Planner'), worker = await mine('Worker');
    const personal = async (agentId, ceiling, parent) => (await admitRun(pool, ctx(owner), { operationId: randomUUID(), agent: await pinOf(agentId),
      target: { kind: 'personal', ownerUserId: owner }, capabilities: ['files.read'], budget: { ceilingMicro: String(ceiling) },
      ...(parent ? { parent: { admissionId: parent } } : {}) })).admission;
    const stepAs = (actor, admissionId) => authorizeRunStep(pool, ctx(actor), { admissionId, operation: 'provider_dispatch' }, { signingKey });

    const parent = await personal(planner, 1_000_000);
    const child = await personal(worker, 200_000, parent.admissionId);
    assert.equal(child.agent.resourceId, worker, 'a child may run a different agent than its parent');
    // The planner's definition moves on. A child spawned now is pinned to the CURRENT definition, and the
    // parent -- pinned to v1 -- is not moved by it: which definition runs is a pin, per admission.
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,2,$2,$3)`,
      [planner, { instructions: 'Planner v2', skills: [], requestedCapabilities: ['files.read'], secretReferences: [] }, hash(`${planner}:2`)]);
    const later = await personal(planner, 100_000, parent.admissionId);
    assert.equal(later.agent.version, 2, 'a child keeps its own agent pin');
    assert.equal(parent.agent.version, 1);
    assert.equal((await stepAs(owner, later.admissionId)).lease.sequence, '1', 'a v2 child runs under a v1 parent');
    assert.equal((await stepAs(owner, child.admissionId)).lease.sequence, '1');

    // Now the PARENT's agent is archived. The child's own terms are all still live -- its agent, its
    // target, its actor -- and it stops anyway, because its reach is its parent's live authority too.
    await pool.query(`UPDATE workforce_resources SET status='archived', revision=revision+1, updated_at=clock_timestamp() WHERE id=$1`, [planner]);
    await rejects(stepAs(owner, child.admissionId), 'denied', 'agent_not_found', 'a child reaches no further than its parent\'s live authority');
    const lost = await readRunAuthority(pool, ctx(owner), parent.admissionId);
    assert.deepEqual([lost.revoked, lost.reason], [true, 'authority_lost'], 'the loss is recorded against the ancestor that lost the term');
    assert.equal((await readRunAuthority(pool, ctx(owner), child.admissionId)).fencedByAdmissionId, parent.admissionId,
      'and that one record fences the child');
  });

  await t.test('RUN-10: a chain nests at most eight deep', async () => {
    let at = (await admit(leadIn, lead, 1_000)).admissionId;
    for (let depth = 1; depth <= 8; depth++) at = (await admit(leadIn, lead, 100, { parent: at })).admissionId;
    await rejects(admit(leadIn, lead, 1, { parent: at }), 'denied', 'nesting_too_deep', 'a chain nests at most eight deep');
  });

  await t.test('RUN-10: the database makes a second child wait for the first, whatever the writer', async () => {
    // Two writers that bypass the service entirely, in overlapping transactions. The envelope guard locks
    // the parent, so the second waits for the first to commit and then sees what it carved.
    const parent = await admit(leadIn, lead, 1_000_000);
    const seed = await admit(leadIn, lead, 100_000, { parent: parent.admissionId });
    const clone = `INSERT INTO workforce_run_admissions(actor_user_id,client_id,operation_id,request_hash,incarnation_hash,
        agent_resource_id,agent_version,agent_content_hash,target_kind,target_workspace_id,assignment_id,assignment_revision,
        payer_kind,payer_user_id,budget_ceiling_micro,requested_capabilities,effective_capabilities,rights,memory_namespace,parent_admission_id,nesting_depth)
      SELECT actor_user_id,client_id,$2,request_hash,incarnation_hash,agent_resource_id,agent_version,agent_content_hash,target_kind,
        target_workspace_id,assignment_id,assignment_revision,payer_kind,payer_user_id,$3,requested_capabilities,
        effective_capabilities,rights,memory_namespace,parent_admission_id,nesting_depth FROM workforce_run_admissions WHERE id=$1`;
    const a = await pool.connect(), b = await pool.connect();
    try {
      await a.query('BEGIN'); await b.query('BEGIN');
      await a.query(clone, [seed.admissionId, randomUUID(), 800_000]);
      let settled = false;
      const second = b.query(clone, [seed.admissionId, randomUUID(), 800_000]).then(() => 'inserted', (e) => e.code);
      second.then(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(settled, false, 'the database makes a second child wait for the first');
      await a.query('COMMIT');
      assert.equal(await second, '23514', 'two children racing for one remainder cannot both fit');
    } finally {
      await b.query('ROLLBACK').catch(() => {});
      a.release(); b.release();
    }
  });

  await t.test('RUN-10: a child racing an uncommitted sibling waits for it, then is refused by name', async () => {
    // The race made deterministic. A raw writer carves the whole remainder and holds its transaction
    // open; the service admits a second child meanwhile. It must WAIT for the parent (the lock it takes
    // before reading the envelope) and then see the sibling -- a typed refusal a host can act on. A
    // service that read the envelope without the lock would pass its own check on a stale sum and be
    // stopped only by the database guard, as a raw constraint error.
    const solo = randomUUID();
    await pool.query(`INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Racer')`, [solo, owner]);
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)`,
      [solo, { instructions: 'Racer', skills: [], requestedCapabilities: ['files.read'], secretReferences: [] }, hash(`${solo}:1`)]);
    const child = async (ceiling, parent) => (await admitRun(pool, ctx(owner), { operationId: randomUUID(), agent: await pinOf(solo),
      target: { kind: 'personal', ownerUserId: owner }, capabilities: ['files.read'], budget: { ceilingMicro: String(ceiling) },
      ...(parent ? { parent: { admissionId: parent } } : {}) })).admission;
    const parent = await child(1_000_000);
    const seed = await child(100_000, parent.admissionId);
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(`INSERT INTO workforce_run_admissions(actor_user_id,client_id,operation_id,request_hash,incarnation_hash,
          agent_resource_id,agent_version,agent_content_hash,target_kind,target_owner_user_id,payer_kind,payer_user_id,budget_ceiling_micro,
          requested_capabilities,effective_capabilities,rights,memory_namespace,parent_admission_id,nesting_depth)
        SELECT actor_user_id,client_id,$2,request_hash,incarnation_hash,agent_resource_id,agent_version,agent_content_hash,target_kind,
          target_owner_user_id,payer_kind,payer_user_id,900000,requested_capabilities,effective_capabilities,rights,memory_namespace,
          parent_admission_id,nesting_depth FROM workforce_run_admissions WHERE id=$1`, [seed.admissionId, randomUUID()]);
      let settled = false;
      const racing = child(500_000, parent.admissionId).then((a) => a, (e) => e);
      racing.then(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(settled, false, 'a racing child waits for the sibling holding the parent');
      await writer.query('COMMIT');
      const outcome = await racing;
      assert.equal(outcome?.details?.reason, 'budget_exceeds_parent_envelope', 'a racing child is told the envelope is spent, not a database error');
      assert.equal(outcome.details.remainingMicro, '0');
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      writer.release();
    }
  });

  await t.test('RUN-10: stopping a parent fences every run beneath it, and reconnect cannot reset the lease', async () => {
    const root = await admit(leadIn, lead, 1_000_000);
    const child = await admit(leadIn, lead, 500_000, { parent: root.admissionId });
    const grandchild = await admit(leadIn, lead, 200_000, { parent: child.admissionId });
    const held = await step(grandchild.admissionId);
    assert.equal(held.lease.sequence, '1');

    await revokeRun(pool, ctx(editor), root.admissionId);
    // One durable revocation, at the top. Nothing was written into the descendants -- they are fenced by
    // reading the chain, so there is no cascade step that could be skipped.
    const written = (await pool.query('SELECT admission_id FROM workforce_run_revocations WHERE admission_id = ANY($1)',
      [[root.admissionId, child.admissionId, grandchild.admissionId]])).rows.map((r) => r.admission_id);
    assert.deepEqual(written, [root.admissionId], 'the stop is recorded once, at the level that was stopped');
    for (const run of [child, grandchild]) {
      await rejects(step(run.admissionId), 'denied', 'admission_revoked', 'stopping the parent fences every run beneath it');
      const state = await readRunAuthority(pool, ctx(editor), run.admissionId);
      assert.equal(state.revoked, true, 'stopping the parent fences every run beneath it');
      assert.equal(state.fencedByAdmissionId, root.admissionId, 'a fenced child names the run that fenced it');
    }
    // A stale worker reconnecting cannot be re-leased: not by the service, and not by any writer.
    await dbRejects(pool.query(`INSERT INTO workforce_run_leases(admission_id,sequence,operation,effective_capabilities,expires_at,signing_kid,token_hash)
      VALUES($1,2,'provider_dispatch','[]',clock_timestamp()+interval '10 seconds','k',$2)`, [grandchild.admissionId, hash(`stale:${grandchild.admissionId}`)]),
    'no writer can lease a child whose parent was stopped');
    await rejects(admit(leadIn, lead, 1, { parent: child.admissionId }), 'denied', 'parent_admission_revoked', 'a fenced run spawns nothing');
    await rejects(admit(leadIn, lead, 1, { parent: root.admissionId }), 'denied', 'parent_admission_revoked', 'a revoked run spawns nothing');
    // And no writer can spawn under it either: the database guard reads the same fence.
    await dbRejects(pool.query(`INSERT INTO workforce_run_admissions(actor_user_id,client_id,operation_id,request_hash,incarnation_hash,
        agent_resource_id,agent_version,agent_content_hash,target_kind,target_workspace_id,assignment_id,assignment_revision,
        payer_kind,payer_user_id,budget_ceiling_micro,requested_capabilities,effective_capabilities,rights,memory_namespace,parent_admission_id,nesting_depth)
      SELECT actor_user_id,client_id,$2,request_hash,incarnation_hash,agent_resource_id,agent_version,agent_content_hash,target_kind,
        target_workspace_id,assignment_id,assignment_revision,payer_kind,payer_user_id,1,requested_capabilities,
        effective_capabilities,rights,memory_namespace,parent_admission_id,nesting_depth FROM workforce_run_admissions WHERE id=$1`,
    [grandchild.admissionId, randomUUID()]), 'the database refuses a child of a stopped run');
    const capacity = (await pool.query('SELECT active FROM workforce_admission_activity WHERE admission_id = ANY($1)',
      [[root.admissionId, child.admissionId, grandchild.admissionId]])).rows;
    assert.ok(capacity.every((r) => r.active === false), 'a fenced run is not active capacity');
  });

  await t.test('RUN-10: a parent belongs to its actor -- another principal cannot nest under it', async () => {
    const parent = await admit(leadIn, lead, 1_000_000);
    const stranger = await admitRun(pool, ctx(owner), { operationId: randomUUID(), agent: await pinOf(lead), target: { kind: 'workspace', assignmentId: leadIn },
      capabilities: ['files.read'], budget: { ceilingMicro: '1' }, parent: { admissionId: parent.admissionId } }).catch((e) => e);
    const missing = await admitRun(pool, ctx(owner), { operationId: randomUUID(), agent: await pinOf(lead), target: { kind: 'workspace', assignmentId: leadIn },
      capabilities: ['files.read'], budget: { ceilingMicro: '1' }, parent: { admissionId: randomUUID() } }).catch((e) => e);
    assert.equal(stranger.details?.reason, 'parent_admission_not_found', 'another actor\'s parent answers like a missing one');
    assert.deepEqual(stranger.details, missing.details, 'another actor\'s parent answers like a missing one');
  });
});
