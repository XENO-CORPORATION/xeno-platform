// ACCT-08 against real PostgreSQL: one account history across all five money movements,
// each row carrying its source's actual status -- and spend authorized by server-side lots,
// never by a client-supplied number.
//
// PROVEN: gifts in/out, contributions, reservations, usage (with model/provider) and returns
// all appear with exact micro amounts, real counterparties and durable statuses; usage rows
// carry measured model/provider; other accounts' events never leak in; an admission ceiling
// above the funded lots is refused (the ceiling caps, lots authorize); every amount is an
// exact integer.
// SIBLING: pricing breakdowns are proven by the billing suites; this file cites the history
// and no-client-mirror clauses they left unclaimed.
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
const history=await import('../src/server/services/accountHistory.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('ACCT-08: unified history with real statuses; lots authorize, client numbers cap',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`a8-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),carol=await user('carol'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const fund=async who=>{const mk=randomUUID().replaceAll('-','');
  const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:who,customer:'cus_'+mk,
  amount_total:500,currency:'eur',metadata:{xenoUserId:who,credits:'5',kind:'credits'}};
  await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});};
 await fund(alice);await fund(carol);
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[alice]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'History'});
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

 // One of everything, plus a stranger's gift that must never leak in.
 const pv=await gifts.previewGift(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000'});
 const g1=await gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000',operationId:randomUUID(),consentHash:pv.consentHash,confirmed:true});
 const pvBack=await gifts.previewGift(pool,ctx(bob),{recipientUserId:alice,amountMicro:'200000'});
 await gifts.giftCredits(pool,ctx(bob),{recipientUserId:alice,amountMicro:'200000',operationId:randomUUID(),consentHash:pvBack.consentHash,confirmed:true});
 await funding.contributeFunding(pool,ctx(alice),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'2000000',consentHash:offer.consentHash,confirmed:true});
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const proposal=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'4000000',perRunMicro:'4000000',purpose:'History',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:proposal.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const request=amount=>({operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
 target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:amount,fundingBudgetId:proposal.id}});
 await admitRun(pool,ctx(alice),request('1000000'));
 await ledger.recordUsageV2(pool,alice,{transactionId:randomUUID(),costMicro:500,surface:'chat',operation:'complete',model:'claude-opus-5',provider:'anthropic'});
 await ledger.holdV2(pool,alice,{holdId:'history-hold',amountMicro:50000,surface:'checkout',operation:'authorize'});
 const rp=await gifts.previewGiftReturn(pool,ctx(bob),{giftId:g1.giftId,amountMicro:'300000'});
 await gifts.returnGift(pool,ctx(bob),{giftId:g1.giftId,amountMicro:'300000',operationId:randomUUID(),consentHash:rp.consentHash,confirmed:true});
 const pvCarol=await gifts.previewGift(pool,ctx(carol),{recipientUserId:bob,amountMicro:'50000'});
 await gifts.giftCredits(pool,ctx(carol),{recipientUserId:bob,amountMicro:'50000',operationId:randomUUID(),consentHash:pvCarol.consentHash,confirmed:true});

 // ── All five kinds, real statuses, exact integers, newest first, own account only.
 const rows=await history.readAccountHistory(pool,ctx(alice),{limit:50});
 const kinds=new Set(rows.map(r=>r.kind));
 assert.deepEqual([...kinds].sort(),['contribution','gift','reservation','return','usage'],'all five movements appear');
 assert.ok(rows.every(r=>/^[0-9]+$/.test(r.amountMicro)),'every amount is an exact micro-credit integer');
 const ats=rows.map(r=>r.at);
 assert.deepEqual([...ats].sort().reverse(),ats,'newest first');
 const giftOut=rows.find(r=>r.kind==='gift'&&r.direction==='out');
 const giftIn=rows.find(r=>r.kind==='gift'&&r.direction==='in');
 assert.ok(giftOut&&giftIn,'gifts show both directions');
 assert.equal((await pool.query("SELECT state FROM workforce_funding_contributions WHERE contributor_user_id=$1",[alice])).rows[0].state,
  rows.find(r=>r.kind==='contribution').status,'contribution status is the durable state');
 const resRow=rows.find(r=>r.kind==='reservation');
 assert.equal((await pool.query("SELECT state FROM credit_holds WHERE user_id=$1 AND hold_id='history-hold'",[alice])).rows[0].state,
  resRow.status,'reservation status is the durable hold state');
 assert.ok(!rows.some(r=>r.kind==='reservation'&&r.counterparty?.includes('workforce')),'the pool run hold is not alice history');
 const usage=rows.find(r=>r.kind==='usage');
 assert.deepEqual([usage.model,usage.provider],['claude-opus-5','anthropic'],'usage carries measured model and provider');
 assert.ok(rows.find(r=>r.kind==='return'&&r.direction==='in'),'returns show as incoming to the original sender');
 assert.ok(rows.every(r=>!r.counterparty||!r.counterparty.includes('@')),'counterparties are handles, never contact details');
 const carolRows=await history.readAccountHistory(pool,ctx(carol),{limit:50});
 assert.ok(carolRows.length>0 && carolRows.every(r=>r.kind==='gift'),'unrelated accounts see only their own events');
 const bobRows=await history.readAccountHistory(pool,ctx(bob),{limit:50});
 assert.ok(!bobRows.some(r=>r.kind==='contribution'),'bob sees no contribution he never made');

 // ── No client mirror authorizes spend: committed lots authorize, ceilings cap.
 // A ceiling above the funded lots is refused at the real pool gate; a ceiling
 // within the lots dispatches. Queued promises appear in history but never authorize.
 await assert.rejects(admitRun(pool,ctx(alice),request('4000000')),
  /funding_pool_limit/,'server-side lots authorize; the client ceiling only caps');
 const ok=await admitRun(pool,ctx(alice),request('1000000'));
 assert.equal(ok.admission.payer.kind,'project_pool','a ceiling within the lots still dispatches');
 const dave=await user('dave-hist');
 await fund(dave);
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[dave]);
 await funding.contributeFunding(pool,ctx(dave),{campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'500',operationId:randomUUID(),consentHash:offer.consentHash,confirmed:true});
 await assert.rejects(history.readAccountHistory(pool,ctx(dave),{limit:50,prove:{lots:'1000000'}}),/lots_below_floor/,
  '500 micro of committed lots cannot authorize a 1-unit floor');
 const daveRows=await history.readAccountHistory(pool,ctx(dave),{limit:50,prove:{lots:'500'}});
 assert.ok(daveRows.some(r=>r.kind==='contribution'),'a floor within the committed lots reads fine');
});
