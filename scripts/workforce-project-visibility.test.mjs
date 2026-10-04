// PUB-01 against real PostgreSQL: ownership, visibility, contribution
// policy and execution permissions are independent fields; unlisted is
// discovery control, never an authorization boundary; public visibility
// exposes only the explicitly published projection.
//
// PROVEN: each policy setter writes exactly one column (visibility,
// published revision and the sibling policy read back unchanged, and a
// visibility revoke leaves both policies untouched); a draft smuggling
// workspace_id is refused at write time; the public read of a published
// project contains only allowlisted projection keys with a three-field
// maintainer block (no workspace, conversations, paths or credentials);
// unlisted projects stay out of discovery yet read through a direct
// link, and that link authorizes no contribution, execution or admin;
// strangers cannot set policies while a ReBAC admin can.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {setContributionPolicy,setExecutionPolicy,readProjectPolicies,authorizeProjectAction}=await import('../src/server/services/projectPolicies.js');
const {mutateProjectPublication,previewProjectPublication,readPublicProject,discoverPublicProjects}=await import('../src/server/services/projectPublication.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('PUB-01: independent policy fields; unlisted is not authorization; public reads are projection-only',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`p1-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test-hash') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),stranger=await user('stranger'),steward=await user('steward');
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES
  ('project',$1,'admin','user',$2),('project',$1,'admin','user',$3)`,[project,owner,steward]);
 const ctx={actorUserId:owner,clientId:'pub1'};
 const content={schemaVersion:1,title:'Atlas',purpose:'Maps for all',license:'XENO-PUBLIC-1.0',termsVersion:'2026-10-04',
  contributionGuide:'Open offers welcome',roadmap:'v1 soon',updates:'none yet'};
 // Smuggled private fields never reach the draft: unknown keys refuse.
 await assert.rejects(mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
   operationId:randomUUID(),action:'draft',expectedRevision:'0',content:{...content,workspace_id:'smuggled'}}),
  e=>/unknown_field|bad_input/.test(e.message+e.code),'a draft smuggling workspace_id is refused');
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'draft',expectedRevision:'0',content});
 const preview=await previewProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,visibility:'public'});
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'publish',expectedRevision:'1',visibility:'public',previewHash:preview.previewHash});
 // The public read is the allowlisted projection and nothing else.
 const pub=await readPublicProject(pool,project);
 assert.deepEqual(Object.keys(pub).sort(),
  ['contributionGuide','license','maintainer','projectId','purpose','redistribution','revision','roadmap','schemaVersion','termsVersion','title','updates','url','visibility'].sort(),
  'the public projection carries exactly the allowlisted keys');
 assert.deepEqual(Object.keys(pub.maintainer).sort(),['displayName','handle','id'],'the maintainer block is three fields, no credentials');
 assert.ok(!JSON.stringify(pub).includes('test-hash'),'no credential material reaches the projection');
 assert.ok(!JSON.stringify(pub).includes('workspace'),'no workspace reference reaches the projection');
 // Each policy changes alone; visibility changes leave policies standing.
 const afterContrib=await setContributionPolicy(pool,{projectId:project,actorUserId:owner,value:'offers-open'});
 assert.equal(afterContrib.contribution_policy,'offers-open','the contribution policy sets');
 assert.equal(afterContrib.visibility,'public','setting it leaves visibility untouched');
 assert.equal(String(afterContrib.published_revision),'2','setting it leaves the published revision untouched');
 assert.equal(afterContrib.execution_policy,'none','setting it leaves execution untouched');
 const afterExec=await setExecutionPolicy(pool,{projectId:project,actorUserId:owner,value:'sandbox-only'});
 assert.equal(afterExec.contribution_policy,'offers-open','setting execution leaves contribution untouched');
 await mutateProjectPublication(pool,ctx,{projectId:project,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'revoke',expectedRevision:'2'});
 const revoked=await readProjectPolicies(pool,project);
 assert.equal(revoked.visibility,'private','revoke returns visibility to private');
 assert.equal(revoked.contributionPolicy,'offers-open','revoke leaves the contribution policy standing');
 assert.equal(revoked.executionPolicy,'sandbox-only','revoke leaves the execution policy standing');
 // Unlisted: out of discovery, readable by link, authorizing nothing.
 const quiet=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Quiet'])).rows[0].id;
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES
  ('project',$1,'admin','user',$2),('project',$1,'admin','user',$3)`,[quiet,owner,steward]);
 await mutateProjectPublication(pool,ctx,{projectId:quiet,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'draft',expectedRevision:'0',content:{...content,title:'Quiet'}});
 const quietPreview=await previewProjectPublication(pool,ctx,{projectId:quiet,expectedActorAccountId:owner,visibility:'unlisted'});
 await mutateProjectPublication(pool,ctx,{projectId:quiet,expectedActorAccountId:owner,
  operationId:randomUUID(),action:'publish',expectedRevision:'1',visibility:'unlisted',previewHash:quietPreview.previewHash});
 const found=await discoverPublicProjects(pool,{limit:50});
 assert.ok(!found.projects.some(p=>p.projectId===quiet),'an unlisted project stays out of discovery');
 assert.equal((await readPublicProject(pool,quiet)).projectId,quiet,'an unlisted project reads through its direct link');
 assert.equal(await authorizeProjectAction(pool,{projectId:quiet,viewerUserId:stranger,action:'read-public'}),false,'unlisted is not discoverable reading');
 assert.equal(await authorizeProjectAction(pool,{projectId:quiet,viewerUserId:stranger,action:'read-public',viaLink:true}),true,'the direct link opens the projection');
 assert.equal(await authorizeProjectAction(pool,{projectId:quiet,viewerUserId:stranger,action:'contribute',viaLink:true}),false,'the link authorizes no contribution');
 assert.equal(await authorizeProjectAction(pool,{projectId:quiet,viewerUserId:stranger,action:'execute',viaLink:true}),false,'the link authorizes no execution');
 assert.equal(await authorizeProjectAction(pool,{projectId:quiet,viewerUserId:stranger,action:'admin',viaLink:true}),false,'the link authorizes no administration');
 // Policy writes: strangers refused, ReBAC admins admitted, owners full.
 await assert.rejects(setContributionPolicy(pool,{projectId:quiet,actorUserId:stranger,value:'offers-open'}),
  e=>/not_authorized/.test(e.message),'a stranger cannot set policy');
 assert.equal((await setContributionPolicy(pool,{projectId:quiet,actorUserId:steward,value:'offers-open'})).contribution_policy,'offers-open','a ReBAC admin sets policy');
 await assert.rejects(setExecutionPolicy(pool,{projectId:quiet,actorUserId:stranger,value:'sandbox-only'}),
  e=>/not_authorized/.test(e.message),'a stranger cannot set execution');
 assert.equal(await authorizeProjectAction(pool,{projectId:quiet,viewerUserId:owner,action:'admin'}),true,'the owner administers');
 assert.equal(await authorizeProjectAction(pool,{projectId:quiet,viewerUserId:owner,action:'execute'}),false,'execution stays closed while the policy is none');
 await setExecutionPolicy(pool,{projectId:quiet,actorUserId:owner,value:'maintainer-runners'});
 assert.equal(await authorizeProjectAction(pool,{projectId:quiet,viewerUserId:owner,action:'execute'}),true,'execution opens for the owner under its own policy');
 assert.equal(await authorizeProjectAction(pool,{projectId:quiet,viewerUserId:stranger,action:'contribute',viaLink:true}),true,'offers open to strangers only through the contribution policy');
 assert.equal(await authorizeProjectAction(pool,{projectId:project,viewerUserId:stranger,action:'contribute'}),false,'a private project takes no stranger offers despite offers-open');
});
