// FUND-10 against real PostgreSQL: unspent eligible contributions return to
// origin under the accepted terms with no invented fees; reserved value waits
// for cancellation/settlement; restoration hits the original grant rows with
// original characteristics; the journal carries reversing links; consumed
// spend stays consumed no matter what happens to artifacts.
//
// PROVEN: a full return restores the donor balance and the exact origin
// remaining/expiry/priority to the micro with no fee skim; a return under an
// active run hold is refused (CONTRIBUTION_RESERVED) and proceeds after
// settlement for precisely the unspent remainder; the journal holds exactly
// the reversing pair keyed to the contribution with reversesReferenceType;
// the settlement artifact cannot be deleted (retained trigger) and the return
// excludes consumed lots regardless; a second return replays the same amounts
// with no balance movement (no double pay; any make-good needs separate funding).
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

test('FUND-10: returns restore origin exactly; reserved waits; consumed stays consumed',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`f10-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),donor=await user('donor'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:donor,customer:'cus_'+mk,
  amount_total:1500,currency:'eur',metadata:{xenoUserId:donor,credits:'15',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[donor]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'Returns'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,beneficiary:'Returns Org',cancellationTerms:'Cancel.',refundTerms:'Unspent returns in full.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'12000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const budget=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'10000000',perRunMicro:'10000000',purpose:'Returns',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:budget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,alice]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,alice,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const balance=async id=>(await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[id])).rows[0].b;

 // ── Full return: origin restored byte-for-byte, no invented fee.
 const b0=await balance(donor);
 const origins0=(await pool.query(`SELECT id,amount_micro::text AS a,remaining_micro::text AS r,priority,expires_at::text AS e
  FROM credit_grants WHERE user_id=$1 ORDER BY id`,[donor])).rows;
 const c1=await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'2000000',consentHash:offer.consentHash,confirmed:true});
 const ret1=await funding.returnFundingContribution(pool,ctx(donor),{contributionId:c1.id});
 assert.deepEqual([ret1.state,ret1.amountMicro,ret1.expiredMicro],[ 'returned','2000000','0'],'the full unspent contribution returns whole');
 assert.equal(await balance(donor),b0,'the donor balance is exactly what it was before contributing: no fee skimmed');
 const origins1=(await pool.query(`SELECT id,amount_micro::text AS a,remaining_micro::text AS r,priority,expires_at::text AS e
  FROM credit_grants WHERE user_id=$1 ORDER BY id`,[donor])).rows;
 assert.deepEqual(origins1,origins0,'the ORIGINAL grant rows are restored with identical remaining/expiry/priority');
 const poolGrantsLeft=(await pool.query(`SELECT COALESCE(sum(remaining_micro),0)::text AS t FROM credit_grants g
  JOIN workforce_contribution_lots l ON l.pool_grant_id=g.id WHERE l.contribution_id=$1`,[c1.id])).rows[0].t;
 assert.equal(poolGrantsLeft,'0','the pool-side lots are zeroed: value lives in exactly one place');
 const revEntries=(await pool.query(`SELECT amount::text AS a,metadata FROM credit_transactions
  WHERE reference_type='xeno.contribution.return' AND reference_id=$1 ORDER BY amount`,[c1.id])).rows;
 assert.deepEqual(revEntries.map(r=>r.a),['-2000000','2000000'],'the journal holds exactly the reversing pair');
 assert.ok(revEntries.every(r=>r.metadata?.reversesReferenceType==='xeno.contribution'&&r.metadata?.contributionId===c1.id),
  'both reversing entries link the contribution and name what they reverse');
 const ret1b=await funding.returnFundingContribution(pool,ctx(donor),{contributionId:c1.id});
 assert.deepEqual([ret1b.replayed,ret1b.amountMicro],[true,'2000000'],'a second return replays the same record');
 assert.equal(await balance(donor),b0,'...with no balance movement: no double pay; a make-good needs separate funding');

 // ── Reserved value waits for settlement; then only the unspent returns.
 const c2=await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'5000000',consentHash:offer.consentHash,confirmed:true});
 const run=await admitRun(pool,ctx(alice),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
  target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:'1000000',fundingBudgetId:budget.id}});
 await assert.rejects(funding.returnFundingContribution(pool,ctx(donor),{contributionId:c2.id}),e=>e.code==='CONTRIBUTION_RESERVED',
  'reserved amounts cannot return before cancellation/settlement');
 const settled=await ledger.settleProjectRunV2(pool,{admissionId:run.admission.admissionId,
  eventId:'evt-'+randomUUID().replaceAll('-',''),providerRequestId:'pr-'+randomUUID().replaceAll('-',''),
  provider:'fixture',model:'claude-opus-5',inputTokens:'100',outputTokens:'100',measured:true,allWorkTerminal:true});
 await assert.rejects(pool.query('DELETE FROM workforce_funding_settlements WHERE root_admission_id=$1',[run.admission.admissionId]),e=>e.code==='23514',
  'the consumption artifact cannot be deleted: retained by trigger');
 const ret2=await funding.returnFundingContribution(pool,ctx(donor),{contributionId:c2.id});
 assert.equal(ret2.amountMicro,String(BigInt(5000000)-BigInt(settled.chargedMicro)),
  'after settlement exactly the unspent remainder returns: consumed spend is not refundable');
 assert.equal(await balance(donor),String(BigInt(b0)-BigInt(settled.chargedMicro)),
  'the donor ends whole minus exactly the consumed spend');
});
