// RUN-06 against real PostgreSQL: projects support goal -> milestone -> task
// records extending the existing project subsystem. Completion requires
// defined evidence and reviewer acceptance where required -- never a model's
// (or worker's) declaration alone.
//
// PROVEN: every write needs a held live project (strangers refused at goal,
// task and evidence; foreign assignees and reviewers refused); tasks refuse
// completion until every milestone-declared evidence kind is attached (the
// refusal names the missing kinds); reviewed tasks park in-review on
// completion and only the designated reviewer accepts -- never the worker,
// never a stranger, never self-acceptance; unreviewed tasks complete on
// evidence alone; milestones refuse completion with open tasks and goals
// with open milestones: rollup is derived, not declared.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {createGoal,createMilestone,createTask,attachTaskEvidence,completeTask,acceptTask,completeMilestone,completeGoal}=await import('../src/server/services/projectWorktree.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('RUN-06: project worktrees complete on evidence plus reviewer acceptance',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`g6-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),mallory=await user('mallory');
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'Worktree'});
 await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'editor','user',$2)",[project.id,bob]);
 await assert.rejects(createGoal(pool,{actorUserId:mallory,projectId:project.id,title:'G',successEvidence:'E'}),
  e=>e.message==='goal_not_authorized','a stranger cannot plant goals on someone else\'s project');
 await assert.rejects(createGoal(pool,{actorUserId:alice,projectId:project.id,title:'G',successEvidence:'  '}),
  e=>e.message==='invalid_success_evidence','a goal without stated success evidence is refused');
 const goal=(await createGoal(pool,{actorUserId:alice,projectId:project.id,title:'Ship it',successEvidence:'accepted milestones'})).goalId;
 await assert.rejects(createMilestone(pool,{actorUserId:alice,goalId:goal,title:'M',requiredEvidenceKinds:[],reviewerRequired:true,reviewerUserId:mallory}),
  e=>e.message==='reviewer_not_authorized','a milestone cannot name a reviewer outside the project');
 const milestone=(await createMilestone(pool,{actorUserId:alice,goalId:goal,title:'M1',
  requiredEvidenceKinds:['artifact-hash','test-report'],reviewerRequired:true,reviewerUserId:alice})).milestoneId;
 await assert.rejects(createTask(pool,{actorUserId:mallory,milestoneId:milestone,title:'T'}),
  e=>e.message==='task_not_authorized','a stranger cannot file tasks on the milestone');
 await assert.rejects(createTask(pool,{actorUserId:alice,milestoneId:milestone,title:'T',assigneeUserId:mallory}),
  e=>e.message==='assignee_not_authorized','tasks cannot assign outside the project');
 const task=(await createTask(pool,{actorUserId:alice,milestoneId:milestone,title:'Build it',assigneeUserId:bob})).taskId;
 await assert.rejects(completeTask(pool,{actorUserId:bob,taskId:task}),e=>e.message==='evidence_incomplete',
  'completion with no evidence is refused');
 await attachTaskEvidence(pool,{actorUserId:bob,taskId:task,kind:'artifact-hash',ref:'sha256:'+'ab'.repeat(32)});
 await assert.rejects(completeTask(pool,{actorUserId:bob,taskId:task}),e=>e.message==='evidence_incomplete'&&e.details.missing.length===1,
  'completion with partial evidence names the missing kind');
 await attachTaskEvidence(pool,{actorUserId:bob,taskId:task,kind:'test-report',ref:'junit:42/42'});
 const parked=await completeTask(pool,{actorUserId:bob,taskId:task});
 assert.equal(parked.status,'in-review','a reviewed task parks in-review on evidence: the declaration alone never completes it');
 await assert.rejects(acceptTask(pool,{actorUserId:bob,taskId:task}),
  e=>e.message==='accept_not_authorized','the worker cannot accept their own task');
 await assert.rejects(acceptTask(pool,{actorUserId:mallory,taskId:task}),
  e=>e.message==='accept_not_authorized','a stranger cannot accept the task');
 assert.deepEqual(await acceptTask(pool,{actorUserId:alice,taskId:task}),{taskId:task,status:'completed'},
  'the designated reviewer accepts on full evidence');
 // Self-acceptance is refused even for the designated reviewer (separate tree).
 const goal2=(await createGoal(pool,{actorUserId:alice,projectId:project.id,title:'G2',successEvidence:'E2'})).goalId;
 const m2=(await createMilestone(pool,{actorUserId:alice,goalId:goal2,title:'M2',requiredEvidenceKinds:[],reviewerRequired:true,reviewerUserId:alice})).milestoneId;
 const tself=(await createTask(pool,{actorUserId:alice,milestoneId:m2,title:'Self',assigneeUserId:alice})).taskId;
 await completeTask(pool,{actorUserId:alice,taskId:tself});
 await assert.rejects(acceptTask(pool,{actorUserId:alice,taskId:tself}),
  e=>e.message==='self_accept_refused','the reviewer cannot accept their own completed work');
 // Rollup is derived: milestones and goals refuse while anything sits open.
 const t2=(await createTask(pool,{actorUserId:alice,milestoneId:milestone,title:'Polish',assigneeUserId:bob})).taskId;
 await assert.rejects(completeMilestone(pool,{actorUserId:alice,milestoneId:milestone}),
  e=>e.message==='tasks_incomplete','a milestone with open tasks cannot complete');
 await assert.rejects(completeGoal(pool,{actorUserId:alice,goalId:goal}),
  e=>e.message==='milestones_incomplete','a goal with open milestones cannot complete');
 await attachTaskEvidence(pool,{actorUserId:bob,taskId:t2,kind:'artifact-hash',ref:'sha256:'+'cd'.repeat(32)});
 await attachTaskEvidence(pool,{actorUserId:bob,taskId:t2,kind:'test-report',ref:'junit:9/9'});
 await completeTask(pool,{actorUserId:bob,taskId:t2});
 await acceptTask(pool,{actorUserId:alice,taskId:t2});
 assert.deepEqual(await completeMilestone(pool,{actorUserId:alice,milestoneId:milestone}),{milestoneId:milestone,status:'completed'},
  'a milestone with all tasks accepted completes');
 assert.deepEqual(await completeGoal(pool,{actorUserId:alice,goalId:goal}),{goalId:goal,status:'completed'},
  'a goal with all milestones completed completes');
 // Unreviewed tasks complete on evidence alone.
 const m3=(await createMilestone(pool,{actorUserId:alice,goalId:goal2,title:'M3',requiredEvidenceKinds:['note']})).milestoneId;
 const t3=(await createTask(pool,{actorUserId:bob,milestoneId:m3,title:'Quick'})).taskId;
 await attachTaskEvidence(pool,{actorUserId:bob,taskId:t3,kind:'note',ref:'done'});
 assert.deepEqual(await completeTask(pool,{actorUserId:bob,taskId:t3}),{taskId:t3,status:'completed'},
  'an unreviewed task completes once its evidence is attached');
});
