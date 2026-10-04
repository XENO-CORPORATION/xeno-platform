// PUB-05 against real PostgreSQL: every contribution carries a type,
// author, responsible human/account, optional agent/team provenance,
// target task/project, immutable submitted revisions, evidence and
// review state — across all eight contribution types, never forced
// into a Git commit.
//
// PROVEN: all eight types submit with full records; revisions accept
// dataset URNs, checkpoint ids and credit references alongside commit
// hashes; the responsible party must be a usable human (agents and
// suspended accounts refuse) while authors may be agents with
// provenance; foreign tasks, unknown types and evidence-less code
// refuse while evidence-less credit grants pass; new submissions
// append numbered revisions and move the pointer while prior rows
// stay byte-identical and reject direct rewrites; records open pending.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {submitContribution,submitRevision,readContribution}=await import('../src/server/services/contributions.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-05: typed contribution records with provenance, immutable revisions and evidence',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`p5-${randomUUID().slice(0,8)}`;
 const user=async (s,patch={})=>{const x=`${marker}-${s}`;return(await pool.query(
  `INSERT INTO users(username,email,display_name,password_hash,is_active,status) VALUES($1,$2,$1,'t',$3,$4) RETURNING id`,
  [x,x+'@example.test',patch.isActive??true,patch.status??null])).rows[0].id;};
 const owner=await user('owner'),dev=await user('dev'),bot=await user('bot');
 const frozen=await user('frozen',{isActive:false});
 await pool.query(`INSERT INTO agent_identities(user_id,owner_user_id,agent_role) VALUES($1,$2,'research')`,[bot,dev]);
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 const other=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Other'])).rows[0].id;
 const goal=(await pool.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[project,owner])).rows[0].id;
 const mile=(await pool.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[goal,owner])).rows[0].id;
 const task=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Survey','open') RETURNING id`,[mile])).rows[0].id;
 const ogoal=(await pool.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[other,owner])).rows[0].id;
 const omile=(await pool.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[ogoal,owner])).rows[0].id;
 const foreign=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Elsewhere','open') RETURNING id`,[omile])).rows[0].id;
 const team=(await pool.query(`INSERT INTO workforce_resources(kind,owner_user_id,name) VALUES('team',$1,'crew') RETURNING id`,[owner])).rows[0].id;
 // All eight types submit; revisions are opaque strings, not git commits.
 const kinds=[
  ['code','commit:9f3a2c1e7d',{diff:'diff-ref-1'}],
  ['documentation','docs:guide:v7',{render:'render-9'}],
  ['design-assets','asset:logo:sha256:abc123',{file:'logo.svg'}],
  ['dataset','dataset:census:v3:sha256:def456',{rows:1000}],
  ['evaluation','eval:suite-4:run-88',{score:0.97}],
  ['agent-work','checkpoint:mind-7:step-4412',{trace:'trace-3'}],
  ['credits','lot:grant-9a2b:5000',null],
  ['resource-offer','offer:gpu-pool:8xh100',null],
 ];
 const made=[];
 for (const [type,hash,proof] of kinds) {
  const record=await submitContribution(pool,{projectId:project,taskId:task,type,authorUserId:dev,
   responsibleUserId:dev,revisionHash:hash,evidence:proof?[proof]:[],
   origin:'original work by the author',rightsLicense:'MIT'});
  assert.equal(record.type,type,`a ${type} contribution submits`);
  assert.equal(record.revisions[0].revisionHash,hash,'the opaque revision stores verbatim');
  assert.equal(record.reviewState,'proposed','records open proposed');
  made.push(record);
 }
 // Agent authorship with provenance; project-level targeting without a task.
 const agentMade=await submitContribution(pool,{projectId:project,taskId:null,type:'agent-work',
  authorUserId:bot,responsibleUserId:dev,provenance:{agent:'research-bot',team:team},
  revisionHash:'checkpoint:mind-7:step-4413',evidence:[{trace:'trace-4'}],
  origin:'original work by the author',rightsLicense:'MIT'});
 assert.equal(agentMade.authorUserId,bot,'an agent may author with a human responsible');
 assert.deepEqual(agentMade.provenance,{agent:'research-bot',team},'provenance records the agent and team');
 assert.equal(agentMade.taskId,null,'a contribution may target the project itself');
 // Guards: human responsibility, live authors, honest targets and evidence.
 await assert.rejects(submitContribution(pool,{projectId:project,type:'code',authorUserId:dev,
   responsibleUserId:bot,revisionHash:'x',evidence:[{a:1}],origin:'o',rightsLicense:'MIT'}),
  e=>/responsible_must_be_human/.test(e.message),'an agent cannot be the responsible party');
 await assert.rejects(submitContribution(pool,{projectId:project,type:'code',authorUserId:dev,
   responsibleUserId:frozen,revisionHash:'x',evidence:[{a:1}],origin:'o',rightsLicense:'MIT'}),
  e=>/responsible_must_be_human/.test(e.message),'a suspended account cannot be responsible');
 await assert.rejects(submitContribution(pool,{projectId:project,type:'code',authorUserId:frozen,
   responsibleUserId:dev,revisionHash:'x',evidence:[{a:1}],origin:'o',rightsLicense:'MIT'}),
  e=>/author_not_usable/.test(e.message),'a suspended account cannot author');
 await assert.rejects(submitContribution(pool,{projectId:project,taskId:foreign,type:'code',authorUserId:dev,
   responsibleUserId:dev,revisionHash:'x',evidence:[{a:1}],origin:'o',rightsLicense:'MIT'}),
  e=>/not on this project/.test(e.message),'a foreign task refuses');
 await assert.rejects(submitContribution(pool,{projectId:project,type:'carrier-pigeon',authorUserId:dev,
   responsibleUserId:dev,revisionHash:'x',evidence:[]}),
  e=>/Unknown contribution type/.test(e.message),'an unknown type refuses');
 await assert.rejects(submitContribution(pool,{projectId:project,type:'code',authorUserId:dev,
   responsibleUserId:dev,revisionHash:'x',evidence:[],origin:'o',rightsLicense:'MIT'}),
  e=>/require evidence/.test(e.message),'code without evidence refuses');
 // Revisions append; history never rewrites.
 const first=made[0];
 const v2=await submitRevision(pool,{contributionId:first.id,actorUserId:dev,
  revisionHash:'commit:aa91ff003c',evidence:[{diff:'diff-ref-2'}]});
 assert.equal(v2.currentRevisionNo,2,'the pointer advances to the new revision');
 assert.deepEqual(v2.revisions.map(r=>r.revisionNo),[1,2],'both revisions read back in order');
 assert.equal(v2.revisions[0].revisionHash,'commit:9f3a2c1e7d','the first revision is byte-identical');
 await assert.rejects(submitRevision(pool,{contributionId:first.id,actorUserId:owner,
   revisionHash:'commit:intruder',evidence:[{diff:'x'}]}),
  e=>/not_authorized/.test(e.message),'a stranger cannot append revisions');
 await assert.rejects(pool.query(`UPDATE contribution_revisions SET revision_hash='rewritten' WHERE contribution_id=$1`,[first.id]),
  e=>e.code==='23514','a direct rewrite of history is refused by the schema');
 const reread=await readContribution(pool,first.id);
 assert.equal(reread.revisions[0].revisionHash,'commit:9f3a2c1e7d','history survives the rewrite attempt');
});
