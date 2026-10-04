// FUND-12 against real PostgreSQL: contributors see confirmed, committed,
// consumed, returned and disputed amounts plus approved milestone evidence --
// as a sanitized projection of measured facts, never raw content, and never
// with estimates masquerading as measured spend.
//
// PROVEN: the report carries disjoint conservation-checked categories at
// every lifecycle point (held, settled, returned, quarantined); consumed
// equals settlement charged micro exactly while committed tracks only live
// holds under separate keys; a quarantined origin surfaces as quarantined
// micro with reconciliation required; milestone acceptance surfaces
// statement/counts/evidence-count with no raw report; the response key set is
// exact (no prompt/file/credential/lot-origin material anywhere in the JSON);
// another contributor's read is refused as not-found (private, not public).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
import {installBillingProviderFixture} from './fixtures/billing-provider-fixture.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.STRIPE_SECRET_KEY='sk_test_localfixture';process.env.STRIPE_PUBLISHABLE_KEY='pk_test_localfixture';
process.env.STRIPE_EXPECTED_ACCOUNT_ID='acct_fixture';process.env.STRIPE_EXPECTED_MODE='test';
process.env.JWT_SECRET ||= 'publication-milestone-local-fixture';
const fixture=installBillingProviderFixture();
const {handleEvent}=await import('../src/server/services/billingService.js');
const funding=await import('../src/server/services/workforceFunding.js');
const {admitRun}=await import('../src/server/services/workforceRunAdmission.js');
const ledger=await import('../src/server/utils/creditLedgerV2.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('FUND-12: contributor reporting is measured, conserved and sanitized',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`f12-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),donor=await user('donor'),other=await user('other'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:donor,customer:'cus_'+mk,
  amount_total:1500,currency:'eur',metadata:{xenoUserId:donor,credits:'15',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[donor]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'Reporting'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,beneficiary:'R Org',cancellationTerms:'Cancel.',refundTerms:'Unspent.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'12000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 const c1=await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'5000000',consentHash:offer.consentHash,confirmed:true});
 const cQ=await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'1000000',consentHash:offer.consentHash,confirmed:true});
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const budget=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'10000000',perRunMicro:'10000000',purpose:'R',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:budget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,alice]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,alice,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const admit=ceiling=>admitRun(pool,ctx(alice),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
  target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:ceiling,fundingBudgetId:budget.id}});
 const read=()=>funding.readContributorFunding(pool,ctx(donor),{contributionId:c1.id});
 const conserved=r=>{const a=r.amounts;return BigInt(a.committedMicro)+BigInt(a.consumedMicro)+BigInt(a.returnedMicro)+BigInt(a.availableMicro)+BigInt(a.expiredMicro)+BigInt(a.quarantinedMicro)===BigInt(a.confirmedMicro);};
 const AMOUNTS=['availableMicro','committedMicro','confirmedMicro','consumedMicro','expiredMicro','quarantinedMicro','returnedMicro'];

 // ── Fresh contribution: categories exact, shape sanitized, access private.
 const r0=await read();
 assert.deepEqual(r0.amounts,{confirmedMicro:'5000000',committedMicro:'0',consumedMicro:'0',returnedMicro:'0',availableMicro:'5000000',expiredMicro:'0',quarantinedMicro:'0'},
  'a fresh contribution is all available, to the micro');
 assert.ok(conserved(r0),'categories conserve on a fresh report');
 assert.deepEqual(Object.keys(r0).sort(),['amounts','asOf','campaignId','contributionId','corrections','expiredReturnedMicro','milestoneEvidence','milestoneId','reconciliationRequired','state','termsVersion'],
  'the report key set is exact: financial facts and evidence metadata only');
 assert.deepEqual(Object.keys(r0.amounts).sort(),AMOUNTS,'no spent/estimated/total key merges estimates into measured spend');
 const blob=JSON.stringify(r0).toLowerCase();
 for(const banned of ['prompt','credential','password','secret','lot_id','origin_grant','payment_intent','checkout'])
  assert.ok(!blob.includes(banned),`the sanitized projection leaks no ${banned} material`);
 assert.equal(r0.milestoneEvidence,null,'no evidence is claimed before acceptance');
 await assert.rejects(funding.readContributorFunding(pool,ctx(other),{contributionId:c1.id}),e=>e.details?.reason==='contribution_not_found',
  "another contributor cannot read this report: private facts, not a public dump");

 // ── Held, then settled: committed tracks live holds, consumed tracks measured receipts.
 const run1=await admit('2000000');
 const r1=await read();
 assert.deepEqual([r1.amounts.committedMicro,r1.amounts.availableMicro],[ '2000000','3000000'],'a live hold moves value to committed, not consumed');
 assert.ok(conserved(r1),'categories conserve under a live hold');
 const s1=await ledger.settleProjectRunV2(pool,{admissionId:run1.admission.admissionId,
  eventId:'evt-'+randomUUID().replaceAll('-',''),providerRequestId:'pr-'+randomUUID().replaceAll('-',''),
  provider:'fixture',model:'claude-opus-5',inputTokens:'100',outputTokens:'100',measured:true,allWorkTerminal:true});
 const run2=await admit('1000000');
 const r2=await read();
 assert.deepEqual([r2.amounts.consumedMicro,r2.amounts.committedMicro],[s1.chargedMicro,'1000000'],
  'after settlement the measured receipt is consumed while the second hold stays committed');
 assert.ok(conserved(r2),'categories conserve after settlement');
 const repHash=createHash('sha256').update('report-1').digest('hex');
 await pool.query(`INSERT INTO workforce_run_results(admission_id,outcome,summary,artifacts,report_hash,reported_by_user_id)
 VALUES($1,'completed','did the work','[]',$2,$3)`,[run1.admission.admissionId,repHash,alice]);
 const acc=await funding.acceptFundingMilestone(pool,ctx(approver),{operationId:randomUUID(),milestoneId:milestone.id,expectedRevision:'1',
  admissionIds:[run1.admission.admissionId],criteriaConfirmed:[true],contributorStatement:'Milestone delivered and verified.',rationale:'Evidence reviewed.'});
 assert.equal(acc.status,'accepted','the milestone accepts on completed evidence with independent review');
 const r3=await read();
 assert.deepEqual([r3.milestoneEvidence?.status,r3.milestoneEvidence?.statement,r3.milestoneEvidence?.criteriaCount,r3.milestoneEvidence?.evidenceCount],
  ['accepted','Milestone delivered and verified.',1,1],'approved milestone evidence surfaces with counts, not raw reports');
 assert.ok(conserved(r3),'categories conserve at acceptance');

 // ── Second settle, return: the full lifecycle stays conserved.
 const s2=await ledger.settleProjectRunV2(pool,{admissionId:run2.admission.admissionId,
  eventId:'evt-'+randomUUID().replaceAll('-',''),providerRequestId:'pr-'+randomUUID().replaceAll('-',''),
  provider:'fixture',model:'claude-opus-5',inputTokens:'50',outputTokens:'50',measured:true,allWorkTerminal:true});
 await funding.returnFundingContribution(pool,ctx(donor),{contributionId:c1.id});
 const r4=await read();
 const expectConsumed=String(BigInt(s1.chargedMicro)+BigInt(s2.chargedMicro));
 assert.deepEqual([r4.amounts.consumedMicro,r4.amounts.returnedMicro,r4.amounts.committedMicro,r4.state],
  [expectConsumed,String(BigInt(5000000)-BigInt(expectConsumed)),'0','returned'],
  'after return the lifecycle closes: consumed + returned = confirmed');
 assert.ok(conserved(r4),'categories conserve at the end of the lifecycle');

 // ── Quarantine surfaces as disputed residual with reconciliation required.
 const qg=(await pool.query(`SELECT l.origin_grant_id AS id,o.payment_intent FROM workforce_contribution_lots l
  JOIN credit_grant_payment_origins o ON o.grant_id=l.origin_grant_id WHERE l.contribution_id=$1 LIMIT 1`,[cQ.id])).rows[0];
 await pool.query(`INSERT INTO workforce_funding_origin_quarantine(event_id,payment_intent,grant_id,reason,liability_micro)
  VALUES($1,$2,$3,'dispute',(SELECT remaining_micro FROM credit_grants WHERE id=$3))`,['q-'+marker,qg.payment_intent,qg.id]);
 const rQ=await funding.readContributorFunding(pool,ctx(donor),{contributionId:cQ.id});
 assert.deepEqual([rQ.amounts.quarantinedMicro,rQ.amounts.availableMicro,rQ.reconciliationRequired],[ '1000000','0',true],
  'quarantined residual reports as disputed with reconciliation required, never as available');
 assert.ok(conserved(rQ),'categories conserve under quarantine');
});
