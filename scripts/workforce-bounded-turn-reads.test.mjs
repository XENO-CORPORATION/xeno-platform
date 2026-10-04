// NFR-05 against real PostgreSQL (server half): 10,000-turn
// conversations are never mounted or serialized all at once. The only
// turn-read path pages by cursor with a clamped limit; the full walk
// stays ordered and complete while every single page stays bounded.
//
// PROVEN: a 10,000-turn branch walks end to end with every page at most
// 200 rows and the union exactly 0..9999 in order; a limit of 100,000 is
// clamped to 200; totals count the requested branch only; bad limits and
// cursors refuse; per-page read latency p95 is under 100 ms on the local
// qualification database (measured below, excluding network).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {readTurnPage,countTurns,PAGE_CAP}=await import('../src/server/services/turnReads.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('NFR-05: 10,000 turns page bounded with p95 under 100ms',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`n5-${randomUUID().slice(0,8)}`;
 const alice=(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[`${marker}-a`,`${marker}-a@example.test`])).rows[0].id;
 const conv=(await pool.query('INSERT INTO chat_conversations(owner_user_id,title) VALUES($1,$2) RETURNING id',[alice,'Long'])).rows[0].id;
 await pool.query(
  `INSERT INTO conversation_turns (conversation_id, branch, turn_index, content_hash, status)
    SELECT $1, 'main', g, 'h' || g, 'complete' FROM generate_series(0, 9999) g`,[conv]);
 await pool.query(
  `INSERT INTO conversation_turns (conversation_id, branch, turn_index, content_hash, status)
    SELECT $1, 'shard', g, 's' || g, 'complete' FROM generate_series(0, 4) g`,[conv]);
 // Clamp: even an absurd limit returns one bounded page.
 const clamped=await readTurnPage(pool,{conversationId:conv,limit:100000});
 assert.equal(clamped.turns.length,PAGE_CAP,'a limit of 100,000 is clamped to one bounded page');
 assert.equal(clamped.nextCursor,PAGE_CAP-1,'the clamped page chains forward');
 assert.equal(clamped.total,10000,'the total counts the requested branch only');
 assert.equal(await countTurns(pool,{conversationId:conv,branch:'shard'}),5,'a sibling branch counts separately');
 // Guards refuse instead of guessing.
 await assert.rejects(readTurnPage(pool,{conversationId:conv,limit:0}),
  e=>/positive integer/.test(e.message),'a zero limit refuses');
 await assert.rejects(readTurnPage(pool,{conversationId:conv,cursor:'soon'}),
  e=>/cursor/.test(e.message),'a non-index cursor refuses');
 // Full walk: bounded pages, complete ordered union, measured latency.
 const seen=[];let cursor=null;const latencies=[];let pages=0;let prevLast=-1;
 for(;;){
  const start=performance.now();
  const page=await readTurnPage(pool,{conversationId:conv,cursor,limit:200});
  latencies.push(performance.now()-start);
  pages++;
  assert.ok(page.turns.length<=PAGE_CAP,`page ${pages} stays bounded`);
  if(page.turns.length>0)assert.ok(page.turns[0].turnIndex>prevLast,`page ${pages} advances forward`);
  for(const turn of page.turns)seen.push(turn.turnIndex);
  if(page.turns.length>0)prevLast=page.turns[page.turns.length-1].turnIndex;
  cursor=page.nextCursor;
  if(cursor===null)break;
  assert.ok(pages<1000,'the walk terminates');
 }
 assert.equal(seen.length,10000,'the walk collects every turn exactly once');
 assert.ok(seen.every((v,i)=>v===i),'the union is exactly 0..9999 in order');
 latencies.sort((a,b)=>a-b);
 const p95=latencies[Math.min(latencies.length-1,Math.floor(latencies.length*0.95))];
 console.log(`NFR-05 page latency over ${pages} pages: p50=${latencies[Math.floor(latencies.length/2)].toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${latencies[latencies.length-1].toFixed(2)}ms`);
 assert.ok(p95<100,`page-read p95 ${p95.toFixed(2)}ms is under the 100ms budget`);
});
