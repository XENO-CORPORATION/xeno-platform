// FUND-17 against real PostgreSQL: restricted pool value stays segregated under every path
// this system moves money through, including against itself.
//
// PROVEN HERE: a frozen or mistyped pool destination refuses contributions; a pool account
// cannot be a contribution source; a contribution racing a return in the opposite direction
// serializes without deadlock and both land with exact balances and verified journals; a
// return is refused while pool commitments are held; a stranger cannot draw on a pool-backed
// run, while the admitted actor can on the same lease.
// PROVEN BY SIBLINGS, NOT REPEATED: ordinary wallet APIs refuse restricted accounts, the
// expiry sweep skips them, and restricted identity cannot be retyped or readdressed
// (credit-restricted-account.test.mjs); paid labels and backfills without verified origin
// cannot contribute, with in-transaction rechecks of origin/refund/expiry/consent/commitments
// (credit-payment-origin.test.mjs, FUND-02/FUND-04).
// HONEST ABSENCE: no gift-transfer path exists yet (ACCT-03/04/05 open), so there is no gift
// surface to exclude restricted value from; the contribution surface above is the one that moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash,generateKeyPairSync} from 'node:crypto';
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
const {admitRun}=await import('../src/server/services/workforceRunAdmission.js');
const {authorizeRunStep}=await import('../src/server/services/workforceRunAuthority.js');
const ledger=await import('../src/server/utils/creditLedgerV2.js');
const {allocateContributionFunding}=await import('../src/server/utils/usageCreditFunding.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('FUND-17: restricted pool value is excluded from every unrelated path; counter-transfers serialize with exact balances',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`f17-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),planner=await user('planner'),approver=await user('approver'),
   contributor=await user('contributor'),stranger=await user('stranger');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(owner),name:'Segregated pool'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,owner]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,owner,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const campaign=await funding.createFundingCampaign(pool,ctx(owner),{operationId:randomUUID(),projectId:project.id,beneficiary:'Delivery',cancellationTerms:'Cancel unused work.',refundTerms:'Return with original expiry.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(owner),{campaignId:campaign.id,key:'first',title:'First',criteria:['Tests'],thresholdMicro:'2000000',budgetMaxMicro:'4000000'});
 await funding.openFundingCampaign(pool,ctx(owner),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(owner),{campaignId:campaign.id,milestoneId:milestone.id});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 const poolId=p.id;
 assert.equal(p.account_owner_id,poolId,'fixture: pool grants live under the pool id, a random UUID no human holds');
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:contributor,customer:'cus_'+mk,
 amount_total:500,currency:'eur',metadata:{xenoUserId:contributor,credits:'5',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET enabled=true',[contributor]);
 const contribute=amountMicro=>funding.contributeFunding(pool,ctx(contributor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro,consentHash:offer.consentHash,confirmed:true});
 const A=await contribute('2000000'),B=await contribute('1000000');
 const balance=async userId=>(await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1',[userId])).rows[0].balance;
 assert.equal(await balance(contributor),'2000000','fixture: two contributions leave the contributor 2.00');
 assert.equal(await balance(poolId),'3000000','fixture: the pool holds 3.00');

 // ── The destination is rechecked: a frozen or mistyped pool refuses the contribution.
 await pool.query('UPDATE credit_accounts SET is_frozen=true WHERE id=$1',[p.account_id]);
 await assert.rejects(contribute('100'),{code:'CONTRIBUTION_DESTINATION_UNAVAILABLE'},'a frozen pool cannot receive contributions');
 await pool.query('UPDATE credit_accounts SET is_frozen=false WHERE id=$1',[p.account_id]);
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await assert.rejects(allocateContributionFunding(db,contributor,'100',{destinationOwnerId:contributor}),
   {code:'CONTRIBUTION_DESTINATION_UNAVAILABLE'},'an ordinary wallet cannot stand in as the pool destination');
  await assert.rejects(allocateContributionFunding(db,poolId,'100',{destinationOwnerId:poolId}),
   {code:'CONTRIBUTION_ACCOUNT_UNAVAILABLE'},'a pool account cannot contribute: the source must be an ordinary wallet');
  await db.query('ROLLBACK');
 }finally{db.release();}

 // ── Counter-transfers serialize: a return racing a contribution in the opposite direction
 // locks both endpoints in the same order, so both land -- no deadlock, exact money.
 const raced=await Promise.allSettled([
  funding.returnFundingContribution(pool,ctx(contributor),{contributionId:A.id}),
  contribute('1500000'),
 ]);
 assert.deepEqual(raced.map(r=>r.status),['fulfilled','fulfilled'],
  `counter-transfers both land: ${raced.map(r=>r.status==='rejected'?r.reason.code+': '+r.reason.message:r.value.state??'ok').join('; ')}`);
 assert.equal(raced[0].value.state,'returned','the raced return completes');
 assert.equal(await balance(contributor),'2500000','contributor ends exact: 2.00 + 2.00 returned - 1.50 contributed');
 assert.equal(await balance(poolId),'2500000','pool ends exact: 3.00 - 2.00 returned + 1.50 contributed');
 assert.equal((await ledger.verifyChainV2(pool,contributor)).ok,true,'counter-transfers preserve the source journal');
 assert.equal((await ledger.verifyChainV2(pool,poolId)).ok,true,'counter-transfers preserve the pool journal');

 // ── Committed value cannot leak back: with a pool hold in flight, return is refused.
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const proposal=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:owner,maximumMicro:'4000000',perRunMicro:'2000000',purpose:'Segregation spend',termsHash:offer.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:proposal.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const spent=await admitRun(pool,ctx(owner),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
 target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:'1000000',fundingBudgetId:proposal.id}});
 assert.equal(spent.admission.payer.kind,'project_pool','fixture: the run spends from the pool');
 await assert.rejects(funding.returnFundingContribution(pool,ctx(contributor),{contributionId:B.id}),
  {code:'CONTRIBUTION_RESERVED'},'a return is refused while pool commitments are held');

 // ── Draws cannot siphon pool value: a stranger learns nothing; the admitted actor draws.
 const key=generateKeyPairSync('ec',{namedCurve:'P-256'});
 const signingKey={kid:'segregation-fixture',privatePem:key.privateKey.export({type:'pkcs8',format:'pem'})};
 const {token}=await authorizeRunStep(pool,ctx(owner),{admissionId:spent.admission.admissionId,operation:'provider_dispatch'},{signingKey});
 const draw=(actorUserId,drawId)=>ledger.openRunDrawV2(pool,{admissionId:spent.admission.admissionId,actorUserId,drawId,lease:token,model:'claude-opus-5',inputBound:10,outputBound:10});
 await assert.rejects(draw(stranger,`draw-${randomUUID()}`),{code:'NOT_FOUND'},'a stranger cannot draw on a pool-backed run');
 const good=await draw(owner,`draw-${randomUUID()}`);
 assert.equal(good.replayed,false,'the admitted actor draws on the same lease the stranger was refused with');
 assert.equal(await balance(contributor),'2500000','drawing moves no money between accounts');
 assert.equal(await balance(poolId),'2500000','pool value is unchanged by the draw envelope');
});
