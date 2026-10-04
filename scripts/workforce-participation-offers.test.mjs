// PUB-03 against real PostgreSQL: external developers submit agent/team
// participation offers, never unilateral privileged assignments; a
// maintainer accepts a scoped task engagement with approved actors,
// resources, payer, limits and expiry; pre-authorization covers low-risk
// offers only and never execution or open spending.
//
// PROVEN: submitting an offer grants nothing (no participation, no task
// assignment, no authority); offers refuse on private or
// maintainers-only projects, for others' resources, for foreign or
// completed tasks, and for project-funded payers (PUB-09's grant
// ceremony owns that case); strangers cannot accept or decline while
// the owner can, and only the offerer withdraws; acceptance records the
// exact offered scope and refuses expired offers, decided offers and
// completed tasks; auto-accept fires only with the policy on, spend
// within cap and no execution requested, and auto-accepted engagements
// carry execute_allowed=false by schema law.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {submitOffer,acceptOffer,declineOffer,withdrawOffer,readOffer,readEngagement,setOfferPolicy}=await import('../src/server/services/participationOffers.js');
const {setContributionPolicy}=await import('../src/server/services/projectPolicies.js');
const {mutateProjectPublication,previewProjectPublication}=await import('../src/server/services/projectPublication.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-03: offers grant nothing; maintainers accept scoped engagements; pre-auth stays low-risk',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`p3-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),dev=await user('dev'),stranger=await user('stranger');
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 const guarded=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Guarded'])).rows[0].id;
 const dark=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Dark'])).rows[0].id;
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES
  ('project',$1,'admin','user',$2),('project',$3,'admin','user',$2)`,[project,owner,guarded]);
 const ctx={actorUserId:owner,clientId:'pub3'};
 const content={schemaVersion:1,title:'Atlas',purpose:'Maps',license:'XENO-PUBLIC-1.0',termsVersion:'2026-10-04',
  contributionGuide:'Offers welcome',roadmap:'v1',updates:'none'};
 for (const pid of [project,guarded]) {
  await mutateProjectPublication(pool,ctx,{projectId:pid,expectedActorAccountId:owner,
   operationId:randomUUID(),action:'draft',expectedRevision:'0',content});
  const pv=await previewProjectPublication(pool,ctx,{projectId:pid,expectedActorAccountId:owner,visibility:'public'});
  await mutateProjectPublication(pool,ctx,{projectId:pid,expectedActorAccountId:owner,
   operationId:randomUUID(),action:'publish',expectedRevision:'1',visibility:'public',previewHash:pv.previewHash});
 }
 await setContributionPolicy(pool,{projectId:project,actorUserId:owner,value:'offers-open'});
 const goal=(await pool.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[project,owner])).rows[0].id;
 const mile=(await pool.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[goal,owner])).rows[0].id;
 const task=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Survey','open') RETURNING id`,[mile])).rows[0].id;
 const done=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Old','completed') RETURNING id`,[mile])).rows[0].id;
 const ogoal=(await pool.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[guarded,owner])).rows[0].id;
 const omile=(await pool.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[ogoal,owner])).rows[0].id;
 const foreign=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Elsewhere','open') RETURNING id`,[omile])).rows[0].id;
 const agent=(await pool.query(`INSERT INTO workforce_resources(kind,owner_user_id,name) VALUES('agent',$1,'scout') RETURNING id`,[dev])).rows[0].id;
 const theirs=(await pool.query(`INSERT INTO workforce_resources(kind,owner_user_id,name) VALUES('agent',$1,'theirs') RETURNING id`,[stranger])).rows[0].id;
 const future=new Date(Date.now()+86400000).toISOString();
 const base={projectId:project,actorUserId:dev,resourceId:agent,resourceKind:'agent',taskId:task,
  payerUserId:dev,spendLimitMicro:5000,executeRequested:false,expiresAt:future};
 // Refusal sides: closed projects, others' resources, wrong tasks, foreign payer.
 await assert.rejects(submitOffer(pool,{...base,projectId:dark,taskId:task}),
  e=>/not_accepting_offers/.test(e.message),'a private project takes no offers');
 await assert.rejects(submitOffer(pool,{...base,projectId:guarded,taskId:foreign}),
  e=>/not_accepting_offers/.test(e.message),'a maintainers-only project takes no offers');
 await assert.rejects(submitOffer(pool,{...base,resourceId:theirs}),
  e=>/resource owner/.test(e.message),'a developer cannot offer someone else\'s agent');
 await assert.rejects(submitOffer(pool,{...base,taskId:foreign}),
  e=>/not on this project/.test(e.message),'an offer cannot name a foreign task');
 await assert.rejects(submitOffer(pool,{...base,taskId:done}),
  e=>/already completed/.test(e.message),'an offer cannot target a completed task');
 await assert.rejects(submitOffer(pool,{...base,payerUserId:owner}),
  e=>/funding_requires_grant/.test(e.message),'project-funded offers wait for PUB-09\'s grant ceremony');
 // An offer grants nothing until a maintainer decides.
 const {offer,autoAccepted}=await submitOffer(pool,base);
 assert.equal(autoAccepted,false,'no policy: the offer waits for a maintainer');
 assert.equal((await readOffer(pool,offer.id)).status,'proposed','the offer stands proposed');
 assert.equal((await pool.query(`SELECT count(*)::int n FROM workforce_project_participations WHERE project_id=$1`,[project])).rows[0].n,
  0,'submitting creates no participation');
 assert.equal((await pool.query(`SELECT assignee_user_id FROM project_tasks WHERE id=$1`,[task])).rows[0].assignee_user_id,
  null,'submitting assigns nothing');
 await assert.rejects(acceptOffer(pool,{offerId:offer.id,actorUserId:stranger}),
  e=>/not_authorized/.test(e.message),'a stranger cannot accept');
 await assert.rejects(declineOffer(pool,{offerId:offer.id,actorUserId:stranger}),
  e=>/not_authorized/.test(e.message),'a stranger cannot decline');
 await assert.rejects(withdrawOffer(pool,{offerId:offer.id,actorUserId:stranger}),
  e=>/not_authorized/.test(e.message),'a stranger cannot withdraw');
 const engagement=await acceptOffer(pool,{offerId:offer.id,actorUserId:owner});
 assert.equal(engagement.origin,'manual','a maintainer decision is manual');
 assert.equal(engagement.actor_user_id,dev,'the engagement names the approved actor');
 assert.equal(engagement.resource_id,agent,'the engagement names the approved resource');
 assert.equal(engagement.payer_user_id,dev,'the engagement names the approved payer');
 assert.equal(Number(engagement.spend_limit_micro),5000,'the engagement carries the approved limit');
 assert.equal(engagement.execute_allowed,false,'no execution was requested or granted');
 assert.equal((await readOffer(pool,offer.id)).status,'accepted','the offer closes on acceptance');
 await assert.rejects(acceptOffer(pool,{offerId:offer.id,actorUserId:owner}),
  e=>/not proposed/.test(e.message),'a decided offer cannot be accepted again');
 // Expiry and withdrawal close offers without engagements.
 const short=(await submitOffer(pool,{...base,expiresAt:new Date(Date.now()+60000).toISOString()})).offer;
 await pool.query(`UPDATE participation_offers SET expires_at=now()-interval '1 second',created_at=now()-interval '1 hour' WHERE id=$1`,[short.id]);
 await assert.rejects(acceptOffer(pool,{offerId:short.id,actorUserId:owner}),
  e=>/expired/.test(e.message),'an expired offer cannot be accepted');
 assert.equal((await readOffer(pool,short.id)).status,'expired','the refused accept marks the expiry');
 const backing=(await submitOffer(pool,base)).offer;
 assert.equal((await withdrawOffer(pool,{offerId:backing.id,actorUserId:dev})).status,'withdrawn','the offerer withdraws');
 const refused=(await submitOffer(pool,base)).offer;
 assert.equal((await declineOffer(pool,{offerId:refused.id,actorUserId:owner})).status,'declined','the maintainer declines');
 // Pre-authorization: low-risk offers fly, execution and overspend wait.
 await assert.rejects(setOfferPolicy(pool,{projectId:project,actorUserId:stranger,autoAccept:true,maxSpendMicro:10000}),
  e=>/not_authorized/.test(e.message),'a stranger cannot write the offer policy');
 await setOfferPolicy(pool,{projectId:project,actorUserId:owner,autoAccept:true,maxSpendMicro:10000});
 const fast=await submitOffer(pool,base);
 assert.equal(fast.autoAccepted,true,'a low-risk offer auto-accepts under policy');
 assert.equal(fast.engagement.origin,'auto','the engagement records its automatic origin');
 assert.equal(fast.engagement.execute_allowed,false,'auto-accept never grants execution');
 const hot=await submitOffer(pool,{...base,executeRequested:true});
 assert.equal(hot.autoAccepted,false,'an execution request waits for a maintainer');
 const rich=await submitOffer(pool,{...base,spendLimitMicro:50000});
 assert.equal(rich.autoAccepted,false,'spend over the cap waits for a maintainer');
 const manualExec=await acceptOffer(pool,{offerId:hot.offer.id,actorUserId:owner});
 assert.equal(manualExec.execute_allowed,true,'a maintainer may approve execution explicitly');
 await setOfferPolicy(pool,{projectId:project,actorUserId:owner,autoAccept:false,maxSpendMicro:10000});
 const slow=await submitOffer(pool,base);
 assert.equal(slow.autoAccepted,false,'with the policy off, every offer waits');
});
