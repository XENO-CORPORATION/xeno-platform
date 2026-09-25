/**
 * XENO-WORKFORCE-01 RUN-03, NFR-06 and NFR-10 -- an admitted run keeps asking, and live revocation wins.
 *
 *   RUN-03: "Pins preserve reproducibility; live revocation still overrides pinned grants before each
 *            privileged call and new provider dispatch. On lost authority, checkpoint/stop according to
 *            the bounded lease policy; never spend indefinitely offline."
 *   NFR-06: "Connected revocation blocks the next privileged operation; disconnected execution uses
 *            explicit short-lived admission leases, maximum 60 seconds, and then checkpoints/blocks.
 *            Any already-dispatched noncancellable operation is visible until actual settlement."
 *   NFR-10: "The 60-second lease uses signed/validated expiry and a monotonic elapsed-time bound from
 *            receipt, with conservative clock-skew allowance. It cannot restart from zero after process
 *            restart, wall-clock rollback or reconnect. Without reliable remaining-validity proof,
 *            require online re-admission."
 *
 * Runs on the migrated schema (TEST_DATABASE_URL) against services/workforceRunAuthority.js and
 * 20260925140000-workforce-run-authority-leases.sql. Every refusal is paired with the pass that
 * precedes it, because a check that is only ever seen refusing could be refusing everything.
 *
 * Mutation-checked 2026-09-26, 19 mutants (each fails the named assertion; restored passes):
 *   - the assignment's liveness is not re-checked                    -> "live revocation overrides the pinned grant before the next privileged call"
 *   - the grant is taken from the admission snapshot, not the live view -> "the grant is read live through its effective policy, never from the admission snapshot"
 *   - authority may widen after admission                            -> "authority never widens past the admission"
 *   - a pin is treated as the current definition                     -> "a pin preserves reproducibility: the run keeps its admitted definition"
 *   - an archived agent keeps running                                -> "an archived agent runs nothing further"
 *   - the actor's target authority is not re-checked                 -> "an actor removed from the target stops"
 *   - the team membership is not re-checked                          -> "a member removed mid-run stops dispatching"
 *   - the entitlement is not re-checked                              -> "an expired entitlement stops the run mid-flight"
 *   - a funding refusal revokes the run                              -> "a funding refusal does not revoke: a top-up resumes the run"
 *   - a terminal loss is not recorded durably                        -> "losing a term of the admission revokes the run durably"
 *   - a revocation does not fence the next step                      -> "a stopped run authorizes nothing further"
 *   - another principal may drive the run                            -> "another principal cannot drive the run"
 *   - the database allows a lease past a revocation                  -> "no writer can lease past a revocation"
 *   - the database allows a lease longer than 60 seconds             -> "the database refuses a lease longer than 60 seconds"
 *   - the verifier ignores the signature                             -> "a lease signed by another key is refused"
 *   - the verifier applies skew in the lenient direction             -> "the skew allowance makes the verifier expire a lease early, never late"
 *   - the verifier has no monotonic bound                            -> "a wall-clock rollback does not extend a lease"
 *   - a restarted runtime is trusted without receipt proof           -> "a restarted runtime without remaining-validity proof must re-authorize online"
 *   - an older lease may be replayed                                 -> "an older lease cannot be replayed after a newer one"
 *
 * Two of these first reached the wrong assertion and were fixed IN THE TEST, not by re-labelling: the
 * widening mutant survived entirely (no case had a run admitted narrower than its grant), and the pin
 * mutant failed on an uncaught throw rather than on the pin assertion. A mutant that is only caught
 * incidentally does not prove the assertion it is listed against.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, generateKeyPairSync, createPublicKey } from 'node:crypto';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;

test('an admitted run re-asks before each step, and live revocation overrides its pin (RUN-03, NFR-06, NFR-10)', { skip: !url, timeout: 120000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(() => pool.end());
  assert.ok((await pool.query("SELECT to_regclass('workforce_run_leases') AS t")).rows[0].t, 'this suite runs on the migrated schema');
  const { admitRun } = await import('../src/server/services/workforceRunAdmission.js');
  const { authorizeRunStep, revokeRun, readRunAuthority, verifyRunLease, RUN_LEASE_MAX_SECONDS } = await import('../src/server/services/workforceRunAuthority.js');

  // An ephemeral signing key for this suite only -- never a machine or operator credential.
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signingKey = { kid: 'run-lease-test', privatePem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const publicKey = createPublicKey(signingKey.privatePem);
  const step = (actor, admissionId, operation, capability, opts = {}) =>
    authorizeRunStep(pool, ctx(actor), { admissionId, operation, ...(capability ? { capability } : {}) }, { signingKey, ...opts });

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

  const admit = async (actor, agent, target, extra) => (await admitRun(pool, ctx(actor), base(agent, target, extra))).admission.admissionId;

  await t.test('RUN-03: a live run is authorized step by step, each step a new lease in sequence', async () => {
    const id = await admit(editor, lent, { kind: 'workspace', assignmentId: lentIn });
    const a = await step(editor, id, 'provider_dispatch');
    assert.equal(a.lease.sequence, '1');
    assert.deepEqual(a.lease.effectiveCapabilities, ['files.read']);
    const b = await step(editor, id, 'privileged_call', 'files.read');
    assert.equal(b.lease.sequence, '2', 'every step is a new lease, in sequence');
    await rejects(step(editor, id, 'privileged_call', 'files.write'), 'denied', 'capability_not_live',
      'a call outside the admitted set is refused, whatever the definition asks for');
    assert.equal((await readRunAuthority(pool, ctx(editor), id)).revoked, false, 'refusing one call does not revoke the run');
  });

  await t.test('RUN-03: live revocation overrides the pinned grant before the next privileged call', async () => {
    const ws = await workspace(owner, 'revoke', [['editor', editor]]);
    const a = await assign(lent.id, 'agent', ws, { type: 'workspace', id: lender }, explicit(['files.read', 'files.write']));
    const id = await admit(editor, lent, { kind: 'workspace', assignmentId: a });
    await step(editor, id, 'privileged_call', 'files.write');
    await pool.query(`UPDATE workforce_workspace_assignments SET state='revoked', revision=revision+1, revoked_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [a]);
    await rejects(step(editor, id, 'privileged_call', 'files.read'), 'denied', 'assignment_not_live',
      'live revocation overrides the pinned grant before the next privileged call');
    const state = await readRunAuthority(pool, ctx(editor), id);
    assert.equal(state.revoked, true, 'losing a term of the admission revokes the run durably');
    assert.equal(state.reason, 'authority_lost');
    // Reinstating the grant does not resurrect the run: a revocation is a fence, and a new run is a new admission.
    await rejects(step(editor, id, 'provider_dispatch'), 'denied', 'admission_revoked', 'a revoked run stays revoked');
  });

  await t.test('RUN-03: the grant is read LIVE through its effective policy, never from the admission snapshot', async () => {
    // Accepted assignment terms are immutable ("revoke and repropose"), so a running grant changes only
    // through what the effective-policy view derives. An inherit_parent grant whose PARENT is revoked
    // still reads `accepted` on its own row -- and grants nothing. A check that read the state column, or
    // the admission's recorded rights, would keep authorizing it.
    const ws = await workspace(owner, 'inherit', [['editor', editor]]);
    const division = (await pool.query(`INSERT INTO workforce_divisions(workspace_id,key,name,created_by_user_id) VALUES($1,'office','Office',$2) RETURNING id`,
      [ws, owner])).rows[0].id;
    const parent = await assign(lent.id, 'agent', ws, { type: 'workspace', id: lender }, explicit(['files.read', 'files.write']));
    const revision = Number((await pool.query('SELECT revision FROM workforce_workspace_assignments WHERE id=$1', [parent])).rows[0].revision);
    const child = await assignTo(lent.id, ws, division, { schemaVersion: 1, mode: 'inherit_parent', capabilities: [], parent: { assignmentId: parent, revision } });
    const id = await admit(editor, lent, { kind: 'workspace', assignmentId: child }, { capabilities: ['files.read', 'files.write'] });
    assert.deepEqual((await step(editor, id, 'provider_dispatch')).lease.effectiveCapabilities, ['files.read', 'files.write']);
    await pool.query(`UPDATE workforce_workspace_assignments SET state='revoked', revision=revision+1, revoked_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [parent]);
    assert.equal((await pool.query('SELECT state FROM workforce_workspace_assignments WHERE id=$1', [child])).rows[0].state, 'accepted',
      'the inheriting grant still reads accepted on its own row');
    await rejects(step(editor, id, 'privileged_call', 'files.read'), 'denied', 'capability_not_live',
      'the grant is read live through its effective policy, never from the admission snapshot');
    await rejects(step(editor, id, 'provider_dispatch'), 'denied', 'no_live_capabilities', 'a run with nothing left is stopped, not dispatched');
    assert.equal((await readRunAuthority(pool, ctx(editor), id)).revoked, true, 'losing every capability revokes the run');
  });

  await t.test('RUN-03: authority never widens past the admission, even where the live grant is wider', async () => {
    // The grant allows read AND write; the run asked only to read. Live authority is the intersection of
    // the ADMISSION with what is still live -- so the grant's extra capability never reaches the run.
    const ws = await workspace(owner, 'wide', [['editor', editor]]);
    const a = await assign(lent.id, 'agent', ws, { type: 'workspace', id: lender }, explicit(['files.read', 'files.write']));
    const id = await admit(editor, lent, { kind: 'workspace', assignmentId: a }, { capabilities: ['files.read'] });
    assert.deepEqual((await step(editor, id, 'provider_dispatch')).lease.effectiveCapabilities, ['files.read']);
    await rejects(step(editor, id, 'privileged_call', 'files.write'), 'denied', 'capability_not_live',
      'authority never widens past the admission');
    // A runtime ceiling recorded at admission narrows every later lease the same way.
    const capped = await admit(editor, lent, { kind: 'workspace', assignmentId: a },
      { capabilities: ['files.read', 'files.write'], runtimeCapabilities: ['files.read'] });
    await rejects(step(editor, capped, 'privileged_call', 'files.write'), 'denied', 'capability_not_live',
      'a runtime ceiling recorded at admission still narrows the run');
  });

  await t.test('RUN-03: a pin preserves reproducibility -- a newer definition does not revoke the run', async () => {
    const agent = await agentResource({ type: 'user', id: owner }, 'Pinned', ['files.read']);
    const id = await admit(owner, agent, { kind: 'personal', ownerUserId: owner }, { capabilities: ['files.read'] });
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,2,$2,$3)`,
      [agent.id, { instructions: 'v2', skills: [], requestedCapabilities: [], secretReferences: [] }, hash(`${agent.id}:2`)]);
    const r = await step(owner, id, 'privileged_call', 'files.read').catch((e) => e);
    assert.equal(r?.lease?.sequence, '1', 'a pin preserves reproducibility: the run keeps its admitted definition');
    // Archiving the agent is a revocation of it, pinned or not.
    await pool.query(`UPDATE workforce_resources SET status='archived', revision=revision+1, updated_at=clock_timestamp() WHERE id=$1`, [agent.id]);
    await rejects(step(owner, id, 'provider_dispatch'), 'denied', 'agent_not_found', 'an archived agent runs nothing further');
  });

  await t.test('RUN-03: the actor losing the target, or the team membership, stops the run', async () => {
    await fund(viewer, 5_000_000n);
    const ws = await workspace(owner, 'member', [['editor', viewer]]);
    const a = await assign(lent.id, 'agent', ws, { type: 'workspace', id: lender }, explicit(['files.read']));
    const id = await admit(viewer, lent, { kind: 'workspace', assignmentId: a });
    await step(viewer, id, 'provider_dispatch');
    await pool.query(`DELETE FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND subject_id=$2`, [ws, viewer]);
    await rejects(step(viewer, id, 'provider_dispatch'), 'denied', 'actor_cannot_act_for_target', 'an actor removed from the target stops');

    const team = (await pool.query(`INSERT INTO workforce_resources(kind,owner_workspace_id,name) VALUES('team',$1,'Crew') RETURNING id`, [studio])).rows[0].id;
    const crewAgent = await agentResource({ type: 'workspace', id: studio }, 'CrewAgent', ['files.read']);
    await pool.query(`INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,role) VALUES($1,$2,'agent','worker')`, [team, crewAgent.id]);
    const mem = (await pool.query(`INSERT INTO workforce_team_memberships(team_id,member_principal_id,role) VALUES($1,$2,'worker') RETURNING id`, [team, editor])).rows[0].id;
    const teamIn = await assign(team, 'team', studio, { type: 'workspace', id: studio }, explicit(['files.read']));
    const tid = await admit(editor, crewAgent, { kind: 'workspace', assignmentId: teamIn }, { team: { teamId: team } });
    await step(editor, tid, 'provider_dispatch');
    await pool.query(`UPDATE workforce_team_memberships SET state='revoked', revision=revision+1, revoked_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [mem]);
    await rejects(step(editor, tid, 'provider_dispatch'), 'denied', 'actor_not_an_admitted_member', 'a member removed mid-run stops dispatching');
  });

  await t.test('RUN-03: an expired entitlement stops a bought agent mid-run', async () => {
    const dev = (await pool.query(`INSERT INTO marketplace_developers(user_id,display_name,slug) VALUES($1,'Seller',$2) RETURNING id`, [outsider, `${marker}-dev`])).rows[0].id;
    const listing = (await pool.query(`INSERT INTO marketplace_listings(slug,kind,developer_id,title,status,license) VALUES($1,'panel',$2,'Bought','published','MIT') RETURNING id`,
      [`${marker}-listing`, dev])).rows[0].id;
    const lv = (await pool.query(`INSERT INTO marketplace_listing_versions(listing_id,version,declared_capabilities,published_at) VALUES($1,'1.0.0','["files.read"]'::jsonb,now()) RETURNING id`,
      [listing])).rows[0].id;
    const bought = await agentResource({ type: 'user', id: editor }, 'Bought', ['files.read'], { provenance: { source: 'imported', listingVersionId: lv } });
    const ent = (await pool.query(`INSERT INTO marketplace_entitlements(user_id,listing_id,kind) VALUES($1,$2,'owned') RETURNING id`, [editor, listing])).rows[0].id;
    const id = await admit(editor, bought, { kind: 'personal', ownerUserId: editor }, { capabilities: ['files.read'] });
    await step(editor, id, 'privileged_call', 'files.read');
    await pool.query(`UPDATE marketplace_entitlements SET status='expired' WHERE id=$1`, [ent]);
    await rejects(step(editor, id, 'privileged_call', 'files.read'), 'denied', 'entitlement_not_live', 'an expired entitlement stops the run mid-flight');
  });

  await t.test('NFR-06: a payer who cannot fund is refused for the step, not revoked; a stop is durable and fences every lease', async () => {
    const id = await admit(owner, mine, { kind: 'personal', ownerUserId: owner }, { capabilities: ['files.read'] });
    await step(owner, id, 'provider_dispatch');
    await pool.query('UPDATE credit_accounts SET is_frozen=true WHERE user_id=$1', [owner]);
    await rejects(step(owner, id, 'provider_dispatch'), 'needs_approval', 'payer_cannot_fund', 'a payer who cannot fund is refused this step');
    assert.equal((await readRunAuthority(pool, ctx(owner), id)).revoked, false, 'a funding refusal does not revoke: a top-up resumes the run');
    await pool.query('UPDATE credit_accounts SET is_frozen=false WHERE user_id=$1', [owner]);
    assert.equal((await step(owner, id, 'provider_dispatch')).lease.sequence, '2', 'the run resumes when it can be funded again');
    // A deliberate stop by the actor, and one by someone who may act for the target.
    const stopped = await revokeRun(pool, ctx(owner), id);
    assert.deepEqual([stopped.revoked, stopped.reason], [true, 'stopped_by_actor']);
    await rejects(step(owner, id, 'provider_dispatch'), 'denied', 'admission_revoked', 'a stopped run authorizes nothing further');
    assert.equal((await revokeRun(pool, ctx(owner), id)).reason, 'stopped_by_actor', 'stopping twice is idempotent');
    const ws = await admit(editor, lent, { kind: 'workspace', assignmentId: lentIn });
    assert.equal((await revokeRun(pool, ctx(owner), ws)).reason, 'stopped_by_target', 'the target can stop a run in its workspace');
    await rejects(revokeRun(pool, ctx(outsider), id), 'not_found', 'admission_not_found', 'nobody else can stop, or learn of, the run');
  });

  await t.test('NFR-06: a lease lives at most 60 seconds, and the database refuses one that lives longer', async () => {
    const id = await admit(editor, lent, { kind: 'workspace', assignmentId: lentIn });
    const { lease } = await step(editor, id, 'provider_dispatch');
    const lifetime = (Date.parse(lease.expiresAt) - Date.parse(lease.issuedAt)) / 1000;
    assert.ok(lifetime > 0 && lifetime <= RUN_LEASE_MAX_SECONDS, 'a lease lives at most 60 seconds');
    await assert.rejects(pool.query(`INSERT INTO workforce_run_leases(admission_id,sequence,operation,effective_capabilities,issued_at,expires_at,signing_kid,token_hash)
      VALUES($1,2,'provider_dispatch','[]',now(),now()+interval '61 seconds','k',$2)`, [id, hash('long')]), (e) => e.code === '23514',
      'the database refuses a lease longer than 60 seconds');
    await assert.rejects(pool.query(`INSERT INTO workforce_run_leases(admission_id,sequence,operation,effective_capabilities,issued_at,expires_at,signing_kid,token_hash)
      VALUES($1,5,'provider_dispatch','[]',now(),now()+interval '10 seconds','k',$2)`, [id, hash('gap')]), (e) => e.code === '23514',
      'a lease sequence advances by exactly one');
    await revokeRun(pool, ctx(editor), id);
    await assert.rejects(pool.query(`INSERT INTO workforce_run_leases(admission_id,sequence,operation,effective_capabilities,issued_at,expires_at,signing_kid,token_hash)
      VALUES($1,2,'provider_dispatch','[]',now(),now()+interval '10 seconds','k',$2)`, [id, hash('late')]), (e) => e.code === '23514',
      'no writer can lease past a revocation');
    await assert.rejects(pool.query('UPDATE workforce_run_leases SET expires_at=expires_at WHERE admission_id=$1', [id]), (e) => e.code === '23514', 'a lease is immutable');
    await assert.rejects(pool.query('DELETE FROM workforce_run_revocations WHERE admission_id=$1', [id]), (e) => e.code === '23514', 'a revocation is retained');
  });

  await t.test('NFR-10: the lease is signed, bounded from receipt by a monotonic clock, and cannot restart from zero', async () => {
    const id = await admit(editor, lent, { kind: 'workspace', assignmentId: lentIn });
    const { token, lease } = await step(editor, id, 'provider_dispatch');
    const wall = Date.parse(lease.issuedAt);
    const mono = 1_000_000; // a monotonic reading taken on receipt; its origin is arbitrary
    const verify = (over = {}) => verifyRunLease(token, { publicKey, admissionId: id, receivedAtMono: mono, nowMono: mono + 1000, nowWallMs: wall + 1000, ...over });
    assert.equal(verify().valid, true, 'a fresh lease verifies');
    assert.deepEqual(verify().capabilities, ['files.read']);
    // Signed and validated: a forged or altered lease is refused.
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey;
    assert.equal(verify({ publicKey: other }).reason, 'bad_signature', 'a lease signed by another key is refused');
    const [h, p, s] = token.split('.');
    const widened = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), caps: ['files.read', 'shell.run'] })).toString('base64url');
    assert.equal(verifyRunLease(`${h}.${widened}.${s}`, { publicKey, admissionId: id, receivedAtMono: mono, nowMono: mono, nowWallMs: wall }).reason, 'bad_signature',
      'a lease cannot be widened by its holder');
    assert.equal(verify({ admissionId: randomUUID() }).reason, 'wrong_subject', 'a lease authorizes only its own admission');
    // Expiry by the wall clock, with the skew allowance applied conservatively.
    assert.equal(verify({ nowWallMs: wall + (RUN_LEASE_MAX_SECONDS - 4) * 1000, nowMono: mono + 1000 }).reason, 'expired',
      'the skew allowance makes the verifier expire a lease early, never late');
    // A wall clock wound BACK cannot extend a lease: the monotonic bound from receipt still expires it.
    assert.equal(verify({ nowWallMs: wall, nowMono: mono + RUN_LEASE_MAX_SECONDS * 1000 }).reason, 'expired',
      'a wall-clock rollback does not extend a lease');
    // A restart loses the monotonic origin: without proof of when it was received, the lease is not trusted.
    assert.equal(verify({ receivedAtMono: null }).reason, 'requires_online_reauthorization',
      'a restarted runtime without remaining-validity proof must re-authorize online');
    // A replayed older lease after reconnect is superseded by the newer one already seen.
    const newer = await step(editor, id, 'provider_dispatch');
    assert.equal(verify({ minSequence: BigInt(newer.lease.sequence) }).reason, 'superseded', 'an older lease cannot be replayed after a newer one');
    // Revocation fences it at the source: whatever a disconnected runtime still holds, the platform issues nothing more.
    await revokeRun(pool, ctx(editor), id);
    await rejects(step(editor, id, 'provider_dispatch'), 'denied', 'admission_revoked', 'reconnecting after revocation cannot renew the lease');
  });

  await t.test('only the admitted actor on the admitted client drives the run', async () => {
    const id = await admit(editor, lent, { kind: 'workspace', assignmentId: lentIn });
    await rejects(step(owner, id, 'provider_dispatch'), 'not_found', 'admission_not_found', 'another principal cannot drive the run');
    await rejects(authorizeRunStep(pool, ctx(editor, 'another-client'), { admissionId: id, operation: 'provider_dispatch' }, { signingKey }),
      'not_found', 'admission_not_found', 'another client of the same actor cannot drive the run');
    await rejects(step(editor, id, 'privileged_call'), 'bad_input', 'invalid_capability', 'a privileged call names its capability');
    await rejects(authorizeRunStep(pool, ctx(editor), { admissionId: id, operation: 'provider_dispatch', extra: 1 }, { signingKey }),
      'bad_input', 'unknown_field', 'the request shape is closed');
  });
});
