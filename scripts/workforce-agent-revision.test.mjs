/**
 * XENO-WORKFORCE-01 MKT-01 / OWN-03 -- revising an agent's definition is its own right, and a revision never
 * reaches a run that is already going.
 *
 *   MKT-01: "Distinguish ownership, visibility, invoke permission, definition-edit permission, export/license
 *            rights and conversation collaboration."
 *   OWN-03: "Agent versions pin instructions, skill references and requested capabilities by version/hash ...
 *            Updating a definition does not mutate active runs."
 *
 * Runs on the migrated schema (TEST_DATABASE_URL) against services/workforceAgentRevision.js and
 * 20260927150000-workforce-agent-revision.sql, with the real admission and run-authority services. Before this
 * change nothing could write a second version of a definition, so the definition-edit right was held by nobody.
 *
 * Each clause, and the wrong implementation it rules out:
 *   who may revise        anyone who can run, see or hold the agent may also rewrite it
 *   edit is not ownership an editor who may revise a company agent may also give it away -- or the reverse
 *   humans only           an agent rewriting its own, or another agent's, definition
 *   If-Match              a revision of a version the caller did not read, silently rebased onto the current one
 *   provenance inherited  a revision that relabels an imported, non-redistributable definition as authored
 *   one durable command   a retry that writes a second version; a failure that half-writes
 *   runs are untouched    a run admitted on v1 that starts executing v2 the moment v2 exists
 *
 * Mutation-checked 2026-09-27, each fails the named assertion; restored passes:
 *   - a workspace viewer may revise                         -> "a viewer of the workspace may not revise its agents"
 *   - an agent may revise                                   -> "a definition is revised by a human, never by an agent"
 *   - the base version is not checked                       -> "a revision of a version the caller did not read is refused"
 *   - provenance is taken from the request                  -> "a revision keeps the provenance and licence it revised"
 *   - the resource revision does not advance                -> "a revision is visible to every snapshot check"
 *   - a replay writes a second version                      -> "a retry returns the version it wrote and writes nothing"
 *   - the request hash ignores the content                  -> "a retry asking for other content conflicts"
 *   - the receipt accepts a version it did not write        -> "a revision records only the version it wrote"
 *   - a lease re-reads the CURRENT version                  -> "a run admitted on one version keeps running that version"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, generateKeyPairSync } from 'node:crypto';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;

test('an agent definition is revised by its editors only, as one durable command that no running run sees (MKT-01, OWN-03)', { skip: !url, timeout: 120000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  t.after(() => pool.end());
  assert.ok((await pool.query("SELECT to_regclass('workforce_agent_revisions') AS v")).rows[0].v, 'this suite runs on the migrated schema');
  const { createWorkforceResource } = await import('../src/server/services/workforceResources.js');
  const { reviseAgentDefinition, readAgentRevision } = await import('../src/server/services/workforceAgentRevision.js');
  const { proposeOwnershipTransfer } = await import('../src/server/services/workforceOwnershipTransfer.js');
  const { admitRun } = await import('../src/server/services/workforceRunAdmission.js');
  const { authorizeRunStep } = await import('../src/server/services/workforceRunAuthority.js');

  const marker = `rv-${randomUUID().slice(0, 8)}`;
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$1,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const ctx = (actorUserId) => ({ actorUserId, clientId: 'xeno-agent-interface' });
  const rejects = (p, code, reason, message) => assert.rejects(p, (e) => e.code === code && (!reason || e.details?.reason === reason), message);
  const tuple = (object, rel, u, subjectType = 'user') => pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
    VALUES('workspace',$1,$2,$3,$4)`, [object, rel, subjectType, u]);
  const TABLES = ['workforce_agent_versions', 'workforce_agent_revisions', 'workforce_resources', 'workspace_audit'];
  const snapshot = async () => Object.fromEntries(await Promise.all(TABLES.map(async (tb) =>
    [tb, (await pool.query(`SELECT md5(coalesce(string_agg(md5(t::text), ',' ORDER BY md5(t::text)), '')) AS h FROM ${tb} t`)).rows[0].h])));
  const definition = (instructions, caps = ['files.read']) => ({ schemaVersion: 1, instructions, skills: [], requestedCapabilities: caps });
  const revise = (actor, resourceId, baseVersion, def, operationId = randomUUID()) =>
    reviseAgentDefinition(pool, ctx(actor), { operationId, resourceId, baseVersion, definition: def });

  const alice = await user('alice'), erin = await user('erin'), vic = await user('vic'), stranger = await user('stranger');
  await pool.query('INSERT INTO credit_accounts(user_id,balance) VALUES($1,90000000),($2,90000000)', [alice, erin]);
  const studio = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [alice, `${marker}-studio`])).rows[0].id;
  await tuple(studio, 'owner', alice);
  await tuple(studio, 'editor', erin);
  await tuple(studio, 'viewer', vic);

  const create = async (actor, owner, def, extra = {}) => (await createWorkforceResource(pool, ctx(actor), { operationId: randomUUID(), owner,
    kind: 'agent', name: `${marker} analyst`, definition: def, ...extra })).resource.id;
  const company = await create(alice, { type: 'workspace', id: studio }, definition('v1: analyse'));
  const personal = await create(alice, { type: 'user', id: alice }, definition('mine v1'));

  await t.test('MKT-01: definition-edit is its own right -- held by the owner scope\'s editors, not by every holder of another right', async () => {
    const before = await snapshot();
    // A viewer may see the agent in the workspace catalog, and may be assigned to run it. Neither is the right to change it.
    await rejects(revise(vic, company, 1, definition('vic rewrote it')), 'not_found', 'agent_not_found', 'a viewer of the workspace may not revise its agents');
    await rejects(revise(stranger, company, 1, definition('x')), 'not_found', 'agent_not_found', 'a stranger may not revise an agent');
    await rejects(revise(erin, personal, 1, definition('x')), 'not_found', 'agent_not_found', 'a personal agent is revised by its person alone');
    await rejects(revise(stranger, randomUUID(), 1, definition('x')), 'not_found', 'agent_not_found', 'an id that names nothing answers the same');
    assert.deepEqual(await snapshot(), before, 'a refused revision writes nothing');

    // An editor may revise a company agent ...
    const made = await revise(erin, company, 1, definition('v2: analyse and summarise', ['files.read', 'files.write']));
    assert.deepEqual([made.state, made.revision.previousVersion, made.revision.version, made.version.content.instructions],
      ['committed', 1, 2, 'v2: analyse and summarise'], 'an editor of the owning workspace may revise its agents');
    assert.equal(made.version.createdByUserId, erin, 'the revision is attributed to whoever wrote it');
    // ... and may NOT give it away: editing a definition is not owning it.
    await assert.rejects(proposeOwnershipTransfer(pool, { actorUserId: erin, resourceId: company, to: { type: 'user', id: erin } }),
      (e) => e.details?.reason === 'resource_not_found', 'an editor may revise a company agent and may not transfer it');
  });

  await t.test('MKT-01: a definition is revised by a human -- an agent may not rewrite what agents are', async () => {
    const bot = await user('bot');
    await pool.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role,agent_origin) VALUES($1,$2,'other','mkt01-fixture')", [bot, alice]);
    await tuple(studio, 'editor', bot, 'agent');
    await tuple(studio, 'editor', bot);
    const before = await snapshot();
    await rejects(revise(bot, company, 2, definition('the bot rewrote itself')), 'denied', 'revision_requires_a_human',
      'a definition is revised by a human, never by an agent');
    await rejects(revise(bot, personal, 1, definition('the bot rewrote its owner\'s')), 'denied', 'revision_requires_a_human',
      'a definition is revised by a human, never by an agent');
    assert.deepEqual(await snapshot(), before, 'an agent\'s refused revision writes nothing');
  });

  await t.test('OWN-03: a revision names the version it read, keeps provenance and licence, and moves the resource revision', async () => {
    await rejects(revise(alice, company, 1, definition('rebased on a version I never read')), 'conflict', 'agent_version_stale',
      'a revision of a version the caller did not read is refused');
    const stale = await revise(alice, company, 1, definition('x')).catch((e) => e);
    assert.equal(stale.details?.currentVersion, 2, 'a stale base is told the version to re-read');
    await rejects(revise(alice, company, 2, { ...definition('relabel'), provenance: { source: 'authored' } }), 'bad_input', 'provenance_and_license_are_inherited',
      'a revision cannot relabel what it revises');
    await rejects(revise(alice, company, 2, definition('v2: analyse and summarise', ['files.read', 'files.write'])), 'conflict', 'definition_unchanged',
      'a revision that changes nothing is not a new version');

    // An IMPORTED definition, under a licence that does not permit redistribution, stays imported and stays under it.
    const imported = await create(alice, { type: 'user', id: alice }, { ...definition('bought'),
      provenance: { source: 'imported', sourceVersion: '1.0.0' }, license: { identifier: 'Proprietary-seat' } });
    const revised = await revise(alice, imported, 1, definition('bought, then tuned'));
    assert.deepEqual([revised.version.provenance, revised.version.license], [{ source: 'imported', sourceVersion: '1.0.0' }, { identifier: 'Proprietary-seat' }],
      'a revision keeps the provenance and licence it revised');

    const rev = async (id) => (await pool.query('SELECT revision FROM workforce_resources WHERE id=$1', [id])).rows[0].revision;
    const r0 = await rev(personal);
    await revise(alice, personal, 1, definition('mine v2'));
    assert.equal(BigInt(await rev(personal)), BigInt(r0) + 1n, 'a revision is visible to every snapshot check');
  });

  await t.test('OWN-03: one durable command -- a retry returns what it wrote, and a receipt names only its own version', async () => {
    const operationId = randomUUID();
    const first = await revise(alice, personal, 2, definition('mine v3'), operationId);
    const before = await snapshot();
    const again = await revise(alice, personal, 2, definition('mine v3'), operationId);
    assert.deepEqual([again.replayed, again.revision.version, again.version.contentHash], [true, first.revision.version, first.version.contentHash],
      'a retry returns the version it wrote and writes nothing');
    assert.deepEqual(await snapshot(), before, 'a retry returns the version it wrote and writes nothing');
    await rejects(revise(alice, personal, 2, definition('mine v3, but different'), operationId), 'conflict', 'operation_payload_conflict',
      'a retry asking for other content conflicts');
    const read = await readAgentRevision(pool, ctx(alice), { operationId });
    assert.equal(read.revision.version, first.revision.version, 'a revision is reconciled by its operation id');
    assert.equal((await readAgentRevision(pool, ctx(alice), { operationId: randomUUID() })).state, 'not-observed');
    // Somebody else's receipt is not theirs to reconcile: the operation id is namespaced by actor and client.
    assert.equal((await readAgentRevision(pool, ctx(erin), { operationId })).state, 'not-observed', 'a receipt is its actor\'s alone');

    // The receipt is bound to the version it wrote, in its own transaction. A version written any other way -- by a
    // different actor, or at a different time -- cannot be claimed afterwards.
    const version = first.revision.version + 1;
    const content = { instructions: 'written directly', skills: [], requestedCapabilities: [], secretReferences: [] };
    const written = (await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,created_by_user_id)
      VALUES($1,$2,$3,$4,$5) RETURNING created_at`, [personal, version, content, createHash('sha256').update(marker).digest('hex'), erin])).rows[0];
    await assert.rejects(pool.query(`INSERT INTO workforce_agent_revisions(actor_user_id,client_id,operation_id,resource_id,previous_version,version,request_hash,committed_at)
      VALUES($1,'xeno-agent-interface',$2,$3,$4,$5,$6,$7)`, [alice, randomUUID(), personal, version - 1, version, 'a'.repeat(64), written.created_at]),
    (e) => e.code === '23514', 'a revision records only the version it wrote');
    await assert.rejects(pool.query('UPDATE workforce_agent_revisions SET request_hash=$2 WHERE operation_id=$1', [operationId, 'b'.repeat(64)]),
      (e) => e.code === '23514', 'a revision receipt is immutable');

    // Five concurrent revisions of the same base: exactly one writes, the rest are told the base moved.
    const base = (await pool.query('SELECT max(version)::int AS v FROM workforce_agent_versions WHERE resource_id=$1', [company])).rows[0].v;
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => revise(alice, company, base, definition(`racer ${i}`))));
    assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1, 'concurrent revisions of one base write one version');
    assert.ok(outcomes.filter((o) => o.status === 'rejected').every((o) => o.reason.details?.reason === 'agent_version_stale'),
      'the others are told the base moved, never silently rebased');
  });

  await t.test('OWN-03: updating a definition does not mutate a run already admitted', async () => {
    const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const signingKey = { kid: 'mkt01-revision', privatePem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    const pin = async (id) => { const v = (await pool.query('SELECT version, content_hash FROM workforce_agent_versions WHERE resource_id=$1 ORDER BY version DESC LIMIT 1', [id])).rows[0];
      return { resourceId: id, version: v.version, contentHash: v.content_hash }; };
    const agent = await create(erin, { type: 'user', id: erin }, definition('runner v1'));
    const pinned = await pin(agent);
    const admitted = (await admitRun(pool, ctx(erin), { operationId: randomUUID(), agent: pinned, target: { kind: 'personal', ownerUserId: erin },
      capabilities: ['files.read'], budget: { ceilingMicro: '1000000' } })).admission;
    await revise(erin, agent, pinned.version, definition('runner v2', ['files.read', 'files.write']));
    const lease = await authorizeRunStep(pool, ctx(erin), { admissionId: admitted.admissionId, operation: 'privileged_call', capability: 'files.read' }, { signingKey });
    assert.equal(lease.lease.sequence, '1', 'a run admitted on one version keeps running that version');
    const row = (await pool.query('SELECT agent_version, agent_content_hash FROM workforce_run_admissions WHERE id=$1', [admitted.admissionId])).rows[0];
    assert.deepEqual([row.agent_version, row.agent_content_hash], [pinned.version, pinned.contentHash], 'a run admitted on one version keeps running that version');
    // v2 asked for files.write; the run admitted on v1 was never granted it and is not granted it now.
    await rejects(authorizeRunStep(pool, ctx(erin), { admissionId: admitted.admissionId, operation: 'privileged_call', capability: 'files.write' }, { signingKey }),
      'denied', 'capability_not_live', 'a revision widens no running run');
    // A NEW run is pinned to the new definition, and the old pin is refused -- the revision is a new version, not an edit.
    await rejects(admitRun(pool, ctx(erin), { operationId: randomUUID(), agent: pinned, target: { kind: 'personal', ownerUserId: erin },
      capabilities: ['files.read'], budget: { ceilingMicro: '1000000' } }), 'conflict', 'agent_version_stale', 'a new run is admitted on the current version');
  });
});
