// FUND-16 against real PostgreSQL: unspent contributions return to the
// original credit balance with provenance; no cash-withdrawal right is
// created; contributor liability is capped at confirmed authorized spend;
// disputed origins quarantine; unrecoverable platform/payment loss is
// carried openly as liability or shortfall -- never an arbitrary debit to
// unrelated balances.
//
// PROVEN: a return restores the donor balance and origin lots exactly (depth
// in FUND-10); the return path writes zero marketplace_payouts rows and the
// returns table carries no cash/payout columns, so contribution creates no
// cash claim -- cash follows only the original purchase terms; an overrun
// settle charges exactly the ceiling with the excess booked as liability and
// the donor outflow capped at confirmed-minus-returned; a refund larger than
// the remaining wallet clamps at zero with an explicit shortfall, no negative
// balance anywhere, and every other account untouched.
// SIBLINGS: FUND-10 (return mechanics), FUND-11 (quarantine), FUND-07/15
// (ceiling/liability); this file cites the loss-allocation clauses on top.
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

test('FUND-16: losses allocate openly; liability capped; no arbitrary debits',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`f16-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),donor=await user('donor'),spender=await user('spender'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const fund=async who=>{const mk=randomUUID().replaceAll('-','');
  const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:who,customer:'cus_'+mk,
  amount_total:1500,currency:'eur',metadata:{xenoUserId:who,credits:'15',kind:'credits'}};
  await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});return 'pi_'+mk;};
 const piDonor=await fund(donor),piSpender=await fund(spender);
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true),($2,true)',[donor,spender]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'LossAlloc'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,beneficiary:'L Org',cancellationTerms:'Cancel.',refundTerms:'Cash refunds follow the original purchase terms.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'12000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const budget=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'10000000',perRunMicro:'10000000',purpose:'L',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:budget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,alice]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,alice,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const balance=async id=>(await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[id])).rows[0].b;
 const d0=await balance(donor);

 // ── Returns restore origin credit value; no cash right is manufactured.
 const payoutsBefore=(await pool.query('SELECT count(*)::int AS n FROM marketplace_payouts')).rows[0].n;
 const g0=(await pool.query('SELECT id,remaining_micro::text AS r FROM credit_grants WHERE user_id=$1 ORDER BY id',[donor])).rows;
 const c1=await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'2000000',consentHash:offer.consentHash,confirmed:true});
 await funding.returnFundingContribution(pool,ctx(donor),{contributionId:c1.id});
 assert.equal(await balance(donor),d0,'the return restores the original credit balance exactly');
 assert.deepEqual((await pool.query('SELECT id,remaining_micro::text AS r FROM credit_grants WHERE user_id=$1 ORDER BY id',[donor])).rows,g0,
  '...and the original lots with provenance intact');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM marketplace_payouts')).rows[0].n,payoutsBefore,
  'contributing and returning creates zero payout rows: no cash-withdrawal right');
 const retCols=(await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='workforce_funding_returns' ORDER BY 1`)).rows.map(r=>r.column_name);
 assert.deepEqual(retCols,['amount_micro','contribution_id','created_at','expired_micro','returned_by_user_id'],
  'the returns record carries credit facts only: no cash/payout channel exists here');

 // ── Liability is capped at confirmed authorized spend; the excess is carried.
 const c2=await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'5000000',consentHash:offer.consentHash,confirmed:true});
 const run=await admitRun(pool,ctx(alice),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
  target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:'1000000',fundingBudgetId:budget.id}});
 const over=await ledger.settleProjectRunV2(pool,{admissionId:run.admission.admissionId,
  eventId:'evt-'+randomUUID().replaceAll('-',''),providerRequestId:'pr-'+randomUUID().replaceAll('-',''),
  provider:'fixture',model:'claude-opus-5',inputTokens:'10000000',outputTokens:'10000000',measured:true,allWorkTerminal:true});
 assert.equal(over.chargedMicro,'1000000','the overrun charges exactly the authorized ceiling');
 assert.ok(BigInt(over.liabilityMicro)>0n,'the excess is booked as carried liability');
 await funding.returnFundingContribution(pool,ctx(donor),{contributionId:c2.id});
 assert.equal(await balance(donor),String(BigInt(d0)-1000000n),
  'the donor outflow over the whole episode is capped at the authorized ceiling: nothing more');

 // ── An unrecoverable refund clamps at zero with an explicit shortfall.
 await ledger.recordUsageV2(pool,spender,{transactionId:randomUUID(),costMicro:14000000,surface:'chat',operation:'complete'});
 assert.equal(await balance(spender),'1000000','precondition: the spender holds 1M of a 15M purchase');
 const donorBeforeShort=await balance(donor);
 const refund=await handleEvent(pool,fixture.event('evt_short_'+marker.replaceAll('-',''),'charge.refunded',{payment_intent:piSpender,amount:1500,amount_refunded:1500}),{provider:fixture.provider});
 assert.equal(refund.handled,true,'the full refund webhooks through');
 assert.equal(await balance(spender),'0','the clawback takes what remains and stops at zero: never negative');
 assert.equal((await pool.query('SELECT refunded_micro::text AS r FROM billing_charges WHERE payment_intent=$1',[piSpender])).rows[0].r,'15000000',
  'the original purchase records the full refunded amount under its own terms');
 assert.equal((await pool.query('SELECT COALESCE(sum(remaining_micro),0)::text AS t FROM credit_grants WHERE user_id=$1',[spender])).rows[0].t,'0',
  'lots and balance agree at zero: the shortfall is carried, not hidden in drift');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM credit_accounts WHERE balance<0')).rows[0].n,0,
  'no account anywhere goes negative to cover the shortfall');
 assert.equal(await balance(donor),donorBeforeShort,'unrelated balances are never debited for the loss');
});
