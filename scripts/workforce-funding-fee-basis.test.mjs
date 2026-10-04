// FUND-15 against real PostgreSQL: money moves at exactly its face value unless a
// versioned tariff says otherwise. Contributions and gifts carry no fee; execution
// prices from the published versioned tariff pinned per budget; agent listings pay a
// 15% commission on the net creator-service charge; every transaction stores the fee
// basis and version it settled under; and a metering overrun is XENO's liability --
// recorded, never retro-debited from contributors.
//
// PROVEN: contribution lots total exactly the face amount with the contributor debited
// exactly that (no skim); gift feeMicro is 0 with the recipient credited the full
// amount; the budget stores price_snapshot+version and the settlement row stores the
// price_version it charged under; settling under a different model is refused (the
// pinned tariff is not silently repriced); contributing against tampered terms is
// refused; commissionFor is floor(net*15/100) on an itemized net with compute and tax
// outside the base, 0 for first-party/official; an overrun settle charges exactly the
// held ceiling, books the excess as liability, parks the run reconciliation_required,
// and leaves the donor's personal balance untouched.
// COMMISSION CAVEAT (honest): the arithmetic above is executed, and acquireListing
// passes ONLY price_credits as the commission base (marketplaceService.js:345-346, no
// compute/tax add-on exists on that path). End-to-end acquisition is NOT executed:
// acquireListing inserts into credit_usage, a table no migration creates (documented
// in marketplace-invoke-and-commission.test.mjs:18-23) -- pre-existing tech debt,
// untouched by this citation. marketplace_transactions stores gross/fee/net+feePct.
// SIBLING: that suite proves invoke-debits-nothing and the 15% lock; this file cites
// the contribution/gift/tariff/overrun clauses it explicitly left open.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
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
const {commissionFor,PLATFORM_COMMISSION_PCT}=await import('../src/server/services/marketplaceService.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('FUND-15: contributions and gifts are fee-free; versioned tariff prices execution; 15% net commission; overruns are XENO liability',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`f15-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),donor=await user('donor'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const fund=async who=>{const mk=randomUUID().replaceAll('-','');
  const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:who,customer:'cus_'+mk,
  amount_total:1500,currency:'eur',metadata:{xenoUserId:who,credits:'15',kind:'credits'}};
  await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});};
 await fund(alice);await fund(donor);
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true),($2,true)',[alice,donor]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'FeeBasis'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,alice]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,alice,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,beneficiary:'Delivery',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'10000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id});
 const balance=async who=>BigInt((await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[who])).rows[0].b);

 // ── No fee on contributions: face value in, face value in lots, face value debited.
 const dBefore=await balance(donor);
 const c1=await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'2000000',consentHash:offer.consentHash,confirmed:true});
 const lots=(await pool.query('SELECT COALESCE(sum(amount_micro),0)::text AS t FROM workforce_contribution_lots WHERE contribution_id=$1',[c1.id])).rows[0].t;
 assert.deepEqual([lots,String(dBefore-await balance(donor))],['2000000','2000000'],
  'a contribution moves exactly its face value: lots total it, the debit totals it, nothing is skimmed');
 const cRow=(await pool.query('SELECT c.terms_version AS ct, k.terms_version AS kt FROM workforce_funding_contributions c JOIN workforce_funding_campaigns k ON k.id=c.campaign_id WHERE c.id=$1',[c1.id])).rows[0];
 assert.deepEqual([cRow.ct,cRow.kt],[1,1],'the contribution stores the campaign terms version it settled under');

 // ── No fee on gifts: feeMicro 0, recipient credited the full face value.
 const pv=await gifts.previewGift(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000'});
 assert.equal(pv.feeMicro,'0','the gift preview itemizes no fee');
 await gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000',operationId:randomUUID(),consentHash:pv.consentHash,confirmed:true});
 assert.equal(await balance(bob),1000000n,'the first-receipt recipient is credited the full face value');

 // ── Versioned tariff: pinned per budget, stored per settlement, never silently repriced.
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const budget=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'10000000',perRunMicro:'10000000',purpose:'FeeBasis',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:budget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const bRow=(await pool.query('SELECT price_snapshot,price_version::text AS price_version FROM workforce_funding_budgets WHERE id=$1',[budget.id])).rows[0];
 assert.deepEqual([bRow.price_snapshot.model,bRow.price_version],['claude-opus-5',String(price.priceVersion)],
  'the budget pins the tariff model and version it will charge under');
 const run=await admitRun(pool,ctx(alice),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
 target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:'1000000',fundingBudgetId:budget.id}});
 const settle=async model=>ledger.settleProjectRunV2(pool,{admissionId:run.admission.admissionId,
  eventId:'evt-'+randomUUID().replaceAll('-',''),providerRequestId:'pr-'+randomUUID().replaceAll('-',''),
  provider:'fixture',model,inputTokens:'100',outputTokens:'100',measured:true,allWorkTerminal:true});
 await assert.rejects(settle('claude-haiku-5'),e=>e.code==='CONFLICT'&&e.reason==='MODEL_NOT_APPROVED',
  'settling under a different model than the pinned tariff is refused, not repriced');
 const done=await settle('claude-opus-5');
 const sRow=(await pool.query('SELECT price_version::text AS price_version,priced_micro::text AS priced,charged_micro::text AS charged FROM workforce_funding_settlements WHERE root_admission_id=$1',
  [run.admission.admissionId])).rows[0];
 assert.deepEqual([sRow.price_version,sRow.priced,sRow.charged],[bRow.price_version,done.pricedMicro,done.chargedMicro],
  'the settlement stores the basis and version it charged under, matching the budget pin');
 await assert.rejects(funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'100',consentHash:'f'.repeat(64),confirmed:true}),/funding_terms_changed/,
  'terms the contributor never saw are refused: contracts are not silently repriced');

 // ── 15% on the NET creator-service charge: compute and tax sit outside the base.
 assert.equal(PLATFORM_COMMISSION_PCT,15,'the locked rate is 15');
 const net=1000000,compute=200000,tax=90000;
 const split=commissionFor({developer_id:randomUUID(),trust_tier:'community',is_first_party:false},net);
 assert.deepEqual([split.feePct,split.platformFee,split.creatorNet],[15,150000,850000],
  'floor(net * 15 / 100), charged on the net amount');
 assert.equal(commissionFor({developer_id:randomUUID(),trust_tier:'community',is_first_party:false},999999).platformFee,149999,
  'the floor never rounds up in XENO favour');
 assert.deepEqual([commissionFor({developer_id:randomUUID(),trust_tier:'community',is_first_party:false},net+compute+tax).platformFee,split.platformFee+Math.floor((compute+tax)*15/100)],
  [193500,193500],'sanity: had compute/tax been inside the base, the fee would be higher -- they must stay out');
 assert.equal(commissionFor({developer_id:null,trust_tier:'official',is_first_party:true},net).platformFee,0,
  'first-party and official listings pay no commission');

 // ── XENO-caused overruns are XENO liability: capped at the ceiling, never retro-debited.
 const run2=await admitRun(pool,ctx(alice),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
 target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:'1000000',fundingBudgetId:budget.id}});
 const poolBefore=await balance(p.id);
 const donorBefore=await balance(donor);
 const over=await ledger.settleProjectRunV2(pool,{admissionId:run2.admission.admissionId,
  eventId:'evt-'+randomUUID().replaceAll('-',''),providerRequestId:'pr-'+randomUUID().replaceAll('-',''),
  provider:'fixture',model:'claude-opus-5',inputTokens:'10000000',outputTokens:'10000000',measured:true,allWorkTerminal:true});
 assert.equal(over.chargedMicro,'1000000','the overrun charges exactly the held ceiling, never fresh lots');
 assert.ok(BigInt(over.liabilityMicro)>0n,'the excess is booked as XENO liability');
 const oRow=(await pool.query('SELECT state,liability_micro::text AS liability FROM workforce_funding_settlements WHERE root_admission_id=$1',[run2.admission.admissionId])).rows[0];
 assert.deepEqual([oRow.state,oRow.liability],[ 'reconciliation_required',over.liabilityMicro],
  'the overrun settlement parks for reconciliation with the liability on the books, openly');
 assert.equal(poolBefore-await balance(p.id),1000000n,'the pool pays exactly the ceiling');
 assert.equal(await balance(donor),donorBefore,'the contributor is never retro-debited for the overrun');
});
