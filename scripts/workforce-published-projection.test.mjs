// PUB-02 against real PostgreSQL: a public project exposes an explicitly
// published projection — purpose, maintainer, license/terms, roadmap,
// contribution guide, selected task status and optional funding totals —
// previewed exactly before publication, with drafts and internal items
// staying private.
//
// PROVEN: selected tasks snapshot live status at preview and publish as
// label+status summaries only (no ids, assignees or evidence); tasks from
// another project or unknown ids refuse; a task status change after
// preview invalidates the publish until re-previewed; the milestone gate
// fails closed (fabricated hashes, evidence-less acceptances and unknown
// milestones all refuse, so only genuine accepted activity can publish);
// funding totals derive from the real contribution ceremony and count
// confirmed money only; a newer draft never leaks into the public read.
//
// NOTE (honest gap): the positive acceptedMilestones publication awaits a
// seeded funded-run acceptance chain (participation -> funded admission ->
// run result -> acceptFundingMilestone). No proof seeds that chain yet;
// PUB-02 pins the gate's fail-closed sides and the projection machinery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.STRIPE_SECRET_KEY='sk_test_localfixture';
process.env.STRIPE_PUBLISHABLE_KEY='pk_test_localfixture';
process.env.STRIPE_EXPECTED_ACCOUNT_ID='acct_fixture';
process.env.STRIPE_EXPECTED_MODE='test';
const {installBillingProviderFixture}=await import('./fixtures/billing-provider-fixture.mjs');
const fixture=installBillingProviderFixture();
const {handleEvent}=await import('../src/server/services/billingService.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const funding=await import('../src/server/services/workforceFunding.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');
const {mutateProjectPublication,previewProjectPublication,readPublicProject,readProjectPublication}=await import('../src/server/services/projectPublication.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-02: explicit projection with previewed tasks and totals; drafts stay private',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 await migrateAccountV2(pool);
 const marker=`p2-${randomUUID().slice(0,8)}`.replaceAll('-','');
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),contributor=await user('contributor');
 // PaidContributor: settled checkout -> payment-backed lots -> consent.
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[contributor]);
 const session={id:`cs_${marker}paid`,mode:'payment',payment_status:'paid',payment_intent:`pi_${marker}paid`,
  client_reference_id:contributor,customer:`cus_${marker}`,amount_total:5000,currency:'eur',
  metadata:{xenoUserId:contributor,credits:'50',kind:'credits'}};
 await handleEvent(pool,fixture.event(`evt_${marker}paid`,'checkout.session.completed',session),{provider:fixture.provider});
 const project=(await createAuthorizedProject(pool,{principal:userPrincipal(owner),name:'Atlas'})).id;
 const other=(await createAuthorizedProject(pool,{principal:userPrincipal(owner),name:'Other'})).id;
 const ctx={actorUserId:owner,clientId:'pub2'};
 const content={schemaVersion:1,title:'Atlas',purpose:'Maps for all',license:'XENO-PUBLIC-1.0',termsVersion:'2026-10-04',
  contributionGuide:'Open offers welcome',roadmap:'v1 soon',updates:'none yet'};
 // Work tree: two tasks here, one task on the other project.
 const goal=(await pool.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[project,owner])).rows[0].id;
 const mile=(await pool.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[goal,owner])).rows[0].id;
 const t1=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status,assignee_user_id) VALUES($1,'Survey','open',$2) RETURNING id`,[mile,contributor])).rows[0].id;
 const t2=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Publish','completed') RETURNING id`,[mile])).rows[0].id;
 const ogoal=(await pool.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[other,owner])).rows[0].id;
 const omile=(await pool.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[ogoal,owner])).rows[0].id;
 const foreign=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Elsewhere','open') RETURNING id`,[omile])).rows[0].id;
 // Funding ceremony: campaign + milestones declared in draft, opened,
 // two confirmed contributions and one returned.
 const campaign=await funding.createFundingCampaign(pool,ctx,{operationId:randomUUID(),projectId:project,
  beneficiary:'Accepted delivery',cancellationTerms:'Cancel unused work.',refundTerms:'Original expiry applies.',deliverableLicense:'MIT'});
 const fmile=await funding.createFundingMilestone(pool,ctx,{campaignId:campaign.id,key:'first',title:'First',
  criteria:['A reviewer accepts the result.'],thresholdMicro:'100',budgetMaxMicro:'5000000'});
 const bare=await funding.createFundingMilestone(pool,ctx,{campaignId:campaign.id,key:'bare',title:'Bare',
  criteria:['Anything.'],thresholdMicro:'100',budgetMaxMicro:'5000000'});
 await funding.openFundingCampaign(pool,ctx,{campaignId:campaign.id});
 await pool.query(`UPDATE workforce_funding_milestones SET status='accepted' WHERE id=$1`,[bare.id]);
 const offer=await funding.readFundingOffer(pool,{actorUserId:contributor,clientId:'pub2'},
  {campaignId:campaign.id,milestoneId:fmile.id});
 const give=async amount=>funding.contributeFunding(pool,{actorUserId:contributor,clientId:'pub2'},
  {operationId:randomUUID(),campaignId:campaign.id,milestoneId:fmile.id,amountMicro:amount,consentHash:offer.consentHash,confirmed:true});
 const kept1=await give('5000'),kept2=await give('7000');
 assert.equal(kept1.state,'confirmed','real money confirms through the ceremony');
 const retraced=await give('9000');
 await funding.returnFundingContribution(pool,{actorUserId:contributor,clientId:'pub2'},{contributionId:retraced.id});
 assert.equal((await pool.query(`SELECT state FROM workforce_funding_contributions WHERE id=$1`,[retraced.id])).rows[0].state,
  'returned','the third contribution returns');
 // Selection gates fail closed before anything publishes.
 const h64=(c)=>c.repeat(64);
 const draftWith=async (extra,rev)=>mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'draft',expectedRevision:rev,content:{...content,...extra}});
 const refusals=[
  [{selectedTasks:[{taskId:foreign,label:'Nope'}]},'a task from another project cannot be selected',/selected_task_unavailable/],
  [{selectedTasks:[{taskId:randomUUID(),label:'Ghost'}]},'an unknown task cannot be selected',/selected_task_unavailable/],
  [{acceptedMilestones:[{milestoneId:fmile.id,acceptanceHash:h64('0'),label:'M',summary:'s'}]},'a fabricated acceptance hash is refused',/accepted_milestone_unavailable/],
  [{acceptedMilestones:[{milestoneId:bare.id,acceptanceHash:h64('1'),label:'M',summary:'s'}]},'an accepted milestone without evidence is unavailable',/accepted_milestone_unavailable/],
  [{acceptedMilestones:[{milestoneId:randomUUID(),acceptanceHash:h64('2'),label:'M',summary:'s'}]},'an unknown milestone is unavailable',/accepted_milestone_unavailable/],
 ];
 let rev=0;
 for (const [extra,why,pattern] of refusals) {
  await draftWith(extra,String(rev++));
  await assert.rejects(previewProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,visibility:'public'}),
   e=>pattern.test(e.message),why);
 }
 // The honest draft previews exactly, publishes, and reads back complete.
 await draftWith({selectedTasks:[{taskId:t1,label:'Survey work'},{taskId:t2,label:'Launch'}],includeFundingTotals:true},String(rev++));
 const preview=await previewProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,visibility:'public'});
 assert.deepEqual(preview.projection.selectedTasks,[{label:'Survey work',status:'open'},{label:'Launch',status:'completed'}],'preview snapshots live task status');
 assert.deepEqual(preview.projection.fundingTotals,{raisedMicro:'12000',contributionCount:2,campaignCount:1},'preview derives confirmed-only totals');
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'publish',expectedRevision:String(rev),visibility:'public',previewHash:preview.previewHash});
 rev++;
 const pub=await readPublicProject(pool,project);
 assert.deepEqual(pub.selectedTasks,[{label:'Survey work',status:'open'},{label:'Launch',status:'completed'}],'the public projection carries task summaries only');
 assert.deepEqual(pub.fundingTotals,{raisedMicro:'12000',contributionCount:2,campaignCount:1},'the public projection carries derived totals');
 assert.ok(!JSON.stringify(pub).includes(contributor),'no contributor identity leaks anywhere');
 assert.ok(!JSON.stringify(pub).includes(t1),'no task id leaks anywhere');
 // Staleness invalidates: a task moves after preview, the publish refuses.
 await draftWith({selectedTasks:[{taskId:t1,label:'Survey work'}]},String(rev++));
 const stale=await previewProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,visibility:'public'});
 await pool.query(`UPDATE project_tasks SET status='completed' WHERE id=$1`,[t1]);
 await assert.rejects(mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
   operationId:randomUUID(),action:'publish',expectedRevision:String(rev),visibility:'public',previewHash:stale.previewHash}),
  e=>/preview_changed/.test(e.message),'a task status change after preview invalidates the publish');
 const fresh=await previewProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,visibility:'public'});
 assert.deepEqual(fresh.projection.selectedTasks,[{label:'Survey work',status:'completed'}],'re-preview snapshots the new status');
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'publish',expectedRevision:String(rev),visibility:'public',previewHash:fresh.previewHash});
 rev++;
 // Drafts stay private: a newer unpublished draft never reaches the public.
 await draftWith({title:'Atlas v2',roadmap:'v2',updates:'draft only'},String(rev++));
 const still=await readPublicProject(pool,project);
 assert.equal(still.title,'Atlas','the public read keeps serving the last publish, not the newer draft');
 const admin=await readProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner});
 assert.equal(admin.draft.title,'Atlas v2','the draft itself is visible to the admin only');
});
