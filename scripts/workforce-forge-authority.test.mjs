// FORGE-04 against real PostgreSQL: declared single-owner authority
// across the GitHub boundary. GitHub owns commits, protections, PR
// state and merge outcomes; XENO owns offers, admission, runs and
// funding; mirrored fields refuse cross-side writes instead of
// last-write-wins.
//
// PROVEN: the ownership map answers every declared field and refuses
// unknown ones; the github provider reads but never submits or
// integrates; ingest takes github-owned fields only at strictly
// advancing versions while XENO-owned, unknown and outcome keys
// refuse; XENO-side writes mirror the rule from the other side under
// maintainer authority; merge outcomes record only for github-backed
// change requests at fresh versions; exports carry XENO-owned fields
// and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {ownerOf,linkMirror,ingestGithubEvent,updateXenoMirror,recordGithubMerge,
 readMirror,buildGithubExportPayload}=await import('../src/server/services/forgeAuthority.js');
const {describeCapabilities,bindRepository,submitChangeRequest}=await import('../src/server/services/forgeAdapter.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('FORGE-04: single-owner authority with no dual-master merge',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`f4-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query(
  `INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id`,
  [x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),stranger=await user('stranger');
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 const goal=(await pool.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[project,owner])).rows[0].id;
 const mile=(await pool.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[goal,owner])).rows[0].id;
 const task=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Survey','open') RETURNING id`,[mile])).rows[0].id;
 assert.equal(ownerOf('merge_outcome'),'github','merge outcomes belong to GitHub');
 assert.equal(ownerOf('commit_sha'),'github','commits belong to GitHub');
 assert.equal(ownerOf('xeno_status'),'xeno','XENO status belongs to XENO');
 assert.throws(()=>ownerOf('bogus'),e=>/unknown_field/.test(e.message),'unknown fields have no owner');
 const caps=describeCapabilities('github');
 for (const op of ['submitCR','updateCR','integrate','createBranch']) {
  assert.ok(caps.unavailable.includes(op),`github-backed code never ${op} from XENO`);
 }
 const gh=await bindRepository(pool,{projectId:project,actorUserId:owner,provider:'github',
  remoteId:`gh:1-${marker}`});
 const local=await bindRepository(pool,{projectId:project,actorUserId:owner,provider:'local',
  remoteId:`local:1-${marker}`});
 await assert.rejects(submitChangeRequest(pool,{bindingId:gh.id,actorUserId:owner,sourceBranch:'f',
  targetRef:'main',title:'x',body:''}),e=>/operation_unavailable.*submitCR/.test(e.message),
  'XENO submits no change requests to GitHub-backed code');
 await assert.rejects(linkMirror(pool,{bindingId:gh.id,actorUserId:stranger,subjectType:'task',
  subjectId:task,githubRef:'issues/7'}),e=>/mirror_not_authorized/.test(e.message),
  'a stranger links nothing');
 const mirror=await linkMirror(pool,{bindingId:gh.id,actorUserId:owner,subjectType:'task',
  subjectId:task,githubRef:'issues/7'});
 await assert.rejects(linkMirror(pool,{bindingId:gh.id,actorUserId:owner,subjectType:'task',
  subjectId:task,githubRef:'issues/7'}),e=>/mirror_exists/.test(e.message),'a duplicate mirror refuses');
 const v1=await ingestGithubEvent(pool,{bindingId:gh.id,githubRef:'issues/7',version:1,
  fields:{github_state:'open',commit_sha:'abc'}});
 assert.equal(v1.githubVersion,1,'the ingest lands at version one');
 await assert.rejects(ingestGithubEvent(pool,{bindingId:gh.id,githubRef:'issues/7',version:2,
  fields:{xeno_status:'done'}}),e=>/ingest_rejects_xeno_status/.test(e.message),
  'ingest never writes XENO-owned fields');
 await assert.rejects(ingestGithubEvent(pool,{bindingId:gh.id,githubRef:'issues/7',version:2,
  fields:{bogus:'x'}}),e=>/ingest_rejects_bogus/.test(e.message),'ingest never writes unknown fields');
 await assert.rejects(ingestGithubEvent(pool,{bindingId:gh.id,githubRef:'issues/7',version:2,
  fields:{merge_outcome:'merged'}}),e=>/merge_outcome_arrives_via_merge_record/.test(e.message),
  'outcomes arrive only as merge records');
 await assert.rejects(ingestGithubEvent(pool,{bindingId:gh.id,githubRef:'issues/7',version:1,
  fields:{github_state:'closed'}}),e=>/stale_event/.test(e.message),'a stale event never rewinds');
 await assert.rejects(updateXenoMirror(pool,{mirrorId:mirror.id,actorUserId:stranger,
  fields:{xeno_status:'done'}}),e=>/mirror_not_authorized/.test(e.message),'a stranger writes nothing');
 await assert.rejects(updateXenoMirror(pool,{mirrorId:mirror.id,actorUserId:owner,
  fields:{github_state:'closed'}}),e=>/xeno_rejects_github_state/.test(e.message),
  'XENO never writes GitHub-owned fields');
 const x1=await updateXenoMirror(pool,{mirrorId:mirror.id,actorUserId:owner,
  fields:{xeno_status:'in_progress',xeno_priority:'high'}});
 assert.equal(x1.xenoVersion,1,'the XENO side versions independently');
 const both=await readMirror(pool,mirror.id);
 assert.equal(both.githubState,'open','the GitHub cell survives XENO writes');
 assert.equal(both.xenoStatus,'in_progress','the XENO cell survives GitHub writes');
 assert.equal(both.githubVersion,1,'versions advance per side, never merged');
 const crMirror=await linkMirror(pool,{bindingId:gh.id,actorUserId:owner,subjectType:'change_request',
  subjectId:randomUUID(),githubRef:'pulls/3'});
 const merged=await recordGithubMerge(pool,{mirrorId:crMirror.id,mergeSha:'def456',version:1});
 assert.equal(merged.mergeSha,'def456','the declared outcome records');
 assert.equal((await readMirror(pool,crMirror.id)).prState,'merged','the PR state follows the outcome');
 await assert.rejects(recordGithubMerge(pool,{mirrorId:crMirror.id,mergeSha:'zzz',version:1}),
  e=>/stale_event/.test(e.message),'a stale outcome refuses');
 await assert.rejects(recordGithubMerge(pool,{mirrorId:mirror.id,mergeSha:'zzz',version:2}),
  e=>/merge_needs_change_request/.test(e.message),'a task takes no merge outcome');
 const localMirror=await linkMirror(pool,{bindingId:local.id,actorUserId:owner,subjectType:'change_request',
  subjectId:randomUUID(),githubRef:'pulls/9'});
 await assert.rejects(recordGithubMerge(pool,{mirrorId:localMirror.id,mergeSha:'zzz',version:1}),
  e=>/not_github_backed/.test(e.message),'local code takes no GitHub outcome');
 assert.deepEqual(Object.keys(buildGithubExportPayload(both)).sort(),
  ['githubRef','xeno_priority','xeno_status'],'exports carry XENO-owned fields only');
});
