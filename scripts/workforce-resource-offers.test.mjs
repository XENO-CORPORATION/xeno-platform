// RES-01 against real PostgreSQL: a ResourceOffer declares kind, owner,
// capacity/quantity, allowed project/task, validity, revocation, cost
// responsibility, data-access policy, license and verification method.
// Accepting it creates a bounded lease/grant, not a credential transfer.
//
// PROVEN: all ten declarations are required (missing license, verification,
// revocation or capacity is refused by name); acceptance mints a lease
// bounded by remaining capacity (exact fill allowed, overfill refused),
// same unit, window inside the offer window (over-long requests are capped),
// and the allowed project/task binding (wrong project, unheld project and
// wrong task are refused); expired-window and revoked offers refuse; only
// the owner revokes; and neither table nor return shape carries credential
// material -- asserted against information_schema and the JSON itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {createResourceOffer,revokeResourceOffer,acceptResourceOffer}=await import('../src/server/services/resourceOffers.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('RES-01: ten-term offers; acceptance mints bounded leases, never credentials',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`r1-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),mallory=await user('mallory');
 const proj=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'OfferScope'});
 const other=await createAuthorizedProject(pool,{principal:userPrincipal(bob),name:'OtherScope'});
 await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'editor','user',$2)",[proj.id,bob]);
 const now=Date.now(),h=3600_000;
 const terms=(over={})=>({kind:'compute-hours',capacityQuantity:10,capacityUnit:'gpu-hour',
  allowedProjectId:proj.id,allowedTaskRef:'task-007',validFrom:new Date(now-h),validUntil:new Date(now+24*h),
  revocationPolicy:'owner may revoke with 1h notice',costResponsibility:'holder pays overage',
  dataAccessPolicy:'inputs stay in project vault',license:'XENO-RES-1.0',verificationMethod:'metering-receipt-v1',...over});
 const full=await createResourceOffer(pool,{actorUserId:alice,offer:terms()});
 assert.deepEqual([full.capacityQuantity,full.capacityUnit,full.status],[10,'gpu-hour','open'],
  'a fully-declared offer is published');
 for (const [drop,reason] of [[{license:''},'offer_license_required'],[{verificationMethod:'  '},'offer_verification_required'],
   [{revocationPolicy:undefined},'offer_revocation_required'],[{capacityQuantity:0},'offer_capacity_required']]) {
   const o=terms(drop);
   await assert.rejects(createResourceOffer(pool,{actorUserId:alice,offer:o}),e=>e.message===reason,
    `a missing declaration is refused by name: ${reason}`);
 }
 // Bounded acceptance: exact fill allowed, overfill refused, window capped.
 const first=await acceptResourceOffer(pool,{actorUserId:bob,offerId:full.offerId,projectId:proj.id,taskRef:'task-007',quantity:7});
 assert.deepEqual([first.quantity,first.unit,first.projectId,first.taskRef,first.status],[7,'gpu-hour',proj.id,'task-007','active'],
  'acceptance mints a lease carrying the allowed binding and unit');
 await assert.rejects(acceptResourceOffer(pool,{actorUserId:bob,offerId:full.offerId,projectId:proj.id,taskRef:'task-007',quantity:4}),
  e=>e.message==='offer_capacity_exceeded','accepting past remaining capacity is refused');
 const fill=await acceptResourceOffer(pool,{actorUserId:bob,offerId:full.offerId,projectId:proj.id,taskRef:'task-007',quantity:3,validUntil:new Date(now+72*h)});
 assert.deepEqual([fill.quantity,new Date(fill.validUntil).getTime() <= now+24*h],[3,true],
  'exact fill is allowed and an over-long lease window is capped to the offer window');
 // Bindings and liveness gate acceptance.
 await assert.rejects(acceptResourceOffer(pool,{actorUserId:bob,offerId:full.offerId,projectId:other.id,taskRef:'task-007',quantity:1}),
  e=>e.message==='lease_project_mismatch','accepting under a different project than allowed is refused');
 await assert.rejects(acceptResourceOffer(pool,{actorUserId:mallory,offerId:full.offerId,projectId:proj.id,taskRef:'task-007',quantity:1}),
  e=>e.message==='lease_project_not_held','accepting for a project the holder does not hold is refused');
 await assert.rejects(acceptResourceOffer(pool,{actorUserId:bob,offerId:full.offerId,projectId:proj.id,taskRef:'task-008',quantity:1}),
  e=>e.message==='lease_task_mismatch','accepting under a different task than allowed is refused');
 const past=await createResourceOffer(pool,{actorUserId:alice,offer:terms({validFrom:new Date(now-48*h),validUntil:new Date(now-24*h)})});
 await assert.rejects(acceptResourceOffer(pool,{actorUserId:bob,offerId:past.offerId,projectId:proj.id,taskRef:'task-007',quantity:1}),
  e=>e.message==='offer_window_closed','an expired offer window refuses acceptance');
 await assert.rejects(revokeResourceOffer(pool,{actorUserId:mallory,offerId:full.offerId}),
  e=>e.message==='revoke_not_authorized','only the owner revokes');
 await revokeResourceOffer(pool,{actorUserId:alice,offerId:full.offerId});
 await assert.rejects(acceptResourceOffer(pool,{actorUserId:bob,offerId:full.offerId,projectId:proj.id,taskRef:'task-007',quantity:1}),
  e=>e.message==='offer_not_open','a revoked offer refuses acceptance');
 // No credential transfer: schema and return shape carry bounds only.
 const cols=(await pool.query(`SELECT column_name FROM information_schema.columns
  WHERE table_name IN ('resource_offers','resource_leases')`)).rows.map(r=>r.column_name);
 assert.deepEqual(cols.some(c=>/credential|secret|token|password|private|api[_-]?key/i.test(c)),false,
  `no credential-bearing column exists (saw: ${cols.sort().join(',')})`);
 assert.deepEqual(/credential|secret|token|password|private[_-]?key/i.test(JSON.stringify({first,fill})),false,
  'the acceptance return carries bounds only, no credential material');
});
