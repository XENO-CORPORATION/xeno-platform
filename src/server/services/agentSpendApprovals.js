// Bounded spend approvals (ACCT-07): the one path by which an agent moves money.
// The owner -- a usable human -- grants an approval naming one agent, one operation,
// a maximum amount, an expiry and an optional target. Every spend re-resolves the
// agent's CURRENT owner inside the spending transaction: ownership drift, suspension,
// revocation or expiry kills the approval even mid-flight. Delegated identity narrows
// authorization; it never replaces the owner checks.
//
// Both money paths (gifts, contributions) consume through verifySpendApproval, so the
// refusal taxonomy is one shared typed surface, not two coinciding ones.
import { resolvePrincipal } from './agentIdentity.js';
import { authorityTransaction, operationHash } from './workspaceOperationReceipts.js';

export class ApprovalError extends Error {
  constructor(code, reason) {
    super(reason); this.name = 'ApprovalError'; this.code = code;
    this.status = { bad_input:400, denied:403, not_found:404, conflict:409, unavailable:503 }[code] ?? 500;
    this.details = { schemaVersion:1, reason };
  }
}
const fail = (code, reason) => { throw new ApprovalError(code, reason); };
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
// An approval is bounded in time as well as money: at most 30 days out, always in
// the future. "Until revoked" is not a bound an auditor can verify up front.
const MAX_APPROVAL_MS = 30 * 24 * 3600 * 1000;
const expires = v => {
  if (typeof v !== 'string') fail('bad_input','invalid_expiry');
  const t = new Date(v).getTime();
  if (!Number.isFinite(t) || t <= Date.now() || t - Date.now() > MAX_APPROVAL_MS) fail('bad_input','invalid_expiry');
  return new Date(t).toISOString();
};
// Targets narrow an approval to one destination. Unknown keys are refused: an
// approval must not silently ignore a bound its granter thought it set.
const TARGET_KEYS = { gift:['recipientUserId'], contribute:['campaignId','milestoneId'] };
const target = (operation, v) => {
  if (v === undefined) return {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('bad_input','invalid_target');
  const allowed = TARGET_KEYS[operation];
  for (const k of Object.keys(v)) if (!allowed.includes(k)) fail('bad_input','unexpected_target');
  const out = {};
  for (const k of allowed) if (v[k] !== undefined) out[k] = uuid(v[k]);
  return out;
};

const approvalOf = (row, replayed) => ({ approvalId:row.id, ownerUserId:row.owner_user_id,
  agentUserId:row.agent_user_id, operation:row.operation, maxAmountMicro:String(row.max_amount_micro),
  spentAmountMicro:String(row.spent_amount_micro), remainingMicro:String(BigInt(row.max_amount_micro)-BigInt(row.spent_amount_micro)),
  target:row.target, expiresAt:new Date(row.expires_at).toISOString(), state:row.state, replayed });

async function ownerHuman(db, actor) {
  await db.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[actor]);
  const p = await resolvePrincipal(db,actor);
  if (!p?.usable || p.kind !== 'human') fail('denied','usable_human_required');
  return p;
}

