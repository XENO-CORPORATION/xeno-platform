// FUND-03 against real PostgreSQL: the contributor confirms amount,
// project/milestone restrictions and terms version -- and the contribution
// grants no membership, code ownership, investment right or automatic model
// choice. Beneficiary, cancellation/refund terms and deliverable license are
// visible BEFORE confirmation.
//
// PROVEN: readFundingOffer (readable by a non-member) exposes the exact
// beneficiary, cancellation terms, refund terms, deliverable license, terms
// version and milestone restrictions; contribute without confirmed:true is
// refused as explicit_confirmation_required; a wrong consentHash is refused
// as funding_terms_changed; the confirmed row pins amount_micro, terms_version
// and a restriction snapshot byte-equal to the offered terms; after paying,
// the donor holds zero project relationship tuples, cannot propose a budget
// (the model-choice instrument) and the contribution receipt carries no
// membership/ownership/model fields.
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
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('FUND-03: confirmation binds amount+restrictions+terms; contribution grants no rights; terms visible first',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`f3-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),donor=await user('donor'),planner=await user('planner');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:donor,customer:'cus_'+mk,
  amount_total:1500,currency:'eur',metadata:{xenoUserId:donor,credits:'15',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[donor]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'ConfirmCase'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'editor','user',$2)`,[project.id,planner]);
 const TERMS={beneficiary:'Acme Delivery Org, Reg. 12345',cancellationTerms:'Cancel anytime before dispatch; unspent value returns to origin.',refundTerms:'Unspent eligible value returns minus no invented fees; consumed spend is final.',deliverableLicense:'Apache-2.0'};
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,...TERMS});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m1',title:'Milestone One',criteria:['Evidence attached','Reviewer accepts'],thresholdMicro:'1000000',budgetMaxMicro:'10000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});

 // ── The outsider sees the full terms BEFORE confirming anything.
 const offer=await funding.readFundingOffer(pool,ctx(donor),{campaignId:campaign.id,milestoneId:milestone.id});
 assert.deepEqual({beneficiary:offer.terms.beneficiary,cancellationTerms:offer.terms.cancellationTerms,refundTerms:offer.terms.refundTerms,deliverableLicense:offer.terms.deliverableLicense,version:offer.terms.version},
  {...TERMS,version:1},'beneficiary, cancellation/refund terms, license and terms version are visible pre-confirmation');
 assert.deepEqual({thresholdMicro:offer.milestone.thresholdMicro,budgetMaxMicro:offer.milestone.budgetMaxMicro,acceptanceCriteria:offer.milestone.acceptanceCriteria},
  {thresholdMicro:'1000000',budgetMaxMicro:'10000000',acceptanceCriteria:{items:['Evidence attached','Reviewer accepts']}},'milestone restrictions are visible pre-confirmation');
 assert.deepEqual([offer.campaignId,offer.projectId],[campaign.id,project.id],'the offer names the exact campaign and project');
 assert.match(offer.consentHash,/^[a-f0-9]{64}$/,'the offer carries a canonical 64-hex consent hash');

 // ── Confirmation is explicit and bound: no silent or drifted acceptance.
 await assert.rejects(funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'2000000',consentHash:offer.consentHash,confirmed:false}),e=>e.code==='bad_input'&&e.details?.reason==='explicit_confirmation_required',
  'an unconfirmed contribution is refused: confirmation is an explicit act');
 const tampered=offer.consentHash.slice(0,63)+(offer.consentHash[63]==='0'?'1':'0');
 await assert.rejects(funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'2000000',consentHash:tampered,confirmed:true}),e=>e.code==='conflict'&&e.details?.reason==='funding_terms_changed',
  'a consent hash that does not match the live terms is refused: drifted terms cannot be confirmed');

 // ── The confirmed row pins amount, terms version and the restriction snapshot.
 const c1=await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'2000000',consentHash:offer.consentHash,confirmed:true});
 assert.equal(c1.state,'confirmed','honest confirmation confirms');
 const row=(await pool.query('SELECT amount_micro::text AS a,terms_version,restriction FROM workforce_funding_contributions WHERE id=$1',[c1.id])).rows[0];
 assert.deepEqual([row.a,row.terms_version],[ '2000000',1],'the row pins the confirmed amount and terms version');
 assert.deepEqual(row.restriction,{campaignId:campaign.id,projectId:project.id,terms:{...TERMS,version:1},
  milestone:{id:milestone.id,key:'m1',title:'Milestone One',acceptanceCriteria:{items:['Evidence attached','Reviewer accepts']},thresholdMicro:'1000000',budgetMaxMicro:'10000000',termsVersion:1}},
  'the restriction snapshot is byte-equal to the confirmed offer: amount+restrictions+terms bound together');

 // ── Paying buys no rights: no membership, no ownership, no model choice.
 const tuples=(await pool.query(`SELECT count(*)::int AS n FROM relationship_tuples
  WHERE object_type='project' AND object_id=$1 AND subject_type='user' AND subject_id=$2`,[project.id,donor])).rows[0].n;
 assert.equal(tuples,0,'the contributor holds zero project relationship tuples: no membership was granted');
 const receiptKeys=Object.keys(c1).sort();
 for(const banned of ['membership','role','ownership','codeOwnership','investmentRight','model','modelChoice','capabilities'])
  assert.ok(!receiptKeys.includes(banned),`the contribution receipt carries no ${banned} field`);
 const poolId=(await pool.query('SELECT id FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0].id;
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId,model:'claude-opus-5'});
 await assert.rejects(funding.proposeFundingBudget(pool,ctx(donor),{operationId:randomUUID(),poolId,spenderUserId:donor,maximumMicro:'1000000',perRunMicro:'1000000',purpose:'Donor spend',termsHash:offer.consentHash,...price}),e=>e.code==='not_found'&&e.details?.reason==='project_not_found',
  'the contributor cannot propose a budget: no spend right and no automatic model choice come with paying');
});
