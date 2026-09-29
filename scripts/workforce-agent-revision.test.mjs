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
  const { reviseAgentDefinition, readAgentRevision, readAgentDefinition } = await import('../src/server/services/workforceAgentRevision.js');
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
  // Admission's budget term reads eligible credit_grants lots (utils/usageCreditFunding.js
  // allocateFunding), not the cached credit_accounts.balance alone -- fund a real paid lot +
  // overflow-on per payer, idempotently (deterministic grant id, replace not accumulate).
  for (const u of [alice, erin]) {
    await pool.query(`INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)
      ON CONFLICT (user_id) DO UPDATE SET enabled=true`, [u]);
    await pool.query(`INSERT INTO credit_grants(id,user_id,amount_micro,remaining_micro,kind,source_ref)
      VALUES(md5('test-fund:'||$1::text)::uuid,$1::uuid,90000000,90000000,'paid','test-fund')
      ON CONFLICT (id) DO UPDATE SET amount_micro=EXCLUDED.amount_micro, remaining_micro=EXCLUDED.remaining_micro`, [u]);
  }
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

  await t.test('MKT-01: a definition is READ by its editors only, exactly the pin asked for, and writes nothing', async () => {
    const readCtx = (actorUserId) => ({ actorUserId, clientId: 'xeno-agent-interface' });
    const read = (actor, resourceId, version, contentHash, expectedActorAccountId) =>
      readAgentDefinition(pool, readCtx(actor), { resourceId, version, contentHash, expectedActorAccountId: expectedActorAccountId ?? actor });
    const hashOf = async (id, version) => (await pool.query('SELECT content_hash FROM workforce_agent_versions WHERE resource_id=$1 AND version=$2', [id, version])).rows[0].content_hash;

    // An agent whose OWNER holds the right (alice, who owns and can revise the studio's agents) still may not
    // itself read a definition -- the same "human only" bar mayRevise holds, with no carve-out for a read.
    const bot2 = await user('bot2');
    await pool.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role,agent_origin) VALUES($1,$2,'other','mkt01-read-fixture')", [bot2, alice]);
    await tuple(studio, 'editor', bot2, 'agent');
    await tuple(studio, 'editor', bot2);

    const dev = await create(alice, { type: 'workspace', id: studio }, definition('read v1: analyse'));
    await revise(erin, dev, 1, definition('read v2: analyse and summarise', ['files.read', 'files.write']));
    const hash1 = await hashOf(dev, 1), hash2 = await hashOf(dev, 2);
    const own = await create(alice, { type: 'user', id: alice }, definition('personal pinned instruction'));
    const ownHash = await hashOf(own, 1);
    const before = await snapshot();
    assert.equal((await read(alice, own, 1, ownHash)).version.content.instructions, 'personal pinned instruction', 'personal definition is readable by its current human owner');
    await rejects(read(erin, own, 1, ownHash), 'not_found', 'agent_not_found', 'workspace editing rights do not expose personal definitions');
    await rejects(readAgentDefinition(pool, readCtx(alice), { resourceId: own, version: 1, contentHash: ownHash }), 'bad_input', 'invalid_expected_actor_account', 'an account precondition is mandatory');

    // The owner (alice) and the editor who wrote v2 (erin) may each read either version, exactly as pinned.
    const asOwner = await read(alice, dev, 1, hash1);
    assert.deepEqual([asOwner.version.version, asOwner.version.content.instructions], [1, 'read v1: analyse'], 'the owner reads a historical version exactly');
    const asEditor = await read(erin, dev, 2, hash2);
    assert.deepEqual([asEditor.version.version, asEditor.version.content.instructions], [2, 'read v2: analyse and summarise'], 'an editor reads the current version');
    assert.deepEqual(await snapshot(), before, 'a read writes nothing, for the owner or the editor');

    // No OTHER right is an oracle for this one: a viewer, a stranger and an agent (even one whose owner could
    // read) all answer not_found, the same answer an id that names nothing gives.
    await rejects(read(vic, dev, 2, hash2), 'not_found', 'agent_not_found', 'a viewer of the workspace may not read its agents\' definitions');
    await rejects(read(stranger, dev, 2, hash2), 'not_found', 'agent_not_found', 'a stranger may not read a definition');
    await rejects(read(bot2, dev, 2, hash2), 'not_found', 'agent_not_found', 'an agent may not read a definition, even one whose owner could');
    await rejects(read(stranger, randomUUID(), 1, 'a'.repeat(64)), 'not_found', 'agent_not_found', 'an id that names nothing answers the same');
    assert.deepEqual(await snapshot(), before, 'every refused read writes nothing');

    // Historical: v1 stays exactly readable after v2 exists.
    const historical = await read(alice, dev, 1, hash1);
    assert.equal(historical.version.contentHash, hash1, 'a historical version is exact after a later one is written');

    // The exact pin: a real version under a hash it does not hold, or a version never written, is refused --
    // never silently handed whatever that version (or the current one) actually holds.
    await rejects(read(alice, dev, 1, hash2), 'conflict', 'content_hash_mismatch', 'a version under the wrong hash is refused');
    await rejects(read(alice, dev, 99, hash2), 'not_found', 'agent_version_not_found', 'a version that was never written is refused');

    // The account pin: a read for a different account than the one authenticated is refused before the
    // resource is even looked up -- it is not an oracle for whether the resource exists either.
    await rejects(read(alice, dev, 1, hash1, erin), 'denied', 'expected_actor_account_mismatch', 'a mismatched expected account is refused');
    await rejects(read(stranger, randomUUID(), 1, 'a'.repeat(64), alice), 'denied', 'expected_actor_account_mismatch', 'the account pin is checked before the resource is');
    assert.deepEqual(await snapshot(), before, 'every refused read, of any kind, writes nothing');

    // Suspended editor: erin's own account suspended -- mayRevise requires a usable principal, so the read
    // answers not_found exactly as an unauthorized one does, never a distinct "suspended" leak.
    await pool.query(`UPDATE users SET is_active=FALSE, status='suspended' WHERE id=$1`, [erin]);
    await rejects(read(erin, dev, 2, hash2), 'not_found', 'agent_not_found', 'a suspended editor cannot read a definition');
    await pool.query(`UPDATE users SET is_active=TRUE, status='active' WHERE id=$1`, [erin]);
    assert.ok((await read(erin, dev, 2, hash2)).access.allowed, 'reinstating the account restores the read');

    // Revoked editor: the editor relation itself removed -- authority is derived fresh under the read's own
    // lock, never cached from an earlier grant.
    await pool.query(`DELETE FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND relation='editor' AND subject_type='user' AND subject_id=$2`, [studio, erin]);
    await rejects(read(erin, dev, 2, hash2), 'not_found', 'agent_not_found', 'a revoked editor cannot read a definition');
    await tuple(studio, 'editor', erin);
    assert.deepEqual(await snapshot(), before, 'suspending, revoking and restoring an editor writes nothing to the definition tables');
  });

  await t.test('the mounted HTTP reader loads the exact PostgreSQL definition under real account and proof checks', async () => {
    const express = (await import('express')).default;
    const { createRequire } = await import('node:module');
    const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
    const { jwkThumbprint, accessTokenHash } = await import('../src/server/utils/dpop.js');
    const { issuer } = await import('../src/server/config/hosts.js');
    const { getSigningKey } = await import('../src/server/utils/oidcProvider.js');
    const { apiCacheMiddleware } = await import('../src/server/middleware/cdnOptimization.js');
    process.env.JWT_SECRET = randomUUID() + randomUUID();
    const { default: router } = await import('../src/server/routes/workforceRoutes.js');
    const signer = await getSigningKey(pool), key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = key.publicKey.export({ format: 'jwk' }), jkt = jwkThumbprint(jwk), now = Math.floor(Date.now() / 1000), sessions = new Map();
    for (const actor of [alice, stranger]) {
      const sid = randomUUID(); sessions.set(actor, sid);
      await pool.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch) VALUES($1,0) ON CONFLICT DO NOTHING', [actor]);
      await pool.query(`INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at)
        VALUES($1,$2,0,to_timestamp($3),$4,now()+interval '1 hour')`, [sid, actor, now, jkt]);
    }
    const app = express(); app.use('/api/', apiCacheMiddleware);
    app.use((req, _res, next) => { req.db = pool; next(); }); app.use('/api/workforce', router);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    try {
      const id = await create(alice, { type: 'user', id: alice }, definition('the exact authored HTTP instruction'));
      const version = (await pool.query('SELECT content_hash FROM workforce_agent_versions WHERE resource_id=$1 AND version=1', [id])).rows[0];
      const ask = { resourceId: id, version: 1, contentHash: version.content_hash, expectedActorAccountId: alice };
      const call = async (body, actor = alice, includeProof = true, scope = 'workforce:read') => {
        const token = jwt.sign({ sub: actor, sid: sessions.get(actor), auth_epoch: 0, auth_time: now,
          client_id: 'xeno-agent-interface', scope, typ: 'at+jwt', cnf: { jkt } }, signer.privatePem,
          { algorithm: signer.alg, keyid: signer.kid, audience: 'xeno-api', expiresIn: '5m', header: { typ: 'at+jwt' } });
        const path = '/api/workforce/resources/definition/read', headers = { 'content-type': 'application/json', authorization: `DPoP ${token}` };
        if (includeProof) headers.dpop = jwt.sign({ jti: randomUUID(), htm: 'POST', htu: issuer() + path, ath: accessTokenHash(token), iat: now },
          key.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk } });
        const result = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
        return { status: result.status, body: await result.json(), cache: result.headers.get('cache-control') };
      };
      const before = await snapshot(), read = await call(ask);
      assert.equal(read.status, 200, 'real mounted reader reaches the database service');
      assert.equal(read.body.version.content.instructions, 'the exact authored HTTP instruction', 'HTTP returns the actual stored instructions');
      assert.equal(read.body.version.contentHash, ask.contentHash);
      assert.match(read.cache, /no-store/, 'real definition response forbids caching');
      assert.equal((await call({ ...ask, expectedActorAccountId: stranger }, stranger)).status, 404, 'real HTTP stranger cannot read the personal definition');
      assert.equal((await call({ ...ask, expectedActorAccountId: stranger })).status, 403, 'real HTTP account precondition is enforced by the service');
      assert.equal((await call({ ...ask, contentHash: 'f'.repeat(64) })).status, 409, 'real HTTP stale hash is refused by the service');
      assert.equal((await call(ask, alice, false)).status, 401, 'real HTTP missing proof is refused');
      assert.equal((await call(ask, alice, true, 'workforce:manage')).status, 403, 'real HTTP scope cannot substitute manage for read');
      assert.deepEqual(await snapshot(), before, 'composed HTTP reads never mutate definition state');
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
});
