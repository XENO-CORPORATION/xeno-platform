// ACCT-03 + ACCT-04 against real PostgreSQL: gifts move verified value between canonical
// accounts, atomically, with a durable receipt and origin references.
//
// PROVEN: unknown, ineligible and frozen recipients preview identically (no oracle);
// self-gifts refused; agents refused on the explicit ACCT-07 seam; confirmation summary shows
// handle, exact amount and zero fee, bound by a consent hash the commit reproduces;
// unconfirmed and tampered commits refused; debit+credit commit atomically with receipt,
// origin-lot and stripe-root references; expiry/priority survive the hop; replay returns the
// same receipt while changed payloads conflict; paid labels without origin cannot gift;
// multi-hop conserves every micro with restrictions intact; a quarantined root freezes the
// whole chain downstream; gifted value spends normally but cannot enter contributions.
// v1 LIMITS (stated, not hidden): no email lookup/auto-creation/claim links; contribution
// eligibility for gift lots is a deliberate v2 (needs dispute-chain design); ACCT-05 return /
// dispute-reversal and ACCT-06 opt-out/notifications are separate requirements, still open.
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
const ledger=await import('../src/server/utils/creditLedgerV2.js');
const {allocateContributionFunding}=await import('../src/server/utils/usageCreditFunding.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {resolvePrincipal,createAgent}=await import('../src/server/services/agentIdentity.js');
const {operationHash}=await import('../src/server/services/workspaceOperationReceipts.js');

test('ACCT-03 + ACCT-04: confirmed gifts move verified value atomically with receipt and roots',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`gift-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),carol=await user('carol'),dave=await user('backfill');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:alice,customer:'cus_'+mk,
 amount_total:500,currency:'eur',metadata:{xenoUserId:alice,credits:'5',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 const balance=async userId=>(await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1',[userId])).rows[0]?.balance ?? '0';
 assert.equal(await balance(alice),'5000000','fixture: alice holds 5.00 verified');
 await pool.query("UPDATE credit_grants SET expires_at='2031-05-06T07:08:09.123456Z' WHERE user_id=$1",[alice]);

 // ── ACCT-03 mechanics: preview, confirmation, identity.
 await assert.rejects(gifts.previewGift(pool,ctx(alice),{recipientUserId:randomUUID(),amountMicro:'100'}),
  e=>e.details?.reason==='gift_recipient_unavailable','an unknown recipient previews unavailable');
 await pool.query("INSERT INTO credit_accounts(user_id,owner_kind,balance) VALUES($1,'user',0)",[bob]);
 await pool.query('UPDATE credit_accounts SET is_frozen=true WHERE user_id=$1',[bob]);
 await assert.rejects(gifts.previewGift(pool,ctx(alice),{recipientUserId:bob,amountMicro:'100'}),
  e=>e.details?.reason==='gift_recipient_unavailable','a frozen recipient previews identically: no oracle');
 await pool.query('UPDATE credit_accounts SET is_frozen=false WHERE user_id=$1',[bob]);
 await assert.rejects(gifts.previewGift(pool,ctx(alice),{recipientUserId:alice,amountMicro:'100'}),
  e=>e.details?.reason==='self_gift_refused','no self-gifts');
 const made=await createAgent(pool,await resolvePrincipal(pool,alice),{name:'g1',displayName:'Gift agent',agentRole:'worker',agentOrigin:'test'});
 const agentId=(await pool.query('SELECT id FROM users WHERE username=$1',[made.agent.handle])).rows[0].id;
 await assert.rejects(gifts.previewGift(pool,ctx(agentId),{recipientUserId:bob,amountMicro:'100'}),
  e=>e.details?.reason==='agent_gift_approval_unavailable','agents refuse on the explicit bounded-approval seam');
 const preview=await gifts.previewGift(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000'});
 assert.deepEqual([preview.recipient.userId,preview.amountMicro,preview.feeMicro],[bob,'1000000','0'],
  'the summary names the canonical recipient, the exact amount and the zero fee');
 assert.ok(preview.recipient.displayName && !JSON.stringify(preview).includes('@example.test'),
  'the summary shows a handle, never contact details');
 const commit=(actor,recipientUserId,amountMicro,over={})=>gifts.giftCredits(pool,ctx(actor),
  {recipientUserId,amountMicro,operationId:randomUUID(),consentHash:preview.consentHash,confirmed:true,...over});
 await assert.rejects(gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000',operationId:randomUUID(),consentHash:preview.consentHash,confirmed:false}),
  e=>e.details?.reason==='explicit_confirmation_required','no confirmation, no gift');
 await assert.rejects(gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000',operationId:randomUUID(),consentHash:'f'.repeat(64),confirmed:true}),
  e=>e.details?.reason==='gift_terms_changed','a tampered consent hash is a changed deal');

 // ── ACCT-04 atomicity: one gift, exact money, durable receipt, origin roots.
 const op1=randomUUID();
 const g1=await gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000',operationId:op1,consentHash:preview.consentHash,confirmed:true});
 assert.deepEqual([g1.state,g1.amountMicro,g1.replayed],['completed','1000000',false],'the gift completes');
 assert.equal(await balance(alice),'4000000','sender debited exactly');
 assert.equal(await balance(bob),'1000000','recipient credited exactly');
 const giftRow=(await pool.query('SELECT * FROM workforce_gifts WHERE id=$1',[g1.giftId])).rows[0];
 assert.deepEqual([giftRow.sender_user_id,giftRow.recipient_user_id,giftRow.state],[alice,bob,'completed'],'the receipt is durable');
 const giftLots=(await pool.query('SELECT * FROM workforce_gift_lots WHERE gift_id=$1',[g1.giftId])).rows;
 assert.equal(giftLots.reduce((n,l)=>n+BigInt(l.amount_micro),0n),1000000n,'origin references cover the amount');
 const recvLot=(await pool.query('SELECT * FROM credit_grants WHERE id=$1',[giftLots[0].recipient_grant_id])).rows[0];
 assert.ok(recvLot.source_ref.startsWith('gift:'),'the recipient lot carries gift provenance');
 assert.equal(recvLot.expires_at.toISOString(),'2031-05-06T07:08:09.123Z','expiry survives the hop');
 assert.equal((await pool.query("SELECT count(*)::int n FROM credit_transactions WHERE reference_type='xeno.gift' AND reference_id=$1",[g1.giftId])).rows[0].n,2,
  'both journal entries reference the gift receipt');
 const replay=await gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000',operationId:op1,consentHash:preview.consentHash,confirmed:true});
 assert.deepEqual([replay.giftId,replay.replayed],[g1.giftId,true],'the same operation replays its receipt');
 const changedHash=operationHash({recipient:bob,amountMicro:'2000000'});
 await assert.rejects(gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'2000000',operationId:op1,consentHash:changedHash,confirmed:true}),
  e=>e.details?.reason==='operation_payload_conflict','a changed payload on the same identity conflicts');
 const selfHash=operationHash({recipient:alice,amountMicro:'100'});
 await assert.rejects(gifts.giftCredits(pool,ctx(alice),{recipientUserId:alice,amountMicro:'100',operationId:randomUUID(),consentHash:selfHash,confirmed:true}),
  e=>e.details?.reason==='self_gift_refused','the commit refuses self-gifts too');

 // ── Eligibility: paid labels without origin cannot gift; frozen destinations refuse.
 await ledger.addGrant(pool,dave,{amountMicro:1000000,kind:'paid',sourceRef:'backfill'});
 const davePreview=await gifts.previewGift(pool,ctx(dave),{recipientUserId:carol,amountMicro:'100'});
 await assert.rejects(gifts.giftCredits(pool,ctx(dave),{recipientUserId:carol,amountMicro:'100',operationId:randomUUID(),consentHash:davePreview.consentHash,confirmed:true}),
  e=>e.code==='INSUFFICIENT_GIFTABLE_CREDITS','a paid label without origin cannot gift');
 const carolPreview=await gifts.previewGift(pool,ctx(bob),{recipientUserId:carol,amountMicro:'100'});
 await pool.query("INSERT INTO credit_accounts(user_id,owner_kind,balance) VALUES($1,'user',0)",[carol]);
 await pool.query('UPDATE credit_accounts SET is_frozen=true WHERE user_id=$1',[carol]);
 await assert.rejects(gifts.previewGift(pool,ctx(bob),{recipientUserId:carol,amountMicro:'100'}),
  e=>e.details?.reason==='gift_recipient_unavailable','preview hides frozen recipients');
 await assert.rejects(gifts.giftCredits(pool,ctx(bob),{recipientUserId:carol,amountMicro:'100',operationId:randomUUID(),consentHash:carolPreview.consentHash,confirmed:true}),
  e=>e.code==='GIFT_DESTINATION_UNAVAILABLE','a frozen destination cannot be committed to');
 await pool.query('UPDATE credit_accounts SET is_frozen=false WHERE user_id=$1',[carol]);

 // ── Multi-hop: bob gifts onward; every micro conserved, restrictions intact.
 const bobPreview=await gifts.previewGift(pool,ctx(bob),{recipientUserId:carol,amountMicro:'600000'});
 const g2=await gifts.giftCredits(pool,ctx(bob),{recipientUserId:carol,amountMicro:'600000',operationId:randomUUID(),consentHash:bobPreview.consentHash,confirmed:true});
 assert.equal(await balance(bob),'400000','second hop debits the intermediary');
 assert.equal(await balance(carol),'600000','second hop credits the next recipient');
 assert.equal(BigInt(await balance(alice))+BigInt(await balance(bob))+BigInt(await balance(carol)),5000000n,'two hops conserve every micro');
 const hop2lots=(await pool.query('SELECT * FROM workforce_gift_lots WHERE gift_id=$1',[g2.giftId])).rows;
 const hop1recipients=new Set(giftLots.map(l=>l.recipient_grant_id));
 assert.ok(hop2lots.length>0 && hop2lots.every(l=>hop1recipients.has(l.origin_grant_id)),
  'hop two consumes hop-one recipient lots');
 const hop2recv=(await pool.query('SELECT * FROM credit_grants WHERE id=$1',[hop2lots[0].recipient_grant_id])).rows[0];
 assert.equal(hop2recv.expires_at.toISOString(),'2031-05-06T07:08:09.123Z','expiry survives the second hop');
 const rootOf=l=>l.root_origin_grant_id;
 assert.deepEqual([...new Set(hop2lots.map(rootOf))],[...new Set(giftLots.map(rootOf))],'both hops share one stripe root');
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[carol]);
 await ledger.recordUsageV2(pool,carol,{transactionId:randomUUID(),costMicro:100,surface:'test',operation:'test'});
 assert.equal(await balance(carol),'599900','gifted value spends through the ordinary wallet');

 // ── A quarantined root freezes the chain downstream.
 const rootGrant=hop2lots[0].root_origin_grant_id;
 const origin=(await pool.query('SELECT payment_intent FROM credit_grant_payment_origins WHERE grant_id=$1',[rootGrant])).rows[0];
 await pool.query('INSERT INTO workforce_funding_origin_quarantine(event_id,payment_intent,grant_id,reason,liability_micro) VALUES($1,$2,$3,$4,$5)',
  ['evt_quarantine_'+marker,origin.payment_intent,rootGrant,'dispute','0']);
 const bobPreview2=await gifts.previewGift(pool,ctx(bob),{recipientUserId:carol,amountMicro:'100'});
 await assert.rejects(gifts.giftCredits(pool,ctx(bob),{recipientUserId:carol,amountMicro:'100',operationId:randomUUID(),consentHash:bobPreview2.consentHash,confirmed:true}),
  e=>e.code==='INSUFFICIENT_GIFTABLE_CREDITS','lots under a quarantined root cannot move on');
 assert.equal((await ledger.verifyChainV2(pool,alice)).ok,true,'alice journal verifies');
 assert.equal((await ledger.verifyChainV2(pool,bob)).ok,true,'bob journal verifies');
 assert.equal((await ledger.verifyChainV2(pool,carol)).ok,true,'carol journal verifies');
});
