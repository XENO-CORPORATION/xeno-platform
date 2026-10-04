// FUND-14 against real PostgreSQL: funding is milestone-gated, per milestone, in declared order.
//
// PROVEN: a milestone cannot exist without acceptance criteria or with a maximum below its
// threshold; a campaign cannot open with no milestones and cannot gain one after opening;
// a draft campaign cannot receive contributions; contributions accumulate below the threshold;
// dispatch is refused below the threshold despite an approved budget; a funded milestone
// dispatches while its sibling stays gated (not all-or-nothing for the project); topping the
// gated sibling to its threshold opens dispatch there too.
// SIBLING: workforce-funded-admission.test.mjs proves the single-milestone funding mechanics
// (exact lots, HTTP refusal shape, settlement, quarantine) without citing a requirement;
// this file cites the gating contract it left unclaimed.
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
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('FUND-14: each milestone declares its terms before money moves; dispatch follows its own gate',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`f14-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),planner=await user('planner'),approver=await user('approver'),contributor=await user('contributor');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(owner),name:'Gated milestones'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,owner]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,owner,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const campaign=await funding.createFundingCampaign(pool,ctx(owner),{operationId:randomUUID(),projectId:project.id,beneficiary:'Delivery',cancellationTerms:'Cancel unused work.',refundTerms:'Return with original expiry.',deliverableLicense:'MIT'});

 // ── Declaration comes first, and it is validated: no criteria, no milestone; no
 // milestones, no opening; no opening, no contributions; no late milestones either.
 const milestone=(campaignId,over={})=>funding.createFundingMilestone(pool,ctx(owner),{campaignId,key:'first',title:'First',criteria:['Tests'],thresholdMicro:'2000000',budgetMaxMicro:'4000000',...over});
 await assert.rejects(milestone(campaign.id,{key:'empty',criteria:[]}),e=>e.details?.reason==='invalid_milestone','a milestone without acceptance criteria is not declared');
 await assert.rejects(milestone(campaign.id,{key:'inverted',thresholdMicro:'4000000',budgetMaxMicro:'1000000'}),e=>e.details?.reason==='invalid_milestone','a maximum below the threshold is not declared');
 const empty=await funding.createFundingCampaign(pool,ctx(owner),{operationId:randomUUID(),projectId:project.id,beneficiary:'Empty',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
 await assert.rejects(funding.openFundingCampaign(pool,ctx(owner),{campaignId:empty.id}),e=>e.details?.reason==='campaign_requires_milestone','a campaign with no milestones cannot open');
 await assert.rejects(funding.contributeFunding(pool,ctx(contributor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:randomUUID(),amountMicro:'100',consentHash:'0'.repeat(64),confirmed:true}),
  e=>e.details?.reason==='campaign_not_found','a draft campaign cannot receive contributions');
 const m1=await milestone(campaign.id);
 const m2=await milestone(campaign.id,{key:'small',title:'Small',criteria:['Review'],thresholdMicro:'100000',budgetMaxMicro:'1000000'});
 await funding.openFundingCampaign(pool,ctx(owner),{campaignId:campaign.id});
 await assert.rejects(milestone(campaign.id,{key:'late'}),e=>e.details?.reason==='campaign_terms_locked','terms lock at opening: no late milestones');
 const declared=(await pool.query('SELECT threshold_micro, budget_max_micro, acceptance_criteria FROM workforce_funding_milestones WHERE id=$1',[m1.id])).rows[0];
 assert.deepEqual([String(declared.threshold_micro),String(declared.budget_max_micro),declared.acceptance_criteria.items],
  ['2000000','4000000',['Tests']],'threshold, maximum and criteria stand declared before any contribution');

 // ── Contributions accumulate immediately, below the threshold; dispatch does not follow.
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:contributor,customer:'cus_'+mk,
 amount_total:500,currency:'eur',metadata:{xenoUserId:contributor,credits:'5',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET enabled=true',[contributor]);
 const offer1=await funding.readFundingOffer(pool,ctx(contributor),{campaignId:campaign.id,milestoneId:m1.id});
 const offer2=await funding.readFundingOffer(pool,ctx(contributor),{campaignId:campaign.id,milestoneId:m2.id});
 const contribute=(milestoneId,amountMicro,consentHash)=>funding.contributeFunding(pool,ctx(contributor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId,amountMicro,consentHash,confirmed:true});
 assert.equal((await contribute(m1.id,'1000000',offer1.consentHash)).state,'confirmed','a below-threshold contribution is accepted immediately');
 const p1=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[m1.id])).rows[0];
 const p2=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[m2.id])).rows[0];
 const budget=async(poolId,spenderMax,perRun,purpose,consentHash,plannerCtx=ctx(planner))=>{
  const price=await funding.readFundingPrice(pool,plannerCtx,{poolId,model:'claude-opus-5'});
  const b=await funding.proposeFundingBudget(pool,plannerCtx,{operationId:randomUUID(),poolId,spenderUserId:owner,maximumMicro:spenderMax,perRunMicro:perRun,purpose,termsHash:consentHash,...price});
  await funding.decideFundingBudget(pool,ctx(approver),{budgetId:b.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
  return b;
 };
 const b1=await budget(p1.id,'4000000','2000000','First milestone',offer1.consentHash);
 const request=(amount,budgetId)=>({operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
 target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:amount,fundingBudgetId:budgetId}});
 await assert.rejects(admitRun(pool,ctx(owner),request('1000000',b1.id)),
  e=>e.details?.reason==='milestone_threshold_unmet','an approved budget cannot dispatch below its milestone threshold');

 // ── Not all-or-nothing: the funded sibling dispatches while the first stays gated.
 await contribute(m2.id,'1000000',offer2.consentHash);
 const b2=await budget(p2.id,'1000000','500000','Small milestone',offer2.consentHash);
 const small=await admitRun(pool,ctx(owner),request('500000',b2.id));
 assert.equal(small.admission.payer.kind,'project_pool','the funded milestone dispatches');
 await assert.rejects(admitRun(pool,ctx(owner),request('1000000',b1.id)),
  e=>e.details?.reason==='milestone_threshold_unmet','the unfunded sibling stays gated by its own threshold');
 await contribute(m1.id,'1000000',offer1.consentHash);
 const first=await admitRun(pool,ctx(owner),request('1000000',b1.id));
 assert.equal(first.admission.payer.kind,'project_pool','topping the threshold opens dispatch there too');
});
