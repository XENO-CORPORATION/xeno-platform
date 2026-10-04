// VIEW-05 against real PostgreSQL: scope-bound query keys and revisions fence
// stale A->B->A responses, optimistic mutations and subscription polls.
// Loading, unavailable, denied, empty, stale and archived are distinct states.
//
// PROVEN: fresh reads carry rows at the current revision; empty scopes read
// empty; foreign scopes read denied (a foreign conversation id through your
// own scope reads denied too -- no existence oracle); archived projects read
// archived; a read behind the current revision is stale WITHOUT rows even
// when the content compares equal to what was first read (the A->B->A fence);
// an optimistic mutation behind the revision is refused WITHOUT running its
// write; polls report exactly whether the subscriber is behind; a reader
// handle is observably loading until its first read resolves; a dead
// transport reads unavailable, not denied or empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {readScoped,mutateScoped,pollScoped,createScopedReader}=await import('../src/server/services/scopedReads.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('VIEW-05: revision-fenced scoped reads; six distinct view states; stale carries no rows',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`v5-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),mallory=await user('mallory');
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'ViewScope'});
 const scope=`personal:${alice}`;
 const conv=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[alice,'alpha'])).rows[0].id;
 await pool.query("INSERT INTO chat_messages(conversation_id,user_id,role,content,message_index) VALUES($1,$2,'user','hello',0)",[conv,alice]);
 const stranger=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[mallory,'theirs'])).rows[0].id;
 // Fresh, empty, denied: three distinct outcomes, not one "no data".
 const fresh=await readScoped(pool,{scope,key:'conversations',actorUserId:alice});
 assert.deepEqual([fresh.state,fresh.revision,fresh.rows.length,fresh.rows[0].title],[ 'fresh',0,1,'alpha'],
  'a populated scope reads fresh with rows at revision 0');
 const empty=await readScoped(pool,{scope:`personal:${mallory}`,key:`messages:${stranger}`,actorUserId:mallory});
 assert.deepEqual([empty.state,empty.revision],[ 'empty',0],'an empty key reads empty, not denied');
 const denied=await readScoped(pool,{scope:`personal:${mallory}`,key:'conversations',actorUserId:alice});
 assert.equal(denied.state,'denied','a foreign scope reads denied');
 const oracle=await readScoped(pool,{scope,key:`messages:${stranger}`,actorUserId:alice});
 assert.equal(oracle.state,'denied','a foreign conversation id through your own scope reads denied: no existence oracle');
 const ghost=await readScoped(pool,{scope,key:`messages:${randomUUID()}`,actorUserId:alice});
 assert.equal(ghost.state,'denied','a nonexistent conversation reads denied, same as foreign');
 // Archived: distinct from denied and empty.
 await pool.query('UPDATE chat_projects SET is_archived=TRUE WHERE id=$1',[project.id]);
 const archived=await readScoped(pool,{scope:`project:${project.id}`,key:'conversations',actorUserId:alice});
 assert.equal(archived.state,'archived','an archived project scope reads archived');
 await assert.rejects(mutateScoped(pool,{scope:`project:${project.id}`,key:'conversations',actorUserId:alice,expectedRevision:0,write:async()=>{}}),
  e=>e.message==='scope_archived','mutations into an archived scope are refused');
 // The A->B->A fence: same content, newer revision, still stale -- and rowless.
 const first=await readScoped(pool,{scope,key:'conversations',actorUserId:alice});
 const w1=await mutateScoped(pool,{scope,key:'conversations',actorUserId:alice,expectedRevision:first.revision,
  write:async c=>{await c.query('UPDATE chat_conversations SET title=$2 WHERE id=$1',[conv,'beta']);}});
 const w2=await mutateScoped(pool,{scope,key:'conversations',actorUserId:alice,expectedRevision:w1.revision,
  write:async c=>{await c.query('UPDATE chat_conversations SET title=$2 WHERE id=$1',[conv,'alpha']);}});
 assert.deepEqual([w1.applied,w1.revision,w2.applied,w2.revision],[true,1,true,2],
  'each accepted mutation advances the revision exactly once');
 assert.equal((await pool.query('SELECT title FROM chat_conversations WHERE id=$1',[conv])).rows[0].title,'alpha',
  'precondition: the content is back to exactly what the first read saw');
 const stale=await readScoped(pool,{scope,key:'conversations',actorUserId:alice,knownRevision:first.revision});
 assert.deepEqual([stale.state,stale.revision,'rows' in stale],[ 'stale',2,false],
  'a behind read is stale with no rows even though the content compares equal');
 const current=await readScoped(pool,{scope,key:'conversations',actorUserId:alice,knownRevision:2});
 assert.equal(current.state,'fresh','a read at the current revision is fresh');
 // Optimistic mutations: a behind write never runs.
 const refused=await mutateScoped(pool,{scope,key:'conversations',actorUserId:alice,expectedRevision:0,
  write:async c=>{await c.query("INSERT INTO chat_messages(conversation_id,user_id,role,content,message_index) VALUES($1,$2,'user','lost write',99)",[conv,alice]);}});
 assert.deepEqual([refused.state,refused.applied,refused.revision],[ 'stale',false,2],
  'a behind mutation is refused without applying');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id=$1',[conv])).rows[0].n,1,
  'the refused write callback never ran: the message count is unchanged');
 // Subscription polls fence without sockets.
 const behind=await pollScoped(pool,{scope,key:'conversations',actorUserId:alice,fromRevision:0});
 const even=await pollScoped(pool,{scope,key:'conversations',actorUserId:alice,fromRevision:2});
 assert.deepEqual([[behind.state,behind.changed,behind.revision],[even.state,even.changed,even.revision]],
  [[ 'stale',true,2],[ 'fresh',false,2]],'polls report exactly whether the subscriber is behind');
 // Loading is observable; unavailable is not denied.
 const reader=createScopedReader(pool,{scope,key:'conversations',actorUserId:alice});
 assert.equal(reader.state,'loading','the reader handle is loading before its first read resolves');
 const done=await reader.done;
 assert.deepEqual([done.state,reader.state],[ 'fresh','fresh'],'the reader resolves to the read outcome');
 const dead=new pg.Pool({connectionString:url,max:1});await dead.end();
 const down=await readScoped(dead,{scope,key:'conversations',actorUserId:alice});
 assert.equal(down.state,'unavailable','a dead transport reads unavailable, not denied or empty');
 const deadReader=createScopedReader(dead,{scope,key:'conversations',actorUserId:alice});
 await deadReader.done;
 assert.equal(deadReader.state,'unavailable','the reader surfaces transport failure as unavailable');
});
