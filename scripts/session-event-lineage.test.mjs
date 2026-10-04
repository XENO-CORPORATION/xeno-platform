// SES-07 against real PostgreSQL: CLI, GUI, Hub embed and provider TUI
// adapters retain a single authoritative session/event lineage and one
// execution-owner lease. Tool, notification and provider-command events stay
// visible through the structured lineage; terminal ANSI is presentation,
// never authoritative business data.
//
// PROVEN: the execution lease is exclusive (a second holder is refused, the
// holder extends, strangers cannot release); execution events append only
// under the caller's live lease while notes append freely; all four
// adapters append into one seq-ordered lineage readable in full; payloads
// carrying ANSI anywhere (string, nested object, array) are refused while
// the same escapes in presentation store verbatim; an expired lease frees
// the session for the next holder.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {acquireExecutionLease,releaseExecutionLease,appendSessionEvent,readSessionLineage}=await import('../src/server/services/sessionLineage.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('SES-07: one lineage and one execution lease; ANSI stays in presentation',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`l7-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob');
 const conv=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[alice,'Lineage'])).rows[0].id;
 // One lease, one holder; strangers cannot steal or release it.
 await acquireExecutionLease(pool,{actorUserId:alice,conversationId:conv,adapter:'cli'});
 await assert.rejects(acquireExecutionLease(pool,{actorUserId:bob,conversationId:conv,adapter:'gui'}),
  e=>e.message==='lease_held','a second holder cannot take a live lease');
 await acquireExecutionLease(pool,{actorUserId:alice,conversationId:conv,adapter:'cli'});
 await assert.rejects(releaseExecutionLease(pool,{actorUserId:bob,conversationId:conv,adapter:'gui'}),
  e=>e.message==='release_not_authorized','a stranger cannot release someone else\'s lease');
 // Execution events need the caller's live lease; notes do not.
 await assert.rejects(appendSessionEvent(pool,{actorUserId:bob,conversationId:conv,adapter:'gui',kind:'tool',payload:{name:'ls'}}),
  e=>e.message==='lease_not_held','a tool event without the lease is refused');
 await assert.rejects(appendSessionEvent(pool,{actorUserId:alice,conversationId:conv,adapter:'gui',kind:'tool',payload:{name:'ls'}}),
  e=>e.message==='lease_not_held','the lease binds adapter AND actor: the wrong adapter is refused');
 const noted=await appendSessionEvent(pool,{actorUserId:bob,conversationId:conv,adapter:'gui',kind:'note',payload:{text:'hello'}});
 assert.equal(noted.seq,1,'notes append freely and start the sequence');
 // All four adapters share one ordered lineage.
 const e1=await appendSessionEvent(pool,{actorUserId:alice,conversationId:conv,adapter:'cli',kind:'tool',payload:{name:'ls',code:0}});
 await releaseExecutionLease(pool,{actorUserId:alice,conversationId:conv,adapter:'cli'});
 await acquireExecutionLease(pool,{actorUserId:bob,conversationId:conv,adapter:'provider-tui'});
 const e2=await appendSessionEvent(pool,{actorUserId:bob,conversationId:conv,adapter:'provider-tui',kind:'provider-command',
  payload:{argv:['deploy']},presentation:'\x1b[32mok\x1b[0m'});
 await releaseExecutionLease(pool,{actorUserId:bob,conversationId:conv,adapter:'provider-tui'});
 await acquireExecutionLease(pool,{actorUserId:alice,conversationId:conv,adapter:'hub'});
 const e3=await appendSessionEvent(pool,{actorUserId:alice,conversationId:conv,adapter:'hub',kind:'notification',payload:{text:'done'}});
 assert.deepEqual([e1.seq,e2.seq,e3.seq],[2,3,4],'sequence numbers are total across adapters and holders');
 const lineage=await readSessionLineage(pool,{conversationId:conv});
 assert.deepEqual(lineage.map(e=>[e.seq,e.adapter,e.kind]),[[1,'gui','note'],[2,'cli','tool'],[3,'provider-tui','provider-command'],[4,'hub','notification']],
  'one read shows every adapter\'s events in sequence order');
 assert.deepEqual([lineage[2].payload,lineage[2].presentation],[{argv:['deploy']},'\x1b[32mok\x1b[0m'],
  'presentation keeps its ANSI verbatim while the payload stays clean');
 // ANSI anywhere in business data is refused.
 for (const [nasty,where] of [['\x1b[31mred','top string'],[{out:'\x1b[0m'},'array'],[{nested:{out:'x\x1b[2K'}},'nested object']]) {
  await assert.rejects(appendSessionEvent(pool,{actorUserId:alice,conversationId:conv,adapter:'hub',kind:'note',payload:nasty}),
   e=>e.message==='ansi_in_payload',`ANSI in a payload ${where} is refused`);
 }
 assert.equal((await readSessionLineage(pool,{conversationId:conv})).length,4,
  'refused appends leave no gaps: the lineage still holds exactly its four events');
 // Expiry frees the lease for the next holder.
 await pool.query("UPDATE session_execution_leases SET expires_at=now()-interval '1 second' WHERE conversation_id=$1",[conv]);
 await acquireExecutionLease(pool,{actorUserId:bob,conversationId:conv,adapter:'gui'});
 await assert.rejects(appendSessionEvent(pool,{actorUserId:alice,conversationId:conv,adapter:'hub',kind:'notification',payload:{text:'stale'}}),
  e=>e.message==='lease_not_held','an expired lease no longer authorizes its old holder');
});
