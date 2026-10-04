// PUB-04 against real PostgreSQL: a public project is not an open-source
// license. Redistribution rights publish explicitly and default closed;
// every contribution declares its origin, rights and contributor
// agreement; publication and acceptance record the applicable terms.
//
// PROVEN: drafts publish their redistribution statement, and drafts
// without one read back all-rights-reserved (never assumed reusable);
// invalid redistribution values and missing license/terms refuse;
// contributions without origin or rights refuse while declared ones
// record verbatim with the project's published terms version; a
// project-level contributor-agreement requirement admits only matching
// declarations; unpublished projects snapshot no terms; milestone
// acceptances carry a mandatory terms version column beside the
// publication's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {submitContribution,setContributionTerms,readContribution}=await import('../src/server/services/contributions.js');
const {mutateProjectPublication,previewProjectPublication,readPublicProject}=await import('../src/server/services/projectPublication.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-04: explicit redistribution; declared contribution rights; recorded terms',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`p4-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),dev=await user('dev'),stranger=await user('stranger');
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 const closed=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Vault'])).rows[0].id;
 const fresh=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Fresh'])).rows[0].id;
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES
  ('project',$1,'admin','user',$2),('project',$3,'admin','user',$2)`,[project,owner,closed]);
 const ctx={actorUserId:owner,clientId:'pub4'};
 const content={schemaVersion:1,title:'Atlas',purpose:'Maps',license:'MIT',termsVersion:'2026-10-04',
  contributionGuide:'Declare rights',roadmap:'v1',updates:'none',redistribution:'open-source'};
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'draft',expectedRevision:'0',content});
 const pv=await previewProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,visibility:'public'});
 assert.equal(pv.projection.redistribution,'open-source','preview shows the declared redistribution');
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'publish',expectedRevision:'1',visibility:'public',previewHash:pv.previewHash});
 const pub=await readPublicProject(pool,project);
 assert.equal(pub.redistribution,'open-source','the public projection carries the redistribution statement');
 assert.equal(pub.license,'MIT','the public projection carries the license');
 assert.equal(pub.termsVersion,'2026-10-04','the publication records its terms version');
 // No statement means no reuse: the default reads closed, invalid reads refuse.
 const {redistribution:_,...silent}=content;
 await mutateProjectPublication(pool,ctx,{projectId:closed,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'draft',expectedRevision:'0',content:{...silent,title:'Vault'}});
 const pv2=await previewProjectPublication(pool,ctx,{projectId:closed,expectedActorAccountId:owner,visibility:'public'});
 await mutateProjectPublication(pool,ctx,{projectId:closed,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'publish',expectedRevision:'1',visibility:'public',previewHash:pv2.previewHash});
 assert.equal((await readPublicProject(pool,closed)).redistribution,'all-rights-reserved',
  'a public project without redistribution rights reads as reserved, never reusable');
 await assert.rejects(mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
   operationId:randomUUID(),action:'draft',expectedRevision:'2',content:{...content,redistribution:'sometimes'}}),
  e=>/invalid_redistribution|bad_input/.test(e.message+e.code),'an invalid redistribution value refuses');
 await assert.rejects(mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
   operationId:randomUUID(),action:'draft',expectedRevision:'2',content:{...content,license:undefined}}),
  e=>/invalid_text|bad_input/.test(e.message+e.code),'a draft without a license refuses');
 // Contribution declarations: origin and rights mandatory, recorded verbatim.
 const goal=(await pool.query(`INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,'G','demo',$2) RETURNING id`,[project,owner])).rows[0].id;
 const mile=(await pool.query(`INSERT INTO project_milestones(goal_id,title,created_by_user_id) VALUES($1,'M',$2) RETURNING id`,[goal,owner])).rows[0].id;
 const task=(await pool.query(`INSERT INTO project_tasks(milestone_id,title,status) VALUES($1,'Survey','open') RETURNING id`,[mile])).rows[0].id;
 const base={projectId:project,taskId:task,type:'code',authorUserId:dev,responsibleUserId:dev,
  revisionHash:'commit:rights1',evidence:[{diff:'d1'}],origin:'original work by the author',rightsLicense:'MIT'};
 await assert.rejects(submitContribution(pool,{...base,origin:undefined}),
  e=>/origin declaration/.test(e.message),'a contribution without origin refuses');
 await assert.rejects(submitContribution(pool,{...base,rightsLicense:'  '}),
  e=>/rights declaration/.test(e.message),'a contribution without rights refuses');
 const made=await submitContribution(pool,base);
 assert.equal(made.origin,'original work by the author','the origin records verbatim');
 assert.equal(made.rightsLicense,'MIT','the rights record verbatim');
 assert.equal(made.termsVersion,'2026-10-04','the contribution snapshots the published terms version');
 // Contributor agreements: required means required, and matched exactly.
 await assert.rejects(setContributionTerms(pool,{projectId:project,actorUserId:stranger,requiresCla:true,claId:'xeno-cla-1'}),
  e=>/not_authorized/.test(e.message),'a stranger cannot write contribution terms');
 await assert.rejects(setContributionTerms(pool,{projectId:project,actorUserId:owner,requiresCla:true}),
  e=>/names its id/.test(e.message),'a required agreement names its id');
 await setContributionTerms(pool,{projectId:project,actorUserId:owner,requiresCla:true,claId:'xeno-cla-1',claVersion:'3'});
 await assert.rejects(submitContribution(pool,{...base,revisionHash:'commit:rights2'}),
  e=>/contributor agreement/.test(e.message),'a missing agreement refuses once required');
 await assert.rejects(submitContribution(pool,{...base,revisionHash:'commit:rights3',claId:'other-cla'}),
  e=>/contributor agreement/.test(e.message),'a mismatched agreement refuses');
 const agreed=await submitContribution(pool,{...base,revisionHash:'commit:rights4',claId:'xeno-cla-1'});
 assert.equal((await readContribution(pool,agreed.id)).claId,'xeno-cla-1','the matching agreement records');
 // Unpublished projects snapshot no terms; acceptances always record theirs.
 const bare=await submitContribution(pool,{projectId:fresh,taskId:null,type:'documentation',authorUserId:dev,
  responsibleUserId:dev,revisionHash:'docs:1',evidence:[{page:'p'}],
  origin:'original work by the author',rightsLicense:'CC-BY-4.0'});
 assert.equal(bare.termsVersion,null,'without publication there are no terms to snapshot');
 const cols=await pool.query(`SELECT column_name,is_nullable FROM information_schema.columns
  WHERE table_name='workforce_milestone_acceptances' AND column_name='terms_version'`);
 assert.equal(cols.rows.length,1,'acceptances record a terms version');
 assert.equal(cols.rows[0].is_nullable,'NO','the acceptance terms version is mandatory');
});
