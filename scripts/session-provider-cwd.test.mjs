// SES-02 against real PostgreSQL (+filesystem): chat never requires a
// directory selection, and when a provider needs a cwd the host supplies
// isolated session storage, labeled as such -- never an implicit project or
// repository grant.
//
// PROVEN: a conversation with NULL project/workspace bindings stores and
// carries messages fine (no directory anywhere in the flow); resolving its
// provider cwd creates exactly one deterministic directory under the
// host-owned session root, recorded with scope 'session-isolated';
// re-resolution is idempotent; binding the conversation to a project flips
// the resolver to refusal (the authorized-root path owns bound chats) and
// unbinding restores session resolution; missing conversations and
// non-directory/relative session roots are refused.
// NOTE: the resolver is proven standalone; adoption into provider execution
// call sites is the tracked rollout step (see module NOTE).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {resolveProviderCwd}=await import('../src/server/services/providerSessionCwd.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('SES-02: directory-less chat; host-supplied isolated session cwd',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`s2-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice');
 const root=mkdtempSync(path.join(os.tmpdir(),'ses02-'));
 const conv=(await pool.query("INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,'NoDir') RETURNING id,owner_user_id,project_id,workspace_id",[alice])).rows[0];
 assert.deepEqual([conv.owner_user_id,conv.project_id,conv.workspace_id],[alice,null,null],'a personal chat binds an owner and no directory at all');
 await pool.query("INSERT INTO chat_messages(conversation_id,user_id,role,content,message_index) VALUES($1,$2,'user','hello',0)",[conv.id,alice]);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id=$1',[conv.id])).rows[0].n,1,
  'directory-less chat stores and carries messages: no selection required');

 // ── The host supplies one labeled isolated directory, idempotently.
 const r1=await resolveProviderCwd(pool,{conversationId:conv.id,sessionRoot:root});
 assert.deepEqual([r1.scope,r1.conversationId],[ 'session-isolated',conv.id],'the resolution is labeled session-isolated');
 assert.ok(r1.path.startsWith(root+path.sep)&&path.basename(r1.path).includes(conv.id),
  'the path lives under the host session root and names its conversation');
 assert.ok(statSync(r1.path).isDirectory(),'the directory exists on disk');
 assert.deepEqual((await pool.query('SELECT path,scope FROM provider_session_workdirs WHERE conversation_id=$1',[conv.id])).rows[0],
  {path:r1.path,scope:'session-isolated'},'exactly one labeled row records the grant');
 const r2=await resolveProviderCwd(pool,{conversationId:conv.id,sessionRoot:root});
 assert.equal(r2.path,r1.path,'re-resolution returns the identical directory');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM provider_session_workdirs WHERE conversation_id=$1',[conv.id])).rows[0].n,1,
  '...with still exactly one row: idempotent, no duplicates');

 // ── A bound project flips the switch: no implicit grant, ever.
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'Bound'});
 await pool.query('UPDATE chat_conversations SET project_id=$1,owner_user_id=NULL WHERE id=$2',[project.id,conv.id]);
 await assert.rejects(resolveProviderCwd(pool,{conversationId:conv.id,sessionRoot:root}),e=>e.code==='denied',
  'a project-bound conversation is refused: the authorized-root path owns it, not the session path');
 await pool.query('UPDATE chat_conversations SET project_id=NULL,owner_user_id=$1 WHERE id=$2',[alice,conv.id]);
 const r3=await resolveProviderCwd(pool,{conversationId:conv.id,sessionRoot:root});
 assert.equal(r3.path,r1.path,'unbinding restores the same session directory: the binding is the switch');

 // ── Bad inputs are refused, not improvised.
 await assert.rejects(resolveProviderCwd(pool,{conversationId:randomUUID(),sessionRoot:root}),e=>e.code==='not_found',
  'a missing conversation is refused');
 await assert.rejects(resolveProviderCwd(pool,{conversationId:conv.id,sessionRoot:'relative/path'}),e=>e.code==='bad_input',
  'a relative session root is refused: the host root must be absolute');
 await assert.rejects(resolveProviderCwd(pool,{conversationId:conv.id,sessionRoot:path.join(root,'no-such-dir')}),e=>e.code==='bad_input',
  'a missing session root is refused');
 const scopeCheck=(await pool.query(`SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
  WHERE t.relname='provider_session_workdirs' AND pg_get_constraintdef(c.oid) LIKE '%session-isolated%'`)).rows[0].d;
 assert.ok(scopeCheck.includes("scope = 'session-isolated'"),'the label is schema-pinned: this table cannot express any other scope');
});
