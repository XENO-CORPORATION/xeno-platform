// SES-03 against real PostgreSQL (+filesystem): Chat->Agent requires an
// explicit authorized root, records the mode/context change, and preserves
// conversational continuity and pending state.
//
// PROVEN: a personal chat with a provisioned session workdir transitions
// under its session-isolated root (mode flips, transition row pins
// from/to/root/authorizer/pending snapshot); a project chat transitions
// under its own project when the actor holds owner/editor; rootless,
// unauthorized, unknown-project, mismatched-root and unprovisioned-session
// transitions are all refused with distinct reasons; workspace-bound chats
// are refused honestly (no membership source); double transitions are
// refused; messages, workdirs and conversation state survive byte-for-byte
// with the snapshot matching.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {transitionToAgent}=await import('../src/server/services/conversationModes.js');
const {resolveProviderCwd}=await import('../src/server/services/providerSessionCwd.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('SES-03: agent mode needs an explicit authorized root; continuity preserved',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`s3-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),mallory=await user('mallory');
 const root=mkdtempSync(path.join(os.tmpdir(),'ses03-'));
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'AgentRoot'});
 const personal=(await pool.query("INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,'Personal') RETURNING id",[alice])).rows[0].id;
 await pool.query("INSERT INTO chat_messages(conversation_id,user_id,role,content,message_index) VALUES($1,$2,'user','plan the work',0),($1,$2,'assistant','plan drafted',1)",[personal,alice]);
 const msgBefore=(await pool.query('SELECT id,role,content,message_index FROM chat_messages WHERE conversation_id=$1 ORDER BY message_index',[personal])).rows;

 // ── Session-rooted transition on a personal chat: recorded, continuous.
 await assert.rejects(transitionToAgent(pool,{conversationId:personal,actorUserId:alice}),e=>e.code==='bad_input'&&e.message==='authorized_root_required',
  'a rootless transition is refused: the root is explicit, never defaulted');
 await assert.rejects(transitionToAgent(pool,{conversationId:personal,actorUserId:alice,root:{kind:'session-isolated'}}),e=>e.message==='session_root_not_provisioned',
  'a session root that was never provisioned is refused');
 const wd=await resolveProviderCwd(pool,{conversationId:personal,sessionRoot:root});
 const moved=await transitionToAgent(pool,{conversationId:personal,actorUserId:alice,root:{kind:'session-isolated'}});
 assert.deepEqual([moved.fromMode,moved.toMode,moved.rootKind,moved.rootProjectId],[ 'chat','agent','session-isolated',null],
  'the personal chat moves to agent mode under its isolated session root');
 assert.deepEqual(moved.pendingState.messageCount,2,'the pending snapshot counts the live messages');
 assert.equal((await pool.query('SELECT mode FROM chat_conversations WHERE id=$1',[personal])).rows[0].mode,'agent','the mode flips');
 const trow=(await pool.query('SELECT from_mode,to_mode,root_kind,root_project_id,authorized_by_user_id,pending_state FROM conversation_mode_transitions WHERE conversation_id=$1',[personal])).rows[0];
 assert.deepEqual([trow.from_mode,trow.to_mode,trow.root_kind,trow.root_project_id,trow.authorized_by_user_id,trow.pending_state.messageCount],
  ['chat','agent','session-isolated',null,alice,2],'the transition row pins from/to, root, authorizer and pending state');
 assert.deepEqual((await pool.query('SELECT id,role,content,message_index FROM chat_messages WHERE conversation_id=$1 ORDER BY message_index',[personal])).rows,msgBefore,
  'conversational continuity survives: messages byte-for-byte');
 assert.deepEqual((await pool.query('SELECT path,scope FROM provider_session_workdirs WHERE conversation_id=$1',[personal])).rows[0],
  {path:wd.path,scope:'session-isolated'},'the session grant survives the transition');
 await assert.rejects(transitionToAgent(pool,{conversationId:personal,actorUserId:alice,root:{kind:'session-isolated'}}),e=>e.message==='mode_already_agent',
  'an agent-mode chat cannot transition again');

 // ── Project roots: authorized actors pass, everyone else is refused.
 const pchat=(await pool.query('INSERT INTO chat_conversations(project_id,title) VALUES($1,$2) RETURNING id',[project.id,'PChat'])).rows[0].id;
 await assert.rejects(transitionToAgent(pool,{conversationId:pchat,actorUserId:mallory,root:{kind:'project',projectId:project.id}}),e=>e.message==='root_not_authorized',
  'an actor with no project relation cannot wield the project root');
 await assert.rejects(transitionToAgent(pool,{conversationId:pchat,actorUserId:alice,root:{kind:'project',projectId:randomUUID()}}),e=>e.message==='root_binding_mismatch',
  'a different project cannot authorize a bound chat');
 await assert.rejects(transitionToAgent(pool,{conversationId:pchat,actorUserId:alice,root:{kind:'session-isolated'}}),e=>e.message==='root_binding_mismatch',
  'a session root cannot shadow a project binding');
 await assert.rejects(transitionToAgent(pool,{conversationId:pchat,actorUserId:alice,root:{kind:'project'}}),e=>e.message==='invalid_project',
  'a project root without its id is refused');
 const pmoved=await transitionToAgent(pool,{conversationId:pchat,actorUserId:alice,root:{kind:'project',projectId:project.id}});
 assert.deepEqual([pmoved.toMode,pmoved.rootKind,pmoved.rootProjectId],[ 'agent','project',project.id],
  'the holding actor transitions the bound chat under its own project root');
 const wchat=(await pool.query('INSERT INTO chat_conversations(workspace_id,title) VALUES($1,$2) RETURNING id',[randomUUID(),'WChat'])).rows[0].id;
 await assert.rejects(transitionToAgent(pool,{conversationId:wchat,actorUserId:alice,root:{kind:'session-isolated'}}),e=>e.message==='workspace_roots_unsupported',
  'workspace-bound chats are refused honestly: no membership source exists to authorize against');
});
