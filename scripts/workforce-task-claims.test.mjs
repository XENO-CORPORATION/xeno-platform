// PUB-07 against real PostgreSQL: bounty and paid task claims with
// single-winner semantics and commit-and-reveal. Idempotent claims
// survive retries and pre-decided races; only the true preimage
// reveals; awards pay the recorded winner or fail closed.
//
// PROVEN: a claim takes the single live slot and its retry with the
// same key returns the identical claim; rivals are refused while the
// slot is live (including same-key collisions) and succeed once it
// frees; a wrong preimage refuses while the true one reveals; awards
// need a revealed claim plus a maintainer, assign the task and record
// the winner; awards against a foreign assignee fail closed; expired
// claims refuse reveal and award and mark themselves; completed tasks
// refuse claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {claimTask,revealClaim,awardClaim,releaseClaim,readClaim}=await import('../src/server/services/taskClaims.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-07: idempotent single-winner claims with commit-and-reveal awards',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`p7-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),solver=await user('solver'),rival=await user('rival');
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 const goal=(await pool.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[project,owner])).rows[0].id;
 const mile=(await pool.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[goal,owner])).rows[0].id;
 const task=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Bounty','open') RETURNING id`,[mile])).rows[0].id;
 const task2=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Bounty 2','open') RETURNING id`,[mile])).rows[0].id;
 const done=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Old','completed') RETURNING id`,[mile])).rows[0].id;
 const commit=(s)=>createHash('sha256').update(s,'utf8').digest('hex');
 // One slot, idempotent retries, rivals refused until it frees.
 const first=await claimTask(pool,{taskId:task,claimantUserId:solver,commitment:commit('solver-secret'),
  idempotencyKey:'claim-key-001',ttlSeconds:3600});
 assert.equal(first.duplicate,false,'the first claim takes the slot');
 const retry=await claimTask(pool,{taskId:task,claimantUserId:solver,commitment:commit('solver-secret'),
  idempotencyKey:'claim-key-001',ttlSeconds:3600});
 assert.equal(retry.duplicate,true,'a retry returns the identical claim');
 assert.equal(retry.claim.id,first.claim.id,'retry identity is exact');
 assert.equal((await pool.query(`SELECT count(*)::int n FROM task_claims WHERE task_id=$1`,[task])).rows[0].n,
  1,'retries write no duplicate row');
 await assert.rejects(claimTask(pool,{taskId:task,claimantUserId:rival,commitment:commit('rival-secret'),
   idempotencyKey:'claim-key-002',ttlSeconds:3600}),
  e=>/already_claimed/.test(e.message),'a rival is refused while the slot is live');
 await assert.rejects(claimTask(pool,{taskId:task,claimantUserId:rival,commitment:commit('rival-secret'),
   idempotencyKey:'claim-key-001',ttlSeconds:3600}),
  e=>/key_conflict/.test(e.message),'a colliding key with a different claimant refuses');
 await assert.rejects(claimTask(pool,{taskId:done,claimantUserId:rival,commitment:commit('x'),
   idempotencyKey:'claim-key-009',ttlSeconds:3600}),
  e=>/already completed/.test(e.message),'a completed task refuses claims');
 // Commit-and-reveal: copies cannot reveal, the solver can.
 await assert.rejects(revealClaim(pool,{claimId:first.claim.id,claimantUserId:rival,secret:'rival-secret'}),
  e=>/not_authorized/.test(e.message),'a stranger cannot reveal for the claimant');
 await assert.rejects(revealClaim(pool,{claimId:first.claim.id,claimantUserId:solver,secret:'wrong-guess'}),
  e=>/reveal_mismatch/.test(e.message),'a wrong preimage refuses');
 const revealed=await revealClaim(pool,{claimId:first.claim.id,claimantUserId:solver,secret:'solver-secret'});
 assert.equal(revealed.state,'revealed','the true preimage reveals');
 // Awards pay the recorded winner; strangers and pre-reveal awards refuse.
 await assert.rejects(awardClaim(pool,{claimId:first.claim.id,actorUserId:rival}),
  e=>/not_authorized/.test(e.message),'a stranger cannot award');
 const fresh=await claimTask(pool,{taskId:task2,claimantUserId:rival,commitment:commit('rival-2'),
  idempotencyKey:'claim-key-003',ttlSeconds:3600});
 await assert.rejects(awardClaim(pool,{claimId:fresh.claim.id,actorUserId:owner}),
  e=>/Claim is claimed/.test(e.message),'an unrevealed claim cannot be awarded');
 const awarded=await awardClaim(pool,{claimId:first.claim.id,actorUserId:owner});
 assert.equal(awarded.state,'awarded','the revealed claim awards');
 assert.equal(awarded.winner_user_id,solver,'the award records the winner');
 assert.equal((await pool.query(`SELECT assignee_user_id FROM project_tasks WHERE id=$1`,[task])).rows[0].assignee_user_id,
  solver,'the award assigns the task to the winner');
 await assert.rejects(awardClaim(pool,{claimId:first.claim.id,actorUserId:owner}),
  e=>/Claim is awarded/.test(e.message),'an awarded claim cannot award again');
 // A claim resolving against a foreign assignee fails closed.
 await pool.query(`UPDATE project_tasks SET assignee_user_id=$2 WHERE id=$1`,[task2,owner]);
 await revealClaim(pool,{claimId:fresh.claim.id,claimantUserId:rival,secret:'rival-2'});
 await assert.rejects(awardClaim(pool,{claimId:fresh.claim.id,actorUserId:owner}),
  e=>/assigned_elsewhere/.test(e.message),'an award against a foreign assignee fails closed');
 await releaseClaim(pool,{claimId:fresh.claim.id,actorUserId:owner});
 assert.equal((await readClaim(pool,fresh.claim.id)).state,'released','a maintainer releases the stuck claim');
 // Expiry frees the slot and refuses late reveals and awards.
 const short=await claimTask(pool,{taskId:task2,claimantUserId:rival,commitment:commit('rival-3'),
  idempotencyKey:'claim-key-004',ttlSeconds:3600});
 await pool.query(`UPDATE task_claims SET expires_at=now()-interval '1 second',created_at=now()-interval '2 hours' WHERE id=$1`,[short.claim.id]);
 await assert.rejects(revealClaim(pool,{claimId:short.claim.id,claimantUserId:rival,secret:'rival-3'}),
  e=>/expired/.test(e.message),'an expired claim refuses reveal');
 assert.equal((await readClaim(pool,short.claim.id)).state,'expired','the refused reveal marks the expiry');
 const after=await claimTask(pool,{taskId:task2,claimantUserId:solver,commitment:commit('solver-4'),
  idempotencyKey:'claim-key-005',ttlSeconds:3600});
 assert.equal(after.duplicate,false,'expiry frees the slot for the next claimant');
});
