// Account gifts (ACCT-03/04): a sender-confirmed transfer of verified micro-credits between
// two canonical user accounts. The service owns identity, consent and idempotency; the money
// moves through the canonical ledger's giftTransferTx in the same transaction.
//
// v1 SCOPE, HONESTLY: human senders spend directly; agent senders spend ONLY through a
// bounded owner approval (ACCT-07, agentSpendApprovals.js) -- the payer is always the
// approval's owner, derived server-side, never a request field (no payer key exists in
// any shape here). Recipients by existing user ID only (no email lookup, no identity
// auto-creation, no claim links); the recipient's LEDGER row is provisioned at zero on
// first receipt, never backfilled; recipient lots are spendable and re-giftable but NOT
// contribution-eligible, because the contribution gate keys on stripe checkout sessions
// and a gift deliberately breaks that chain.
import { resolvePrincipal } from './agentIdentity.js';
import { verifySpendApproval } from './agentSpendApprovals.js';
import { authorityTransaction, operationHash } from './workspaceOperationReceipts.js';
import { giftTransferTx } from '../utils/creditLedgerV2.js';
import { sendEmail } from './emailService.js';

export class GiftError extends Error {
  constructor(code, reason) {
    super(reason); this.name = 'GiftError'; this.code = code;
    this.status = { bad_input:400, denied:403, not_found:404, conflict:409, unavailable:503 }[code] ?? 500;
    this.details = { schemaVersion:1, reason };
  }
}
const fail = (code, reason) => { throw new GiftError(code, reason); };
const uuid = value => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail('bad_input','invalid_id');
  return value.toLowerCase();
};
const amount = v => {
  if (typeof v !== 'string' || !/^[1-9][0-9]{0,17}$/.test(v)) fail('bad_input','invalid_amount');
  return v;
};
const shape = (v, keys) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('bad_input','invalid_shape');
  for (const k of Object.keys(v)) if (!keys.includes(k)) fail('bad_input','unexpected_field');
  for (const k of keys) if (v[k] === undefined) fail('bad_input','missing_field');
  return v;
};
const context = v => {
  shape(v,['actorUserId','clientId']);
  if (typeof v.clientId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(v.clientId)) fail('bad_input','invalid_client');
  return { actorUserId:uuid(v.actorUserId),clientId:v.clientId };
};
async function senderPrincipal(db, actor, { allowAgent = false } = {}) {
  await db.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[actor]);
  const p=await resolvePrincipal(db,actor);
  if (p?.kind==='agent' && !allowAgent) fail('denied','agent_gift_approval_unavailable');
  if (!p?.usable || (p.kind!=='human' && p.kind!=='agent')) fail('denied','usable_human_required');
  return p;
}
// The payer (sender_user_id) is who the money left; the originator is who asked. They
// coincide for humans; for agent gifts the sender is the approval's owner.
const giftOf = (row, replayed) => ({ giftId:row.id, state:row.state, amountMicro:String(row.amount_micro),
  senderUserId:row.sender_user_id, recipientUserId:row.recipient_user_id,
  originatorUserId:row.originator_user_id, approvalId:row.approval_id, replayed });

/** Gift preferences, defaulting to accepting/unpaused when no row exists. Callers that
 * enforce prefs must hold the user's row lock (taken here) so a concurrent preference
 * change serializes against the gift. */
async function prefsOf(db, userId) {
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
  const r=(await db.query('SELECT accepts_unsolicited,gifting_paused FROM workforce_gift_preferences WHERE user_id=$1',[userId])).rows[0];
  return { accepts:r?.accepts_unsolicited ?? true, paused:r?.gifting_paused ?? false };
}

/** Non-receipt notice to the SENDER, after the money transaction has rolled back: the
 * content never distinguishes unknown/opted-out/paused/frozen recipients, so the notice
 * is not an account oracle. Best-effort: mail failure must not rewrite the refusal. */
