// Run explicitly with TEST_DATABASE_URL (fresh migrated local database) and
// GATEWAY_BILLING_SOURCE (isolated committed gateway modules with dependencies).
// This command refuses missing fixtures rather than skipping or calling production.
// Local composed billing qualification. Authenticated actor metadata is a fixture;
// gateway billing/client, HTTP service authentication, admission, leases and ledger are real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import express from 'express';
import pg from 'pg';
import { createWorkforceResource } from '../src/server/services/workforceResources.js';
import { admitRun } from '../src/server/services/workforceRunAdmission.js';
import { authorizeRunStep } from '../src/server/services/workforceRunAuthority.js';
import { reportRunResult } from '../src/server/services/workforceRunResults.js';
import { createServiceLedgerRouter } from '../src/server/routes/serviceLedgerRoutes.js';
import { addGrant, getBalanceV2 } from '../src/server/utils/creditLedgerV2.js';

const url = process.env.TEST_DATABASE_URL;
test('committed gateway billing composes with canonical run admission, draw settlement and root closure', { timeout: 60000 }, async t => {
  assert(url && ['localhost','127.0.0.1'].includes(new URL(url).hostname) && /^\/xeno_qual_[a-f0-9]{32}$/.test(new URL(url).pathname), 'Disposable local database required');
  assert(process.env.GATEWAY_BILLING_SOURCE && process.env.GATEWAY_BILLING_REPO, 'Explicit committed gateway source and repository required');
  const revision = process.env.GATEWAY_BILLING_COMMIT;
  assert(/^[a-f0-9]{40}$/.test(revision || ''), 'Exact gateway commit required');
  const hashes = {};
  for (const file of ['src/chat-billing.js', 'src/platform-ledger.js', 'src/caller-tokens.js', 'src/dispatch-tracker.js']) {
    const committed = execFileSync('git', ['-C', process.env.GATEWAY_BILLING_REPO, 'cat-file', 'blob', `${revision}:${file}`]);
    const staged = readFileSync(resolve(process.env.GATEWAY_BILLING_SOURCE, file));
    assert.deepEqual(staged, committed, `gateway module differs from declared commit: ${file}`);
    hashes[file] = createHash('sha256').update(staged).digest('hex');
  }
  console.log('Gateway source evidence:', JSON.stringify({ revision, hashes }));
  const fromGateway = path => import(pathToFileURL(resolve(process.env.GATEWAY_BILLING_SOURCE, path)).href);
  const { createPlatformLedger } = await fromGateway('src/platform-ledger.js');
  const { openChatBilling } = await fromGateway('src/chat-billing.js');
  const { installDispatchTracking, runTrackingDispatch } = await fromGateway('src/dispatch-tracker.js');
  const pool = new pg.Pool({ connectionString: url, max: 8 }); t.after(() => pool.end());
  const name = randomUUID();
  const owner = (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'fixture',$1,true) RETURNING id`,[name,`${name}@example.test`])).rows[0].id;
  await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[owner]);
  const ceiling = 100000000;
  await addGrant(pool,owner,{amountMicro:ceiling,kind:'paid',sourceRef:`fixture:${name}`});
  const context = {actorUserId:owner,clientId:'xeno-agent-interface'};
  const made = await createWorkforceResource(pool,context,{operationId:randomUUID(),kind:'agent',name:'Fixture',owner:{type:'user',id:owner},
    definition:{schemaVersion:1,instructions:'Fixture only',skills:[],requestedCapabilities:[]}});
  const admitted = await admitRun(pool,context,{operationId:randomUUID(),expectedActorAccountId:owner,
    agent:{resourceId:made.resource.id,version:made.version.version,contentHash:made.version.contentHash},target:{kind:'personal',ownerUserId:owner},capabilities:[],runtimeCapabilities:[],budget:{ceilingMicro:String(ceiling)}});
  const admissionId = admitted.admission.admissionId;
  assert.equal((await getBalanceV2(pool,owner)).availableMicro,0,'whole wallet is reserved once');
  const keys = generateKeyPairSync('ec',{namedCurve:'P-256'});
  const signingKey={kid:'composed-fixture',privatePem:keys.privateKey.export({type:'pkcs8',format:'pem'})};
  const lease = async()=> (await authorizeRunStep(pool,context,{admissionId,operation:'provider_dispatch'},{signingKey})).token;
  const token = 'fixture-service-'+randomUUID();
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.db=pool;next()});
  app.use('/api/v2/ledger/service',createServiceLedgerRouter({getServiceToken:()=>token}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r))});
  const ledger=createPlatformLedger({baseUrl:`http://127.0.0.1:${server.address().port}`,token,log:{info(){}}});
  const quiet={warn(){},error(){},info(){},log(){}};
  const open=async (dispatchLease, overrides = {})=>{
    const req={requestId:randomUUID(),body:{messages:[{role:'user',content:'Hello'}]},headers:{'x-xeno-run-admission':admissionId,'x-xeno-run-lease':dispatchLease},apiKey:{platformUser:{platformUserId:owner}}};
    const res=new EventEmitter();res.statusCode=200;res.status=s=>{res.statusCode=s;return res};res.json=b=>{res.body=b;return res};res.set=()=>res;
    const session=await openChatBilling({ledger,req,res,operation:'chat.completion',stream:false,model:'claude-opus-5',estInputTokens:10,maxOutputTokens:100,log:quiet,
      schedule:()=>({unref(){}}),heartbeat:{schedule:()=>({unref(){}}),cancel(){}},...overrides});
    return {session,res,id:req.requestId};
  };
  const invalid = await open('invalid-lease-with-sufficient-length');
  assert.equal(invalid.session,null); assert.equal(invalid.res.body.error.code,'lease_invalid');
  const unbounded = await open(await lease(),{maxOutputTokens:0});
  assert.equal(unbounded.session,null); assert.equal(unbounded.res.body.error.code,'run_dispatch_unbounded');
  const unauthenticatedLedger = createPlatformLedger({baseUrl:`http://127.0.0.1:${server.address().port}`,token:'wrong-fixture-token',log:{info(){}}});
  const unauthenticated = await open(await lease(),{ledger:unauthenticatedLedger});
  assert.equal(unauthenticated.session,null,'service authentication failure must prevent draw admission');
  assert.equal((await pool.query('SELECT count(*)::int n FROM credit_hold_draws')).rows[0].n,0,'failed boundary checks create no draw');
  const firstLease=await lease(), first=await open(firstLease);
  assert(first.session,'gateway opens draw from fully reserved wallet');
  const state=async id=>(await pool.query('SELECT * FROM credit_hold_draws WHERE draw_id=$1',[id])).rows[0];
  assert.equal((await state(first.id)).state,'open');
  assert.equal((await pool.query('SELECT count(*)::int n FROM credit_holds WHERE user_id=$1',[owner])).rows[0].n,1,'gateway did not create a second wallet hold');
  const reused=await open(firstLease);
  assert.equal(reused.session,null);assert.equal(reused.res.body.error.code,'lease_consumed','each physical dispatch requires a fresh lease');
  const second=await open(await lease());assert(second.session);
  await second.session.finish();assert.equal((await state(second.id)).state,'voided','proven undispatched request releases its slice only');
  let providerRequests=0;
  const providerApp=express(); providerApp.use(express.json());
  providerApp.post('/v1/chat/completions', async(req,res)=>{
    providerRequests++;
    const reserved=await state(first.id);
    if(reserved?.state!=='open')return res.status(409).json({error:'provider reached without an open draw'});
    if(req.body.max_tokens!==100)return res.status(400).json({error:'output bound changed'});
    res.json({model:'claude-opus-5',choices:[{message:{role:'assistant',content:'Fixture reply'}}],usage:{prompt_tokens:10,completion_tokens:5}});
  });
  const providerServer=providerApp.listen(0,'127.0.0.1');await new Promise(r=>providerServer.once('listening',r));
  t.after(async()=>{providerServer.closeAllConnections();await new Promise(r=>providerServer.close(r))});
  const untrack=installDispatchTracking({ignoreOrigins:[`http://127.0.0.1:${server.address().port}`]});t.after(untrack);
  await runTrackingDispatch(first.session.dispatch,()=>fetch(`http://127.0.0.1:${server.address().port}/api/v2/ledger/service/quote?model=claude-opus-5&estInputTokens=10&maxOutputTokens=100`,
    {headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)}).then(r=>r.json()));
  assert.equal(first.session.dispatch.dispatched,false,'ledger HTTP is not provider dispatch');
  const response=await runTrackingDispatch(first.session.dispatch,()=>fetch(`http://127.0.0.1:${providerServer.address().port}/v1/chat/completions`,
    {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'claude-opus-5',max_tokens:100,messages:[{role:'user',content:'Hello'}]}),signal:AbortSignal.timeout(5000)}));
  assert.equal(response.status,200,'provider observes an already-open draw and unchanged output bound');
  const completion=await response.json();
  assert.equal(providerRequests,1);assert.equal(first.session.dispatch.dispatched,true,'real provider HTTP is tracked');
  const receipt=await first.session.record({model:completion.model,inputTokens:completion.usage.prompt_tokens,outputTokens:completion.usage.completion_tokens,measured:true});
  assert(!receipt.failed,'real HTTP settlement must succeed');
  await first.session.finish();
  const settled=await state(first.id);assert.equal(settled.state,'settled');assert(BigInt(settled.charged_micro)>0n);
  const posted=(await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1',[owner])).rows[0].balance;
  assert.equal(BigInt(posted),BigInt(ceiling)-BigInt(settled.charged_micro),'canonical ledger charged measured usage');
  await reportRunResult(pool,context,{admissionId,outcome:'completed'});
  const hold=(await pool.query('SELECT state FROM credit_holds WHERE user_id=$1 AND hold_id=$2',[owner,admissionId])).rows[0];
  assert.notEqual(hold.state,'held','terminal result closes a resolved root');
  assert.equal(BigInt((await getBalanceV2(pool,owner)).availableMicro),BigInt(posted),'closure returns remaining reservation, not another charge');
});
