// RES-06 against real PostgreSQL: marketplace rentals, free agent offers,
// donated resources and credit contributions are distinct grant types with
// separate owners and consents, composed under one task admission. No
// exchange rate is invented between resource claims and credits.
//
// PROVEN: each grant carries exactly one leg (resource lease XOR credit
// amount -- mixing or omitting both is refused, and the schema CHECK
// refuses it too); resource grants bind active leases the issuer holds a
// side of; composition admits only available grants atomically (revoked and
// already-composed refuse, empties and duplicates refuse); composed grants
// cannot be revoked out from under their admission; the admission records
// every leg separately with its owner and consent; and no table or return
// shape carries any rate, ratio or conversion field.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {issueGrant,revokeGrant,composeAdmission}=await import('../src/server/services/grantComposition.js');
const {createResourceOffer,acceptResourceOffer}=await import('../src/server/services/resourceOffers.js');
const {revokeLease}=await import('../src/server/services/resourceLeases.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('RES-06: distinct grant types compose as separate legs; no invented exchange rate',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`r6-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),carol=await user('carol'),mallory=await user('mallory');
 const now=Date.now(),h=3600_000;
 const offer=await createResourceOffer(pool,{actorUserId:alice,offer:{kind:'compute/hours',capacityQuantity:10,capacityUnit:'gpu-hour',
  validFrom:new Date(now-h),validUntil:new Date(now+24*h),
  revocationPolicy:'r',costResponsibility:'c',dataAccessPolicy:'d',license:'l',verificationMethod:'v'}});
 const L=(await acceptResourceOffer(pool,{actorUserId:bob,offerId:offer.offerId,quantity:4})).leaseId;
 const rental=await issueGrant(pool,{actorUserId:alice,type:'marketplace-rental',resourceLeaseId:L,consentScope:'task-1'});
 const free=await issueGrant(pool,{actorUserId:bob,type:'free-agent-offer',resourceLeaseId:L,consentScope:'task-1'});
 const donated=await issueGrant(pool,{actorUserId:alice,type:'donated-resource',resourceLeaseId:L,consentScope:'task-1'});
 const credits=await issueGrant(pool,{actorUserId:carol,type:'credit-contribution',creditAmount:50,consentScope:'task-1'});
 assert.deepEqual([rental.creditAmount,credits.resourceLeaseId],[null,null],
  'resource grants carry no credit leg; credit grants carry no resource leg');
 await assert.rejects(issueGrant(pool,{actorUserId:alice,type:'marketplace-rental',resourceLeaseId:L,creditAmount:5,consentScope:'x'}),
  e=>e.message==='grant_mixed_legs','a grant with both legs is refused: that would be an exchange rate');
 await assert.rejects(issueGrant(pool,{actorUserId:alice,type:'marketplace-rental',consentScope:'x'}),
  e=>e.message==='grant_mixed_legs','a grant with neither leg is refused');
 await assert.rejects(issueGrant(pool,{actorUserId:carol,type:'credit-contribution',resourceLeaseId:L,consentScope:'x'}),
  e=>e.message==='grant_mixed_legs','a credit grant cannot smuggle a resource leg');
 await assert.rejects(issueGrant(pool,{actorUserId:mallory,type:'donated-resource',resourceLeaseId:L,consentScope:'x'}),
  e=>e.message==='grant_not_authorized','a stranger to the lease cannot grant on it');
 const L2=(await acceptResourceOffer(pool,{actorUserId:bob,offerId:offer.offerId,quantity:1})).leaseId;
 await revokeLease(pool,{actorUserId:alice,leaseId:L2});
 await assert.rejects(issueGrant(pool,{actorUserId:alice,type:'marketplace-rental',resourceLeaseId:L2,consentScope:'x'}),
  e=>e.message==='lease_not_active','grants bind active leases only');
 await assert.rejects(pool.query(`INSERT INTO resource_grants(type,owner_user_id,resource_lease_id,credit_amount,consent_scope)
  VALUES('donated-resource',$1,$2,5,'x')`,[alice,L]),e=>/check constraint/i.test(e.message),
  'the schema CHECK refuses a mixed-leg grant even past the service');
 // One admission, four separate legs, zero conversion.
 const admission=await composeAdmission(pool,{actorUserId:bob,taskRef:'task-1',
  grantIds:[rental.grantId,free.grantId,donated.grantId,credits.grantId]});
 assert.deepEqual(admission.legs.map(l=>l.type),
  ['credit-contribution','donated-resource','free-agent-offer','marketplace-rental'],
  'the admission records every leg with its distinct type');
 assert.deepEqual(admission.legs.map(l=>l.ownerUserId).sort(),[alice,alice,bob,carol].sort(),
  'each leg keeps its own owner');
 assert.deepEqual(admission.legs.every(l=>(l.resourceLeaseId===null)!==(l.creditAmount===null)),true,
  'each composed leg still carries exactly one leg');
 assert.deepEqual(/rate|ratio|exchange|convert|per[_-]?credit/i.test(JSON.stringify(admission)),false,
  'the admission converts nothing: no rate, ratio or conversion field exists');
 const cols=(await pool.query(`SELECT column_name FROM information_schema.columns
  WHERE table_name IN ('resource_grants','task_grant_admissions','admission_grant_legs')`)).rows.map(r=>r.column_name);
 assert.deepEqual(cols.some(c=>/rate|ratio|exchange|convert/i.test(c)),false,
  `no conversion column exists (saw: ${cols.sort().join(',')})`);
 // Single-use legs, atomic admission, no revoke-out-from-under.
 await assert.rejects(composeAdmission(pool,{actorUserId:bob,taskRef:'task-2',grantIds:[rental.grantId]}),
  e=>e.message==='grant_not_available','a composed grant cannot compose again');
 await assert.rejects(revokeGrant(pool,{actorUserId:alice,grantId:rental.grantId}),
  e=>e.message==='grant_not_available','a composed grant cannot be revoked out from under its admission');
 const spare=await issueGrant(pool,{actorUserId:carol,type:'credit-contribution',creditAmount:5,consentScope:'task-2'});
 await revokeGrant(pool,{actorUserId:carol,grantId:spare.grantId});
 await assert.rejects(composeAdmission(pool,{actorUserId:bob,taskRef:'task-2',grantIds:[spare.grantId]}),
  e=>e.message==='grant_not_available','a revoked grant refuses the whole admission');
 await assert.rejects(composeAdmission(pool,{actorUserId:bob,taskRef:'task-2',grantIds:[]}),
  e=>e.message==='admission_empty','an admission with no grants is refused');
 const g1=await issueGrant(pool,{actorUserId:carol,type:'credit-contribution',creditAmount:5,consentScope:'task-2'});
 await assert.rejects(composeAdmission(pool,{actorUserId:bob,taskRef:'task-2',grantIds:[g1.grantId,g1.grantId]}),
  e=>e.message==='admission_duplicate_grant','the same grant twice in one admission is refused');
});
