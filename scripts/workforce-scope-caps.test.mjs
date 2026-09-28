// Aggregate project/workspace caps over canonical holds, not local counters.
import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID,createHash,generateKeyPairSync} from 'node:crypto';import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
import {installBillingProviderFixture} from './fixtures/billing-provider-fixture.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.STRIPE_SECRET_KEY='sk_test_localfixture';process.env.STRIPE_PUBLISHABLE_KEY='pk_test_localfixture';
process.env.STRIPE_EXPECTED_ACCOUNT_ID='acct_fixture';process.env.STRIPE_EXPECTED_MODE='test';
const fixture=installBillingProviderFixture();
const {handleEvent}=await import('../src/server/services/billingService.js');
const funding=await import('../src/server/services/workforceFunding.js');
const {admitRun}=await import('../src/server/services/workforceRunAdmission.js');
const {releaseUndispatchedFunding}=await import('../src/server/services/workforceRunFunding.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('independent scope decisions constrain sibling pools and projects atomically',{skip:!url},async t=>{
 const db=new pg.Pool({connectionString:url,max:10});t.after(()=>db.end());await runAllMigrations(db);await migrateAccountV2(db);
 const user=async()=>{const x=randomUUID();return(await db.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user(),approver=await user(),planner=await user(),donor=await user(),outsider=await user();
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const ws=(await db.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id',[owner,randomUUID()])).rows[0].id;
 await db.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES
 ('workspace',$1,'owner','user',$2),('workspace',$1,'owner','user',$3),('workspace',$1,'editor','user',$4)`,[ws,owner,approver,planner]);
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await db.query("INSERT INTO workforce_resources(id,kind,owner_workspace_id,name) VALUES($1,'agent',$2,'Runner')",[resource,ws]);
 await db.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const policy={schemaVersion:1,mode:'explicit',capabilities:['files.read']};
 const assignment=(await db.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,resource_revision,policy)
 VALUES($1,'agent',$2,$2,1,$3) RETURNING id`,[resource,ws,policy])).rows[0].id;
 await db.query(`UPDATE workforce_workspace_assignments SET state='accepted',revision=revision+1,source_approved_by_user_id=$2,source_approved_at=now(),
 target_accepted_by_user_id=$2,accepted_at=now(),updated_at=now() WHERE id=$1`,[assignment,owner]);
 const tag=randomUUID().replaceAll('-','');
 await handleEvent(db,fixture.event('evt_'+tag,'checkout.session.completed',{id:'cs_'+tag,payment_intent:'pi_'+tag,mode:'payment',payment_status:'paid',amount_total:500,currency:'eur',client_reference_id:donor,metadata:{xenoUserId:donor,credits:'5',kind:'credits'}}),{provider:fixture.provider});
 await db.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[donor]);
 const makeProject=async()=>{
  const project=await createAuthorizedProject(db,{principal:userPrincipal(owner),workspaceId:ws,name:'Scope '+randomUUID()});
  const participation=(await db.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,workspace_id,assignment_id,responsibility,policy)
    VALUES($1,'agent',$2,'workspace',$3,$4,'worker',$5) RETURNING id`,[resource,project.id,ws,assignment,policy])).rows[0].id;
  return {projectId:project.id,participationId:participation};
 };
 const a=await makeProject(),b=await makeProject();
 const makePool=async target=>{
  const c=await funding.createFundingCampaign(db,ctx(owner),{operationId:randomUUID(),projectId:target.projectId,beneficiary:'Delivery',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
  const m=await funding.createFundingMilestone(db,ctx(owner),{campaignId:c.id,key:'first',title:'First',criteria:['Review'],thresholdMicro:'1',budgetMaxMicro:'5000000'});
  await funding.openFundingCampaign(db,ctx(owner),{campaignId:c.id});
  const offer=await funding.readFundingOffer(db,ctx(owner),{campaignId:c.id,milestoneId:m.id});
  const poolId=(await db.query('SELECT id FROM workforce_funding_pools WHERE milestone_id=$1',[m.id])).rows[0].id;
  const rate=await funding.readFundingPrice(db,ctx(planner),{poolId,model:'claude-opus-5'});
  const budget=await funding.proposeFundingBudget(db,ctx(planner),{operationId:randomUUID(),poolId,spenderUserId:owner,maximumMicro:'5000000',perRunMicro:'1500000',purpose:'Delivery',termsHash:offer.consentHash,...rate});
  await funding.decideFundingBudget(db,ctx(approver),{budgetId:budget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
  await funding.contributeFunding(db,ctx(donor),{operationId:randomUUID(),campaignId:c.id,milestoneId:m.id,amountMicro:'1500000',consentHash:offer.consentHash,confirmed:true});
  return {...target,poolId,budgetId:budget.id};
 };
 const pools=[await makePool(a),await makePool(a),await makePool(b)];
 const admit=(p,amount='1500000')=>admitRun(db,ctx(owner),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},target:{kind:'project',projectId:p.projectId,participationId:p.participationId},capabilities:['files.read'],budget:{ceilingMicro:amount,fundingBudgetId:p.budgetId}});
 const propose=scope=>funding.proposeScopeSpendCap(db,ctx(planner),{operationId:randomUUID(),scope,windowSeconds:3600,limitMicro:'2000000'});
 const projectScope={kind:'project',id:a.projectId},workspaceScope={kind:'workspace',id:ws};
 await assert.rejects(propose({kind:'project',id:randomUUID()}));
 await assert.rejects(funding.proposeScopeSpendCap(db,ctx(outsider),{operationId:randomUUID(),scope:workspaceScope,windowSeconds:3600,limitMicro:'1'}),e=>e.details?.reason==='scope_not_found','outsider cannot propose a workspace spending policy');
 const express=(await import('express')).default;
 const {createRequire}=await import('node:module');
 const jwt=createRequire(new URL('../src/server/package.json',import.meta.url))('jsonwebtoken');
 const {jwkThumbprint,accessTokenHash}=await import('../src/server/utils/dpop.js');
 const {issuer}=await import('../src/server/config/hosts.js');
 const {getSigningKey}=await import('../src/server/utils/oidcProvider.js');
 const {default:router}=await import('../src/server/routes/workforceRoutes.js');
 const signer=await getSigningKey(db),key=generateKeyPairSync('ec',{namedCurve:'P-256'}),jwk=key.publicKey.export({format:'jwk'}),jkt=jwkThumbprint(jwk),now=Math.floor(Date.now()/1000),sessions=new Map();
 for(const id of [owner,planner,approver]){const sid=randomUUID();sessions.set(id,sid);await db.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch) VALUES($1,0) ON CONFLICT DO NOTHING',[id]);
  await db.query(`INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at) VALUES($1,$2,0,to_timestamp($3),$4,now()+interval '1 hour')`,[sid,id,now,jkt]);}
 const app=express();app.use((req,_res,next)=>{req.db=db;next();});app.use('/api/workforce',router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const call=async(path,body,{actor=planner,scope='openid workforce:manage ledger:spend',authTime=now}={})=>{
  const token=jwt.sign({sub:actor,sid:sessions.get(actor),auth_epoch:0,auth_time:authTime,client_id:'xeno-agent-interface',scope,cnf:{jkt}},signer.privatePem,{algorithm:signer.alg,keyid:signer.kid,audience:'xeno-api',expiresIn:'5m',header:{typ:'at+jwt'}});
  const full='/api/workforce/funding'+path,dpop=jwt.sign({jti:randomUUID(),htm:'POST',htu:issuer()+full,ath:accessTokenHash(token),iat:now},key.privateKey,{algorithm:'ES256',header:{typ:'dpop+jwt',jwk}});
  const r=await fetch(`http://127.0.0.1:${server.address().port}${full}`,{method:'POST',headers:{authorization:`DPoP ${token}`,dpop,'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json().catch(()=>null)};
 };
 const capRequest={operationId:randomUUID(),scope:projectScope,windowSeconds:3600,limitMicro:'2000000'};
 const http=await call('/scope-caps',capRequest);assert.equal(http.status,200,`scope cap proposal is reachable over HTTP: ${JSON.stringify(http.body)}`);
 const pc=http.body.result,wc=await propose(workspaceScope);
 assert.equal((await call('/scope-caps',capRequest)).body.result.replayed,true,'HTTP retry retains the scope proposal');
 assert.equal((await call('/scope-caps',{...capRequest,limitMicro:'1'})).status,409,'HTTP scope replay rejects changed limits');
 assert.equal((await call('/scope-caps',capRequest,{authTime:now-3600})).status,401,'scope-cap changes require recent authentication');
 const decide=c=>({capId:c.id,operationId:randomUUID(),decision:'approved',expectedActiveId:null});
 await assert.rejects(funding.decideScopeSpendCap(db,ctx(planner),decide(pc)),e=>e.details?.reason==='project_not_found','planning authority is not approval authority');
 await db.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'owner','user',$2)",[a.projectId,planner]);
 await assert.rejects(funding.decideScopeSpendCap(db,ctx(planner),decide(pc)),e=>e.details?.reason==='independent_budget_approval_required','a manager cannot approve their own aggregate cap');
 const pcDecision=decide(pc);
 assert.equal((await call('/scope-caps/decide',pcDecision,{actor:approver,scope:'openid workforce:manage'})).status,403,
   'scope approval requires spending scope separately from configuration');
 assert.equal((await call('/scope-caps/decide',pcDecision,{actor:approver})).status,200,'scope approval uses the real authenticated route');
 assert.equal((await call('/scope-caps/read',{scope:projectScope},{actor:owner})).body.result.caps[0].state,'approved','HTTP scope policy read exposes the retained decision');
 const race=await Promise.allSettled(pools.slice(0,2).map(p=>admit(p)));
 assert.equal(race.filter(x=>x.status==='fulfilled').length,1,'sibling pools share one project cap under concurrency');
 assert.equal(race.find(x=>x.status==='rejected').reason.details.reason,'funding_scope_limit');
 await funding.decideScopeSpendCap(db,ctx(approver),decide(wc));
 await assert.rejects(admit(pools[2]),e=>e.details?.reason==='funding_scope_limit','another project cannot evade the workspace cap');
 const root=race.find(x=>x.status==='fulfilled').value.admission.admissionId;
 await db.query("UPDATE credit_holds SET expires_at=now()-interval '2 hours',created_at=now()-interval '2 hours' WHERE hold_id=$1",[root]);
 await assert.rejects(admit(pools[2]),e=>e.details?.reason==='funding_scope_limit','scope caps retain old unresolved commitments');
 await releaseUndispatchedFunding(db,ctx(owner),{admissionId:root});
 const next=await admit(pools[2]);assert.equal(next.admission.payer.userId,pools[2].poolId,'proved release restores aggregate headroom');
 const replacement=await funding.proposeScopeSpendCap(db,ctx(planner),{operationId:randomUUID(),scope:workspaceScope,windowSeconds:3600,limitMicro:'4000000'});
 await assert.rejects(funding.decideScopeSpendCap(db,ctx(approver),decide(replacement)),e=>e.details?.reason==='scope_cap_changed','replacement must name the active policy it supersedes');
 await funding.decideScopeSpendCap(db,ctx(approver),{...decide(replacement),expectedActiveId:wc.id});
 const history=await funding.readScopeSpendCaps(db,ctx(owner),{scope:workspaceScope});
 assert.deepEqual(history.caps.map(x=>x.state),['superseded','approved'],'replacement preserves prior scope decisions');
 await assert.rejects(db.query('DELETE FROM workforce_scope_spend_caps WHERE id=$1',[wc.id]),{code:'23514'},'scope policy history cannot be deleted');
 const active=(await admit(pools[0])).admission;
 const {settleProjectRunV2}=await import('../src/server/utils/creditLedgerV2.js');
 await settleProjectRunV2(db,{admissionId:next.admission.admissionId,eventId:'scope_usage_'+tag,providerRequestId:'scope_provider_'+tag,provider:'fixture',model:'claude-opus-5',inputTokens:100,outputTokens:100,measured:true,allWorkTerminal:true});
 const tighter=await funding.proposeScopeSpendCap(db,ctx(planner),{operationId:randomUUID(),scope:workspaceScope,windowSeconds:3600,limitMicro:'2000000'});
 await funding.decideScopeSpendCap(db,ctx(approver),{...decide(tighter),expectedActiveId:replacement.id});
 await assert.rejects(admit(pools[2],'100001'),e=>e.details?.reason==='funding_scope_limit','scope cap counts recent settled debits plus commitments in other projects');
 const {readFile}=await import('node:fs/promises');
 const migration=await readFile(new URL('../src/server/database/migrations/20260928180000-workforce-scope-spend-caps.sql',import.meta.url),'utf8');
 await assert.rejects(db.query(migration.split('-- DOWN')[1]),{code:'23514'},'rollback cannot erase retained scope approvals');
 assert.ok(active.admissionId);
});
