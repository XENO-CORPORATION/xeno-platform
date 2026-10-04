// PUB-13 against real PostgreSQL: going private revokes future
// public access across the controlled services and warns that taken
// copies cannot be recalled. The repository mirror keeps its own
// visibility, independent in both directions.
//
// PROVEN: a live public project — published projection, conversation
// updates, a live share link and a project-attributed artifact link —
// retreats on one acknowledged call: the projection, updates, share
// and link all refuse immediately while an unattributed link keeps
// resolving; the retreat record counts every revocation and carries
// the unrecallable warning; without the acknowledgment, or from a
// stranger, or twice, the retreat refuses; flipping the mirror never
// moves the project and retreating the project never moves the mirror.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {linkRepository,setRepositoryVisibility,readRepositoryLink,
 retreatProjectToPrivate}=await import('../src/server/services/visibilityRetreat.js');
const {readProjectPolicies}=await import('../src/server/services/projectPolicies.js');
const {mutateProjectPublication,previewProjectPublication,readPublicProject}=await import('../src/server/services/projectPublication.js');
const {publishSelectedUpdates,readPublishedUpdates,publishArtifactLink,
 resolveArtifactLink}=await import('../src/server/services/conversationPublication.js');
const {createLiveShare,findLiveShareForPreview}=await import('../src/server/services/liveConversationCollaboration.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-13: acknowledged retreat revokes everywhere, mirrors stay independent',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`p13-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query(
  `INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id`,
  [x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),stranger=await user('stranger');
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
  VALUES('project',$1,'admin','user',$2)`,[project,owner]);
 const ctx={actorUserId:owner,clientId:`${marker}-pub`};
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'draft',expectedRevision:'0',
  content:{schemaVersion:1,title:'Atlas',purpose:'Maps for all',license:'XENO-PUBLIC-1.0',
   termsVersion:'2026-10-04',contributionGuide:'Open offers welcome',roadmap:'v1 soon',updates:'none yet'}});
 const preview=await previewProjectPublication(pool,ctx,{projectId:project,
  expectedActorAccountId:owner,visibility:'public'});
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'publish',expectedRevision:'1',visibility:'public',
  previewHash:preview.previewHash});
 assert.equal((await readPublicProject(pool,project)).title,'Atlas','the projection reads publicly');
 const convo=(await pool.query('INSERT INTO chat_conversations(title,project_id) VALUES($1,$2) RETURNING id',['Atlas sync',project])).rows[0].id;
 const msg=(await pool.query(`INSERT INTO chat_messages(conversation_id,user_id,created_by_user_id,role,content,message_index)
  VALUES($1,$2,$2,'user','kickoff notes',0) RETURNING id`,[convo,owner])).rows[0].id;
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
  VALUES('conversation',$1,'admin','user',$2)`,[convo,owner]);
 await publishSelectedUpdates(pool,{conversationId:convo,actorUserId:owner,messageIds:[msg]});
 assert.equal((await readPublishedUpdates(pool,convo)).length,1,'the updates read publicly');
 const share=await createLiveShare(pool,{conversationId:convo,ownerId:owner,role:'viewer',
  visibility:'public',expiresInDays:7});
 const token=share.share_url.split('/').pop();
 assert.ok(await findLiveShareForPreview(pool,token),'the share link previews');
 const aid=`a_${marker.replace(/-/g,'')}`.slice(0,24);
 await pool.query(`INSERT INTO artifacts(id,owner_user_id,title) VALUES($1,$2,'Atlas page')`,[aid,owner]);
 await pool.query(`INSERT INTO artifact_revisions(artifact_id,revision,content_hash,size_bytes,storage_prefix)
  VALUES($1,0,'sha256:x',10,'artifacts/x/')`,[aid]);
 const scoped=await publishArtifactLink(pool,{actorUserId:owner,artifactId:aid,revision:0,projectId:project});
 const lone=await publishArtifactLink(pool,{actorUserId:owner,artifactId:aid,revision:0});
 assert.equal((await resolveArtifactLink(pool,scoped.token)).artifactId,aid,'the scoped link resolves');
 // The mirror moves alone: flipping it never moves the project.
 await linkRepository(pool,{projectId:project,actorUserId:owner,provider:'github',
  remoteUrl:`https://example.test/atlas`,repoVisibility:'public'});
 await setRepositoryVisibility(pool,{projectId:project,actorUserId:owner,repoVisibility:'private'});
 assert.equal((await readProjectPolicies(pool,project)).visibility,'public',
  'a repository change never moves XENO project visibility');
 // The retreat needs its acknowledgment, its authority, and a live surface.
 await assert.rejects(retreatProjectToPrivate(pool,{projectId:project,actorUserId:owner}),
  e=>/unrecallable_ack_required/.test(e.message),'retreat without the acknowledgment refuses');
 await assert.rejects(retreatProjectToPrivate(pool,{projectId:project,actorUserId:stranger,
  acknowledgeUnrecallable:true}),e=>/retreat_not_authorized/.test(e.message),'a stranger cannot retreat');
 const retreat=await retreatProjectToPrivate(pool,{projectId:project,actorUserId:owner,
  acknowledgeUnrecallable:true});
 assert.ok(retreat.warning.includes('cannot be recalled'),'the retreat warns the unrecallable');
 assert.equal(retreat.publication_revoked,true,'the projection revoke lands');
 assert.equal(Number(retreat.revoked_conversation_publications),1,'the conversation publication revokes');
 assert.equal(Number(retreat.revoked_share_links),1,'the share link revokes');
 assert.equal(Number(retreat.revoked_artifact_links),1,'the project-attributed link revokes');
 assert.equal((await readProjectPolicies(pool,project)).visibility,'private','the project reads private');
 await assert.rejects(readPublicProject(pool,project),e=>/project_not_found/.test(e.message+e.code),
  'the projection closes immediately');
 await assert.rejects(readPublishedUpdates(pool,convo),e=>/publication_not_found/.test(e.message),
  'the updates close immediately');
 await assert.rejects(findLiveShareForPreview(pool,token),e=>/collaboration_not_found/.test(e.message+e.code),
  'the share link dies immediately');
 await assert.rejects(resolveArtifactLink(pool,scoped.token),e=>/artifact_link_revoked/.test(e.message),
  'the attributed link revokes');
 assert.equal((await resolveArtifactLink(pool,lone.token)).artifactId,aid,
  'the unattributed link stands outside the retreat');
 assert.equal((await readRepositoryLink(pool,project)).repo_visibility,'private',
  'retreating the project never moves the mirror');
 await assert.rejects(retreatProjectToPrivate(pool,{projectId:project,actorUserId:owner,
  acknowledgeUnrecallable:true}),e=>/already_private/.test(e.message),'a second retreat refuses');
});
