// RUN-08 against real PostgreSQL: concurrent code work uses explicit
// file/task ownership or isolated worktrees, plus reviewed integration.
// Shared agent assignment does not make concurrent writes to one directory
// safe -- locks stay exclusive no matter the task sharing.
//
// PROVEN: overlapping path locks refuse across holders even on the SAME task
// (exact and nested overlaps, with the holder named); disjoint paths lock
// independently; strangers cannot lock; only the holder releases; expired
// locks free their paths; task claims are exclusive and idempotent for the
// holder; worktrees isolate by branch/prefix (duplicate branches refused)
// and authorize their author's writes inside the prefix only; integration
// needs a holder other than the author, once; and the write gate allows
// exactly locked-or-worktree paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {acquireFileOwnership,releaseFileOwnership,acquireTaskOwnership,createIsolatedWorktree,integrateWorktree,checkWriteAllowed}=await import('../src/server/services/concurrentOwnership.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('RUN-08: exclusive ownership or isolated worktrees; reviewed integration only',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`o8-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),mallory=await user('mallory');
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'Concurrent'});
 await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'editor','user',$2)",[project.id,bob]);
 await acquireFileOwnership(pool,{actorUserId:alice,projectId:project.id,paths:['src/a.js','src/b'],taskRef:'t1'});
 assert.deepEqual(await checkWriteAllowed(pool,{actorUserId:alice,projectId:project.id,path:'src/a.js'}),
  {allowed:true,basis:'file-ownership'},'the lock holder may write the locked path');
 assert.deepEqual(await checkWriteAllowed(pool,{actorUserId:bob,projectId:project.id,path:'src/a.js'}),
  {allowed:false,reason:'no_ownership'},'anyone else is refused the locked path');
 await assert.rejects(acquireFileOwnership(pool,{actorUserId:bob,projectId:project.id,paths:['src/a.js'],taskRef:'t1'}),
  e=>e.message==='paths_locked'&&e.details.conflicts[0].lockedBy===alice,
  'shared task assignment does not share the lock: the overlap refuses and names the holder');
 await assert.rejects(acquireFileOwnership(pool,{actorUserId:bob,projectId:project.id,paths:['src/b/c.js']}),
  e=>e.message==='paths_locked','nested overlaps refuse too');
 await acquireFileOwnership(pool,{actorUserId:bob,projectId:project.id,paths:['src/c.js']});
 assert.deepEqual(await checkWriteAllowed(pool,{actorUserId:bob,projectId:project.id,path:'src/c.js'}),
  {allowed:true,basis:'file-ownership'},'disjoint paths lock independently');
 await assert.rejects(acquireFileOwnership(pool,{actorUserId:mallory,projectId:project.id,paths:['src/z.js']}),
  e=>e.message==='project_not_held','a stranger cannot lock project paths');
 await assert.rejects(releaseFileOwnership(pool,{actorUserId:bob,projectId:project.id,paths:['src/a.js']}),
  e=>e.message==='release_not_authorized','only the holder releases a lock');
 await releaseFileOwnership(pool,{actorUserId:alice,projectId:project.id,paths:['src/a.js']});
 await acquireFileOwnership(pool,{actorUserId:bob,projectId:project.id,paths:['src/a.js']});
 assert.deepEqual(await checkWriteAllowed(pool,{actorUserId:bob,projectId:project.id,path:'src/a.js'}),
  {allowed:true,basis:'file-ownership'},'a released path locks to the next holder');
 // Expiry frees paths; task claims stay exclusive.
 await pool.query("UPDATE concurrent_path_locks SET expires_at=now()-interval '1 second' WHERE project_id=$1 AND path='src/c.js'",[project.id]);
 await acquireFileOwnership(pool,{actorUserId:alice,projectId:project.id,paths:['src/c.js']});
 assert.deepEqual(await checkWriteAllowed(pool,{actorUserId:bob,projectId:project.id,path:'src/c.js'}),
  {allowed:false,reason:'no_ownership'},'an expired lock no longer authorizes its old holder');
 await acquireTaskOwnership(pool,{actorUserId:alice,projectId:project.id,taskRef:'task-9'});
 await assert.rejects(acquireTaskOwnership(pool,{actorUserId:bob,projectId:project.id,taskRef:'task-9'}),
  e=>e.message==='task_claimed','a claimed task refuses a second holder');
 await acquireTaskOwnership(pool,{actorUserId:alice,projectId:project.id,taskRef:'task-9'});
 // Worktrees isolate; integration is reviewed, once, by another holder.
 const tree=(await createIsolatedWorktree(pool,{actorUserId:bob,projectId:project.id,taskRef:'task-9',branch:'w1',rootPrefix:'wt/w1'})).worktreeId;
 await assert.rejects(createIsolatedWorktree(pool,{actorUserId:alice,projectId:project.id,taskRef:'x',branch:'w1',rootPrefix:'wt/other'}),
  e=>e.message==='branch_in_use','two worktrees cannot share a branch');
 assert.deepEqual(await checkWriteAllowed(pool,{actorUserId:bob,projectId:project.id,path:'wt/w1/src/x.js'}),
  {allowed:true,basis:'isolated-worktree'},'the author writes freely inside their worktree prefix');
 assert.deepEqual(await checkWriteAllowed(pool,{actorUserId:alice,projectId:project.id,path:'wt/w1/src/x.js'}),
  {allowed:false,reason:'no_ownership'},'the worktree prefix authorizes its author only');
 await assert.rejects(integrateWorktree(pool,{actorUserId:bob,worktreeId:tree}),
  e=>e.message==='self_integrate_refused','the author cannot integrate their own worktree');
 await assert.rejects(integrateWorktree(pool,{actorUserId:mallory,worktreeId:tree}),
  e=>e.message==='integrate_not_authorized','a stranger cannot integrate the worktree');
 assert.deepEqual(await integrateWorktree(pool,{actorUserId:alice,worktreeId:tree}),
  {worktreeId:tree,status:'integrated',integratedByUserId:alice},'another holder integrates under review');
 await assert.rejects(integrateWorktree(pool,{actorUserId:alice,worktreeId:tree}),
  e=>e.message==='worktree_not_active','an integrated worktree cannot integrate twice');
});
