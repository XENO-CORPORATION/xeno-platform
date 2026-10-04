// Account gifts (ACCT-03/04): a sender-confirmed transfer of verified micro-credits between
// two canonical user accounts. The service owns identity, consent and idempotency; the money
// moves through the canonical ledger's giftTransferTx in the same transaction.
//
// v1 SCOPE, HONESTLY: human senders only (agent-originated gifts need the bounded-approval
// path ACCT-07 requires, which does not exist -- agents are refused explicitly, not silently);
// recipients by existing user ID only (no email lookup, no identity auto-creation, no claim
// links); the recipient's LEDGER row is provisioned at zero on first receipt, never backfilled;
// recipient lots are spendable and re-giftable but NOT contribution-eligible, because the
// contribution gate keys on stripe checkout sessions and a gift deliberately breaks that chain.
import { resolvePrincipal } from './agentIdentity.js';
import { authorityTransaction, operationHash } from './workspaceOperationReceipts.js';
import { giftTransferTx } from '../utils/creditLedgerV2.js';

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
async function senderPrincipal(db, actor) {
  await db.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[actor]);
  const p=await resolvePrincipal(db,actor);
  if (p?.kind==='agent') fail('denied','agent_gift_approval_unavailable');
  if (!p?.usable || p.kind!=='human') fail('denied','usable_human_required');
  return p;
}
const giftOf = (row, replayed) => ({ giftId:row.id, state:row.state, amountMicro:String(row.amount_micro),
  senderUserId:row.sender_user_id, recipientUserId:row.recipient_user_id, replayed });

/** Safe recipient-confirmation summary: who (display handle only), how much, and the zero
 * fee -- bound by a consent hash the commit must reproduce. Unknown, ineligible and frozen
 * recipients answer identically, so the preview is not an account oracle. */
export async function previewGift(pool, ctx, value) {
  const a=context(ctx),v=shape(value,['recipientUserId','amountMicro']);
  const recipient=uuid(v.recipientUserId),micro=amount(v.amountMicro);
  if (recipient===a.actorUserId) fail('denied','self_gift_refused');
  return authorityTransaction(pool,async db=>{
    await senderPrincipal(db,a.actorUserId);
    const r=(await db.query(`SELECT u.id,u.display_name,a.owner_kind,a.is_frozen
      FROM users u LEFT JOIN credit_accounts a ON a.user_id=u.id
      WHERE u.id=$1 FOR SHARE OF u`,[recipient])).rows[0];
    const p=r && await resolvePrincipal(db,recipient);
    if (!r || !p?.usable || p.kind!=='human') fail('not_found','gift_recipient_unavailable');
    if (r.owner_kind!=null && (r.owner_kind!=='user' || r.is_frozen)) fail('not_found','gift_recipient_unavailable');
    return { recipient:{ userId:r.id, displayName:r.display_name }, amountMicro:micro, feeMicro:'0',
      consentHash:operationHash({ recipient:recipient, amountMicro:micro }) };
  });
}

export async function giftCredits(pool, ctx, value) {
  const a=context(ctx),v=shape(value,['recipientUserId','amountMicro','operationId','consentHash','confirmed']);
  if (v.confirmed!==true || typeof v.consentHash!=='string' || !/^[a-f0-9]{64}$/.test(v.consentHash)) fail('bad_input','explicit_confirmation_required');
  const input={recipientUserId:uuid(v.recipientUserId),amountMicro:amount(v.amountMicro),
    operationId:uuid(v.operationId),consentHash:v.consentHash};
  if (operationHash({ recipient:input.recipientUserId, amountMicro:input.amountMicro })!==input.consentHash) fail('conflict','gift_terms_changed');
  if (input.recipientUserId===a.actorUserId) fail('denied','self_gift_refused');
  return authorityTransaction(pool,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`gift-actor:${a.actorUserId}`]);
    await senderPrincipal(db,a.actorUserId);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`gift:${a.actorUserId}:${a.clientId}:${input.operationId}`]);
    const prior=(await db.query('SELECT * FROM workforce_gifts WHERE sender_user_id=$1 AND client_id=$2 AND operation_id=$3',
      [a.actorUserId,a.clientId,input.operationId])).rows[0];
    const hash=operationHash({ recipientUserId:input.recipientUserId, amountMicro:input.amountMicro, operationId:input.operationId });
    if (prior) { if (prior.request_hash!==hash) fail('conflict','operation_payload_conflict'); return giftOf(prior,true); }
    // First receipt provisions the recipient's ledger row at ZERO -- never backfilled from a
    // legacy label (FUND-17). Identity must already exist; only the money row is new.
    await db.query(`INSERT INTO credit_accounts(user_id,owner_kind,balance) VALUES($1,'user',0)
      ON CONFLICT(user_id) DO NOTHING`,[input.recipientUserId]);
    const row=(await db.query(`INSERT INTO workforce_gifts(sender_user_id,recipient_user_id,client_id,operation_id,request_hash,amount_micro)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [a.actorUserId,input.recipientUserId,a.clientId,input.operationId,hash,input.amountMicro])).rows[0];
    await giftTransferTx(db,{ giftId:row.id, senderId:a.actorUserId, recipientId:input.recipientUserId, amountMicro:input.amountMicro });
    return giftOf(row,false);
  });
}
