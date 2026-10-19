// FORGE-01/02/04/06 over HTTP against real PostgreSQL: the forge services are REACHABLE at /api/workforce/forge.
// PROVEN: the project admin binds a repository, branches, opens a change request, records a check and review and
// integrates it; a stranger cannot bind (denied) and cannot read the private project's bindings, revisions or
// checks (not_found, same as a missing id); an unknown provider is the caller's error; an external identity link
// is only ever the caller's own (a body cannot name the user).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.JWT_SECRET ||= 'forge-routes-local-fixture';
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('FORGE: the forge API is reachable and guarded',{skip:!url,timeout:180000},async t=>{
 const db=new pg.Pool({connectionString:url,max:10});t.after(()=>db.end());
 await runAllMigrations(db);
 const marker=`forr-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await db.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),stranger=await user('stranger');
 const project=(await db.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Repo'])).rows[0].id;
 const express=(await import('express')).default;
 const {createRequire}=await import('node:module');
 const jwt=createRequire(new URL('../src/server/package.json',import.meta.url))('jsonwebtoken');
 const {createWorkforceRouter}=await import('../src/server/routes/workforceRoutes.js');
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.db=db;next();});app.use('/api/workforce',createWorkforceRouter());
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const call=async(p,body,as)=>{const token=jwt.sign({userId:as,email:'x@y.z'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/workforce/forge${p}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json().catch(()=>null)};};
 const ok=(r,m)=>{assert.equal(r.status,200,`${m}: ${JSON.stringify(r.body)}`);return r.body.result;};
 const bindBody={projectId:project,provider:'local',remoteId:`atlas-${marker}`,refs:{default:'main'}};
 assert.equal((await call('/bindings',bindBody,stranger)).status,403,'a stranger cannot bind');
 assert.equal((await call('/bindings',{...bindBody,provider:'nope'},owner)).status,400,'an unknown provider is the caller\'s error');
 const binding=ok(await call('/bindings',bindBody,owner),'the admin binds a repository');
 ok(await call('/branches',{bindingId:binding.id,name:'main',fromRev:'r0'},owner),'main');
 ok(await call('/branches',{bindingId:binding.id,name:'feature',fromRev:'r1'},owner),'feature');
 assert.deepEqual(ok(await call('/revisions/read',{bindingId:binding.id,rev:'r1'},owner),'a revision reads').branches,['feature']);
 const cr=ok(await call('/change-requests',{bindingId:binding.id,sourceBranch:'feature',targetRef:'main',title:'Add maps',body:''},owner),'a change request opens');
 ok(await call('/change-requests/check',{crId:cr.id,name:'suite',status:'pass'},owner),'a check records');
 ok(await call('/change-requests/review',{crId:cr.id,decision:'approve'},owner),'a review records');
 const integrated=await call('/change-requests/integrate',{crId:cr.id},owner);
 assert.equal(integrated.status,200,`it integrates under policy: ${JSON.stringify(integrated.body)}`);
 // a stranger sees nothing of a private project
 const missing=await call('/revisions/read',{bindingId:randomUUID(),rev:'r1'},stranger);
 for(const [p,b] of [['/revisions/read',{bindingId:binding.id,rev:'r1'}],['/change-requests/checks',{crId:cr.id}],['/bindings/list',{projectId:project}]]){
  const r=await call(p,b,stranger);
  assert.deepEqual([r.status,r.body.reason],[missing.status,missing.body.reason],`${p}: a stranger is told it does not exist`);
 }
 assert.equal(missing.status,404);
 assert.equal((await call('/external/link',{actorId:randomUUID(),method:'oauth',proofRef:'x',userId:owner},stranger)).status,400,'a body cannot name whose identity is linked');
});
