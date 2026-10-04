// PUB-09 against real PostgreSQL: external work is contributor-funded
// by default; project money moves only under a separately accepted
// budget grant before dispatch; offering an agent authorizes no spend
// — owner consent to invocation and payer approval are both required;
// and no bounty or payout is implied by acceptance.
//
// PROVEN: the default offer bills the offerer while a foreign payer
// refuses without a grant; grants decide by maintainers only, bind
// the accepter as payer, and transfer nothing on acceptance;
// dispatch needs an accepted live unspent grant plus, for another
// owner's agent, that owner's live task consent — strangers dispatch
// nothing and consent nothing; the dispatcher invoking their own
// agent needs no consent row; expired, revoked and already-spent
// grants refuse; an integrated contribution leaves the money tables
// untouched, so no payout entitlement rides along by implication.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {requestBudgetGrant,acceptBudgetGrant,declineBudgetGrant,revokeBudgetGrant,
 consentAgentInvocation,dispatchProjectFundedWork,readBudgetGrant}=await import('../src/server/services/workFunding.js');
const {submitOffer,acceptOffer}=await import('../src/server/services/participationOffers.js');
const {setContributionPolicy}=await import('../src/server/services/projectPolicies.js');
const {mutateProjectPublication,previewProjectPublication}=await import('../src/server/services/projectPublication.js');
const {submitContribution}=await import('../src/server/services/contributions.js');
const {transitionContribution}=await import('../src/server/services/contributionLifecycle.js');
const {recordReview,integrateContribution}=await import('../src/server/services/submissionIntegrity.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-09: contributor-funded default, granted project spend, consented invocation, no implied bounty',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`p9-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query(
  `INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id`,
  [x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),dev=await user('dev'),stranger=await user('stranger');
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
  VALUES('project',$1,'admin','user',$2)`,[project,owner]);
 const ctx={actorUserId:owner,clientId:`${marker}-pub`};
 const content={schemaVersion:1,title:'Atlas',purpose:'Maps',license:'MIT',termsVersion:'2026-10-04',
  contributionGuide:'Offers welcome',roadmap:'v1',updates:'none'};
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'draft',expectedRevision:'0',content});
 const pv=await previewProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,visibility:'public'});
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'publish',expectedRevision:'1',visibility:'public',previewHash:pv.previewHash});
 await setContributionPolicy(pool,{projectId:project,actorUserId:owner,value:'offers-open'});
 const goal=(await pool.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[project,owner])).rows[0].id;
 const mile=(await pool.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[goal,owner])).rows[0].id;
 const task=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Survey','open') RETURNING id`,[mile])).rows[0].id;
 const agent=(await pool.query(`INSERT INTO workforce_resources(kind,owner_user_id,name) VALUES('agent',$1,'dev-bot') RETURNING id`,[dev])).rows[0].id;
 const ownAgent=(await pool.query(`INSERT INTO workforce_resources(kind,owner_user_id,name) VALUES('agent',$1,'own-bot') RETURNING id`,[owner])).rows[0].id;
 const future=new Date(Date.now()+86400000).toISOString();
 // The default: the offerer pays; project money is not on the table.
 const offered=await submitOffer(pool,{projectId:project,actorUserId:dev,resourceId:agent,
  resourceKind:'agent',taskId:task,payerUserId:dev,spendLimitMicro:1000,expiresAt:future});
 const engaged=await acceptOffer(pool,{offerId:offered.offer.id,actorUserId:owner});
 assert.equal(String(engaged.payer_user_id),String(dev),'the default engagement bills the contributor');
 await assert.rejects(submitOffer(pool,{projectId:project,actorUserId:dev,resourceId:agent,
  resourceKind:'agent',taskId:task,payerUserId:owner,spendLimitMicro:1000,expiresAt:future}),
  e=>/project_funding_requires_grant/.test(e.message),'a foreign payer refuses without a grant');
 // Grants decide by maintainers, bind the payer, and transfer nothing.
 const grant=await requestBudgetGrant(pool,{projectId:project,taskId:task,requesterUserId:dev,
  amountMicro:5000,expiresAt:future});
 assert.equal(grant.state,'proposed','the grant opens proposed');
 await assert.rejects(acceptBudgetGrant(pool,{grantId:grant.id,actorUserId:stranger}),
  e=>/grant_decision_not_authorized/.test(e.message),'a stranger cannot accept a grant');
 const accepted=await acceptBudgetGrant(pool,{grantId:grant.id,actorUserId:owner});
 assert.equal(accepted.state,'accepted','the maintainer accepts the grant');
 assert.equal(String(accepted.payer_user_id),String(owner),'acceptance binds the accepter as payer');
 const money=async who=>({
  gifts:Number((await pool.query(`SELECT count(*) AS n FROM workforce_gifts WHERE recipient_user_id=$1`,[who])).rows[0].n),
  charges:Number((await pool.query(`SELECT count(*) AS n FROM session_budget_charges WHERE user_id=$1`,[who])).rows[0].n),
  approvals:Number((await pool.query(`SELECT count(*) AS n FROM workforce_spend_approvals WHERE owner_user_id=$1`,[who])).rows[0].n),
 });
 assert.deepEqual(await money(dev),{gifts:0,charges:0,approvals:0},'accepting a grant transfers nothing');
 // Dispatch needs the grant, the authority, and — for another owner's
 // agent — that owner's live consent for the task.
 const proposed=await requestBudgetGrant(pool,{projectId:project,taskId:task,requesterUserId:dev,
  amountMicro:5000,expiresAt:future});
 await assert.rejects(dispatchProjectFundedWork(pool,{grantId:proposed.id,dispatcherUserId:owner,resourceId:agent}),
  e=>/grant_not_accepted/.test(e.message),'a merely proposed grant dispatches nothing');
 await assert.rejects(dispatchProjectFundedWork(pool,{grantId:accepted.id,dispatcherUserId:stranger,resourceId:agent}),
  e=>/dispatch_not_authorized/.test(e.message),'a stranger dispatches nothing');
 await assert.rejects(dispatchProjectFundedWork(pool,{grantId:accepted.id,dispatcherUserId:owner,resourceId:agent}),
  e=>/invocation_consent_required/.test(e.message),'offering an agent authorizes no invocation');
 await assert.rejects(consentAgentInvocation(pool,{resourceId:agent,ownerUserId:stranger,taskId:task,expiresAt:future}),
  e=>/consent_not_owner/.test(e.message),'only the resource owner consents');
 await consentAgentInvocation(pool,{resourceId:agent,ownerUserId:dev,taskId:task,expiresAt:future});
 const funded=await dispatchProjectFundedWork(pool,{grantId:accepted.id,dispatcherUserId:owner,resourceId:agent});
 assert.equal(String(funded.payer_user_id),String(owner),'the funded engagement bills the grant payer');
 assert.equal(String(funded.actor_user_id),String(dev),'the funded engagement names the grantee actor');
 assert.equal(Number(funded.spend_limit_micro),5000,'the funded engagement carries the grant cap');
 assert.equal(funded.origin,'grant','the engagement records its grant origin');
 assert.equal(funded.execute_allowed,false,'the grant engagement carries no execution');
 assert.equal((await readBudgetGrant(pool,accepted.id)).state,'dispatched','the grant spends once');
 await assert.rejects(dispatchProjectFundedWork(pool,{grantId:accepted.id,dispatcherUserId:owner,resourceId:agent}),
  e=>/grant_not_accepted/.test(e.message),'a spent grant dispatches nothing more');
 // Ownership is its own consent: the dispatcher invoking their own
 // agent needs no consent row — payer approval still applies.
 const selfGrant=await requestBudgetGrant(pool,{projectId:project,taskId:task,requesterUserId:owner,
  amountMicro:2000,expiresAt:future});
 await acceptBudgetGrant(pool,{grantId:selfGrant.id,actorUserId:owner});
 const selfFunded=await dispatchProjectFundedWork(pool,{grantId:selfGrant.id,dispatcherUserId:owner,resourceId:ownAgent});
 assert.equal(String(selfFunded.payer_user_id),String(owner),'self-dispatch still bills the bound payer');
 // Dead grants refuse: expired, revoked, declined.
 const stale=await requestBudgetGrant(pool,{projectId:project,taskId:task,requesterUserId:dev,
  amountMicro:5000,expiresAt:future});
 await acceptBudgetGrant(pool,{grantId:stale.id,actorUserId:owner});
 await pool.query(`UPDATE project_budget_grants SET created_at = now() - interval '2 days',
  expires_at = now() - interval '1 second' WHERE id=$1`,[stale.id]);
 await assert.rejects(dispatchProjectFundedWork(pool,{grantId:stale.id,dispatcherUserId:owner,resourceId:agent}),
  e=>/grant_expired/.test(e.message),'an expired grant dispatches nothing');
 const doomed=await requestBudgetGrant(pool,{projectId:project,taskId:task,requesterUserId:dev,
  amountMicro:5000,expiresAt:future});
 await acceptBudgetGrant(pool,{grantId:doomed.id,actorUserId:owner});
 await revokeBudgetGrant(pool,{grantId:doomed.id,actorUserId:owner});
 await assert.rejects(dispatchProjectFundedWork(pool,{grantId:doomed.id,dispatcherUserId:owner,resourceId:agent}),
  e=>/grant_not_accepted/.test(e.message),'a revoked grant dispatches nothing');
 const refused=await requestBudgetGrant(pool,{projectId:project,taskId:task,requesterUserId:dev,
  amountMicro:5000,expiresAt:future});
 await declineBudgetGrant(pool,{grantId:refused.id,actorUserId:owner});
 await assert.rejects(dispatchProjectFundedWork(pool,{grantId:refused.id,dispatcherUserId:owner,resourceId:agent}),
  e=>/grant_not_accepted/.test(e.message),'a declined grant dispatches nothing');
 // No implied bounty: an integrated contribution moves no money.
 const record=await submitContribution(pool,{projectId:project,taskId:task,type:'credits',
  authorUserId:dev,responsibleUserId:dev,revisionHash:`lot:${marker}:5000`,evidence:[],
  origin:'original work by the author',rightsLicense:'MIT',artifact:{artifactUrn:`lot:${marker}:5000`}});
 const move=async (to,by)=>transitionContribution(pool,{contributionId:record.id,actorUserId:by,
  toState:to,rationale:`${to} for ${marker}`});
 await move('admitted',owner);await move('in_progress',dev);await move('submitted',dev);
 await move('checks_pending',dev);await move('review',owner);
 await recordReview(pool,{contributionId:record.id,reviewerUserId:owner,revisionNo:1,decision:'approve',
  rationale:'grant verified'});
 await move('accepted',owner);
 await integrateContribution(pool,{contributionId:record.id,actorUserId:owner,expectedRevisionNo:1,
  rationale:'integrate grant'});
 assert.deepEqual(await money(dev),{gifts:0,charges:0,approvals:0},
  'an integrated contribution implies no payout');
});
