// FUND-19 against real PostgreSQL: fee arithmetic is exact and
// partition-independent -- floor(cumulative * 15 / 100) per stable billing
// item and price version, posting only the difference; creator net is the
// remainder; refunds reverse under the original version; rounding residue is
// recorded per event.
//
// PROVEN: split charges post cumulative differences (6+6 micro posts fee 0
// then 1, never per-event floors); three different partitions of 12 micro
// post identical totals; creator deltas always equal gross minus fee delta;
// a refund recomputes the floor from the reduced cumulative under the
// original version (100 gross, fee 15, refund 40 -> fee reversal 6, creator
// restore 34); unknown-version and over- refunds are refused; every event
// records its residue ((cumulative*15)%100); ten concurrent posters neither
// lose updates nor double-post.
// NOTE: the engine is proven standalone; wiring into meterInvocation awaits
// the marketplace micro-credit migration (see module NOTE).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const fees=await import('../src/server/services/marketplaceCommissions.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('FUND-19: cumulative-difference commission; partition-independent; versioned refunds',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`f19-${randomUUID().slice(0,8)}`;
 const V='fee-v1';

 // ── Cumulative difference, not per-event floors.
 const a1=await fees.postCommission(pool,{billingItemKey:marker+'-a',priceVersion:V,grossMicro:'6'});
 assert.deepEqual([a1.feeDeltaMicro,a1.creatorDeltaMicro,a1.postedFeeMicro,a1.residueAfter],[ '0','6','0',90],
  'floor(6*15/100)=0 posts nothing on the first micro-event, carrying residue 90');
 const a2=await fees.postCommission(pool,{billingItemKey:marker+'-a',priceVersion:V,grossMicro:'6'});
 assert.deepEqual([a2.feeDeltaMicro,a2.creatorDeltaMicro,a2.postedFeeMicro,a2.residueAfter],[ '1','5','1',80],
  'the second event posts the cumulative difference floor(12*15/100)-0=1');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM marketplace_commission_events WHERE billing_item_key=$1',[marker+'-a'])).rows[0].n,2,
  'both events are recorded');

 // ── Partition independence: one item, three splittings, one total.
 await fees.postCommission(pool,{billingItemKey:marker+'-whole',priceVersion:V,grossMicro:'12'});
 await fees.postCommission(pool,{billingItemKey:marker+'-tri',priceVersion:V,grossMicro:'5'});
 await fees.postCommission(pool,{billingItemKey:marker+'-tri',priceVersion:V,grossMicro:'4'});
 await fees.postCommission(pool,{billingItemKey:marker+'-tri',priceVersion:V,grossMicro:'3'});
 const totals=(await pool.query(`SELECT billing_item_key,cumulative_gross_micro::text AS g,posted_fee_micro::text AS f
  FROM marketplace_commission_postings WHERE billing_item_key IN ($1,$2,$3) ORDER BY 1`,
  [marker+'-a',marker+'-tri',marker+'-whole'])).rows;
 assert.deepEqual(totals.map(r=>[r.g,r.f]),[['12','1'],['12','1'],['12','1']],
  'splitting 12 micro as 12, 6+6 or 5+4+3 posts the identical fee total');
 const nets=(await pool.query(`SELECT billing_item_key,COALESCE(sum(creator_delta_micro),0)::text AS n
  FROM marketplace_commission_events WHERE billing_item_key IN ($1,$2,$3) GROUP BY 1 ORDER BY 1`,
  [marker+'-a',marker+'-tri',marker+'-whole'])).rows;
 assert.deepEqual(nets.map(r=>r.n),['11','11','11'],'creator net is the remainder on every partition');

 // ── Refunds reverse under the original version, never today's rate.
 await fees.postCommission(pool,{billingItemKey:marker+'-r',priceVersion:V,grossMicro:'100'});
 const rev=await fees.reverseCommission(pool,{billingItemKey:marker+'-r',priceVersion:V,refundMicro:'40'});
 assert.deepEqual([rev.feeReversalMicro,rev.creatorRestoreMicro,rev.cumulativeGrossMicro,rev.postedFeeMicro],
  ['6','34','60','9'],'refund recomputes floor(60*15/100)=9: fee reverses 6, creator restores 34');
 await assert.rejects(fees.reverseCommission(pool,{billingItemKey:marker+'-r',priceVersion:'fee-v2',refundMicro:'10'}),
  e=>e.code==='not_found','a refund naming a version with no posting is refused: original version only');
 await assert.rejects(fees.reverseCommission(pool,{billingItemKey:marker+'-r',priceVersion:V,refundMicro:'61'}),
  e=>e.code==='conflict','refunding more than the cumulative is refused');

 // ── Concurrent posters serialize: no lost updates, no double posts.
 const race=marker+'-race';
 await Promise.all(Array.from({length:10},()=>fees.postCommission(pool,{billingItemKey:race,priceVersion:V,grossMicro:'6'})));
 const rr=(await pool.query('SELECT cumulative_gross_micro::text AS g,posted_fee_micro::text AS f FROM marketplace_commission_postings WHERE billing_item_key=$1 AND price_version=$2',[race,V])).rows[0];
 assert.deepEqual([rr.g,rr.f],['60','9'],'ten parallel posts of 6 accrue exactly 60 gross and floor(60*15/100)=9 fee');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM marketplace_commission_events WHERE billing_item_key=$1',[race])).rows[0].n,10,
  'all ten events are recorded exactly once');
});
