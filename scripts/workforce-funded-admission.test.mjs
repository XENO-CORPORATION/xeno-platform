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
const fixture=installBillingProviderFixture();
const {handleEvent}=await import('../src/server/services/billingService.js');
const funding=await import('../src/server/services/workforceFunding.js');
const {admitRun}=await import('../src/server/services/workforceRunAdmission.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('pool admission reserves exact eligible lots atomically and never falls back to personal funds',{skip:!url},async t=>{
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
 const initialContribution=await contribute('1000000');
 const accounting=id=>funding.readContributorFunding(pool,ctx(contributor),{contributionId:id});
 assert.deepEqual((await accounting(initialContribution.id)).amounts,{confirmedMicro:'1000000',committedMicro:'0',consumedMicro:'0',returnedMicro:'0',availableMicro:'1000000',expiredMicro:'0',quarantinedMicro:'0'},
   'contributor accounting starts from actual confirmed lots');
 await assert.rejects(funding.readContributorFunding(pool,ctx(owner),{contributionId:initialContribution.id}),e=>e.details?.reason==='contribution_not_found',
   'project ownership cannot read another contributor private accounting');
 await reject(admitRun(pool,ctx(owner),request('1000000')),'milestone_threshold_unmet','underfunded milestone cannot admit despite approved budget');
 assert.equal((await pool.query('SELECT count(*)::int n FROM workforce_run_admissions')).rows[0].n,0,'failed funding rolls admission back');
 // Drive the real router with sender-bound tokens; a passing service is not an HTTP proof.
 const express=(await import('express')).default;
 const {createRequire}=await import('node:module');
 const jwt=createRequire(new URL('../src/server/package.json',import.meta.url))('jsonwebtoken');
 const {jwkThumbprint,accessTokenHash}=await import('../src/server/utils/dpop.js');
 const {issuer}=await import('../src/server/config/hosts.js');
 const {getSigningKey}=await import('../src/server/utils/oidcProvider.js');
 const {default:router}=await import('../src/server/routes/workforceRoutes.js');
 const signer=await getSigningKey(pool),proofKey=generateKeyPairSync('ec',{namedCurve:'P-256'}),sid=randomUUID(),now=Math.floor(Date.now()/1000);
 const jwk=proofKey.publicKey.export({format:'jwk'}),jkt=jwkThumbprint(jwk);
 await pool.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch) VALUES($1,0) ON CONFLICT DO NOTHING',[owner]);
 await pool.query(`INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at)
 VALUES($1,$2,0,to_timestamp($3),$4,now()+interval '1 hour')`,[sid,owner,now,jkt]);
 const app=express();app.use((req,_res,next)=>{req.db=pool;next();});app.use('/api/workforce',router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const donorSid=randomUUID();
 await pool.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch) VALUES($1,0) ON CONFLICT DO NOTHING',[contributor]);
 await pool.query(`INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at)
 VALUES($1,$2,0,to_timestamp($3),$4,now()+interval '1 hour')`,[donorSid,contributor,now,jkt]);
 const call=async(body,scope='openid workforce:read workforce:manage ledger:spend',path='/api/workforce/run-admissions',actor=owner)=>{
   const token=jwt.sign({sub:actor,sid:actor===contributor?donorSid:sid,auth_epoch:0,auth_time:now,client_id:'xeno-agent-interface',scope,typ:'at+jwt',cnf:{jkt}},
    signer.privatePem,{algorithm:signer.alg,keyid:signer.kid,audience:'xeno-api',expiresIn:'5m',header:{typ:'at+jwt'}});
   const dpop=jwt.sign({jti:randomUUID(),htm:'POST',htu:issuer()+path,ath:accessTokenHash(token),iat:now},proofKey.privateKey,{algorithm:'ES256',header:{typ:'dpop+jwt',jwk}});
   const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{authorization:`DPoP ${token}`,dpop,'content-type':'application/json'},body:JSON.stringify(body)});
   return {status:r.status,body:await r.json().catch(()=>null)};
 };
 const reportPath='/api/workforce/funding/contributions/accounting';
 const financial=await call({contributionId:initialContribution.id},'openid workforce:manage',reportPath,contributor);
 assert.equal(financial.status,200,'contributor accounting is reachable without spending permission');
 assert.equal(financial.body.result.amounts.availableMicro,'1000000','HTTP reports persisted contribution value');
 assert.equal((await call({contributionId:initialContribution.id},undefined,reportPath)).status,404,'HTTP project owner cannot read someone else financial report');
 assert.equal((await call({contributionId:randomUUID()},undefined,reportPath)).status,404,'missing and foreign reports are indistinguishable');
 const denied=await call(request('1000000'));
 assert.deepEqual([denied.status,denied.body?.details?.reason],[403,'milestone_threshold_unmet'],'HTTP reports an actionable pool funding refusal');
 const unscoped=await call(request('1000000'),'openid workforce:read workforce:manage');
 assert.deepEqual([unscoped.status,unscoped.body?.details?.reason],[403,undefined],'workforce-only token never reaches pool reservation');
 const laterContribution=await contribute('3000000');
 await pool.query(`CREATE FUNCTION fail_funding_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture reservation failed'; END $$;
 CREATE TRIGGER fail_funding_fixture BEFORE INSERT ON workforce_run_funding FOR EACH ROW EXECUTE FUNCTION fail_funding_fixture()`);
 try {
   await assert.rejects(admitRun(pool,ctx(owner),request()),/fixture reservation failed/,'a late reservation failure aborts admission');
   assert.equal((await pool.query('SELECT count(*)::int n FROM workforce_run_admissions')).rows[0].n,0,'admission and reservation are one transaction');
   assert.equal((await pool.query('SELECT count(*)::int n FROM credit_holds WHERE user_id=$1',[p.id])).rows[0].n,0,'late failure leaves no orphan hold');
 } finally {await pool.query('DROP TRIGGER fail_funding_fixture ON workforce_run_funding; DROP FUNCTION fail_funding_fixture()');}
 const personalBefore=(await pool.query('SELECT * FROM credit_accounts WHERE user_id=$1',[owner])).rows;
 const req=request(),httpFirst=await call(req);
 assert.equal(httpFirst.status,200,`HTTP pool admission creates a real reservation: ${JSON.stringify(httpFirst.body)}`);
 const first=httpFirst.body;
 assert.deepEqual(first.admission.payer,{kind:'project_pool',userId:p.id},'selected payer is the actual pool');
 const records=(await pool.query('SELECT * FROM workforce_run_funding')).rows;
 assert.equal(records.length,1,'admission creates one durable funding link');
 const hold=(await pool.query('SELECT * FROM credit_holds WHERE id=$1',[records[0].hold_row_id])).rows[0];
 assert.equal(hold.amount_micro,'2000000','canonical hold reserves the exact admitted ceiling');
 assert.equal((await pool.query('SELECT sum(reserved_micro)::text n FROM credit_hold_funding WHERE hold_row_id=$1',[hold.id])).rows[0].n,'2000000','reservation is allocated to real contribution lots');
 const replay=await admitRun(pool,ctx(owner),req);assert.equal(replay.admission.admissionId,first.admission.admissionId,'same admission retry reuses its hold');
 const child=await admitRun(pool,ctx(owner),request('500000',{parent:{admissionId:first.admission.admissionId}}));
 assert.equal((await pool.query('SELECT hold_row_id FROM workforce_run_funding WHERE admission_id=$1',[child.admission.admissionId])).rows[0].hold_row_id,hold.id,'child carves its parent hold rather than reserving again');
 assert.equal((await pool.query('SELECT count(*)::int n FROM credit_holds WHERE user_id=$1',[p.id])).rows[0].n,1,'child is not counted twice against the pool');
 const races=await Promise.allSettled([admitRun(pool,ctx(owner),request()),admitRun(pool,ctx(owner),request())]);
 assert.equal(races.filter(x=>x.status==='fulfilled').length,1,'two roots cannot reserve the same remaining pool value');
 assert.equal(races.find(x=>x.status==='rejected').reason.details.reason,'funding_pool_limit');
 assert.deepEqual((await pool.query('SELECT * FROM credit_accounts WHERE user_id=$1',[owner])).rows,personalBefore,'pool admission never creates or debits a personal fallback wallet');
 const {sweepExpiredHolds}=await import('../src/server/utils/creditLedgerV2.js');
 await pool.query("UPDATE credit_holds SET expires_at=now()-interval '1 hour' WHERE user_id=$1",[p.id]);
 await sweepExpiredHolds(pool);
 assert.equal((await pool.query("SELECT count(*)::int n FROM credit_holds WHERE user_id=$1 AND state='held'",[p.id])).rows[0].n,2,'expired pool holds remain committed until settlement proof');
 const {readWorkforceCapacity}=await import('../src/server/services/workforceCapacity.js');
 const capacity=()=>readWorkforceCapacity(pool,ctx(owner),{owner:{type:'user',id:owner},expectedActorAccountId:owner});
 const expiredCapacity=await capacity();
 assert.equal(expiredCapacity.funding.find(f=>f.payerUserId===p.id)?.availableMicro,'0',
   'capacity never releases an expired pool commitment');
 assert.equal(expiredCapacity.committedCeilingMicro,'4000000','pool commitment counts each root hold once');
 const heldReports=await Promise.all([initialContribution.id,laterContribution.id].map(accounting));
 assert.equal(heldReports.reduce((n,r)=>n+BigInt(r.amounts.committedMicro),0n),4000000n,'contributor reports retain exact expired-hold commitments');
 const httpCapacity=await call({owner:{type:'user',id:owner},expectedActorAccountId:owner},undefined,'/api/workforce/capacity');
 assert.deepEqual([httpCapacity.status,httpCapacity.body?.committedCeilingMicro,httpCapacity.body?.funding?.find(f=>f.payerUserId===p.id)?.availableMicro],
   [200,'4000000','0'],'HTTP capacity projects real pool commitments without expired-hold headroom');
 const {authorizeRunStep}=await import('../src/server/services/workforceRunAuthority.js');
 const key=generateKeyPairSync('ec',{namedCurve:'P-256'});
 const signingKey={kid:'isolated-test',privatePem:key.privateKey.export({format:'pem',type:'pkcs8'})};
 const step=operation=>authorizeRunStep(pool,ctx(owner),{admissionId:first.admission.admissionId,operation,...(operation==='privileged_call'?{capability:'files.read'}:{})},{signingKey});
 assert.ok((await step('privileged_call')).token,'live approval permits an otherwise authorized non-provider step');
 await reject(step('provider_dispatch'),'bounded_provider_dispatch_required','generic lease cannot authorize unbounded pooled provider dispatch');
 const releasePath='/api/workforce/funding/runs/release-undispatched';
 const noRelease=await call({admissionId:first.admission.admissionId},undefined,releasePath);
 assert.deepEqual([noRelease.status,noRelease.body?.details?.reason],[409,'provider_liability_unresolved'],
  'any execution lease prevents a claimed undispatched release');
 const untouched=races.find(x=>x.status==='fulfilled').value.admission.admissionId;
 assert.equal((await call({admissionId:untouched},'openid workforce:read workforce:manage',releasePath)).status,403,
  'release of a funded reservation requires spending scope');
 const released=await call({admissionId:untouched},undefined,releasePath);
 assert.deepEqual([released.status,released.body?.result?.state],[200,'released'],'HTTP releases a provably never-leased reservation');
 assert.equal((await call({admissionId:untouched},undefined,releasePath)).body.result.replayed,true,'undispatched release is idempotent');
 const {createServiceLedgerRouter}=await import('../src/server/routes/serviceLedgerRoutes.js');
 const serviceApp=express();serviceApp.use(express.json());serviceApp.use((req,_res,next)=>{req.db=pool;next();});
 serviceApp.use('/api/v2/ledger/service',createServiceLedgerRouter({getServiceToken:()=> 'isolated-service-secret'}));
 const service=serviceApp.listen(0,'127.0.0.1');await new Promise(r=>service.once('listening',r));
 t.after(async()=>{service.closeAllConnections();await new Promise(r=>service.close(r));});
 const settle=async(body,token='isolated-service-secret')=>{
   const r=await fetch(`http://127.0.0.1:${service.address().port}/api/v2/ledger/service/project-runs/settle`,{method:'POST',
     headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
   return {status:r.status,body:await r.json()};
 };
 const next=(await admitRun(pool,ctx(owner),request())).admission;
 const receipt={admissionId:next.admissionId,eventId:'usage_'+marker,providerRequestId:'provider_'+marker,provider:'isolated-provider',
   model:price.model,inputTokens:1000,outputTokens:1000,measured:true,allWorkTerminal:true};
 const beforeSettle=(await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1',[p.id])).rows[0].balance;
 assert.equal((await settle(receipt,'wrong')).status,401,'only authenticated backend services may submit usage receipts');
 assert.equal((await settle({...receipt,measured:false})).status,400,'unmeasured pooled usage never consumes a guessed amount');
 assert.equal((await settle({...receipt,allWorkTerminal:false})).status,400,'partial work cannot release the aggregate reservation');
 assert.equal((await settle({...receipt,actualCostMicro:1})).status,400,'service callers submit usage rather than monetary charges');
 await pool.query(`CREATE FUNCTION fail_settle_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture receipt failed'; END $$;
 CREATE TRIGGER fail_settle_fixture BEFORE INSERT ON workforce_funding_settlements FOR EACH ROW EXECUTE FUNCTION fail_settle_fixture()`);
 try {
   assert.equal((await settle(receipt)).status,500,'failed terminal receipt refuses settlement');
   assert.equal((await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1',[p.id])).rows[0].balance,beforeSettle,'receipt failure rolls back posted charge');
   assert.equal((await pool.query('SELECT state FROM credit_holds WHERE hold_id=$1',[next.admissionId])).rows[0].state,'held','receipt failure keeps the reservation committed');
 }finally{await pool.query('DROP TRIGGER fail_settle_fixture ON workforce_funding_settlements; DROP FUNCTION fail_settle_fixture()');}
 const posted=await settle(receipt);
 assert.deepEqual([posted.status,posted.body.pricedMicro,posted.body.chargedMicro,posted.body.liabilityMicro,posted.body.state],
   [200,'4000000','2000000','2000000','reconciliation_required'],'overrun is platform liability, never an extra contributor debit');
 assert.equal((await settle(receipt)).body.replayed,true,'duplicate final usage cannot charge twice');
 assert.equal((await settle({...receipt,outputTokens:999})).status,409,'changed receipt replay conflicts');
 assert.equal((await pool.query("SELECT count(*)::int n FROM credit_transactions WHERE user_id=$1 AND reference_type='xeno.hold' AND reference_id=$2",[p.id,next.admissionId])).rows[0].n,1,
   'settlement appends exactly one canonical journal entry');
 assert.equal((await pool.query('SELECT count(*)::int n FROM api_usage_logs WHERE user_id=$1 AND request_id=$2',[p.id,next.admissionId])).rows[0].n,1,
   'settlement reaches canonical usage analytics');
 const {verifyChainV2}=await import('../src/server/utils/creditLedgerV2.js');
 assert.equal((await verifyChainV2(pool,p.id)).ok,true,'pool settlement preserves the canonical hash chain');
 assert.equal((await capacity()).committedCeilingMicro,'2000000','settlement stops counting a released pool reservation as committed');
 // A separate milestone proves ordinary below-ceiling settlement and return,
 // not only the exceptional overrun/quarantine branches above.
 const c2=await funding.createFundingCampaign(pool,ctx(owner),{operationId:randomUUID(),projectId:project.id,beneficiary:'Small delivery',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
 const m2=await funding.createFundingMilestone(pool,ctx(owner),{campaignId:c2.id,key:'small',title:'Small',criteria:['Tests'],thresholdMicro:'100000',budgetMaxMicro:'1000000'});
 await funding.openFundingCampaign(pool,ctx(owner),{campaignId:c2.id});
 const o2=await funding.readFundingOffer(pool,ctx(contributor),{campaignId:c2.id,milestoneId:m2.id});
 const p2=(await pool.query('SELECT id FROM workforce_funding_pools WHERE milestone_id=$1',[m2.id])).rows[0].id;
 const price2=await funding.readFundingPrice(pool,ctx(planner),{poolId:p2,model:price.model});
 const b2=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p2,spenderUserId:owner,maximumMicro:'1000000',perRunMicro:'500000',purpose:'Small delivery',termsHash:o2.consentHash,...price2});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:b2.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const contribution2=await funding.contributeFunding(pool,ctx(contributor),{operationId:randomUUID(),campaignId:c2.id,milestoneId:m2.id,amountMicro:'1000000',consentHash:o2.consentHash,confirmed:true});
 const small=(await admitRun(pool,ctx(owner),request('500000',{budget:{ceilingMicro:'500000',fundingBudgetId:b2.id}}))).admission;
 assert.equal((await settle({...receipt,admissionId:small.admissionId,eventId:'duplicate_provider_'+marker})).status,409,
   'one provider receipt cannot settle two different reservations');
 const smallReceipt={...receipt,admissionId:small.admissionId,eventId:'small_'+marker,providerRequestId:'small_provider_'+marker,inputTokens:1,outputTokens:1};
 const settledSmall=await settle(smallReceipt);
 assert.deepEqual([settledSmall.status,settledSmall.body.chargedMicro,settledSmall.body.liabilityMicro,settledSmall.body.state],[200,'4000','0','settled'],
   'below-ceiling usage charges only authoritative measured cost');
 const returnedSmall=await funding.returnFundingContribution(pool,ctx(contributor),{contributionId:contribution2.id});
 assert.equal(returnedSmall.amountMicro,'996000','unused reserved value returns to its original contributor after terminal settlement');
 const returnedReport=await accounting(contribution2.id);
 assert.deepEqual(returnedReport.amounts,{confirmedMicro:'1000000',committedMicro:'0',consumedMicro:'4000',returnedMicro:'996000',availableMicro:'0',expiredMicro:'0',quarantinedMicro:'0'},
   'accounting distinguishes measured consumption from returned value without double counting');
 assert.equal((await verifyChainV2(pool,p2)).ok,true,'usage then return preserve the same canonical journal');
 const dispute=fixture.event('evt_dispute_'+marker,'charge.dispute.funds_withdrawn',{payment_intent:s.payment_intent,amount:500});
 await handleEvent(pool,dispute,{provider:fixture.provider});
 await reject(step('privileged_call'),'pool_origin_quarantined','quarantined reserved origin blocks new funded steps');
 assert.equal((await pool.query("SELECT count(*)::int n FROM credit_holds WHERE user_id=$1 AND state='held'",[p.id])).rows[0].n,1,
   'quarantine cannot release uncertain commitments');
 await funding.revokeFundingBudget(pool,ctx(approver),{budgetId:proposal.id,expectedRevision:'2'});
 await reject(step('privileged_call'),'funding_budget_unavailable','revocation blocks the next funded run step without releasing liability');
 const {revokeRun}=await import('../src/server/services/workforceRunAuthority.js');
 await revokeRun(pool,ctx(owner),first.admission.admissionId);
 const revokedCapacity=await capacity();
 assert.equal(revokedCapacity.committedCeilingMicro,'2000000','revocation preserves financially unresolved pool commitments');
 assert.equal(revokedCapacity.funding.find(f=>f.payerUserId===p.id)?.availableMicro,'0','quarantined pool value never appears as available capacity');
 await reject(admitRun(pool,ctx(owner),request('1')),'funding_budget_unavailable','revoked budget cannot admit another run');
 const quarantineReceipt={...receipt,admissionId:first.admission.admissionId,eventId:'quarantined_'+marker,providerRequestId:'quarantined_provider_'+marker,inputTokens:100,outputTokens:100};
 const quarantineSettle=await settle(quarantineReceipt);
 assert.deepEqual([quarantineSettle.status,quarantineSettle.body.chargedMicro,quarantineSettle.body.liabilityMicro],[200,'0','400000'],
   'authoritative completion after revocation records quarantined loss without taking unrelated value');
 assert.equal((await pool.query("SELECT count(*)::int n FROM credit_holds WHERE user_id=$1 AND state='held'",[p.id])).rows[0].n,0,
   'only terminal receipts release the remaining uncertain commitments');
 const finalCapacity=await capacity();
 assert.equal(finalCapacity.committedCeilingMicro,'0','terminal settlement clears only the settled financial commitment');
 assert.equal(finalCapacity.funding.find(f=>f.payerUserId===p.id)?.availableMicro,'0',
   'settling a hold cannot make quarantined residual value available');
 const finalReports=await Promise.all([initialContribution.id,laterContribution.id].map(accounting));
 assert.equal(finalReports.reduce((n,r)=>n+BigInt(r.amounts.quarantinedMicro),0n),2000000n,'accounting preserves quarantined residual value as a separate category');
 assert.equal(finalReports.reduce((n,r)=>n+BigInt(r.amounts.consumedMicro),0n),2000000n,'accounting reports only actual charged consumption, not platform liability');
 assert.ok(finalReports.every(r=>r.reconciliationRequired),'contributors see their payment-origin dispute without private provider data');
 assert.ok(finalReports.every(r=>!JSON.stringify(r).includes('providerRequestId')&&!JSON.stringify(r).includes('price_snapshot')),'contributor projections exclude provider receipts and internal prices');
 await t.test('approved rolling caps count posted spend plus every unresolved root',async()=>{
   const donor=await user(),tag=randomUUID().replaceAll('-','');
   const checkout={...s,id:'cs_'+tag,payment_intent:'pi_'+tag,client_reference_id:donor,metadata:{xenoUserId:donor,credits:'5',kind:'credits'}};
   await handleEvent(pool,fixture.event('evt_'+tag,'checkout.session.completed',checkout),{provider:fixture.provider});
   await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[donor]);
   const c=await funding.createFundingCampaign(pool,ctx(owner),{operationId:randomUUID(),projectId:project.id,beneficiary:'Windowed work',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
   const m=await funding.createFundingMilestone(pool,ctx(owner),{campaignId:c.id,key:'window',title:'Window',criteria:['Review'],thresholdMicro:'1',budgetMaxMicro:'5000000'});
   await funding.openFundingCampaign(pool,ctx(owner),{campaignId:c.id});
   const o=await funding.readFundingOffer(pool,ctx(donor),{campaignId:c.id,milestoneId:m.id});
   const dest=(await pool.query('SELECT id FROM workforce_funding_pools WHERE milestone_id=$1',[m.id])).rows[0].id;
   const rate=await funding.readFundingPrice(pool,ctx(planner),{poolId:dest,model:price.model});
   // Authenticated owner can plan too, but still needs a different approver.
   const proposal={operationId:randomUUID(),poolId:dest,spenderUserId:owner,maximumMicro:'5000000',perRunMicro:'1500000',purpose:'Rolling cap',termsHash:o.consentHash,...rate,window:{seconds:3600,limitMicro:'2000000'}};
   const proposed=await call(proposal,undefined,'/api/workforce/funding/budgets');
   assert.equal(proposed.status,200,'HTTP accepts an explicit bounded window proposal');
   const b=proposed.body.result;
   assert.equal((await call({...proposal,window:{seconds:3600,limitMicro:'2500000'}},undefined,'/api/workforce/funding/budgets')).status,409,
     'a changed period limit cannot replay the original budget operation');
   for(const window of [{seconds:0,limitMicro:'2000000'},{seconds:3600,limitMicro:'1000000'},{seconds:3600,limitMicro:'6000000'},{seconds:1.5,limitMicro:'2000000'}]) {
     assert.equal((await call({...proposal,operationId:randomUUID(),window},undefined,'/api/workforce/funding/budgets')).status,400,
       'HTTP rejects invalid or inconsistent budget windows');
   }
   assert.deepEqual(b.window,{seconds:3600,limitMicro:'2000000'},'proposal and readback retain the exact window policy');
   await funding.decideFundingBudget(pool,ctx(approver),{budgetId:b.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
   await assert.rejects(pool.query('UPDATE workforce_funding_budgets SET window_limit_micro=3000000 WHERE id=$1',[b.id]),{code:'23514'},'approved period cap cannot be widened in place');
   const {readFile}=await import('node:fs/promises');
   const windowMigration=await readFile(new URL('../src/server/database/migrations/20260928170000-workforce-budget-windows.sql',import.meta.url),'utf8');
   await assert.rejects(pool.query(windowMigration.split('-- DOWN')[1]),{code:'23514'},'rollback refuses to erase an approved period limit');
   await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:c.id,milestoneId:m.id,amountMicro:'4000000',consentHash:o.consentHash,confirmed:true});
   const ask=amount=>request(amount,{budget:{ceilingMicro:amount,fundingBudgetId:b.id}});
   const concurrent=await Promise.allSettled([admitRun(pool,ctx(owner),ask('1500000')),admitRun(pool,ctx(owner),ask('1500000'))]);
   assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1,'concurrent reservations cannot oversell a rolling cap');
   assert.equal(concurrent.find(x=>x.status==='rejected').reason.details.reason,'funding_window_limit');
   const admitted=concurrent.find(x=>x.status==='fulfilled').value.admission.admissionId;
   await pool.query("UPDATE credit_holds SET expires_at=now()-interval '2 hours',created_at=now()-interval '2 hours' WHERE hold_id=$1",[admitted]);
   await reject(admitRun(pool,ctx(owner),ask('600000')),'funding_window_limit','old unresolved work counts even outside the rolling window');
   const finalReceipt={...receipt,admissionId:admitted,eventId:'window_'+tag,providerRequestId:'window_provider_'+tag,inputTokens:100,outputTokens:100};
   assert.equal((await settle(finalReceipt)).body.chargedMicro,'400000','settlement replaces commitment with exact posted spend');
   await admitRun(pool,ctx(owner),ask('1500000'));
   await reject(admitRun(pool,ctx(owner),ask('100001')),'funding_window_limit','recent posted spend and active holds share one cap');
 });
});
