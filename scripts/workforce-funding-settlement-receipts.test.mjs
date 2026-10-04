// FUND-08 against real PostgreSQL: reservation allocations to contribution
// lots and run IDs are retained durably; settlement consumes authoritative
// usage receipts with event deduplication; token counts stay telemetry while
// funding moves only in priced micro-credits.
//
// PROVEN: hold->lot allocations survive settlement (the run->hold->pool lots->
// origins->charges chain reads back after the debit); an identical receipt
// replays idempotently (one settlement row, one debit) while tampered tokens
// or a second event for the same admission conflict; priced micro equals the
// pinned tariff rates times the receipt tokens (recomputed in-test), the pool
// debit and ledger entry equal charged micro exactly, and the token counts
// land in api_usage_logs beside the actual cost; unmeasured or non-terminal
// receipts are refused before anything is read.
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

test('FUND-08: allocations retained; receipts authoritative and deduplicated; tokens are telemetry',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`f8-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),donor=await user('donor'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:donor,customer:'cus_'+mk,
  amount_total:1500,currency:'eur',metadata:{xenoUserId:donor,credits:'15',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[donor]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'Receipts'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,beneficiary:'Receipts Org',cancellationTerms:'Cancel.',refundTerms:'Unspent.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'12000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'10000000',consentHash:offer.consentHash,confirmed:true});
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const budget=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'10000000',perRunMicro:'10000000',purpose:'Receipts',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:budget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const snap=(await pool.query('SELECT price_snapshot FROM workforce_funding_budgets WHERE id=$1',[budget.id])).rows[0].price_snapshot;
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,alice]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,alice,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const run=await admitRun(pool,ctx(alice),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
  target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:'2000000',fundingBudgetId:budget.id}});
 const aid=run.admission.admissionId;
 const f=(await pool.query('SELECT hold_row_id,reserved_micro::text AS r FROM workforce_run_funding WHERE admission_id=$1',[aid])).rows[0];

 // ── Only measured terminal receipts are usage evidence.
 const base={admissionId:aid,eventId:'evt-'+randomUUID().replaceAll('-',''),providerRequestId:'pr-'+randomUUID().replaceAll('-',''),
  provider:'fixture',model:'claude-opus-5',inputTokens:'100',outputTokens:'100',measured:true,allWorkTerminal:true};
 await assert.rejects(ledger.settleProjectRunV2(pool,{...base,measured:false}),e=>e.code==='BAD_REQUEST',
  'an unmeasured receipt is refused before anything is read');
 await assert.rejects(ledger.settleProjectRunV2(pool,{...base,allWorkTerminal:false}),e=>e.code==='BAD_REQUEST',
  'a non-terminal receipt is refused: only finished work settles');

 // ── Settlement debits once; the allocation chain survives it.
 const preAlloc=(await pool.query('SELECT COALESCE(sum(reserved_micro),0)::text AS t FROM credit_hold_funding WHERE hold_row_id=$1',[f.hold_row_id])).rows[0].t;
 assert.equal(preAlloc,'2000000','the full ceiling is allocated to lots before settlement');
 const done=await ledger.settleProjectRunV2(pool,base);
 assert.equal(done.replayed,false,'first settlement commits');
 const postAlloc=(await pool.query('SELECT COALESCE(sum(reserved_micro),0)::text AS t FROM credit_hold_funding WHERE hold_row_id=$1',[f.hold_row_id])).rows[0].t;
 assert.equal(postAlloc,'2000000','the allocations are retained after settlement: durable, not consumed-away');
 const chain=(await pool.query(`SELECT l.contribution_id,o.payment_intent FROM workforce_run_funding f
  JOIN credit_hold_funding hf ON hf.hold_row_id=f.hold_row_id
  JOIN credit_grants g ON g.id=hf.grant_id
  JOIN workforce_contribution_lots l ON l.pool_grant_id=g.id
  JOIN credit_grant_payment_origins o ON o.grant_id=l.origin_grant_id
  WHERE f.admission_id=$1 LIMIT 1`,[aid])).rows[0];
 assert.ok(chain?.contribution_id&&chain?.payment_intent,'run->hold->pool lots->origins->charges reads back after the debit');
 const hRow=(await pool.query('SELECT state,settled_micro::text AS s FROM credit_holds WHERE id=$1',[f.hold_row_id])).rows[0];
 assert.deepEqual([hRow.state,hRow.s],[ 'settled',done.chargedMicro],'the hold settles for exactly the charged amount');

 // ── Event deduplication: replay is idempotent, tampering conflicts.
 const replay=await ledger.settleProjectRunV2(pool,base);
 assert.deepEqual([replay.replayed,replay.chargedMicro,replay.eventId],[true,done.chargedMicro,done.eventId],
  'an identical receipt replays: same view, no second debit');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM workforce_funding_settlements WHERE root_admission_id=$1',[aid])).rows[0].n,1,
  'exactly one settlement row exists after the replay');
 assert.equal((await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[p.id])).rows[0].b,
  String(BigInt(10000000)-BigInt(done.chargedMicro)),'the pool paid exactly once');
 await assert.rejects(ledger.settleProjectRunV2(pool,{...base,inputTokens:'200'}),e=>e.code==='CONFLICT',
  'tampered tokens under the same event conflict: the receipt hash is authoritative');
 await assert.rejects(ledger.settleProjectRunV2(pool,{...base,eventId:'evt-'+randomUUID().replaceAll('-',''),providerRequestId:'pr-'+randomUUID().replaceAll('-','')}),e=>e.code==='CONFLICT',
  'a second event for the same admission conflicts: one receipt per reservation');

 // ── Tokens are telemetry: funding moves only in tariff-priced micro-credits.
 const expectPriced=BigInt(snap.inputMicroPerToken)*100n+BigInt(snap.outputMicroPerToken)*100n;
 assert.equal(done.pricedMicro,String(expectPriced),'priced micro equals the pinned tariff rates times the receipt tokens');
 assert.equal(done.chargedMicro,done.pricedMicro,'within the reservation the charge equals the priced amount');
 const sRow=(await pool.query('SELECT price_version,input_tokens::text AS it,output_tokens::text AS ot,priced_micro::text AS pr,charged_micro::text AS ch FROM workforce_funding_settlements WHERE root_admission_id=$1',[aid])).rows[0];
 assert.deepEqual([sRow.price_version,sRow.it,sRow.ot,sRow.pr,sRow.ch],
  [snap.version,'100','100',done.pricedMicro,done.chargedMicro],'the settlement shows tokens beside the price basis and the credit amounts');
 const tRow=(await pool.query(`SELECT input_tokens::text AS it,output_tokens::text AS ot,actual_cost_micro::text AS c FROM api_usage_logs
  WHERE request_id=$1 AND surface='workforce' AND operation='run'`,[aid])).rows[0];
 assert.deepEqual([tRow.it,tRow.ot,tRow.c],['100','100',done.chargedMicro],
  'the usage log carries token telemetry beside the actual credit cost');
 const jRow=(await pool.query(`SELECT amount::text AS a FROM credit_transactions WHERE reference_type='xeno.hold' AND reference_id=$1`,[aid])).rows[0];
 assert.equal(jRow.a,String(-BigInt(done.chargedMicro)),'the journal debit equals the charged micro-credits exactly');
});
