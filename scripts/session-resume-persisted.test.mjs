// SES-06 against real PostgreSQL: resume loads persisted identity, mode,
// project and root binding -- not incidental cwd/UI selection. Missing roots
// or revoked grants produce an actionable blocked state without changing mode
// or choosing another workspace.
//
// PROVEN: hostile hints (foreign cwd, decoy UI project, claimed mode/owner)
// are ignored -- every resumed field equals the persisted row; a revoked
// project grant blocks with grant_revoked + request_project_access; an
// archived project root blocks with root_missing + rebind_to_live_root; a
// deleted session workdir blocks with root_missing + reprovision_session_root;
// an agent conversation with no recorded root blocks with no_recorded_root;
// every blocked resume leaves the stored mode untouched and substitutes no
// workspace; strangers cannot resume someone else's conversation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {transitionToAgent,resumeConversation}=await import('../src/server/services/conversationModes.js');
const {resolveProviderCwd}=await import('../src/server/services/providerSessionCwd.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('SES-06: resume loads persisted bindings; missing roots and revoked grants block without drift',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`s6-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),mallory=await user('mallory');
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'ResumeRoot'});
 const decoy=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'Decoy'});
 const hostile={cwd:'/tmp/somebody-elses-checkout',uiProjectId:decoy.id,claimedMode:'chat',claimedOwner:mallory};
 const modeOf=async id=>(await pool.query('SELECT mode FROM chat_conversations WHERE id=$1',[id])).rows[0].mode;
 // Project root: persisted bindings win over hostile hints.
 const pchat=(await pool.query('INSERT INTO chat_conversations(project_id,title) VALUES($1,$2) RETURNING id',[project.id,'PChat'])).rows[0].id;
 await transitionToAgent(pool,{conversationId:pchat,actorUserId:alice,root:{kind:'project',projectId:project.id}});
 const resumed=await resumeConversation(pool,{conversationId:pchat,actorUserId:alice,hints:hostile});
 assert.deepEqual([resumed.blocked,resumed.identity.ownerUserId,resumed.mode,resumed.projectId,resumed.root],
  [false,null,'agent',project.id,{kind:'project',projectId:project.id}],
  'resume returns the persisted identity/mode/project/root; hints are ignored');
 // Revoked grant: blocked, actionable, no drift, no substitution.
 await pool.query("DELETE FROM relationship_tuples WHERE object_type='project' AND object_id=$1 AND subject_id=$2",[project.id,alice]);
 const revoked=await resumeConversation(pool,{conversationId:pchat,actorUserId:alice,hints:hostile});
 assert.deepEqual([revoked.blocked,revoked.reason,revoked.action,revoked.mode,revoked.projectId],
  [true,'grant_revoked','request_project_access','agent',project.id],
  'a revoked grant blocks with an actionable reason and names no substitute workspace');
 assert.equal(await modeOf(pchat),'agent','a blocked resume does not change the stored mode');
 // Archived root: missing, not re-pointed.
 await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'owner','user',$2)",[project.id,alice]);
 const live=await resumeConversation(pool,{conversationId:pchat,actorUserId:alice,hints:{}});
 assert.equal(live.blocked,false,'re-granting unblocks: the blocked state tracks live grants, not history');
 await pool.query('UPDATE chat_projects SET is_archived=TRUE WHERE id=$1',[project.id]);
 const archived=await resumeConversation(pool,{conversationId:pchat,actorUserId:alice,hints:hostile});
 assert.deepEqual([archived.blocked,archived.reason,archived.action,archived.mode,archived.projectId,archived.root],
  [true,'root_missing','rebind_to_live_root','agent',project.id,{kind:'project',projectId:project.id}],
  'an archived root blocks and keeps pointing at the recorded root, never the decoy');
 assert.equal(await modeOf(pchat),'agent','archiving the root does not flip the conversation mode');
 // Session root: provisioned workdir resumes; deleted workdir blocks.
 const root=mkdtempSync(path.join(os.tmpdir(),'ses06-'));
 const personal=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[alice,'Personal'])).rows[0].id;
 await resolveProviderCwd(pool,{conversationId:personal,sessionRoot:root});
 await transitionToAgent(pool,{conversationId:personal,actorUserId:alice,root:{kind:'session-isolated'}});
 const sesresumed=await resumeConversation(pool,{conversationId:personal,actorUserId:alice,hints:hostile});
 assert.deepEqual([sesresumed.blocked,sesresumed.mode,sesresumed.projectId,sesresumed.root],
  [false,'agent',null,{kind:'session-isolated'}],
  'a session root resumes with no project binding and no hint leakage');
 await pool.query('DELETE FROM provider_session_workdirs WHERE conversation_id=$1',[personal]);
 const sesgone=await resumeConversation(pool,{conversationId:personal,actorUserId:alice,hints:hostile});
 assert.deepEqual([sesgone.blocked,sesgone.reason,sesgone.action,sesgone.mode],
  [true,'root_missing','reprovision_session_root','agent'],
  'a deleted session workdir blocks with a reprovision action');
 assert.equal(await modeOf(personal),'agent','losing the session root does not flip the mode');
 // No recorded root: agent mode without a transition row cannot resume live.
 const orphan=(await pool.query("INSERT INTO chat_conversations(owner_user_id,title,mode) VALUES($1,'Orphan','agent') RETURNING id",[alice])).rows[0].id;
 const noroot=await resumeConversation(pool,{conversationId:orphan,actorUserId:alice,hints:{}});
 assert.deepEqual([noroot.blocked,noroot.reason,noroot.action,noroot.mode,noroot.root],
  [true,'no_recorded_root','transition_with_explicit_root','agent',null],
  'agent mode with no recorded root blocks instead of inventing one');
 assert.equal(await modeOf(orphan),'agent','the orphan stays agent-mode while blocked');
 // Identity: the persisted owner binds the resume, not the claimant.
 await assert.rejects(resumeConversation(pool,{conversationId:personal,actorUserId:mallory,hints:{claimedOwner:alice}}),
  e=>e.message==='resume_not_authorized','a stranger cannot resume someone else\'s conversation by claiming it');
 const plain=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[alice,'Plain'])).rows[0].id;
 const chatresumed=await resumeConversation(pool,{conversationId:plain,actorUserId:alice,hints:hostile});
 assert.deepEqual([chatresumed.blocked,chatresumed.mode,chatresumed.root],[false,'chat',null],
  'a plain chat resumes its persisted mode with no root and no hint leakage');
});
