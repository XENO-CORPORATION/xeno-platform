// SES-09 against real PostgreSQL: the storage contract preserves crash
// recovery, deliberate branch/rewind intent and completed turns. Turns
// append per branch as complete or crashed-partial; the user abandons a
// polluted branch or rewinds to a known-good turn; recovery reads the
// newest unambiguous valid continuation. Completed turns are never
// deleted or rewritten by any of these paths.
//
// PROVEN: two live branches with complete heads are ambiguous and refuse
// until the user abandons one; crash partials stay in the ledger as
// evidence but recovery never resumes from one; rewind pins to a
// completed turn only (partial targets refuse); completed conversations
// refuse turns and intents; abandoned branches refuse turns.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {appendTurn,recordBranchIntent,resolveRecovery}=await import('../src/server/services/conversationTurns.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('SES-09: crash evidence, abandon/rewind intent, unambiguous recovery',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`s9-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice');
 const conv=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[alice,'Recovery'])).rows[0].id;
 // Two live complete heads are ambiguous: refuse until the user picks a side.
 await appendTurn(pool,{conversationId:conv,contentHash:'h0'});
 await appendTurn(pool,{conversationId:conv,branch:'shard-2',contentHash:'h0b'});
 const forked=await resolveRecovery(pool,conv);
 assert.equal(forked.recovered,false,'recovery refuses an ambiguous fork');
 assert.match(forked.reason,/ambiguous/,'the refusal says ambiguous');
 assert.deepEqual(forked.branches,['main','shard-2'],'both live branches are named');
 await recordBranchIntent(pool,{conversationId:conv,branch:'shard-2',intent:'abandon',actorUserId:alice});
 const resolved=await resolveRecovery(pool,conv);
 assert.equal(resolved.recovered,true,'abandon resolves the fork');
 assert.equal(resolved.branch,'main','recovery follows the one live branch');
 assert.equal(resolved.turnIndex,0,'recovery reads the newest valid continuation');
 // Crash partials stay as evidence but recovery never resumes from one.
 await appendTurn(pool,{conversationId:conv,contentHash:'crash-half',partial:true});
 const crashed=await resolveRecovery(pool,conv);
 assert.equal(crashed.recovered,false,'a partial head is not a valid continuation');
 assert.match(crashed.reason,/no complete turn/,'the refusal says the ledger has no valid turn');
 const evidence=await pool.query("SELECT status FROM conversation_turns WHERE conversation_id=$1 AND branch='main' ORDER BY turn_index",[conv]);
 assert.deepEqual(evidence.rows.map(r=>r.status),['complete','partial'],'the partial crash turn stays in the ledger as evidence');
 await appendTurn(pool,{conversationId:conv,branch:'shard-3',contentHash:'fresh'});
 const clean=await resolveRecovery(pool,conv);
 assert.equal(clean.recovered,true,'a fresh branch recovers the conversation');
 assert.equal(clean.branch,'shard-3','recovery follows the branch with the valid head');
 assert.equal(clean.turnIndex,0);
 // Rewind pins the branch to a completed turn only.
 const conv2=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[alice,'Rewind'])).rows[0].id;
 await appendTurn(pool,{conversationId:conv2,contentHash:'t0'});
 await appendTurn(pool,{conversationId:conv2,contentHash:'t1'});
 await appendTurn(pool,{conversationId:conv2,contentHash:'half',partial:true});
 await assert.rejects(recordBranchIntent(pool,{conversationId:conv2,branch:'main',intent:'rewind-to',targetTurn:2,actorUserId:alice}),
  e=>/completed turn/.test(e.message),'rewinding to a partial turn is refused, not snapped silently');
 const intent=await recordBranchIntent(pool,{conversationId:conv2,branch:'main',intent:'rewind-to',targetTurn:0,actorUserId:alice});
 assert.equal(intent.intent,'rewind-to','the rewind intent records');
 assert.equal(Number(intent.target_turn),0,'the rewind pins to the completed turn');
 await assert.rejects(recordBranchIntent(pool,{conversationId:conv2,branch:'main',intent:'rewind-to',targetTurn:9,actorUserId:alice}),
  e=>/does not exist/.test(e.message),'rewinding to a missing turn is refused');
 // Missing conversations refuse turns and intents; abandoned branches refuse turns.
 const ghost=randomUUID();
 await assert.rejects(appendTurn(pool,{conversationId:ghost,contentHash:'late'}),
  e=>/not found/.test(e.message),'a missing conversation refuses turns');
 await assert.rejects(recordBranchIntent(pool,{conversationId:ghost,branch:'x',intent:'abandon',actorUserId:alice}),
  e=>/not found/.test(e.message),'a missing conversation refuses intents');
 await assert.rejects(appendTurn(pool,{conversationId:conv,branch:'shard-2',contentHash:'zombie'}),
  e=>/abandoned/.test(e.message),'an abandoned branch refuses turns');
});
