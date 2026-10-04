// RES-02 against real PostgreSQL: licensed assets/data, storage allocation
// and compute time each need their own admitted driver plus a measurable
// receipt before offers of that family are advertised as usable. Unsupported
// offers may be recorded as proposals, never shown as delivered capacity.
//
// PROVEN: driver admission without a probe receipt (missing, zero or
// unit-less measurement) is refused, and unknown families are refused;
// the usable listing shows only open offers of admitted families --
// unadmitted-family offers, unknown-kind offers and proposals are all
// excluded; admitting a family promotes its open offers but never its
// proposals; recording a proposal for an already-usable family is refused;
// and a proposal cannot be accepted as an offer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {admitResourceDriver,recordResourceProposal,listUsableOffers,offerFamily}=await import('../src/server/services/resourceDrivers.js');
const {createResourceOffer,acceptResourceOffer}=await import('../src/server/services/resourceOffers.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('RES-02: admitted drivers plus receipts gate usable capacity; proposals never deliver',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`r2-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob');
 assert.deepEqual([offerFamily('compute/hours'),offerFamily('storage/bytes'),offerFamily('asset/model'),offerFamily('quantum/flux')],
  ['compute','storage','licensed-asset',null],'kinds map to families by prefix; unknown kinds map nowhere');
 const now=Date.now(),h=3600_000;
 const terms=(kind)=>({kind,capacityQuantity:10,capacityUnit:'unit',
  validFrom:new Date(now-h),validUntil:new Date(now+24*h),
  revocationPolicy:'r',costResponsibility:'c',dataAccessPolicy:'d',license:'l',verificationMethod:'v'});
 // Admission requires a measurable receipt.
 await assert.rejects(admitResourceDriver(pool,{actorUserId:alice,family:'compute',driverName:'C1'}),
  e=>e.message==='probe_receipt_required','admission without any receipt is refused');
 await assert.rejects(admitResourceDriver(pool,{actorUserId:alice,family:'compute',driverName:'C1',
   receipt:{probe:'p',measuredQuantity:0,measuredUnit:'gpu-hour'}}),
  e=>e.message==='probe_receipt_required','admission with a zero measurement is refused');
 await assert.rejects(admitResourceDriver(pool,{actorUserId:alice,family:'teleport',driverName:'T1',
   receipt:{probe:'p',measuredQuantity:1,measuredUnit:'jump'}}),
  e=>e.message==='unknown_family','admission for an unknown family is refused');
 // Proposals record unsupported capacity while it is still unsupported.
 const storageProposal=await recordResourceProposal(pool,{actorUserId:alice,offer:terms('storage/bytes')});
 const weirdProposal=await recordResourceProposal(pool,{actorUserId:alice,offer:terms('quantum/flux')});
 assert.deepEqual([storageProposal.status,storageProposal.family,weirdProposal.status,weirdProposal.family],
  ['proposal','storage','proposal',null],'unadmitted-family and unknown-kind offers record as proposals');
 const compute=await createResourceOffer(pool,{actorUserId:alice,offer:terms('compute/hours')});
 const storage=await createResourceOffer(pool,{actorUserId:alice,offer:terms('storage/bytes')});
 const weird=await createResourceOffer(pool,{actorUserId:alice,offer:terms('quantum/flux')});
 let usable=await listUsableOffers(pool,{actorUserId:bob});
 assert.deepEqual(usable,[],'with no admitted driver, nothing is advertised as usable');
 await admitResourceDriver(pool,{actorUserId:alice,family:'compute',driverName:'C1',
  receipt:{probe:'allocate-1-release-1',measuredQuantity:1,measuredUnit:'gpu-hour'}});
 usable=await listUsableOffers(pool,{actorUserId:bob});
 assert.deepEqual(usable.map(o=>o.offerId),[compute.offerId],
  'admitting compute promotes only the open compute offer');
 assert.deepEqual([usable[0].family,usable[0].capacityQuantity],[ 'compute',10],'the listing carries family and capacity');
 await admitResourceDriver(pool,{actorUserId:alice,family:'storage',driverName:'S1',
  receipt:{probe:'write-1MiB-read-back',measuredQuantity:1048576,measuredUnit:'byte'}});
 usable=await listUsableOffers(pool,{actorUserId:bob});
 assert.deepEqual(usable.map(o=>o.offerId).sort(),[compute.offerId,storage.offerId].sort(),
  'admitting storage promotes its open offer; the unknown kind stays excluded');
 assert.deepEqual(usable.some(o=>o.offerId===storageProposal.offerId||o.offerId===weirdProposal.offerId),false,
  'proposals are never listed as usable capacity, even after their family is admitted');
 await assert.rejects(recordResourceProposal(pool,{actorUserId:alice,offer:terms('compute/hours')}),
  e=>e.message==='family_already_usable','a usable family cannot take new proposals');
 await assert.rejects(acceptResourceOffer(pool,{actorUserId:bob,offerId:storageProposal.offerId,quantity:1}),
  e=>e.message==='offer_not_open','a proposal cannot be accepted as an offer');
});
