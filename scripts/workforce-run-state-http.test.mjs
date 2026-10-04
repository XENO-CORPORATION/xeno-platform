// The run-state signals, over the REAL router with REAL sender-bound tokens.
//
// Why this exists: the router projects each result through a fixed field list. The run-state fields
// (state, durableReason, remainingMicro) were merged with a green service test and were silently dropped
// at the HTTP boundary, because the service suite calls the function and the routes suite uses stubs.
// Neither crosses the projection. This does, for every RUN-07 platform signal a runtime reads.
//
// Not cited as RUN-07 (that requirement is about runtimes continuing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import express from 'express';
import pg from 'pg';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';
import { createWorkforceResource } from '../src/server/services/workforceResources.js';
import { admitRun } from '../src/server/services/workforceRunAdmission.js';
import { revokeRun } from '../src/server/services/workforceRunAuthority.js';
import * as ledger from '../src/server/utils/creditLedgerV2.js';
import { jwkThumbprint, accessTokenHash } from '../src/server/utils/dpop.js';
import { issuer } from '../src/server/config/hosts.js';
import { getSigningKey } from '../src/server/utils/oidcProvider.js';
import router from '../src/server/routes/workforceRoutes.js';

const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
const url = process.env.TEST_DATABASE_URL;
test('over HTTP: authority state, remaining budget on the lease, and resumable refusals all reach the runtime', { skip: !url, timeout: 60000 }, async t => {
  const pool = new pg.Pool({ connectionString: requireProofDatabase(url), max: 6 }); t.after(() => pool.end());
  const mark = randomUUID();
  const owner = (await pool.query("INSERT INTO users(username,email,password_hash,display_name) VALUES($1,$2,'fixture',$1) RETURNING id", [mark, `${mark}@example.test`])).rows[0].id;
  await pool.query("INSERT INTO xeno_account_plans(user_id,plan,status) VALUES($1,'internal','active')", [owner]);
  await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)', [owner]);
  await ledger.addGrant(pool, owner, { amountMicro: 1_000_000, kind: 'paid', priority: 10, sourceRef: `state-http:${mark}` });
  const ctx = { actorUserId: owner, clientId: 'xeno-agent-interface' };
  const resource = await createWorkforceResource(pool, ctx, { operationId: randomUUID(), kind: 'agent', name: 'HTTP state fixture', owner: { type: 'user', id: owner }, definition: { schemaVersion: 1, instructions: 'Fixture', skills: [], requestedCapabilities: [] } });
  const admit = async ceiling => (await admitRun(pool, ctx, { operationId: randomUUID(), agent: { resourceId: resource.resource.id, version: resource.version.version, contentHash: resource.version.contentHash }, target: { kind: 'personal', ownerUserId: owner }, capabilities: [], budget: { ceilingMicro: String(ceiling) } })).admission.admissionId;

  // Sender-bound access token, exactly as a product presents it.
  const signer = await getSigningKey(pool), proofKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }), sid = randomUUID(), now = Math.floor(Date.now() / 1000);
  const jwk = proofKey.publicKey.export({ format: 'jwk' }), jkt = jwkThumbprint(jwk);
  await pool.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch) VALUES($1,0) ON CONFLICT DO NOTHING', [owner]);
  await pool.query(`INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at) VALUES($1,$2,0,to_timestamp($3),$4,now()+interval '1 hour')`, [sid, owner, now, jkt]);
  const app = express(); app.use((req, _res, next) => { req.db = pool; next(); }); app.use('/api/workforce', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  const call = async (path, body) => {
    const full = `/api/workforce${path}`;
    const token = jwt.sign({ sub: owner, sid, auth_epoch: 0, auth_time: now, client_id: 'xeno-agent-interface', scope: 'openid workforce:read workforce:manage ledger:spend', typ: 'at+jwt', cnf: { jkt } },
      signer.privatePem, { algorithm: signer.alg, keyid: signer.kid, audience: 'xeno-api', expiresIn: '5m', header: { typ: 'at+jwt' } });
    const dpop = jwt.sign({ jti: randomUUID(), htm: 'POST', htu: issuer() + full, ath: accessTokenHash(token), iat: now }, proofKey.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk } });
    const r = await fetch(`http://127.0.0.1:${server.address().port}${full}`, { method: 'POST', headers: { authorization: `DPoP ${token}`, dpop, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  const live = await admit(100000);
  const state = await call('/run-admissions/authority', { admissionId: live });
  assert.equal(state.status, 200, JSON.stringify(state.body));
  assert.deepEqual([state.body.state, state.body.durableReason, state.body.revoked, state.body.remainingMicro], ['active', null, false, '100000'], 'the run state crosses the HTTP boundary');
  assert.ok(state.body.reservationExpiresAt, 'and its reservation deadline');

  const step = await call('/run-admissions/authorize-step', { admissionId: live, operation: 'provider_dispatch' });
  assert.equal(step.status, 200, JSON.stringify(step.body));
  assert.ok(step.body.token, 'a lease is issued');
  assert.deepEqual([step.body.budget?.remainingMicro, typeof step.body.budget?.reservationExpiresAt], ['100000', 'string'], 'what the run can still fund travels with the lease');

  const stopped = await admit(100000);
  await revokeRun(pool, ctx, stopped);
  const revoked = await call('/run-admissions/authority', { admissionId: stopped });
  assert.deepEqual([revoked.body.state, revoked.body.durableReason, revoked.body.revoked], ['revoked', 'stopped', true], 'a stopped run reads revoked over HTTP');
  const refused = await call('/run-admissions/authorize-step', { admissionId: stopped, operation: 'provider_dispatch' });
  assert.equal(refused.status, 403);
  assert.deepEqual([refused.body.details.reason, refused.body.details.resumable, refused.body.details.resume], ['admission_revoked', false, 'new_admission'], 'a refusal says over HTTP that only a new admission follows');

  const noCap = await call('/run-admissions/authorize-step', { admissionId: live, operation: 'privileged_call', capability: 'files.write' });
  assert.deepEqual([noCap.status, noCap.body.details.reason, noCap.body.details.resumable, noCap.body.details.resume], [403, 'capability_not_live', true, 'different_capability'], 'a capability refusal leaves the run alive, and says so');
});
