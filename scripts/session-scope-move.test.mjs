// SES-05 against real PostgreSQL: moving/sharing a conversation is separate
// from mode/root changes; the move shows its target audience and included
// history; no silent transfer; an active provider handoff settles first.
//
// PROVEN: a personal->project move rebinds scope only (mode and mode
// transitions survive byte-for-byte) and records audience + exact history
// count + mover; a wrong history count, a mismatched audience, or a missing
// audience is refused; an active provider session grant blocks the move until
// releaseProviderCwd settles it (idempotent release reports released:false
// when nothing is active); strangers cannot move or release; moves into
// foreign projects or foreign personal scopes are refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {moveConversationScope}=await import('../src/server/services/conversationScopes.js');
const {transitionToAgent}=await import('../src/server/services/conversationModes.js');
const {resolveProviderCwd,releaseProviderCwd}=await import('../src/server/services/providerSessionCwd.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('SES-05: scope moves name audience and history; provider handoff settles first; mode untouched',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`s5-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),mallory=await user('mallory');
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'MoveTarget'});
 const foreign=await createAuthorizedProject(pool,{principal:userPrincipal(mallory),name:'Foreign'});
 const say=async (conv,who,n)=>{for(let i=0;i<n;i++)await pool.query('INSERT INTO chat_messages(conversation_id,user_id,role,content,message_index) VALUES($1,$2,$3,$4,$5)',[conv,who,i%2?'assistant':'user',`m${i}`,i]);};
 // A clean personal->project move records everything and touches only scope.
 const chat=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[alice,'Chat'])).rows[0].id;
 await say(chat,alice,2);
 const moved=await moveConversationScope(pool,{conversationId:chat,actorUserId:alice,
  to:{kind:'project',projectId:project.id},audience:{type:'project',id:project.id,historyMessageCount:2}});
 assert.deepEqual([moved.fromScope,moved.toScope,moved.historyMessageCount,moved.mode],
  [`personal:${alice}`,`project:${project.id}`,2,'chat'],'the move rebinds scope and reports mode, not changes it');
 const scope=(await pool.query('SELECT owner_user_id,project_id,mode FROM chat_conversations WHERE id=$1',[chat])).rows[0];
 assert.deepEqual([scope.owner_user_id,scope.project_id,scope.mode],[null,project.id,'chat'],
  'only the scope columns change; the mode column is untouched');
 const mrow=(await pool.query('SELECT from_scope,to_scope,audience_type,audience_id,history_message_count,moved_by_user_id FROM conversation_scope_moves WHERE conversation_id=$1',[chat])).rows[0];
 assert.deepEqual([mrow.from_scope,mrow.to_scope,mrow.audience_type,mrow.audience_id,mrow.history_message_count,mrow.moved_by_user_id],
  [`personal:${alice}`,`project:${project.id}`,'project',project.id,2,alice],
  'the recorded move names its audience and the exact history that moved');
 // No silent transfer: the manifest must be exact and name the target.
 const chat2=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[alice,'Chat2'])).rows[0].id;
 await say(chat2,alice,2);
 await assert.rejects(moveConversationScope(pool,{conversationId:chat2,actorUserId:alice,
  to:{kind:'project',projectId:project.id},audience:{type:'project',id:project.id,historyMessageCount:1}}),
  e=>e.message==='history_count_mismatch','a partial history count is refused: the manifest must equal the full history');
 await assert.rejects(moveConversationScope(pool,{conversationId:chat2,actorUserId:alice,
  to:{kind:'project',projectId:project.id},audience:{type:'project',id:foreign.id,historyMessageCount:2}}),
  e=>e.message==='audience_required','an audience naming a different target is refused');
 await assert.rejects(moveConversationScope(pool,{conversationId:chat2,actorUserId:alice,
  to:{kind:'project',projectId:project.id}}),
  e=>e.message==='audience_required','a move that shows no audience is refused');
 // Provider handoff settles before the scope move.
 const root=mkdtempSync(path.join(os.tmpdir(),'ses05-'));
 const sess=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[alice,'Sess'])).rows[0].id;
 await say(sess,alice,1);
 await resolveProviderCwd(pool,{conversationId:sess,sessionRoot:root});
 await assert.rejects(moveConversationScope(pool,{conversationId:sess,actorUserId:alice,
  to:{kind:'project',projectId:project.id},audience:{type:'project',id:project.id,historyMessageCount:1}}),
  e=>e.message==='provider_handoff_unsettled','an active provider session blocks the scope move');
 await assert.rejects(releaseProviderCwd(pool,{conversationId:sess,actorUserId:mallory}),
  e=>e.message==='release_not_authorized','a stranger cannot settle someone else\'s session');
 const settled=await releaseProviderCwd(pool,{conversationId:sess,actorUserId:alice});
 assert.equal(settled.released,true,'the owner settles the active provider grant');
 const idle=await releaseProviderCwd(pool,{conversationId:sess,actorUserId:alice});
 assert.equal(idle.released,false,'settling an already-settled session reports released:false');
 const moved2=await moveConversationScope(pool,{conversationId:sess,actorUserId:alice,
  to:{kind:'project',projectId:project.id},audience:{type:'project',id:project.id,historyMessageCount:1}});
 assert.equal(moved2.toScope,`project:${project.id}`,'the move proceeds once the provider handoff settles');
 // Mode/root separation: an agent conversation moves without mode drift.
 const agent=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[alice,'Agent'])).rows[0].id;
 await say(agent,alice,1);
 await resolveProviderCwd(pool,{conversationId:agent,sessionRoot:root});
 await transitionToAgent(pool,{conversationId:agent,actorUserId:alice,root:{kind:'session-isolated'}});
 await releaseProviderCwd(pool,{conversationId:agent,actorUserId:alice});
 const transitionsBefore=(await pool.query('SELECT count(*)::int AS n FROM conversation_mode_transitions WHERE conversation_id=$1',[agent])).rows[0].n;
 const moved3=await moveConversationScope(pool,{conversationId:agent,actorUserId:alice,
  to:{kind:'project',projectId:project.id},audience:{type:'project',id:project.id,historyMessageCount:1}});
 const after=(await pool.query('SELECT mode,project_id FROM chat_conversations WHERE id=$1',[agent])).rows[0];
 const transitionsAfter=(await pool.query('SELECT count(*)::int AS n FROM conversation_mode_transitions WHERE conversation_id=$1',[agent])).rows[0].n;
 assert.deepEqual([moved3.mode,after.mode,after.project_id,transitionsBefore,transitionsAfter],
  ['agent','agent',project.id,1,1],'the agent move changes scope only: mode stays agent, transitions untouched');
 // Authorization: strangers move nothing; foreign scopes accept nothing.
 await assert.rejects(moveConversationScope(pool,{conversationId:chat2,actorUserId:mallory,
  to:{kind:'project',projectId:foreign.id},audience:{type:'project',id:foreign.id,historyMessageCount:2}}),
  e=>e.message==='move_not_authorized','a stranger cannot move someone else\'s conversation');
 await assert.rejects(moveConversationScope(pool,{conversationId:chat2,actorUserId:alice,
  to:{kind:'project',projectId:foreign.id},audience:{type:'project',id:foreign.id,historyMessageCount:2}}),
  e=>e.message==='move_not_authorized','a move into a project the actor does not hold is refused');
 await assert.rejects(moveConversationScope(pool,{conversationId:chat2,actorUserId:alice,
  to:{kind:'personal',ownerUserId:mallory},audience:{type:'user',id:mallory,historyMessageCount:2}}),
  e=>e.message==='move_not_authorized','a move into someone else\'s personal scope is refused');
});
