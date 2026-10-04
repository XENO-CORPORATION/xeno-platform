// RUN-09 against real PostgreSQL: direct provider TUI sessions that cannot
// enforce pooled-budget admission must not charge a project pool. Personal /
// BYOK operation stays available under its own explicit policy, and
// funded-native parity is advertised only for enforceable adapters.
//
// PROVEN: TUI sessions cannot charge project pools -- with no adapter, an
// unknown adapter or a non-enforceable one, every attempt is refused by
// name; managed sessions through an enforceable adapter charge pools of
// held projects only (foreign pools and unknown pools refused); personal
// charges need explicit BYOK acceptance under either session kind; parity
// claims on non-enforceable adapters are refused by the service and would
// be refused by the schema CHECK too; the parity listing names only
// enforceable adapters.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
import {installBillingProviderFixture} from './fixtures/billing-provider-fixture.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.STRIPE_SECRET_KEY='sk_test_localfixture';process.env.STRIPE_PUBLISHABLE_KEY='pk_test_localfixture';
process.env.STRIPE_EXPECTED_ACCOUNT_ID='acct_fixture';process.env.STRIPE_EXPECTED_MODE='test';
process.env.JWT_SECRET ||= 'publication-milestone-local-fixture';
const fixture=installBillingProviderFixture();
const {handleEvent}=await import('../src/server/services/billingService.js');
const funding=await import('../src/server/services/workforceFunding.js');
const {registerSessionAdapter,claimAdapterParity,listParityAdapters,acceptByokPolicy,admitSessionCharge}=await import('../src/server/services/sessionBudgetAdmission.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('RUN-09: pooled-budget admission gates pool charges; BYOK and parity stay explicit',{skip:!url,timeout:240000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`b9-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),mallory=await user('mallory');
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:alice,customer:'cus_'+mk,
  amount_total:1500,currency:'eur',metadata:{xenoUserId:alice,credits:'15',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'PoolScope'});
 const ctx={actorUserId:alice,clientId:'xeno-agent-interface'};
 const campaign=await funding.createFundingCampaign(pool,ctx,{operationId:randomUUID(),projectId:project.id,beneficiary:'B Org',cancellationTerms:'C.',refundTerms:'R.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx,{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'12000000'});
 await funding.openFundingCampaign(pool,ctx,{campaignId:campaign.id});
 const poolId=(await pool.query('SELECT id FROM workforce_funding_pools WHERE campaign_id=$1 AND milestone_id=$2',[campaign.id,milestone.id])).rows[0].id;
 const foreign=await createAuthorizedProject(pool,{principal:userPrincipal(mallory),name:'Foreign'});
 const mctx={actorUserId:mallory,clientId:'xeno-agent-interface'};
 const mcamp=await funding.createFundingCampaign(pool,mctx,{operationId:randomUUID(),projectId:foreign.id,beneficiary:'F Org',cancellationTerms:'C.',refundTerms:'R.',deliverableLicense:'MIT'});
 const mms=await funding.createFundingMilestone(pool,mctx,{campaignId:mcamp.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'12000000'});
 const foreignPool=(await pool.query('SELECT id FROM workforce_funding_pools WHERE campaign_id=$1 AND milestone_id=$2',[mcamp.id,mms.id])).rows[0].id;
 // Adapters: parity only after enforceability.
 await registerSessionAdapter(pool,{name:'tui-raw',enforceable:false});
 await registerSessionAdapter(pool,{name:'managed-v1',enforceable:true});
 await assert.rejects(claimAdapterParity(pool,{name:'tui-raw'}),
  e=>e.message==='parity_requires_enforceable','parity cannot be claimed before an enforceable adapter exists');
 await assert.rejects(pool.query("UPDATE provider_session_adapters SET parity_claim='funded-native' WHERE name='tui-raw'"),
  e=>/check constraint/i.test(e.message),'the schema CHECK pins the same order past the service');
 await claimAdapterParity(pool,{name:'managed-v1'});
 assert.deepEqual(await listParityAdapters(pool),['managed-v1'],'only enforceable adapters advertise funded-native parity');
 // Project pools: managed + enforceable + held, nothing less.
 await assert.rejects(admitSessionCharge(pool,{actorUserId:alice,sessionKind:'tui-direct',adapterName:'tui-raw',target:'project-pool',poolId,amountMicro:100}),
  e=>e.message==='pool_charge_requires_enforceable_adapter','a direct TUI session must not charge a project pool');
 await assert.rejects(admitSessionCharge(pool,{actorUserId:alice,sessionKind:'managed',target:'project-pool',poolId,amountMicro:100}),
  e=>e.message==='pool_charge_requires_enforceable_adapter','a managed session without an adapter must not charge a pool');
 await assert.rejects(admitSessionCharge(pool,{actorUserId:alice,sessionKind:'managed',adapterName:'tui-raw',target:'project-pool',poolId,amountMicro:100}),
  e=>e.message==='pool_charge_requires_enforceable_adapter','a non-enforceable adapter must not charge a pool');
 await assert.rejects(admitSessionCharge(pool,{actorUserId:alice,sessionKind:'managed',adapterName:'managed-v1',target:'project-pool',poolId:foreignPool,amountMicro:100}),
  e=>e.message==='pool_project_not_held','a pool of an unheld project cannot be charged');
 await assert.rejects(admitSessionCharge(pool,{actorUserId:alice,sessionKind:'managed',adapterName:'managed-v1',target:'project-pool',poolId:randomUUID(),amountMicro:100}),
  e=>e.message==='pool_not_found','an unknown pool cannot be charged');
 const charged=await admitSessionCharge(pool,{actorUserId:alice,sessionKind:'managed',adapterName:'managed-v1',target:'project-pool',poolId,amountMicro:100});
 assert.deepEqual([charged.target,charged.poolId,charged.amountMicro],['project-pool',poolId,100],
  'a managed enforceable session charges a held pool and records the charge');
 // Personal/BYOK: its own explicit policy, either session kind.
 await assert.rejects(admitSessionCharge(pool,{actorUserId:bob,sessionKind:'tui-direct',target:'personal',amountMicro:50}),
  e=>e.message==='byok_policy_required','personal operation without the explicit policy is refused');
 await acceptByokPolicy(pool,{actorUserId:bob});
 const tui=await admitSessionCharge(pool,{actorUserId:bob,sessionKind:'tui-direct',target:'personal',amountMicro:50});
 const man=await admitSessionCharge(pool,{actorUserId:bob,sessionKind:'managed',adapterName:'tui-raw',target:'personal',amountMicro:60});
 assert.deepEqual([[tui.sessionKind,tui.target],[man.sessionKind,man.target]],
  [[ 'tui-direct','personal'],[ 'managed','personal']],'BYOK-accepted personal operation works under both session kinds');
});
