// FUND-06 against real PostgreSQL: each run has one selected payer and a
// project/milestone budget reservation; caps bind posted spend AND active
// commitments; and a pool that cannot fund the work gets a typed refusal -- never a
// silent slide onto the personal wallet.
//
// PROVEN: a pool run records payer project_pool with exactly one held reservation
// linked admission->budget->pool->hold; a ceiling the pool cannot cover is refused
// while a FAT personal wallet sits untouched (no fallback: no personal hold, no
// admission row, pool holds unchanged); a project scope cap refuses runs whose
// ceiling fits EITHER posted or committed alone but not their sum, in both orders
// (held-then-posted via settlement); a per-period budget window counts held AND
// posted debits; an explicit personal run is admitted as a SELECTION (and an
// over-personal run is refused with no pool fallback -- no silent fallback runs in
// either direction).
// SIBLING: workforce-scope-caps.test.mjs proves cap CRUD, independence and atomicity
// across pools/projects; this file cites the run-binding clauses. The chat-route
// workspace-wallet fallback documented in src/server/tests/wallet-service.test.mjs is
// a different, latent subsystem (WORKSPACE_BILLING_ENABLED unset; pools cannot spend
// there yet): FUND-06's run/budget/milestone language governs admissions, which is
// what this proof executes. That note stays true and untouched.
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

