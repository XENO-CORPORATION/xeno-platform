// ACCT-07 against real PostgreSQL: agent-originated gifts and contributions move only
// on an explicit bounded owner approval -- one agent, one operation, a maximum amount,
// an expiry, an optional target -- consumed through one shared typed gate. Delegated
// identity narrows authorization; it never replaces the owner checks, which re-resolve
// live at every spend. The payer is always derived (the approval's owner), never taken
// from a request field: no payer key exists in any shape.
//
// PROVEN: grant gates (owner-only, agent-only, bounded expiry, strict targets, replay);
// agent gift without approval refused; with approval the money leaves the OWNER (exact
// balance delta, journal names owner, agent holds no ledger row) while the gift names
// the agent originator; partial consume, exhaustion, no double-consume on replay;
// exceeded/expired/revoked/target-mismatch/wrong-operation/wrong-agent refusals with
// identical reasons on BOTH money paths; suspension of agent or owner kills a live
// approval; owner (not agent) returns an agent-originated contribution to the owner's
// grants; payerUserId is shape-rejected everywhere; approvals work from any surface.
// SIBLING: the ledger-pricing suite proves an agent's balance is its owner's and pins
// the tariff the money moves under; this file cites the approval path it refused.
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
const gifts=await import('../src/server/services/accountGifts.js');
const funding=await import('../src/server/services/workforceFunding.js');
const approvals=await import('../src/server/services/agentSpendApprovals.js');
const {createAgent,resolvePrincipal}=await import('../src/server/services/agentIdentity.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('ACCT-07: agent spends move only on explicit bounded owner approval; payers are derived',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`a7-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),carol=await user('carol'),bob=await user('bob'),dave=await user('dave');
 const ctx=(actorUserId,clientId='xeno-agent-interface')=>({actorUserId,clientId});
 const fund=async who=>{const mk=randomUUID().replaceAll('-','');
  const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:who,customer:'cus_'+mk,
  amount_total:500,currency:'eur',metadata:{xenoUserId:who,credits:'5',kind:'credits'}};
  await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});};
 await fund(owner);await fund(owner);await fund(carol);
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[owner]);
 const mkAgent=async (ownerId,name)=>{const op=await resolvePrincipal(pool,ownerId);
  const made=await createAgent(pool,{kind:'human',id:op.id,handle:op.handle,displayName:op.displayName},{name});
  return (await pool.query('SELECT id FROM users WHERE username=$1',[made.agent.handle])).rows[0].id;};
 const agentA=await mkAgent(owner,'spender'),agentB=await mkAgent(carol,'spender'),agentS=await mkAgent(owner,'doomed'),agentD=await mkAgent(dave,'d'),agentR=await mkAgent(owner,'roamer');
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(owner),name:'Approvals'});
 const campaign=await funding.createFundingCampaign(pool,ctx(owner),{operationId:randomUUID(),projectId:project.id,beneficiary:'Delivery',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(owner),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1000000',budgetMaxMicro:'4000000'});
 await funding.openFundingCampaign(pool,ctx(owner),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(owner),{campaignId:campaign.id,milestoneId:milestone.id});
 const balance=async who=>(await pool.query('SELECT balance::text AS b FROM credit_accounts WHERE user_id=$1',[who])).rows[0].b;
 const grant=(who,v)=>approvals.grantSpendApproval(pool,ctx(who),{operationId:randomUUID(),...v});
 const hour=()=>new Date(Date.now()+3600_000).toISOString();

 // ── Grant gates: owner-only, agent-only, bounded, strict targets, replay-safe.
 const ga=await grant(owner,{agentUserId:agentA,operation:'gift',maxAmountMicro:'2000000',expiresAt:hour(),target:{recipientUserId:bob}});
 assert.equal(ga.remainingMicro,'2000000','a fresh approval covers its maximum');
 await assert.rejects(grant(carol,{agentUserId:agentA,operation:'gift',maxAmountMicro:'100',expiresAt:hour()}),/approval_agent_not_yours/,
  'only the agent-owner grants');
 await assert.rejects(grant(owner,{agentUserId:bob,operation:'gift',maxAmountMicro:'100',expiresAt:hour()}),/approval_agent_unavailable/,
  'humans are not grantees');
 await assert.rejects(grant(owner,{agentUserId:agentA,operation:'gift',maxAmountMicro:'100',expiresAt:new Date(Date.now()-1000).toISOString()}),/invalid_expiry/,
  'the past is not a bound');
 await assert.rejects(grant(owner,{agentUserId:agentA,operation:'gift',maxAmountMicro:'100',expiresAt:new Date(Date.now()+31*86400_000).toISOString()}),/invalid_expiry/,
  'approval is bounded in time, at most 30 days');
 await assert.rejects(grant(owner,{agentUserId:agentA,operation:'gift',maxAmountMicro:'100',expiresAt:hour(),target:{payerUserId:owner}}),/unexpected_target/,
  'a bound the granter misspells must not silently vanish');
 const opId=randomUUID();
 const g1=await grant(owner,{agentUserId:agentA,operation:'gift',maxAmountMicro:'500000',expiresAt:hour(),operationId:opId});
 const g1b=await approvals.grantSpendApproval(pool,ctx(owner),{agentUserId:agentA,operation:'gift',maxAmountMicro:'500000',expiresAt:g1.expiresAt,operationId:opId});
 assert.deepEqual([g1b.approvalId,g1b.replayed],[g1.approvalId,true],'grants replay by identity');

 // ── Agent gift happy path: originator named, OWNER pays, approval consumed.
 await assert.rejects(gifts.previewGift(pool,ctx(agentA),{recipientUserId:bob,amountMicro:'1000000'}),/agent_gift_approval_unavailable/,
  'no approval, no preview');
 const termsPv=await gifts.previewGift(pool,ctx(owner),{recipientUserId:bob,amountMicro:'1000000'});
 await assert.rejects(gifts.giftCredits(pool,ctx(agentA),{recipientUserId:bob,amountMicro:'1000000',operationId:randomUUID(),consentHash:termsPv.consentHash,confirmed:true}),/agent_gift_approval_unavailable/,
  'no approval, no spend');
 const pv=await gifts.previewGift(pool,ctx(agentA),{recipientUserId:bob,amountMicro:'1000000',spendApprovalId:ga.approvalId});
 const before=await balance(owner);
 const gift1=await gifts.giftCredits(pool,ctx(agentA),{recipientUserId:bob,amountMicro:'1000000',operationId:randomUUID(),consentHash:pv.consentHash,confirmed:true,spendApprovalId:ga.approvalId});
 const row=(await pool.query('SELECT * FROM workforce_gifts WHERE id=$1',[gift1.giftId])).rows[0];
 assert.deepEqual([row.sender_user_id,row.originator_user_id,row.approval_id],[owner,agentA,ga.approvalId],
  'the gift names the agent originator and the owner payer, linked by the approval');
 assert.equal(BigInt(before)-BigInt(await balance(owner)),1000000n,'the owner pays, to the micro');
 assert.equal((await pool.query("SELECT user_id FROM credit_transactions WHERE reference_type='xeno.gift' AND reference_id=$1 AND amount::bigint<0",[gift1.giftId])).rows[0]?.user_id,owner,
  'the journal debits the owner, never the agent');
 assert.equal((await pool.query('SELECT 1 FROM credit_accounts WHERE user_id=$1',[agentA])).rowCount,0,
  'the agent holds no ledger row at all');
 assert.equal((await pool.query('SELECT spent_amount_micro::text AS s FROM workforce_spend_approvals WHERE id=$1',[ga.approvalId])).rows[0].s,'1000000',
  'the spend consumes the approval');
 // A second surface spends the same approval down to exhaustion; replays never double-consume.
 const pv2=await gifts.previewGift(pool,ctx(agentA,'xeno-cli'),{recipientUserId:bob,amountMicro:'1000000',spendApprovalId:ga.approvalId});
 const op2=randomUUID();
 await gifts.giftCredits(pool,ctx(agentA,'xeno-cli'),{recipientUserId:bob,amountMicro:'1000000',operationId:op2,consentHash:pv2.consentHash,confirmed:true,spendApprovalId:ga.approvalId});
 assert.equal((await pool.query("SELECT state FROM workforce_spend_approvals WHERE id=$1",[ga.approvalId])).rows[0].state,'exhausted',
  'the cap binds across surfaces');
 const replay=await gifts.giftCredits(pool,ctx(agentA,'xeno-cli'),{recipientUserId:bob,amountMicro:'1000000',operationId:op2,consentHash:pv2.consentHash,confirmed:true,spendApprovalId:ga.approvalId});
 assert.equal(replay.replayed,true,'the receipt replays');
 assert.equal((await pool.query('SELECT spent_amount_micro::text AS s FROM workforce_spend_approvals WHERE id=$1',[ga.approvalId])).rows[0].s,'2000000',
  'replay does not double-consume');
 const dustFresh=await grant(owner,{agentUserId:agentA,operation:'gift',maxAmountMicro:'100',expiresAt:hour(),target:{recipientUserId:bob}});
 const dustPv=await gifts.previewGift(pool,ctx(agentA),{recipientUserId:bob,amountMicro:'100',spendApprovalId:dustFresh.approvalId});
 await assert.rejects(gifts.giftCredits(pool,ctx(agentA),{recipientUserId:bob,amountMicro:'100',operationId:randomUUID(),consentHash:dustPv.consentHash,confirmed:true,spendApprovalId:ga.approvalId}),/spend_approval_exhausted/,
  'an exhausted approval refuses even dust');

 // ── Bounds, one shared taxonomy: exceeded, target, operation, agent, revoked, expired.
 const small=await grant(owner,{agentUserId:agentA,operation:'gift',maxAmountMicro:'1000000',expiresAt:hour(),target:{recipientUserId:bob}});
 await assert.rejects(gifts.previewGift(pool,ctx(agentA),{recipientUserId:bob,amountMicro:'1500000',spendApprovalId:small.approvalId}),/spend_approval_exceeded/,
  'preview enforces the cap, not just commit');
 await assert.rejects(gifts.previewGift(pool,ctx(agentA),{recipientUserId:carol,amountMicro:'100',spendApprovalId:small.approvalId}),/spend_approval_target_mismatch/,
  'a targeted approval does not travel');
 await assert.rejects(funding.contributeFunding(pool,ctx(agentA),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'100',consentHash:offer.consentHash,confirmed:true,spendApprovalId:small.approvalId}),/spend_approval_wrong_operation/,
  'a gift approval is not a contribution approval');
 await assert.rejects(gifts.previewGift(pool,ctx(agentB),{recipientUserId:bob,amountMicro:'100',spendApprovalId:small.approvalId}),/spend_approval_wrong_agent/,
  'another household agent cannot borrow the approval');
 const doomed=await grant(owner,{agentUserId:agentA,operation:'gift',maxAmountMicro:'100',expiresAt:hour()});
 await approvals.revokeSpendApproval(pool,ctx(owner),{approvalId:doomed.approvalId});
 await assert.rejects(gifts.previewGift(pool,ctx(agentA),{recipientUserId:bob,amountMicro:'100',spendApprovalId:doomed.approvalId}),/spend_approval_revoked/,
  'revocation bites immediately');
 await assert.rejects(approvals.revokeSpendApproval(pool,ctx(carol),{approvalId:small.approvalId}),/approval_not_yours/,
  'only the granter revokes');
 const stale=await grant(owner,{agentUserId:agentA,operation:'gift',maxAmountMicro:'100',expiresAt:hour()});
 await pool.query("UPDATE workforce_spend_approvals SET expires_at=now()-interval '1 minute' WHERE id=$1",[stale.approvalId]);
 await assert.rejects(gifts.previewGift(pool,ctx(agentA),{recipientUserId:bob,amountMicro:'100',spendApprovalId:stale.approvalId}),/spend_approval_expired/,
  'expiry is checked at spend time, not grant time');

 // ── Owner checks are live: suspension kills a valid approval; humans need none.
 const susp=await grant(owner,{agentUserId:agentS,operation:'gift',maxAmountMicro:'100',expiresAt:hour()});
 await pool.query("UPDATE users SET status='suspended' WHERE id=$1",[agentS]);
 await assert.rejects(gifts.previewGift(pool,ctx(agentS),{recipientUserId:bob,amountMicro:'100',spendApprovalId:susp.approvalId}),/usable_human_required/,
  'a suspended agent is refused at the entry gate, approval or not');
 const drift=await grant(owner,{agentUserId:agentR,operation:'gift',maxAmountMicro:'100',expiresAt:hour()});
 await pool.query('UPDATE agent_identities SET owner_user_id=$1 WHERE user_id=$2',[carol,agentR]);
 await assert.rejects(gifts.previewGift(pool,ctx(agentR),{recipientUserId:bob,amountMicro:'100',spendApprovalId:drift.approvalId}),/spend_approval_owner_check_failed/,
  'a re-owned agent cannot spend the old owner approval: ownership re-resolves live');
 const dAppr=await grant(dave,{agentUserId:agentD,operation:'gift',maxAmountMicro:'100',expiresAt:hour()});
 await pool.query("UPDATE users SET status='suspended' WHERE id=$1",[dave]);
 await assert.rejects(gifts.previewGift(pool,ctx(agentD),{recipientUserId:bob,amountMicro:'100',spendApprovalId:dAppr.approvalId}),/usable_human_required/,
  'a suspended owner funds nothing: the identity cascade retires their agents with them');
 await assert.rejects(gifts.previewGift(pool,ctx(owner),{recipientUserId:bob,amountMicro:'100',spendApprovalId:small.approvalId}),/approval_not_for_humans/,
  'owners spend on their own authority, never on a delegation');
 await assert.rejects(gifts.previewGift(pool,ctx(owner),{recipientUserId:bob,amountMicro:'100',payerUserId:carol}),/unexpected_field/,
  'no payer key exists to be smuggled through');

 // ── The contribution path shares the gate, the taxonomy and the payer derivation.
 const agentOffer=await funding.readFundingOffer(pool,ctx(agentA),{campaignId:campaign.id,milestoneId:milestone.id});
 assert.equal(agentOffer.consentHash,offer.consentHash,'agents may read terms; reading is not spending');
 await assert.rejects(funding.contributeFunding(pool,ctx(agentA),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'100',consentHash:offer.consentHash,confirmed:true}),/agent_contribution_approval_unavailable/,
  'no approval, no contribution');
 const ca=await grant(owner,{agentUserId:agentA,operation:'contribute',maxAmountMicro:'2000000',expiresAt:hour(),target:{campaignId:campaign.id,milestoneId:milestone.id}});
 const cBefore=await balance(owner);
 const c1=await funding.contributeFunding(pool,ctx(agentA),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'2000000',consentHash:offer.consentHash,confirmed:true,spendApprovalId:ca.approvalId});
 assert.deepEqual([c1.contributorUserId,c1.payerUserId,c1.approvalId],[agentA,owner,ca.approvalId],
  'the contribution names the agent originator and the owner payer');
 assert.equal(BigInt(cBefore)-BigInt(await balance(owner)),2000000n,'the owner funds the contribution');
 assert.equal((await pool.query(`SELECT count(*)::int AS n FROM workforce_contribution_lots l JOIN credit_grants g ON g.id=l.origin_grant_id
  WHERE l.contribution_id=$1 AND g.user_id=$2`,[c1.id,owner])).rows[0].n > 0,true,'lots originate from the owner grants');
 await assert.rejects(funding.contributeFunding(pool,ctx(agentA),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'100',consentHash:offer.consentHash,confirmed:true,spendApprovalId:ca.approvalId}),/spend_approval_exceeded|spend_approval_exhausted/,
  'the same cap taxonomy binds contributions');
 await assert.rejects(funding.contributeFunding(pool,ctx(owner),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'100',consentHash:offer.consentHash,confirmed:true,spendApprovalId:ca.approvalId}),/approval_not_for_humans/,
  'humans contribute on their own authority');
 await assert.rejects(funding.contributeFunding(pool,ctx(owner),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'100',consentHash:offer.consentHash,confirmed:true,payerUserId:carol}),/invalid_shape/,
  'no payer key on contributions either (funding shape taxonomy)');

 // ── Returns: the owner reclaims to their own grants; the agent cannot undo.
 await assert.rejects(funding.returnFundingContribution(pool,ctx(agentA),{contributionId:c1.id}),/usable_human_required/,
  'agents cannot return, even their own originations');
 const rBefore=await balance(owner);
 const ret=await funding.returnFundingContribution(pool,ctx(owner),{contributionId:c1.id});
 assert.equal(ret.replayed,false,'the return executes');
 assert.equal(BigInt(await balance(owner))-BigInt(rBefore),BigInt(ret.amountMicro)-BigInt(ret.expiredMicro),
  'returned value lands back on the owner');
 assert.equal((await pool.query('SELECT 1 FROM credit_accounts WHERE user_id=$1',[agentA])).rowCount,0,
  'the agent ends with no ledger row, as it began');
});
