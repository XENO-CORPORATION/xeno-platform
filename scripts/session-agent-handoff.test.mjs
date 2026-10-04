// SES-04 against real PostgreSQL: Agent->Chat occurs at a safe execution
// boundary -- active workspace operations are stopped/settled first, effects
// settled or explicitly parked, failures named -- then control hands back
// with a confirmed restored read-only posture.
//
// PROVEN: a clean handoff flips agent->chat recording the relinquished root
// and read-only posture; a prepared intent blocks handoff until dispositioned
// (the refusal names it); 'settled' claims are verified terminal (a live
// prepared intent cannot be claimed settled; a committed one can); parked
// and failed dispositions require notes and are recorded verbatim; a held
// run reservation blocks until released; strangers cannot hand off; chat-mode
// conversations cannot hand back.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
import {installBillingProviderFixture} from './fixtures/billing-provider-fixture.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.STRIPE_SECRET_KEY='sk_test_localfixture';process.env.STRIPE_PUBLISHABLE_KEY='pk_test_localfixture';
process.env.STRIPE_EXPECTED_ACCOUNT_ID='acct_fixture';process.env.STRIPE_EXPECTED_MODE='test';
process.env.JWT_SECRET ||= 'publication-milestone-local-fixture';
const fixture=installBillingProviderFixture();
const {handleEvent}=await import('../src/server/services/billingService.js');
const {transitionToAgent,transitionToChat}=await import('../src/server/services/conversationModes.js');
const {resolveProviderCwd}=await import('../src/server/services/providerSessionCwd.js');
const funding=await import('../src/server/services/workforceFunding.js');
const runfunding=await import('../src/server/services/workforceRunFunding.js');
const {admitRun}=await import('../src/server/services/workforceRunAdmission.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('SES-04: handoff only at a safe boundary; effects settled, parked or named',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`s4-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),donor=await user('donor'),mallory=await user('mallory'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:donor,customer:'cus_'+mk,
  amount_total:1500,currency:'eur',metadata:{xenoUserId:donor,credits:'15',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[donor]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'Handoff'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,beneficiary:'H Org',cancellationTerms:'Cancel.',refundTerms:'Unspent.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'12000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'10000000',consentHash:offer.consentHash,confirmed:true});
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const budget=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'10000000',perRunMicro:'10000000',purpose:'H',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:budget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,alice]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,alice,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const root=mkdtempSync(path.join(os.tmpdir(),'ses04-'));
 const agentChat=async title=>{
  const id=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[alice,title])).rows[0].id;
  await resolveProviderCwd(pool,{conversationId:id,sessionRoot:root});
  await transitionToAgent(pool,{conversationId:id,actorUserId:alice,root:{kind:'session-isolated'}});
  return id;
 };
 const intent=(op)=>pool.query(`INSERT INTO account_workspace_operations(actor_user_id,client_id,operation_id,account_incarnation,request_hash,request,state,receipt)
  VALUES($1,'xeno-agent-interface',$2,$3,$4,'{}','prepared','{}')`,[alice,op,'a'.repeat(64),'b'.repeat(64)]);

 // ── Clean handoff: nothing active, posture confirmed read-only.
 const convA=await agentChat('Clean');
 const backA=await transitionToChat(pool,{conversationId:convA,actorUserId:alice});
 assert.deepEqual([backA.fromMode,backA.toMode,backA.handoff.activeOpsAtHandoff,backA.handoff.restoredPosture],
  ['agent','chat',0,'read-only'],'a quiet agent hands back with read-only posture confirmed');
 assert.deepEqual(backA.handoff.relinquishedRoot,{kind:'session-isolated'},'the handoff names the relinquished root');
 assert.equal((await pool.query('SELECT mode FROM chat_conversations WHERE id=$1',[convA])).rows[0].mode,'chat','the mode flips back');

 // ── A prepared intent blocks until explicitly dispositioned.
 const convB=await agentChat('Parked');
 const op1=randomUUID();
 await intent(op1);
 const err=await transitionToChat(pool,{conversationId:convB,actorUserId:alice}).then(()=>null,e=>e);
 assert.deepEqual([err?.message,err?.details?.uncovered],[ 'active_operations',[{kind:'intent',key:`xeno-agent-interface/${op1}`}]],
  'the refusal names the uncovered operation');
 await assert.rejects(transitionToChat(pool,{conversationId:convB,actorUserId:alice,
  dispositions:[{kind:'intent',key:`xeno-agent-interface/${op1}`,action:'settled'}]}),e=>e.message==='settle_not_verified',
  'a still-prepared intent cannot be claimed settled: stop/settle first, verified');
 await assert.rejects(transitionToChat(pool,{conversationId:convB,actorUserId:alice,
  dispositions:[{kind:'intent',key:`xeno-agent-interface/${op1}`,action:'parked'}]}),e=>e.message==='park_note_required',
  'parking without a note is refused: effects are explicitly parked or not at all');
 const backB=await transitionToChat(pool,{conversationId:convB,actorUserId:alice,
  dispositions:[{kind:'intent',key:`xeno-agent-interface/${op1}`,action:'parked',note:'User-visible draft kept; will resume after review.'}]});
 assert.deepEqual(backB.handoff.dispositions,[{kind:'intent',key:`xeno-agent-interface/${op1}`,action:'parked',note:'User-visible draft kept; will resume after review.'}],
  'the parking is recorded verbatim on the handoff');

 // ── Truly settled operations hand back cleanly, including a released run.
 const convC=await agentChat('Settled');
 const op2=randomUUID();
 await intent(op2);
 await pool.query("UPDATE account_workspace_operations SET state='committed' WHERE actor_user_id=$1 AND operation_id=$2",[alice,op2]);
 const run=await admitRun(pool,ctx(alice),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
  target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:'1000000',fundingBudgetId:budget.id}});
 const aid=run.admission.admissionId;
 await assert.rejects(transitionToChat(pool,{conversationId:convC,actorUserId:alice,
  dispositions:[{kind:'admission',key:aid,action:'settled'}]}),e=>e.message==='settle_not_verified',
  'a held run reservation cannot be claimed settled while the hold is live');
 await runfunding.releaseUndispatchedFunding(pool,{actorUserId:alice,clientId:'xeno-agent-interface'},{admissionId:aid});
 const backC=await transitionToChat(pool,{conversationId:convC,actorUserId:alice,
  dispositions:[{kind:'intent',key:`xeno-agent-interface/${op1}`,action:'parked',note:'Still parked from before.'}]});
 assert.deepEqual([backC.handoff.activeOpsAtHandoff,backC.toMode],[1,'chat'],
  'the released run leaves the active set; only the parked intent is accounted');

 // ── Failures are named, strangers refused, chat-mode handoffs refused.
 const convD=await agentChat('Failed');
 const op3=randomUUID();
 await intent(op3);
 await assert.rejects(transitionToChat(pool,{conversationId:convD,actorUserId:alice,
  dispositions:[{kind:'intent',key:`xeno-agent-interface/${op1}`,action:'parked',note:'Carry.'},
   {kind:'intent',key:`xeno-agent-interface/${op3}`,action:'failed'}]}),e=>e.message==='failure_reason_required',
  'a failed operation without its reason is refused: failures are named');
 const backD=await transitionToChat(pool,{conversationId:convD,actorUserId:alice,
  dispositions:[{kind:'intent',key:`xeno-agent-interface/${op1}`,action:'parked',note:'Carry.'},
   {kind:'intent',key:`xeno-agent-interface/${op3}`,action:'failed',note:'Provider error 429 during draft; safe to retry.'}]});
 assert.equal(backD.handoff.dispositions.find(d=>d.action==='failed').note,'Provider error 429 during draft; safe to retry.',
  'the failure reason is recorded on the handoff');
 const convF=await agentChat('Stranger');
 await assert.rejects(transitionToChat(pool,{conversationId:convF,actorUserId:mallory,dispositions:[]}),e=>e.message==='handoff_not_authorized',
  'a stranger cannot hand off someone else\'s conversation');
 const convE=(await pool.query("INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,'StillChat') RETURNING id",[alice])).rows[0].id;
 await assert.rejects(transitionToChat(pool,{conversationId:convE,actorUserId:alice}),e=>e.message==='mode_not_agent',
  'a chat-mode conversation cannot hand back');
});
