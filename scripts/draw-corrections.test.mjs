import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import express from 'express';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';
import { createWorkforceResource } from '../src/server/services/workforceResources.js';
import { admitRun } from '../src/server/services/workforceRunAdmission.js';
import { authorizeRunStep } from '../src/server/services/workforceRunAuthority.js';
import { reportRunResult } from '../src/server/services/workforceRunResults.js';
import * as ledger from '../src/server/utils/creditLedgerV2.js';
import * as funding from '../src/server/services/workforceFunding.js';
import { installBillingProviderFixture } from './fixtures/billing-provider-fixture.mjs';
process.env.STRIPE_SECRET_KEY='sk_test_localfixture'; process.env.STRIPE_PUBLISHABLE_KEY='pk_test_localfixture';
process.env.STRIPE_EXPECTED_ACCOUNT_ID='acct_fixture'; process.env.STRIPE_EXPECTED_MODE='test';
const billingFixture=installBillingProviderFixture();
const { handleEvent }=await import('../src/server/services/billingService.js');
const { createAuthorizedProject, userPrincipal }=await import('../src/server/services/chatProjectAuthority.js');
const { createServiceLedgerRouter }=await import('../src/server/routes/serviceLedgerRoutes.js');
const url = process.env.TEST_DATABASE_URL;
test('late provider corrections restore exact eligible lots or retain liability without rewriting settlement', { skip: !url, timeout: 60000 }, async t => {
  const pool = new pg.Pool({ connectionString: requireProofDatabase(url), max: 8 }); t.after(() => pool.end());
  const [up, down] = (await readFile(new URL('../src/server/database/migrations/20261001110000-credit-draw-corrections.sql', import.meta.url), 'utf8')).split('-- DOWN');
  await pool.query(down); await pool.query(up);
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signingKey = { kid: 'correction-fixture', privatePem: key.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const fixture = async ({ expired = false } = {}) => {
    const mark = randomUUID();
    const owner = (await pool.query("INSERT INTO users(username,email,password_hash,display_name) VALUES($1,$2,'fixture',$1) RETURNING id", [mark, `${mark}@example.test`])).rows[0].id;
    await pool.query("INSERT INTO xeno_account_plans(user_id,plan,status) VALUES($1,'internal','active')", [owner]);
    await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)', [owner]);
    await ledger.addGrant(pool,owner,{amountMicro:10000,kind:'paid',priority:10,sourceRef:`correction-first:${mark}`});
    await ledger.addGrant(pool,owner,{amountMicro:90000,kind:'paid',priority:20,sourceRef:`correction-second:${mark}`});
    const ctx={actorUserId:owner,clientId:'xeno-agent-interface'};
    const resource=await createWorkforceResource(pool,ctx,{operationId:randomUUID(),kind:'agent',name:'Correction fixture',owner:{type:'user',id:owner},definition:{schemaVersion:1,instructions:'Fixture',skills:[],requestedCapabilities:[]}});
    const admissionId=(await admitRun(pool,ctx,{operationId:randomUUID(),agent:{resourceId:resource.resource.id,version:resource.version.version,contentHash:resource.version.contentHash},target:{kind:'personal',ownerUserId:owner},capabilities:[],budget:{ceilingMicro:'100000'}})).admission.admissionId;
    const lease=(await authorizeRunStep(pool,ctx,{admissionId,operation:'provider_dispatch'},{signingKey})).token;
    const drawId=`correction-${randomUUID()}`;
    await ledger.openRunDrawV2(pool,{admissionId,actorUserId:owner,drawId,lease,model:'claude-opus-5',inputBound:10,outputBound:10});
    const settlement={admissionId,drawId,providerRequestId:`upstream-${mark}`,provider:'fixture',model:'claude-opus-5',measured:false};
    if(expired)await pool.query("UPDATE credit_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[owner]);
    await ledger.settleRunDrawV2(pool,settlement);
    const draw=(await pool.query('SELECT * FROM credit_hold_draws WHERE draw_id=$1',[drawId])).rows[0];
    const proof={verified:true,correctionSourceId:`receipt-${randomUUID()}`,providerReceiptId:`provider-receipt-${randomUUID()}`,provider:'fixture',providerRequestId:settlement.providerRequestId,model:settlement.model,actorService:'fixture-provider-verifier',evidenceHash:'a'.repeat(64),inputTokens:5,outputTokens:5};
    return {owner,ctx,admissionId,drawId,draw,proof,settlement,resource,target:{admissionId,drawId}};
  };
  const balance=async owner=>(await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1',[owner])).rows[0].balance;
  const f=await fixture();
  await assert.rejects(ledger.correctRunDrawV2(pool,f.target,f.proof),{code:'RUN_NOT_TERMINAL'},'correction cannot reopen a live envelope');
  await reportRunResult(pool,f.ctx,{admissionId:f.admissionId,outcome:'completed',summary:'Fixture done',artifacts:[]});
  // Every admission reported, but a sibling dispatch is still in flight: the reservation stays held,
  // and only the hold/open-draw check can refuse here (the tree-liveness check already passes).
  const busy=await fixture();
  const busyLease=(await authorizeRunStep(pool,busy.ctx,{admissionId:busy.admissionId,operation:'provider_dispatch'},{signingKey})).token;
  const inflight=`inflight-${randomUUID()}`;
  await ledger.openRunDrawV2(pool,{admissionId:busy.admissionId,actorUserId:busy.owner,drawId:inflight,lease:busyLease,model:'claude-opus-5',inputBound:10,outputBound:10});
  await reportRunResult(pool,busy.ctx,{admissionId:busy.admissionId,outcome:'completed',summary:'reported while a dispatch is in flight',artifacts:[]});
  await assert.rejects(ledger.correctRunDrawV2(pool,busy.target,busy.proof),{code:'RUN_NOT_TERMINAL'},'an in-flight sibling dispatch keeps the reservation uncorrectable');
  // The root closed its reservation explicitly while a child admission has not reported: only the
  // tree-liveness check refuses here (the hold is no longer held and no draw is open).
  const tree=await fixture();
  const child=await admitRun(pool,tree.ctx,{operationId:randomUUID(),agent:{resourceId:tree.resource.resource.id,version:tree.resource.version.version,contentHash:tree.resource.version.contentHash},target:{kind:'personal',ownerUserId:tree.owner},capabilities:[],budget:{ceilingMicro:'10000'},parent:{admissionId:tree.admissionId}});
  await ledger.closeRunReservationV2(pool,{admissionId:tree.admissionId});
  await assert.rejects(ledger.correctRunDrawV2(pool,tree.target,tree.proof),{code:'RUN_NOT_TERMINAL'},'an unreported child keeps the run uncorrectable after an explicit close');
  await reportRunResult(pool,tree.ctx,{admissionId:child.admission.admissionId,outcome:'completed',summary:'child done',artifacts:[]});
  await reportRunResult(pool,tree.ctx,{admissionId:tree.admissionId,outcome:'completed',summary:'root done',artifacts:[]});
  assert.equal((await ledger.correctRunDrawV2(pool,tree.target,tree.proof)).restoredMicro,'20000','a fully reported tree is correctable');
  await ledger.voidRunDrawV2(pool,{admissionId:busy.admissionId,drawId:inflight,notDispatched:true});
  assert.equal((await ledger.correctRunDrawV2(pool,busy.target,busy.proof)).restoredMicro,'20000','once the reservation closes the correction applies');
  await assert.rejects(ledger.correctRunDrawV2(pool,f.target,{...f.proof,verified:false}),{code:'PROVIDER_RECEIPT_REQUIRED'});
  await assert.rejects(ledger.correctRunDrawV2(pool,f.target,{...f.proof,providerRequestId:'foreign'}),{code:'RECEIPT_IDENTITY_MISMATCH'});
  await assert.rejects(ledger.correctRunDrawV2(pool,f.target,{...f.proof,inputTokens:11,outputTokens:11}),{code:'CORRECTION_NOT_DOWNWARD'});
  const original=JSON.stringify(f.draw);
  const refuseSql = async (work, message) => {
    const db=await pool.connect();
    try { await db.query('BEGIN'); await assert.rejects(async()=>{await work(db);await db.query('COMMIT');},{code:'23514'},message); }
    finally { await db.query('ROLLBACK'); db.release(); }
  };
  const rawCorrection = (db, priced='20000', previous='40000') => db.query(`INSERT INTO credit_draw_corrections
    (draw_row_id,correction_source_id,provider_receipt_id,provider,provider_request_id,model,input_tokens,output_tokens,
      evidence_hash,request_hash,original_charged_micro,previous_net_micro,corrected_priced_micro,correction_micro,restored_micro,liability_micro,actor_service)
    VALUES($1,$2,$3,'fixture',$4,$5,5,5,$6,$6,40000,$7,$8,$7::bigint-$8::bigint,0,$7::bigint-$8::bigint,'fixture-db') RETURNING id`,
    [f.draw.id,`sql-${randomUUID()}`,`receipt-${randomUUID()}`,f.settlement.providerRequestId,f.settlement.model,'b'.repeat(64),previous,priced]);
  // Complete, in-cap allocations, so ONLY the tariff binding can refuse this row.
  const consumedLots=(await pool.query('SELECT grant_id,consumed_micro FROM credit_draw_consumption_lots WHERE draw_row_id=$1 ORDER BY consumption_order DESC',[f.draw.id])).rows;
  await refuseSql(async db=>{
    const r=await rawCorrection(db,'1');let left=39999n,order=0;
    for(const lot of consumedLots){const take=BigInt(lot.consumed_micro)<left?BigInt(lot.consumed_micro):left;if(take===0n)break;
      await db.query(`INSERT INTO credit_draw_correction_lots(correction_id,draw_row_id,grant_id,correction_order,amount_micro,outcome,reason)
        VALUES($1,$2,$3,$4,$5,'liability','frozen')`,[r.rows[0].id,f.draw.id,lot.grant_id,order++,take.toString()]);left-=take;}
  },'database binds correction price to retained tariff and measured tokens');
  await refuseSql(db=>rawCorrection(db,'20000','50000'),'database rejects invented prior net charge');
  await refuseSql(db=>rawCorrection(db),'database rejects correction without complete reversing allocations');
  await refuseSql(async db=>{
    const r=await rawCorrection(db);
    const lot=(await db.query('SELECT grant_id FROM credit_draw_consumption_lots WHERE draw_row_id=$1 ORDER BY consumption_order LIMIT 1',[f.draw.id])).rows[0];
    await db.query(`INSERT INTO credit_draw_correction_lots(correction_id,draw_row_id,grant_id,correction_order,amount_micro,outcome,reason)
      VALUES($1,$2,$3,0,20000,'liability','frozen')`,[r.rows[0].id,f.draw.id,lot.grant_id]);
  },'database caps each reversing lot at its original consumption');
  const results=await Promise.all([ledger.correctRunDrawV2(pool,f.target,f.proof),ledger.correctRunDrawV2(pool,f.target,f.proof)]);
  assert.equal(results.filter(r=>r.replayed).length,1,'same source concurrently corrects once');
  const result=results.find(r=>!r.replayed);
  assert.deepEqual([result.correctionMicro,result.restoredMicro,result.liabilityMicro],['20000','20000','0'],'pinned measured price returns only the overcharge');
  assert.equal(await balance(f.owner),'80000');
  const lots=(await pool.query('SELECT kind,priority,remaining_micro FROM credit_grants WHERE user_id=$1 ORDER BY priority',[f.owner])).rows;
  assert.deepEqual(lots.map(x=>[x.kind,x.priority,x.remaining_micro]),[['paid',10,'0'],['paid',20,'80000']],'correction unwinds exact consumed tail without minting a grant');
  await assert.rejects(ledger.correctRunDrawV2(pool,f.target,{...f.proof,inputTokens:4}),{code:'CONFLICT'},'changed source payload cannot mutate correction');
  const next={...f.proof,correctionSourceId:`receipt-${randomUUID()}`,providerReceiptId:`provider-receipt-${randomUUID()}`,inputTokens:0,outputTokens:0};
  const last=await ledger.correctRunDrawV2(pool,f.target,next);
  assert.equal(last.correctionMicro,'20000','successive receipts correct only remaining net charge');
  assert.equal(await balance(f.owner),'100000','cumulative restoration never exceeds original charge');
  assert.equal(JSON.stringify((await pool.query('SELECT * FROM credit_hold_draws WHERE id=$1',[f.draw.id])).rows[0]),original,'settled evidence stays byte identical');
  assert.equal((await ledger.settleRunDrawV2(pool,f.settlement)).replayed,true,'old settlement replay does not undo correction');
  assert.equal((await ledger.verifyChainV2(pool,f.owner)).ok,true);
  const view=await ledger.readRunDrawCorrectionsV2(pool,{...f.target,payerUserId:f.owner});
  assert.deepEqual([view.grossChargedMicro,view.correctionMicro,view.netChargedMicro,view.restoredMicro,view.walletDebitedMicro],['40000','40000','0','40000','0'],'read projection separates historical charge and correction');
  await assert.rejects(ledger.readRunDrawCorrectionsV2(pool,{...f.target,payerUserId:randomUUID()}),{code:'NOT_FOUND'},'financial projection does not reveal another payer');
  for(const sql of ['UPDATE credit_draw_corrections SET correction_micro=correction_micro','DELETE FROM credit_draw_corrections','TRUNCATE credit_draw_correction_lots','UPDATE credit_draw_correction_lots SET amount_micro=amount_micro'])await assert.rejects(pool.query(sql),{code:'23514'},'correction evidence is retained');
  await assert.rejects(pool.query(down),{code:'23514'});

  const frozen=await fixture();await reportRunResult(pool,frozen.ctx,{admissionId:frozen.admissionId,outcome:'completed',summary:'done',artifacts:[]});
  await pool.query('UPDATE credit_accounts SET is_frozen=true WHERE user_id=$1',[frozen.owner]);
  const frozenResult=await ledger.correctRunDrawV2(pool,frozen.target,frozen.proof);
  assert.deepEqual([frozenResult.restoredMicro,frozenResult.liabilityMicro],['0','20000'],'frozen value becomes explicit liability not spendable funds');
  assert.equal(await balance(frozen.owner),'60000');

  const frozenView=await ledger.readRunDrawCorrectionsV2(pool,{...frozen.target,payerUserId:frozen.owner});
  assert.deepEqual([frozenView.netChargedMicro,frozenView.walletDebitedMicro,frozenView.liabilityMicro],['20000','40000','20000'],'liability is not presented as credited wallet value');
  const expired=await fixture({expired:true});await reportRunResult(pool,expired.ctx,{admissionId:expired.admissionId,outcome:'completed',summary:'done',artifacts:[]});
  const expiredResult=await ledger.correctRunDrawV2(pool,expired.target,expired.proof);
  assert.deepEqual([expiredResult.restoredMicro,expiredResult.liabilityMicro],['0','20000'],'expired original value is not revived into spendable balance');
  assert.equal(await balance(expired.owner),'60000');
  const fail=await fixture();await reportRunResult(pool,fail.ctx,{admissionId:fail.admissionId,outcome:'completed',summary:'done',artifacts:[]});
  await pool.query(`CREATE FUNCTION reject_correction_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture correction insert failed'; END $$;
    CREATE TRIGGER reject_correction_fixture BEFORE INSERT ON credit_draw_corrections FOR EACH ROW EXECUTE FUNCTION reject_correction_fixture()`);
  try{await assert.rejects(ledger.correctRunDrawV2(pool,fail.target,fail.proof),/fixture correction insert failed/)}finally{await pool.query('DROP TRIGGER reject_correction_fixture ON credit_draw_corrections; DROP FUNCTION reject_correction_fixture()')}
  assert.equal(await balance(fail.owner),'60000','late evidence failure rolls back restored wallet');
  assert.equal((await pool.query('SELECT sum(remaining_micro)::text AS total FROM credit_grants WHERE user_id=$1',[fail.owner])).rows[0].total,'60000','late failure rolls back restored lots');

  // Simulate passage of settlement time only in this disposable database. Restore the guard before calls.
  await pool.query('ALTER TABLE credit_hold_draws DISABLE TRIGGER credit_hold_draws_guard');
  try{await pool.query("UPDATE credit_hold_draws SET resolved_at=clock_timestamp()-interval '73 hours' WHERE id=$1",[fail.draw.id]);}
  finally{await pool.query('ALTER TABLE credit_hold_draws ENABLE TRIGGER credit_hold_draws_guard');}
  await assert.rejects(ledger.correctRunDrawV2(pool,fail.target,fail.proof),{code:'CORRECTION_WINDOW_EXPIRED'},'late receipt outside72h cannot move funds');

  // Real paid contribution -> independently approved budget -> admitted draw -> return/quarantine.
  for(const mode of ['eligible','returned','quarantined']) {
    const personal=await fixture();
    await reportRunResult(pool,personal.ctx,{admissionId:personal.admissionId,outcome:'completed',summary:'setup complete',artifacts:[]});
    const makeUser=async()=>{const id=randomUUID();return(await pool.query("INSERT INTO users(username,email,password_hash,display_name) VALUES($1,$2,'fixture',$1) RETURNING id",[id,`${id}@example.test`])).rows[0].id;};
    const approver=await makeUser(),contributor=await makeUser(),owner=personal.owner;
    const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
    const project=await createAuthorizedProject(pool,{principal:userPrincipal(owner),name:`Correction ${mode}`});
    await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'owner','user',$2)",[project.id,approver]);
    const campaign=await funding.createFundingCampaign(pool,ctx(owner),{operationId:randomUUID(),projectId:project.id,beneficiary:'Fixture',cancellationTerms:'Unused returned',refundTerms:'Original expiry',deliverableLicense:'MIT'});
    const milestone=await funding.createFundingMilestone(pool,ctx(owner),{campaignId:campaign.id,key:'delivery',title:'Delivery',criteria:['Reviewed'],thresholdMicro:'100000',budgetMaxMicro:'1000000'});
    await funding.openFundingCampaign(pool,ctx(owner),{campaignId:campaign.id});
    const mark=randomUUID().replaceAll('-','');
    const payment={id:`cs_${mark}`,mode:'payment',payment_status:'paid',payment_intent:`pi_${mark}`,client_reference_id:contributor,customer:`cus_${mark}`,amount_total:500,currency:'eur',metadata:{xenoUserId:contributor,credits:'5',kind:'credits'}};
    await handleEvent(pool,billingFixture.event(`evt_${mark}`,'checkout.session.completed',payment),{provider:billingFixture.provider});
    await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[contributor]);
    const offer=await funding.readFundingOffer(pool,ctx(contributor),{campaignId:campaign.id,milestoneId:milestone.id});
    const contribution=await funding.contributeFunding(pool,ctx(contributor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'1000000',consentHash:offer.consentHash,confirmed:true});
    const poolRow=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
    const price=await funding.readFundingPrice(pool,ctx(owner),{poolId:poolRow.id,model:'claude-opus-5'});
    const budget=await funding.proposeFundingBudget(pool,ctx(owner),{operationId:randomUUID(),poolId:poolRow.id,spenderUserId:owner,maximumMicro:'1000000',perRunMicro:'100000',purpose:'Fixture',termsHash:offer.consentHash,...price});
    await funding.decideFundingBudget(pool,ctx(approver),{budgetId:budget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
    const resource=await createWorkforceResource(pool,ctx(owner),{operationId:randomUUID(),kind:'agent',name:'Pool fixture',owner:{type:'user',id:owner},definition:{schemaVersion:1,instructions:'Fixture',skills:[],requestedCapabilities:[]}});
    const participation=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
      VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker','{"schemaVersion":1,"mode":"explicit","capabilities":[]}') RETURNING id`,[resource.resource.id,project.id,owner])).rows[0].id;
    const admissionId=(await admitRun(pool,ctx(owner),{operationId:randomUUID(),agent:{resourceId:resource.resource.id,version:resource.version.version,contentHash:resource.version.contentHash},target:{kind:'project',projectId:project.id,participationId:participation},capabilities:[],budget:{ceilingMicro:'100000',fundingBudgetId:budget.id}})).admission.admissionId;
    const lease=(await authorizeRunStep(pool,ctx(owner),{admissionId,operation:'provider_dispatch'},{signingKey})).token,drawId=`pool-${randomUUID()}`;
    await ledger.openRunDrawV2(pool,{admissionId,actorUserId:owner,drawId,lease,model:price.model,inputBound:10,outputBound:10});
    await ledger.settleRunDrawV2(pool,{admissionId,drawId,providerRequestId:mark,provider:'fixture',model:price.model,measured:false});
    await reportRunResult(pool,ctx(owner),{admissionId,outcome:'completed',summary:'done',artifacts:[]});
    if(mode==='returned')await funding.returnFundingContribution(pool,ctx(contributor),{contributionId:contribution.id});
    if(mode==='quarantined')await handleEvent(pool,billingFixture.event(`evt_dispute_${mark}`,'charge.dispute.funds_withdrawn',{payment_intent:payment.payment_intent,amount:500}),{provider:billingFixture.provider});
    const beforePool=await balance(poolRow.id),beforeDonor=await balance(contributor);
    const corrected=await ledger.correctRunDrawV2(pool,{admissionId,drawId},{...personal.proof,correctionSourceId:`receipt-${mark}`,providerReceiptId:`receipt-${mark}`,providerRequestId:mark});
    const reasons=(await pool.query('SELECT DISTINCT reason FROM credit_draw_correction_lots WHERE correction_id=$1',[corrected.correctionId])).rows.map(r=>r.reason);
    assert.deepEqual(reasons,[mode==='eligible'?'eligible':mode],`${mode} correction records why value was or was not restored`);
    assert.deepEqual([corrected.restoredMicro,corrected.liabilityMicro],mode==='eligible'?['20000','0']:['0','20000'],`${mode} pool restores only eligible contribution value`);
    assert.equal(await balance(contributor),beforeDonor,'correction never re-credits an already returned contributor');
    assert.equal(BigInt(await balance(poolRow.id))-BigInt(beforePool),mode==='eligible'?20000n:0n);
    const report=await funding.readContributorFunding(pool,ctx(contributor),{contributionId:contribution.id});
    assert.deepEqual(report.corrections,{grossConsumedMicro:'40000',correctedMicro:'20000',netConsumedMicro:'20000',restoredMicro:corrected.restoredMicro,liabilityMicro:corrected.liabilityMicro},'contributor report distinguishes corrected consumption and pending liability');
    assert.equal((await ledger.verifyChainV2(pool,poolRow.id)).ok,true);
  }

  const http=express();http.use(express.json());http.use((req,_res,next)=>{req.db=pool;next()});
  http.use('/closed',createServiceLedgerRouter({getServiceToken:()=> 'fixture-service'}));
  // Verifier fixture returns known evidence only; arbitrary request-authored counts are never copied.
  let verifications=0;
  http.use('/verified',createServiceLedgerRouter({getServiceToken:()=> 'fixture-service',verifyCorrectionReceipt:async({evidence})=>{verifications++;return evidence?.receipt==='known-fixture'?f.proof:null;}}));
  const server=http.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r))});
  // node:http, not global fetch. On Node 24.13.1 (win32), process.exit() that runs while undici's fetch
  // sockets are still closing aborts libuv (src/win/async.c, UV_HANDLE_CLOSING). --test-force-exit does that
  // when this test returns; node:http does not. Remove this helper once the runtime no longer aborts.
  const post=(prefix,body,token='fixture-service')=>new Promise((resolve,reject)=>{
    const payload=JSON.stringify(body);
    const req=httpRequest({host:'127.0.0.1',port:server.address().port,method:'POST',path:`/${prefix}/runs/${f.admissionId}/draws/${f.drawId}/corrections`,headers:{'content-type':'application/json','content-length':Buffer.byteLength(payload),authorization:`Bearer ${token}`}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});
      res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(text)}));
    });
    req.on('error',reject);req.end(payload);
  });
  assert.equal((await post('verified',{receipt:'known-fixture'},'wrong')).status,401);assert.equal(verifications,0);
  assert.equal((await post('closed',f.proof)).status,503,'service credential alone cannot certify a provider receipt');
  assert.equal((await post('verified',{...f.proof})).status,403,'caller counts are not a verified receipt');
  const replay=await post('verified',{receipt:'known-fixture'});assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
});
