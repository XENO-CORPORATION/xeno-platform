// PUB-14 against real PostgreSQL: forking a public project carries
// only redistributable published artifacts and metadata into
// independent ownership with recorded provenance — never funds,
// rentals, credentials, memberships or private history — and forks
// submit upstream through the ordinary review path.
//
// PROVEN: the fork names the forker as owner and pins the upstream
// revision, license and public metadata while the live draft stays
// behind; the snapshot carries only allowlisted public keys; no
// goals, memberships, campaigns, publications or contributions cross;
// a non-redistributable license and an unpublished project both
// refuse fork and export; a suspended account cannot fork; the fork
// owner then drives a contribution to the upstream to accepted
// through the same lifecycle every contribution travels.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {forkProject,exportProjectBundle,readForkProvenance}=await import('../src/server/services/projectFork.js');
const {mutateProjectPublication,previewProjectPublication}=await import('../src/server/services/projectPublication.js');
const {submitContribution}=await import('../src/server/services/contributions.js');
const {transitionContribution}=await import('../src/server/services/contributionLifecycle.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-14: redistributable-only forks with independent ownership and upstream review',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`p14-${randomUUID().slice(0,8)}`;
 const user=async (s,patch={})=>{const x=`${marker}-${s}`;return(await pool.query(
  `INSERT INTO users(username,email,display_name,password_hash,is_active) VALUES($1,$2,$1,'t',$3) RETURNING id`,
  [x,x+'@example.test',patch.isActive??true])).rows[0].id;};
 const owner=await user('owner'),dev=await user('dev'),frozen=await user('frozen',{isActive:false});
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
  VALUES('project',$1,'admin','user',$2),('project',$1,'viewer','user',$3)`,[project,owner,dev]);
 const goal=(await pool.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[project,owner])).rows[0].id;
 const mile=(await pool.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[goal,owner])).rows[0].id;
 const task=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Survey','open') RETURNING id`,[mile])).rows[0].id;
 const ctx={actorUserId:owner,clientId:`${marker}-pub`};
 const content={schemaVersion:1,title:'Atlas',purpose:'Maps for all',license:'MIT',
  termsVersion:'2026-10-04',contributionGuide:'Open offers welcome',roadmap:'v1 soon',updates:'none yet'};
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'draft',expectedRevision:'0',content});
 const preview=await previewProjectPublication(pool,ctx,{projectId:project,
  expectedActorAccountId:owner,visibility:'public'});
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'publish',expectedRevision:'1',visibility:'public',
  previewHash:preview.previewHash});
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'draft',expectedRevision:'2',content:{...content,title:'Atlas SECRET'}});
 const {fork,provenance}=await forkProject(pool,{upstreamProjectId:project,forkerUserId:dev});
 assert.equal(String(fork.owner_user_id),String(dev),'the fork names the forker as owner');
 assert.equal(String(provenance.upstream_project_id),String(project),'provenance pins the upstream');
 assert.equal(provenance.upstream_revision,'2','provenance pins the published revision');
 assert.equal(provenance.upstream_license,'MIT','provenance pins the license');
 assert.equal(provenance.metadata.title,'Atlas','the snapshot carries the published title, not the live draft');
 const allowed=new Set(['contributionGuide','license','maintainer','projectId','purpose','redistribution',
  'revision','roadmap','schemaVersion','termsVersion','title','updates','url','visibility',
  'acceptedMilestones','selectedTasks','fundingTotals']);
 for (const key of Object.keys(provenance.metadata)) {
  assert.ok(allowed.has(key),`snapshot key ${key} is allowlisted public metadata`);
 }
 const reread=await readForkProvenance(pool,fork.id);
 assert.equal(String(reread.upstreamProjectId),String(project),'provenance reads back');
 const count=async (table,where,id)=>Number((await pool.query(
  `SELECT count(*) AS n FROM ${table} WHERE ${where}`,[id])).rows[0].n);
 assert.equal(await count('project_goals','project_id=$1',fork.id),0,'no work tree crosses');
 assert.equal(await count('relationship_tuples','object_id=$1',fork.id),0,'no membership crosses');
 assert.equal(await count('workforce_funding_campaigns','project_id=$1',fork.id),0,'no funding crosses');
 assert.equal(await count('project_publications','project_id=$1',fork.id),0,'the fork starts unpublished');
 assert.equal(await count('contributions','project_id=$1',fork.id),0,'no contribution history crosses');
 const bundle=await exportProjectBundle(pool,project);
 assert.equal(bundle.license,'MIT','export reports the license');
 assert.equal(bundle.upstreamRevision,'2','export pins the revision');
 // Gates: license, publicity, and a usable forker.
 const closed=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Closed'])).rows[0].id;
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
  VALUES('project',$1,'admin','user',$2)`,[closed,owner]);
 const cctx={actorUserId:owner,clientId:`${marker}-closed`};
 await mutateProjectPublication(pool,cctx,{projectId:closed,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'draft',expectedRevision:'0',content:{...content,title:'Closed',license:'All-Rights-Reserved'}});
 const cpreview=await previewProjectPublication(pool,cctx,{projectId:closed,
  expectedActorAccountId:owner,visibility:'public'});
 await mutateProjectPublication(pool,cctx,{projectId:closed,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'publish',expectedRevision:'1',visibility:'public',
  previewHash:cpreview.previewHash});
 await assert.rejects(forkProject(pool,{upstreamProjectId:closed,forkerUserId:dev}),
  e=>/fork_refused_not_redistributable/.test(e.message),'a non-redistributable license refuses the fork');
 await assert.rejects(exportProjectBundle(pool,closed),
  e=>/fork_refused_not_redistributable/.test(e.message),'a non-redistributable license refuses export');
 const quiet=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Quiet'])).rows[0].id;
 await assert.rejects(forkProject(pool,{upstreamProjectId:quiet,forkerUserId:dev}),
  e=>/project_not_public/.test(e.message),'an unpublished project refuses the fork');
 const gone=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Gone'])).rows[0].id;
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
  VALUES('project',$1,'admin','user',$2)`,[gone,owner]);
 const gctx={actorUserId:owner,clientId:`${marker}-gone`};
 await mutateProjectPublication(pool,gctx,{projectId:gone,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'draft',expectedRevision:'0',content:{...content,title:'Gone'}});
 const gpreview=await previewProjectPublication(pool,gctx,{projectId:gone,
  expectedActorAccountId:owner,visibility:'public'});
 await mutateProjectPublication(pool,gctx,{projectId:gone,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'publish',expectedRevision:'1',visibility:'public',
  previewHash:gpreview.previewHash});
 await mutateProjectPublication(pool,gctx,{projectId:gone,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'revoke',expectedRevision:'2'});
 await assert.rejects(forkProject(pool,{upstreamProjectId:gone,forkerUserId:dev}),
  e=>/project_not_public/.test(e.message),'a revoked project refuses the fork');
 await assert.rejects(forkProject(pool,{upstreamProjectId:project,forkerUserId:frozen}),
  e=>/forker_not_usable/.test(e.message),'a suspended account cannot fork');
 // The fork submits upstream through the ordinary review path.
 const record=await submitContribution(pool,{projectId:project,taskId:task,type:'code',
  authorUserId:dev,responsibleUserId:dev,revisionHash:`commit:${marker}:upstream`,
  evidence:[{patch:'@@ upstream fix'}],origin:'original work by the author',rightsLicense:'MIT'});
 const move=async to=>transitionContribution(pool,{contributionId:record.id,actorUserId:
  ['admitted','accepted'].includes(to)?owner:dev,toState:to,rationale:`${to} for ${marker}`});
 for (const to of ['admitted','in_progress','submitted','checks_pending','review','accepted']) await move(to);
 const landed=(await pool.query(`SELECT project_id, review_state FROM contributions WHERE id=$1`,[record.id])).rows[0];
 assert.equal(String(landed.project_id),String(project),'the fork contribution targets the upstream');
 assert.equal(landed.review_state,'accepted','the fork contribution travels the same review path');
});
