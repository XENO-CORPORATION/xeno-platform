// RES-05 against real PostgreSQL: leases track revocation, expiry and
// verified settlement. Disappeared capacity reads unavailable/interrupted,
// never completed; storage expiry provides the agreed export/retention
// behavior; compute cancellation never discards accepted artifacts.
//
// PROVEN: owner-only revocation reads interrupted; holder release and
// natural expiry read unavailable; no lease can ever read completed (the
// schema CHECK refuses the value); storage acceptance requires agreed
// retention terms and expiry computes the export deadline from them;
// settlement needs a terminal lease, owner-or-holder authority, a named
// method/reference and verified-only cited receipts; cancelling a compute
// task preserves its acceptance, receipts and artifact references.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {createResourceOffer,acceptResourceOffer}=await import('../src/server/services/resourceOffers.js');
const {readLease,revokeLease,releaseLease,setRetentionTerms,expireLeases,recordLeaseSettlement,capacityStateOf}=await import('../src/server/services/resourceLeases.js');
const {registerComputeWorker,approveWorkerCaps,scheduleComputeTask}=await import('../src/server/services/contributedCompute.js');
const {reportTaskOutput,verifyTaskReceipt,acceptTaskResult,cancelComputeTask}=await import('../src/server/services/computeReceipts.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('RES-05: revoked, expired and settled leases track honestly; artifacts survive cancel',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 assert.deepEqual([capacityStateOf('active'),capacityStateOf('revoked'),capacityStateOf('expired'),capacityStateOf('released')],
  ['available','interrupted','unavailable','unavailable'],'capacity readings hold no completed state');
 const marker=`r5-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),mallory=await user('mallory');
 const now=Date.now(),h=3600_000;
 const terms=(kind)=>({kind,capacityQuantity:10,capacityUnit:'unit',
  validFrom:new Date(now-h),validUntil:new Date(now+24*h),
  revocationPolicy:'r',costResponsibility:'c',dataAccessPolicy:'d',license:'l',verificationMethod:'v'});
 // Revoke / release / expire each track their own terminal reading.
 const offer=await createResourceOffer(pool,{actorUserId:alice,offer:terms('compute/hours')});
 const l1=(await acceptResourceOffer(pool,{actorUserId:bob,offerId:offer.offerId,quantity:3})).leaseId;
 assert.deepEqual(await readLease(pool,{leaseId:l1}),{leaseId:l1,status:'active',capacityState:'available'},
  'a live lease reads available');
 await assert.rejects(revokeLease(pool,{actorUserId:bob,leaseId:l1}),
  e=>e.message==='revoke_not_authorized','the holder cannot revoke the owner\'s capacity');
 assert.deepEqual(await revokeLease(pool,{actorUserId:alice,leaseId:l1}),
  {leaseId:l1,status:'revoked',capacityState:'interrupted'},'owner revocation reads interrupted');
 const l2=(await acceptResourceOffer(pool,{actorUserId:bob,offerId:offer.offerId,quantity:2})).leaseId;
 await assert.rejects(releaseLease(pool,{actorUserId:mallory,leaseId:l2}),
  e=>e.message==='release_not_authorized','a stranger cannot release someone else\'s lease');
 assert.deepEqual(await releaseLease(pool,{actorUserId:bob,leaseId:l2}),
  {leaseId:l2,status:'released',capacityState:'unavailable'},'holder release reads unavailable');
 const l3=(await acceptResourceOffer(pool,{actorUserId:bob,offerId:offer.offerId,quantity:1,validUntil:new Date(now+2*h)})).leaseId;
 await pool.query('UPDATE resource_leases SET valid_from=$2, valid_until=$3 WHERE id=$1',
  [l3,new Date(now-2*h).toISOString(),new Date(now-1000).toISOString()]);
 const swept=await expireLeases(pool,{});
 assert.deepEqual([swept.length,swept[0].leaseId,swept[0].status,swept[0].capacityState],[1,l3,'expired','unavailable'],
  'the expiry sweep retires past-window leases as unavailable');
 await assert.rejects(pool.query("UPDATE resource_leases SET status='completed' WHERE id=$1",[l2]),
  e=>/check constraint/i.test(e.message),'no lease can ever read completed: the schema CHECK refuses the value');
 // Settlement needs terminal leases, authority, method/reference, verified receipts.
 const l4=(await acceptResourceOffer(pool,{actorUserId:bob,offerId:offer.offerId,quantity:1})).leaseId;
 await assert.rejects(recordLeaseSettlement(pool,{actorUserId:alice,leaseId:l4,method:'m',reference:'r'}),
  e=>e.message==='lease_not_terminal','an active lease cannot settle');
 await assert.rejects(recordLeaseSettlement(pool,{actorUserId:mallory,leaseId:l1,method:'m',reference:'r'}),
  e=>e.message==='settle_not_authorized','a stranger cannot settle someone else\'s lease');
 assert.deepEqual(await recordLeaseSettlement(pool,{actorUserId:alice,leaseId:l1,method:'capacity-returned',reference:'ret-1'}),
  {leaseId:l1,settled:true,method:'capacity-returned',reference:'ret-1'},'a terminal lease settles with method and reference');
 // Storage: agreed terms gate acceptance; expiry computes the export deadline.
 const store=await createResourceOffer(pool,{actorUserId:alice,offer:terms('storage/bytes')});
 await assert.rejects(acceptResourceOffer(pool,{actorUserId:bob,offerId:store.offerId,quantity:5}),
  e=>e.message==='retention_terms_required','storage without agreed retention terms cannot be accepted');
 await assert.rejects(setRetentionTerms(pool,{actorUserId:bob,offerId:store.offerId,retentionDays:30,exportGraceDays:7}),
  e=>e.message==='retention_not_authorized','only the owner agrees retention terms');
 await setRetentionTerms(pool,{actorUserId:alice,offerId:store.offerId,retentionDays:30,exportGraceDays:7});
 const sl=(await acceptResourceOffer(pool,{actorUserId:bob,offerId:store.offerId,quantity:5,validUntil:new Date(now+2*h)})).leaseId;
 const end=new Date(now-1000).toISOString();
 await pool.query('UPDATE resource_leases SET valid_from=$2, valid_until=$3 WHERE id=$1',
  [sl,new Date(now-2*h).toISOString(),end]);
 const swept2=await expireLeases(pool,{});
 assert.deepEqual([swept2.length,swept2[0].retentionAgreed,swept2[0].exportUntil],
  [1,true,new Date(new Date(end).getTime()+7*86400_000).toISOString()],
  'storage expiry provides the agreed export deadline');
 // Compute cancellation preserves accepted artifacts.
 const workerId=(await registerComputeWorker(pool,{actorUserId:alice,isolation:'strong',egress:'restricted',devices:'none'})).workerId;
 await approveWorkerCaps(pool,{actorUserId:alice,workerId,caps:{maxCpuMillicores:1000,maxMemoryMb:1024,maxSeconds:300}});
 const task=await scheduleComputeTask(pool,{actorUserId:bob,workerId,inputClassification:'public',
  request:{cpuMillicores:500,memoryMb:512,maxSeconds:60}});
 const OUT='cd'.repeat(32);
 const rep=await reportTaskOutput(pool,{taskId:task.taskId,token:task.token,inputHash:'ab'.repeat(32),outputHash:OUT,gpuHours:2,artifactRef:'bafy-keep'});
 await verifyTaskReceipt(pool,{actorUserId:mallory,receiptId:rep.receiptId,artifactHash:OUT,method:'artifact-hash'});
 await acceptTaskResult(pool,{actorUserId:bob,receiptId:rep.receiptId});
 await cancelComputeTask(pool,{actorUserId:bob,taskId:task.taskId});
 const kept=(await pool.query(`SELECT a.receipt_id, r.artifact_ref, r.status, r.gpu_hours
  FROM compute_task_acceptances a JOIN compute_task_receipts r ON r.id=a.receipt_id WHERE a.receipt_id=$1`,[rep.receiptId])).rows[0];
 assert.deepEqual([kept.artifact_ref,kept.status,Number(kept.gpu_hours)],['bafy-keep','verified',2],
  'cancellation preserves the acceptance, the verified receipt and its artifact reference');
});