test('FUND-06: one selected payer and reservation per run; caps bind posted plus committed; pool shortfall refuses, never falls back',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`f6-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),donor=await user('donor'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const fund=async who=>{const mk=randomUUID().replaceAll('-','');
  const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:who,customer:'cus_'+mk,
  amount_total:1500,currency:'eur',metadata:{xenoUserId:who,credits:'15',kind:'credits'}};
  await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});};
 // Alice's personal wallet is deliberately FAT: a fallback would succeed, so a refusal
 // proves there is no fallback. The donor funds the pool; prefs let both spend.
 await fund(alice);await fund(donor);
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true),($2,true)',[alice,donor]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'NoFallback'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,alice]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,alice,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,beneficiary:'Delivery',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'10000000'});
 const milestone2=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m2',title:'M2',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'10000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id});
 await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'5000000',consentHash:offer.consentHash,confirmed:true});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const proposal=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'10000000',perRunMicro:'10000000',purpose:'NoFallback',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:proposal.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const request=(amount,budgetId=proposal.id)=>({operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
 target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:amount,fundingBudgetId:budgetId}});
 const balance=async who=>BigInt((await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[who])).rows[0].b);
 const heldHolds=async who=>(await pool.query("SELECT count(*)::int AS n FROM credit_holds WHERE user_id=$1 AND state='held'",[who])).rows[0].n;
 // Settle a pool run's whole held ceiling as measured provider usage: priced usage above
 // the hold charges the full reservation (never fresh lots), posting the debit.
 const settleRun=async admissionId=>ledger.settleProjectRunV2(pool,{admissionId,
  eventId:'evt-'+randomUUID().replaceAll('-',''),providerRequestId:'pr-'+randomUUID().replaceAll('-',''),
  provider:'fixture',model:'claude-opus-5',inputTokens:'10000000',outputTokens:'10000000',measured:true,allWorkTerminal:true});
 const personalBefore=await balance(alice);

 // ── One selected payer and one budget reservation.
 const runA=await admitRun(pool,ctx(alice),request('1000000'));
 assert.equal(runA.admission.payer.kind,'project_pool','the run selects the pool payer');
 const link=(await pool.query(`SELECT f.budget_id,f.pool_id,h.state,h.amount_micro::text AS reserved
  FROM workforce_run_funding f JOIN credit_holds h ON h.id=f.hold_row_id WHERE f.admission_id=$1`,[runA.admission.admissionId])).rows[0];
 assert.deepEqual([link.budget_id,link.pool_id,link.state,link.reserved],[proposal.id,p.id,'held','1000000'],
  'admission, budget, pool and held reservation link 1:1:1:1');
 assert.equal(await heldHolds(p.id),1,'exactly one pool hold earmarks the ceiling');

 // ── Pool shortfall refuses LOUDLY: fat personal wallet untouched, nothing half-made.
 const opFail=randomUUID();
 await assert.rejects(admitRun(pool,ctx(alice),{...request('9000000'),operationId:opFail}),/funding_pool_limit|pool_insufficient/,
  'a ceiling the pool cannot cover is refused, not rerouted');
 assert.equal(await balance(alice),personalBefore,'the personal wallet is untouched by the refusal');
 assert.equal(await heldHolds(alice),0,'no personal hold is quietly created');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM workforce_run_admissions WHERE client_id=$1 AND operation_id=$2',['xeno-agent-interface',opFail])).rows[0].n,0,
  'no admission row is half-made');
 assert.equal(await heldHolds(p.id),1,'pool holds are unchanged by the refusal');

 // ── Per-period budget windows count held AND posted debits. Runs before the project
 // cap below is approved, so the window gate is what bites.
 const offer2=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone2.id});
 await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone2.id,amountMicro:'5000000',consentHash:offer2.consentHash,confirmed:true});
 const p2=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone2.id])).rows[0];
 const price2=await funding.readFundingPrice(pool,ctx(planner),{poolId:p2.id,model:'claude-opus-5'});
 const wb=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p2.id,spenderUserId:alice,
  maximumMicro:'10000000',perRunMicro:'1000000',purpose:'Window',termsHash:offer2.consentHash,...price2,window:{seconds:3600,limitMicro:'1200000'}});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:wb.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const runD=await admitRun(pool,ctx(alice),request('1000000',wb.id));
 assert.equal(await heldHolds(p2.id),1,'the windowed run reserves');
 await assert.rejects(admitRun(pool,ctx(alice),request('500000',wb.id)),/funding_window_limit/,
  '1M held + 0.5M exceeds the 1.2M window: the window counts commitments');
 const settledD=await settleRun(runD.admission.admissionId);
 assert.equal(settledD.chargedMicro,'1000000','the windowed run settles its whole ceiling as posted spend');
 await assert.rejects(admitRun(pool,ctx(alice),request('500000',wb.id)),/funding_window_limit/,
  '1M posted + 0.5M still exceeds the window: the window counts posted debits');

 // ── Project caps bind commitments AND posted spend, in both orders. The project now
 // carries 1M held (run A) + 1M posted (run D settled): a 3M cap leaves 1M of room.
 const cap=await funding.proposeScopeSpendCap(pool,ctx(planner),{operationId:randomUUID(),scope:{kind:'project',id:project.id},windowSeconds:3600,limitMicro:'3000000'});
 await funding.decideScopeSpendCap(pool,ctx(approver),{capId:cap.id,operationId:randomUUID(),decision:'approved',expectedActiveId:null});
 await assert.rejects(admitRun(pool,ctx(alice),request('1500000')),/funding_scope_limit/,
  '2M on the books + 1.5M ceiling exceeds the 3M cap: commitments count');
 const settledA=await settleRun(runA.admission.admissionId);
 assert.equal(settledA.chargedMicro,'1000000','run A settles its whole ceiling as posted spend');
 await assert.rejects(admitRun(pool,ctx(alice),request('1500000')),/funding_scope_limit/,
  '2M posted + 1.5M ceiling still exceeds the cap: posted counts too');
 const runC=await admitRun(pool,ctx(alice),request('500000'));
 assert.equal(runC.admission.payer.kind,'project_pool','2M posted + 0.5M fits the cap and dispatches');

 // ── Personal is a SELECTION, not a fallback: explicit, and bounded the same way.
 const personal=await admitRun(pool,ctx(alice),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
 target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:'1000000'}});
 assert.equal(personal.admission.payer.kind,'user','no budget named, personal payer selected openly');
 assert.equal((await pool.query("SELECT state FROM credit_holds WHERE user_id=$1 AND hold_id=$2",[alice,personal.admission.admissionId])).rows[0]?.state,'held',
  'the personal run reserves its ceiling on the personal wallet, explicitly -- not as a fallback');
 assert.equal(await heldHolds(p.id),1,'no pool hold is touched by the personal selection');
 await assert.rejects(admitRun(pool,ctx(alice),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
 target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:'999999999999'}}),/budget_exceeds_available/,
  'an over-personal run is refused with no pool fallback: no silent fallback runs either way');
});
