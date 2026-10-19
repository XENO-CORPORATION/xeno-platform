// SES-02/03/04/06/07/09 over HTTP against real PostgreSQL: the session services are REACHABLE through
// /api/workforce/sessions, and the route adds the one rule the services leave to their caller -- the actor
// must hold the conversation. A stranger's conversation answers not_found, exactly like a missing one.
//
// PROVEN: Chat->Agent under the session root and back; resume reads persisted state; the host-owned cwd
// root is used and a client cannot name one; lease + event + lineage round-trip; a branch intent records;
// a stranger is refused on every conversation-bound route with the same answer as a missing id; a body
// naming the actor is refused; with XENO_SESSION_ROOT unset the cwd answers unavailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.JWT_SECRET ||= 'session-routes-local-fixture';
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('SES: the session API is reachable and conversation-guarded',{skip:!url,timeout:180000},async t=>{
 const db=new pg.Pool({connectionString:url,max:10});t.after(()=>db.end());
 await runAllMigrations(db);
 const marker=`sesr-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await db.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),mallory=await user('mallory');
 const conv=(await db.query("INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,'S') RETURNING id",[alice])).rows[0].id;
 const root=mkdtempSync(path.join(os.tmpdir(),'sesr-'));
 const express=(await import('express')).default;
 const {createRequire}=await import('node:module');
 const jwt=createRequire(new URL('../src/server/package.json',import.meta.url))('jsonwebtoken');
 const {createWorkforceRouter}=await import('../src/server/routes/workforceRoutes.js');
 const env={XENO_SESSION_ROOT:root};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.db=db;next();});app.use('/api/workforce',createWorkforceRouter({sessionEnv:env}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const call=async(p,body,as=alice)=>{const token=jwt.sign({userId:as,email:'x@y.z'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/workforce/sessions${p}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json().catch(()=>null)};};

 // SES-02: the host's root, never the client's
 assert.equal((await call('/cwd',{conversationId:conv,sessionRoot:'C:/'})).status,400,'a client cannot name the session root');
 const cwd=await call('/cwd',{conversationId:conv});
 assert.equal(cwd.status,200,`the isolated cwd resolves under the host root: ${JSON.stringify(cwd.body)}`);
 assert.ok(cwd.body.result.path.startsWith(root),'under XENO_SESSION_ROOT');
 // SES-03 / SES-06 / SES-04
 const toAgent=await call('/mode/agent',{conversationId:conv,root:{kind:'session-isolated'}});
 assert.equal(toAgent.status,200,`Chat->Agent under the session root: ${JSON.stringify(toAgent.body)}`);
 const resumed=await call('/resume',{conversationId:conv,hints:{mode:'chat'}});
 assert.equal(resumed.body.result.mode,'agent','resume reads persisted mode, ignoring the hint');
 const toChat=await call('/mode/chat',{conversationId:conv,dispositions:[]});
 assert.equal(toChat.status,200,`Agent->Chat at a safe boundary: ${JSON.stringify(toChat.body)}`);
 // SES-07
 assert.equal((await call('/lease/acquire',{conversationId:conv,adapter:'gui',ttlSeconds:60})).status,200,'the execution lease is acquired');
 const ev=await call('/events',{conversationId:conv,adapter:'gui',kind:'tool',payload:{name:'read'}});
 assert.equal(ev.status,200,`an event appends under the lease: ${JSON.stringify(ev.body)}`);
 const lin=await call('/lineage',{conversationId:conv});
 assert.ok(lin.status===200&&JSON.stringify(lin.body.result).includes('read'),'the lineage reads it back');
 // SES-09
 const bi=await call('/branch-intents',{conversationId:conv,branch:'main',intent:'abandon'});
 assert.equal((await call('/branch-intents',{conversationId:conv,branch:'main',intent:'fork'})).status,400,'an unknown intent is the caller\'s input error, not a fault');
 assert.equal(bi.status,200,`a branch intent records: ${JSON.stringify(bi.body)}`);

 // the guard: a stranger gets the answer a missing id gets
 const missing=await call('/lineage',{conversationId:randomUUID()},mallory);
 for(const [p,b] of [['/lineage',{conversationId:conv}],['/resume',{conversationId:conv}],['/cwd',{conversationId:conv}],
   ['/mode/agent',{conversationId:conv,root:{kind:'session-isolated'}}],['/lease/acquire',{conversationId:conv,adapter:'cli'}],
   ['/events',{conversationId:conv,adapter:'cli',kind:'note',payload:{}}],['/branch-intents',{conversationId:conv,branch:'x',intent:'fork'}]]){
  const r=await call(p,b,mallory);
  assert.deepEqual([r.status,r.body.code,r.body.reason],[missing.status,missing.body.code,missing.body.reason],`${p}: a stranger is told the conversation does not exist`);
 }
 assert.equal(missing.status,404);
 assert.equal((await call('/lineage',{conversationId:conv,actorUserId:mallory},mallory)).status,400,'a body naming the actor is refused');
 delete env.XENO_SESSION_ROOT;
 assert.equal((await call('/cwd',{conversationId:conv})).body.reason,'session_root_unconfigured','no host root, no cwd');
});
