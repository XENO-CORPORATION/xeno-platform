// FORGE-01 against real PostgreSQL: a host-neutral binding and
// contribution adapter. Branches, change requests, reviews, checks,
// reconcile and policy-gated integration run through per-provider
// capability gates, and unavailable operations refuse explicitly.
//
// PROVEN: the reference provider binds, branches, reads revisions,
// submits and updates change requests, records checks and reviews,
// reconciles counts and integrates under policy — refusing merge
// without approval, without checks, and with a failing check, while
// an explicit bare policy merges bare and the target head advances;
// the mirror provider declares its missing operations, refuses
// branch, fork and submit as unavailable, yet discovers and reads;
// unknown providers, duplicate bindings, stranger binds and edits to
// merged requests all refuse.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {describeCapabilities,discoverRepositories,bindRepository,readRevision,createBranch,
 forkRepository,submitChangeRequest,updateChangeRequest,listChecks,listReviews,reconcileStatus,
 integrateChangeRequest,recordForgeCheck,recordForgeReview}=await import('../src/server/services/forgeAdapter.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('FORGE-01: neutral adapter with explicit provider capabilities',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`f1-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query(
  `INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id`,
  [x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),stranger=await user('stranger');
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 assert.deepEqual(describeCapabilities('local').unavailable,[],'the reference provider permits everything');
 const mirrorCaps=describeCapabilities('mirror');
 for (const op of ['createBranch','fork','submitCR','updateCR','integrate']) {
  assert.ok(mirrorCaps.unavailable.includes(op),`the mirror declares ${op} unavailable`);
 }
 assert.throws(()=>describeCapabilities('nope'),e=>/unknown_provider/.test(e.message),'unknown providers refuse');
 const binding=await bindRepository(pool,{projectId:project,actorUserId:owner,provider:'local',
  remoteId:`atlas-${marker}`,installationRef:'inst-1',refs:{default:'main'},accessPolicy:{visibility:'private'}});
 assert.equal(binding.remote_id,`atlas-${marker}`,'the binding names its stable remote');
 await assert.rejects(bindRepository(pool,{projectId:project,actorUserId:stranger,provider:'local',remoteId:`x-${marker}`}),
  e=>/bind_not_authorized/.test(e.message),'a stranger cannot bind');
 await assert.rejects(bindRepository(pool,{projectId:project,actorUserId:owner,provider:'nope',remoteId:`y-${marker}`}),
  e=>/unknown_provider/.test(e.message),'binding an unknown provider refuses');
 await assert.rejects(bindRepository(pool,{projectId:project,actorUserId:owner,provider:'local',remoteId:`atlas-${marker}`}),
  e=>/repository_already_bound/.test(e.message),'a duplicate binding refuses');
 assert.ok((await discoverRepositories(pool,'local')).includes(`atlas-${marker}`),'discovery lists the remote');
 await createBranch(pool,{bindingId:binding.id,actorUserId:owner,name:'main',fromRev:'r0'});
 await createBranch(pool,{bindingId:binding.id,actorUserId:owner,name:'feature',fromRev:'r1'});
 await assert.rejects(createBranch(pool,{bindingId:binding.id,actorUserId:owner,name:'feature',fromRev:'r1'}),
  e=>/branch_exists/.test(e.message),'a duplicate branch refuses');
 assert.deepEqual((await readRevision(pool,{bindingId:binding.id,rev:'r1'})).branches,['feature'],
  'the revision reads back on its branch');
 await assert.rejects(readRevision(pool,{bindingId:binding.id,rev:'r-unknown'}),
  e=>/revision_not_found/.test(e.message),'an unknown revision refuses');
 const cr=await submitChangeRequest(pool,{bindingId:binding.id,actorUserId:owner,sourceBranch:'feature',
  targetRef:'main',title:'Add maps',body:'first cut'});
 assert.equal(cr.status,'open','the change request opens');
 assert.equal(cr.head_rev,'r1','the request pins the source head');
 await updateChangeRequest(pool,{crId:cr.id,actorUserId:owner,title:'Add maps v2'});
 await recordForgeCheck(pool,{crId:cr.id,actorUserId:owner,name:'suite',status:'pass'});
 await recordForgeReview(pool,{crId:cr.id,reviewerUserId:owner,decision:'approve',body:'good'});
 assert.deepEqual((await listChecks(pool,{crId:cr.id})).map(c=>c.status),['pass'],'checks list back');
 assert.deepEqual((await listReviews(pool,{crId:cr.id})).map(r=>r.decision),['approve'],'reviews list back');
 const rec=await reconcileStatus(pool,{crId:cr.id});
 assert.equal(rec.checks.pass,1,'reconcile counts the passing check');
 assert.equal(rec.reviews.approve,1,'reconcile counts the approval');
 const bare=await submitChangeRequest(pool,{bindingId:binding.id,actorUserId:owner,sourceBranch:'feature',
  targetRef:'main',title:'Bare',body:''});
 await assert.rejects(integrateChangeRequest(pool,{crId:bare.id,actorUserId:owner}),
  e=>/integration_approval_required/.test(e.message),'merge without approval refuses');
 await recordForgeReview(pool,{crId:bare.id,reviewerUserId:owner,decision:'approve'});
 await assert.rejects(integrateChangeRequest(pool,{crId:bare.id,actorUserId:owner}),
  e=>/integration_checks_required/.test(e.message),'merge without checks refuses');
 const red=await submitChangeRequest(pool,{bindingId:binding.id,actorUserId:owner,sourceBranch:'feature',
  targetRef:'main',title:'Red',body:''});
 await recordForgeReview(pool,{crId:red.id,reviewerUserId:owner,decision:'approve'});
 await recordForgeCheck(pool,{crId:red.id,actorUserId:owner,name:'suite',status:'fail'});
 await assert.rejects(integrateChangeRequest(pool,{crId:red.id,actorUserId:owner}),
  e=>/integration_checks_required/.test(e.message),'merge with a failing check refuses');
 const merged=await integrateChangeRequest(pool,{crId:cr.id,actorUserId:owner});
 assert.equal(merged.status,'merged','approval plus green checks merge');
 assert.equal((await readRevision(pool,{bindingId:binding.id,rev:'r1'})).branches.sort().join(','),
  'feature,main','the target head advances to the merged revision');
 const waived=await submitChangeRequest(pool,{bindingId:binding.id,actorUserId:owner,sourceBranch:'feature',
  targetRef:'main',title:'Waived',body:''});
 const waivedMerge=await integrateChangeRequest(pool,{crId:waived.id,actorUserId:owner,
  policy:{requireApproval:false,requireGreenChecks:false}});
 assert.equal(waivedMerge.status,'merged','an explicit bare policy merges bare');
 await assert.rejects(updateChangeRequest(pool,{crId:cr.id,actorUserId:owner,title:'late'}),
  e=>/change_request_closed/.test(e.message),'a merged request refuses edits');
 const fork=await forkRepository(pool,{bindingId:binding.id,actorUserId:owner,name:'devcopy'});
 assert.equal(String(fork.forked_from_binding_id),String(binding.id),'the fork records its upstream');
 assert.ok(fork.remote_id.startsWith(`fork:atlas-${marker}:devcopy:`),'the fork mints a distinct remote');
 // The mirror reads and declares; it never writes.
 const mb=await bindRepository(pool,{projectId:project,actorUserId:owner,provider:'mirror',
  remoteId:`mirror-${marker}`});
 assert.ok((await discoverRepositories(pool,'mirror')).includes(`mirror-${marker}`),'the mirror discovers');
 await assert.rejects(readRevision(pool,{bindingId:mb.id,rev:'r-unknown'}),
  e=>/revision_not_found/.test(e.message),'the mirror read path executes');
 await assert.rejects(createBranch(pool,{bindingId:mb.id,actorUserId:owner,name:'x',fromRev:'r0'}),
  e=>/operation_unavailable.*createBranch/.test(e.message),'the mirror refuses branches explicitly');
 await assert.rejects(forkRepository(pool,{bindingId:mb.id,actorUserId:owner,name:'x'}),
  e=>/operation_unavailable.*fork/.test(e.message),'the mirror refuses forks explicitly');
 await assert.rejects(submitChangeRequest(pool,{bindingId:mb.id,actorUserId:owner,sourceBranch:'x',
  targetRef:'main',title:'x',body:''}),e=>/operation_unavailable.*submitCR/.test(e.message),
  'the mirror refuses submits explicitly');
});
