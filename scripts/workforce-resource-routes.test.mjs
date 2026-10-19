// RES-01..06 over HTTP against real PostgreSQL: the contributed-resource services are REACHABLE at
// /api/workforce/contributed. PROVEN: an offer is made and accepted into a lease; the lease reads for its holder
// and its owner and is not_found to anyone else; a donor registers a worker but CANNOT qualify it (operator act)
// while a platform admin can; a resource driver is admitted only by an operator; a grant composes from a lease.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.JWT_SECRET ||= 'resource-routes-local-fixture';
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('RES: the contributed-resource API is reachable and operator-gated',{skip:!url,timeout:180000},async t=>{
 const db=new pg.Pool({connectionString:url,max:10});t.after(()=>db.end());
 await runAllMigrations(db);
 const marker=`resr-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await db.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),mallory=await user('mallory'),admin=await user('admin');
 await db.query("UPDATE users SET role='admin' WHERE id=$1",[admin]);
 const express=(await import('express')).default;
 const {createRequire}=await import('node:module');
 const jwt=createRequire(new URL('../src/server/package.json',import.meta.url))('jsonwebtoken');
 const {createWorkforceRouter}=await import('../src/server/routes/workforceRoutes.js');
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.db=db;next();});app.use('/api/workforce',createWorkforceRouter());
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const call=async(p,body,as)=>{const token=jwt.sign({userId:as,email:'x@y.z'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/workforce/contributed${p}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json().catch(()=>null)};};
 const ok=(r,m)=>{assert.equal(r.status,200,`${m}: ${JSON.stringify(r.body)}`);return r.body.result;};
 const now=Date.now(),h=3600_000;
 const offer=ok(await call('/offers',{offer:{kind:'compute/hours',capacityQuantity:10,capacityUnit:'gpu-hour',validFrom:new Date(now-h),validUntil:new Date(now+24*h),
   revocationPolicy:'r',costResponsibility:'c',dataAccessPolicy:'d',license:'l',verificationMethod:'v'}},alice),'an offer is made');
 const lease=ok(await call('/offers/accept',{offerId:offer.offerId,quantity:4},bob),'it is accepted into a lease').leaseId;
 ok(await call('/leases/read',{leaseId:lease},bob),'the holder reads the lease');
 ok(await call('/leases/read',{leaseId:lease},alice),'the owner reads it');
 const hidden=await call('/leases/read',{leaseId:lease},mallory),missing=await call('/leases/read',{leaseId:randomUUID()},mallory);
 assert.deepEqual([hidden.status,hidden.body.reason],[missing.status,missing.body.reason],'anyone else is told it does not exist');
 const grant=ok(await call('/grants',{type:'marketplace-rental',resourceLeaseId:lease,consentScope:'task-1'},alice),'a grant is issued from the lease');
 assert.ok(grant.grantId,'with an id');
 const worker=ok(await call('/workers',{isolation:'strong',egress:'restricted',devices:'none'},alice),'a donor registers a worker').workerId;
 const evidence={method:'independent-audit',reportHash:'ab'.repeat(32)};
 assert.equal((await call('/workers/qualify',{workerId:worker,evidence},alice)).status,403,'the donor cannot qualify their own worker');
 assert.equal(ok(await call('/workers/qualify',{workerId:worker,evidence},admin),'an operator qualifies it').trust,'qualified');
 const receipt={measuredQuantity:1,measuredUnit:'gpu-hour',probe:'nvidia-smi'};
 assert.equal((await call('/drivers/admit',{family:'compute',driverName:'gpu',receipt},alice)).status,403,'driver admission is an operator act');
 assert.equal((await call('/offers',{offer:{},actorUserId:mallory},alice)).status,400,'a body cannot name the actor');
});
