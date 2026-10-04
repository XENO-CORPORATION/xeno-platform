// ACCT-06 against real PostgreSQL: gifts stay visible, countable-once, refusable and
// pausable, with honest notice when they do not land.
//
// PROVEN: both sides see gift events in history with direction, counterparty and return
// linkage; gifted value cannot contribute (no double-count); return lots stay categorized
// as gifts; refunded origins cannot gift though the balance still shows; opt-out refuses
// with the same code as unknown recipients while notifying only the genuine refusal;
// unknown IDs notify nothing (no oracle via email); pause blocks sending and receiving,
// sticks against self-clearing when an admin set it, still permits dispute reversal, and
// resumes cleanly.
// SIBLING: account-gift-transfer.test.mjs proves the transfer mechanics this file governs.
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
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('ACCT-06: gift history, no double-count, opt-out notice, dispute pause and resume',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`g6-${randomUUID().slice(0,8)}`;
 const user=async(s,role='user')=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash,role) VALUES($1,$2,$1,'test',$3) RETURNING id",[x,x+'@example.test',role])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),admin=await user('admin','admin');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const emailOf=async id=>(await pool.query('SELECT email FROM users WHERE id=$1',[id])).rows[0].email;
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:alice,customer:'cus_'+mk,
 amount_total:500,currency:'eur',metadata:{xenoUserId:alice,credits:'5',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 const balance=async userId=>(await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1',[userId])).rows[0]?.balance ?? '0';
 const pv=await gifts.previewGift(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000'});
 const g1=await gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000',operationId:randomUUID(),consentHash:pv.consentHash,confirmed:true});
 const rp=await gifts.previewGiftReturn(pool,ctx(bob),{giftId:g1.giftId,amountMicro:'200000'});
 await gifts.returnGift(pool,ctx(bob),{giftId:g1.giftId,amountMicro:'200000',operationId:randomUUID(),consentHash:rp.consentHash,confirmed:true});

 // ── History: both sides see direction, counterparty and return linkage.
 const sent=await gifts.listGiftHistory(pool,ctx(alice),{limit:50});
 const received=await gifts.listGiftHistory(pool,ctx(bob),{limit:50});
 assert.ok(sent.some(e=>e.giftId===g1.giftId&&e.direction==='sent'&&e.amountMicro==='1000000'),'the sender sees the gift as sent');
 assert.ok(received.some(e=>e.giftId===g1.giftId&&e.direction==='received'),'the recipient sees the gift as received');
 assert.ok(received.some(e=>e.returnKind==='recipient_return'),'return linkage shows in history');
 assert.ok(sent.every(e=>e.counterparty&&!e.counterparty.includes('@')),'history shows handles, never contact details');

 // ── No double-count: gifted value cannot contribute; returns stay categorized as gifts.
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'Gift project'});
 const campaign=await funding.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,beneficiary:'Delivery',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(alice),{campaignId:campaign.id,key:'m',title:'M',criteria:['Done'],thresholdMicro:'1',budgetMaxMicro:'5000000'});
 await funding.openFundingCampaign(pool,ctx(alice),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(bob),{campaignId:campaign.id,milestoneId:milestone.id});
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[bob]);
 await assert.rejects(funding.contributeFunding(pool,ctx(bob),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'100',consentHash:offer.consentHash,confirmed:true}),
  e=>e.code==='INSUFFICIENT_CONTRIBUTABLE_CREDITS','gifted value cannot contribute: receipt is not a contribution');
 assert.equal(await balance(bob),'800000','the refused contribution moves nothing');
 const returnLots=(await pool.query(`SELECT l.*,g.source_ref FROM workforce_gift_lots l JOIN credit_grants g ON g.id=l.recipient_grant_id
  JOIN workforce_gifts gf ON gf.id=l.gift_id JOIN workforce_gift_returns r ON r.return_gift_id=gf.id WHERE r.gift_id=$1`,[g1.giftId])).rows;
 assert.ok(returnLots.length>0 && returnLots.every(l=>l.source_ref.startsWith('gift:')),'return value stays categorized as gift lots');

 // ── Refunded origins cannot gift, though the cached balance still shows.
 await pool.query('UPDATE billing_charges SET refunded_micro=1 WHERE payment_intent=$1',['pi_'+mk]);
 const pvRefund=await gifts.previewGift(pool,ctx(alice),{recipientUserId:bob,amountMicro:'100'});
 await assert.rejects(gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'100',operationId:randomUUID(),consentHash:pvRefund.consentHash,confirmed:true}),
  e=>e.code==='INSUFFICIENT_GIFTABLE_CREDITS','a refunded origin cannot gift');
 assert.equal(await balance(alice),'4200000','refunded value stays visible but unspendable by gift');
 await pool.query('UPDATE billing_charges SET refunded_micro=0 WHERE payment_intent=$1',['pi_'+mk]);

 // ── Opt-out: same refusal code, sender notified, unknown IDs silent, resume works.
 await gifts.setGiftPreferences(pool,ctx(bob),{targetUserId:bob,acceptsUnsolicited:false,giftingPaused:false});
 const mailsBefore=(await pool.query("SELECT count(*)::int n FROM email_logs WHERE template='gift_not_received'")).rows[0].n;
 await assert.rejects(gifts.previewGift(pool,ctx(alice),{recipientUserId:bob,amountMicro:'100'}),
  e=>e.details?.reason==='gift_recipient_unavailable','opt-out previews exactly like unknown');
 const mails=(await pool.query("SELECT to_email,status FROM email_logs WHERE template='gift_not_received' ORDER BY created_at DESC LIMIT 1")).rows[0];
 assert.deepEqual([mails.to_email,mails.status],[await emailOf(alice),'skipped'],'the sender is notified (skipped: no provider in test)');
 assert.equal((await pool.query("SELECT count(*)::int n FROM email_logs WHERE template='gift_not_received'")).rows[0].n,mailsBefore+1,'one refusal, one notice');
 await assert.rejects(gifts.previewGift(pool,ctx(alice),{recipientUserId:randomUUID(),amountMicro:'100'}),
  e=>e.details?.reason==='gift_recipient_unavailable','unknown IDs refuse identically');
 assert.equal((await pool.query("SELECT count(*)::int n FROM email_logs WHERE template='gift_not_received'")).rows[0].n,mailsBefore+1,'unknown IDs notify nothing: no oracle via email');
 await gifts.setGiftPreferences(pool,ctx(bob),{targetUserId:bob,acceptsUnsolicited:true,giftingPaused:false});
 const pvResume=await gifts.previewGift(pool,ctx(alice),{recipientUserId:bob,amountMicro:'100'});
 const resumed=await gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'100',operationId:randomUUID(),consentHash:pvResume.consentHash,confirmed:true});
 assert.equal(resumed.state,'completed','opt-in resumes receipt');
 await assert.rejects(gifts.setGiftPreferences(pool,ctx(bob),{targetUserId:alice,acceptsUnsolicited:false,giftingPaused:false}),
  e=>e.details?.reason==='gift_preference_admin_only','only an admin sets another account');

 // ── Dispute pause: neither direction moves, admin pause sticks, reversal still works.
 await gifts.setGiftPreferences(pool,ctx(admin),{targetUserId:bob,acceptsUnsolicited:true,giftingPaused:true});
 await assert.rejects(gifts.previewGift(pool,ctx(alice),{recipientUserId:bob,amountMicro:'100'}),
  e=>e.details?.reason==='gift_recipient_unavailable','a paused account cannot receive');
 await assert.rejects(gifts.previewGift(pool,ctx(bob),{recipientUserId:alice,amountMicro:'100'}),
  e=>e.details?.reason==='gift_sending_paused','a paused account cannot send');
 await assert.rejects(gifts.setGiftPreferences(pool,ctx(bob),{targetUserId:bob,acceptsUnsolicited:true,giftingPaused:false}),
  e=>e.details?.reason==='gift_preference_admin_only','an admin-set pause sticks against self-clearing');
 const rev=await gifts.disputeReverseGift(pool,ctx(admin),{giftId:g1.giftId,amountMicro:'100000',reason:'dispute pause remedy check',operationId:randomUUID()});
 assert.equal(rev.kind,'dispute_reversal','the remedy bypasses pause');
 await gifts.setGiftPreferences(pool,ctx(admin),{targetUserId:bob,acceptsUnsolicited:true,giftingPaused:false});
 const pvAfter=await gifts.previewGift(pool,ctx(alice),{recipientUserId:bob,amountMicro:'100'});
 assert.ok(pvAfter.consentHash,'resume restores receipt');
});
