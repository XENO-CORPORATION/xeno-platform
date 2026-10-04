// ACCT-01 against real PostgreSQL: the central Platform/account ledger is the sole
// authority for transfers, allocations, reservations and charges. One composed flow
// moves all four through credit_accounts/credit_grants and journals every one to
// credit_transactions; a closed-world schema pin trips if a second spendable balance
// ever appears; and the service routes the private API calls (balance/holds/settle/
// usage) are driven against the REAL ledger to prove they read and settle that same
// ledger -- they expose and route, they do not own a wallet.
//
// PROVEN: exact balance-bearing schema (4 columns, 0 wallet tables; users.credits is
// an INTEGER mirror, incapable of micro precision by type); gift conserves across two
// accounts; allocation earmarks without moving; reservation holds without moving;
// measured usage consumes exactly; system-wide conservation; service /balance matches
// the ledger read; service hold+settle moves the canonical balance and journals;
// service /usage prices server-side and debits; unauthenticated service calls are 401.
// PROXY EVIDENCE (not executable from this repo; inspected 2026-10-04, pinned):
// xeno-api-proxy @ 5ac0830 keeps no independent spendable balance -- server.js spends
// through platformPool (const client = await platformPool.connect(), ~L1400) against
// the platform's credit_accounts/credit_transactions; src/execution/ledger.js is an
// HTTP client to this repo's /v2/ledger/service/* routes; src/execution/schema.sql has
// no balance/wallet tables (xep_settlement_obligations references platform hold_ids);
// scripts/syncPlatformCredits.mjs is retired and hard-disabled (exit 1); BILLING-
// MODERNIZATION.md documents users.credits as a rounded projection of
// credit_accounts.balance. The in-repo half below proves the ledger those reads hit.
// SIBLING: the ledger-pricing suite pins the tariffs; this file cites the authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import express from 'express';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
import {installBillingProviderFixture} from './fixtures/billing-provider-fixture.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.STRIPE_SECRET_KEY='sk_test_localfixture';process.env.STRIPE_PUBLISHABLE_KEY='pk_test_localfixture';
process.env.STRIPE_EXPECTED_ACCOUNT_ID='acct_fixture';process.env.STRIPE_EXPECTED_MODE='test';
process.env.JWT_SECRET ||= 'publication-milestone-local-fixture';
const fixture=installBillingProviderFixture();
const {handleEvent}=await import('../src/server/services/billingService.js');
const gifts=await import('../src/server/services/accountGifts.js');
const funding=await import('../src/server/services/workforceFunding.js');
const {admitRun}=await import('../src/server/services/workforceRunAdmission.js');
const ledger=await import('../src/server/utils/creditLedgerV2.js');
const pricing=await import('../src/server/utils/creditCosts.js');
const {createServiceLedgerRouter}=await import('../src/server/routes/serviceLedgerRoutes.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('ACCT-01: one canonical ledger settles transfers, allocations, reservations and charges; service routes read it',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 // ── Closed world: the exact set of balance-bearing columns. A second wallet table
 // (or a micro-capable mirror) changes this set and trips the pin.
 const balanceCols=(await pool.query(`SELECT table_name||'.'||column_name AS c FROM information_schema.columns
  WHERE table_schema='public' AND data_type IN ('bigint','integer','numeric')
  AND (column_name LIKE '%balance%' OR column_name LIKE '%remaining%' OR column_name LIKE '%wallet%' OR column_name LIKE '%spendable%')
  ORDER BY 1`)).rows.map(r=>r.c);
 assert.deepEqual(balanceCols,['credit_accounts.balance','credit_draw_consumption_lots.remaining_after_micro',
  'credit_grants.remaining_micro','credit_transactions.balance_after'],
  'spendable state lives in exactly these columns: account balances, grant remainders, and two append-only records');
 assert.deepEqual((await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'
  AND (tablename LIKE '%wallet%' OR tablename LIKE '%spendable%' OR tablename LIKE '%mirror%') ORDER BY 1`)).rows,[],
  'no wallet/mirror table exists to hold a second balance');
 assert.equal((await pool.query(`SELECT data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='users' AND column_name='credits'`)).rows[0]?.data_type,'integer',
  'users.credits is an INTEGER mirror: it cannot hold micro precision, so it cannot be authoritative');

 const marker=`a1-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const fund=async who=>{const mk=randomUUID().replaceAll('-','');
  const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:who,customer:'cus_'+mk,
  amount_total:500,currency:'eur',metadata:{xenoUserId:who,credits:'5',kind:'credits'}};
  await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});};
 await fund(alice);
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true),($2,true)',[alice,bob]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'Authority'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,alice]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,alice,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,beneficiary:'Delivery',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'4000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const proposal=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'4000000',perRunMicro:'4000000',purpose:'Authority',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:proposal.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const balance=async who=>BigInt((await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[who])).rows[0].b);

 // ── TRANSFER: a gift conserves across two canonical accounts and journals both legs.
 await funding.contributeFunding(pool,ctx(alice),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'2000000',consentHash:offer.consentHash,confirmed:true});
 const pv=await gifts.previewGift(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000'});
 const g1=await gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000',operationId:randomUUID(),consentHash:pv.consentHash,confirmed:true});
 assert.deepEqual([await balance(alice),await balance(bob)],[2000000n,1000000n],'the gift moves canonical balances, conserved');
 const giftOut=(await pool.query("SELECT amount::bigint AS a FROM credit_transactions WHERE reference_type='xeno.gift' AND reference_id=$1 AND user_id=$2",[g1.giftId,alice])).rows[0].a;
 const giftIn=(await pool.query("SELECT amount::bigint AS a FROM credit_transactions WHERE reference_type='xeno.gift' AND reference_id=$1 AND user_id=$2",[g1.giftId,bob])).rows[0].a;
 assert.deepEqual([BigInt(giftOut),BigInt(giftIn)],[-1000000n,1000000n],'both gift legs journal to the one transaction table');

 // ── ALLOCATION: an admitted run earmarks pool value; no balance moves.
 const request=amount=>({operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
 target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:amount,fundingBudgetId:proposal.id}});
 await admitRun(pool,ctx(alice),request('1000000'));
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM credit_holds WHERE user_id=$1 AND state='held'",[p.id])).rows[0].n,1,
  'allocation earmarks exactly one pool hold');
 assert.deepEqual([await balance(p.id),await balance(alice)],[2000000n,2000000n],'allocation moves no balance');

 // ── RESERVATION: a personal hold reserves without moving.
 await ledger.holdV2(pool,alice,{holdId:'authority-hold',amountMicro:50000,surface:'checkout',operation:'authorize'});
 assert.equal(await balance(alice),2000000n,'reservation moves no balance');
 assert.equal((await pool.query("SELECT state FROM credit_holds WHERE user_id=$1 AND hold_id='authority-hold'",[alice])).rows[0].state,'held',
  'the reservation is a durable canonical hold');

 // ── CHARGE: measured usage consumes exactly and journals with its measurement.
 await ledger.recordUsageV2(pool,alice,{transactionId:randomUUID(),costMicro:500,surface:'chat',operation:'complete',model:'claude-opus-5',provider:'anthropic'});
 assert.equal(await balance(alice),1999500n,'the charge consumes the canonical balance, to the micro');
 const usage=(await pool.query("SELECT actual_cost_micro::bigint AS a,model,provider FROM api_usage_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",[alice])).rows[0];
 assert.deepEqual([BigInt(usage.a),usage.model,usage.provider],[500n,'claude-opus-5','anthropic'],'usage records its measured cost, model and provider');

 // ── Conservation across the whole system: only the charge destroys value.
 assert.equal(await balance(alice)+await balance(bob)+await balance(p.id),5000000n-500n,
  'every micro is accounted for: 5 funded, 500 consumed, the rest conserved');

 // ── The private API's routes, against the REAL ledger: expose and route, never own.
 const TOKEN='authority-service-token';
 const app=express();app.use(express.json());
 app.use((req,_res,next)=>{req.db=pool;next();});
 app.use('/api/v2/ledger/service',createServiceLedgerRouter({ledger,
  getServiceToken:()=>TOKEN,
  ensureQuota:async()=>({metered:true}),getEffectivePlan:async()=>({plan:'pro'}),
  billingSubjectFor:async(_db,userId)=>({userId,actorUserId:userId})}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(()=>{server.closeAllConnections?.();return new Promise(resolve=>server.close(resolve));});
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(method,path,body,token=TOKEN)=>{
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
   body:body?JSON.stringify(body):undefined});
  return {status:r.status,json:await r.json()};};
 const direct=await ledger.getBalanceV2(pool,alice);
 const served=await call('GET',`/api/v2/ledger/service/balance?userId=${alice}`);
 assert.equal(served.status,200,'service balance reads');
 assert.deepEqual([served.json.postedMicro,served.json.availableMicro],[direct.postedMicro,direct.availableMicro],
  'the served balance IS the ledger read, same numbers, same source');
 const held=await call('POST','/api/v2/ledger/service/holds',{userId:alice,holdId:'service-hold-1',operation:'chat.completion',surface:'xeno_api',amountMicro:100000});
 assert.equal(held.status,200,'service hold reserves');
 assert.equal(await balance(alice),1999500n,'the service hold moves no balance');
 const settled=await call('POST','/api/v2/ledger/service/holds/service-hold-1/settle',{userId:alice,actualCostMicro:30000});
 assert.equal(settled.status,200,'service settle debits actual');
 assert.equal(await balance(alice),1999500n-30000n,'the service settle moves the canonical balance');
 const journal=(await pool.query("SELECT amount::bigint AS a FROM credit_transactions WHERE user_id=$1 AND reference_type='xeno.hold' AND reference_id='service-hold-1'",[alice])).rows[0];
 assert.equal(BigInt(journal?.a),-30000n,'the service settle journals to the one transaction table');
 const unitCost=pricing.getChatCostMicro('claude-opus-5',{inputTokens:16,outputTokens:17});
 const oneShot=await call('POST','/api/v2/ledger/service/usage',{userId:bob,transactionId:randomUUID(),surface:'xeno_api',operation:'chat.completion',
  usage:{model:'claude-opus-5',inputTokens:16,outputTokens:17,measured:true}});
 assert.equal(oneShot.status,200,'service one-shot usage debits');
 assert.equal(await balance(bob),1000000n-BigInt(unitCost),'one-shot usage is priced server-side and debited from the canonical balance');
 assert.equal((await call('GET',`/api/v2/ledger/service/balance?userId=${alice}`,undefined,null)).status,401,
  'the service routes are authenticated account operations');
});
