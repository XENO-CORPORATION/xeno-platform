// A refusal says whether the SAME run can continue, so a runtime need not hard-code the code list.
//
// Not cited as RUN-07 (that requirement is about runtimes continuing). This proves the platform half
// against real PostgreSQL: the authorize-step refusal and the run-draw refusals each carry
// `resumable` + `resume`, derived from a closed table, and a code the table does not name carries
// neither -- the platform has not said, so a runtime must not guess.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';
import { createWorkforceResource } from '../src/server/services/workforceResources.js';
import { admitRun } from '../src/server/services/workforceRunAdmission.js';
import { authorizeRunStep, revokeRun } from '../src/server/services/workforceRunAuthority.js';
import { TERMINAL_LOSSES, STEP_REFUSAL_RESUME, DRAW_REFUSAL_RESUME, resumeFields } from '../src/server/services/workforceRunRefusals.js';
import { createServiceLedgerRouter } from '../src/server/routes/serviceLedgerRoutes.js';
import * as ledger from '../src/server/utils/creditLedgerV2.js';

test('the closed table: every terminal loss is classified, shapes are valid, unknown codes say nothing', () => {
  const RESUME = /^[a-z_]{1,32}$/;
  for (const map of [STEP_REFUSAL_RESUME, DRAW_REFUSAL_RESUME]) {
    for (const [code, r] of map) {
      assert.equal(typeof r.resumable, 'boolean', code);
      assert.match(r.resume, RESUME, code);
      assert.equal(r.resumable === false, r.resume === 'new_admission', `${code}: only a new admission follows an over run`);
    }
  }
  for (const reason of TERMINAL_LOSSES.keys()) {
    assert.deepEqual(resumeFields(STEP_REFUSAL_RESUME, reason), { resumable: false, resume: 'new_admission' }, `${reason}: a revoking loss ends the run`);
  }
  assert.deepEqual(resumeFields(DRAW_REFUSAL_RESUME, 'SOMETHING_NEW'), {}, 'an unclassified code carries nothing');
  assert.deepEqual(resumeFields(STEP_REFUSAL_RESUME, undefined), {}, 'no reason carries nothing');
});

const url = process.env.TEST_DATABASE_URL;
test('real refusals carry resumability: authorize-step and the run-draw route', { skip: !url, timeout: 60000 }, async t => {
  const pool = new pg.Pool({ connectionString: requireProofDatabase(url), max: 6 }); t.after(() => pool.end());
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signingKey = { kid: 'resume', privatePem: key.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const mark = randomUUID();
  const owner = (await pool.query("INSERT INTO users(username,email,password_hash,display_name) VALUES($1,$2,'fixture',$1) RETURNING id", [mark, `${mark}@example.test`])).rows[0].id;
  await pool.query("INSERT INTO xeno_account_plans(user_id,plan,status) VALUES($1,'internal','active')", [owner]);
  await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)', [owner]);
  await ledger.addGrant(pool, owner, { amountMicro: 1_000_000, kind: 'paid', priority: 10, sourceRef: `resume:${mark}` });
  const ctx = { actorUserId: owner, clientId: 'xeno-agent-interface' };
  const resource = await createWorkforceResource(pool, ctx, { operationId: randomUUID(), kind: 'agent', name: 'Resume fixture', owner: { type: 'user', id: owner }, definition: { schemaVersion: 1, instructions: 'Fixture', skills: [], requestedCapabilities: [] } });
  const admit = async ceiling => (await admitRun(pool, ctx, { operationId: randomUUID(), agent: { resourceId: resource.resource.id, version: resource.version.version, contentHash: resource.version.contentHash }, target: { kind: 'personal', ownerUserId: owner }, capabilities: [], budget: { ceilingMicro: String(ceiling) } })).admission.admissionId;
  const step = (admissionId, extra = {}) => authorizeRunStep(pool, ctx, { admissionId, operation: 'provider_dispatch', ...extra }, { signingKey });
  const refusal = async promise => { try { await promise; } catch (e) { return e.details; } assert.fail('expected a refusal'); };

  // authorize-step: a stopped run is over; a single capability that is not live refuses THIS step only.
  const stopped = await admit(100000);
  await revokeRun(pool, ctx, stopped);
  const revoked = await refusal(step(stopped));
  assert.deepEqual([revoked.reason, revoked.resumable, revoked.resume], ['admission_revoked', false, 'new_admission'], 'a revoked run cannot continue');
  const live = await admit(100000);
  const noCap = await refusal(authorizeRunStep(pool, ctx, { admissionId: live, operation: 'privileged_call', capability: 'files.write' }, { signingKey }));
  assert.deepEqual([noCap.reason, noCap.resumable, noCap.resume], ['capability_not_live', true, 'different_capability'], 'a capability refusal leaves the run alive');
  assert.ok((await step(live)).token, 'and that run can still dispatch');

  // The real service route, as the gateway calls it.
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/svc', createServiceLedgerRouter({ getServiceToken: () => 'svc' }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  const newDrawId = () => "draw-" + randomUUID();
  const open = (admissionId, body) => fetch(`http://127.0.0.1:${server.address().port}/svc/runs/${admissionId}/draws`,
    { method: 'POST', headers: { authorization: 'Bearer svc', 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json() }));
  const draw = async (admissionId, over = {}) => open(admissionId, { actorUserId: owner, drawId: `draw-${randomUUID()}`, lease: (await step(admissionId)).token,
    model: 'claude-opus-5', inputBound: 10, outputBound: 10, ...over });

  assert.equal((await draw(live)).status, 200, 'a fresh lease draws');

  const tooBig = await draw(await admit(1000), { inputBound: 1_000_000, outputBound: 1_000_000 });
  assert.equal(tooBig.status, 402);
  assert.deepEqual([tooBig.body.error.code, tooBig.body.error.resumable, tooBig.body.error.resume], ['RUN_BUDGET_EXHAUSTED', true, 'budget_top_up'], 'a spent envelope can be topped up');
  assert.ok(tooBig.body.error.remainingMicro, 'the existing numbers still travel beside it');

  // A lease is one dispatch: its second use is refused, and a fresh lease is all that is needed.
  const lease = (await step(live)).token;
  const once = await open(live, { actorUserId: owner, drawId: newDrawId(), lease, model: 'claude-opus-5', inputBound: 10, outputBound: 10 });
  const twice = await open(live, { actorUserId: owner, drawId: newDrawId(), lease, model: 'claude-opus-5', inputBound: 10, outputBound: 10 });
  assert.equal(once.status, 200, 'the lease is consumed by its first draw');
  assert.deepEqual([twice.status, twice.body.error.code, twice.body.error.resumable, twice.body.error.resume], [409, 'LEASE_CONSUMED', true, 'fresh_lease'], 'a consumed lease just needs a fresh one');

  // A run stopped AFTER its lease was issued: the draw is refused, and no lease can follow.
  const late = await admit(100000);
  const heldLease = (await step(late)).token;
  await revokeRun(pool, ctx, late);
  const lost = await open(late, { actorUserId: owner, drawId: newDrawId(), lease: heldLease, model: 'claude-opus-5', inputBound: 10, outputBound: 10 });
  assert.deepEqual([lost.status, lost.body.error.code, lost.body.error.resumable, lost.body.error.resume], [403, 'RUN_REVOKED', false, 'new_admission'], 'a revoked run cannot draw; a new admission is the way forward');
});
