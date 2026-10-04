// VIEW-04 against real PostgreSQL: every list row resolves to the same
// canonical ID across views; view switching preserves independent
// drafts/scroll state and never reparents a session.
//
// PROVEN: a message row, a scope-move row and both scoped list views resolve
// to the same conversation ID (unknown rows refused, never guessed);
// drafts/scroll save and read back per (user, view) with views and users
// fully independent (updating one view leaves the other byte-identical; a
// stranger reads blank, never your draft); invalid view keys and negative
// scrolls are refused; and a full cycle of view-state traffic leaves the
// conversation row byte-identical -- switching views cannot reparent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {resolveMessageConversation,resolveMoveConversation,saveViewState,readViewState}=await import('../src/server/services/viewConsistency.js');
const {moveConversationScope}=await import('../src/server/services/conversationScopes.js');
const {readScoped}=await import('../src/server/services/scopedReads.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('VIEW-04: canonical IDs across views; independent view state; switching never reparents',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`v4-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),mallory=await user('mallory');
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'ViewCanon'});
 const conv=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[alice,'Canon'])).rows[0].id;
 const msg=(await pool.query("INSERT INTO chat_messages(conversation_id,user_id,role,content,message_index) VALUES($1,$2,'user','hi',0) RETURNING id",[conv,alice])).rows[0].id;
 const moved=await moveConversationScope(pool,{conversationId:conv,actorUserId:alice,
  to:{kind:'project',projectId:project.id},audience:{type:'project',id:project.id,historyMessageCount:1}});
 // One subject, every view.
 const viaMsg=await resolveMessageConversation(pool,{messageId:msg});
 const viaMove=await resolveMoveConversation(pool,{moveId:moved.moveId});
 const list=await readScoped(pool,{scope:`project:${project.id}`,key:'conversations',actorUserId:alice});
 const msgs=await readScoped(pool,{scope:`project:${project.id}`,key:`messages:${conv}`,actorUserId:alice});
 assert.deepEqual([viaMsg.conversationId,viaMove.conversationId,list.rows[0].id,msgs.rows[0].content],
  [conv,conv,conv,'hi'],'message rows, move rows and both list views resolve to the same canonical ID');
 await assert.rejects(resolveMessageConversation(pool,{messageId:randomUUID()}),e=>e.message==='message_not_found',
  'an unknown message resolves nowhere, never to a guess');
 await assert.rejects(resolveMoveConversation(pool,{moveId:randomUUID()}),e=>e.message==='move_not_found',
  'an unknown move resolves nowhere, never to a guess');
 // Independent drafts/scroll per (user, view).
 const before=(await pool.query('SELECT owner_user_id,project_id,workspace_id,mode,title,updated_at FROM chat_conversations WHERE id=$1',[conv])).rows[0];
 await saveViewState(pool,{actorUserId:alice,view:'chat',draft:'hello',scrollOffset:5});
 await saveViewState(pool,{actorUserId:alice,view:`agent:${conv}`,draft:'plan',scrollOffset:0});
 assert.deepEqual(await readViewState(pool,{actorUserId:alice,view:'chat'}),
  {userId:alice,view:'chat',draft:'hello',scrollOffset:5,present:true},'the chat view keeps its own draft and scroll');
 assert.deepEqual(await readViewState(pool,{actorUserId:alice,view:`agent:${conv}`}),
  {userId:alice,view:`agent:${conv}`,draft:'plan',scrollOffset:0,present:true},'the agent view keeps its own');
 await saveViewState(pool,{actorUserId:alice,view:'chat',draft:'hello edited',scrollOffset:9});
 assert.deepEqual(await readViewState(pool,{actorUserId:alice,view:`agent:${conv}`}),
  {userId:alice,view:`agent:${conv}`,draft:'plan',scrollOffset:0,present:true},
  'updating one view leaves the other byte-identical');
 assert.deepEqual(await readViewState(pool,{actorUserId:mallory,view:'chat'}),
  {userId:mallory,view:'chat',draft:'',scrollOffset:0,present:false},
  'a stranger reads blank state, never your draft');
 await assert.rejects(saveViewState(pool,{actorUserId:alice,view:'Chat!',draft:'x',scrollOffset:0}),
  e=>e.message==='invalid_view_key','malformed view keys are refused');
 await assert.rejects(saveViewState(pool,{actorUserId:alice,view:'chat',draft:'x',scrollOffset:-1}),
  e=>e.message==='invalid_scroll','negative scroll offsets are refused');
 const after=(await pool.query('SELECT owner_user_id,project_id,workspace_id,mode,title,updated_at FROM chat_conversations WHERE id=$1',[conv])).rows[0];
 assert.deepEqual({...after,updated_at:after.updated_at.toISOString()},{...before,updated_at:before.updated_at.toISOString()},
  'view-state traffic leaves the conversation row byte-identical: switching never reparents');
});
