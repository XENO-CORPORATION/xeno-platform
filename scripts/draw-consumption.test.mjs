import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';
import { createWorkforceResource } from '../src/server/services/workforceResources.js';
import { admitRun } from '../src/server/services/workforceRunAdmission.js';
import { authorizeRunStep } from '../src/server/services/workforceRunAuthority.js';
import * as ledger from '../src/server/utils/creditLedgerV2.js';

const url = process.env.TEST_DATABASE_URL;
test('resolved draw consumption retains exact lots atomically without changing money policy', { skip: !url, timeout: 60000 }, async t => {
  const pool = new pg.Pool({ connectionString: requireProofDatabase(url), max: 8 }); t.after(() => pool.end());
  const migration = await readFile(new URL('../src/server/database/migrations/20261001100000-credit-draw-consumption.sql', import.meta.url), 'utf8');
  const [up, down] = migration.split('-- DOWN');
  await pool.query(down); await pool.query(up);
  const marker = randomUUID();
  const owner = (await pool.query("INSERT INTO users(username,email,password_hash,display_name) VALUES($1,$2,'fixture',$1) RETURNING id", [marker, `${marker}@example.test`])).rows[0].id;
  await pool.query("INSERT INTO xeno_account_plans(user_id,plan,status) VALUES($1,'internal','active')", [owner]);
  await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)', [owner]);
  await ledger.addGrant(pool, owner, { amountMicro: 10000, kind: 'paid', priority: 10, sourceRef: `provenance:first:${marker}` });
  await ledger.addGrant(pool, owner, { amountMicro: 90000, kind: 'paid', priority: 20, sourceRef: `provenance:second:${marker}` });
  await pool.query("UPDATE credit_grants SET expires_at='2030-01-01T01:02:03.123456Z' WHERE user_id=$1 AND priority=10", [owner]);
  const grants = (await pool.query('SELECT id,source_ref,priority,expires_at::text AS expiry FROM credit_grants WHERE user_id=$1 ORDER BY priority', [owner])).rows;
  const context = { actorUserId: owner, clientId: 'xeno-agent-interface' };
  const resource = await createWorkforceResource(pool, context, { operationId: randomUUID(), kind: 'agent', name: 'Provenance fixture', owner: { type: 'user', id: owner }, definition: { schemaVersion: 1, instructions: 'Fixture', skills: [], requestedCapabilities: [] } });
  const admission = (await admitRun(pool, context, { operationId: randomUUID(), agent: { resourceId: resource.resource.id, version: resource.version.version, contentHash: resource.version.contentHash }, target: { kind: 'personal', ownerUserId: owner }, capabilities: [], budget: { ceilingMicro: '100000' } })).admission.admissionId;
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signingKey = { kid: 'consumption-fixture', privatePem: key.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const open = async () => {
    const token = (await authorizeRunStep(pool, context, { admissionId: admission, operation: 'provider_dispatch' }, { signingKey })).token;
    const drawId = `draw-${randomUUID()}`;
    await ledger.openRunDrawV2(pool, { admissionId: admission, actorUserId: owner, drawId, lease: token, model: 'claude-opus-5', inputBound: 1, outputBound: 1 });
    return (await pool.query('SELECT * FROM credit_hold_draws WHERE draw_id=$1', [drawId])).rows[0];
  };
  const settleInput = d => ({ admissionId: admission, drawId: d.draw_id, providerRequestId: `provider-${d.id}`, provider: 'fixture', model: d.model, inputTokens: 10, outputTokens: 10, measured: true });
  const lots = async id => (await pool.query('SELECT *,grant_expires_at::text AS expiry FROM credit_draw_consumption_lots WHERE draw_row_id=$1 ORDER BY consumption_order', [id])).rows;
  const receipt = async id => (await pool.query('SELECT * FROM credit_draw_consumption_receipts WHERE draw_row_id=$1', [id])).rows[0];
  const first = await open();
  // A migration added after a resolved draw must not fabricate historical evidence.
  await pool.query(down);
  await pool.query("UPDATE credit_hold_draws SET state='voided',outcome='not_dispatched',resolved_at=now() WHERE id=$1", [first.id]);
  await pool.query(up);
  assert.equal(await receipt(first.id), undefined, 'historical resolved draw stays explicitly unrecorded');
  await assert.rejects(pool.query(`INSERT INTO credit_draw_consumption_receipts(draw_row_id,hold_row_id,admission_id,account_id,payer_user_id,charged_micro,allocation_count)
    SELECT d.id,d.hold_row_id,d.admission_id,h.account_id,h.user_id,0,0 FROM credit_hold_draws d JOIN credit_holds h ON h.id=d.hold_row_id WHERE d.id=$1`, [first.id]), { code: '23514' }, 'cannot backfill guessed provenance on an old resolved draw');

  const draw = await open();
  const before = (await pool.query('SELECT balance,lifetime_spent FROM credit_accounts WHERE user_id=$1', [owner])).rows[0];
  // Fail after the grant decrement but before its provenance row is written.
  await pool.query(`CREATE FUNCTION fail_consumption_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture consumption write failed'; END $$;
    CREATE TRIGGER fail_consumption_fixture BEFORE INSERT ON credit_draw_consumption_lots FOR EACH ROW EXECUTE FUNCTION fail_consumption_fixture()`);
  try { await assert.rejects(ledger.settleRunDrawV2(pool, settleInput(draw)), /fixture consumption write failed/); }
  finally { await pool.query('DROP TRIGGER fail_consumption_fixture ON credit_draw_consumption_lots; DROP FUNCTION fail_consumption_fixture()'); }
  assert.deepEqual((await pool.query('SELECT balance,lifetime_spent FROM credit_accounts WHERE user_id=$1', [owner])).rows[0], before, 'provenance failure rolls back account charge');
  assert.equal(await receipt(draw.id), undefined, 'provenance failure rolls back receipt');
  assert.equal((await pool.query('SELECT state FROM credit_hold_draws WHERE id=$1', [draw.id])).rows[0].state, 'open');
  assert.equal((await pool.query('SELECT count(*)::int n FROM credit_transactions WHERE reference_type=$1 AND reference_id=$2', ['xeno.draw', draw.id])).rows[0].n, 0, 'failed provenance cannot leave a debit');
  const results = await Promise.all([ledger.settleRunDrawV2(pool, settleInput(draw)), ledger.settleRunDrawV2(pool, settleInput(draw))]);
  assert.equal(results.filter(r => r.replayed).length, 1, 'concurrent settlement records consumption once');
  const recorded = await receipt(draw.id), consumed = await lots(draw.id);
  assert.equal(recorded.allocation_count, 2, 'a multi-lot draw retains both consumed allocations');
  assert.equal(recorded.charged_micro, '40000');
  assert.deepEqual(consumed.map(r => [r.grant_id, r.consumed_micro, r.consumption_order]), [[grants[0].id, '10000', 0], [grants[1].id, '30000', 1]], 'retained lots describe actual consumption, not original reservations');
  assert.equal(consumed[0].expiry, grants[0].expiry, 'expiry microseconds survive SQL snapshot');
  assert.equal(consumed[0].grant_source_ref, grants[0].source_ref);
  assert.equal((await pool.query('SELECT count(*)::int n FROM credit_hold_funding WHERE hold_row_id=$1 AND grant_id=$2', [draw.hold_row_id, grants[0].id])).rows[0].n, 0, 'evidence survives removed reservation allocation');
  assert.equal((await pool.query('SELECT amount FROM credit_transactions WHERE reference_type=$1 AND reference_id=$2', ['xeno.draw', draw.id])).rows[0].amount, '-40000', 'retained consumption agrees with canonical debit');
  await assert.rejects(ledger.settleRunDrawV2(pool, { ...settleInput(draw), outputTokens: 11 }), { code: 'CONFLICT' });
  for (const sql of [
    'UPDATE credit_draw_consumption_receipts SET charged_micro=charged_micro', 'DELETE FROM credit_draw_consumption_receipts',
    'UPDATE credit_draw_consumption_lots SET consumed_micro=consumed_micro', 'DELETE FROM credit_draw_consumption_lots',
    'TRUNCATE credit_draw_consumption_lots', 'TRUNCATE credit_draw_consumption_receipts CASCADE',
  ]) await assert.rejects(pool.query(sql), { code: '23514' }, 'consumption evidence cannot be altered or removed');
  await assert.rejects(pool.query(down), { code: '23514' }, 'rollback refuses retained evidence');

  const second = await open();
  const refuseTransaction = async (work, message) => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await assert.rejects(async () => { await work(db); await db.query('COMMIT'); }, { code: '23514' }, message);
    } finally { await db.query('ROLLBACK'); db.release(); }
  };
  const writeReceipt = (db, amount, count, payer = owner) => db.query(`INSERT INTO credit_draw_consumption_receipts
    (draw_row_id,hold_row_id,admission_id,account_id,payer_user_id,charged_micro,allocation_count)
    SELECT d.id,d.hold_row_id,d.admission_id,h.account_id,$2,$3,$4 FROM credit_hold_draws d
    JOIN credit_holds h ON h.id=d.hold_row_id WHERE d.id=$1`, [second.id, payer, amount, count]);
  const writeLot = (db, amount = '1', kindOverride = null) => db.query(`INSERT INTO credit_draw_consumption_lots
    (draw_row_id,grant_id,consumption_order,consumed_micro,grant_kind,grant_priority,grant_expires_at,grant_source_ref,grant_amount_micro,remaining_after_micro)
    SELECT $1,id,0,$2,COALESCE($3,kind),priority,expires_at,source_ref,amount_micro,remaining_micro
    FROM credit_grants WHERE id=$4`, [second.id, amount, kindOverride, grants[1].id]);
  const rawSettle = db => db.query("UPDATE credit_hold_draws SET state='settled',outcome='measured',resolved_at=now(),charged_micro=2,priced_micro=2 WHERE id=$1", [second.id]);
  await refuseTransaction(db => writeReceipt(db, '0', 0, randomUUID()), 'receipt cannot name another payer');
  await refuseTransaction(async db => { await writeReceipt(db, '2', 1); await writeLot(db, '1', 'promo'); }, 'lot cannot relabel original funding');
  await refuseTransaction(async db => { await writeReceipt(db, '2', 1); await writeLot(db); await rawSettle(db); }, 'deferred total rejects incomplete consumption');
  await refuseTransaction(async db => { await writeReceipt(db, '2', 1); await rawSettle(db); }, 'deferred count rejects missing lots');
  await refuseTransaction(async db => { await writeReceipt(db, '0', 0); await writeLot(db); await db.query("UPDATE credit_hold_draws SET state='settled',outcome='measured',resolved_at=now() WHERE id=$1", [second.id]); }, 'zero-charge receipt cannot carry a positive lot');
  // Missing receipt on a new settlement must be refused at COMMIT, not accepted as legacy.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE credit_hold_draws SET state='settled',outcome='measured',resolved_at=now() WHERE id=$1", [second.id]);
    await assert.rejects(client.query('COMMIT'), { code: '23514' }, 'new settlement cannot omit its consumption receipt');
  } finally { await client.query('ROLLBACK'); client.release(); }
  await ledger.settleRunDrawV2(pool, { ...settleInput(second), measured: false, inputTokens: undefined, outputTokens: undefined });
  const secondLots = await lots(second.id);
  assert.equal(secondLots.length, 1);
  assert.equal(secondLots[0].grant_id, grants[1].id);
  assert.equal(secondLots[0].consumed_micro, second.reserved_micro, 'unmeasured bound consumption is recorded without invented token counts');

  await refuseTransaction(async db => {
    await db.query(`INSERT INTO credit_draw_consumption_lots
      SELECT draw_row_id,$2,consumption_order+10,consumed_micro,grant_kind,grant_priority,grant_expires_at,grant_source_ref,grant_amount_micro,remaining_after_micro
      FROM credit_draw_consumption_lots WHERE draw_row_id=$1`, [draw.id, randomUUID()]);
  }, 'cannot append consumption after draw resolution');
  const expiredDraw = await open();
  await pool.query("UPDATE credit_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [grants[1].id]);
  const expiredAt = (await pool.query('SELECT expires_at::text AS expiry FROM credit_grants WHERE id=$1', [grants[1].id])).rows[0].expiry;
  await ledger.settleRunDrawV2(pool, { ...settleInput(expiredDraw), inputTokens: 1, outputTokens: 1 });
  assert.equal((await lots(expiredDraw.id))[0].expiry, expiredAt, 'already reserved expired lot retains its exact original expiry');
  // Restore fixture eligibility only for admission of the next independent case.
  await pool.query('UPDATE credit_grants SET expires_at=NULL WHERE id=$1', [grants[1].id]);

  const zero = await open();
  await pool.query('UPDATE credit_accounts SET is_frozen=true WHERE user_id=$1', [owner]);
  await ledger.settleRunDrawV2(pool, settleInput(zero));
  assert.equal((await receipt(zero.id)).charged_micro, '0', 'zero charged liability has an explicit provenance receipt');
  assert.equal((await receipt(zero.id)).allocation_count, 0);
  assert.equal((await lots(zero.id)).length, 0, 'no invented consumed lot for a zero charge');
  assert.equal((await ledger.verifyChainV2(pool, owner)).ok, true, 'provenance preserves canonical ledger hash chain');
});
