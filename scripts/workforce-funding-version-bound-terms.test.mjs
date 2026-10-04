// FUND-18 against real PostgreSQL: milestone terms, threshold, budget
// purpose and the price-consent envelope are version-bound; nothing retargets
// existing contributions without renewed consent; returned, expired and
// quarantined value never funds a new admission; expiry is an explicit
// accounting category that gifts and returns never reset; and campaigns
// cannot be created silent on cancellation/refund terms.
//
// PROVEN: campaign terms and milestone thresholds are trigger-immutable (no
// retarget path exists); a budget carrying a tampered terms hash is refused
// at decision while the honest budget dispatches; a returned contribution
// leaves no admittable value; time-aged lots are excluded from admission,
// report under expiredMicro, return as expired-only with zero balance revival
// and unchanged expiry; empty cancellation/refund terms and empty acceptance
// criteria are refused at creation (terms must speak before acceptance).
// SIBLING: FUND-03 proves the consent binding; this file cites the
// version-change and expiry clauses on top.
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
const runfunding=await import('../src/server/services/workforceRunFunding.js');
const {admitRun}=await import('../src/server/services/workforceRunAdmission.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('FUND-18: version-bound terms; no retarget; expiry explicit and never reset',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`f18-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),donor=await user('donor'),donor2=await user('donor2'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const fund=async who=>{const mk=randomUUID().replaceAll('-','');
  const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:who,customer:'cus_'+mk,
  amount_total:1500,currency:'eur',metadata:{xenoUserId:who,credits:'15',kind:'credits'}};
  await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});};
 await fund(donor);await fund(donor2);
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true),($2,true)',[donor,donor2]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'VersionBound'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const TERMS={beneficiary:'V Org',cancellationTerms:'Cancel before dispatch; undelivered work returns unspent value.',refundTerms:'Unspent eligible value returns; value expires per its lot schedule.',deliverableLicense:'MIT'};
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,...TERMS});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'12000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 const c1=await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'5000000',consentHash:offer.consentHash,confirmed:true});
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const budget=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'10000000',perRunMicro:'10000000',purpose:'V',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:budget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,alice]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,alice,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const admit=(ceiling,budgetId)=>admitRun(pool,ctx(alice),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
  target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:ceiling,fundingBudgetId:budgetId}});

 // ── Terms are immutable: no retarget path exists, at any layer.
 await assert.rejects(pool.query('UPDATE workforce_funding_campaigns SET beneficiary=$2 WHERE id=$1',[campaign.id,'X']),e=>e.code==='23514',
  'campaign terms cannot be rewritten after creation');
 await assert.rejects(pool.query('UPDATE workforce_funding_campaigns SET terms_version=2 WHERE id=$1',[campaign.id]),e=>e.code==='23514',
  'the terms version cannot be bumped under existing contributions');
 await assert.rejects(pool.query('UPDATE workforce_funding_milestones SET threshold_micro=1 WHERE id=$1',[milestone.id]),e=>e.code==='23514',
  'milestone thresholds cannot be rewritten after creation');

 // ── A drifted terms binding is refused at admission; the honest one dispatches.
 const run0=await admit('1000000',budget.id);
 assert.equal(run0.admission.payer.kind,'project_pool','control: the honestly-bound budget dispatches');
 const campaignB=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,...TERMS});
 const milestoneB=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaignB.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'12000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaignB.id});
 const offerB=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaignB.id,milestoneId:milestoneB.id});
 const pB=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestoneB.id])).rows[0];
 await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaignB.id,milestoneId:milestoneB.id,amountMicro:'5000000',consentHash:offerB.consentHash,confirmed:true});
 const snap=(await pool.query('SELECT price_snapshot,price_version FROM workforce_funding_budgets WHERE id=$1',[budget.id])).rows[0];
 const tampered='0'.repeat(63)+'1';
 const tb=(await pool.query(`INSERT INTO workforce_funding_budgets(pool_id,proposed_by_user_id,spender_user_id,client_id,operation_id,request_hash,terms_hash,maximum_micro,per_run_micro,purpose,price_version,price_snapshot)
  VALUES($1,$2,$3,'xeno-agent-interface',$4,$5,$6,10000000,10000000,'Tampered',$7,$8) RETURNING id`,
  [pB.id,planner,alice,randomUUID(),createHash('sha256').update('tamper').digest('hex'),tampered,snap.price_version,JSON.stringify(snap.price_snapshot)])).rows[0];
 await assert.rejects(funding.decideFundingBudget(pool,ctx(approver),{budgetId:tb.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'}),e=>e.code==='conflict'&&e.details?.reason==='funding_terms_changed',
  'a budget whose terms binding drifted cannot be approved: existing restrictions stay enforceable');
 // HONEST NOTE: the admission-time recheck (resolveRunFunding) is backstop-only.
 // Drift approved cannot be constructed: decide gates terms_hash, the budget
 // trigger freezes it afterwards, and campaign terms are immutable -- so the
 // recheck can only fire on data no API path produces. The live gate above is
 // what this file executes.

 // ── Returned value cannot fund a new admission.
 await runfunding.releaseUndispatchedFunding(pool,{actorUserId:alice,clientId:'xeno-agent-interface'},{admissionId:run0.admission.admissionId});
 await funding.returnFundingContribution(pool,ctx(donor),{contributionId:c1.id});
 await assert.rejects(admit('1000000',budget.id),e=>e.code==='needs_approval'&&e.details?.reason==='milestone_threshold_unmet',
  'after return no eligible value remains: returned lots fund nothing');

 // ── Expired value is excluded, categorized, and never reset by return.
 const og=(await pool.query('SELECT id FROM credit_grants WHERE user_id=$1',[donor2])).rows[0];
 await pool.query("UPDATE credit_grants SET expires_at=now()+interval '2 seconds' WHERE id=$1",[og.id]);
 const cExp=await funding.contributeFunding(pool,ctx(donor2),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'2000000',consentHash:offer.consentHash,confirmed:true});
 const poolExp=(await pool.query('SELECT expires_at>now() AS future FROM credit_grants g JOIN workforce_contribution_lots l ON l.pool_grant_id=g.id WHERE l.contribution_id=$1 LIMIT 1',[cExp.id])).rows[0].future;
 assert.equal(poolExp,true,'pool lots inherit the origin expiry at fund time');
 const expiry0=(await pool.query('SELECT expires_at::text AS e FROM credit_grants WHERE id=$1',[og.id])).rows[0].e;
 await new Promise(r=>setTimeout(r,5000));
 assert.equal((await pool.query('SELECT expires_at<now() AS past FROM credit_grants WHERE id=$1',[og.id])).rows[0].past,true,
  'precondition: the recorded instant has now elapsed in real time (no row was rewritten)');
 await assert.rejects(admit('1000000',budget.id),e=>e.code==='needs_approval'&&e.details?.reason==='milestone_threshold_unmet',
  'time-aged lots are excluded from admission: expired value funds nothing');
 const rExp=await funding.readContributorFunding(pool,ctx(donor2),{contributionId:cExp.id});
 assert.deepEqual([rExp.amounts.expiredMicro,rExp.amounts.availableMicro],[ '2000000','0'],
  'expired residual reports under its explicit category, never as available');
 const balBefore=await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[donor2]).then(r=>r.rows[0].b);
 const retExp=await funding.returnFundingContribution(pool,ctx(donor2),{contributionId:cExp.id});
 assert.deepEqual([retExp.amountMicro,retExp.expiredMicro],[ '2000000','2000000'],'the return accounts the expired whole as expired');
 assert.equal(await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[donor2]).then(r=>r.rows[0].b),balBefore,
  'expired value is retained as lineage, never revived into the spendable balance');
 assert.equal((await pool.query('SELECT expires_at::text AS e FROM credit_grants WHERE id=$1',[og.id])).rows[0].e,expiry0,
  'the origin expiry survives the return byte-for-byte: no automatic reset');

 // ── Terms must speak before acceptance: silence is refused at creation.
 await assert.rejects(funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,...TERMS,cancellationTerms:''}),e=>e.details?.reason==='invalid_text',
  'a campaign silent on cancellation cannot be created');
 await assert.rejects(funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,...TERMS,refundTerms:'   '}),e=>e.details?.reason==='invalid_text',
  'a campaign silent on refunds cannot be created');
 await assert.rejects(funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'bad',title:'Bad',criteria:[],thresholdMicro:'1000000',budgetMaxMicro:'10000000'}),e=>e.details?.reason==='invalid_milestone',
  'a milestone without acceptance criteria cannot be created');
});
