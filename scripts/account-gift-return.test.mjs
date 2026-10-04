// ACCT-05 against real PostgreSQL: completed gifts are terminal; value flows back only
// through a linked, authorized reversal over the same rails.
//
// PROVEN: no cancel path exists (schema terminal + no cancel export); a stranger cannot
// return; the recipient previews (remainder shown) and returns partially, then fully;
// over-returns refused; return replays share one receipt and concurrent duplicates land
// once; dispute reversal requires the platform admin role plus a recorded reason, debits
// the recipient (never the operator), and links kind + justification; conservation holds
// across gift, return and reversal.
// OUT OF SCOPE (stated): the dispute workflow itself (filing, evidence, SLA) -- this is
// the justified append the requirement asks for, not the case-management system.
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
const {operationHash}=await import('../src/server/services/workspaceOperationReceipts.js');
const ledger=await import('../src/server/utils/creditLedgerV2.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');

test('ACCT-05: gifts are terminal; returns and dispute reversals are linked and authorized',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`ret-${randomUUID().slice(0,8)}`;
 const user=async(s,role='user')=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash,role) VALUES($1,$2,$1,'test',$3) RETURNING id",[x,x+'@example.test',role])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob'),carol=await user('carol'),admin=await user('admin','admin');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:alice,customer:'cus_'+mk,
 amount_total:500,currency:'eur',metadata:{xenoUserId:alice,credits:'5',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 const balance=async userId=>(await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1',[userId])).rows[0]?.balance ?? '0';
 const preview=await gifts.previewGift(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000'});
 const g1=await gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'1000000',operationId:randomUUID(),consentHash:preview.consentHash,confirmed:true});

 // ── Terminal: no cancel path, no cancel state.
 assert.equal(gifts.cancelGift,undefined,'no cancel export exists');
 await assert.rejects(pool.query("UPDATE workforce_gifts SET state='cancelled' WHERE id=$1",[g1.giftId]),
  {code:'23514'},'completed is terminal at the schema level');
 await assert.rejects(gifts.previewGiftReturn(pool,ctx(carol),{giftId:g1.giftId,amountMicro:'100'}),
  e=>e.details?.reason==='gift_return_recipient_only','a stranger cannot preview a return');
 const strangerHash=operationHash({returnsGift:g1.giftId,recipient:alice,amountMicro:'100'});
 await assert.rejects(gifts.returnGift(pool,ctx(carol),{giftId:g1.giftId,amountMicro:'100',operationId:randomUUID(),consentHash:strangerHash,confirmed:true}),
  e=>e.details?.reason==='gift_return_recipient_only','a stranger cannot return, even with a well-formed consent');

 // ── Recipient return: partial, then the rest; over-returns refused.
 const rp1=await gifts.previewGiftReturn(pool,ctx(bob),{giftId:g1.giftId,amountMicro:'400000'});
 assert.deepEqual([rp1.returnsTo,rp1.remainderMicro],[alice,'1000000'],'preview shows the destination and full remainder');
 const r1=await gifts.returnGift(pool,ctx(bob),{giftId:g1.giftId,amountMicro:'400000',operationId:randomUUID(),consentHash:rp1.consentHash,confirmed:true});
 assert.deepEqual([r1.kind,r1.returnsGift],['recipient_return',g1.giftId],'the return links its original');
 assert.equal(await balance(alice),'4400000','partial return credits the sender');
 assert.equal(await balance(bob),'600000','partial return debits the recipient');
 const rp2=await gifts.previewGiftReturn(pool,ctx(bob),{giftId:g1.giftId,amountMicro:'600000'});
 assert.equal(rp2.remainderMicro,'600000','remainder shrinks by prior returns');
 await assert.rejects(gifts.previewGiftReturn(pool,ctx(bob),{giftId:g1.giftId,amountMicro:'600001'}),
  e=>e.details?.reason==='gift_return_exceeds_remainder','preview refuses over-returns');
 const rop=randomUUID();
 const [ra,rb]=await Promise.allSettled([
  gifts.returnGift(pool,ctx(bob),{giftId:g1.giftId,amountMicro:'600000',operationId:rop,consentHash:rp2.consentHash,confirmed:true}),
  gifts.returnGift(pool,ctx(bob),{giftId:g1.giftId,amountMicro:'600000',operationId:rop,consentHash:rp2.consentHash,confirmed:true}),
 ]);
 assert.ok(ra.status==='fulfilled'&&rb.status==='fulfilled','same-ID concurrent returns reconcile to one receipt');
 assert.equal(ra.value.returnGiftId ?? ra.value.giftId,rb.value.returnGiftId ?? rb.value.giftId,'both callers see the same return gift');
 assert.equal([ra.value.replayed,rb.value.replayed].filter(Boolean).length,1,'exactly one replays');
 assert.equal(await balance(alice),'5000000','full return restores the sender');
 assert.equal(await balance(bob),'0','full return empties the recipient');
 await assert.rejects(gifts.previewGiftReturn(pool,ctx(bob),{giftId:g1.giftId,amountMicro:'1'}),
  e=>e.details?.reason==='gift_return_exceeds_remainder','nothing left to return');
 // Preview is advisory: a consent hash spent by one commit cannot fund a second.
 const preview3=await gifts.previewGift(pool,ctx(alice),{recipientUserId:bob,amountMicro:'200000'});
 const g3=await gifts.giftCredits(pool,ctx(alice),{recipientUserId:bob,amountMicro:'200000',operationId:randomUUID(),consentHash:preview3.consentHash,confirmed:true});
 const rp3=await gifts.previewGiftReturn(pool,ctx(bob),{giftId:g3.giftId,amountMicro:'200000'});
 await gifts.returnGift(pool,ctx(bob),{giftId:g3.giftId,amountMicro:'200000',operationId:randomUUID(),consentHash:rp3.consentHash,confirmed:true});
 await assert.rejects(gifts.returnGift(pool,ctx(bob),{giftId:g3.giftId,amountMicro:'200000',operationId:randomUUID(),consentHash:rp3.consentHash,confirmed:true}),
  e=>e.details?.reason==='gift_return_exceeds_remainder','the commit rechecks the remainder: stale consents cannot double-return');

 // ── Dispute reversal: admin + reason, debits the recipient, links justification.
 const preview2=await gifts.previewGift(pool,ctx(alice),{recipientUserId:carol,amountMicro:'500000'});
 const g2=await gifts.giftCredits(pool,ctx(alice),{recipientUserId:carol,amountMicro:'500000',operationId:randomUUID(),consentHash:preview2.consentHash,confirmed:true});
 await assert.rejects(gifts.disputeReverseGift(pool,ctx(bob),{giftId:g2.giftId,amountMicro:'100',reason:'not my call',operationId:randomUUID()}),
  e=>e.details?.reason==='gift_dispute_admin_only','non-operators cannot reverse');
 await assert.rejects(gifts.disputeReverseGift(pool,ctx(admin),{giftId:g2.giftId,amountMicro:'100',reason:'  ',operationId:randomUUID()}),
  e=>e.details?.reason==='gift_reversal_reason_required','reversals without justification refused');
 const adminBefore=await balance(admin);
 const rev=await gifts.disputeReverseGift(pool,ctx(admin),{giftId:g2.giftId,amountMicro:'500000',reason:'chargeback pi_'+mk+' upheld',operationId:randomUUID()});
 assert.equal(rev.kind,'dispute_reversal','the reversal links as a dispute');
 assert.equal(await balance(carol),'0','reversal debits the recipient');
 assert.equal(await balance(alice),'5000000','reversal credits the sender');
 assert.equal(await balance(admin),adminBefore,'the operator never pays');
 const link=(await pool.query('SELECT * FROM workforce_gift_returns WHERE return_gift_id=$1',[rev.giftId])).rows[0];
 assert.deepEqual([link.gift_id,link.kind,link.reversed_by_user_id],[g2.giftId,'dispute_reversal',admin],'link records original, kind and operator');
 assert.ok(link.reason.includes('chargeback'),'justification is recorded');
 assert.equal(BigInt(await balance(alice))+BigInt(await balance(bob))+BigInt(await balance(carol)),5000000n,'gift, returns and reversal conserve every micro');
 assert.equal((await ledger.verifyChainV2(pool,alice)).ok,true,'alice journal verifies');
 assert.equal((await ledger.verifyChainV2(pool,bob)).ok,true,'bob journal verifies');
});
