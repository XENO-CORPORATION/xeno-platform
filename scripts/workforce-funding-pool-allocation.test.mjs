// FUND-01 against real PostgreSQL: a project funding pool is a restricted allocation
// on the canonical ledger -- never a second currency, never a mutable independent
// balance -- and only confirmed eligible contributions become spendable.
//
// PROVEN: the pool owns a canonical credit account with owner_kind project_pool; the
// ordinary wallet primitives (usage, holds) refuse it as RESTRICTED_ACCOUNT -- value
// enters only through contributions and leaves only through run funding; pool balance
// equals confirmed contribution lots minus settled debits, to the micro; every pool
// grant traces to a contribution lot with verified stripe payment origins (zero
// minted value: no pool grant lacks a contribution-lot link); lots link ONLY to
// confirmed contributions; a promo-only wallet is refused at contribute with
// INSUFFICIENT_CONTRIBUTABLE_CREDITS while paid+verified value contributes fine.
// SIBLING: FUND-02 (credit-payment-origin.test.mjs) proves the full eligibility
// lattice -- paid vs promo/allowance, verified origins, quarantine; this file cites
// the pool-as-allocation clauses on top of it.
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

test('FUND-01: the pool is a restricted allocation on the canonical ledger; only confirmed eligible contributions become spendable',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`f1-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),donor=await user('donor'),promo=await user('promo'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const fund=async who=>{const mk=randomUUID().replaceAll('-','');
  const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:who,customer:'cus_'+mk,
  amount_total:1500,currency:'eur',metadata:{xenoUserId:who,credits:'15',kind:'credits'}};
  await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});};
 await fund(alice);await fund(donor);
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true),($2,true),($3,true)',[alice,donor,promo]);
 // A promo-only wallet: real balance, zero verified paid value. And paid value with
 // no payment origins at all: the right kind, the wrong provenance.
 await ledger.addGrant(pool,promo,{amountMicro:'5000000',kind:'promo',sourceRef:'promo-campaign-'+marker});
 const rawpaid=await user('rawpaid');
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[rawpaid]);
 await ledger.addGrant(pool,rawpaid,{amountMicro:'5000000',kind:'paid',sourceRef:'backfill-'+marker});
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'PoolAlloc'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,beneficiary:'Delivery',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'10000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];

 // ── The pool is a restricted canonical account, not a wallet.
 const acct=(await pool.query('SELECT owner_kind,balance::text AS b FROM credit_accounts WHERE user_id=$1',[p.id])).rows[0];
 assert.deepEqual([acct.owner_kind,acct.b],['project_pool','0'],'a fresh pool is a zero-balance canonical account of pool kind');
 await assert.rejects(ledger.recordUsageV2(pool,p.id,{transactionId:randomUUID(),costMicro:100,surface:'chat',operation:'complete'}),e=>e.code==='RESTRICTED_ACCOUNT',
  'the ordinary usage primitive refuses the pool account');
 await assert.rejects(ledger.holdV2(pool,p.id,{holdId:'direct-hold',amountMicro:100,surface:'checkout',operation:'authorize'}),e=>e.code==='RESTRICTED_ACCOUNT',
  'the ordinary hold primitive refuses the pool account');

 // ── Only confirmed ELIGIBLE value becomes spendable.
 await assert.rejects(funding.contributeFunding(pool,ctx(promo),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'1000000',consentHash:offer.consentHash,confirmed:true}),e=>e.code==='INSUFFICIENT_CONTRIBUTABLE_CREDITS',
  'a promo-only wallet cannot contribute: ineligible lots never enter the pool');
 await assert.rejects(funding.contributeFunding(pool,ctx(rawpaid),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'1000000',consentHash:offer.consentHash,confirmed:true}),e=>e.code==='INSUFFICIENT_CONTRIBUTABLE_CREDITS',
  'paid value without verified payment origins cannot contribute either');
 const qdonor=await user('qdonor');
 await fund(qdonor);
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[qdonor]);
 const qg=(await pool.query(`SELECT g.id,o.payment_intent FROM credit_grants g JOIN credit_grant_payment_origins o ON o.grant_id=g.id
  WHERE g.user_id=$1 LIMIT 1`,[qdonor])).rows[0];
 await pool.query(`INSERT INTO workforce_funding_origin_quarantine(event_id,payment_intent,grant_id,reason,liability_micro)
  VALUES($1,$2,$3,'dispute',(SELECT remaining_micro FROM credit_grants WHERE id=$3))`,['q-'+marker,qg.payment_intent,qg.id]);
 await assert.rejects(funding.contributeFunding(pool,ctx(qdonor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'1000000',consentHash:offer.consentHash,confirmed:true}),e=>e.code==='INSUFFICIENT_CONTRIBUTABLE_CREDITS',
  'quarantined origins are excluded from spendable value');
 const c1=await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'2000000',consentHash:offer.consentHash,confirmed:true});
 assert.equal(c1.state,'confirmed','paid+verified value confirms');
 assert.equal((await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[p.id])).rows[0].b,'2000000',
  'the pool balance is exactly the confirmed contribution: nothing minted, nothing skimmed');

 // ── Every micro of pool value traces to a confirmed contribution lot with verified origins.
 const orphaned=(await pool.query(`SELECT count(*)::int AS n FROM credit_grants g
  WHERE g.user_id=$1 AND g.kind='contribution'
  AND NOT EXISTS (SELECT 1 FROM workforce_contribution_lots l WHERE l.pool_grant_id=g.id)`,[p.id])).rows[0].n;
 assert.equal(orphaned,0,'zero pool value lacks a contribution-lot link: no second currency is minted here');
 const unconfirmed=(await pool.query(`SELECT count(*)::int AS n FROM workforce_contribution_lots l
  JOIN workforce_funding_contributions c ON c.id=l.contribution_id WHERE c.state<>'confirmed' AND c.campaign_id=$1`,[campaign.id])).rows[0].n;
 assert.equal(unconfirmed,0,'lots link only to confirmed contributions: unconfirmed value is never spendable');
 const unverified=(await pool.query(`SELECT count(*)::int AS n FROM workforce_contribution_lots l
  JOIN credit_grants g ON g.id=l.origin_grant_id
  LEFT JOIN credit_grant_payment_origins o ON o.grant_id=g.id
  WHERE l.contribution_id=$1 AND o.grant_id IS NULL`,[c1.id])).rows[0].n;
 assert.equal(unverified,0,'every origin lot carries verified payment origins');

 // ── And the allocation spends: a run against the lots, settled to the micro.
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,alice]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,alice,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const budget=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'10000000',perRunMicro:'10000000',purpose:'PoolAlloc',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:budget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const run=await admitRun(pool,ctx(alice),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
 target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:'1000000',fundingBudgetId:budget.id}});
 assert.equal(run.admission.payer.kind,'project_pool','the allocation funds the run');
 const settled=await ledger.settleProjectRunV2(pool,{admissionId:run.admission.admissionId,
  eventId:'evt-'+randomUUID().replaceAll('-',''),providerRequestId:'pr-'+randomUUID().replaceAll('-',''),
  provider:'fixture',model:'claude-opus-5',inputTokens:'100',outputTokens:'100',measured:true,allWorkTerminal:true});
 const expectPool=BigInt(2000000)-BigInt(settled.chargedMicro);
 assert.equal((await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[p.id])).rows[0].b,String(expectPool),
  'settlement debits the allocation exactly: balance is always confirmed lots minus settled spend');
});
