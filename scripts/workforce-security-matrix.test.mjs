/**
 * XENO-WORKFORCE-01 NFR-01 -- the security matrix: no cross-owner or cross-workspace disclosure, and no
 * grant nobody made, across EVERY workforce read and write.
 *
 *   NFR-01: "Zero cross-owner/workspace disclosure or unexpected additional grants in the
 *            migration/security matrix."
 *
 * Every per-surface suite proves its own refusals. None proves the MATRIX: the whole set of actors a
 * workforce has, against the whole set of surfaces it exposes, with the one property that makes it a
 * matrix -- that nothing about another owner's work is learnable anywhere, and that no path grants what
 * was not granted. This suite is that matrix. It runs on the migrated schema (TEST_DATABASE_URL) against
 * the real services, and builds ONE fixture holding every kind of record there is:
 *
 *   Studio (a workspace) owns: an agent, a team, a division, a project and a participation in it, an
 *   assignment of a lent agent, an admitted run with a lease and a child, a result and its delivery, an
 *   ownership transfer in flight, a handoff and a decision record. Its members are an owner, an editor,
 *   a viewer and an agent principal.
 *   Rival (another workspace) and a stranger (no workspace) stand OUTSIDE it.
 *
 * ── THE TWO PROPERTIES ──────────────────────────────────────────────────────────────────────────────
 *   DISCLOSURE  For every read surface, each outsider asking about each Studio record gets an answer
 *               BYTE-IDENTICAL to the answer for a random id that exists nowhere. Compared on the whole
 *               observable refusal (code, status, every detail), because an oracle is built from the
 *               difference, never from a single refusal. And the control: an insider's read of the same
 *               record DIFFERS, so the comparison is not two empty answers agreeing.
 *   GRANTS      Every write surface refuses every outsider, and after the whole matrix has run, the
 *               set of relationship tuples, assignments, memberships, participations, admissions,
 *               leases, results, deliveries, transfers and API-key capabilities is EXACTLY the set the
 *               fixture created: no refusal left a partial write, and nothing the matrix did granted
 *               anything. A grant is a row, so an unexpected grant is an unexpected row.
 *
 * ── WHAT IT DOES NOT CLAIM ──────────────────────────────────────────────────────────────────────────
 * The "migration" half of the matrix is §18 step 4 -- "compare old/new decisions read-only over allow and
 * deny cases; any unexpected grant fails the gate". The two migrations that reconstruct legacy access are
 * proven where they live: the legacy empty=inherited policy (workforce-assignment-inherit-parent) and the
 * absorbed `workspace_teams` model granting nothing (workforce-team-project-responsibility). This suite
 * adds the cross-surface half, which no single-surface suite can see.
 *
 * Mutation-checked 2026-09-27, 10 mutants, each fails the named assertion; restored passes:
 *   - the catalog answers an outsider differently from a missing scope -> "the catalog discloses nothing about Studio"
 *   - the pin read skips its visibility check                          -> "the pin read discloses nothing about Studio"
 *   - an admission read is shown to anyone                             -> "an admission is not disclosed outside its target"
 *   - capacity is readable by any signed-in principal                  -> "capacity discloses nothing about Studio"
 *   - an evaluation is readable by a non-admin                         -> "an evaluation discloses nothing about Studio"
 *   - a run outcome is readable by anyone                              -> "a run's outcome is its actor's alone"
 *   - run authority is readable by anyone                              -> "a run's authority is its actor's alone"
 *   - a transfer is readable by a manager of neither side             -> "a transfer is disclosed to neither side's outsiders"
 *   - a refused step still records a revocation                        -> "no refused write leaves anything behind"
 *   - admitting a run writes a relationship tuple                      -> "admission grants nothing"
 * Each disclosure mutant is caught by the SAME comparison -- an outsider's answer about a real record against
 * its answer about an id that exists nowhere -- so one rule covers every read surface, and a new surface is
 * covered by adding one row to `reads`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, generateKeyPairSync } from 'node:crypto';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;

test('NFR-01: no cross-owner or cross-workspace disclosure, and no unexpected grant, across the workforce matrix', { skip: !url, timeout: 180000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  t.after(() => pool.end());
  assert.ok((await pool.query("SELECT to_regclass('workforce_run_results') AS v")).rows[0].v, 'this suite runs on the migrated schema');

  const svc = {
    catalog: await import('../src/server/services/workforceCatalog.js'),
    admission: await import('../src/server/services/workforceRunAdmission.js'),
    authority: await import('../src/server/services/workforceRunAuthority.js'),
    results: await import('../src/server/services/workforceRunResults.js'),
    capacity: await import('../src/server/services/workforceCapacity.js'),
    evaluation: await import('../src/server/services/workforceEvaluation.js'),
    transfer: await import('../src/server/services/workforceOwnershipTransfer.js'),
    resources: await import('../src/server/services/workforceResources.js'),
    teams: await import('../src/server/services/workspaceTeams.js'),
  };

  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signingKey = { kid: 'matrix-test', privatePem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const marker = `mx-${randomUUID().slice(0, 8)}`;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const explicit = (caps) => ({ schemaVersion: 1, mode: 'explicit', capabilities: caps });
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$1,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const workspace = async (owner, s) => {
    const id = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-${s}`])).rows[0].id;
    await tuple('workspace', id, 'owner', 'user', owner);
    return id;
  };
  const tuple = (ot, oid, rel, st, sid) => pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
    VALUES($1,$2,$3,$4,$5)`, [ot, oid, rel, st, sid]);
  const ctx = (actorUserId) => ({ actorUserId, clientId: 'xeno-agent-interface' });

  // ── the fixture: one of everything, in Studio ────────────────────────────────────────────────────
  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer');
  const rivalOwner = await user('rival'), stranger = await user('stranger'), lenderOwner = await user('lender');
  await pool.query('INSERT INTO credit_accounts(user_id,balance) VALUES($1,90000000),($2,90000000),($3,90000000)', [owner, editor, rivalOwner]);
  // Admission's budget term reads eligible credit_grants lots (utils/usageCreditFunding.js
  // allocateFunding), not the cached credit_accounts.balance alone -- fund a real paid lot +
  // overflow-on per payer, idempotently (deterministic grant id, replace not accumulate).
  for (const u of [owner, editor, rivalOwner]) {
    await pool.query(`INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)
      ON CONFLICT (user_id) DO UPDATE SET enabled=true`, [u]);
    await pool.query(`INSERT INTO credit_grants(id,user_id,amount_micro,remaining_micro,kind,source_ref)
      VALUES(md5('test-fund:'||$1::text)::uuid,$1::uuid,90000000,90000000,'paid','test-fund')
      ON CONFLICT (id) DO UPDATE SET amount_micro=EXCLUDED.amount_micro, remaining_micro=EXCLUDED.remaining_micro`, [u]);
  }
  const studio = await workspace(owner, 'studio'), rival = await workspace(rivalOwner, 'rival'), lender = await workspace(lenderOwner, 'lender');
  await tuple('workspace', studio, 'editor', 'user', editor);
  await tuple('workspace', studio, 'viewer', 'user', viewer);
  // An agent PRINCIPAL of Studio's editor: an insider by delegation, never by default.
  const agentUser = await user('agent');
  await pool.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role) VALUES($1,$2,'personal')", [agentUser, editor]);

  const agentOf = async (ownerWs, name) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO workforce_resources(id,kind,owner_workspace_id,name) VALUES($1,'agent',$2,$3)`, [id, ownerWs, `${marker}-${name}`]);
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)`,
      [id, { instructions: name, skills: [], requestedCapabilities: ['files.read'], secretReferences: [] }, hash(`${id}:1`)]);
    return id;
  };
  const accept = async (resourceId, workspaceId, sourceWs, extra = {}) => {
    const rev = (await pool.query('SELECT revision FROM workforce_resources WHERE id=$1', [resourceId])).rows[0].revision;
    const a = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,resource_revision,policy,target_division_id)
      VALUES($1,'agent',$2,$3,$4,$5,$6) RETURNING id`, [resourceId, workspaceId, sourceWs, rev, explicit(['files.read']), extra.division ?? null])).rows[0].id;
    await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted', revision=revision+1, source_approved_by_user_id=$2,
      source_approved_at=clock_timestamp(), target_accepted_by_user_id=$2, accepted_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [a, owner]);
    return a;
  };
  const own = await agentOf(studio, 'own');
  const lent = await agentOf(lender, 'lent');
  const lentIn = await accept(lent, studio, lender);
  const division = (await pool.query(`INSERT INTO workforce_divisions(workspace_id,key,name,created_by_user_id) VALUES($1,'creative','Creative',$2) RETURNING id`,
    [studio, owner])).rows[0].id;
  await tuple('division', division, 'editor', 'user', editor);
  const team = (await svc.teams.saveWorkspaceTeam(pool, { workspaceId: studio, userId: owner, input: { name: `${marker}-team`, description: '', project_ids: [], agent_ids: [] } })).team?.id
    ?? (await pool.query(`SELECT id FROM workforce_resources WHERE kind='team' AND owner_workspace_id=$1`, [studio])).rows[0].id;
  const project = (await pool.query('INSERT INTO chat_projects(workspace_id,name) VALUES($1,$2) RETURNING id', [studio, `${marker}-p`])).rows[0].id;
  const participation = (await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,workspace_id,assignment_id,responsibility,policy)
    VALUES($1,'agent',$2,'workspace',$3,$4,'reviewer',$5) RETURNING id`, [lent, project, studio, lentIn, explicit(['files.read'])])).rows[0].id;
  const admitFor = async (actor, parent) => (await svc.admission.admitRun(pool, ctx(actor), { operationId: randomUUID(),
    agent: { resourceId: lent, version: 1, contentHash: hash(`${lent}:1`) }, target: { kind: 'workspace', assignmentId: lentIn },
    capabilities: ['files.read'], budget: { ceilingMicro: parent ? '100000' : '1000000' }, ...(parent ? { parent: { admissionId: parent } } : {}) })).admission.admissionId;
  const run = await admitFor(editor);
  await svc.authority.authorizeRunStep(pool, ctx(editor), { admissionId: run, operation: 'provider_dispatch' }, { signingKey });
  const child = await admitFor(editor, run);
  await svc.results.reportRunResult(pool, ctx(editor), { admissionId: child, outcome: 'completed', summary: 'done' });
  await svc.results.deliverRunResult(pool, ctx(editor), { childAdmissionId: child, parentAdmissionId: run });
  const transfer = (await svc.transfer.proposeOwnershipTransfer(pool, { actorUserId: owner, resourceId: own, to: { type: 'workspace', id: lender } })).id;
  const handoff = (await pool.query(`INSERT INTO workforce_handoffs(source_principal_id,target_principal_id,work_ref_type,work_ref_id,source_workspace_id,target_workspace_id)
    VALUES($1,$2,'task',$3,$4,$4) RETURNING id`, [editor, owner, randomUUID(), studio])).rows[0].id;
  await pool.query(`INSERT INTO workforce_operations(actor_user_id,client_id,operation_id,request_hash,kind,subject_type,subject_id,deciding_principal_id,
    responsible_account_id,authority,workspace_id) VALUES($1,'c',$2,$3,'member.admit','membership',$4,$1,$1,'test',$5)`, [owner, randomUUID(), hash(marker), randomUUID(), studio]);
  const recordIds = { own, lent, lentIn, division, team, project, participation, run, child, transfer, handoff };

  // ── the ledger of grants: everything that can confer authority, as it stands before the matrix runs ──
  const GRANT_TABLES = ['relationship_tuples', 'workforce_workspace_assignments', 'workforce_team_memberships', 'workforce_project_participations',
    'workforce_assignment_members', 'workforce_run_admissions', 'workforce_run_leases', 'workforce_run_revocations', 'workforce_run_results',
    'workforce_run_result_deliveries', 'workforce_ownership_transfers', 'workforce_resources', 'workforce_agent_versions', 'workforce_divisions',
    'workforce_division_ownership', 'workforce_division_funding', 'workforce_handoffs', 'workforce_operations', 'api_key_workforce_capabilities',
    'agent_identities', 'marketplace_entitlements'];
  const grantLedger = async () => {
    const out = {};
    for (const table of GRANT_TABLES) {
      if (!(await pool.query('SELECT to_regclass($1) AS t', [table])).rows[0].t) continue;
      out[table] = (await pool.query(`SELECT md5(coalesce(string_agg(md5(t::text), ',' ORDER BY md5(t::text)), '')) AS h, count(*)::int AS n FROM ${table} t`)).rows[0];
    }
    return out;
  };
  const before = await grantLedger();

  // ── the refusal every outsider must get, compared whole ──────────────────────────────────────────
  const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
  const answer = (p) => p.then((value) => JSON.stringify({ allowed: true, value: canonical(value) }),
    (e) => JSON.stringify({ code: e.code ?? null, status: e.status ?? null, details: canonical(e.details ?? null), name: e.name ?? null }));
  const outsiders = { rivalOwner, stranger };
  const missing = randomUUID();

  // Each read surface: how an actor asks about a record id, and an insider who may see it (the control).
  const WS = (id) => ({ type: 'workspace', id });
  const reads = [
    ['the catalog discloses nothing about Studio', owner, (actor, id) => svc.catalog.listOwnedWorkforceResources(pool, ctx(actor),
      { owner: WS(id), expectedActorAccountId: actor }), studio],
    ['capacity discloses nothing about Studio', owner, (actor, id) => svc.capacity.readWorkforceCapacity(pool, ctx(actor),
      { owner: WS(id), expectedActorAccountId: actor }), studio],
    ['an evaluation discloses nothing about Studio', owner, (actor, id) => svc.evaluation.readWorkforceEvaluation(pool, ctx(actor),
      { owner: WS(id), subject: { kind: 'agent', resourceId: lent }, window: { since: '2026-01-01T00:00:00Z', until: '2026-12-31T00:00:00Z' }, expectedActorAccountId: actor }), studio],
    ['the pin read discloses nothing about Studio', editor, (actor, id) => svc.admission.readRunnablePin(pool, ctx(actor),
      { agent: { resourceId: lent }, target: { kind: 'workspace', assignmentId: id } }), lentIn],
    ['an admission is not disclosed outside its target', editor, (actor, id) => svc.admission.readRunAdmission(pool, ctx(actor), id), run],
    ['a run\'s authority is its actor\'s alone', editor, (actor, id) => svc.authority.readRunAuthority(pool, ctx(actor), id), run],
    ['a run\'s outcome is its actor\'s alone', editor, (actor, id) => svc.results.readRunOutcome(pool, ctx(actor), { admissionId: id }), child],
    ['a transfer is disclosed to neither side\'s outsiders', owner, (actor, id) => svc.transfer.readOwnershipTransfer(pool, { actorUserId: actor, transferId: id }), transfer],
    ['a transfer\'s review subject is disclosed to neither side\'s outsiders', owner, (actor, id) => svc.transfer.transferReviewSubject(pool, { actorUserId: actor, transferId: id }), transfer],
  ];

  await t.test('DISCLOSURE: every read answers an outsider exactly as it answers an id that exists nowhere', async () => {
    for (const [property, insider, ask, id] of reads) {
      const control = await answer(ask(insider, id));
      for (const [who, actor] of Object.entries(outsiders)) {
        const unknown = await answer(ask(actor, missing));
        assert.notEqual(unknown.includes('"allowed":true'), true, `${property}: a missing id is not readable (${who})`);
        assert.equal(await answer(ask(actor, id)), unknown, `${property} (${who})`);
      }
      assert.notEqual(control, await answer(ask(stranger, missing)), `${property}: the insider's answer differs, so the comparison is not vacuous`);
    }
  });

  await t.test('DISCLOSURE: a Studio member without the right answers like an outsider too, where the record is not theirs', async () => {
    // Being inside the workspace is not being inside the run: the viewer may see the workspace, never another
    // actor's run authority or outcome.
    for (const [property, , ask, id] of reads.filter(([p]) => /actor's alone/.test(p))) {
      assert.equal(await answer(ask(viewer, id)), await answer(ask(viewer, missing)), `${property} (a viewer of the workspace)`);
      assert.equal(await answer(ask(agentUser, id)), await answer(ask(agentUser, missing)), `${property} (the actor's own agent principal)`);
    }
  });

  await t.test('GRANTS: every write refuses every outsider, and no refused write leaves anything behind', async () => {
    const writes = [
      (a) => svc.admission.admitRun(pool, ctx(a), { operationId: randomUUID(), agent: { resourceId: lent, version: 1, contentHash: hash(`${lent}:1`) },
        target: { kind: 'workspace', assignmentId: lentIn }, capabilities: ['files.read'], budget: { ceilingMicro: '1' } }),
      (a) => svc.admission.admitRun(pool, ctx(a), { operationId: randomUUID(), agent: { resourceId: lent, version: 1, contentHash: hash(`${lent}:1`) },
        target: { kind: 'workspace', assignmentId: lentIn }, capabilities: ['files.read'], budget: { ceilingMicro: '1' }, parent: { admissionId: run } }),
      (a) => svc.authority.authorizeRunStep(pool, ctx(a), { admissionId: run, operation: 'provider_dispatch' }, { signingKey }),
      (a) => svc.authority.revokeRun(pool, ctx(a), run),
      (a) => svc.results.reportRunResult(pool, ctx(a), { admissionId: run, outcome: 'completed' }),
      (a) => svc.results.deliverRunResult(pool, ctx(a), { childAdmissionId: child, parentAdmissionId: run }),
      (a) => svc.transfer.proposeOwnershipTransfer(pool, { actorUserId: a, resourceId: own, to: WS(rival) }),
      (a) => svc.transfer.authorizeOwnershipTransfer(pool, { actorUserId: a, transferId: transfer }),
      (a) => svc.transfer.declineOwnershipTransfer(pool, { actorUserId: a, transferId: transfer, reason: 'not mine' }),
      (a) => svc.resources.createWorkforceResource(pool, ctx(a), { operationId: randomUUID(), owner: WS(studio), kind: 'team', name: 'Intruder' }),
      (a) => svc.teams.saveWorkspaceTeam(pool, { workspaceId: studio, userId: a, input: { name: 'Intruder', description: '', project_ids: [], agent_ids: [] } }),
      (a) => svc.teams.saveWorkspaceTeam(pool, { workspaceId: studio, userId: a, teamId: team, archive: true, input: {} }),
    ];
    for (const [who, actor] of Object.entries(outsiders)) {
      for (const [i, write] of writes.entries()) {
        const r = await answer(write(actor));
        assert.equal(r.includes('"allowed":true'), false, `write ${i} is refused to an outsider (${who})`);
      }
    }
    assert.deepEqual(await grantLedger(), before, 'no refused write leaves anything behind');
  });

  await t.test('GRANTS: what the fixture did granted nothing it did not write, and no path widened anyone', async () => {
    // Every relationship tuple in the fixture's scopes is one the fixture wrote, by name.
    const scoped = (await pool.query(`SELECT object_type, object_id, relation, subject_type, subject_id FROM relationship_tuples
      WHERE object_id = ANY($1::text[]) OR subject_id = ANY($2::text[]) ORDER BY 1,2,3,4,5`,
    [[studio, rival, lender, division].map(String), [owner, editor, viewer, rivalOwner, stranger, lenderOwner, agentUser].map(String)])).rows
      .map((r) => `${r.object_type}:${r.object_id}#${r.relation}@${r.subject_type}:${r.subject_id}`);
    const written = [`workspace:${studio}#owner@user:${owner}`, `workspace:${rival}#owner@user:${rivalOwner}`, `workspace:${lender}#owner@user:${lenderOwner}`,
      `workspace:${studio}#editor@user:${editor}`, `workspace:${studio}#viewer@user:${viewer}`, `division:${division}#editor@user:${editor}`].sort();
    assert.deepEqual(scoped, written, 'admission grants nothing');
    // The outsiders hold nothing anywhere in the workforce.
    for (const actor of Object.values(outsiders)) {
      const held = (await pool.query(`SELECT
        (SELECT count(*) FROM workforce_run_admissions WHERE actor_user_id=$1 OR payer_user_id=$1)::int
        + (SELECT count(*) FROM workforce_team_memberships WHERE member_principal_id=$1)::int
        + (SELECT count(*) FROM workforce_workspace_assignments WHERE created_by_user_id=$1 OR source_approved_by_user_id=$1 OR target_accepted_by_user_id=$1)::int
        + (SELECT count(*) FROM workforce_ownership_transfers WHERE proposed_by_user_id=$1)::int AS n`, [actor])).rows[0].n;
      assert.equal(held, 0, 'an outsider ends the matrix holding nothing');
    }
    // An agent principal holds only what its owner delegated -- here, nothing of its own.
    const agentTuples = (await pool.query(`SELECT count(*)::int AS n FROM relationship_tuples WHERE subject_type='agent' AND subject_id=$1`, [agentUser])).rows[0].n;
    assert.equal(agentTuples, 0, 'an agent principal is granted nothing by default');
    // Each record id is used; the fixture is the one the matrix ran against.
    assert.equal(Object.values(recordIds).every((v) => typeof v === 'string'), true);
  });
});
