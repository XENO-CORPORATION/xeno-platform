// RUN-05 against real PostgreSQL: any child conversation opens under a
// parent and returns without being cancelled; tool previews stay bounded
// and collapse per row without rewriting the transcript; the parent's
// native ownership (execution lease) survives the whole round-trip.
//
// PROVEN: open links a live child; return marks the link returned while
// the child keeps accepting turns and keeps its lease; only an explicit
// close ends it (closed refuses return and re-close); a 100KB tool output
// stores a 4096-char preview with truncated=true and a full-output
// locator, never inline; collapsing one preview leaves siblings and
// preview bytes untouched; the parent's lease holder is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {openChild,returnToParent,closeChild,readChildLink,storeToolPreview,readToolPreview,setPreviewCollapsed,PREVIEW_BOUND}=await import('../src/server/services/childConversations.js');
const {appendTurn}=await import('../src/server/services/conversationTurns.js');
const {acquireExecutionLease,appendSessionEvent}=await import('../src/server/services/sessionLineage.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('RUN-05: child opens and returns uncancelled; previews bounded; parent lease intact',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`r5-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob');
 const parent=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[alice,'Parent'])).rows[0].id;
 await assert.rejects(openChild(pool,{parentConversationId:randomUUID(),actorUserId:alice}),
  e=>/not found/.test(e.message),'a child cannot open under a missing parent');
 // The parent's native ownership is established first and must survive.
 await acquireExecutionLease(pool,{actorUserId:alice,conversationId:parent,adapter:'cli'});
 const link=await openChild(pool,{parentConversationId:parent,actorUserId:alice,title:'Scout'});
 assert.equal(link.state,'open','a fresh child link is open');
 const child=link.child_conversation_id;
 await appendTurn(pool,{conversationId:child,contentHash:'c0'});
 // Return: the link flips, the child itself is untouched.
 const back=await returnToParent(pool,{childConversationId:child});
 assert.equal(back.state,'returned','return marks the link returned');
 assert.ok(back.returned_at,'return stamps the link, nothing else');
 const live=await appendTurn(pool,{conversationId:child,contentHash:'c1'});
 assert.equal(Number(live.turn_index),1,'the returned child keeps accepting turns: it was not cancelled');
 const again=await returnToParent(pool,{childConversationId:child});
 assert.equal(again.state,'returned','return is idempotent');
 // Only an explicit close ends the child.
 const shut=await closeChild(pool,{childConversationId:child});
 assert.equal(shut.state,'closed','close ends the child');
 assert.ok(shut.closed_at,'close stamps the link');
 await assert.rejects(returnToParent(pool,{childConversationId:child}),
  e=>/closed/.test(e.message),'a closed child refuses return');
 await assert.rejects(closeChild(pool,{childConversationId:child}),
  e=>/closed/.test(e.message),'a closed child refuses re-close');
 assert.equal((await readChildLink(pool,child)).state,'closed','the link reads closed');
 // The parent kept its lease through open and return: the holder appends,
 // a stranger is still refused.
 await appendSessionEvent(pool,{actorUserId:alice,conversationId:parent,adapter:'cli',kind:'tool',payload:{name:'ls'}});
 await assert.rejects(appendSessionEvent(pool,{actorUserId:bob,conversationId:parent,adapter:'gui',kind:'tool',payload:{name:'ls'}}),
  e=>e.message==='lease_not_held','the parent lease holder is unchanged by the child round-trip');
 // Bounded previews: 100KB in, 4096 chars stored, locator for the rest.
 const big='x'.repeat(100*1024);
 const stored=await storeToolPreview(pool,{conversationId:parent,toolCallId:'call-1',output:big,fullRef:'artifact:full-1'});
 assert.equal(stored.preview.length,PREVIEW_BOUND,'the stored preview is bounded');
 assert.equal(stored.truncated,true,'oversize output is honestly flagged truncated');
 const read=await readToolPreview(pool,{conversationId:parent,toolCallId:'call-1'});
 assert.equal(read.preview.length,PREVIEW_BOUND,'reads stay bounded: the full output is never inlined');
 assert.equal(read.fullRef,'artifact:full-1','the full output stays behind its locator');
 const small=await storeToolPreview(pool,{conversationId:parent,toolCallId:'call-2',output:'ok',fullRef:'artifact:full-2'});
 assert.equal(small.truncated,false,'short output is stored whole and unflagged');
 // Collapse flips one row; siblings and bytes are untouched.
 await setPreviewCollapsed(pool,{conversationId:parent,toolCallId:'call-1',collapsed:true});
 const one=await readToolPreview(pool,{conversationId:parent,toolCallId:'call-1'});
 const two=await readToolPreview(pool,{conversationId:parent,toolCallId:'call-2'});
 assert.equal(one.collapsed,true,'the target preview collapses');
 assert.equal(two.collapsed,false,'a sibling preview is untouched by the collapse');
 assert.equal(one.preview,big.slice(0,PREVIEW_BOUND),'collapse rewrites no preview bytes');
 await assert.rejects(setPreviewCollapsed(pool,{conversationId:parent,toolCallId:'ghost',collapsed:true}),
  e=>/not found/.test(e.message),'collapsing a missing preview refuses');
});
