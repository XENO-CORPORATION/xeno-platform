// A run's durable state, read from live rows by a runtime whose process is gone.
//
// Not cited as RUN-07: that requirement is about runtimes (goals, loops and schedules continuing while
// authorized, funded and progressing). This proves the PLATFORM half -- the state a detached runtime
// can read -- against real PostgreSQL. Each state is reached by the real act that causes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import pg from 'pg';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';
import { createWorkforceResource } from '../src/server/services/workforceResources.js';
import { admitRun } from '../src/server/services/workforceRunAdmission.js';
import { authorizeRunStep, readRunAuthority, revokeRun } from '../src/server/services/workforceRunAuthority.js';
import { reportRunResult } from '../src/server/services/workforceRunResults.js';
import * as ledger from '../src/server/utils/creditLedgerV2.js';

const url = process.env.TEST_DATABASE_URL;
test('a detached runtime can read why a run is not continuing: active, exhausted, revoked, expired, finished', { skip: !url, timeout: 60000 }, async t => {
  const pool = new pg.Pool({ connectionString: requireProofDatabase(url), max: 6 }); t.after(() => pool.end());
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signingKey = { kid: 'run-state', privatePem: key.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const mark = randomUUID();
  const owner = (await pool.query("INSERT INTO users(username,email,password_hash,display_name) VALUES($1,$2,'fixture',$1) RETURNING id", [mark, `${mark}@example.test`])).rows[0].id;
  await pool.query("INSERT INTO xeno_account_plans(user_id,plan,status) VALUES($1,'internal','active')", [owner]);
  await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)', [owner]);
  await ledger.addGrant(pool, owner, { amountMicro: 1_000_000, kind: 'paid', priority: 10, sourceRef: `run-state:${mark}` });
  const ctx = { actorUserId: owner, clientId: 'xeno-agent-interface' };
  const resource = await createWorkforceResource(pool, ctx, { operationId: randomUUID(), kind: 'agent', name: 'State fixture', owner: { type: 'user', id: owner }, definition: { schemaVersion: 1, instructions: 'Fixture', skills: [], requestedCapabilities: [] } });
  const admit = async ceiling => (await admitRun(pool, ctx, { operationId: randomUUID(), agent: { resourceId: resource.resource.id, version: resource.version.version, contentHash: resource.version.contentHash }, target: { kind: 'personal', ownerUserId: owner }, capabilities: [], budget: { ceilingMicro: String(ceiling) } })).admission.admissionId;
  const dispatch = async (admissionId, bound = 10) => {
    const lease = (await authorizeRunStep(pool, ctx, { admissionId, operation: 'provider_dispatch' }, { signingKey })).token;
    const drawId = `draw-${randomUUID()}`;
    await ledger.openRunDrawV2(pool, { admissionId, actorUserId: owner, drawId, lease, model: 'claude-opus-5', inputBound: bound, outputBound: bound });
    return drawId;
  };
  const state = async id => readRunAuthority(pool, ctx, id);

  // active: nothing has happened yet; the whole ceiling is still available.
  const active = await admit(100000);
  const s0 = await state(active);
  assert.deepEqual([s0.state, s0.durableReason, s0.revoked, s0.remainingMicro], ['active', null, false, '100000'], 'a fresh run is active with its whole ceiling');
  assert.ok(s0.reservationExpiresAt, 'the reservation deadline is visible');

  // The reserved cost of one small dispatch -- measured from the ledger, not assumed.
  const probe = await admit(100000);
  const probeDraw = await dispatch(probe);
  const reserved = (await pool.query('SELECT reserved_micro::text n FROM credit_hold_draws WHERE draw_id=$1', [probeDraw])).rows[0].n;
  assert.ok(BigInt(reserved) > 0n && BigInt(reserved) < 100000n, 'a small dispatch reserves part of the ceiling');
  const s1 = await state(probe);
  assert.equal(s1.state, 'active', 'a run with an open draw and headroom left is still active');
  assert.equal(s1.remainingMicro, String(100000n - BigInt(reserved)), 'remaining is the ceiling less what the open draw reserves');

  // exhausted: a ceiling exactly one dispatch wide, spent by that dispatch.
  const tight = await admit(reserved);
  await dispatch(tight);
  const s2 = await state(tight);
  assert.deepEqual([s2.state, s2.durableReason, s2.remainingMicro], ['exhausted', 'budget_exhausted', '0'], 'a spent envelope reads exhausted, with the durable reason');
  assert.equal(s2.revoked, false, 'exhaustion is not revocation: topping up can resume it');

  // revoked: the actor stops the run.
  const stopped = await admit(100000);
  await revokeRun(pool, ctx, stopped);
  const s3 = await state(stopped);
  assert.deepEqual([s3.state, s3.durableReason, s3.revoked], ['revoked', 'stopped', true], 'a stopped run reads revoked/stopped');

  // expired: the reservation lapses by time with no draw keeping it.
  const lapsed = await admit(100000);
  await pool.query(`UPDATE credit_holds SET expires_at=now()-interval '1 hour' WHERE id=(SELECT hold_row_id FROM workforce_run_holds WHERE admission_id=$1)`, [lapsed]);
  const s4 = await state(lapsed);
  assert.deepEqual([s4.state, s4.durableReason], ['expired', 'budget_exhausted'], 'a lapsed reservation reads expired');
  assert.equal(s4.revoked, false, 'a lapsed reservation is not a revocation');

  // expired, the other way: the reservation was RELEASED before its deadline. Time alone would call it
  // live, so this is what pins the "still held" half of the test.
  const released = await admit(100000);
  const heldFuture = (await pool.query(`UPDATE credit_holds SET state='released' WHERE id=(SELECT hold_row_id FROM workforce_run_holds WHERE admission_id=$1) AND expires_at>now() RETURNING id`, [released])).rowCount;
  assert.equal(heldFuture, 1, 'fixture: the hold was unexpired when released');
  assert.deepEqual([(await state(released)).state, (await state(released)).durableReason], ['expired', 'budget_exhausted'], 'a released reservation reads expired even before its deadline');

  // finished: the run reports a result; nothing more to continue, whatever else is true.
  const done = await admit(100000);
  await reportRunResult(pool, ctx, { admissionId: done, outcome: 'completed', summary: 'done', artifacts: [] });
  const s5 = await state(done);
  assert.deepEqual([s5.state, s5.durableReason], ['finished', null], 'a reported run reads finished');

  // The read is not a write: asking changes nothing.
  const before = (await pool.query('SELECT (SELECT count(*) FROM credit_holds) h, (SELECT count(*) FROM credit_hold_draws) d, (SELECT count(*) FROM workforce_run_leases) l')).rows[0];
  await Promise.all([active, probe, tight, stopped, lapsed, done].map(state));
  assert.deepEqual((await pool.query('SELECT (SELECT count(*) FROM credit_holds) h, (SELECT count(*) FROM credit_hold_draws) d, (SELECT count(*) FROM workforce_run_leases) l')).rows[0], before, 'reading a run state writes nothing');

  // Another actor learns nothing about the run.
  const stranger = (await pool.query("INSERT INTO users(username,email,password_hash,display_name) VALUES($1,$2,'fixture',$1) RETURNING id", [randomUUID(), `${randomUUID()}@example.test`])).rows[0].id;
  await assert.rejects(readRunAuthority(pool, { actorUserId: stranger, clientId: 'xeno-agent-interface' }, active), e => e.details?.reason === 'admission_not_found', 'another actor cannot read a run state');
});
