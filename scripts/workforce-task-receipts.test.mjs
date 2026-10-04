// RES-04 against real PostgreSQL: worker-reported output and GPU-hours are
// not automatically trustworthy. Reports bind job identity (the task
// credential), input/output hashes, cancellation and metering; artifacts are
// verified, consequential results independently reproduced; no unverified
// receipt mints credits, releases funding or establishes task acceptance.
//
// PROVEN: reports authenticate with the live task credential and land
// unverified; verification demands a matching artifact hash, a verifier
// other than the donor, and independent reproduction for consequential
// results; acceptance and the settlement basis refuse unverified receipts
// and accept verified ones (acceptance by the scheduler only); cancellation
// (scheduler or donor) refuses further reports and freezes pending receipts
// so they can never verify.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {registerComputeWorker,approveWorkerCaps,scheduleComputeTask}=await import('../src/server/services/contributedCompute.js');
const {reportTaskOutput,cancelComputeTask,verifyTaskReceipt,acceptTaskResult,settlementBasisForReceipt}=await import('../src/server/services/computeReceipts.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('RES-04: bound metering receipts verify before any acceptance or settlement',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`r4-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const donor=await user('donor'),scheduler=await user('scheduler'),verifier=await user('verifier'),stranger=await user('stranger');
 const workerId=(await registerComputeWorker(pool,{actorUserId:donor,isolation:'strong',egress:'restricted',devices:'none'})).workerId;
 await approveWorkerCaps(pool,{actorUserId:donor,workerId,caps:{maxCpuMillicores:1000,maxMemoryMb:1024,maxSeconds:300}});
 const small={cpuMillicores:500,memoryMb:512,maxSeconds:60};
 const IN='ab'.repeat(32),OUT='cd'.repeat(32);
 const task=await scheduleComputeTask(pool,{actorUserId:scheduler,workerId,inputClassification:'public',request:small});
 await assert.rejects(reportTaskOutput(pool,{taskId:task.taskId,token:'0'.repeat(64),inputHash:IN,outputHash:OUT,gpuHours:2,artifactRef:'bafy-1'}),
  e=>e.message==='report_not_authenticated','a report without the live task credential is refused');
 const rep=await reportTaskOutput(pool,{taskId:task.taskId,token:task.token,inputHash:IN,outputHash:OUT,gpuHours:2,artifactRef:'bafy-1'});
 assert.equal(rep.status,'unverified','a fresh report lands unverified, however plausible');
 await assert.rejects(settlementBasisForReceipt(pool,{receiptId:rep.receiptId}),
  e=>e.message==='receipt_unverified','no unverified receipt grounds settlement');
 await assert.rejects(acceptTaskResult(pool,{actorUserId:scheduler,receiptId:rep.receiptId}),
  e=>e.message==='receipt_unverified','no unverified receipt establishes task acceptance');
 await assert.rejects(verifyTaskReceipt(pool,{actorUserId:verifier,receiptId:rep.receiptId,artifactHash:'ee'.repeat(32),method:'artifact-hash'}),
  e=>e.message==='artifact_hash_mismatch','verification with a mismatched artifact hash is refused');
 await assert.rejects(verifyTaskReceipt(pool,{actorUserId:donor,receiptId:rep.receiptId,artifactHash:OUT,method:'artifact-hash'}),
  e=>e.message==='verifier_not_independent','the donor cannot self-verify their own worker output');
 const done=await verifyTaskReceipt(pool,{actorUserId:verifier,receiptId:rep.receiptId,artifactHash:OUT,method:'artifact-hash'});
 assert.equal(done.status,'verified','an independent hash verification verifies');
 const basis=await settlementBasisForReceipt(pool,{receiptId:rep.receiptId});
 assert.deepEqual([basis.gpuHours,basis.status],[2,'verified'],'the settlement basis carries verified metering');
 await assert.rejects(acceptTaskResult(pool,{actorUserId:stranger,receiptId:rep.receiptId}),
  e=>e.message==='accept_not_authorized','only the scheduler accepts the verified result');
 assert.deepEqual(await acceptTaskResult(pool,{actorUserId:scheduler,receiptId:rep.receiptId}),
  {receiptId:rep.receiptId,accepted:true},'the scheduler accepts on the verified receipt');
 // Consequential results demand independent reproduction.
 const task2=await scheduleComputeTask(pool,{actorUserId:scheduler,workerId,inputClassification:'public',request:small});
 const big=await reportTaskOutput(pool,{taskId:task2.taskId,token:task2.token,inputHash:IN,outputHash:OUT,gpuHours:9,artifactRef:'bafy-2',consequential:true});
 await assert.rejects(verifyTaskReceipt(pool,{actorUserId:verifier,receiptId:big.receiptId,artifactHash:OUT,method:'artifact-hash'}),
  e=>e.message==='consequential_requires_reproduction','a consequential result cannot verify on hash match alone');
 await verifyTaskReceipt(pool,{actorUserId:verifier,receiptId:big.receiptId,artifactHash:OUT,method:'independent-reproduction'});
 assert.equal((await pool.query('SELECT status FROM compute_task_receipts WHERE id=$1',[big.receiptId])).rows[0].status,'verified',
  'independent reproduction verifies the consequential result');
 // Cancellation binds: no late reports, no verifying frozen receipts.
 const task3=await scheduleComputeTask(pool,{actorUserId:scheduler,workerId,inputClassification:'public',request:small});
 const pending=await reportTaskOutput(pool,{taskId:task3.taskId,token:task3.token,inputHash:IN,outputHash:OUT,gpuHours:1,artifactRef:'bafy-3'});
 await assert.rejects(cancelComputeTask(pool,{actorUserId:stranger,taskId:task3.taskId}),
  e=>e.message==='cancel_not_authorized','a stranger cannot cancel someone else\'s task');
 await cancelComputeTask(pool,{actorUserId:scheduler,taskId:task3.taskId});
 await assert.rejects(reportTaskOutput(pool,{taskId:task3.taskId,token:task3.token,inputHash:IN,outputHash:OUT,gpuHours:1,artifactRef:'bafy-4'}),
  e=>e.message==='task_cancelled','a cancelled task refuses further reports');
 await assert.rejects(verifyTaskReceipt(pool,{actorUserId:verifier,receiptId:pending.receiptId,artifactHash:OUT,method:'artifact-hash'}),
  e=>e.message==='receipt_not_unverified','a receipt frozen by cancellation can never verify');
});
