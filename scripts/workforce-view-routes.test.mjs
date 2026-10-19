// VIEW-04 / VIEW-05 over HTTP against real PostgreSQL: the view services are REACHABLE through
// /api/workforce/views. PROVEN: a fenced read is fresh, then stale after a revision bump, with no rows; a poll
// says changed; another person's personal scope is denied; a message id resolves to its canonical conversation
// for its owner and answers not_found to a stranger (same as a missing id); drafts are per (user, view).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.JWT_SECRET ||= 'view-routes-local-fixture';
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('VIEW: the view API is reachable and fenced',{skip:!url,timeout:180000},async t=>{
 const db=new pg.Pool({connectionString:url,max:10});t.after(()=>db.end());
 await runAllMigrations(db);
 const marker=`viewr-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await db.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),mallory=await user('mallory');
 const conv=(await db.query("INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,'V') RETURNING id",[alice])).rows[0].id;
 const msg=(await db.query("INSERT INTO chat_messages(conversation_id,user_id,role,content,message_index) VALUES($1,$2,'user','hi',0) RETURNING id",[conv,alice])).rows[0].id;
 const express=(await import('express')).default;
 const {createRequire}=await import('node:module');
 const jwt=createRequire(new URL('../src/server/package.json',import.meta.url))('jsonwebtoken');
 const {createWorkforceRouter}=await import('../src/server/routes/workforceRoutes.js');
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.db=db;next();});app.use('/api/workforce',createWorkforceRouter());
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const call=async(p,body,as=alice)=>{const token=jwt.sign({userId:as,email:'x@y.z'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/workforce/views${p}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json().catch(()=>null)};};
 const scope=`personal:${alice}`;
 const first=await call('/read',{scope,key:'conversations'});
 assert.equal(first.body.result.state,'fresh',`a scoped read is fresh: ${JSON.stringify(first.body)}`);
 await db.query("UPDATE scoped_read_revisions SET revision=revision+1 WHERE scope=$1 AND key='conversations'",[scope]);
 const stale=await call('/read',{scope,key:'conversations',knownRevision:first.body.result.revision});
 assert.deepEqual([stale.body.result.state,stale.body.result.rows],['stale',undefined],'a behind revision is stale and carries no rows');
 assert.equal((await call('/poll',{scope,key:'conversations',fromRevision:first.body.result.revision})).body.result.changed,true,'a poll reports the change');
 assert.equal((await call('/read',{scope,key:'conversations'},mallory)).body.result.state,'denied','another person\'s scope is denied');
 const res=await call('/resolve/message',{messageId:msg});
 assert.equal(res.body.result.conversationId,conv,'a message resolves to its canonical conversation');
 const missing=await call('/resolve/message',{messageId:randomUUID()},mallory),hidden=await call('/resolve/message',{messageId:msg},mallory);
 assert.deepEqual([hidden.status,hidden.body.reason],[missing.status,missing.body.reason],'a stranger is told the message does not exist');
 assert.equal(hidden.status,404);
 assert.equal((await call('/state',{view:'chat',draft:'d1',scrollOffset:5})).status,200,'a view draft saves');
 assert.equal((await call('/state/read',{view:'chat'})).body.result.draft,'d1','and reads back');
 assert.equal((await call('/state/read',{view:'chat'},mallory)).body.result.present,false,'per person: another person sees none');
});
