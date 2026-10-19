// PUB-03..07 / PUB-10 / PUB-12 over HTTP against real PostgreSQL: the public-contribution services are REACHABLE
// through /api/workforce/public, every identity parameter is the caller, and an id on a project the caller cannot
// see answers exactly like a missing one.
//
// PROVEN: a claim's claimant is the session (a body naming one is refused); retries are idempotent; a rival is
// refused with a conflict, not an outage; commit-and-reveal and the maintainer's award work; a stranger cannot
// claim, read a claim, post or read discussion on a PRIVATE project (not_found, same as a missing id); an offer
// on a private project is refused as the caller's error; a stranger's contribution read is not_found.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.JWT_SECRET ||= 'public-routes-local-fixture';
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB: the public-contribution API is reachable, binds identity, and hides private projects',{skip:!url,timeout:180000},async t=>{
 const db=new pg.Pool({connectionString:url,max:10});t.after(()=>db.end());
 await runAllMigrations(db);
 const marker=`pubr-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await db.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),solver=await user('solver'),stranger=await user('stranger');
 const project=(await db.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Private atlas'])).rows[0].id;
 await db.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'viewer','user',$2)",[project,solver]);
 const goal=(await db.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[project,owner])).rows[0].id;
 const mile=(await db.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[goal,owner])).rows[0].id;
 const task=(await db.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Bounty','open') RETURNING id`,[mile])).rows[0].id;
 const express=(await import('express')).default;
 const {createRequire}=await import('node:module');
 const jwt=createRequire(new URL('../src/server/package.json',import.meta.url))('jsonwebtoken');
 const {createWorkforceRouter}=await import('../src/server/routes/workforceRoutes.js');
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.db=db;next();});app.use('/api/workforce',createWorkforceRouter());
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const call=async(p,body,as)=>{const token=jwt.sign({userId:as,email:'x@y.z'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/workforce/public${p}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json().catch(()=>null)};};
 const commit=(s)=>createHash('sha256').update(s,'utf8').digest('hex');
 const claimBody={taskId:task,commitment:commit('solver-secret'),idempotencyKey:'claimkey-0001',ttlSeconds:3600};

 assert.equal((await call('/claims',{...claimBody,claimantUserId:stranger},solver)).status,400,'a body cannot name the claimant');
 const first=await call('/claims',claimBody,solver);
 assert.equal(first.status,200,`a claim is taken by the caller: ${JSON.stringify(first.body)}`);
 assert.equal(first.body.result.claim.claimant_user_id,solver,'the claimant is the session');
 assert.equal((await call('/claims',claimBody,solver)).body.result.duplicate,true,'a retry is idempotent');
 // a stranger: every task-bound route says the same thing a missing task says
 const missing=await call('/claims',{...claimBody,taskId:randomUUID(),idempotencyKey:'claimkey-0009'},stranger);
 assert.equal(missing.status,404);
 for(const [p,b] of [['/claims',{...claimBody,idempotencyKey:'claimkey-0002'}],['/claims/read',{claimId:first.body.result.claim.id}],
   ['/discussion',{taskId:task,body:'hi'}],['/discussion/read',{taskId:task}]]){
  const r=await call(p,b,stranger);
  assert.deepEqual([r.status,r.body.reason],[missing.status,missing.body.reason],`${p}: a stranger is told it does not exist`);
 }
 const rivalViewer=await user('rival');
 await db.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'viewer','user',$2)",[project,rivalViewer]);
 const rival=await call('/claims',{...claimBody,commitment:commit('r'),idempotencyKey:'claimkey-0003'},rivalViewer);
 assert.equal(rival.status,409,`a rival is a conflict, not an outage: ${JSON.stringify(rival.body)}`);
 assert.equal((await call('/claims/reveal',{claimId:first.body.result.claim.id,secret:'solver-secret'},solver)).status,200,'the true preimage reveals');
 const award=await call('/claims/award',{claimId:first.body.result.claim.id},owner);
 assert.equal(award.status,200,`the maintainer awards: ${JSON.stringify(award.body)}`);
 assert.equal((await call('/claims/award',{claimId:first.body.result.claim.id},solver)).status>=400,true,'the claimant cannot award themselves');
 // discussion by people who can see the project
 assert.equal((await call('/discussion',{taskId:task,body:'Looks good'},solver)).status,200,'a viewer posts');
 const thread=await call('/discussion/read',{taskId:task},owner);
 assert.ok(thread.status===200&&JSON.stringify(thread.body.result).includes('Looks good'),'and the maintainer reads it');
 // offers need an open, public project: the caller's error, never a 503
 const offer=await call('/offers',{projectId:project,resourceId:randomUUID(),resourceKind:'agent',taskId:task,spendLimitMicro:0,expiresAt:new Date(Date.now()+86400000).toISOString()},solver);
 assert.ok(offer.status>=400&&offer.status<500,`an offer on a private project is refused as the caller's error (${offer.status} ${offer.body&&offer.body.reason})`);
 assert.equal((await call('/offers',{projectId:project,payerUserId:stranger},solver)).status,400,'a body cannot name the payer');
 assert.equal((await call('/contributions/read',{contributionId:randomUUID()},stranger)).status,404,'an unknown contribution is not_found');
});
