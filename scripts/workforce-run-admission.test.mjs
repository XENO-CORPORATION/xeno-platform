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
  const { admitRun, readRunAdmission } = await import('../src/server/services/workforceRunAdmission.js');

  const marker = `run-${randomUUID().slice(0, 8)}`;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const none = { schemaVersion: 1, mode: 'none', capabilities: [] };
  const explicit = (caps) => ({ schemaVersion: 1, mode: 'explicit', capabilities: caps });
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$1,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const fund = (u, micro) => pool.query(`INSERT INTO credit_accounts(user_id,balance) VALUES($1,$2)
    ON CONFLICT (user_id) DO UPDATE SET balance=EXCLUDED.balance`, [u, micro]);
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
      'denied', 'actor_cannot_act_for_target', 'owning a resource is not authority in a workspace');
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
    const wide = await assign(lent.id, 'agent', ws, { type: 'workspace', id: lender }, explicit(['files.read', 'files.write', 'shell.run']));
    const narrow = await assignTo(lent.id, ws, division, explicit(['files.read']));
    const r = await admitRun(pool, ctx(editor), base(lent, { kind: 'workspace', assignmentId: narrow }));
    assert.deepEqual(r.admission.capabilities.effective, ['files.read'], 'a division grant is not unioned with its parent scope');
    assert.ok(wide);
    // An explicitly INHERITING grant takes exactly its bound parent's set -- and nothing once that parent dies.
    const inherits = await assignTo(lent.id, ws, (await pool.query(`INSERT INTO workforce_divisions(workspace_id,key,name,created_by_user_id)
      VALUES($1,'studio','Studio',$2) RETURNING id`, [ws, owner])).rows[0].id,
      { schemaVersion: 1, mode: 'inherit_parent', capabilities: [], parent: { assignmentId: wide,
        revision: Number((await pool.query('SELECT revision FROM workforce_workspace_assignments WHERE id=$1', [wide])).rows[0].revision) } });
    const inherited = await admitRun(pool, ctx(editor), base(lent, { kind: 'workspace', assignmentId: inherits }));
    assert.deepEqual(inherited.admission.capabilities.effective, ['files.read', 'files.write', 'shell.run'], 'inheritance is the bound parent, explicitly');
    await pool.query(`UPDATE workforce_workspace_assignments SET state='revoked', revision=revision+1, revoked_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [wide]);
    const orphaned = await admitRun(pool, ctx(editor), base(lent, { kind: 'workspace', assignmentId: inherits }));
    assert.deepEqual(orphaned.admission.capabilities.effective, [], 'an inherited grant whose parent is revoked grants nothing');
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
