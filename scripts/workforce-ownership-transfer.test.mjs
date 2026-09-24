/**
 * XENO-WORKFORCE-01 OWN-05: "Company-owned resources survive creator departure. Ownership transfer
 * requires source authorization, destination acceptance, dependency/license review and an auditable
 * operation; it never silently migrates secrets or active runs."
 *
 * Driven through the real service (services/workforceOwnershipTransfer.js) on real PostgreSQL, with
 * the real migration chain, real ReBAC tuples and real principals. Every clause gets its own case:
 *
 *   survive creator departure   a workspace-owned agent's creator is erased; the resource, its owner
 *                               and its definition are untouched, and nothing had to be transferred.
 *   source authorization        only a manager of the SOURCE may authorize; a workspace editor, the
 *                               destination and an agent may not; the proposer's act is not it.
 *   destination acceptance      only a manager of the DESTINATION may accept; the source may not
 *                               accept on the recipient's behalf.
 *   dependency/licence review   the review must enumerate EXACTLY the secret references and licences
 *                               the current definition declares -- omitting one or inventing one is
 *                               refused -- and a definition published after review blocks acceptance.
 *   auditable operation         acceptance writes a resource.transfer decision record naming who,
 *                               under what authority, why and what was reviewed; the record is
 *                               immutable and the transfer cannot be accepted without it.
 *   never silently migrates     live assignments block acceptance; after the move the definition --
 *                               with its secret REFERENCES, not values -- is byte-identical, and no
 *                               secret, assignment or grant row was created by it.
 *
 * Run: WORKFORCE_TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/workforceproof \
 *      node --test scripts/workforce-ownership-transfer.test.mjs
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - service lets a workspace editor authorize            -> "a workspace editor cannot give a resource away"
 *   - service lets the source accept                        -> "the source cannot accept on the recipient's behalf"
 *   - service lets an agent act                             -> "an agent cannot move ownership"
 *   - review compares only a subset of secret references    -> "a review that omits a declared secret is refused"
 *   - review allows invented secret references              -> "a review naming a secret the agent does not declare is refused"
 *   - acceptance ignores a definition published after review -> "a definition published after review blocks acceptance"
 *   - acceptance ignores live assignments                   -> "live assignments block acceptance"
 *   - acceptance does not require the decision record       -> "the transfer cannot be accepted without its decision record"
 *   - acceptance does not move the owner                    -> "acceptance moves the owner and advances the revision"
 *   - steps may be skipped                                  -> "the steps run in order"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import express from 'express';
import pg from 'pg';
import { issuer } from '../src/server/config/hosts.js';
import { jwkThumbprint, accessTokenHash } from '../src/server/utils/dpop.js';
import { requireProofDatabase, workforceProofUnavailable } from './lib/workforce-proof-database.mjs';

process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
const MIGRATIONS = new URL('../src/server/database/migrations/', import.meta.url);

test('workforce ownership transfer: two-sided, reviewed, audited, never silent (OWN-05)', { skip: workforceProofUnavailable() }, async (t) => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);
  const schema = `workforce_transfer_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 6 });
  const svc = await import('../src/server/services/workforceOwnershipTransfer.js');
  let created = false;

  const [alice, bob, carol, editor, creator, agent] = Array.from({ length: 6 }, () => randomUUID());
  const [studio, acme] = [randomUUID(), randomUUID()];
  const grant = (objectId, relation, subjectId) => pool.query(
    `INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,$2,'user',$3)`,
    [objectId, relation, subjectId]);
  const rejects = (promise, code, reason) => assert.rejects(promise,
    (e) => e.code === code && (!reason || e.details?.reason === reason),
    `expected ${code}${reason ? `/${reason}` : ''}`);
  const resourceOf = async (id) => (await pool.query('SELECT * FROM workforce_resources WHERE id=$1', [id])).rows[0];
  const makeAgent = async (owner, { secrets = ['PROVIDER_KEY', 'GITHUB_TOKEN'], license = 'Apache-2.0' } = {}) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO workforce_resources(id,kind,owner_user_id,owner_workspace_id,created_by_user_id,name)
      VALUES($1::uuid,'agent',$2::uuid,$3::uuid,$4::uuid,'Reviewer')`,
    [id, owner.type === 'user' ? owner.id : null, owner.type === 'workspace' ? owner.id : null, creator]);
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,license,created_by_user_id)
      VALUES($1,1,$2,$3,$4,$5)`, [id, { instructions: 'review diffs', secretReferences: secrets.map((name) => ({ name, ref: randomUUID() })) },
      'a'.repeat(64), license ? { identifier: license } : {}, creator]);
    return id;
  };
  const review = (subject, overrides = {}) => ({ schemaVersion: 1, secretReferences: subject.secretReferences,
    licenses: subject.licenses, dependencies: [], verdict: 'clear', ...overrides });
  /** Drive a transfer to the reviewed state, returning it and the subject its reviewer saw. */
  const toReviewed = async (resourceId, from, to) => {
    let tr = await svc.proposeOwnershipTransfer(pool, { actorUserId: from, resourceId, to });
    tr = await svc.authorizeOwnershipTransfer(pool, { actorUserId: from, transferId: tr.id });
    const subject = await svc.transferReviewSubject(pool, { actorUserId: from, transferId: tr.id });
    tr = await svc.reviewOwnershipTransfer(pool, { actorUserId: from, transferId: tr.id, agentVersion: subject.agentVersion, review: review(subject) });
    return { tr, subject };
  };

  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
    await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY, username TEXT, display_name TEXT, email TEXT, avatar_url TEXT,
      email_verified BOOLEAN DEFAULT true, role TEXT NOT NULL DEFAULT 'user', is_active BOOLEAN NOT NULL DEFAULT true,
      status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
      CREATE TABLE api_keys(id UUID PRIMARY KEY, user_id UUID REFERENCES users(id), key_prefix TEXT, key_hash TEXT,
        is_active BOOLEAN DEFAULT true, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
        last_used_at TIMESTAMPTZ, usage_count BIGINT DEFAULT 0);
      CREATE TABLE oidc_signing_keys(kid TEXT PRIMARY KEY, alg TEXT, private_pem TEXT);
      CREATE TABLE oauth_clients(client_id TEXT PRIMARY KEY, allowed_scopes TEXT[]);
      CREATE TABLE oauth_session_state(sid UUID PRIMARY KEY, user_id UUID, auth_epoch INTEGER, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ);
      CREATE TABLE oauth_user_auth_epochs(user_id UUID PRIMARY KEY, epoch INTEGER);
      CREATE TABLE oauth_dpop_replays(jkt TEXT, jti TEXT, htm TEXT, htu TEXT, expires_at TIMESTAMPTZ, UNIQUE(jkt, jti))`);
    for (const id of [alice, bob, carol, editor, creator, agent]) await pool.query('INSERT INTO users(id,username) VALUES($1::uuid,$1::text)', [id]);
    const chain = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')
      && (/workforce/.test(f) || f === '20260711120000-workspaces.sql' || f === '20260811130000-agent-identities.sql')).sort();
    // chat_projects precedes the workforce chain in production, and from 20260924180000 (ASN-09) the
    // chain references it -- so it is created after workspaces and before the first workforce file.
    for (const f of chain) {
      if (f.includes('workforce') && !(await pool.query("SELECT to_regclass('chat_projects') AS t")).rows[0].t) {
        await pool.query(`CREATE TABLE chat_projects(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID,
          owner_user_id UUID REFERENCES users(id), workspace_id UUID REFERENCES workspaces(id), name TEXT NOT NULL DEFAULT 'p',
          is_archived BOOLEAN NOT NULL DEFAULT false, CHECK ((owner_user_id IS NULL) <> (workspace_id IS NULL)))`);
      }
      await pool.query((await readFile(new URL(f, MIGRATIONS), 'utf8')).split('-- DOWN')[0]);
    }
    await pool.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role) VALUES($1,$2,'personal')", [agent, alice]);
    await pool.query(`INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,'Studio','studio'),($3,$4,'Acme','acme')`,
      [studio, alice, acme, bob]);
    await grant(studio, 'admin', alice); await grant(studio, 'editor', editor); await grant(acme, 'admin', bob);

    await t.test('a company-owned resource survives its creator leaving -- no transfer needed', async () => {
      const id = await makeAgent({ type: 'workspace', id: studio });
      const before = await resourceOf(id);
      await pool.query('DELETE FROM users WHERE id=$1', [creator]);
      const after = await resourceOf(id);
      assert.equal(after.owner_workspace_id, studio, 'the owner is the workspace, not the creator');
      assert.equal(after.created_by_user_id, null, 'only attribution is cleared');
      assert.equal(after.revision, before.revision, 'and nothing about the resource moved');
      assert.equal(Number((await pool.query('SELECT count(*) FROM workforce_agent_versions WHERE resource_id=$1', [id])).rows[0].count), 1,
        'the definition survives too');
      await pool.query('INSERT INTO users(id,username) VALUES($1::uuid,$1::text)', [creator]);
    });

    await t.test('source authorization comes only from a manager of the source', async () => {
      const id = await makeAgent({ type: 'workspace', id: studio });
      await rejects(svc.proposeOwnershipTransfer(pool, { actorUserId: editor, resourceId: id, to: { type: 'workspace', id: acme } }),
        'not_found', 'resource_not_found');
      const tr = await svc.proposeOwnershipTransfer(pool, { actorUserId: alice, resourceId: id, to: { type: 'workspace', id: acme } });
      assert.equal(tr.state, 'proposed');
      assert.equal(tr.authorizedBy, null, "the proposer's act is not the authorization");
      await rejects(svc.authorizeOwnershipTransfer(pool, { actorUserId: bob, transferId: tr.id }), 'denied', 'source_authorization_required');
      await grant(studio, 'editor', carol);
      await rejects(svc.authorizeOwnershipTransfer(pool, { actorUserId: carol, transferId: tr.id }), 'not_found',
        undefined, 'a workspace editor cannot give a resource away');
      await rejects(svc.authorizeOwnershipTransfer(pool, { actorUserId: agent, transferId: tr.id }), 'denied', 'transfer_requires_a_human');
      const authorized = await svc.authorizeOwnershipTransfer(pool, { actorUserId: alice, transferId: tr.id });
      assert.equal(authorized.authorizedBy, alice);
      await svc.declineOwnershipTransfer(pool, { actorUserId: alice, transferId: tr.id, reason: 'test' });
    });

    await t.test('an agent cannot move ownership', async () => {
      const id = await makeAgent({ type: 'user', id: alice });
      await rejects(svc.proposeOwnershipTransfer(pool, { actorUserId: agent, resourceId: id, to: { type: 'workspace', id: studio } }),
        'denied', 'transfer_requires_a_human');
    });

    await t.test('the review must enumerate exactly what the definition declares', async () => {
      const id = await makeAgent({ type: 'user', id: alice });
      let tr = await svc.proposeOwnershipTransfer(pool, { actorUserId: alice, resourceId: id, to: { type: 'workspace', id: studio } });
      tr = await svc.authorizeOwnershipTransfer(pool, { actorUserId: alice, transferId: tr.id });
      const subject = await svc.transferReviewSubject(pool, { actorUserId: alice, transferId: tr.id });
      assert.deepEqual(subject.secretReferences, ['GITHUB_TOKEN', 'PROVIDER_KEY'], 'the reviewer is shown the real secret surface');
      assert.deepEqual(subject.licenses, ['Apache-2.0']);
      const attempt = (r) => svc.reviewOwnershipTransfer(pool, { actorUserId: alice, transferId: tr.id, agentVersion: subject.agentVersion, review: r });
      await rejects(attempt(review(subject, { secretReferences: ['PROVIDER_KEY'] })), 'bad_input', 'review_secret_references_incomplete',
        'a review that omits a declared secret is refused');
      await rejects(attempt(review(subject, { secretReferences: ['GITHUB_TOKEN', 'PROVIDER_KEY', 'AWS_KEY'] })), 'bad_input',
        'review_secret_references_incomplete', 'a review naming a secret the agent does not declare is refused');
      await rejects(attempt(review(subject, { licenses: [] })), 'bad_input', 'review_licenses_incomplete');
      await rejects(attempt(review(subject, { verdict: 'conditions' })), 'bad_input', 'invalid_review',
        'a conditional verdict must say what the conditions are');
      await rejects(svc.reviewOwnershipTransfer(pool, { actorUserId: alice, transferId: tr.id, agentVersion: 99, review: review(subject) }),
        'conflict', 'definition_changed_since_read');
      const reviewed = await attempt(review(subject));
      assert.equal(reviewed.state, 'reviewed');
      assert.deepEqual(reviewed.review.secretReferences, ['GITHUB_TOKEN', 'PROVIDER_KEY']);
      await svc.declineOwnershipTransfer(pool, { actorUserId: alice, transferId: tr.id, reason: 'test' });
    });

    await t.test('destination acceptance comes only from a manager of the destination', async () => {
      const id = await makeAgent({ type: 'workspace', id: studio });
      const { tr } = await toReviewed(id, alice, { type: 'workspace', id: acme });
      await rejects(svc.acceptOwnershipTransfer(pool, { actorUserId: alice, transferId: tr.id, rationale: 'mine now' }),
        'denied', 'destination_acceptance_required', "the source cannot accept on the recipient's behalf");
      await rejects(svc.acceptOwnershipTransfer(pool, { actorUserId: bob, transferId: tr.id, rationale: '  ' }), 'bad_input', 'rationale_required');
      const accepted = await svc.acceptOwnershipTransfer(pool, { actorUserId: bob, transferId: tr.id, rationale: 'Acme now runs the review pipeline' });
      assert.equal(accepted.state, 'accepted');
      assert.equal(accepted.acceptedBy, bob);
    });

    await t.test('acceptance moves the owner and advances the revision, and writes the decision record', async () => {
      const id = await makeAgent({ type: 'workspace', id: studio });
      const before = await resourceOf(id);
      const versionBefore = (await pool.query('SELECT content, content_hash, license FROM workforce_agent_versions WHERE resource_id=$1', [id])).rows[0];
      const tuplesBefore = Number((await pool.query('SELECT count(*) FROM relationship_tuples')).rows[0].count);
      const { tr } = await toReviewed(id, alice, { type: 'workspace', id: acme });
      const accepted = await svc.acceptOwnershipTransfer(pool, { actorUserId: bob, transferId: tr.id, rationale: 'consolidating agents under Acme' });

      const after = await resourceOf(id);
      assert.equal(after.owner_workspace_id, acme, 'acceptance moves the owner and advances the revision');
      assert.equal(Number(after.revision), Number(before.revision) + 1, 'acceptance moves the owner and advances the revision');

      const op = (await pool.query('SELECT * FROM workforce_decision_records WHERE operation_id=$1', [accepted.operationId])).rows[0];
      assert.equal(op.decided, 'resource.transfer');
      assert.equal(op.subject_id, id);
      assert.equal(op.deciding_principal_id, bob);
      assert.equal(op.responsible_account_id, bob, 'LIFE-07: the account that answers for it');
      assert.equal(op.authority, `workspace:${acme}#admin`);
      assert.equal(op.rationale, 'consolidating agents under Acme');
      assert.deepEqual(op.evidence[0].review.secretReferences, ['GITHUB_TOKEN', 'PROVIDER_KEY'], 'the record carries what was reviewed');
      assert.equal(op.evidence[0].authorizedBy, alice);
      await assert.rejects(pool.query(`UPDATE workforce_operations SET rationale='rewritten' WHERE operation_id=$1`, [accepted.operationId]),
        /immutable/, 'the audit cannot be edited afterwards');

      // Never silently migrates secrets: the definition moved as REFERENCES, byte for byte, and the
      // move created no grant row anywhere.
      const versionAfter = (await pool.query('SELECT content, content_hash, license FROM workforce_agent_versions WHERE resource_id=$1', [id])).rows[0];
      assert.deepEqual(versionAfter, versionBefore, 'the definition, with its secret references, is unchanged by the move');
      assert.equal(Number((await pool.query('SELECT count(*) FROM relationship_tuples')).rows[0].count), tuplesBefore, 'no grant was created by the move');
    });

    await t.test('live assignments block acceptance -- active work is never migrated silently', async () => {
      const id = await makeAgent({ type: 'workspace', id: studio });
      const assignment = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,
        source_owner_workspace_id,resource_revision,created_by_user_id,policy) VALUES($1,'agent',$2,$2,1,$3,$4) RETURNING id`,
      [id, studio, alice, { schemaVersion: 1, mode: 'explicit', capabilities: ['files.read'] }])).rows[0].id;
      const { tr } = await toReviewed(id, alice, { type: 'workspace', id: acme });
      await rejects(svc.acceptOwnershipTransfer(pool, { actorUserId: bob, transferId: tr.id, rationale: 'take it' }),
        'conflict', 'live_assignments_must_be_settled', 'live assignments block acceptance');
      assert.equal((await resourceOf(id)).owner_workspace_id, studio, 'and the owner did not move');
      await pool.query(`UPDATE workforce_workspace_assignments SET state='revoked',revision=revision+1,revoked_at=clock_timestamp(),
        updated_at=clock_timestamp() WHERE id=$1`, [assignment]);
      const accepted = await svc.acceptOwnershipTransfer(pool, { actorUserId: bob, transferId: tr.id, rationale: 'after revoking its work' });
      assert.equal(accepted.state, 'accepted', 'once revoked -- its own recorded act -- the transfer completes');
    });

    await t.test('a definition published after review blocks acceptance', async () => {
      const id = await makeAgent({ type: 'workspace', id: studio });
      const { tr } = await toReviewed(id, alice, { type: 'workspace', id: acme });
      await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,license) VALUES($1,2,$2,$3,$4)`,
        [id, { instructions: 'now with deploy', secretReferences: [{ name: 'DEPLOY_KEY', ref: randomUUID() }] }, 'b'.repeat(64), { identifier: 'Apache-2.0' }]);
      await rejects(svc.acceptOwnershipTransfer(pool, { actorUserId: bob, transferId: tr.id, rationale: 'take it' }),
        'conflict', 'definition_changed_since_review', 'a definition published after review blocks acceptance');
    });

    await t.test('the steps run in order, and a resource that moved underneath cannot complete', async () => {
      const id = await makeAgent({ type: 'user', id: alice });
      const tr = await svc.proposeOwnershipTransfer(pool, { actorUserId: alice, resourceId: id, to: { type: 'workspace', id: acme } });
      await rejects(svc.acceptOwnershipTransfer(pool, { actorUserId: bob, transferId: tr.id, rationale: 'skip ahead' }),
        'conflict', 'transfer_not_reviewed', 'the steps run in order');
      await assert.rejects(pool.query(`UPDATE workforce_ownership_transfers SET state='reviewed', revision=revision+1,
        reviewed_by_user_id=$2, reviewed_at=clock_timestamp(), review=$3, updated_at=clock_timestamp() WHERE id=$1`,
      [tr.id, alice, { schemaVersion: 1, secretReferences: [], licenses: [], dependencies: [], verdict: 'clear' }]),
      /steps run|source_authorized|state_shape/, 'the steps run in order');
      await rejects(svc.proposeOwnershipTransfer(pool, { actorUserId: alice, resourceId: id, to: { type: 'workspace', id: studio } }),
        'conflict', 'transfer_already_in_progress');
      await svc.declineOwnershipTransfer(pool, { actorUserId: bob, transferId: tr.id, reason: 'not ours to take' });
      const declined = await svc.readOwnershipTransfer(pool, { actorUserId: alice, transferId: tr.id });
      assert.equal(declined.declinedBy, bob, 'the destination may decline, and it is recorded');
      await rejects(svc.readOwnershipTransfer(pool, { actorUserId: carol, transferId: tr.id }), 'not_found', 'transfer_not_found');
    });

    await t.test('the transfer cannot be accepted without its decision record', async () => {
      const id = await makeAgent({ type: 'user', id: alice });
      const { tr } = await toReviewed(id, alice, { type: 'workspace', id: studio });
      await assert.rejects(pool.query(`UPDATE workforce_ownership_transfers SET state='accepted', revision=revision+1,
        accepted_by_user_id=$2, accepted_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [tr.id, alice]),
      /state_shape|decision record/, 'the transfer cannot be accepted without its decision record');
      const stray = randomUUID();
      await pool.query(`INSERT INTO workforce_operations(actor_user_id,client_id,operation_id,request_hash,kind,subject_type,subject_id,
        deciding_principal_id,responsible_account_id,authority) VALUES($1,'x',$2,$3,'member.admit','resource',$4,$1,$1,'test')`,
      [alice, stray, 'c'.repeat(64), id]);
      await assert.rejects(pool.query(`UPDATE workforce_ownership_transfers SET state='accepted', revision=revision+1,
        accepted_by_user_id=$2, accepted_at=clock_timestamp(), operation_actor_user_id=$2, operation_client_id='x', operation_id=$3,
        updated_at=clock_timestamp() WHERE id=$1`, [tr.id, alice, stray]),
      /resource\.transfer decision record/, 'a decision record of another kind does not authorize a move');
    });

    await t.test('the HTTP surface requires a sender-bound, recently authenticated session, and completes a transfer', async () => {
      const signer = generateKeyPairSync('ec', { namedCurve: 'P-256' }), proofKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = proofKey.publicKey.export({ format: 'jwk' }), jkt = jwkThumbprint(jwk);
      const sessions = new Map();
      for (const id of [alice, bob]) {
        const sid = randomUUID(); sessions.set(id, sid);
        await pool.query('INSERT INTO oauth_user_auth_epochs VALUES($1,0) ON CONFLICT DO NOTHING', [id]);
        await pool.query("INSERT INTO oauth_session_state(sid,user_id,auth_epoch,expires_at) VALUES($1,$2,0,now()+interval '1 hour')", [sid, id]);
      }
      await pool.query("INSERT INTO oidc_signing_keys VALUES('key-proof','ES256',$1)", [signer.privateKey.export({ format: 'pem', type: 'pkcs8' })]);
      await pool.query("INSERT INTO oauth_clients VALUES('xeno-agent-interface',ARRAY['openid','workforce:read','workforce:manage'])");
      const token = (actor, { authTime = Math.floor(Date.now() / 1000), scope = 'openid workforce:read workforce:manage', bound = true } = {}) =>
        jwt.sign({ sub: actor, sid: sessions.get(actor), auth_epoch: 0, auth_time: authTime, client_id: 'xeno-agent-interface', scope,
          typ: 'at+jwt', ...(bound ? { cnf: { jkt } } : {}) },
        signer.privateKey, { algorithm: 'ES256', keyid: 'key-proof', audience: 'xeno-api', expiresIn: '5m', header: { typ: 'at+jwt' } });
      const { default: router } = await import('../src/server/routes/workforceRoutes.js');
      const app = express(); app.use((req, _res, next) => { req.db = pool; next(); }); app.use('/api/workforce', router);
      const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
      t.after(() => server.close());
      const origin = `http://127.0.0.1:${server.address().port}`;
      const call = async (method, path, body, { credential, proof = true, scheme = 'DPoP' } = {}) => {
        const full = `/api/workforce/ownership-transfers${path}`;
        const headers = { 'content-type': 'application/json', authorization: `${scheme} ${credential}` };
        if (proof) headers.dpop = jwt.sign({ jti: randomUUID(), htm: method, htu: `${issuer()}${full}`, ath: accessTokenHash(credential),
          iat: Math.floor(Date.now() / 1000) }, proofKey.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk } });
        const r = await fetch(origin + full, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        // A non-JSON body (an unmounted route's 404 page) is reported as a status, so the assertion
        // that names the property fails -- not a parse error that names nothing.
        return { status: r.status, body: await r.json().catch(() => null) };
      };

      const id = await makeAgent({ type: 'workspace', id: studio });
      const to = { type: 'workspace', id: acme };
      const legacy = jwt.sign({ userId: alice }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
      assert.equal((await call('POST', '', { resourceId: id, to }, { credential: legacy, scheme: 'Bearer', proof: false })).status, 401,
        'a legacy bearer JWT cannot move a resource');
      assert.equal((await call('POST', '', { resourceId: id, to }, { credential: token(alice, { bound: false }), scheme: 'Bearer', proof: false })).status, 401,
        'an unbound token cannot move a resource');
      assert.equal((await call('POST', '', { resourceId: id, to }, { credential: token(alice, { scope: 'openid workforce:read' }) })).status, 403,
        'workforce:manage is required');
      assert.equal((await call('POST', '', { resourceId: id, to }, { credential: token(alice, { authTime: Math.floor(Date.now() / 1000) - 3600 }) })).status, 401,
        'a stale authentication cannot give a resource away');
      assert.equal((await call('POST', '', { resourceId: id, to, actorUserId: bob }, { credential: token(alice) })).status, 400,
        'the body cannot name the actor');

      const proposed = await call('POST', '', { resourceId: id, to }, { credential: token(alice) });
      assert.equal(proposed.status, 200, `the transfer router is reachable at /api/workforce/ownership-transfers: ${JSON.stringify(proposed.body)}`);
      const tid = proposed.body.result.id;
      assert.equal((await call('POST', `/${tid}/authorize`, {}, { credential: token(alice) })).body.result.state, 'authorized');
      const subject = (await call('GET', `/${tid}/review-subject`, undefined, { credential: token(alice) })).body.result;
      assert.deepEqual(subject.secretReferences, ['GITHUB_TOKEN', 'PROVIDER_KEY']);
      assert.equal((await call('POST', `/${tid}/review`, { agentVersion: subject.agentVersion, review: review(subject) },
        { credential: token(alice) })).body.result.state, 'reviewed');
      const bySource = await call('POST', `/${tid}/accept`, { rationale: 'x' }, { credential: token(alice) });
      assert.equal(bySource.status, 403, 'the source cannot accept over HTTP either');
      const accepted = await call('POST', `/${tid}/accept`, { rationale: 'Acme takes over reviews' }, { credential: token(bob) });
      assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      assert.equal((await resourceOf(id)).owner_workspace_id, acme, 'the HTTP surface completes a real transfer');
      assert.equal((await call('GET', `/${tid}`, undefined, { credential: token(bob) })).body.result.state, 'accepted');
    });

    await t.test('transfer history cannot be erased', async () => {
      await assert.rejects(pool.query('DELETE FROM workforce_ownership_transfers'), /history is retained/);
      await assert.rejects(pool.query('TRUNCATE workforce_ownership_transfers'), /history is retained/);
    });
  } finally {
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
