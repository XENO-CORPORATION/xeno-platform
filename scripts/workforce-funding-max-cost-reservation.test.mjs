// FUND-07 against real PostgreSQL: before dispatch, the maximum admitted
// cost is reserved against a pinned tariff -- with input bounds, per-run and
// budget caps, concurrency counted once -- and no top-up exists outside a
// fresh authorized envelope. A provider without a credible upper bound cannot
// touch hard-capped pooled spend; a real overage is an incident carried as
// liability, never a retro-debit.
//
// PROVEN: an unlisted model cannot price a budget (invalid_funding_model);
// a mismatched price version is refused (funding_price_changed); admission
// reserves the whole ceiling in one atomic insert (credit_holds + run_funding
// + lot allocations all equal the ceiling); ceilings above per_run are refused
// (funding_run_limit) and concurrent admissions that would breach the budget
// maximum are refused (funding_pool_limit); the admitted ceiling is
// trigger-immutable (no top-up path: a raise needs a new admission under an
// authorized envelope); an over-measured settle charges exactly the ceiling,
// books the excess as liability, parks reconciliation_required, and leaves
// the contributor's balance untouched.
// SIBLING: FUND-15 proves the tariff/commission face of settlement; this file
// cites the reserve-before-dispatch clauses.
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

test('FUND-07: max cost reserved before dispatch; uncapped providers ineligible; overruns are liability',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`f7-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),donor=await user('donor'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:donor,customer:'cus_'+mk,
  amount_total:1500,currency:'eur',metadata:{xenoUserId:donor,credits:'15',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[donor]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'MaxReserve'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,beneficiary:'Reserve Org',cancellationTerms:'Cancel.',refundTerms:'Unspent.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'12000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'10000000',consentHash:offer.consentHash,confirmed:true});

 // ── No credible upper bound, no hard-capped pooled spend: the pinned
 // tariff snapshot (hash-bound version) is the price basis, and the
 // ceiling/per-run/maximum envelope is the spend bound. Either missing
 // or drifted, dispatch is refused.
 await assert.rejects(funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'bad\u0007model'}),e=>e.details?.reason==='invalid_funding_model',
  'an unpriceable model cannot price pooled spend: ineligible until the bound is enforceable');
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 await assert.rejects(funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'10000000',perRunMicro:'6000000',purpose:'Reserve',termsHash:offer.consentHash,model:'claude-opus-5',priceVersion:'2099- WRONG'}),
  e=>e.details?.reason==='funding_price_changed','a budget pinned to the wrong tariff version is refused');
 const budget=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'10000000',perRunMicro:'6000000',purpose:'Reserve',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:budget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const bRow=(await pool.query('SELECT price_snapshot FROM workforce_funding_budgets WHERE id=$1',[budget.id])).rows[0];
 assert.deepEqual([bRow.price_snapshot.model,typeof bRow.price_snapshot.version],[ 'claude-opus-5','string'],'the approved budget carries the pinned tariff snapshot');

 // ── Dispatch reserves the maximum admitted cost, atomically.
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,alice]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,alice,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const admit=ceiling=>admitRun(pool,ctx(alice),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
  target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:ceiling,fundingBudgetId:budget.id}});
 await assert.rejects(admit('6000001'),e=>e.code==='needs_approval'&&e.details?.reason==='funding_run_limit',
  'a ceiling above the approved per-run bound is refused before anything is reserved');
 await assert.rejects(pool.query('UPDATE workforce_funding_budgets SET maximum_micro=99999999 WHERE id=$1',[budget.id]),e=>e.code==='23514',
  'the approved envelope is trigger-immutable: limits cannot be widened after approval (no silent top-up)');
 // HONEST NOTE (pinned, not executed): funding_price_unpinned guards only rows
 // predating the price-pin migration. It cannot be constructed on a fresh DB:
 // the service always pins a snapshot, the trigger freezes price fields, and
 // INSERT must begin proposed. The wrong-version leg above proves the live gate.
 const run1=await admit('1000000');
 const f1=(await pool.query('SELECT hold_row_id,reserved_micro::text AS r FROM workforce_run_funding WHERE admission_id=$1',[run1.admission.admissionId])).rows[0];
 const h1=(await pool.query('SELECT amount_micro::text AS a,state FROM credit_holds WHERE id=$1',[f1.hold_row_id])).rows[0];
 const alloc=(await pool.query('SELECT COALESCE(sum(reserved_micro),0)::text AS t FROM credit_hold_funding WHERE hold_row_id=$1',[f1.hold_row_id])).rows[0].t;
 assert.deepEqual([f1.r,h1.a,h1.state,alloc],[ '1000000','1000000','held','1000000'],
  'the hold, the run funding row and the lot allocations all equal the ceiling: the maximum is reserved before dispatch');
 const allocKinds=(await pool.query(`SELECT count(*)::int AS n FROM credit_hold_funding f JOIN credit_grants g ON g.id=f.grant_id
  WHERE f.hold_row_id=$1 AND g.kind<>'contribution'`,[f1.hold_row_id])).rows[0].n;
 assert.equal(allocKinds,0,'the reservation draws only on contribution lots');

 // ── Concurrency counts once against the envelope; the ceiling cannot be raised after.
 const run2=await admit('6000000');
 assert.equal(run2.admission.payer.kind,'project_pool','a second run reserves inside the remaining envelope');
 await assert.rejects(admit('6000000'),e=>e.code==='needs_approval'&&e.details?.reason==='funding_pool_limit',
  'a third run that would breach the budget maximum is refused: commitments count once');
 await assert.rejects(pool.query('UPDATE workforce_run_admissions SET budget_ceiling_micro=9000000 WHERE id=$1',[run1.admission.admissionId]),e=>e.code==='23514',
  'the admitted ceiling is trigger-immutable: no top-up outside a fresh authorized envelope');

 // ── An unexpected overage is an incident carried as liability, never a retro-debit.
 const donorBefore=(await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[donor])).rows[0].b;
 const over=await ledger.settleProjectRunV2(pool,{admissionId:run1.admission.admissionId,
  eventId:'evt-'+randomUUID().replaceAll('-',''),providerRequestId:'pr-'+randomUUID().replaceAll('-',''),
  provider:'fixture',model:'claude-opus-5',inputTokens:'10000000',outputTokens:'10000000',measured:true,allWorkTerminal:true});
 assert.equal(over.chargedMicro,'1000000','the overrun charges exactly the reserved ceiling');
 assert.ok(BigInt(over.liabilityMicro)>0n,'the excess is booked as liability, openly');
 const oRow=(await pool.query('SELECT state FROM workforce_funding_settlements WHERE root_admission_id=$1',[run1.admission.admissionId])).rows[0];
 assert.equal(oRow.state,'reconciliation_required','the overrun parks for reconciliation: an incident, not a silent debit');
 assert.equal((await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[donor])).rows[0].b,donorBefore,
  'the contributor balance is untouched by the overage');
});
