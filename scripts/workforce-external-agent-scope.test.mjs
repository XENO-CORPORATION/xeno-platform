// PUB-08 against real PostgreSQL: external contributors' agents run
// under scoped identities that cannot see internal-only data, with one
// uniform gate fronting every internal surface.
//
// PROVEN: binding verifies the maintainer, the live engagement and the
// agent-ownership chain, and caps scope at engagement expiry; the agent
// reads its own task, engagement, claims, contributions, transitions,
// working-memory conversations and a redacted project card; internal
// conversations, credentials, other projects and tasks, sibling claims,
// others' contributions and reviews, and unaccepted drafts all fail
// closed; expired scopes and unscoped agents read nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {bindExternalAgent,readScopedTask,readScopedEngagement,readScopedClaim,readScopedContribution,
  readScopedTransitions,readScopedConversation,readScopedProject,readScopedCredential,readScopedDraft}=await import('../src/server/services/externalAgentScope.js');
const {submitOffer,acceptOffer}=await import('../src/server/services/participationOffers.js');
const {setContributionPolicy}=await import('../src/server/services/projectPolicies.js');
const {mutateProjectPublication,previewProjectPublication}=await import('../src/server/services/projectPublication.js');
const {submitContribution}=await import('../src/server/services/contributions.js');
const {transitionContribution}=await import('../src/server/services/contributionLifecycle.js');
const {claimTask}=await import('../src/server/services/taskClaims.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-08: scoped external agents see their own work; internal surfaces fail closed',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`p8-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),dev=await user('dev'),bot=await user('bot'),stranger=await user('stranger'),spy=await user('spy'),lone=await user('lone');
 await pool.query(`INSERT INTO agent_identities(user_id,owner_user_id,agent_role) VALUES($1,$2,'research'),($3,$4,'research')`,[bot,dev,spy,stranger]);
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 const other=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Other'])).rows[0].id;
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'admin','user',$2)`,[project,owner]);
 const ctx={actorUserId:owner,clientId:'pub8'};
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
 const task2=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Bounty','open') RETURNING id`,[mile])).rows[0].id;
 const ogoal=(await pool.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[other,owner])).rows[0].id;
 const omile=(await pool.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[ogoal,owner])).rows[0].id;
 const foreign=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Elsewhere','open') RETURNING id`,[omile])).rows[0].id;
 const agent=(await pool.query(`INSERT INTO workforce_resources(kind,owner_user_id,name) VALUES('agent',$1,'scout') RETURNING id`,[dev])).rows[0].id;
 const future=new Date(Date.now()+86400000).toISOString();
 const offer=(await submitOffer(pool,{projectId:project,actorUserId:dev,resourceId:agent,resourceKind:'agent',
  taskId:task,payerUserId:dev,spendLimitMicro:5000,executeRequested:false,expiresAt:future})).offer;
 const engagement=await acceptOffer(pool,{offerId:offer.id,actorUserId:owner});
 // Binding verifies maintainer, live engagement and the ownership chain.
 await assert.rejects(bindExternalAgent(pool,{engagementId:engagement.id,agentUserId:bot,actorUserId:stranger}),
  e=>/not_authorized/.test(e.message),'a stranger cannot bind');
 await assert.rejects(bindExternalAgent(pool,{engagementId:engagement.id,agentUserId:spy,actorUserId:owner}),
  e=>/not_owned_by_actor/.test(e.message),'an agent of another owner cannot bind to this engagement');
 await assert.rejects(bindExternalAgent(pool,{engagementId:engagement.id,agentUserId:dev,actorUserId:owner}),
  e=>/requires_agent/.test(e.message),'a human is not a scoped agent identity');
 const scope=await bindExternalAgent(pool,{engagementId:engagement.id,agentUserId:bot,actorUserId:owner,ttlSeconds:3600});
 assert.ok(new Date(scope.expires_at)<=new Date(engagement.expires_at),'scope never outlives the engagement');
 // The agent reads its own work only.
 assert.equal((await readScopedTask(pool,{agentUserId:bot,taskId:task})).id,task,'its own task reads');
 assert.equal((await readScopedEngagement(pool,{agentUserId:bot,engagementId:engagement.id})).id,engagement.id,'its own engagement reads');
 const commit=(s)=>createHash('sha256').update(s,'utf8').digest('hex');
 const mine=(await claimTask(pool,{taskId:task2,claimantUserId:dev,commitment:commit('dev-claim'),
  idempotencyKey:'scope-claim-1',ttlSeconds:3600})).claim;
 assert.equal((await readScopedClaim(pool,{agentUserId:bot,claimId:mine.id})).id,mine.id,'its owner\'s claim reads');
 const contrib=await submitContribution(pool,{projectId:project,taskId:task,type:'code',authorUserId:dev,
  responsibleUserId:dev,revisionHash:'commit:scope1',evidence:[{diff:'d'}],
  origin:'original work',rightsLicense:'MIT'});
 assert.equal((await readScopedContribution(pool,{agentUserId:bot,contributionId:contrib.id})).id,contrib.id,'its owner\'s contribution reads');
 await transitionContribution(pool,{contributionId:contrib.id,actorUserId:owner,toState:'admitted',rationale:'fits'});
 assert.equal((await readScopedTransitions(pool,{agentUserId:bot,contributionId:contrib.id})).length,1,'its owner\'s review trail reads');
 const mine2=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[bot,'work'])).rows[0].id;
 assert.equal((await readScopedConversation(pool,{agentUserId:bot,conversationId:mine2})).id,mine2,'its own working memory reads');
 assert.deepEqual(await readScopedProject(pool,{agentUserId:bot,projectId:project}),{id:project,name:'Atlas'},
  'its project reads as a redacted card, never the raw row');
 // Every internal surface fails closed.
 const inner=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[owner,'internal'])).rows[0].id;
 await assert.rejects(readScopedConversation(pool,{agentUserId:bot,conversationId:inner}),
  e=>/denied:conversation/.test(e.message),'an internal conversation refuses');
 await assert.rejects(readScopedCredential(),
  e=>/denied:credential/.test(e.message),'credentials refuse unconditionally');
 await assert.rejects(readScopedProject(pool,{agentUserId:bot,projectId:other}),
  e=>/no_live_scope/.test(e.message),'another project refuses');
 await assert.rejects(readScopedTask(pool,{agentUserId:bot,taskId:foreign}),
  e=>/no_live_scope/.test(e.message),'a foreign task refuses');
 const sibling=(await claimTask(pool,{taskId:task,claimantUserId:stranger,commitment:commit('sib-claim'),
  idempotencyKey:'scope-claim-2',ttlSeconds:3600})).claim;
 await assert.rejects(readScopedClaim(pool,{agentUserId:bot,claimId:sibling.id}),
  e=>/denied:claim/.test(e.message),'a sibling claim refuses');
 const theirs=await submitContribution(pool,{projectId:project,taskId:task,type:'code',authorUserId:stranger,
  responsibleUserId:stranger,revisionHash:'commit:scope2',evidence:[{diff:'d'}],
  origin:'original work',rightsLicense:'MIT'});
 await assert.rejects(readScopedContribution(pool,{agentUserId:bot,contributionId:theirs.id}),
  e=>/denied:contribution/.test(e.message),'another contribution refuses');
 await assert.rejects(readScopedTransitions(pool,{agentUserId:bot,contributionId:theirs.id}),
  e=>/denied:contribution/.test(e.message),'another review trail refuses');
 await assert.rejects(readScopedDraft(pool,{agentUserId:bot,projectId:project}),
  e=>/denied:draft/.test(e.message),'an unaccepted draft refuses even on the own project');
 // Expiry revokes everything; unscoped agents read nothing.
 await pool.query(`UPDATE external_agent_scopes SET expires_at=now()-interval '1 second',created_at=now()-interval '2 hours' WHERE id=$1`,[scope.id]);
 await assert.rejects(readScopedTask(pool,{agentUserId:bot,taskId:task}),
  e=>/no_live_scope/.test(e.message),'an expired scope reads nothing');
 await assert.rejects(readScopedTask(pool,{agentUserId:lone,taskId:task}),
  e=>/no_live_scope/.test(e.message),'an agent with no scope reads nothing');
});
