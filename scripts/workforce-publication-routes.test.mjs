// PUB-08 / PUB-09 / PUB-11 / PUB-13 / PUB-14 over HTTP against real PostgreSQL: the services are REACHABLE at
// /api/workforce/public, identity is the session, and private things stay invisible.
//
// PROVEN: a budget grant is requested by the caller (a body naming the requester is refused) and decided by
// the maintainer; a stranger cannot read it (not_found); a caller who is no external agent has no scope
// (denied, not an outage); an unpublished transcript and a private project's export/fork are refused as the
// caller's error; the retreat demands the unrecallable acknowledgement; a repository link is the
// maintainer's and invisible to strangers; a stranger cannot consent on someone else's conversation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.JWT_SECRET ||= 'publication-routes-local-fixture';
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-08/09/11/13/14: reachable, identity-bound, private stays private',{skip:!url,timeout:180000},async t=>{
 const db=new pg.Pool({connectionString:url,max:10});t.after(()=>db.end());
 await runAllMigrations(db);
 const marker=`pubb-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await db.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),member=await user('member'),stranger=await user('stranger');
 const project=(await db.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Private'])).rows[0].id;
 await db.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'editor','user',$2)",[project,member]);
 const goal=(await db.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[project,owner])).rows[0].id;
 const mile=(await db.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[goal,owner])).rows[0].id;
 const task=(await db.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Work','open') RETURNING id`,[mile])).rows[0].id;
 const conv=(await db.query("INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,'C') RETURNING id",[owner])).rows[0].id;
 const express=(await import('express')).default;
 const {createRequire}=await import('node:module');
 const jwt=createRequire(new URL('../src/server/package.json',import.meta.url))('jsonwebtoken');
 const {createWorkforceRouter}=await import('../src/server/routes/workforceRoutes.js');
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.db=db;next();});app.use('/api/workforce',createWorkforceRouter());
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const call=async(p,body,as)=>{const token=jwt.sign({userId:as,email:'x@y.z'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/workforce/public${p}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json().catch(()=>null)};};
 const client4xx=(r,m)=>assert.ok(r.status>=400&&r.status<500,`${m} (${r.status} ${r.body&&r.body.reason})`);

 // PUB-09
 const grantBody={projectId:project,taskId:task,amountMicro:1000000,expiresAt:new Date(Date.now()+86400000).toISOString()};
 assert.equal((await call('/grants',{...grantBody,requesterUserId:stranger},member)).status,400,'a body cannot name the requester');
 const grant=await call('/grants',grantBody,member);
 assert.equal(grant.status,200,`a member requests a budget grant: ${JSON.stringify(grant.body)}`);
 assert.equal(grant.body.result.requester_user_id,member,'the requester is the session');
 const gid=grant.body.result.id;
 const read=await call('/grants/read',{grantId:gid},owner);
 assert.equal(read.status,200,'the maintainer reads it');
 const hidden=await call('/grants/read',{grantId:gid},stranger),missing=await call('/grants/read',{grantId:randomUUID()},stranger);
 assert.deepEqual([hidden.status,hidden.body.reason],[missing.status,missing.body.reason],'a stranger is told the grant does not exist');
 const acc=await call('/grants/accept',{grantId:gid},owner);
 assert.equal(acc.status,200,`the maintainer accepts: ${JSON.stringify(acc.body)}`);
 // PUB-08
 const ext=await call('/external/task',{taskId:task},stranger);
 client4xx(ext,'a caller who is no bound external agent has no scope');
 // PUB-11
 client4xx(await call('/conversations/transcript',{conversationId:conv},stranger),'an unpublished transcript is not readable');
 assert.equal((await call('/conversations/full/consent',{conversationId:conv,scopeHash:'a'.repeat(64)},stranger)).status,404,'a stranger cannot consent on someone else\'s conversation');
 // PUB-13
 client4xx(await call('/retreat',{projectId:project,acknowledgeUnrecallable:false},owner),'the retreat demands the unrecallable acknowledgement');
 const link=await call('/repository',{projectId:project,provider:'github',remoteUrl:'https://github.com/example/private-repo',repoVisibility:'private'},owner);
 assert.equal(link.status,200,`the maintainer links a repository: ${JSON.stringify(link.body)}`);
 assert.equal((await call('/repository/read',{projectId:project},stranger)).status,404,'a stranger cannot see it');
 // PUB-14
 client4xx(await call('/export',{projectId:project},stranger),'a private project has no public bundle');
 client4xx(await call('/fork',{upstreamProjectId:project},stranger),'a private project cannot be forked');
 assert.equal((await call('/fork',{upstreamProjectId:project,forkerUserId:owner},stranger)).status,400,'a body cannot name the forker');
});