async function notifyGiftNotReceived(pool, senderId, { recipientDisplay, amountMicro }) {
  try {
    const s=(await pool.query('SELECT email,display_name FROM users WHERE id=$1',[senderId])).rows[0];
    if (!s?.email) return;
    await sendEmail(pool,'gift_not_received',s.email,
      { senderName:s.display_name, recipientDisplay, amountMicro },senderId);
  } catch (e) { console.log(`[Gifts] non-receipt notice failed for ${senderId}: ${e.message}`); }
}

/** Safe recipient-confirmation summary: who (display handle only), how much, and the zero
 * fee -- bound by a consent hash the commit must reproduce. Unknown, ineligible and frozen
 * recipients answer identically, so the preview is not an account oracle. */
export async function previewGift(pool, ctx, value) {
  const a=context(ctx);
  const v=shape(value,'spendApprovalId' in Object(value)
    ? ['recipientUserId','amountMicro','spendApprovalId'] : ['recipientUserId','amountMicro']);
  const recipient=uuid(v.recipientUserId),micro=amount(v.amountMicro);
  const approvalId=v.spendApprovalId===undefined?undefined:uuid(v.spendApprovalId);
  if (recipient===a.actorUserId) fail('denied','self_gift_refused');
  try {
    return await authorityTransaction(pool,async db=>{
      const sender=await senderPrincipal(db,a.actorUserId,{allowAgent:true});
      // Agents preview against a live approval (advisory; the commit re-verifies and
      // consumes). Humans must not name one: there is no delegated authority to narrow.
      let payer=a.actorUserId;
      if (sender.kind==='agent') {
        if (approvalId===undefined) fail('denied','agent_gift_approval_unavailable');
        payer=(await verifySpendApproval(db,{approvalId,agentActor:a.actorUserId,operation:'gift',
          amountMicro:micro,target:{recipientUserId:recipient},consume:false})).ownerUserId;
      } else if (approvalId!==undefined) fail('bad_input','approval_not_for_humans');
      if (recipient===payer) fail('denied','self_gift_refused');
      if ((await prefsOf(db,payer)).paused) fail('denied','gift_sending_paused');
      const r=(await db.query(`SELECT u.id,u.display_name,a.owner_kind,a.is_frozen
        FROM users u LEFT JOIN credit_accounts a ON a.user_id=u.id
        WHERE u.id=$1 FOR UPDATE OF u`,[recipient])).rows[0];
      const p=r && await resolvePrincipal(db,recipient);
      if (!r || !p?.usable || p.kind!=='human') fail('not_found','gift_recipient_unavailable');
      if (r.owner_kind!=null && (r.owner_kind!=='user' || r.is_frozen)) fail('refused','gift_recipient_not_accepting');
      const rp=await prefsOf(db,recipient);
      if (!rp.accepts || rp.paused) fail('refused','gift_recipient_not_accepting');
      return { recipient:{ userId:r.id, displayName:r.display_name }, amountMicro:micro, feeMicro:'0',
        consentHash:operationHash({ recipient:recipient, amountMicro:micro }) };
    });
  } catch (e) {
    if (e.code==='refused' && e.details?.reason==='gift_recipient_not_accepting') {
      await notifyGiftNotReceived(pool,a.actorUserId,{ recipientDisplay:'the recipient', amountMicro:micro });
      fail('not_found','gift_recipient_unavailable');
    }
    throw e;
  }
}

