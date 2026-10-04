// PUB-11 against real PostgreSQL: a public conversation is not a
// public transcript. Selected updates publish by default; full
// transcript or live publication names an explicit scope and needs
// every participant's consent to that exact scope; artifact links
// carry their own state and retention.
//
// PROVEN: the public reads exactly the selected excerpts while the
// transcript refuses; strangers cannot publish and foreign messages
// cannot be selected; full publication waits for every participant
// (author and live joiner alike) and for the live scope hash — stale
// consents never transfer; the transcript then reads whole and in
// order; a withdrawn consent downgrades to updates at once while the
// default surface survives; live publication serves the event log;
// revocation kills every conversation surface while artifact links
// resolve independently; links refuse strangers, honor revocation,
// expire on their retention clock and purge on schedule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {publishSelectedUpdates,readPublishedUpdates,requestFullPublication,recordPublicationConsent,
 withdrawPublicationConsent,publishFullConversation,revokePublication,readPublishedTranscript,
 readPublishedLiveEvents,publishArtifactLink,resolveArtifactLink,revokeArtifactLink,
 purgeExpiredArtifactLinks}=await import('../src/server/services/conversationPublication.js');
const {createLiveShare,acceptLiveShare}=await import('../src/server/services/liveConversationCollaboration.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-11: selected updates by default, consented full publication, independent artifact links',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`p11-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query(
  `INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id`,
  [x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),peer=await user('peer'),lurker=await user('lurker'),stranger=await user('stranger');
 const convo=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[owner,'Atlas sync'])).rows[0].id;
 const other=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[owner,'Side'])).rows[0].id;
 const say=async (c,by,role,text,idx)=>((await pool.query(
  `INSERT INTO chat_messages(conversation_id,user_id,created_by_user_id,role,content,message_index)
   VALUES($1,$2,$2,$3,$4,$5) RETURNING id`,[c,by,role,text,idx])).rows[0].id);
 const m1=await say(convo,owner,'user','kickoff notes',0),m2=await say(convo,peer,'user','peer findings',1);
 const m3=await say(convo,owner,'assistant','draft plan',2),m4=await say(convo,peer,'user','peer objections',3);
 const foreign=await say(other,owner,'user','elsewhere',0);
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
  VALUES('conversation',$1,'admin','user',$2)`,[convo,owner]);
 const share=await createLiveShare(pool,{conversationId:convo,ownerId:owner,role:'viewer',
  visibility:'public',expiresInDays:7});
 await acceptLiveShare(pool,{token:share.share_url.split('/').pop(),userId:lurker});
 // Default surface: exactly the selected excerpts, never the log.
 const pub=await publishSelectedUpdates(pool,{conversationId:convo,actorUserId:owner,messageIds:[m1,m3]});
 assert.equal(pub.updateCount,2,'two selected updates publish');
 const updates=await readPublishedUpdates(pool,convo);
 assert.deepEqual(updates.map(u=>u.excerpt),['kickoff notes','draft plan'],'the public reads exactly the selection');
 await assert.rejects(readPublishedTranscript(pool,convo),e=>/publication_not_found/.test(e.message),
  'a public conversation is not a public transcript');
 await assert.rejects(publishSelectedUpdates(pool,{conversationId:convo,actorUserId:stranger,messageIds:[m1]}),
  e=>/publication_not_authorized/.test(e.message),'a stranger cannot publish');
 await assert.rejects(publishSelectedUpdates(pool,{conversationId:convo,actorUserId:owner,messageIds:[foreign]}),
  e=>/own messages only/.test(e.message),'foreign messages cannot be selected');
 // Full publication waits for every voice and the exact live scope.
 const scope={includeMessages:true,note:`${marker}-v1`};
 const req=await requestFullPublication(pool,{conversationId:convo,actorUserId:owner,mode:'transcript',scope});
 await recordPublicationConsent(pool,{conversationId:convo,userId:owner,scopeHash:req.scopeHash});
 await assert.rejects(publishFullConversation(pool,{conversationId:convo,actorUserId:owner}),
  e=>/participant_consents_missing/.test(e.message),'one consent does not publish');
 try {
  await publishFullConversation(pool,{conversationId:convo,actorUserId:owner});
  assert.fail('the missing-consent publish should refuse');
 } catch (e) {
  assert.ok(e.missing.includes(String(peer))&&e.missing.includes(String(lurker)),
   'the refusal names the author and the live joiner alike');
 }
 await assert.rejects(recordPublicationConsent(pool,{conversationId:convo,userId:stranger,scopeHash:req.scopeHash}),
  e=>/consent_not_a_participant/.test(e.message),'a stranger cannot consent');
 await recordPublicationConsent(pool,{conversationId:convo,userId:peer,scopeHash:req.scopeHash});
 await recordPublicationConsent(pool,{conversationId:convo,userId:lurker,scopeHash:req.scopeHash});
 const full=await publishFullConversation(pool,{conversationId:convo,actorUserId:owner});
 assert.equal(full.state,'published','full coverage publishes the transcript');
 const log=await readPublishedTranscript(pool,convo);
 assert.deepEqual(log.map(m=>m.content),['kickoff notes','peer findings','draft plan','peer objections'],
  'the published transcript reads whole and in order');
 // A scope change invalidates every prior consent.
 const req2=await requestFullPublication(pool,{conversationId:convo,actorUserId:owner,mode:'transcript',
  scope:{includeMessages:true,note:`${marker}-v2`}});
 assert.notEqual(req2.scopeHash,req.scopeHash,'the new scope hashes differently');
 await assert.rejects(publishFullConversation(pool,{conversationId:convo,actorUserId:owner}),
  e=>/participant_consents_missing/.test(e.message),'stale consents never transfer to a new scope');
 for (const who of [owner,peer,lurker]) {
  await recordPublicationConsent(pool,{conversationId:convo,userId:who,scopeHash:req2.scopeHash});
 }
 await publishFullConversation(pool,{conversationId:convo,actorUserId:owner});
 // Withdrawal downgrades to the default surface at once.
 const down=await withdrawPublicationConsent(pool,{conversationId:convo,userId:lurker});
 assert.equal(down.downgraded,true,'withdrawal downgrades the live full surface');
 assert.equal(down.mode,'updates','the downgrade lands on the default surface');
 await assert.rejects(readPublishedTranscript(pool,convo),e=>/publication_not_found/.test(e.message),
  'the transcript closes the moment consent leaves');
 assert.equal((await readPublishedUpdates(pool,convo)).length,2,'the default surface survives withdrawal');
 // Live publication serves the event log under the same ceremony.
 const live=await requestFullPublication(pool,{conversationId:convo,actorUserId:owner,mode:'live_full',
  scope:{includeMessages:true,includeEvents:true,note:`${marker}-live`}});
 for (const who of [owner,peer,lurker]) {
  await recordPublicationConsent(pool,{conversationId:convo,userId:who,scopeHash:live.scopeHash});
 }
 await publishFullConversation(pool,{conversationId:convo,actorUserId:owner});
 const events=await readPublishedLiveEvents(pool,{conversationId:convo});
 assert.ok(events.some(e=>e.eventType==='share.created'),'the live surface serves the share event');
 assert.ok(events.some(e=>e.eventType==='participant.joined'),'the live surface serves the join event');
 // Artifact links live and die on their own retention, not the conversation's.
 const aid=`a_${marker.replace(/-/g,'')}`.slice(0,24);
 await pool.query(`INSERT INTO artifacts(id,owner_user_id,title) VALUES($1,$2,'Atlas page')`,[aid,owner]);
 await pool.query(`INSERT INTO artifact_revisions(artifact_id,revision,content_hash,size_bytes,storage_prefix)
  VALUES($1,0,'sha256:x',10,'artifacts/x/')`,[aid]);
 await assert.rejects(publishArtifactLink(pool,{actorUserId:stranger,artifactId:aid,revision:0}),
  e=>/artifact_link_not_authorized/.test(e.message),'a stranger cannot publish an artifact link');
 const link=await publishArtifactLink(pool,{actorUserId:owner,artifactId:aid,revision:0});
 const hit=await resolveArtifactLink(pool,link.token);
 assert.equal(hit.artifactId,aid,'the published link resolves to its artifact');
 assert.equal(hit.revision,0,'the published link resolves to its revision');
 await revokeArtifactLink(pool,{actorUserId:owner,linkId:link.linkId});
 await assert.rejects(resolveArtifactLink(pool,link.token),e=>/artifact_link_revoked/.test(e.message),
  'a revoked link refuses');
 const expiring=await publishArtifactLink(pool,{actorUserId:owner,artifactId:aid,revision:0});
 await pool.query(`UPDATE artifact_public_links SET created_at = now() - interval '2 days',
  expires_at = now() - interval '1 second' WHERE id=$1`,[expiring.linkId]);
 await assert.rejects(resolveArtifactLink(pool,expiring.token),e=>/artifact_link_expired/.test(e.message),
  'an expired link refuses');
 const row=(await pool.query(`SELECT state FROM artifact_public_links WHERE id=$1`,[expiring.linkId])).rows[0];
 assert.equal(row.state,'expired','expiry flips the stored state');
 await assert.rejects(resolveArtifactLink(pool,'0'.repeat(64)),e=>/artifact_link_not_found/.test(e.message),
  'an unknown token refuses');
 await pool.query(`UPDATE artifact_public_links SET created_at = now() - interval '40 days',
  expires_at = now() - interval '1 day', purge_after = now() - interval '1 second' WHERE id=$1`,[expiring.linkId]);
 const swept=await purgeExpiredArtifactLinks(pool);
 assert.equal(swept.purged,1,'the retention sweep purges the due row');
 await assert.rejects(resolveArtifactLink(pool,expiring.token),e=>/artifact_link_not_found/.test(e.message),
  'a purged link is gone');
 // Revocation kills every conversation surface; artifact links stand apart.
 const lone=await publishArtifactLink(pool,{actorUserId:owner,artifactId:aid,revision:0});
 const gone=await revokePublication(pool,{conversationId:convo,actorUserId:owner});
 assert.equal(gone.state,'revoked','revocation lands');
 await assert.rejects(readPublishedUpdates(pool,convo),e=>/publication_not_found/.test(e.message),
  'revocation closes updates');
 await assert.rejects(readPublishedTranscript(pool,convo),e=>/publication_not_found/.test(e.message),
  'revocation closes the transcript');
 assert.equal((await resolveArtifactLink(pool,lone.token)).artifactId,aid,
  'the artifact link outlives the conversation revocation');
});
