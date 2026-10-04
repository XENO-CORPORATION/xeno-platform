// PUB-10 against real PostgreSQL: a submission carries a retrievable
// artifact (diff or versioned artifact locator) and run references on
// each revision, reproducible check results bound to the revision they
// ran against, and license plus provenance on the record; maintainers
// review the exact submitted revision; a new revision supersedes prior
// approvals and checks; integration rechecks target revision, approval,
// checks and enforced policy atomically at the maintainer authority.
//
// PROVEN: artifact locators and run refs read back on the revision;
// reviews name their revision and refuse strangers, self-review and
// never-submitted revisions; a rebase supersedes the old approval and
// checks and requeues the record; merging the stale target, or the new
// target without a fresh approval, refuses; failing or missing checks
// block gated types while an unchecked non-gated type merges; a missing
// artifact blocks the merge; the author's own hand and strangers cannot
// integrate; a contributor-agreement swap or a terms publication after
// submission blocks the merge as a policy change.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {submitContribution,submitRevision,readContribution,setContributionTerms}=await import('../src/server/services/contributions.js');
const {transitionContribution}=await import('../src/server/services/contributionLifecycle.js');
const {recordReview,recordChecks,readReviews,readChecks,integrateContribution}=await import('../src/server/services/submissionIntegrity.js');
const {mutateProjectPublication,previewProjectPublication}=await import('../src/server/services/projectPublication.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-10: exact-revision review, invalidation on rebase, atomic policy-checked merge',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`p10-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query(
  `INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id`,
  [x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),dev=await user('dev'),stranger=await user('stranger');
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
  VALUES('project',$1,'admin','user',$2),('project',$1,'admin','user',$3)`,[project,dev,owner]);
 const goal=(await pool.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[project,owner])).rows[0].id;
 const mile=(await pool.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[goal,owner])).rows[0].id;
 const task=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Survey','open') RETURNING id`,[mile])).rows[0].id;
 const art=n=>({diffRef:`diff:${marker}:${n}`,runs:[`run:${marker}:${n}`]});
 const pass=(n,by=dev)=>recordChecks(pool,{contributionId:n.contributionId??n,actorUserId:by,revisionNo:n.revisionNo??1,
  checks:[{name:'suite',status:'pass',definitionRef:'check:suite:v3',inputDigest:'sha256:abc',runRef:`run:${marker}:suite`}]});
 const submit=async (over={})=>submitContribution(pool,{projectId:project,taskId:task,type:'code',
  authorUserId:dev,responsibleUserId:dev,revisionHash:`commit:${marker}:${randomUUID().slice(0,6)}`,
  evidence:[{patch:'@@ -1 +1 @@'}],origin:'original work by the author',rightsLicense:'MIT',
  artifact:art(1),...over});
 const move=async (id,to,by)=>transitionContribution(pool,{contributionId:id,actorUserId:by,toState:to,
  rationale:`${to} for ${marker}`});
 const toReview=async id=>{await move(id,'admitted',owner);await move(id,'in_progress',dev);
  await move(id,'submitted',dev);await move(id,'checks_pending',dev);await move(id,'review',owner);};
 // The invalidation spine: approve rev1, rebase, stale judgments die.
 const b=await submit({});
 await toReview(b.id);
 await pass(b.id);
 await recordReview(pool,{contributionId:b.id,reviewerUserId:owner,revisionNo:1,decision:'approve',
  rationale:'reads clean'});
 await assert.rejects(recordReview(pool,{contributionId:b.id,reviewerUserId:stranger,revisionNo:1,
  decision:'approve',rationale:'x'}),e=>/review_not_authorized/.test(e.message),'a stranger cannot review');
 await assert.rejects(recordReview(pool,{contributionId:b.id,reviewerUserId:dev,revisionNo:1,
  decision:'approve',rationale:'x'}),e=>/self_review_refused/.test(e.message),'the author cannot approve their own work');
 await assert.rejects(recordReview(pool,{contributionId:b.id,reviewerUserId:owner,revisionNo:9,
  decision:'approve',rationale:'x'}),e=>/never submitted/.test(e.message),'a review names a submitted revision');
 const b2=await submitRevision(pool,{contributionId:b.id,actorUserId:dev,
  revisionHash:`commit:${marker}:rebase`,evidence:[{patch:'@@ -2 +2 @@'}],artifact:art(2)});
 assert.equal(b2.currentRevisionNo,2,'the rebase appends rev2');
 assert.equal(b2.reviewState,'submitted','the rebase requeues the record for re-review');
 const judgments=await readReviews(pool,b.id),outcomes=await readChecks(pool,b.id);
 assert.equal(judgments.length,1,'one review was recorded');
 assert.equal(judgments[0].superseded,true,'the rebase supersedes the rev1 approval');
 assert.equal(outcomes[0].superseded,true,'the rebase supersedes the rev1 checks');
 await move(b.id,'checks_pending',dev);await move(b.id,'review',owner);await move(b.id,'accepted',owner);
 await assert.rejects(integrateContribution(pool,{contributionId:b.id,actorUserId:owner,
  expectedRevisionNo:1,rationale:'stale'}),e=>/stale_target_revision/.test(e.message),
  'merging the superseded target refuses');
 await assert.rejects(integrateContribution(pool,{contributionId:b.id,actorUserId:owner,
  expectedRevisionNo:2,rationale:'no fresh approval'}),e=>/no_approval_for_revision/.test(e.message),
  'the stale approval does not transfer to the new revision');
 await recordChecks(pool,{contributionId:b.id,actorUserId:dev,revisionNo:2,
  checks:[{name:'suite',status:'pass',definitionRef:'check:suite:v3',inputDigest:'sha256:def',runRef:`run:${marker}:suite2`}]});
 await recordReview(pool,{contributionId:b.id,reviewerUserId:owner,revisionNo:2,decision:'approve',
  rationale:'re-read at rev2'});
 const merged=await integrateContribution(pool,{contributionId:b.id,actorUserId:owner,
  expectedRevisionNo:2,rationale:'integrate rev2'});
 assert.equal(merged.state,'integrated','the exact approved revision merges');
 const reread=await readContribution(pool,b.id);
 assert.equal(reread.reviewState,'integrated','the integrated state reads back');
 assert.equal(reread.revisions[1].artifact.diffRef,`diff:${marker}:2`,'the artifact locator reads back on its revision');
 assert.deepEqual(reread.revisions[1].artifact.runs,[`run:${marker}:2`],'run references ride the revision');
 // Gated types need green checks: a failing check blocks the merge.
 const c=await submit({});
 await toReview(c.id);
 await recordChecks(pool,{contributionId:c.id,actorUserId:dev,revisionNo:1,
  checks:[{name:'suite',status:'fail',definitionRef:'check:suite:v3',inputDigest:'sha256:abc'}]});
 await recordReview(pool,{contributionId:c.id,reviewerUserId:owner,revisionNo:1,decision:'approve',
  rationale:'optimistic'});
 await move(c.id,'accepted',owner);
 await assert.rejects(integrateContribution(pool,{contributionId:c.id,actorUserId:owner,
  expectedRevisionNo:1,rationale:'red'}),e=>/checks_not_green/.test(e.message),
  'a failing check blocks a gated merge');
 // And missing checks block it too.
 const d=await submit({});
 await toReview(d.id);
 await recordReview(pool,{contributionId:d.id,reviewerUserId:owner,revisionNo:1,decision:'approve',
  rationale:'no checks ran'});
 await move(d.id,'accepted',owner);
 await assert.rejects(integrateContribution(pool,{contributionId:d.id,actorUserId:owner,
  expectedRevisionNo:1,rationale:'blind'}),e=>/checks_not_green/.test(e.message),
  'a gated merge without checks refuses');
 // No artifact, no merge — and the wrong hands cannot integrate either.
 const e=await submit({artifact:null});
 await toReview(e.id);
 await pass(e.id);
 await recordReview(pool,{contributionId:e.id,reviewerUserId:owner,revisionNo:1,decision:'approve',
  rationale:'fine but bare'});
 await move(e.id,'accepted',owner);
 await assert.rejects(integrateContribution(pool,{contributionId:e.id,actorUserId:dev,
  expectedRevisionNo:1,rationale:'self'}),e=>/self_integrate_refused/.test(e.message),
  'the author cannot integrate their own work');
 await assert.rejects(integrateContribution(pool,{contributionId:e.id,actorUserId:stranger,
  expectedRevisionNo:1,rationale:'stranger'}),e=>/integrate_not_authorized/.test(e.message),
  'a stranger cannot integrate');
 await assert.rejects(integrateContribution(pool,{contributionId:e.id,actorUserId:owner,
  expectedRevisionNo:1,rationale:'bare'}),e=>/revision_has_no_artifact/.test(e.message),
  'a revision without a retrievable artifact does not merge');
 // The enforced policy is rechecked: a swapped contributor agreement blocks.
 await setContributionTerms(pool,{projectId:project,actorUserId:owner,requiresCla:true,claId:`cla-${marker}-a`});
 const g=await submit({claId:`cla-${marker}-a`});
 await toReview(g.id);
 await pass(g.id);
 await recordReview(pool,{contributionId:g.id,reviewerUserId:owner,revisionNo:1,decision:'approve',
  rationale:'under agreement a'});
 await move(g.id,'accepted',owner);
 await setContributionTerms(pool,{projectId:project,actorUserId:owner,requiresCla:true,claId:`cla-${marker}-b`});
 await assert.rejects(integrateContribution(pool,{contributionId:g.id,actorUserId:owner,
  expectedRevisionNo:1,rationale:'terms moved'}),e=>/contribution_policy_changed/.test(e.message),
  'a contributor-agreement swap after submission blocks the merge');
 await setContributionTerms(pool,{projectId:project,actorUserId:owner,requiresCla:false});
 // So does a terms publication landing after the submission pinned none.
 const h=await submit({});
 assert.equal(h.termsVersion,null,'the submission pins no terms version while none are published');
 await toReview(h.id);
 await pass(h.id);
 await recordReview(pool,{contributionId:h.id,reviewerUserId:owner,revisionNo:1,decision:'approve',
  rationale:'pre-terms'});
 await move(h.id,'accepted',owner);
 const ctx={actorUserId:owner,clientId:`${marker}-pub`};
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'draft',expectedRevision:'0',
  content:{schemaVersion:1,title:'Atlas',purpose:'Maps for all',license:'XENO-PUBLIC-1.0',
   termsVersion:'2026-10-04',contributionGuide:'Open offers welcome',roadmap:'v1 soon',updates:'none yet'}});
 const preview=await previewProjectPublication(pool,ctx,{projectId:project,
  expectedActorAccountId:owner,visibility:'public'});
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'publish',expectedRevision:'1',visibility:'public',
  previewHash:preview.previewHash});
 await assert.rejects(integrateContribution(pool,{contributionId:h.id,actorUserId:owner,
  expectedRevisionNo:1,rationale:'terms landed'}),e=>/contribution_policy_changed/.test(e.message),
  'published terms landing after submission block the merge');
 // Where checks do not apply, approval plus artifact is enough.
 const i=await submit({type:'credits',evidence:[],revisionHash:`lot:${marker}:5000`,
  artifact:{artifactUrn:`lot:${marker}:5000`,runs:[]}});
 await toReview(i.id);
 await recordReview(pool,{contributionId:i.id,reviewerUserId:owner,revisionNo:1,decision:'approve',
  rationale:'grant verified'});
 await move(i.id,'accepted',owner);
 const mergedI=await integrateContribution(pool,{contributionId:i.id,actorUserId:owner,
  expectedRevisionNo:1,rationale:'integrate grant'});
 assert.equal(mergedI.state,'integrated','a non-gated type merges on approval plus artifact');
});
