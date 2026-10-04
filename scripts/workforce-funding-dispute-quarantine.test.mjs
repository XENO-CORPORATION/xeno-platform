// FUND-11 against real PostgreSQL: real stripe refund/dispute webhooks trace
// the affected contribution lots and quarantine the implicated origins --
// while unrelated contributors, the project manager and the pool balance are
// untouched, and each quarantine records reason + liability.
//
// PROVEN: charge.refunded for a contributed origin inserts one quarantine row
// (reason refund, liability = the refunded micro, state
// reconciliation_required) and the affected lots trace exactly to it; the
// fenced origin can no longer contribute, return, or fund reservations (a 6M
// admission against 5M clean lots is refused while 5M succeeds); a bare
// dispute fences by quarantine alone (zero liability, no refund recorded);
// donor B contributes normally; donor A's account is NOT frozen and fresh
// lots from a second checkout spend fine (per-origin fencing, not per-account
// confiscation); the webhooks write zero ledger entries and move no balance;
// a duplicate webhook is idempotent; the campaign's dispute terms were visible
// on the offer before anyone paid.
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

test('FUND-11: disputes quarantine the implicated origin only; no collateral debit',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`f11-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),donorA=await user('donorA'),donorB=await user('donorB'),donorC=await user('donorC'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const fund=async who=>{const mk=randomUUID().replaceAll('-','');
  const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:who,customer:'cus_'+mk,
  amount_total:1500,currency:'eur',metadata:{xenoUserId:who,credits:'15',kind:'credits'}};
  await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});return 'pi_'+mk;};
 const piA=await fund(donorA),piB=await fund(donorB),piC=await fund(donorC);
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true),($2,true),($3,true)',[donorA,donorB,donorC]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'Quarantine'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,beneficiary:'Q Org',cancellationTerms:'Cancel.',refundTerms:'Refunds follow the original purchase terms; disputed origins reconcile before return.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'12000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(donorA),{campaignId:campaign.id,milestoneId:milestone.id});
 assert.ok(offer.terms.refundTerms.includes('disputed origins reconcile before return'),
  'the dispute terms are public on the offer before anyone pays');
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 const cA=await funding.contributeFunding(pool,ctx(donorA),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'5000000',consentHash:offer.consentHash,confirmed:true});
 const cB=await funding.contributeFunding(pool,ctx(donorB),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'5000000',consentHash:offer.consentHash,confirmed:true});
 const cC=await funding.contributeFunding(pool,ctx(donorC),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'5000000',consentHash:offer.consentHash,confirmed:true});
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const budget=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'10000000',perRunMicro:'10000000',purpose:'Q',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:budget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,alice]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,alice,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const admit=ceiling=>admitRun(pool,ctx(alice),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
  target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:ceiling,fundingBudgetId:budget.id}});
 const txBefore=(await pool.query('SELECT count(*)::int AS n FROM credit_transactions')).rows[0].n;
 const pmBefore=(await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[alice])).rows[0]?.b ?? null;

 // ── The provider refund arrives: trace, fence, record liability.
 const refundEvt=fixture.event('evt_refund_'+marker.replaceAll('-',''),'charge.refunded',{payment_intent:piA,amount:1500,amount_refunded:1500});
 const handled=await handleEvent(pool,refundEvt,{provider:fixture.provider});
 assert.deepEqual([handled.handled,handled.reconciliationRequired],[true,true],'the contributed-origin refund reconciles, not claws back');
 const q=(await pool.query('SELECT event_id,reason,liability_micro::text AS l,state FROM workforce_funding_origin_quarantine WHERE payment_intent=$1',[piA])).rows[0];
 assert.deepEqual([q.reason,q.l,q.state],[ 'refund','15000000','reconciliation_required'],
  'the quarantine names its reason, books the refunded micro as liability, and parks for reconciliation');
 const traced=(await pool.query(`SELECT DISTINCT l.contribution_id FROM workforce_funding_origin_quarantine q
  JOIN workforce_contribution_lots l ON l.origin_grant_id=q.grant_id WHERE q.payment_intent=$1`,[piA])).rows;
 assert.deepEqual(traced.map(r=>r.contribution_id),[cA.id],'the affected contribution lots trace exactly to the fenced origin');
 const dup=await handleEvent(pool,refundEvt,{provider:fixture.provider});
 assert.equal(dup.duplicate,true,'a duplicate webhook is idempotent');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM workforce_funding_origin_quarantine WHERE payment_intent=$1',[piA])).rows[0].n,1,
  '...writing no second quarantine row');

 // ── A bare dispute (no refund yet) fences by quarantine alone.
 const dispEvt=fixture.event('evt_dispute_'+marker.replaceAll('-',''),'charge.dispute.created',{id:'dp_'+marker.replaceAll('-',''),payment_intent:piC,amount:1500,currency:'eur',reason:'fraudulent'});
 await handleEvent(pool,dispEvt,{provider:fixture.provider});
 const qC=(await pool.query('SELECT reason,liability_micro::text AS l FROM workforce_funding_origin_quarantine WHERE payment_intent=$1',[piC])).rows[0];
 assert.deepEqual([qC.reason,qC.l],[ 'dispute','0'],'the dispute quarantines with zero booked liability until funds move');
 assert.equal((await pool.query('SELECT refunded_micro::text AS r FROM billing_charges WHERE payment_intent=$1',[piC])).rows[0].r,'0',
  '...and no refund is recorded: quarantine-only fencing');
 await assert.rejects(funding.contributeFunding(pool,ctx(donorC),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'1000000',consentHash:offer.consentHash,confirmed:true}),e=>e.code==='INSUFFICIENT_CONTRIBUTABLE_CREDITS',
  'the dispute-fenced origin cannot contribute: the quarantine exclusion alone carries it');

 // ── The fence holds on every path; nothing else moves.
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM credit_transactions')).rows[0].n,txBefore,
  'quarantine writes zero ledger entries: a fence, not a debit');
 assert.equal(((await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[alice])).rows[0]?.b ?? null),pmBefore,
  'the project manager is never silently debited');
 await assert.rejects(funding.contributeFunding(pool,ctx(donorA),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'1000000',consentHash:offer.consentHash,confirmed:true}),e=>e.code==='INSUFFICIENT_CONTRIBUTABLE_CREDITS',
  'the fenced origin cannot contribute again');
 await assert.rejects(funding.returnFundingContribution(pool,ctx(donorA),{contributionId:cA.id}),e=>e.code==='CONTRIBUTION_ORIGIN_QUARANTINED',
  'the fenced contribution cannot return before reconciliation');
 await assert.rejects(admit('6000000'),e=>e.details?.reason==='pool_insufficient_eligible_funds',
  'reservations skip quarantined lots: 6M against 5M clean is refused');
 const runB=await admit('5000000');
 assert.equal(runB.admission.payer.kind,'project_pool','...while the clean 5M still funds a run');
 const cB2=await funding.contributeFunding(pool,ctx(donorB),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'1000000',consentHash:offer.consentHash,confirmed:true});
 assert.equal(cB2.state,'confirmed','the unrelated contributor is unaffected');
 const frozen=(await pool.query('SELECT is_frozen FROM credit_accounts WHERE user_id=$1',[donorA])).rows[0].is_frozen;
 assert.equal(frozen,false,'the implicated account is not frozen: fencing is per-origin');
 const piA2=await fund(donorA);
 const cA2=await funding.contributeFunding(pool,ctx(donorA),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'1000000',consentHash:offer.consentHash,confirmed:true});
 assert.equal(cA2.state,'confirmed','fresh lots from a new purchase spend fine: no per-account confiscation');

});
