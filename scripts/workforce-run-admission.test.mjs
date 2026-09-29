/**
 * XENO-WORKFORCE-01 RUN-01 and RUN-02 -- a run is admitted from authoritative state, and what it may do
 * is the intersection of every right it runs under.
 *
 *   RUN-01: "Admission records exact actor/principal, agent version, conversation, optional team,
 *            owner, target assignment/project, root binding, policy revision, entitlement and payer.
 *            Resolve from authoritative state; requested UI fields are not proof."
 *   RUN-02: "Contextual rights are the intersection of actor authorization, resource-use rights,
 *            target assignment, runtime capability policy, entitlement restrictions and explicit
 *            budget approval. No owner/assignment union via generic parent traversal."
 *
 * Runs on the migrated schema (TEST_DATABASE_URL), against services/workforceRunAdmission.js and the
 * table 20260925130000-workforce-run-admissions.sql. Every term is exercised by a refusal as well as a
 * pass, because an intersection that is only ever observed passing could be a union.
 *
 * Mutation-checked 2026-09-25, 15 mutants (each fails the named assertion; restored passes):
 *   - an observer may dispatch                       -> "an observer may not dispatch"
 *   - a revoked assignment still admits              -> "a revoked assignment admits nothing"
 *   - a stale pin runs the current definition        -> "a stale pin is refused, not silently upgraded"
 *   - the budget is not checked against the payer    -> "budget approval is explicit and funded"
 *   - an owner may run in a workspace it is not in   -> "owning a resource is not authority in a workspace"
 *   - a division grant is unioned with its parent    -> "a division grant is not unioned with its parent scope"
 *   - a target may carry fields its kind does not    -> "a target names only what its kind needs"
 *   - an agent outside the member set may run        -> "the agent must be in the admitted member set"
 *   - the database drops its target containment      -> "the database refuses an admission wider than its terms"
 *
 * Mutation-checked 2026-09-26, the pin read (readRunnablePin), 5 mutants, each fails the named assertion:
 *   - the read reports the FIRST version, not the current one  -> "the pin is the current definition"
 *   - the resolver skips the actor-for-target check            -> "a pin is refused where admission would refuse"
 *   - the resolver skips the observer check                    -> "a team pin needs the actor's admitted membership"
 *   - the resolver accepts a target granting another resource  -> "a pin is only of the resource the target grants"
 *   - the read writes an admission                             -> "a pin read admits nothing"
 *
 * Mutation-checked 2026-09-27, DIV-08 (actsInDivision + the division term), each fails the named assertion:
 *   - the division term is skipped                    -> "a workspace editor outside the division cannot run its work"
 *   - a workspace EDITOR counts as in every division  -> "a workspace editor outside the division cannot run its work"
 *   - the division check follows parent tuples        -> "editor on a parent division does not reach its child"
 *   - a division viewer may execute                   -> "a division viewer does not execute in it"
 *   - workspace admins are not exempt                 -> "a workspace administrator acts in every division of its own workspace"
 *   - a project run skips the division term           -> "a project inside a division is inside its boundary"
 *   - an archived division still admits               -> "an archived division admits no new run"
 * The three resolver mutants ALSO fail admission's own assertion ("owning a resource is not authority in
 * a workspace", "an observer may not dispatch", "an assignment admits only the resource it assigns"):
 * admission and the read call one resolveRunnable, so neither can be weakened without the other.
 *
 * CHANGED 2026-09-27 (NFR-07): an actor who cannot SEE the target workspace -- the lender's owner, an
 * outsider -- is now refused `target_not_found`, exactly like an id that does not exist, where it used
 * to be told `actor_cannot_act_for_target`. That was an existence oracle: the two answers differed for a
 * real and an unknown assignment. A viewer of the workspace still gets the precise reason. The two
 * assertions that expected the old answer were updated with it; their messages are unchanged.
 *
 * 🔴 THE INTERSECTION IS HELD TWICE, AND EACH HOLD IS PROVEN ON ITS OWN. Removing only the service's
 * target, runtime or entitlement term does NOT reach the named assertion: the database CHECK refuses
 * the wider row first (every admitting case fails on workforce_run_admission_intersection). That is
 * the design -- a writer that skips a term cannot record the widening -- so each term is mutated
 * twice: the service term together with its DB clause (-> "the target grant narrows the run",
 * "a runtime ceiling narrows, never widens", "the entitlement narrows the run"), and the DB clause
 * alone (the last line above). A mutant that only ever fails one layer down proves that layer, not
 * this one. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;

test('a run is admitted from authoritative state, as the intersection of every right (RUN-01, RUN-02)', { skip: !url, timeout: 120000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(() => pool.end());
  assert.ok((await pool.query("SELECT to_regclass('workforce_run_admissions') AS t")).rows[0].t, 'this suite runs on the migrated schema');
  const { admitRun, readRunAdmission, readRunnablePin } = await import('../src/server/services/workforceRunAdmission.js');

  const marker = `run-${randomUUID().slice(0, 8)}`;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const none = { schemaVersion: 1, mode: 'none', capabilities: [] };
  const explicit = (caps) => ({ schemaVersion: 1, mode: 'explicit', capabilities: caps });
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$1,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  // Funds an eligible PAID lot, not just the cached credit_accounts.balance total: admission's
  // budget term now reads eligibility from usageCreditFunding.allocateFunding (the canonical
  // allocator, shared with creditLedgerV2's hold/spend paths), which draws from credit_grants
  // under the account's overflow preference -- a balance with no grant behind it funds nothing.
  // Idempotent: a repeat fund(u, newMicro) REPLACES this fixture's grant/balance, it never
  // accumulates a second lot -- the grant id is deterministic (derived from u), so a second
  // call upserts the same row rather than adding a sibling one an allocator would then sum.
  const fund = async (u, micro) => {
    await pool.query(`INSERT INTO credit_accounts(user_id,balance) VALUES($1,$2)
      ON CONFLICT (user_id) DO UPDATE SET balance=EXCLUDED.balance`, [u, micro]);
    await pool.query(`INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)
      ON CONFLICT (user_id) DO UPDATE SET enabled=true`, [u]);
    await pool.query(`INSERT INTO credit_grants(id,user_id,amount_micro,remaining_micro,kind,source_ref)
      VALUES(md5('test-fund:'||$1::text)::uuid,$1::uuid,$2,$2,'paid','test-fund')
      ON CONFLICT (id) DO UPDATE SET amount_micro=EXCLUDED.amount_micro, remaining_micro=EXCLUDED.remaining_micro`, [u, micro]);
  };
  const workspace = async (owner, s, extra = []) => {
    const id = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-${s}`])).rows[0].id;
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,'owner','user',$2)`, [id, owner]);
    for (const [rel, u] of extra) await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,$2,'user',$3)`, [id, rel, u]);
    return id;
  };
  const agentResource = async (owner, name, caps, { provenance = { source: 'authored' } } = {}) => {
    const id = randomUUID(), content = { instructions: name, skills: [], requestedCapabilities: caps, secretReferences: [] };
    await pool.query(`INSERT INTO workforce_resources(id,kind,owner_user_id,owner_workspace_id,name) VALUES($1,'agent',$2,$3,$4)`,
      [id, owner.type === 'user' ? owner.id : null, owner.type === 'workspace' ? owner.id : null, name]);
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance) VALUES($1,1,$2,$3,$4)`,
      [id, content, hash(`${id}:1`), provenance]);
    return { id, version: 1, contentHash: hash(`${id}:1`) };
  };
  const assign = async (resourceId, kind, workspaceId, source, policy, { approver } = {}) => {
    const rev = (await pool.query('SELECT revision FROM workforce_resources WHERE id=$1', [resourceId])).rows[0].revision;
    const a = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_user_id,
      source_owner_workspace_id,resource_revision,policy,member_set_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [resourceId, kind, workspaceId, source.type === 'user' ? source.id : null, source.type === 'workspace' ? source.id : null, rev, policy,
      kind === 'team' ? 1 : null])).rows[0].id;
    if (kind === 'team') {
      const tmr = (await pool.query('SELECT team_membership_revision FROM workforce_resources WHERE id=$1', [resourceId])).rows[0].team_membership_revision;
      const members = (await pool.query("SELECT id, revision, role FROM workforce_team_memberships WHERE team_id=$1 AND state='active' ORDER BY id", [resourceId])).rows;
      await pool.query(`INSERT INTO workforce_assignment_member_sets(assignment_id,snapshot_revision,team_id,workspace_id,team_membership_revision,member_count)
        VALUES($1,1,$2,$3,$4,$5)`, [a, resourceId, workspaceId, tmr, members.length]);
      for (const m of members) await pool.query(`INSERT INTO workforce_assignment_members(assignment_id,snapshot_revision,team_id,membership_id,membership_revision,role)
        VALUES($1,1,$2,$3,$4,$5)`, [a, resourceId, m.id, m.revision, m.role]);
    }
    await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted', revision=revision+1, source_approved_by_user_id=$2,
      source_approved_at=clock_timestamp(), target_accepted_by_user_id=$2, accepted_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [a, approver ?? owner]);
    return a;
  };

  // DIV-08: a principal acts INSIDE a division by holding a relation on the division itself.
  const inDivision = (divisionId, u, relation = 'editor', subjectType = 'user') => pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
    VALUES('division',$1,$2,$3,$4)`, [divisionId, relation, subjectType, u]);

  // A division-targeted assignment (DIV-05): same edge, one more column.
  const assignTo = async (resourceId, workspaceId, divisionId, policy) => {
    const rev = (await pool.query('SELECT revision FROM workforce_resources WHERE id=$1', [resourceId])).rows[0].revision;
    const a = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,
      resource_revision,policy,target_division_id) VALUES($1,'agent',$2,$3,$4,$5,$6) RETURNING id`, [resourceId, workspaceId, lender, rev, policy, divisionId])).rows[0].id;
    await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted', revision=revision+1, source_approved_by_user_id=$2,
      source_approved_at=clock_timestamp(), target_accepted_by_user_id=$2, accepted_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [a, owner]);
    return a;
  };

  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), outsider = await user('outsider');
  await fund(owner, 5_000_000n); await fund(editor, 5_000_000n); await fund(outsider, 5_000_000n);
  const studio = await workspace(owner, 'studio', [['editor', editor], ['viewer', viewer]]);
  const lender = await workspace(outsider, 'lender');
  const ctx = (actorUserId, clientId = 'xeno-agent-interface') => ({ actorUserId, clientId });
  const budget = { ceilingMicro: '1000000' };
  const base = (agent, target, extra = {}) => ({ operationId: randomUUID(), agent: { resourceId: agent.id, version: agent.version, contentHash: agent.contentHash }, target, capabilities: ['files.read', 'files.write', 'shell.run'], budget, ...extra });
  const rejects = (p, code, reason, message) => assert.rejects(p, (e) => e.code === code && e.details?.reason === reason, message);

  // A personal agent with a broad definition; a workspace-owned one lent to the studio narrowly.
  const mine = await agentResource({ type: 'user', id: owner }, 'Mine', ['files.read', 'files.write', 'shell.run']);
  const lent = await agentResource({ type: 'workspace', id: lender }, 'Lent', ['files.read', 'files.write', 'shell.run']);
  const lentIn = await assign(lent.id, 'agent', studio, { type: 'workspace', id: lender }, explicit(['files.read']));

  await t.test('RUN-01: the admission records every fact, resolved from authoritative rows', async () => {
    const r = await admitRun(pool, ctx(editor), base(lent, { kind: 'workspace', assignmentId: lentIn }, { capabilities: ['files.read', 'files.write'] }));
    const a = r.admission;
    assert.equal(a.agent.resourceId, lent.id);
    assert.equal(a.agent.contentHash, lent.contentHash, 'the pinned definition is recorded by content hash');
    assert.equal(a.target.workspaceId, studio, 'the target workspace is read from the assignment, not the request');
    assert.equal(a.target.assignmentRevision, (await pool.query('SELECT revision FROM workforce_workspace_assignments WHERE id=$1', [lentIn])).rows[0].revision.toString(),
      'the policy revision the run is admitted under is recorded');
    assert.deepEqual(a.payer, { kind: 'user', userId: editor }, 'the payer is named');
    assert.equal(a.budget.ceilingMicro, '1000000');
    const row = (await pool.query('SELECT * FROM workforce_run_admissions WHERE id=$1', [a.admissionId])).rows[0];
    assert.equal(row.actor_user_id, editor, 'the actor is the authenticated principal');
    assert.equal(row.memory_namespace, `workspace:${studio}:agent:${lent.id}`, 'the memory namespace is scoped to the target');
    // Read-back is the actor's, and anyone who may act for the target; nobody else learns it exists.
    assert.equal((await readRunAdmission(pool, ctx(owner), a.admissionId)).admissionId, a.admissionId);
    await rejects(readRunAdmission(pool, ctx(outsider), a.admissionId), 'not_found', 'admission_not_found', 'an admission is not disclosed outside its target');
    // Both accounts may legitimately read this workspace. Permission alone does
    // not fence a prepared recovery request that switched authenticated accounts.
    await rejects(readRunAdmission(pool,ctx(owner),a.admissionId,{expectedActorAccountId:editor}),
      'conflict','actor_context_conflict','prepared recovery refuses account switches even when both accounts have access');
    assert.equal((await readRunAdmission(pool,ctx(editor),a.admissionId,{expectedActorAccountId:editor})).admissionId,a.admissionId,
      'matching prepared actor reads the original admission');
    const noDatabase={connect:async()=>{assert.fail('actor mismatch must be refused before reading any admission');}};
    await rejects(readRunAdmission(noDatabase,ctx(owner),a.admissionId,{expectedActorAccountId:editor}),
      'conflict','actor_context_conflict','identity precondition precedes receipt lookup');
  });

  await t.test('RUN-01: requested fields are not proof', async () => {
    // A request cannot name a workspace: the target shape is explicit and closed.
    await rejects(admitRun(pool, ctx(editor), base(lent, { kind: 'workspace', assignmentId: lentIn, ownerUserId: editor })),
      'bad_input', 'target_field_conflict', 'a target names only what its kind needs');
    // An assignment of a DIFFERENT resource does not admit this agent.
    const otherIn = await assign(mine.id, 'agent', studio, { type: 'user', id: owner }, explicit(['files.read']));
    await rejects(admitRun(pool, ctx(editor), base(lent, { kind: 'workspace', assignmentId: otherIn })),
      'denied', 'target_does_not_grant_this_resource', 'an assignment admits only the resource it assigns');
    await rejects(admitRun(pool, ctx(editor), { ...base(lent, { kind: 'workspace', assignmentId: lentIn }), expectedActorAccountId: owner }),
      'conflict', 'actor_context_conflict', 'the expected-actor precondition is checked against the authenticated actor');
  });

  await t.test('RUN-02: the target grant narrows the run', async () => {
    const r = await admitRun(pool, ctx(editor), base(lent, { kind: 'workspace', assignmentId: lentIn }));
    assert.deepEqual(r.admission.capabilities.effective, ['files.read'], 'the target grant narrows the run');
    assert.deepEqual(r.admission.capabilities.terms.target, ['files.read']);
    assert.deepEqual(r.admission.capabilities.terms.definition, ['files.read', 'files.write', 'shell.run']);
  });

  await t.test('RUN-02: a runtime ceiling narrows, never widens', async () => {
    const broadIn = await assign(lent.id, 'agent', await workspace(owner, 'wide', [['editor', editor]]), { type: 'workspace', id: lender },
      explicit(['files.read', 'files.write', 'shell.run']));
    const wide = (await pool.query('SELECT workspace_id FROM workforce_workspace_assignments WHERE id=$1', [broadIn])).rows[0].workspace_id;
    const narrowed = await admitRun(pool, ctx(editor), base(lent, { kind: 'workspace', assignmentId: broadIn }, { runtimeCapabilities: ['files.read', 'files.write'] }));
    assert.deepEqual(narrowed.admission.capabilities.effective, ['files.read', 'files.write'], 'a runtime ceiling narrows, never widens');
    const widened = await admitRun(pool, ctx(editor), base(lent, { kind: 'workspace', assignmentId: broadIn },
      { capabilities: ['files.read'], runtimeCapabilities: ['files.read', 'files.write', 'shell.run', 'net.fetch'] }));
    assert.deepEqual(widened.admission.capabilities.effective, ['files.read'], 'a runtime ceiling narrows, never widens');
    assert.ok(wide);
  });

  await t.test('RUN-02: owning a resource is not authority in a workspace', async () => {
    // The lender's owner owns the resource, but is not a member of the studio it was lent to.
    await rejects(admitRun(pool, ctx(outsider), base(lent, { kind: 'workspace', assignmentId: lentIn })),
      'not_found', 'target_not_found', 'owning a resource is not authority in a workspace');
    await rejects(admitRun(pool, ctx(viewer), base(lent, { kind: 'workspace', assignmentId: lentIn })),
      'denied', 'actor_cannot_act_for_target', 'a workspace viewer cannot dispatch');
    // And a personal target runs only the target owner's own resource.
    await rejects(admitRun(pool, ctx(owner), base(lent, { kind: 'personal', ownerUserId: owner })),
      'denied', 'resource_not_the_owners', 'a personal run is only of your own resource');
    const personal = await admitRun(pool, ctx(owner), base(mine, { kind: 'personal', ownerUserId: owner }));
    assert.deepEqual(personal.admission.capabilities.effective, ['files.read', 'files.write', 'shell.run']);
    await rejects(admitRun(pool, ctx(editor), base(mine, { kind: 'personal', ownerUserId: owner })),
      'denied', 'actor_cannot_act_for_target', 'nobody runs another person\'s personal agent for them');
  });

  // NFR-07, the last sentence, for the two run endpoints. Mutation-checked 2026-09-27, each fails the named
  // assertion: the visibility check is removed -> "an unreadable target answers exactly like a missing one";
  // it is checked AFTER the target's own liveness -> "a revoked target does not tell a stranger it was
  // revoked"; seeing is treated as acting -> "a viewer still learns why it may not run".
  // Part of NFR-07's parity half, for the two run endpoints. NFR-07 itself is cited by
  // scripts/workforce-scope-binding.test.mjs, which covers every surface it names; the id stays out of this title.
  await t.test('a run target the caller cannot see answers exactly like one that does not exist', async () => {
    const hidden = await workspace(owner, 'nfr07', [['editor', editor], ['viewer', viewer]]);
    const live = await assign(lent.id, 'agent', hidden, { type: 'workspace', id: lender }, explicit(['files.read']));
    // A second resource, because one resource has at most one live assignment into a workspace.
    const other = await agentResource({ type: 'workspace', id: lender }, 'Hidden', ['files.read']);
    const gone = await assign(other.id, 'agent', hidden, { type: 'workspace', id: lender }, explicit(['files.read']));
    await pool.query(`UPDATE workforce_workspace_assignments SET state='revoked', revision=revision+1, revoked_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [gone]);
    const stranger = await user('nfr07-stranger');
    await fund(stranger, 5_000_000n);
    // The whole refusal a caller can observe: code, and every detail -- an oracle is built from the
    // difference, so the comparison is of everything, not of one hand-picked field.
    const refusal = (p) => p.then(() => 'admitted', (e) => JSON.stringify({ code: e.code, status: e.status, details: e.details }));
    const pinOf = (actor, assignmentId) => refusal(readRunnablePin(pool, ctx(actor), { agent: { resourceId: assignmentId === gone ? other.id : lent.id },
      target: { kind: 'workspace', assignmentId } }));
    const admitOf = (actor, assignmentId, agent = assignmentId === gone ? other : lent) =>
      refusal(admitRun(pool, ctx(actor), base(agent, { kind: 'workspace', assignmentId }, { capabilities: ['files.read'] })));
    const missing = randomUUID();
    for (const [ask, name] of [[pinOf, 'the pin read'], [admitOf, 'admission']]) {
      const unknown = await ask(stranger, missing);
      assert.notEqual(unknown, 'admitted');
      assert.equal(await ask(stranger, live), unknown, `${name}: an unreadable target answers exactly like a missing one`);
      assert.equal(await ask(stranger, gone), unknown, `${name}: a revoked target does not tell a stranger it was revoked`);
    }
    // Someone who can SEE the workspace already sees the assignment in the catalog, so the precise reason
    // is theirs to have -- and it is not the missing-target answer.
    assert.equal(JSON.parse(await admitOf(viewer, live)).details.reason, 'actor_cannot_act_for_target', 'a viewer still learns why it may not run');
    assert.equal(JSON.parse(await admitOf(editor, gone)).details.reason, 'assignment_not_live', 'a member is told the assignment was revoked');
  });

  await t.test('RUN-02: a revoked assignment admits nothing', async () => {
    const tmp = await assign(lent.id, 'agent', await workspace(owner, 'tmp', [['editor', editor]]), { type: 'workspace', id: lender }, explicit(['files.read']));
    await admitRun(pool, ctx(editor), base(lent, { kind: 'workspace', assignmentId: tmp }));
    await pool.query(`UPDATE workforce_workspace_assignments SET state='revoked', revision=revision+1, revoked_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [tmp]);
    await rejects(admitRun(pool, ctx(editor), base(lent, { kind: 'workspace', assignmentId: tmp })),
      'denied', 'assignment_not_live', 'a revoked assignment admits nothing');
  });

  await t.test('RUN-02: a stale pin is refused, not silently upgraded', async () => {
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,2,$2,$3)`,
      [mine.id, { instructions: 'v2', skills: [], requestedCapabilities: ['files.read'], secretReferences: [] }, hash(`${mine.id}:2`)]);
    await rejects(admitRun(pool, ctx(owner), base(mine, { kind: 'personal', ownerUserId: owner })),
      'conflict', 'agent_version_stale', 'a stale pin is refused, not silently upgraded');
    const current = await admitRun(pool, ctx(owner), base({ id: mine.id, version: 2, contentHash: hash(`${mine.id}:2`) }, { kind: 'personal', ownerUserId: owner }));
    assert.deepEqual(current.admission.capabilities.effective, ['files.read'], 'the current definition is its own term');
  });

  await t.test('RUN-02: no union through parent traversal -- a division grant is its own term', async () => {
    // The same resource is assigned twice in one workspace: broadly at workspace level, narrowly to a
    // division. Running under the division's grant must not reach up and union in the workspace's.
    const ws = await workspace(owner, 'div', [['editor', editor]]);
    const division = (await pool.query(`INSERT INTO workforce_divisions(workspace_id,key,name,created_by_user_id) VALUES($1,'office','Office',$2) RETURNING id`,
      [ws, owner])).rows[0].id;
    await inDivision(division, editor);
    const wide = await assign(lent.id, 'agent', ws, { type: 'workspace', id: lender }, explicit(['files.read', 'files.write', 'shell.run']));
    const narrow = await assignTo(lent.id, ws, division, explicit(['files.read']));
    const r = await admitRun(pool, ctx(editor), base(lent, { kind: 'workspace', assignmentId: narrow }));
    assert.deepEqual(r.admission.capabilities.effective, ['files.read'], 'a division grant is not unioned with its parent scope');
    assert.ok(wide);
    // An explicitly INHERITING grant takes exactly its bound parent's set -- and nothing once that parent dies.
    const studioDivision = (await pool.query(`INSERT INTO workforce_divisions(workspace_id,key,name,created_by_user_id)
      VALUES($1,'studio','Studio',$2) RETURNING id`, [ws, owner])).rows[0].id;
    await inDivision(studioDivision, editor);
    const inherits = await assignTo(lent.id, ws, studioDivision,
      { schemaVersion: 1, mode: 'inherit_parent', capabilities: [], parent: { assignmentId: wide,
        revision: Number((await pool.query('SELECT revision FROM workforce_workspace_assignments WHERE id=$1', [wide])).rows[0].revision) } });
    const inherited = await admitRun(pool, ctx(editor), base(lent, { kind: 'workspace', assignmentId: inherits }));
    assert.deepEqual(inherited.admission.capabilities.effective, ['files.read', 'files.write', 'shell.run'], 'inheritance is the bound parent, explicitly');
    await pool.query(`UPDATE workforce_workspace_assignments SET state='revoked', revision=revision+1, revoked_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [wide]);
    const orphaned = await admitRun(pool, ctx(editor), base(lent, { kind: 'workspace', assignmentId: inherits }));
    assert.deepEqual(orphaned.admission.capabilities.effective, [], 'an inherited grant whose parent is revoked grants nothing');
  });

  await t.test('DIV-08: a division is an execution boundary, enforced at admission (DIV-08)', async () => {
    // "A division scope is a VISIBILITY and an EXECUTION boundary, enforced at admission. A principal
    //  acting in `creative` ... may act on creative-scoped projects; RUN-02's intersection gains
    //  division as a term." The workspace editor below may act for the WORKSPACE; that alone must not
    //  reach work scoped to a division it is not in.
    const member = await user('div-member'), stranger = await user('div-stranger');
    await fund(member, 5_000_000n); await fund(stranger, 5_000_000n);
    const ws = await workspace(owner, 'div08', [['editor', member], ['editor', stranger], ['admin', editor]]);
    const mk = async (key, parent = null) => (await pool.query(`INSERT INTO workforce_divisions(workspace_id,parent_division_id,key,name,created_by_user_id)
      VALUES($1,$2,$3,$3,$4) RETURNING id`, [ws, parent, key, owner])).rows[0].id;
    const creative = await mk('creative'), dev = await mk('dev');
    const platform = await mk('platform', dev);
    await inDivision(creative, member);
    const intoCreative = await assignTo(lent.id, ws, creative, explicit(['files.read']));
    const run = (actor, assignmentId) => admitRun(pool, ctx(actor), base(lent, { kind: 'workspace', assignmentId }, { capabilities: ['files.read'] }));
    // An ALLOW is asserted as an outcome, so a refusal fails under the message that names the property.
    const admits = async (promise, message) => assert.equal(await promise.then(() => 'admitted', (e) => e.details?.reason ?? e.message), 'admitted', message);

    const admitted = await run(member, intoCreative);
    assert.deepEqual(admitted.admission.capabilities.effective, ['files.read'], 'a division member runs division-scoped work');
    await rejects(run(stranger, intoCreative), 'denied', 'actor_outside_division', 'a workspace editor outside the division cannot run its work');
    await admits(run(editor, intoCreative), 'a workspace administrator acts in every division of its own workspace');
    // A principal who cannot even SEE this workspace is refused like an unknown target (NFR-07); one who can
    // see it but not act for it is refused at the workspace term, before any division term.
    await rejects(run(viewer, intoCreative), 'not_found', 'target_not_found', 'the workspace boundary is still checked first');
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,'viewer','user',$2)`, [ws, viewer]);
    await rejects(run(viewer, intoCreative), 'denied', 'actor_cannot_act_for_target', 'the workspace boundary is still checked first');

    // D15: a grant on a PARENT division is not a grant on its child.
    await inDivision(dev, stranger);
    const intoPlatform = await assignTo(lent.id, ws, platform, explicit(['files.read']));
    await rejects(run(stranger, intoPlatform), 'denied', 'actor_outside_division', 'editor on a parent division does not reach its child');
    await inDivision(platform, stranger);
    await admits(run(stranger, intoPlatform), 'editor on the child division itself does');

    // A viewer of the division may see it, not run in it; an agent gets exactly its grant.
    const watcher = await user('div-watcher');
    await fund(watcher, 5_000_000n);
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,'editor','user',$2)`, [ws, watcher]);
    await inDivision(creative, watcher, 'viewer');
    await rejects(run(watcher, intoCreative), 'denied', 'actor_outside_division', 'a division viewer does not execute in it');

    // The boundary covers project work built on a division assignment, and the pin read agrees.
    const project = (await pool.query('INSERT INTO chat_projects(workspace_id,name) VALUES($1,$2) RETURNING id', [ws, `${marker}-div08p`])).rows[0].id;
    const pp = (await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,workspace_id,assignment_id,responsibility,policy)
      VALUES($1,'agent',$2,'workspace',$3,$4,'reviewer',$5) RETURNING id`, [lent.id, project, ws, intoCreative, explicit(['files.read'])])).rows[0].id;
    const projectTarget = { kind: 'project', projectId: project, participationId: pp };
    await rejects(admitRun(pool, ctx(stranger), base(lent, projectTarget, { capabilities: ['files.read'] })), 'denied', 'actor_outside_division',
      'a project inside a division is inside its boundary');
    await admits(admitRun(pool, ctx(member), base(lent, projectTarget, { capabilities: ['files.read'] })), 'a division member runs its project work');
    await rejects(readRunnablePin(pool, ctx(stranger), { agent: { resourceId: lent.id }, target: { kind: 'workspace', assignmentId: intoCreative } }),
      'denied', 'actor_outside_division', 'the pin read refuses where admission refuses');

    // An archived division admits no new run, even to its own members.
    await pool.query(`UPDATE workforce_divisions SET lifecycle='archived', archived_at=clock_timestamp(), revision=revision+1, updated_at=clock_timestamp() WHERE id=$1`, [creative]);
    await rejects(run(member, intoCreative), 'denied', 'division_not_live', 'an archived division admits no new run');
  });

  await t.test('RUN-02: budget approval is explicit and funded', async () => {
    const r = admitRun(pool, ctx(owner), base({ id: mine.id, version: 2, contentHash: hash(`${mine.id}:2`) }, { kind: 'personal', ownerUserId: owner },
      { budget: { ceilingMicro: '999999999' } }));
    await rejects(r, 'needs_approval', 'budget_exceeds_available', 'budget approval is explicit and funded');
    await pool.query(`INSERT INTO credit_holds(user_id,hold_id,surface,operation,amount_micro,settled_micro,state,expires_at)
      VALUES($1,$2,'test','test',4500000,0,'held',now()+interval '1 hour')`, [owner, randomUUID()]);
    await rejects(admitRun(pool, ctx(owner), base({ id: mine.id, version: 2, contentHash: hash(`${mine.id}:2`) }, { kind: 'personal', ownerUserId: owner })),
      'needs_approval', 'budget_exceeds_available', 'budget approval is explicit and funded');
    await assert.rejects(admitRun(pool, ctx(owner), base({ id: mine.id, version: 2, contentHash: hash(`${mine.id}:2`) }, { kind: 'personal', ownerUserId: owner },
      { budget: { ceilingMicro: '0' } })), (e) => e.code === 'bad_input', 'a zero budget is not an approval');
  });

  await t.test('RUN-02: the entitlement narrows the run', async () => {
    const dev = (await pool.query(`INSERT INTO marketplace_developers(user_id,display_name,slug) VALUES($1,'Seller',$2) RETURNING id`, [outsider, `${marker}-dev`])).rows[0].id;
    const listing = (await pool.query(`INSERT INTO marketplace_listings(slug,kind,developer_id,title,status,license) VALUES($1,'panel',$2,'Bought','published','MIT') RETURNING id`,
      [`${marker}-listing`, dev])).rows[0].id;
    const lv = (await pool.query(`INSERT INTO marketplace_listing_versions(listing_id,version,declared_capabilities,published_at) VALUES($1,'1.0.0','["files.read"]'::jsonb,now()) RETURNING id`,
      [listing])).rows[0].id;
    const bought = await agentResource({ type: 'user', id: editor }, 'Bought', ['files.read', 'files.write'], { provenance: { source: 'imported', listingVersionId: lv } });
    await rejects(admitRun(pool, ctx(editor), base(bought, { kind: 'personal', ownerUserId: editor })),
      'denied', 'entitlement_not_live', 'a marketplace definition runs only under a live entitlement');
    const ent = (await pool.query(`INSERT INTO marketplace_entitlements(user_id,listing_id,kind) VALUES($1,$2,'owned') RETURNING id`, [editor, listing])).rows[0].id;
    const r = await admitRun(pool, ctx(editor), base(bought, { kind: 'personal', ownerUserId: editor }));
    assert.deepEqual(r.admission.capabilities.effective, ['files.read'], 'the entitlement narrows the run');
    assert.equal(r.admission.entitlementId, ent, 'the entitlement is recorded');
    await pool.query(`UPDATE marketplace_entitlements SET status='expired' WHERE id=$1`, [ent]);
    await rejects(admitRun(pool, ctx(editor), base(bought, { kind: 'personal', ownerUserId: editor })),
      'denied', 'entitlement_not_live', 'an expired entitlement admits nothing new');
  });

  await t.test('RUN-02: a team run needs the actor\'s own admitted membership, and an observer may not dispatch', async () => {
    const team = (await pool.query(`INSERT INTO workforce_resources(kind,owner_workspace_id,name) VALUES('team',$1,'Crew') RETURNING id`, [studio])).rows[0].id;
    const crewAgent = await agentResource({ type: 'workspace', id: studio }, 'CrewAgent', ['files.read', 'files.write']);
    await pool.query(`INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,role) VALUES($1,$2,'agent','worker')`, [team, crewAgent.id]);
    await pool.query(`INSERT INTO workforce_team_memberships(team_id,member_principal_id,role) VALUES($1,$2,'worker')`, [team, editor]);
    await pool.query(`INSERT INTO workforce_team_memberships(team_id,member_principal_id,role) VALUES($1,$2,'observer')`, [team, owner]);
    const teamIn = await assign(team, 'team', studio, { type: 'workspace', id: studio }, explicit(['files.read', 'files.write']));
    const r = await admitRun(pool, ctx(editor), base(crewAgent, { kind: 'workspace', assignmentId: teamIn }, { team: { teamId: team } }));
    assert.equal(r.admission.team.function, 'worker', 'the admitted membership and its function are recorded');
    assert.deepEqual(r.admission.capabilities.effective, ['files.read', 'files.write']);
    // The workspace OWNER is only an observer in this team: workspace authority does not make them a dispatcher.
    await rejects(admitRun(pool, ctx(owner), base(crewAgent, { kind: 'workspace', assignmentId: teamIn }, { team: { teamId: team } })),
      'denied', 'observer_cannot_dispatch', 'an observer may not dispatch');
    await rejects(admitRun(pool, ctx(viewer), base(crewAgent, { kind: 'workspace', assignmentId: teamIn }, { team: { teamId: team } })),
      'denied', 'actor_cannot_act_for_target', 'a non-member viewer may not dispatch');
    // A live, current workspace agent that simply is not in the team's admitted member set.
    const outsider = await agentResource({ type: 'workspace', id: studio }, 'Outsider', ['files.read']);
    await rejects(admitRun(pool, ctx(editor), base(outsider, { kind: 'workspace', assignmentId: teamIn }, { team: { teamId: team } })),
      'denied', 'agent_not_an_admitted_member', 'the agent must be in the admitted member set');
  });

  await t.test('RUN-01: the pin an admission must name is read under admission\'s own rule, and admits', async () => {
    // Before this read no host could admit: nothing returned an agent's current { version, contentHash },
    // and admission refuses a stale pin. The read returns the CURRENT pin -- and it is one admission accepts.
    // Its own agent: this case moves the definition, and the shared fixture's pins must not go stale.
    const ws = await workspace(owner, 'pin', [['editor', editor], ['viewer', viewer]]);
    const pinned = await agentResource({ type: 'workspace', id: lender }, 'Pinned', ['files.read', 'files.write', 'shell.run']);
    const into = await assign(pinned.id, 'agent', ws, { type: 'workspace', id: lender }, explicit(['files.read']));
    const pinFor = (actor, target, extra = {}) => readRunnablePin(pool, ctx(actor), { agent: { resourceId: pinned.id }, target, ...extra });
    const pin = await pinFor(editor, { kind: 'workspace', assignmentId: into });
    const current = (await pool.query('SELECT version, content_hash FROM workforce_agent_versions WHERE resource_id=$1 ORDER BY version DESC LIMIT 1', [pinned.id])).rows[0];
    assert.deepEqual(pin.agent, { resourceId: pinned.id, version: current.version, contentHash: current.content_hash }, 'the pin is the current definition');
    assert.deepEqual(pin.terms, { definition: ['files.read', 'files.write', 'shell.run'], target: ['files.read'] },
      'the read states the definition and target terms admission would record');
    const admitted = await admitRun(pool, ctx(editor), { operationId: randomUUID(), agent: pin.agent, target: { kind: 'workspace', assignmentId: into },
      capabilities: ['files.read'], budget });
    assert.deepEqual(admitted.admission.agent, pin.agent, 'the pin the read returns is one admission accepts');

    // A newer definition moves the pin, and the old one is then refused by admission -- the read is how a host re-pins.
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,$2,$3,$4)`,
      [pinned.id, current.version + 1, { instructions: 'newer', skills: [], requestedCapabilities: ['files.read'], secretReferences: [] }, hash(`${pinned.id}:${current.version + 1}`)]);
    const moved = await pinFor(editor, { kind: 'workspace', assignmentId: into });
    assert.equal(moved.agent.version, current.version + 1, 'the pin is the current definition');
    await rejects(admitRun(pool, ctx(editor), { operationId: randomUUID(), agent: pin.agent, target: { kind: 'workspace', assignmentId: into },
      capabilities: ['files.read'], budget }), 'conflict', 'agent_version_stale', 'the superseded pin is now stale');

    // It refuses exactly where admission refuses, with the same reason -- no oracle beyond admission's own.
    for (const [actor, target, code, reason, message] of [
      [viewer, { kind: 'workspace', assignmentId: into }, 'denied', 'actor_cannot_act_for_target', 'a pin is refused where admission would refuse'],
      [outsider, { kind: 'workspace', assignmentId: into }, 'not_found', 'target_not_found', 'a pin is refused where admission would refuse'],
      [editor, { kind: 'workspace', assignmentId: randomUUID() }, 'not_found', 'target_not_found', 'an unknown target has no pin'],
      [owner, { kind: 'personal', ownerUserId: owner }, 'denied', 'resource_not_the_owners', 'a pin is only of the resource the target grants'],
    ]) {
      await rejects(pinFor(actor, target), code, reason, message);
      await rejects(admitRun(pool, ctx(actor), { operationId: randomUUID(), agent: moved.agent, target, capabilities: ['files.read'], budget }),
        code, reason, `admission agrees: ${message}`);
    }
    const otherIn = await assign(mine.id, 'agent', ws, { type: 'user', id: owner }, explicit(['files.read']));
    await rejects(pinFor(editor, { kind: 'workspace', assignmentId: otherIn }), 'denied', 'target_does_not_grant_this_resource',
      'a pin is only of the resource the target grants');

    // A team run: the actor's own admitted membership, and the agent's, exactly as admission.
    const team = (await pool.query(`INSERT INTO workforce_resources(kind,owner_workspace_id,name) VALUES('team',$1,'PinCrew') RETURNING id`, [ws])).rows[0].id;
    const crew = await agentResource({ type: 'workspace', id: ws }, 'PinCrewAgent', ['files.read']);
    await pool.query(`INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,role) VALUES($1,$2,'agent','worker')`, [team, crew.id]);
    await pool.query(`INSERT INTO workforce_team_memberships(team_id,member_principal_id,role) VALUES($1,$2,'worker')`, [team, editor]);
    await pool.query(`INSERT INTO workforce_team_memberships(team_id,member_principal_id,role) VALUES($1,$2,'observer')`, [team, owner]);
    const teamIn = await assign(team, 'team', ws, { type: 'workspace', id: ws }, explicit(['files.read']));
    const teamPin = await readRunnablePin(pool, ctx(editor), { agent: { resourceId: crew.id }, target: { kind: 'workspace', assignmentId: teamIn }, team: { teamId: team } });
    assert.deepEqual(teamPin.agent, { resourceId: crew.id, version: crew.version, contentHash: crew.contentHash }, 'a team member reads its agent\'s pin');
    await rejects(readRunnablePin(pool, ctx(owner), { agent: { resourceId: crew.id }, target: { kind: 'workspace', assignmentId: teamIn }, team: { teamId: team } }),
      'denied', 'observer_cannot_dispatch', 'a team pin needs the actor\'s admitted membership');
    await rejects(readRunnablePin(pool, ctx(editor), { agent: { resourceId: crew.id }, target: { kind: 'workspace', assignmentId: teamIn } }),
      'denied', 'target_does_not_grant_this_resource', 'a team assignment grants the team, not a member run outside it');

    // Reading a pin writes nothing and does not take the manage scope; a malformed question is refused.
    const before = (await pool.query('SELECT count(*)::int AS n FROM workforce_run_admissions')).rows[0].n;
    await pinFor(editor, { kind: 'workspace', assignmentId: into });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM workforce_run_admissions')).rows[0].n, before, 'a pin read admits nothing');
    await rejects(pinFor(editor, { kind: 'workspace', assignmentId: into, ownerUserId: editor }), 'bad_input', 'target_field_conflict', 'a pin target names only what its kind needs');
    await assert.rejects(readRunnablePin(pool, ctx(editor), { agent: { resourceId: pinned.id, version: 1 }, target: { kind: 'workspace', assignmentId: into } }),
      (e) => e.code === 'bad_input', 'the read takes no pin of its own to trust');
    await rejects(readRunnablePin(pool, ctx(editor), { agent: { resourceId: pinned.id }, target: { kind: 'workspace', assignmentId: into }, expectedActorAccountId: owner }),
      'conflict', 'actor_context_conflict', 'the expected-actor precondition holds for the read too');
  });

  await t.test('RUN-01: a project run records its participation and root binding', async () => {
    const proj = (await pool.query('INSERT INTO chat_projects(workspace_id,name) VALUES($1,$2) RETURNING id', [studio, `${marker}-p`])).rows[0].id;
    const pIn = (await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,workspace_id,assignment_id,responsibility,policy)
      VALUES($1,'agent',$2,'workspace',$3,$4,'reviewer',$5) RETURNING id`, [lent.id, proj, studio, lentIn, explicit(['files.read'])])).rows[0].id;
    const install = 'A'.repeat(43);
    const binding = (await pool.query(`INSERT INTO project_directory_bindings(project_id,host_installation_id,host_owner_user_id,host_client_id,root_family,canonical_root)
      VALUES($1,$2,$3,'xeno-agent-interface','posix','/work/repo') RETURNING id`, [proj, install, editor])).rows[0].id;
    const conv = (await pool.query(`INSERT INTO chat_conversations(title,project_id,created_by_user_id) VALUES('t',$1,$2) RETURNING id`,
      [proj, editor])).rows[0].id;
    const r = await admitRun(pool, ctx(editor), base(lent, { kind: 'project', projectId: proj, participationId: pIn },
      { conversationId: conv, root: { bindingId: binding, installationId: install } }));
    assert.equal(r.admission.target.participationId, pIn);
    assert.equal(r.admission.root.bindingId, binding, 'the root binding is recorded');
    assert.equal(r.admission.conversationId, conv, 'the conversation is recorded');
    assert.deepEqual(r.admission.capabilities.effective, ['files.read']);
    const elsewhere = (await pool.query(`INSERT INTO chat_conversations(title,workspace_id,created_by_user_id) VALUES('x',$1,$2) RETURNING id`, [studio, editor])).rows[0].id;
    await rejects(admitRun(pool, ctx(editor), base(lent, { kind: 'project', projectId: proj, participationId: pIn }, { conversationId: elsewhere })),
      'conflict', 'conversation_outside_target', 'a conversation outside the target is refused');
    await rejects(admitRun(pool, ctx(editor), base(lent, { kind: 'project', projectId: proj, participationId: pIn }, { root: { bindingId: binding, installationId: 'B'.repeat(43) } })),
      'denied', 'root_binding_not_live', 'a root is resolved by installation, never by the id alone');
  });

  await t.test('the same request returns the same admission; a changed one conflicts', async () => {
    const req = base(lent, { kind: 'workspace', assignmentId: lentIn });
    const first = await admitRun(pool, ctx(editor), req);
    const again = await admitRun(pool, ctx(editor), req);
    assert.equal(again.replayed, true);
    assert.equal(again.admission.admissionId, first.admission.admissionId);
    await rejects(admitRun(pool, ctx(editor), { ...req, capabilities: ['files.read'] }), 'conflict', 'operation_payload_conflict', 'a changed request under the same operation conflicts');
  });

  await t.test('a lost commit response recovers by actor-bound operation without admitting again',async()=>{
    const {readRunAdmissionOperation}=await import('../src/server/services/workforceRunAdmission.js');
    const req=base(lent,{kind:'workspace',assignmentId:lentIn});
    const question={operationId:req.operationId,expectedActorAccountId:editor};
    assert.deepEqual(await readRunAdmissionOperation(pool,ctx(editor),question),
      {schemaVersion:1,state:'not-observed',operationId:req.operationId,admission:null},'unknown operation is not guessed successful');
    let dropped=false;
    const lost={connect:async()=>{const db=await pool.connect();return {release:()=>db.release(),query:async(sql,...args)=>{
      const result=await db.query(sql,...args);if(sql==='COMMIT'&&!dropped){dropped=true;throw Error('lost acknowledgement');}return result;
    }};}};
    await assert.rejects(admitRun(lost,ctx(editor),req),/lost acknowledgement/);
    const count=async()=>(await pool.query('SELECT count(*)::int n FROM workforce_run_admissions')).rows[0].n;
    const before=await count();
    const recovered=await readRunAdmissionOperation(pool,ctx(editor),question);
    assert.equal(recovered.state,'committed','lost acknowledgement resolves the original committed admission');
    assert.equal(recovered.admission.operationId,req.operationId);
    assert.equal(await count(),before,'operation readback never creates an admission');
    assert.equal((await readRunAdmissionOperation(pool,ctx(editor,'other-client'),question)).state,'not-observed','receipt namespace is client-bound');
    assert.equal((await readRunAdmissionOperation(pool,ctx(owner),{...question,expectedActorAccountId:owner})).state,'not-observed','workspace owner cannot recover another actors operation');
    await rejects(readRunAdmissionOperation(pool,ctx(owner),question),'conflict','actor_context_conflict','operation recovery refuses changed account identity');
    const {revokeRun,authorizeRunStep}=await import('../src/server/services/workforceRunAuthority.js');
    await revokeRun(pool,ctx(editor),recovered.admission.admissionId);
    assert.equal((await readRunAdmissionOperation(pool,ctx(editor),question)).state,'committed','historical receipt survives revocation without renewing permission');
    const originalCreated=(await pool.query('SELECT created_at::text value FROM users WHERE id=$1',[editor])).rows[0].value;
    try {
      await pool.query("UPDATE users SET created_at=created_at+interval '1 second' WHERE id=$1",[editor]);
      await rejects(readRunAdmissionOperation(pool,ctx(editor),question),'conflict','operation_incarnation_conflict','recreated account identity cannot inherit an old operation receipt');
    } finally {await pool.query('UPDATE users SET created_at=$2 WHERE id=$1',[editor,originalCreated]);}
    try {
      await pool.query('UPDATE users SET is_active=false WHERE id=$1',[editor]);
      await rejects(readRunAdmissionOperation(pool,ctx(editor),question),'denied','actor_unavailable','suspended accounts cannot recover private admissions');
    } finally {await pool.query('UPDATE users SET is_active=true WHERE id=$1',[editor]);}
    const {generateKeyPairSync}=await import('node:crypto');const keys=generateKeyPairSync('ec',{namedCurve:'P-256'});
    await rejects(authorizeRunStep(pool,ctx(editor),{admissionId:recovered.admission.admissionId,operation:'provider_dispatch'},
      {signingKey:{kid:'recovery-test',privatePem:keys.privateKey.export({format:'pem',type:'pkcs8'})}}),
      'denied','admission_revoked','recovering a receipt cannot revive revoked execution');
  });

  await t.test('the database refuses an admission wider than its terms, and retains every admission', async () => {
    const row = (await pool.query('SELECT * FROM workforce_run_admissions ORDER BY admitted_at LIMIT 1')).rows[0];
    const widened = { ...row, id: randomUUID(), operation_id: randomUUID(), effective_capabilities: JSON.stringify(['files.read', 'shell.run']) };
    await assert.rejects(pool.query(`INSERT INTO workforce_run_admissions(id,actor_user_id,client_id,operation_id,request_hash,incarnation_hash,agent_resource_id,agent_version,
        agent_content_hash,target_kind,target_owner_user_id,target_workspace_id,project_id,assignment_id,assignment_revision,participation_id,participation_revision,
        payer_kind,payer_user_id,budget_ceiling_micro,requested_capabilities,effective_capabilities,rights,memory_namespace)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23::jsonb,$24)`,
    [widened.id, row.actor_user_id, row.client_id, widened.operation_id, row.request_hash, row.incarnation_hash, row.agent_resource_id, row.agent_version,
      row.agent_content_hash, row.target_kind, row.target_owner_user_id, row.target_workspace_id, row.project_id, row.assignment_id, row.assignment_revision,
      row.participation_id, row.participation_revision, row.payer_kind, row.payer_user_id, row.budget_ceiling_micro,
      JSON.stringify(['files.read', 'files.write', 'shell.run']), widened.effective_capabilities, JSON.stringify(row.rights), row.memory_namespace]),
    (e) => e.code === '23514', 'the database refuses an admission wider than its terms');
    await assert.rejects(pool.query("UPDATE workforce_run_admissions SET budget_ceiling_micro=1 WHERE id=$1", [row.id]),
      (e) => e.code === '23514', 'an admission is immutable');
    await assert.rejects(pool.query('DELETE FROM workforce_run_admissions WHERE id=$1', [row.id]), (e) => e.code === '23514', 'an admission is retained');
  });
});
