// PUB-12 against real PostgreSQL: issue/task discussion with
// contributor attribution, report/appeal, spam/abuse moderation,
// rate/concurrency limits and maintainer blocking. Recognition
// follows reviewed outcomes and resists duplicates; raw tokens,
// claim counts and self-reported success are not inputs.
//
// PROVEN: task comments post and read in order; the sixth comment in
// a minute refuses and the eleventh open report refuses; reports
// reach maintainers only, hide and remove offending posts, and the
// author alone may appeal — upheld appeals restore, dismissed ones
// hold; blocked users can neither post nor report while self-blocks,
// owner-blocks and stranger-blocks refuse; attribution grants only
// for accepted or integrated work, only by maintainers, exactly once
// per contribution, on a record whose columns admit no metric input.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {postTaskComment,readTaskDiscussion,reportPost,decideReport,appealModeration,decideAppeal,
 blockDiscusser,unblockDiscusser,recordAttribution,readAttributions}=await import('../src/server/services/taskDiscussion.js');
const {submitContribution}=await import('../src/server/services/contributions.js');
const {transitionContribution}=await import('../src/server/services/contributionLifecycle.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-12: moderated task discussion and outcome-only recognition',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`p12-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query(
  `INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id`,
  [x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),dev=await user('dev'),critic=await user('critic');
 const spammer=await user('spammer'),stranger=await user('stranger');
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 const goal=(await pool.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[project,owner])).rows[0].id;
 const mile=(await pool.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[goal,owner])).rows[0].id;
 const task=async name=>((await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,$2,'open') RETURNING id`,[mile,name])).rows[0].id);
 const t1=await task('Survey'),t2=await task('Build'),t3=await task('Polish');
 const first=await postTaskComment(pool,{taskId:t1,authorUserId:dev,body:'starting the survey'});
 await postTaskComment(pool,{taskId:t1,authorUserId:dev,body:'survey half done'});
 assert.deepEqual((await readTaskDiscussion(pool,{taskId:t1})).map(p=>p.body),
  ['starting the survey','survey half done'],'task comments read back in order');
 await postTaskComment(pool,{taskId:t1,authorUserId:dev,body:'three'});
 await postTaskComment(pool,{taskId:t1,authorUserId:dev,body:'four'});
 await postTaskComment(pool,{taskId:t1,authorUserId:dev,body:'five'});
 await assert.rejects(postTaskComment(pool,{taskId:t1,authorUserId:dev,body:'six'}),
  e=>/discussion_rate_limited/.test(e.message),'the sixth comment in a minute refuses');
 // Reports reach maintainers; hide and appeal round-trip the post.
 const flag=await reportPost(pool,{postId:first.id,reporterUserId:critic,reason:'spam',detail:'looks auto-posted'});
 assert.equal(flag.state,'open','the report opens');
 await assert.rejects(reportPost(pool,{postId:first.id,reporterUserId:critic,reason:'spam'}),
  e=>/report_already_open/.test(e.message),'a second open report on the same post refuses');
 await assert.rejects(reportPost(pool,{postId:first.id,reporterUserId:dev,reason:'spam'}),
  e=>/report_self_refused/.test(e.message),'the author cannot report their own post');
 await assert.rejects(decideReport(pool,{reportId:flag.id,actorUserId:stranger,decision:'upheld',action:'hide'}),
  e=>/moderation_not_authorized/.test(e.message),'a stranger cannot moderate');
 const held=await decideReport(pool,{reportId:flag.id,actorUserId:owner,decision:'upheld',action:'hide'});
 assert.equal(held.action,'hide','the upheld report hides the post');
 assert.equal((await readTaskDiscussion(pool,{taskId:t1})).length,4,'the public read skips the hidden post');
 const modView=await readTaskDiscussion(pool,{taskId:t1,readerUserId:owner});
 assert.equal(modView.find(p=>String(p.id)===String(first.id)).state,'hidden','maintainers still see the hidden post');
 await assert.rejects(appealModeration(pool,{postId:first.id,appellantUserId:stranger,grounds:'free it'}),
  e=>/appeal_not_author/.test(e.message),'only the author may appeal');
 const appeal=await appealModeration(pool,{postId:first.id,appellantUserId:dev,grounds:'hand-written, see history'});
 await assert.rejects(appealModeration(pool,{postId:first.id,appellantUserId:dev,grounds:'again'}),
  e=>/appeal_already_open/.test(e.message),'a second open appeal refuses');
 await decideAppeal(pool,{appealId:appeal.id,actorUserId:owner,decision:'upheld'});
 assert.equal((await readTaskDiscussion(pool,{taskId:t1})).length,5,'an upheld appeal restores the post');
 // Removal plus a dismissed appeal holds the removal.
 const second=(await readTaskDiscussion(pool,{taskId:t1}))[1];
 const flag2=await reportPost(pool,{postId:second.id,reporterUserId:critic,reason:'abuse'});
 await decideReport(pool,{reportId:flag2.id,actorUserId:owner,decision:'upheld',action:'remove'});
 const appeal2=await appealModeration(pool,{postId:second.id,appellantUserId:dev,grounds:'it was mild'});
 await decideAppeal(pool,{appealId:appeal2.id,actorUserId:owner,decision:'dismissed'});
 assert.equal((await readTaskDiscussion(pool,{taskId:t1})).length,4,'a dismissed appeal holds the removal');
 // Concurrency: the eleventh open report refuses.
 const posts=[];
 for (let i=0;i<5;i++) posts.push(await postTaskComment(pool,{taskId:t2,authorUserId:dev,body:`b${i}`}));
 for (let i=0;i<5;i++) posts.push(await postTaskComment(pool,{taskId:t3,authorUserId:dev,body:`p${i}`}));
 posts.push(await postTaskComment(pool,{taskId:t3,authorUserId:owner,body:'owner note'}));
 for (let i=0;i<10;i++) await reportPost(pool,{postId:posts[i].id,reporterUserId:critic,reason:'other'});
 await assert.rejects(reportPost(pool,{postId:posts[10].id,reporterUserId:critic,reason:'other'}),
  e=>/too_many_open_reports/.test(e.message),'the eleventh open report refuses');
 // Maintainer blocking closes posting and reporting together.
 await assert.rejects(blockDiscusser(pool,{projectId:project,actorUserId:stranger,blockedUserId:spammer,reason:'x'}),
  e=>/block_not_authorized/.test(e.message),'a stranger cannot block');
 await assert.rejects(blockDiscusser(pool,{projectId:project,actorUserId:owner,blockedUserId:owner,reason:'x'}),
  e=>/block_self_refused/.test(e.message),'self-blocking refuses');
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
  VALUES('project',$1,'admin','user',$2)`,[project,dev]);
 await assert.rejects(blockDiscusser(pool,{projectId:project,actorUserId:dev,blockedUserId:owner,reason:'coup'}),
  e=>/block_owner_refused/.test(e.message),'blocking the project owner refuses');
 await blockDiscusser(pool,{projectId:project,actorUserId:owner,blockedUserId:spammer,reason:'flooding threads'});
 await assert.rejects(postTaskComment(pool,{taskId:t1,authorUserId:spammer,body:'hi'}),
  e=>/discussion_blocked/.test(e.message),'a blocked user cannot post');
 await assert.rejects(reportPost(pool,{postId:first.id,reporterUserId:spammer,reason:'spam'}),
  e=>/discussion_blocked/.test(e.message),'a blocked user cannot report');
 await unblockDiscusser(pool,{projectId:project,actorUserId:owner,blockedUserId:spammer});
 await postTaskComment(pool,{taskId:t1,authorUserId:spammer,body:'back with manners'});
 // Recognition: reviewed outcomes only, granted once, never metric-fed.
 const move=async (id,to,by)=>transitionContribution(pool,{contributionId:id,actorUserId:by,toState:to,
  rationale:`${to} for ${marker}`});
 const submit=async ()=>((await submitContribution(pool,{projectId:project,taskId:t1,type:'code',
  authorUserId:dev,responsibleUserId:dev,revisionHash:`commit:${marker}:${randomUUID().slice(0,6)}`,
  evidence:[{patch:'@@'}],origin:'original work by the author',rightsLicense:'MIT'})).id);
 const toAccepted=async id=>{await move(id,'admitted',owner);await move(id,'in_progress',dev);
  await move(id,'submitted',dev);await move(id,'checks_pending',dev);await move(id,'review',owner);
  await move(id,'accepted',owner);};
 const a=await submit();await toAccepted(a);
 const credit=await recordAttribution(pool,{contributionId:a,actorUserId:owner});
 assert.equal(credit.basis,'reviewed_outcome','attribution records its reviewed basis');
 assert.equal(String(credit.attributed_user_id),String(dev),'the credit names the contribution author');
 assert.deepEqual((await readAttributions(pool,dev)).map(r=>r.contributionId),[a],
  'the author reads their credit');
 await assert.rejects(recordAttribution(pool,{contributionId:a,actorUserId:owner}),
  e=>/already_attributed/.test(e.message),'a second credit for one contribution refuses');
 const b=await submit();
 await assert.rejects(recordAttribution(pool,{contributionId:b,actorUserId:owner}),
  e=>/not_a_reviewed_outcome/.test(e.message),'proposed work earns no recognition');
 const c=await submit();await move(c,'rejected',owner);
 await assert.rejects(recordAttribution(pool,{contributionId:c,actorUserId:owner}),
  e=>/not_a_reviewed_outcome/.test(e.message),'rejected work earns no recognition');
 const d=await submit();await toAccepted(d);
 await assert.rejects(recordAttribution(pool,{contributionId:d,actorUserId:stranger}),
  e=>/attribution_not_authorized/.test(e.message),'recognition is granted, never claimed');
 const cols=(await pool.query(`SELECT column_name FROM information_schema.columns
  WHERE table_name='contribution_attributions' ORDER BY 1`)).rows.map(r=>r.column_name);
 assert.deepEqual(cols,['attributed_user_id','basis','contribution_id','recorded_at','recorded_by_user_id'],
  'the attribution record admits no token, claim-count or self-report input');
});
