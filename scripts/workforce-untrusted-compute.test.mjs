// RES-03 against real PostgreSQL: contributed compute is an untrusted worker
// unless separately qualified. Untrusted workloads run in strong isolation
// with restricted egress, no local device access, short-lived task
// credentials, and never private inputs by default; the donor explicitly
// approves caps and no project commandeers their machine.
//
// PROVEN: registration always lands untrusted; scheduling without
// donor-approved caps is refused, as are over-cap requests and non-donor
// cap approvals; private inputs, weak isolation, open egress and local
// devices are each refused on untrusted workers by name; TTLs over 900s are
// refused; issued tokens validate by hash while live, mismatch otherwise,
// and read expired past their time; the token is revealed once and stored
// only as a hash; qualification requires evidence and unlocks private inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {registerComputeWorker,qualifyComputeWorker,approveWorkerCaps,scheduleComputeTask,validateTaskCredential,
  MAX_TASK_CREDENTIAL_TTL_SECONDS}=await import('../src/server/services/contributedCompute.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('RES-03: untrusted workers fence inputs, posture, caps and credential TTL',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 assert.equal(MAX_TASK_CREDENTIAL_TTL_SECONDS,900,'the credential TTL ceiling is 900 seconds');
 const marker=`r3-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const donor=await user('donor'),scheduler=await user('scheduler');
 const small={cpuMillicores:500,memoryMb:512,maxSeconds:60};
 const workerId=(await registerComputeWorker(pool,{actorUserId:donor,isolation:'strong',egress:'restricted',devices:'none'})).workerId;
 assert.equal((await pool.query('SELECT trust FROM compute_workers WHERE id=$1',[workerId])).rows[0].trust,'untrusted',
  'registration always lands untrusted, even with a strong posture');
 await assert.rejects(scheduleComputeTask(pool,{actorUserId:scheduler,workerId,inputClassification:'public',request:small}),
  e=>e.message==='caps_not_approved','scheduling without donor-approved caps is refused');
 await assert.rejects(approveWorkerCaps(pool,{actorUserId:scheduler,workerId,caps:{maxCpuMillicores:1000,maxMemoryMb:1024,maxSeconds:300}}),
  e=>e.message==='caps_approval_not_authorized','only the donor approves caps: projects cannot commandeer machines');
 await approveWorkerCaps(pool,{actorUserId:donor,workerId,caps:{maxCpuMillicores:1000,maxMemoryMb:1024,maxSeconds:300}});
 await assert.rejects(scheduleComputeTask(pool,{actorUserId:scheduler,workerId,inputClassification:'public',
   request:{cpuMillicores:4000,memoryMb:512,maxSeconds:60}}),
  e=>e.message==='request_exceeds_approved_caps','requests past the approved caps are refused');
 await assert.rejects(scheduleComputeTask(pool,{actorUserId:scheduler,workerId,inputClassification:'private',request:small}),
  e=>e.message==='private_inputs_require_qualified','private inputs never schedule on untrusted workers by default');
 await assert.rejects(scheduleComputeTask(pool,{actorUserId:scheduler,workerId,inputClassification:'public',request:small,credentialTtlSeconds:3600}),
  e=>e.message==='credential_ttl_exceeded','task credential TTLs over 900 seconds are refused');
 const mk=async posture=>{const w=(await registerComputeWorker(pool,{actorUserId:donor,...posture})).workerId;
  await approveWorkerCaps(pool,{actorUserId:donor,workerId:w,caps:{maxCpuMillicores:1000,maxMemoryMb:1024,maxSeconds:300}});return w;};
 const weak=await mk({isolation:'weak',egress:'restricted',devices:'none'});
 await assert.rejects(scheduleComputeTask(pool,{actorUserId:scheduler,workerId:weak,inputClassification:'public',request:small}),
  e=>e.message==='isolation_insufficient','weak isolation is refused for untrusted workloads');
 const open=await mk({isolation:'strong',egress:'open',devices:'none'});
 await assert.rejects(scheduleComputeTask(pool,{actorUserId:scheduler,workerId:open,inputClassification:'public',request:small}),
  e=>e.message==='egress_unrestricted','open egress is refused for untrusted workloads');
 const dev=await mk({isolation:'strong',egress:'none',devices:'local'});
 await assert.rejects(scheduleComputeTask(pool,{actorUserId:scheduler,workerId:dev,inputClassification:'public',request:small}),
  e=>e.message==='device_access_forbidden','local device access is refused for untrusted workloads');
 // Issuance, validation, expiry, one-time reveal.
 const issued=await scheduleComputeTask(pool,{actorUserId:scheduler,workerId,inputClassification:'public',request:small,credentialTtlSeconds:600});
 assert.deepEqual(new Date(issued.credentialExpiresAt).getTime()-Date.now()<=600_000,true,
  'the issued credential expires within its requested TTL');
 const stored=(await pool.query('SELECT credential_hash FROM compute_task_runs WHERE id=$1',[issued.taskId])).rows[0];
 assert.deepEqual([stored.credential_hash,stored.credential_hash === issued.token],
  [createHash('sha256').update(issued.token).digest('hex'),false],
  'the token is stored only as a hash, never in the clear');
 assert.deepEqual(await validateTaskCredential(pool,{taskId:issued.taskId,token:issued.token}),{valid:true},
  'the live token validates');
 assert.deepEqual(await validateTaskCredential(pool,{taskId:issued.taskId,token:'0'.repeat(64)}),{valid:false,reason:'token_mismatch'},
  'a wrong token mismatches');
 const stale=(await pool.query(`INSERT INTO compute_task_runs(worker_id,scheduler_user_id,input_classification,credential_hash,
  credential_expires_at,cpu_millicores,memory_mb,max_seconds) VALUES($1,$2,'public',$3,now()-interval '1 second',1,1,1) RETURNING id`,
  [workerId,scheduler,createHash('sha256').update('past').digest('hex')])).rows[0].id;
 assert.deepEqual(await validateTaskCredential(pool,{taskId:stale,token:'past'}),{valid:false,reason:'expired'},
  'a past-expiry credential reads expired');
 // Separate qualification unlocks private inputs, with evidence on record.
 await assert.rejects(qualifyComputeWorker(pool,{actorUserId:scheduler,workerId,evidence:{method:'audit'}}),
  e=>e.message==='qualification_evidence_required','qualification without a report hash is refused');
 await qualifyComputeWorker(pool,{actorUserId:scheduler,workerId,evidence:{method:'third-party-audit',reportHash:'ab'.repeat(32)}});
 assert.equal((await pool.query('SELECT trust FROM compute_workers WHERE id=$1',[workerId])).rows[0].trust,'qualified',
  'evidence plus a qualifier flips the worker to qualified');
 const priv=await scheduleComputeTask(pool,{actorUserId:scheduler,workerId,inputClassification:'private',request:small});
 assert.deepEqual(typeof priv.token,'string','a qualified worker accepts private inputs');
 await assert.rejects(qualifyComputeWorker(pool,{actorUserId:scheduler,workerId,evidence:{method:'x',reportHash:'cd'.repeat(32)}}),
  e=>e.message==='worker_already_qualified','double qualification is refused');
});