/** The owner grants a bounded approval to one of their agents. Replay-safe. */
export async function grantSpendApproval(pool, ctx, value) {
  const a = context(ctx);
  const v0 = { ...value };
  const hasTarget = 'target' in v0;
  const v = shape(value, hasTarget
    ? ['agentUserId','operation','maxAmountMicro','expiresAt','operationId','target']
    : ['agentUserId','operation','maxAmountMicro','expiresAt','operationId']);
  if (v.operation !== 'gift' && v.operation !== 'contribute') fail('bad_input','invalid_operation');
  const input = { agentUserId:uuid(v.agentUserId), operation:v.operation, maxAmountMicro:amount(v.maxAmountMicro),
    expiresAt:expires(v.expiresAt), operationId:uuid(v.operationId), target:target(v.operation, v.target) };
  return authorityTransaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`approval:${a.actorUserId}:${a.clientId}:${input.operationId}`]);
    await ownerHuman(db, a.actorUserId);
    const agent = await resolvePrincipal(db, input.agentUserId);
    if (!agent || agent.kind !== 'agent' || !agent.usable) fail('not_found','approval_agent_unavailable');
    if (agent.owner.id !== a.actorUserId) fail('denied','approval_agent_not_yours');
    const prior = (await db.query('SELECT * FROM workforce_spend_approvals WHERE owner_user_id=$1 AND client_id=$2 AND operation_id=$3',
      [a.actorUserId, a.clientId, input.operationId])).rows[0];
    const hash = operationHash(input);
    if (prior) { if (prior.request_hash !== hash) fail('conflict','operation_payload_conflict'); return approvalOf(prior, true); }
    const row = (await db.query(`INSERT INTO workforce_spend_approvals
      (owner_user_id,agent_user_id,client_id,operation_id,request_hash,operation,max_amount_micro,target,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [a.actorUserId, input.agentUserId, a.clientId, input.operationId, hash, input.operation, input.maxAmountMicro,
        JSON.stringify(input.target), input.expiresAt])).rows[0];
    return approvalOf(row, false);
  });
}

/** The owner revokes their approval. Revocation is immediate and permanent. */
export async function revokeSpendApproval(pool, ctx, value) {
  const a = context(ctx), v = shape(value,['approvalId']);
  const approvalId = uuid(v.approvalId);
  return authorityTransaction(pool, async db => {
    await ownerHuman(db, a.actorUserId);
    const row = (await db.query('SELECT * FROM workforce_spend_approvals WHERE id=$1 FOR UPDATE',[approvalId])).rows[0];
    if (!row) fail('not_found','spend_approval_not_found');
    if (row.owner_user_id !== a.actorUserId) fail('denied','approval_not_yours');
    if (row.state === 'active') {
      const next = (await db.query("UPDATE workforce_spend_approvals SET state='revoked',updated_at=now() WHERE id=$1 RETURNING *",[approvalId])).rows[0];
      return approvalOf(next, false);
    }
    return approvalOf(row, true);
  });
}

/** The shared spend gate. Both money paths call this inside their transaction --
 * with consume=true at commit, consume=false at preview (advisory only; the commit
 * re-verifies). Returns the payer: always the approval's owner, never a request field. */
export async function verifySpendApproval(db, { approvalId, agentActor, operation, amountMicro, target: spendTarget = {}, consume }) {
  const row = (await db.query(`SELECT * FROM workforce_spend_approvals WHERE id=$1 ${consume ? 'FOR UPDATE' : 'FOR SHARE'}`,
    [uuid(approvalId)])).rows[0];
  if (!row) fail('not_found','spend_approval_not_found');
  if (row.operation !== operation) fail('denied','spend_approval_wrong_operation');
  if (row.agent_user_id !== agentActor) fail('denied','spend_approval_wrong_agent');
  // The owner check is re-resolved NOW, from the agent's live identity row -- a grant
  // recorded at approval time would let a re-owned or retired agent keep spending.
  // Owner usability rides the same resolution: a suspended owner makes their agents
  // unusable (the identity cascade), so there is no separate owner branch to drift.
  const agent = await resolvePrincipal(db, agentActor);
  if (!agent || agent.kind !== 'agent' || !agent.usable || agent.owner.id !== row.owner_user_id)
    fail('denied','spend_approval_owner_check_failed');
  if (row.state === 'revoked') fail('denied','spend_approval_revoked');
  if (row.state === 'exhausted') fail('denied','spend_approval_exhausted');
  if (new Date(row.expires_at).getTime() <= Date.now()) fail('denied','spend_approval_expired');
  for (const k of Object.keys(row.target ?? {})) {
    if (spendTarget[k] !== row.target[k]) fail('denied','spend_approval_target_mismatch');
  }
  const spent = BigInt(row.spent_amount_micro) + BigInt(amount(amountMicro));
  if (spent > BigInt(row.max_amount_micro)) fail('denied','spend_approval_exceeded');
  if (consume) {
    await db.query(`UPDATE workforce_spend_approvals SET spent_amount_micro=$2,
      state=CASE WHEN $2>=max_amount_micro THEN 'exhausted' ELSE 'active' END, updated_at=now() WHERE id=$1`,
      [row.id, String(spent)]);
  }
  return { ownerUserId: row.owner_user_id, remainingMicro: String(BigInt(row.max_amount_micro) - spent) };
}
