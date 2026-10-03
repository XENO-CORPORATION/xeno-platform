// Real admission, canonical reservation and service-receipt settlement proof.
// Provider-bound dispatch remains unimplemented; no complete funding requirement is cited.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash,generateKeyPairSync} from 'node:crypto';
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

test('NFR-03: a duplicated or restarted request has at most one effect -- contribution, reservation, settlement and result delivery',{skip:!url,timeout:120000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const user=async()=>{const x=randomUUID();return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user(),planner=await user(),approver=await user(),contributor=await user();
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(owner),name:'Funded admission'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,owner]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,owner,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const campaign=await funding.createFundingCampaign(pool,ctx(owner),{operationId:randomUUID(),projectId:project.id,beneficiary:'Delivery',cancellationTerms:'Cancel unused work.',refundTerms:'Return with original expiry.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(owner),{campaignId:campaign.id,key:'first',title:'First',criteria:['Tests'],thresholdMicro:'2000000',budgetMaxMicro:'4000000'});
 await funding.openFundingCampaign(pool,ctx(owner),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(owner),{campaignId:campaign.id,milestoneId:milestone.id});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const proposal=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:owner,maximumMicro:'4000000',perRunMicro:'2000000',purpose:'First milestone',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:proposal.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const request=(amount='2000000',extra={})=>({operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:amount,fundingBudgetId:proposal.id},...extra});
 const reject=(promise,reason,message)=>assert.rejects(promise,e=>e.details?.reason===reason,message);
 if(!(await pool.query("SELECT to_regclass('billing_charges') AS relation")).rows[0].relation) {
  await reject(admitRun(pool,ctx(owner),request('1000000')),'pool_insufficient_eligible_funds','a new installation refuses absent paid evidence without an SQL failure');
 }
 const marker=randomUUID().replaceAll('-','');
 const s={id:'cs_'+marker,mode:'payment',payment_status:'paid',payment_intent:'pi_'+marker,client_reference_id:contributor,customer:'cus_'+marker,
 amount_total:500,currency:'eur',metadata:{xenoUserId:contributor,credits:'5',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+marker,'checkout.session.completed',s),{provider:fixture.provider});
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET enabled=true',[contributor]);
 const contribute=amountMicro=>funding.contributeFunding(pool,ctx(contributor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro,consentHash:offer.consentHash,confirmed:true});
 // NFR-03: at most ONE effective contribution, reservation, settlement and result delivery per
 // logical operation, under duplicate requests (concurrent) and restarts (a fresh pool replays them).
 const N=6;
 const settled=rs=>{assert.deepEqual(rs.filter(r=>r.status==='rejected').map(r=>r.reason?.details?.reason||r.reason?.message),[],'duplicates are replays, never failures');return rs.map(r=>r.value);};
 const restarted=()=>{const p2=new pg.Pool({connectionString:url,max:10});t.after(()=>p2.end());return p2;};
 const count=async(sql,args=[])=>Number((await pool.query(sql,args)).rows[0].n);
 const effective=(results,key)=>results.filter(r=>r[key]===false).length;
 const poolB=restarted();

 // 1. CONTRIBUTION -- one row, one set of lots, one pool credit, however many times it is sent.
 const cBody={operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'4000000',consentHash:offer.consentHash,confirmed:true};
 const cs=settled(await Promise.allSettled(Array.from({length:N},()=>funding.contributeFunding(pool,ctx(contributor),cBody))));
 cs.push(await funding.contributeFunding(poolB,ctx(contributor),cBody));
 assert.equal(new Set(cs.map(c=>c.id)).size,1,'every duplicate names the same contribution');
 assert.equal(await count('SELECT count(*) n FROM workforce_funding_contributions WHERE contributor_user_id=$1 AND operation_id=$2',[contributor,cBody.operationId]),1,'one contribution row');
 assert.equal((await pool.query('SELECT sum(amount_micro)::text n FROM workforce_contribution_lots WHERE contribution_id=$1',[cs[0].id])).rows[0].n,'4000000','the lots are funded once, not N times');
 assert.equal((await pool.query('SELECT coalesce(sum(g.amount_micro),0)::text n FROM workforce_contribution_lots l JOIN credit_grants g ON g.id=l.pool_grant_id WHERE l.contribution_id=$1',[cs[0].id])).rows[0].n,'4000000','the pool is credited once');
 assert.equal(effective(cs,'replayed'),1,'exactly one request had the effect; the rest were replays');

 // 2. RESERVATION -- one admission, one funding link, one canonical hold.
 const reqR=request('2000000');
 const rs=settled(await Promise.allSettled(Array.from({length:N},()=>admitRun(pool,ctx(owner),reqR))));
 rs.push(await admitRun(poolB,ctx(owner),reqR));
 const admissionId=rs[0].admission.admissionId;
 assert.equal(new Set(rs.map(r=>r.admission.admissionId)).size,1,'every duplicate names the same admission');
 assert.equal(await count('SELECT count(*) n FROM workforce_run_admissions'),1,'one admission');
 assert.equal(await count('SELECT count(*) n FROM workforce_run_funding'),1,'one funding link');
 assert.equal(await count('SELECT count(*) n FROM credit_holds WHERE user_id=$1',[p.id]),1,'one hold against the pool');
 assert.equal((await pool.query('SELECT amount_micro::text n FROM credit_holds WHERE user_id=$1',[p.id])).rows[0].n,'2000000','the hold reserves the ceiling once');

 // 3. SETTLEMENT -- one settled draw however many times its settlement is sent.
 const ledger=await import('../src/server/utils/creditLedgerV2.js');
 const {authorizeRunStep}=await import('../src/server/services/workforceRunAuthority.js');
 const key=generateKeyPairSync('ec',{namedCurve:'P-256'});
 const signingKey={kid:'nfr03',privatePem:key.privateKey.export({format:'pem',type:'pkcs8'})};
 const lease=(await authorizeRunStep(pool,ctx(owner),{admissionId,operation:'provider_dispatch'},{signingKey})).token;
 const drawId='draw-'+randomUUID();
 await ledger.openRunDrawV2(pool,{admissionId,actorUserId:owner,drawId,lease,model:'claude-opus-5',inputBound:10,outputBound:10});
 const settleBody={admissionId,drawId,providerRequestId:drawId,provider:'xeno-proxy',model:'claude-opus-5',measured:false};
 const ss=settled(await Promise.allSettled(Array.from({length:N},()=>ledger.settleRunDrawV2(pool,settleBody))));
 ss.push(await ledger.settleRunDrawV2(poolB,settleBody));
 assert.equal(await count("SELECT count(*) n FROM credit_hold_draws WHERE draw_id=$1 AND state='settled'",[drawId]),1,'one settled draw');
 assert.equal(new Set(ss.map(s=>String(s.chargedMicro??s.charged_micro))).size,1,'every duplicate reports the same charge');
 const drawRow=(await pool.query('SELECT charged_micro::text n FROM credit_hold_draws WHERE draw_id=$1',[drawId])).rows[0];
 assert.equal(await count('SELECT count(*) n FROM credit_draw_consumption_receipts r JOIN credit_hold_draws d ON d.id=r.draw_row_id WHERE d.draw_id=$1',[drawId]),1,'one consumption record');
 assert.ok(BigInt(drawRow.n)>0n,'the draw was charged');

 // 4. RESULT DELIVERY -- one recorded result, one delivery to the parent.
 const results=await import('../src/server/services/workforceRunResults.js');
 const child=(await admitRun(pool,ctx(owner),request('500000',{parent:{admissionId}}))).admission.admissionId;
 const report={admissionId:child,outcome:'completed',summary:'done',artifacts:[]};
 const reps=settled(await Promise.allSettled(Array.from({length:N},()=>results.reportRunResult(pool,ctx(owner),report))));
 reps.push(await results.reportRunResult(poolB,ctx(owner),report));
 assert.equal(await count('SELECT count(*) n FROM workforce_run_results WHERE admission_id=$1',[child]),1,'one recorded result');
 assert.equal(effective(reps,'replayed'),1,'exactly one report had the effect');
 const del={childAdmissionId:child,parentAdmissionId:admissionId};
 const dels=settled(await Promise.allSettled(Array.from({length:N},()=>results.deliverRunResult(pool,ctx(owner),del))));
 dels.push(await results.deliverRunResult(poolB,ctx(owner),del));
 assert.equal(await count('SELECT count(*) n FROM workforce_run_result_deliveries WHERE child_admission_id=$1',[child]),1,'one delivery to the parent');
 assert.equal(effective(dels,'replayed'),1,'exactly one delivery had the effect');
});