export async function giftCredits(pool, ctx, value) {
  const a=context(ctx);
  const v=shape(value,'spendApprovalId' in Object(value)
    ? ['recipientUserId','amountMicro','operationId','consentHash','confirmed','spendApprovalId']
    : ['recipientUserId','amountMicro','operationId','consentHash','confirmed']);
  if (v.confirmed!==true || typeof v.consentHash!=='string' || !/^[a-f0-9]{64}$/.test(v.consentHash)) fail('bad_input','explicit_confirmation_required');
  const input={recipientUserId:uuid(v.recipientUserId),amountMicro:amount(v.amountMicro),
    operationId:uuid(v.operationId),consentHash:v.consentHash,
    spendApprovalId:v.spendApprovalId===undefined?undefined:uuid(v.spendApprovalId)};
  if (operationHash({ recipient:input.recipientUserId, amountMicro:input.amountMicro })!==input.consentHash) fail('conflict','gift_terms_changed');
  if (input.recipientUserId===a.actorUserId) fail('denied','self_gift_refused');
  try {
  return await authorityTransaction(pool,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`gift-actor:${a.actorUserId}`]);
    const sender=await senderPrincipal(db,a.actorUserId,{allowAgent:true});
    // The payer is structural, not approved: a human pays for themselves, an agent's
    // owner pays for it. The approval still gates every micro below; deriving the
    // payer here lets the replay check run BEFORE any approval state is touched, so
    // a retried operation replays its receipt even against an exhausted approval.
    let payer=a.actorUserId,approvalId=null;
    if (sender.kind==='agent') {
      if (input.spendApprovalId===undefined) fail('denied','agent_gift_approval_unavailable');
      approvalId=input.spendApprovalId;
      payer=sender.owner.id;
    } else if (input.spendApprovalId!==undefined) fail('bad_input','approval_not_for_humans');
    if (input.recipientUserId===payer) fail('denied','self_gift_refused');
    if ((await prefsOf(db,payer)).paused) fail('denied','gift_sending_paused');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`gift:${a.actorUserId}:${a.clientId}:${input.operationId}`]);
    const prior=(await db.query('SELECT * FROM workforce_gifts WHERE sender_user_id=$1 AND originator_user_id=$2 AND client_id=$3 AND operation_id=$4',
      [payer,a.actorUserId,a.clientId,input.operationId])).rows[0];
    const hash=operationHash({ recipientUserId:input.recipientUserId, amountMicro:input.amountMicro, operationId:input.operationId });
    if (prior) { if (prior.request_hash!==hash) fail('conflict','operation_payload_conflict'); return giftOf(prior,true); }
    // The recipient is re-verified at commit: identity must exist (no money into the void),
    // stay usable, and stay accepting -- preview is advisory and preferences can flip.
    const r=(await db.query(`SELECT u.id,a.owner_kind,a.is_frozen
      FROM users u LEFT JOIN credit_accounts a ON a.user_id=u.id
      WHERE u.id=$1 FOR UPDATE OF u`,[input.recipientUserId])).rows[0];
    const p=r && await resolvePrincipal(db,input.recipientUserId);
    if (!r || !p?.usable || p.kind!=='human') fail('not_found','gift_recipient_unavailable');
    if (r.owner_kind!=null && (r.owner_kind!=='user' || r.is_frozen)) fail('refused','gift_recipient_not_accepting');
    const rp=await prefsOf(db,input.recipientUserId);
    if (!rp.accepts || rp.paused) fail('refused','gift_recipient_not_accepting');
    // First receipt provisions the recipient's ledger row at ZERO -- never backfilled from a
    // legacy label (FUND-17). Identity must already exist; only the money row is new.
    await db.query(`INSERT INTO credit_accounts(user_id,owner_kind,balance) VALUES($1,'user',0)
      ON CONFLICT(user_id) DO NOTHING`,[input.recipientUserId]);
    // The approval is consumed AFTER the replay check (a retried operation replays its
    // receipt without double-consuming) and BEFORE the money moves, under FOR UPDATE.
    // The consuming owner must still be the derived payer: ownership is re-resolved
    // live, and drift between the two observations fails closed.
    if (approvalId!==null) {
      const funding=(await verifySpendApproval(db,{approvalId,agentActor:a.actorUserId,operation:'gift',
        amountMicro:input.amountMicro,target:{recipientUserId:input.recipientUserId},consume:true})).ownerUserId;
      if (funding!==payer) fail('denied','spend_approval_owner_check_failed');
    }
    const row=(await db.query(`INSERT INTO workforce_gifts(sender_user_id,recipient_user_id,originator_user_id,approval_id,client_id,operation_id,request_hash,amount_micro)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [payer,input.recipientUserId,a.actorUserId,approvalId,a.clientId,input.operationId,hash,input.amountMicro])).rows[0];
    await giftTransferTx(db,{ giftId:row.id, senderId:payer, recipientId:input.recipientUserId, amountMicro:input.amountMicro });
    return giftOf(row,false);
  });
  } catch (e) {
    if (e.code==='refused' && e.details?.reason==='gift_recipient_not_accepting') {
      await notifyGiftNotReceived(pool,a.actorUserId,{ recipientDisplay:'the recipient', amountMicro:input.amountMicro });
      throw Object.assign(new Error('Gift destination unavailable'),{ code:'GIFT_DESTINATION_UNAVAILABLE' });
    }
    throw e;
  }
}

/** Return preview: the original gift, the unreturned remainder, and the consent binding.
 * Only the gift's recipient may return it; the sender cannot cancel (there is no cancel
 * path -- gifts are terminal 'completed' -- and returns move only through here). */
export async function previewGiftReturn(pool, ctx, value) {
  const a=context(ctx),v=shape(value,['giftId','amountMicro']);
  const giftId=uuid(v.giftId),micro=amount(v.amountMicro);
  return authorityTransaction(pool,async db=>{
    await senderPrincipal(db,a.actorUserId);
    const g=(await db.query('SELECT * FROM workforce_gifts WHERE id=$1 FOR SHARE',[giftId])).rows[0];
    if (!g) fail('not_found','gift_not_found');
    if (g.recipient_user_id!==a.actorUserId) fail('denied','gift_return_recipient_only');
    const returned=(await db.query('SELECT COALESCE(SUM(amount_micro),0)::text AS total FROM workforce_gift_returns WHERE gift_id=$1',[giftId])).rows[0].total;
    const remainder=BigInt(g.amount_micro)-BigInt(returned);
    if (BigInt(micro)>remainder) fail('denied','gift_return_exceeds_remainder');
    return { giftId:g.id, returnsTo:g.sender_user_id, amountMicro:micro, feeMicro:'0',
      remainderMicro:String(remainder),
      consentHash:operationHash({ returnsGift:giftId, recipient:g.sender_user_id, amountMicro:micro }) };
  });
}

async function reverseGiftTx(db, a, { giftId, micro, operationId, kind, reason, reversedBy }) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`gift-return:${giftId}`]);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`gift:${a.actorUserId}:${a.clientId}:${operationId}`]);
  const g=(await db.query('SELECT * FROM workforce_gifts WHERE id=$1 FOR UPDATE',[giftId])).rows[0];
  if (!g) fail('not_found','gift_not_found');
  const hash=operationHash({ recipientUserId:g.sender_user_id, amountMicro:micro, operationId, returnsGift:giftId });
  // Uncertain retries reconcile by identity BEFORE state guards: a committed return must
  // replay its receipt, not fail the remainder check its own completion caused (ACCT-05).
  const prior=(await db.query('SELECT * FROM workforce_gifts WHERE sender_user_id=$1 AND originator_user_id=$2 AND client_id=$3 AND operation_id=$4',
    [a.actorUserId,a.actorUserId,a.clientId,operationId])).rows[0];
  if (prior) {
    if (prior.request_hash!==hash) fail('conflict','operation_payload_conflict');
    const link=(await db.query('SELECT * FROM workforce_gift_returns WHERE return_gift_id=$1',[prior.id])).rows[0];
    return { ...giftOf(prior,true), returnsGift:giftId, kind:link.kind };
  }
  const returned=(await db.query('SELECT COALESCE(SUM(amount_micro),0)::text AS total FROM workforce_gift_returns WHERE gift_id=$1',[giftId])).rows[0].total;
  if (BigInt(micro)>BigInt(g.amount_micro)-BigInt(returned)) fail('denied','gift_return_exceeds_remainder');
  const row=(await db.query(`INSERT INTO workforce_gifts(sender_user_id,recipient_user_id,originator_user_id,client_id,operation_id,request_hash,amount_micro)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [a.actorUserId,g.sender_user_id,a.actorUserId,a.clientId,operationId,hash,micro])).rows[0];
  await giftTransferTx(db,{ giftId:row.id, senderId:a.actorUserId, recipientId:g.sender_user_id, amountMicro:micro, forDisputeReversal:kind==='dispute_reversal' });
  const link=(await db.query(`INSERT INTO workforce_gift_returns(gift_id,return_gift_id,reversed_by_user_id,kind,reason,amount_micro)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[giftId,row.id,reversedBy,kind,reason,micro])).rows[0];
  return { ...giftOf(row,false), returnsGift:giftId, kind:link.kind };
}

/** Recipient-initiated return: a separately authorized reverse gift over the same rails,
 * linked to the original and capped at its unreturned remainder. */
export async function returnGift(pool, ctx, value) {
  const a=context(ctx),v=shape(value,['giftId','amountMicro','operationId','consentHash','confirmed']);
  if (v.confirmed!==true || typeof v.consentHash!=='string' || !/^[a-f0-9]{64}$/.test(v.consentHash)) fail('bad_input','explicit_confirmation_required');
  const input={giftId:uuid(v.giftId),amountMicro:amount(v.amountMicro),operationId:uuid(v.operationId),consentHash:v.consentHash};
  return authorityTransaction(pool,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`gift-actor:${a.actorUserId}`]);
    await senderPrincipal(db,a.actorUserId);
    const g=(await db.query('SELECT sender_user_id,recipient_user_id FROM workforce_gifts WHERE id=$1 FOR SHARE',[input.giftId])).rows[0];
    if (!g) fail('not_found','gift_not_found');
    if (g.recipient_user_id!==a.actorUserId) fail('denied','gift_return_recipient_only');
    if ((await prefsOf(db,a.actorUserId)).paused) fail('denied','gift_return_paused');
    if ((await prefsOf(db,g.sender_user_id)).paused) fail('denied','gift_return_paused');
    if (operationHash({ returnsGift:input.giftId, recipient:g.sender_user_id, amountMicro:input.amountMicro })!==input.consentHash) fail('conflict','gift_terms_changed');
    return reverseGiftTx(db,a,{ giftId:input.giftId, micro:input.amountMicro, operationId:input.operationId,
      kind:'recipient_return', reason:'recipient-initiated return', reversedBy:a.actorUserId });
  });
}

/** Dispute reversal: an authorized operator appends a justified reversal over the same
 * rails. Authority is the DB-backed platform admin role; justification is a recorded reason.
 * The dispute WORKFLOW (filing, evidence, SLA) is out of scope -- this is the append.
 * Reversals bypass gift pause deliberately: pause is the dispute tool, reversal its remedy. */
export async function disputeReverseGift(pool, ctx, value) {
  const a=context(ctx),v=shape(value,['giftId','amountMicro','reason','operationId']);
  const input={giftId:uuid(v.giftId),amountMicro:amount(v.amountMicro),operationId:uuid(v.operationId)};
  if (typeof v.reason!=='string' || !v.reason.trim() || v.reason.includes('\0') || Buffer.byteLength(v.reason)>1000) fail('bad_input','gift_reversal_reason_required');
  const reason=v.reason.trim();
  return authorityTransaction(pool,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`gift-actor:${a.actorUserId}`]);
    await senderPrincipal(db,a.actorUserId);
    const role=(await db.query('SELECT role FROM users WHERE id=$1 FOR SHARE',[a.actorUserId])).rows[0]?.role;
    if (role!=='admin') fail('denied','gift_dispute_admin_only');
    const g=(await db.query('SELECT sender_user_id,recipient_user_id FROM workforce_gifts WHERE id=$1 FOR SHARE',[input.giftId])).rows[0];
    if (!g) fail('not_found','gift_not_found');
    // The reversal debits the RECIPIENT's value back to the sender; the operator authorizes
    // but never pays. Idempotency keys on (recipient, client, operation) like any return,
    // so a concurrent recipient return and dispute reversal serialize on the remainder.
    return reverseGiftTx(db,{ actorUserId:g.recipient_user_id, clientId:a.clientId },
      { giftId:input.giftId, micro:input.amountMicro, operationId:input.operationId,
        kind:'dispute_reversal', reason, reversedBy:a.actorUserId });
  });
}

/** Gift preferences: anyone sets their own; only an admin sets another account's (the
 * dispute-pause tool). An admin-set pause sticks: the account cannot clear a pause someone
 * else imposed. */
export async function setGiftPreferences(pool, ctx, value) {
  const a=context(ctx),v=shape(value,['targetUserId','acceptsUnsolicited','giftingPaused']);
  const target=uuid(v.targetUserId);
  for (const k of ['acceptsUnsolicited','giftingPaused']) if (typeof v[k]!=='boolean') fail('bad_input','invalid_preference');
  return authorityTransaction(pool,async db=>{
    await senderPrincipal(db,a.actorUserId);
    if (target!==a.actorUserId) {
      const role=(await db.query('SELECT role FROM users WHERE id=$1 FOR SHARE',[a.actorUserId])).rows[0]?.role;
      if (role!=='admin') fail('denied','gift_preference_admin_only');
      if (!(await db.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[target])).rows[0]) fail('not_found','gift_recipient_unavailable');
    }
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[target]);
    const role=(await db.query('SELECT role FROM users WHERE id=$1 FOR SHARE',[a.actorUserId])).rows[0]?.role;
    const existing=(await db.query('SELECT gifting_paused,gifting_paused_by FROM workforce_gift_preferences WHERE user_id=$1 FOR UPDATE',[target])).rows[0];
    if (existing?.gifting_paused && !v.giftingPaused && existing.gifting_paused_by
      && existing.gifting_paused_by!==a.actorUserId && role!=='admin') fail('denied','gift_preference_admin_only');
    const row=(await db.query(`INSERT INTO workforce_gift_preferences(user_id,accepts_unsolicited,gifting_paused,gifting_paused_by,updated_at)
      VALUES($1,$2,$3,$4,now()) ON CONFLICT(user_id) DO UPDATE SET accepts_unsolicited=$2,gifting_paused=$3,gifting_paused_by=$4,updated_at=now() RETURNING *`,
      [target,v.acceptsUnsolicited,v.giftingPaused,v.giftingPaused?a.actorUserId:null])).rows[0];
    return { userId:row.user_id, acceptsUnsolicited:row.accepts_unsolicited, giftingPaused:row.gifting_paused };
  });
}

/** Gift events for account history: everything the caller sent or received, newest first,
 * with direction, counterparty handle, amount, state and return linkage. Callers see only
 * their own side; asking for another account's history is refused. */
export async function listGiftHistory(pool, ctx, value) {
  const a=context(ctx),v=shape(value,['limit']);
  const limit=Number(v.limit);
  if (!Number.isInteger(limit) || limit<1 || limit>200) fail('bad_input','invalid_limit');
  return authorityTransaction(pool,async db=>{
    await senderPrincipal(db,a.actorUserId);
    const { rows }=(await db.query(`SELECT g.id,g.sender_user_id,g.recipient_user_id,g.amount_micro,g.state,g.created_at,
        CASE WHEN g.sender_user_id=$1 THEN 'sent' ELSE 'received' END AS direction,
        CASE WHEN g.sender_user_id=$1 THEN ru.display_name ELSE su.display_name END AS counterparty,
        r.kind AS return_kind, r.reason AS return_reason
      FROM workforce_gifts g
      JOIN users su ON su.id=g.sender_user_id
      JOIN users ru ON ru.id=g.recipient_user_id
      LEFT JOIN workforce_gift_returns r ON r.return_gift_id=g.id
      WHERE g.sender_user_id=$1 OR g.recipient_user_id=$1
      ORDER BY g.created_at DESC, g.id DESC LIMIT $2`,[a.actorUserId,limit]));
    return rows.map(r=>({ giftId:r.id, direction:r.direction, counterparty:r.counterparty,
      amountMicro:String(r.amount_micro), state:r.state, createdAt:r.created_at.toISOString(),
      returnKind:r.return_kind, returnReason:r.return_reason }));
  });
}
