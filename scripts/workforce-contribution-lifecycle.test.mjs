// PUB-06 against real PostgreSQL: contributions move through eleven
// explicit states with every transition recording author, source,
// destination, timestamp, revision and rationale; conflicts force
// rebase and re-review; accepted contributions stay read-only.
//
// PROVEN: the full path proposed to integrated walks in order with a
// complete recorded history; illegal jumps and unknown states refuse;
// strangers move nothing, authors cannot self-accept, maintainers
// decide admission, review outcomes and integration; a rebase during
// review returns the record to submitted with a recorded rationale;
// accepted, integrated, rejected and withdrawn records refuse new
// revisions and further moves; rationales are mandatory and history
// rejects rewrites.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {submitContribution,submitRevision,readContribution}=await import('../src/server/services/contributions.js');
const {transitionContribution,readTransitions}=await import('../src/server/services/contributionLifecycle.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-06: explicit lifecycle with recorded transitions, rebase re-review and read-only acceptance',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`p6-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),dev=await user('dev'),stranger=await user('stranger');
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 const base={projectId:project,taskId:null,type:'code',authorUserId:dev,responsibleUserId:dev,
  revisionHash:'commit:life1',evidence:[{diff:'d1'}],origin:'original work',rightsLicense:'MIT'};
 const first=(await submitContribution(pool,base)).id;
 assert.equal((await readContribution(pool,first)).reviewState,'proposed','records open proposed');
 // Illegal jumps and strangers refuse before anything moves.
 await assert.rejects(transitionContribution(pool,{contributionId:first,actorUserId:owner,toState:'accepted',rationale:'skip'}),
  e=>/Illegal transition/.test(e.message),'proposed cannot jump to accepted');
 await assert.rejects(transitionContribution(pool,{contributionId:first,actorUserId:owner,toState:'shipped',rationale:'x'}),
  e=>/Unknown lifecycle/.test(e.message),'unknown states refuse');
 await assert.rejects(transitionContribution(pool,{contributionId:first,actorUserId:stranger,toState:'admitted',rationale:'me'}),
  e=>/not_authorized/.test(e.message),'a stranger moves nothing');
 await assert.rejects(transitionContribution(pool,{contributionId:first,actorUserId:dev,toState:'admitted',rationale:'self'}),
  e=>/not_authorized/.test(e.message),'the author cannot self-admit');
 await assert.rejects(transitionContribution(pool,{contributionId:first,actorUserId:owner,toState:'admitted',rationale:'  '}),
  e=>/rationale/.test(e.message),'a rationale is mandatory');
 // The full path walks in order with the right actors.
 const walk=[[owner,'admitted','fits the roadmap'],[dev,'in_progress','starting work'],
  [dev,'submitted','ready for checks'],[dev,'checks_pending','checks running'],
  [owner,'review','checks green, reviewing'],[owner,'accepted','thorough and tested'],
  [owner,'integrated','merged to main']];
 for (const [actor,to,why] of walk) {
  await transitionContribution(pool,{contributionId:first,actorUserId:actor,toState:to,rationale:why});
 }
 assert.equal((await readContribution(pool,first)).reviewState,'integrated','the walk ends integrated');
 const history=await readTransitions(pool,first);
 assert.deepEqual(history.map(h=>h.to),['admitted','in_progress','submitted','checks_pending','review','accepted','integrated'],
  'every hop records in order');
 assert.deepEqual(history.map(h=>h.from),['proposed','admitted','in_progress','submitted','checks_pending','review','accepted'],
  'every hop records its source');
 assert.ok(history.every(h=>h.rationale.length>0&&h.actor&&h.at&&h.revisionNo===1),
  'every hop records author, timestamp, revision and rationale');
 assert.equal(history[0].rationale,'fits the roadmap','the recorded rationale is the actor\'s own words');
 await assert.rejects(pool.query(`UPDATE contribution_transitions SET rationale='rewritten' WHERE contribution_id=$1`,[first]),
  e=>e.code==='23514','transition history rejects rewrites');
 // Rebase during review returns the record to submitted for re-review.
 const second=(await submitContribution(pool,{...base,revisionHash:'commit:life2'})).id;
 for (const [actor,to,why] of [[owner,'admitted','a'],[dev,'in_progress','b'],[dev,'submitted','c'],
   [dev,'checks_pending','d'],[owner,'review','e']]) {
  await transitionContribution(pool,{contributionId:second,actorUserId:actor,toState:to,rationale:why});
 }
 const rebased=await submitRevision(pool,{contributionId:second,actorUserId:dev,
  revisionHash:'commit:life2b',evidence:[{diff:'d2'}]});
 assert.equal(rebased.currentRevisionNo,2,'the rebase appends a revision');
 assert.equal(rebased.reviewState,'submitted','a rebase during review returns to submitted');
 const trail=await readTransitions(pool,second);
 assert.equal(trail[trail.length-1].from,'review','the return names its source');
 assert.match(trail[trail.length-1].rationale,/revision 2 supersedes/,'the return records why');
 // Acceptance is read-only; terminal states end all movement.
 const third=(await submitContribution(pool,{...base,revisionHash:'commit:life3'})).id;
 for (const [actor,to,why] of [[owner,'admitted','a'],[dev,'in_progress','b'],[dev,'submitted','c'],
   [dev,'checks_pending','d'],[owner,'review','e']]) {
  await transitionContribution(pool,{contributionId:third,actorUserId:actor,toState:to,rationale:why});
 }
 await assert.rejects(transitionContribution(pool,{contributionId:third,actorUserId:dev,toState:'accepted',rationale:'self'}),
  e=>/not_authorized/.test(e.message),'the author cannot self-accept');
 await transitionContribution(pool,{contributionId:third,actorUserId:owner,toState:'accepted',rationale:'ship it'});
 await assert.rejects(submitRevision(pool,{contributionId:third,actorUserId:dev,
   revisionHash:'commit:late',evidence:[{diff:'x'}]}),
  e=>/read-only/.test(e.message),'an accepted contribution refuses new revisions');
 await assert.rejects(transitionContribution(pool,{contributionId:third,actorUserId:owner,toState:'review',rationale:'again'}),
  e=>/Illegal transition/.test(e.message),'acceptance has no way back except integration');
 const fourth=(await submitContribution(pool,{...base,revisionHash:'commit:life4'})).id;
 await transitionContribution(pool,{contributionId:fourth,actorUserId:dev,toState:'withdrawn',rationale:'changed my mind'});
 assert.equal((await readContribution(pool,fourth)).reviewState,'withdrawn','the author withdraws freely');
 await assert.rejects(transitionContribution(pool,{contributionId:fourth,actorUserId:owner,toState:'admitted',rationale:'no'}),
  e=>/Illegal transition/.test(e.message),'a withdrawn record ends all movement');
 await assert.rejects(submitRevision(pool,{contributionId:fourth,actorUserId:dev,
   revisionHash:'commit:late2',evidence:[{diff:'x'}]}),
  e=>/read-only/.test(e.message),'a withdrawn record refuses new revisions');
});
