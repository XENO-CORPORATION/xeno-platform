// Ledger serialization order is not PostgreSQL transaction-start time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';
import { runAllMigrations } from '../src/server/services/migrationRunner.js';
import { migrateAccountV2 } from '../src/server/database/migrate-account-v2.js';
import { addGrant, addGrantTx, verifyChainV2 } from '../src/server/utils/creditLedgerV2.js';
const url=process.env.TEST_DATABASE_URL;
if(url)requireProofDatabase(url);

test('journal appends follow account serialization, including reversed starts and equal transaction timestamps', {skip:!url},async t=>{
  const pool=new pg.Pool({connectionString:url,max:5});
  t.after(()=>pool.end());
  await runAllMigrations(pool);await migrateAccountV2(pool);
  const user=async()=>{const tag=randomUUID();return (await pool.query(`INSERT INTO users(username,email,password_hash,display_name)
    VALUES($1,$2,'test-only',$1) RETURNING id`,[tag,tag+'@example.test'])).rows[0].id;};
  for(const zone of ['UTC','Europe/Bucharest']) {
    await t.test(`reverse-start transactions and same-transaction appends in ${zone}`,async()=>{
      const id=await user(),early=await pool.connect();
      try {
        await early.query('BEGIN');
        await early.query("SELECT set_config('TimeZone',$1,true)",[zone]);
        await early.query('SELECT now()');
        // Lock/journal order is intentionally the opposite of BEGIN order.
        await addGrant(pool,id,{amountMicro:10,sourceRef:'first'});
        await addGrantTx(early,id,{amountMicro:20,sourceRef:'second'});
        await addGrantTx(early,id,{amountMicro:30,sourceRef:'third'});
        await early.query('COMMIT');
        const rows=(await pool.query(`SELECT reference_id,created_at::text AS recorded,
          created_at>lag(created_at) OVER(ORDER BY created_at,id) AS advances
          FROM credit_transactions WHERE user_id=$1 ORDER BY created_at,id`,[id])).rows;
        assert.deepEqual(rows.map(r=>r.reference_id),['first','second','third'],
          'journal order follows serialization rather than transaction start');
        assert.ok(rows.slice(1).every(r=>r.advances),'successive journal writes have strictly advancing order');
        const chain=await verifyChainV2(pool,id);
        assert.equal(chain.ok,true,'serialized journal verifies after reverse-start and repeated appends');
        assert.equal(chain.entries,3);
      } finally {await early.query('ROLLBACK');early.release();}
    });
  }
  await t.test('an existing timestamp ahead of the clock cannot reorder the next append',async()=>{
    const id=await user();
    // A fixture INSERT trigger represents a previously observed clock ahead of now.
    // No existing journal record is rewritten or append-only guard disabled.
    await pool.query(`CREATE FUNCTION fixture_future_journal() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.reference_id='future-first' THEN NEW.created_at=(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_future_journal BEFORE INSERT ON credit_transactions FOR EACH ROW EXECUTE FUNCTION fixture_future_journal()`);
    try {await addGrant(pool,id,{amountMicro:10,sourceRef:'future-first'});}
    finally {await pool.query('DROP TRIGGER fixture_future_journal ON credit_transactions; DROP FUNCTION fixture_future_journal()');}
    await addGrant(pool,id,{amountMicro:10,sourceRef:'after-clock-rollback'});
    const order=(await pool.query('SELECT reference_id FROM credit_transactions WHERE user_id=$1 ORDER BY created_at,id',[id])).rows.map(r=>r.reference_id);
    assert.deepEqual(order,['future-first','after-clock-rollback'],'clock rollback cannot put an append before its predecessor');
    assert.equal((await verifyChainV2(pool,id)).ok,true,'clock rollback preserves hash-chain order');
  });
});
