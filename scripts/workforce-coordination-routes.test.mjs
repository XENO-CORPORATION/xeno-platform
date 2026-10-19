// RUN-05 / RUN-06 / RUN-08 / LIFE-08 over HTTP against real PostgreSQL: the coordination services are REACHABLE through
// /api/workforce/coordination. PROVEN: a goal -> milestone -> task completes on evidence and is accepted by the
// reviewer, never by its worker; a stranger cannot file on the project; a child session opens under its parent
// and a stranger cannot return/close it (not_found, like a missing id); a file lock blocks another holder; an
// author cannot integrate their own worktree.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.JWT_SECRET ||= 'coordination-routes-local-fixture';
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');
const {writeTuples}=await import('../src/server/utils/authzReBAC.js');

test('RUN-05/06/08: the coordination API is reachable and authorized',{skip:!url,timeout:180000},async t=>{
 const db=new pg.Pool({connectionString:url,max:10});t.after(()=>db.end());
 await runAllMigrations(db);
 const marker=`coor-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await db.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),mallory=await user('mallory');
 const project=await createAuthorizedProject(db,{principal:userPrincipal(alice),name:'Coord'});
 await db.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'editor','user',$2)",[project.id,bob]);
 const parent=(await db.query("INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,'P') RETURNING id",[alice])).rows[0].id;
 const express=(await import('express')).default;
 const {createRequire}=await import('node:module');
 const jwt=createRequire(new URL('../src/server/package.json',import.meta.url))('jsonwebtoken');
 const {createWorkforceRouter}=await import('../src/server/routes/workforceRoutes.js');
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.db=db;next();});app.use('/api/workforce',createWorkforceRouter());
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const call=async(p,body,as=alice)=>{const token=jwt.sign({userId:as,email:'x@y.z'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/workforce/coordination${p}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json().catch(()=>null)};};
 const ok=(r,m)=>{assert.equal(r.status,200,`${m}: ${JSON.stringify(r.body)}`);return r.body.result;};

 // RUN-06
 assert.equal((await call('/goals',{projectId:project.id,title:'G',successEvidence:'E'},mallory)).status,403,'a stranger cannot file a goal');
 const goal=ok(await call('/goals',{projectId:project.id,title:'Ship',successEvidence:'accepted'}),'a goal is filed').goalId;
 const ms=ok(await call('/milestones',{goalId:goal,title:'M1',requiredEvidenceKinds:['test-report'],reviewerRequired:true,reviewerUserId:alice}),'a milestone').milestoneId;
 const task=ok(await call('/tasks',{milestoneId:ms,title:'Build',assigneeUserId:bob}),'a task').taskId;
 ok(await call('/tasks/evidence',{taskId:task,kind:'test-report',ref:'junit:1/1'},bob),'evidence attaches');
 assert.equal(ok(await call('/tasks/complete',{taskId:task},bob),'the worker completes').status,'in-review');
 assert.equal((await call('/tasks/accept',{taskId:task},bob)).status,403,'the worker cannot accept their own task');
 assert.equal(ok(await call('/tasks/accept',{taskId:task}),'the reviewer accepts').status,'completed');
 // RUN-05
 const child=ok(await call('/children/open',{parentConversationId:parent,title:'Sub'}),'a child opens under its parent');
 assert.equal((await call('/children/open',{parentConversationId:parent},mallory)).status,404,'a stranger cannot open a child of someone else\'s chat');
 const hidden=await call('/children/close',{childConversationId:child.child_conversation_id},mallory),missing=await call('/children/close',{childConversationId:randomUUID()},mallory);
 assert.deepEqual([hidden.status,hidden.body.reason],[missing.status,missing.body.reason],'a stranger is told the child does not exist');
 ok(await call('/children/return',{childConversationId:child.child_conversation_id}),'the parent\'s holder returns the child');
 assert.equal(ok(await call('/children/read',{childConversationId:child.child_conversation_id}),'and reads the link').state,'returned');
 // RUN-08
 ok(await call('/ownership/files',{projectId:project.id,paths:['src/a.js'],taskRef:'t1'}),'a file lock is acquired');
 assert.equal((await call('/ownership/files',{projectId:project.id,paths:['src/a.js'],taskRef:'t1'},bob)).status,409,'another holder is refused');
 const tree=ok(await call('/worktrees',{projectId:project.id,taskRef:'t9',branch:'w1',rootPrefix:'wt/w1'},bob),'a worktree is isolated').worktreeId;
 assert.equal((await call('/worktrees/integrate',{worktreeId:tree},bob)).status,403,'the author cannot integrate their own worktree');
 ok(await call('/worktrees/integrate',{worktreeId:tree}),'a different holder integrates it');

 // LIFE-08: an objective is the workspace-level top of the same tree
 const ws=(await db.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$3) RETURNING id',[alice,marker,marker])).rows[0].id;
 await writeTuples(db,{writes:[{object:`workspace:${ws}`,relation:'owner',subject:`user:${alice}`}]});
 const wsProject=await createAuthorizedProject(db,{principal:userPrincipal(alice),workspaceId:ws,name:'In workspace'});
 const objBody={workspaceId:ws,title:'Q4 launch',successEvidence:'shipped and adopted',windowStart:'2026-10-01',windowEnd:'2026-12-31'};
 assert.equal((await call('/objectives',objBody,mallory)).status,403,'a stranger cannot set an objective for the workspace');
 assert.equal((await call('/objectives',{...objBody,windowEnd:'2026-09-01'})).status,400,'a window cannot end before it starts');
 const obj=ok(await call('/objectives',objBody),'an objective is set').objectiveId;
 assert.equal((await call('/objectives/link-goal',{goalId:goal,objectiveId:obj})).status,403,'a goal of a project outside the workspace cannot roll up to it');
 const g2=ok(await call('/goals',{projectId:wsProject.id,title:'Launch page',successEvidence:'live'}),'a goal in the workspace').goalId;
 ok(await call('/objectives/link-goal',{goalId:g2,objectiveId:obj}),'the goal rolls up to the objective');
 assert.equal((await call('/objectives/complete',{objectiveId:obj})).status,409,'an objective with an open goal cannot complete');
 const m2=ok(await call('/milestones',{goalId:g2,title:'M',requiredEvidenceKinds:[],reviewerRequired:false}),'a milestone under it').milestoneId;
 const t2=ok(await call('/tasks',{milestoneId:m2,title:'Ship it'}),'a task').taskId;
 ok(await call('/tasks/complete',{taskId:t2}),'the task completes');
 ok(await call('/milestones/complete',{milestoneId:m2}),'the milestone completes');
 ok(await call('/goals/complete',{goalId:g2}),'the goal completes');
 assert.equal(ok(await call('/objectives/complete',{objectiveId:obj}),'then the objective completes').status,'completed');
 const read=ok(await call('/objectives/read',{objectiveId:obj}),'it reads back with derived progress');
 assert.deepEqual(read.progress,{goals:1,completed:1});
 assert.equal((await call('/objectives/read',{objectiveId:obj},mallory)).status,404,'outside the workspace it does not exist');
 // the database holds the same shapes on its own
 await assert.rejects(db.query('UPDATE project_goals SET objective_id=$1 WHERE id=$2',[obj,goal]),{code:'23514'},'the database refuses a goal rolling up across workspaces');
 await assert.rejects(db.query("UPDATE project_objectives SET status='open', completed_at=NULL WHERE id=$1",[obj]),{code:'23514'},'a completed objective never reopens');
 const obj2=ok(await call('/objectives',objBody),'a second objective').objectiveId;
 const g3=ok(await call('/goals',{projectId:wsProject.id,title:'Open goal',successEvidence:'x'}),'an open goal').goalId;
 ok(await call('/objectives/link-goal',{goalId:g3,objectiveId:obj2}),'linked');
 await assert.rejects(db.query("UPDATE project_objectives SET status='completed', completed_at=now() WHERE id=$1",[obj2]),{code:'23514'},'the database refuses completing over an open goal');
});
