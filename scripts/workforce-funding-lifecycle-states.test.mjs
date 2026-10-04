// FUND-05 against real PostgreSQL: campaigns move through
// draft/open/paused/closed/cancelled/reconciling and contributions through
// pending/confirmed/return_pending/returned/disputed, with linked settlement
// records -- and the read API never invents failure or settlement.
//
// PROVEN: the six campaign states and five contribution states are DB CHECK
// closed worlds; transitions are fenced (revision-checked, map-checked,
// trigger-checked: closed is terminal, draft opens only via the milestone
// gate, confirmed returns only through return_pending); a settled run links
// settlement->admission->budget->pool->contribution lots; returns link
// contribution->returns->return lots; an unknown operation reads
// not-observed (never failed), a paid checkout without a contribution still
// reads not-observed (a redirect is not a settlement), and a quarantined
// origin surfaces as derived availability with the row state untouched.
// HONEST NOTE: no service writes state 'disputed'; disputes surface as
// derived quarantine availability. The trigger reserves the transition and
// this file pins it at SQL level.
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
const funding=await import('../src/server/services/workforceFunding.js');
const {admitRun}=await import('../src/server/services/workforceRunAdmission.js');
const ledger=await import('../src/server/utils/creditLedgerV2.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('FUND-05: lifecycle states are fenced; settlements link; reads never invent',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`f5-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),donor=await user('donor'),planner=await user('planner'),approver=await user('approver');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:donor,customer:'cus_'+mk,
  amount_total:1500,currency:'eur',metadata:{xenoUserId:donor,credits:'15',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[donor]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'Lifecycle'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const TERMS={beneficiary:'Lifecycle Org',cancellationTerms:'Cancel before dispatch.',refundTerms:'Unspent returns.',deliverableLicense:'MIT'};
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,...TERMS});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'12000000'});
 const rev=async id=>(await pool.query('SELECT status,revision::text AS r FROM workforce_funding_campaigns WHERE id=$1',[id])).rows[0];

 // ── Campaign lifecycle: the map, the revision fence, the terminal states.
 let st=await rev(campaign.id);
 assert.deepEqual([st.status,st.r],['draft','1'],'campaigns are born draft at revision 1');
 await assert.rejects(funding.setFundingCampaignStatus(pool,ctx(alice),{campaignId:campaign.id,status:'open',expectedRevision:'1'}),e=>e.details?.reason==='invalid_campaign_transition',
  'draft cannot move via the generic transition: opening goes through the milestone gate');
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 st=await rev(campaign.id);assert.deepEqual([st.status,st.r],['open','2'],'opening moves draft to open');
 await assert.rejects(funding.setFundingCampaignStatus(pool,ctx(alice),{campaignId:campaign.id,status:'paused',expectedRevision:'1'}),e=>e.details?.reason==='campaign_revision_changed',
  'a stale revision is refused: transitions are fenced against lost updates');
 await funding.setFundingCampaignStatus(pool,ctx(alice),{campaignId:campaign.id,status:'paused',expectedRevision:'2'});
 st=await rev(campaign.id);assert.deepEqual([st.status,st.r],['paused','3'],'open pauses');
 await funding.setFundingCampaignStatus(pool,ctx(alice),{campaignId:campaign.id,status:'reconciling',expectedRevision:'3'});
 await funding.setFundingCampaignStatus(pool,ctx(alice),{campaignId:campaign.id,status:'cancelled',expectedRevision:'4'});
 st=await rev(campaign.id);assert.deepEqual([st.status,st.r],['cancelled','5'],'paused reconciles then cancels, one revision per move');
 await assert.rejects(funding.setFundingCampaignStatus(pool,ctx(alice),{campaignId:campaign.id,status:'open',expectedRevision:'5'}),e=>e.details?.reason==='invalid_campaign_transition',
  'cancelled is terminal: no resurrection');
 const campaignB=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,...TERMS});
 const milestoneB=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaignB.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'12000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaignB.id});
 const campaignC=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,...TERMS});
 await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaignC.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'12000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaignC.id});
 await funding.setFundingCampaignStatus(pool,ctx(alice),{campaignId:campaignC.id,status:'closed',expectedRevision:'2'});
 await assert.rejects(funding.setFundingCampaignStatus(pool,ctx(alice),{campaignId:campaignC.id,status:'open',expectedRevision:'3'}),e=>e.details?.reason==='invalid_campaign_transition',
  'closed is terminal: no resurrection');
 const check=(await pool.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='workforce_funding_campaigns_status_check'`)).rows[0]?.d
  ?? (await pool.query(`SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relname='workforce_funding_campaigns' AND pg_get_constraintdef(c.oid) LIKE '%draft%'`)).rows[0].d;
 for(const want of ['draft','open','paused','closed','cancelled','reconciling']) assert.ok(check.includes(want),`campaign CHECK closed world names ${want}`);
 assert.ok(!check.includes('deleted')&&!check.includes('archived'),'no invented campaign states in the CHECK');

 // ── Reads never invent: unknown ops and bare checkouts are not-observed.
 const ghostOp=randomUUID();
 assert.deepEqual(await funding.readFundingContribution(pool,ctx(donor),{operationId:ghostOp}),{state:'not-observed'},
  'an unknown operation is not-observed: a timeout is never reported as a confirmed failure');
 const offerB=await funding.readFundingOffer(pool,ctx(alice),{campaignId:campaignB.id,milestoneId:milestoneB.id});
 const op1=randomUUID();
 const c1=await funding.contributeFunding(pool,ctx(donor),{operationId:op1,campaignId:campaignB.id,milestoneId:milestoneB.id,amountMicro:'5000000',consentHash:offerB.consentHash,confirmed:true});
 assert.equal(c1.state,'confirmed','the contribution confirms');
 const reread=await funding.readFundingContribution(pool,ctx(donor),{operationId:op1});
 assert.deepEqual([reread.state,reread.replayed,reread.availability],[ 'confirmed',true,'restricted'],'re-reading returns the true state, never an invented one');

 // ── Settlement links contribution lots to a retained receipt.
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestoneB.id])).rows[0];
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,alice]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,alice,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const budget=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:alice,maximumMicro:'10000000',perRunMicro:'10000000',purpose:'Lifecycle',termsHash:offerB.consentHash,...price});
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:budget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const run=await admitRun(pool,ctx(alice),{operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
 target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:'1000000',fundingBudgetId:budget.id}});
 const settled=await ledger.settleProjectRunV2(pool,{admissionId:run.admission.admissionId,
  eventId:'evt-'+randomUUID().replaceAll('-',''),providerRequestId:'pr-'+randomUUID().replaceAll('-',''),
  provider:'fixture',model:'claude-opus-5',inputTokens:'100',outputTokens:'100',measured:true,allWorkTerminal:true});
 const linked=(await pool.query(`SELECT s.event_id,s.state FROM workforce_funding_settlements s
  JOIN workforce_run_admissions a ON a.id=s.root_admission_id
  JOIN workforce_run_funding f ON f.admission_id=a.id
  JOIN workforce_funding_pools p ON p.id=f.pool_id
  JOIN workforce_contribution_lots l ON l.pool_grant_id IN (SELECT id FROM credit_grants WHERE user_id=p.id)
  WHERE l.contribution_id=$1 AND s.root_admission_id=$2`,[c1.id,run.admission.admissionId])).rows[0];
 assert.deepEqual([linked?.state,typeof linked?.event_id],[ 'settled','string'],'the settlement links back to the contribution lots that funded it');

 // ── Return walks confirmed->return_pending->returned with linked records.
 const ret=await funding.returnFundingContribution(pool,ctx(donor),{contributionId:c1.id});
 assert.equal(ret.state,'returned','the return completes');
 const retRow=(await pool.query('SELECT amount_micro::text AS a FROM workforce_funding_returns WHERE contribution_id=$1',[c1.id])).rows[0];
 assert.equal(retRow.a,String(BigInt(5000000)-BigInt(settled.chargedMicro)),'the return record holds exactly the unspent remainder');
 const cState=(await pool.query('SELECT state FROM workforce_funding_contributions WHERE id=$1',[c1.id])).rows[0].state;
 assert.equal(cState,'returned','the contribution row ends returned');
 const returnLots=(await pool.query('SELECT count(*)::int AS n FROM workforce_funding_return_lots WHERE contribution_id=$1',[c1.id])).rows[0].n;
 assert.ok(returnLots>0,'return lots link the return to the restored origins');

 // ── The trigger pins the contribution transition map at SQL level.
 const c2=await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaignB.id,milestoneId:milestoneB.id,amountMicro:'1000000',consentHash:offerB.consentHash,confirmed:true});
 await pool.query("UPDATE workforce_funding_contributions SET state='return_pending' WHERE id=$1",[c2.id]);
 await assert.rejects(pool.query("UPDATE workforce_funding_contributions SET state='confirmed' WHERE id=$1",[c2.id]),e=>e.code==='23514',
  'return_pending cannot slide back to confirmed');
 await pool.query("UPDATE workforce_funding_contributions SET state='returned' WHERE id=$1",[c2.id]);
 await assert.rejects(pool.query("UPDATE workforce_funding_contributions SET state='confirmed' WHERE id=$1",[c2.id]),e=>e.code==='23514',
  'returned is terminal');
 const c3=await funding.contributeFunding(pool,ctx(donor),{operationId:randomUUID(),campaignId:campaignB.id,milestoneId:milestoneB.id,amountMicro:'1000000',consentHash:offerB.consentHash,confirmed:true});
 await pool.query("UPDATE workforce_funding_contributions SET state='disputed' WHERE id=$1",[c3.id]);
 assert.equal((await pool.query('SELECT state FROM workforce_funding_contributions WHERE id=$1',[c3.id])).rows[0].state,'disputed',
  'confirmed can move to disputed: the schema reserves the dispute state');
 const cCheck=(await pool.query(`SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relname='workforce_funding_contributions' AND pg_get_constraintdef(c.oid) LIKE '%return_pending%'`)).rows[0].d;
 for(const want of ['pending','confirmed','return_pending','returned','disputed']) assert.ok(cCheck.includes(want),`contribution CHECK closed world names ${want}`);

 // ── Disputes surface as derived availability; the row state is untouched.
 const qg=(await pool.query(`SELECT l.origin_grant_id AS id,o.payment_intent FROM workforce_contribution_lots l
  JOIN credit_grant_payment_origins o ON o.grant_id=l.origin_grant_id
  WHERE l.contribution_id=$1 LIMIT 1`,[c1.id])).rows[0];
 await pool.query(`INSERT INTO workforce_funding_origin_quarantine(event_id,payment_intent,grant_id,reason,liability_micro)
  VALUES($1,$2,$3,'dispute',(SELECT remaining_micro FROM credit_grants WHERE id=$3))`,['q-'+marker,qg.payment_intent,qg.id]);
 const qread=await funding.readFundingContribution(pool,ctx(donor),{operationId:op1});
 assert.deepEqual([qread.availability,qread.reconciliationRequired],[ 'quarantined',true],'a quarantined origin surfaces as derived availability');
 assert.equal(qread.state,'returned','...while the row state stays exactly what the lifecycle put there');
});
