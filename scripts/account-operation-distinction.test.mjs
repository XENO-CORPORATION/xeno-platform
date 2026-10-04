// ACCT-02 against real PostgreSQL: gift, contribute and budget allocation are three
// distinct operations with distinct effects, and none of them moves anything but credits.
//
// PROVEN: one composed flow performs all three -- a gift changes the beneficiary (bob owns
// it outright), a contribution restricts value to a project milestone under accepted terms
// (the pool owns it, terms-bound), a budget allocation earmarks without transferring
// (a hold exists, both balances unchanged, no lots minted). Draft campaigns cannot receive,
// unapproved budgets cannot dispatch, tampered gift consent cannot commit. Every operation
// rejects API keys, provider subscriptions and guaranteed token counts as unexpected fields.
// HONEST SCOPE: no UI automation harness exists in this repository, so "UI/API" is proven
// at the typed API the UI calls -- the same services, shapes and errors the client sees.
// SIBLINGS: account-gift-transfer/return (gift mechanics), workforce-funded-admission
// (contribution mechanics), workforce-funding-roles/agent-spend (budget mechanics).
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
const gifts=await import('../src/server/services/accountGifts.js');
const funding=await import('../src/server/services/workforceFunding.js');
const {admitRun}=await import('../src/server/services/workforceRunAdmission.js');
const ledger=await import('../src/server/utils/creditLedgerV2.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('ACCT-02: gift, contribute and budget allocation differ in effect; only credits move',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`a2-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:alice,customer:'cus_'+mk,
 amount_total:500,currency:'eur',metadata:{xenoUserId:alice,credits:'5',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[alice]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'Distinction'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,alice]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,alice,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,beneficiary:'Delivery',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'4000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 const balance=async userId=>(await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1',[userId])).rows[0]?.balance ?? '0';

 // ── Op 1, GIFT: the beneficiary changes. Bob owns it outright, spendable as his own.
 const pv=await gifts.previewGift(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000'});
 const g1=await gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000',operationId:randomUUID(),consentHash:pv.consentHash,confirmed:true});
 assert.equal(await balance(bob),'1000000','gift: bob owns the value');
 assert.equal((await pool.query("SELECT user_id FROM credit_grants WHERE source_ref LIKE 'gift:%' AND user_id=$1 LIMIT 1",[bob])).rows[0]?.user_id,bob,
  'gift: the lots sit on the new beneficiary');
 await assert.rejects(gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'100',operationId:randomUUID(),consentHash:'e'.repeat(64),confirmed:true,apiKey:'sk-live-xxx'}),
  e=>e.details?.reason==='unexpected_field','a gift carries no API key');
 await assert.rejects(gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'100',operationId:randomUUID(),consentHash:'e'.repeat(64),confirmed:true}),
  e=>e.details?.reason==='gift_terms_changed','a tampered gift consent cannot commit');
 await assert.rejects(gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'100',operationId:randomUUID(),consentHash:pv.consentHash,confirmed:true,guaranteedTokens:1000}),
  e=>e.details?.reason==='unexpected_field','a gift carries no guaranteed token count');

 // ── Op 2, CONTRIBUTE: value restricts to the milestone under accepted terms. The pool --
 // neither alice nor bob -- owns it, and draft campaigns cannot receive at all.
 const draft=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,beneficiary:'Draft',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
 await assert.rejects(funding.contributeFunding(pool,ctx(alice),{operationId:randomUUID(),campaignId:draft.id,milestoneId:randomUUID(),amountMicro:'100',consentHash:'0'.repeat(64),confirmed:true}),
  e=>e.details?.reason==='campaign_not_found','draft campaigns cannot receive');
 const c1=await funding.contributeFunding(pool,ctx(alice),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'2000000',consentHash:offer.consentHash,confirmed:true});
 assert.equal(c1.state,'confirmed','contribution accepted under the offered terms');
 assert.equal(await balance(p.id),'2000000','contribute: the pool owns the value');
 assert.equal((await pool.query('SELECT count(*)::int n FROM credit_grants WHERE user_id=$1 AND kind=$2',[p.id,'contribution'])).rows[0].n>0,true,
  'contribute: the lots are pool-restricted, not beneficiary value');
 await assert.rejects(funding.contributeFunding(pool,ctx(alice),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'100',consentHash:offer.consentHash,confirmed:true,subscriptionId:'sub_123'}),
  e=>e.details?.reason==='invalid_shape','a contribution carries no provider subscription');

 // ── Op 3, BUDGET ALLOCATION: earmarked, not transferred. A hold exists; both balances
 // stand still; no lots are minted; ownership is untouched.
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const unapproved=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'4000000',perRunMicro:'2000000',purpose:'Unapproved',termsHash:offer.consentHash,...price});
 const request=(amount,budgetId)=>({operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
 target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:amount,fundingBudgetId:budgetId}});
 await assert.rejects(admitRun(pool,ctx(alice),request('1000000',unapproved.id)),
  e=>e.details?.reason==='funding_budget_unavailable','an unapproved budget cannot dispatch');
 const proposal=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'4000000',perRunMicro:'2000000',purpose:'Earmark',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:proposal.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const lotsBefore=(await pool.query('SELECT count(*)::int n FROM credit_grants')).rows[0].n;
 const spent=await admitRun(pool,ctx(alice),request('1000000',proposal.id));
 assert.equal(spent.admission.payer.kind,'project_pool','allocation: the run is pool-funded');
 assert.equal((await pool.query("SELECT count(*)::int n FROM credit_holds WHERE user_id=$1 AND state='held'",[p.id])).rows[0].n,1,
  'allocation: exactly one hold earmarks the ceiling');
 assert.equal(await balance(p.id),'2000000','allocation: the pool balance does not move');
 assert.equal(await balance(alice),'2000000','allocation: the spender balance does not move');
 assert.equal((await pool.query('SELECT count(*)::int n FROM credit_grants')).rows[0].n,lotsBefore,'allocation mints no lots');
 await assert.rejects(funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'100',perRunMicro:'100',purpose:'Keys',termsHash:offer.consentHash,...price,apiKey:'sk-live-yyy'}),
  e=>e.details?.reason==='invalid_shape','a budget carries no API key');

 // ── Distinct ledgers, one conservation law.
 assert.equal(BigInt(await balance(alice))+BigInt(await balance(bob))+BigInt(await balance(p.id)),5000000n,
  'gift + contribution + allocation conserve every micro');
 assert.equal((await ledger.verifyChainV2(pool,alice)).ok,true,'alice journal verifies');
 assert.equal((await ledger.verifyChainV2(pool,bob)).ok,true,'bob journal verifies');
 assert.equal((await ledger.verifyChainV2(pool,p.id)).ok,true,'pool journal verifies');
});
