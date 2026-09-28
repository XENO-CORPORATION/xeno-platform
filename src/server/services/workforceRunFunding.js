// Budget admission is an authority check; canonical holds/lots are the reservation.
// No generic wallet bypass and no balance of our own. Call only inside admission's transaction.
import { resolvePrincipal } from './agentIdentity.js';
import { check } from '../utils/authzReBAC.js';
import { operationHash, authorityTransaction, lockWorkspaceAuthority } from './workspaceOperationReceipts.js';
import { pricePinnedChatUsage } from '../utils/creditCosts.js';
import { saveHoldFunding } from '../utils/usageCreditFunding.js';

const refuse=reason=>{throw Object.assign(new Error(reason),{code:'needs_approval',details:{schemaVersion:1,reason}});};

// Release only a root that has NEVER issued any execution lease (including a
// child's). Absence then proves this system authorized no execution. Once a lease
// exists, cancellation/settlement evidence is required; the clock is not proof.
export async function releaseUndispatchedFunding(pool,ctx,value) {
  const valid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
  if(!value||Object.keys(value).some(k=>k!=='admissionId')||!valid(value.admissionId)||!valid(ctx?.actorUserId))refuse('invalid_funding_release');
  return authorityTransaction(pool,async db=>{
    const a=(await db.query('SELECT * FROM workforce_run_admissions WHERE id=$1',[value.admissionId])).rows[0];
    if(!a||a.actor_user_id!==ctx.actorUserId||a.client_id!==ctx.clientId||a.payer_kind!=='project_pool'||a.parent_admission_id)refuse('funding_release_unavailable');
    if(a.target_workspace_id)await lockWorkspaceAuthority(db,a.target_workspace_id);
    await db.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[ctx.actorUserId]);
    const actor=await resolvePrincipal(db,ctx.actorUserId);if(!actor?.usable)refuse('funding_release_unavailable');
    // Same root gate every pool/child funding writer takes. Children can no longer
    // be admitted once the root hold is voided; no lease may race this proof.
    const f=(await db.query('SELECT * FROM workforce_run_funding WHERE admission_id=$1',[a.id])).rows[0];
    if(!f)refuse('funding_release_unavailable');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`run-authority:${a.id}`]);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`funding-budget:${f.pool_id}`]);
    const dispatched=(await db.query(`SELECT 1 FROM workforce_run_funding f JOIN workforce_run_leases l ON l.admission_id=f.admission_id
      WHERE f.root_admission_id=$1 LIMIT 1`,[a.id])).rowCount;
    if(dispatched)refuse('provider_liability_unresolved');
    const h=(await db.query('SELECT * FROM credit_holds WHERE id=$1 FOR UPDATE',[f.hold_row_id])).rows[0];
    if(h.state==='voided')return {admissionId:a.id,state:'released',replayed:true};
    if(h.state!=='held'||BigInt(h.settled_micro)!==0n)refuse('provider_liability_unresolved');
    await db.query(`INSERT INTO workforce_run_revocations(admission_id,revoked_by_user_id,reason)
      VALUES($1,$2,'stopped_by_actor') ON CONFLICT(admission_id) DO NOTHING`,[a.id,ctx.actorUserId]);
    await db.query("UPDATE credit_holds SET state='voided',updated_at=clock_timestamp() WHERE id=$1",[h.id]);
    return {admissionId:a.id,state:'released',replayed:false};
  });
}
export async function resolveRunFunding(db,actor,request) {
  const id=request.budget.fundingBudgetId;
  const peek=(await db.query('SELECT pool_id FROM workforce_funding_budgets WHERE id=$1',[id])).rows[0];
  if(!peek)refuse('funding_budget_unavailable');
  // Resolve immutable pool identity before taking authority locks.
  const p=(await db.query(`SELECT p.*,c.project_id,c.status AS campaign_status,m.status AS milestone_status,
    m.threshold_micro,m.budget_max_micro FROM workforce_funding_pools p
    JOIN workforce_funding_campaigns c ON c.id=p.campaign_id
    JOIN workforce_funding_milestones m ON m.id=p.milestone_id WHERE p.id=$1`,[peek.pool_id])).rows[0];
  if(!p||p.project_id!==request.target.projectId)refuse('funding_budget_unavailable');
  const campaign=(await db.query('SELECT * FROM workforce_funding_campaigns WHERE id=$1 FOR SHARE',[p.campaign_id])).rows[0];
  const milestone=(await db.query('SELECT * FROM workforce_funding_milestones WHERE id=$1 FOR SHARE',[p.milestone_id])).rows[0];
  if(campaign.status!=='open'||!['open','funded','active'].includes(milestone.status))refuse('funding_not_executable');
  // Campaign/milestone before budget gate, matching budget management's order.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`funding-budget:${peek.pool_id}`]);
  const b=(await db.query('SELECT * FROM workforce_funding_budgets WHERE id=$1 FOR SHARE',[id])).rows[0];
  if(b.state!=='approved'||b.spender_user_id!==actor.actorUserId)refuse('funding_budget_unavailable');
  const terms={version:campaign.terms_version,beneficiary:campaign.beneficiary,cancellationTerms:campaign.cancellation_terms,
    refundTerms:campaign.refund_terms,deliverableLicense:campaign.deliverable_license};
  const mt={id:milestone.id,key:milestone.milestone_key,title:milestone.title,acceptanceCriteria:milestone.acceptance_criteria,
    thresholdMicro:String(milestone.threshold_micro),budgetMaxMicro:String(milestone.budget_max_micro),termsVersion:milestone.terms_version};
  if(b.terms_hash!==operationHash({campaignId:campaign.id,projectId:campaign.project_id,terms,milestone:mt}))refuse('funding_terms_changed');
  if(!b.price_snapshot)refuse('funding_price_unpinned');
  pricePinnedChatUsage(b.price_snapshot,{inputTokens:0,outputTokens:0});
  if(b.price_snapshot.version!==b.price_version)refuse('funding_price_changed');
  // Re-resolve approval authority: a retained signature is not a live permission.
  await db.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[b.decided_by_user_id]);
  const approver=await resolvePrincipal(db,b.decided_by_user_id),spender=await resolvePrincipal(db,actor.actorUserId);
  if(!approver?.usable||approver.kind!=='human'||!spender?.usable||b.decided_by_user_id===actor.actorUserId
    ||spender.owner?.id===b.decided_by_user_id||b.decided_by_user_id===b.proposed_by_user_id)refuse('funding_approval_not_live');
  await db.query(`SELECT object_id FROM relationship_tuples WHERE object_type='project' AND object_id=$1
    ORDER BY relation,subject_type,subject_id FOR SHARE`,[p.project_id]);
  if(!(await check(db,{object:`project:${p.project_id}`,relation:'owner',subject:`user:${approver.id}`})).allowed)refuse('funding_approval_not_live');
  const amount=BigInt(request.budget.ceilingMicro);
  if(amount>BigInt(b.per_run_micro)||amount>BigInt(b.maximum_micro))refuse('funding_run_limit');
  return {budget:b,pool:p,amount};
}

export async function reserveRunFunding(db,funding,admission,parent) {
  const {budget:b,pool:p,amount}=funding;
  if(parent) {
    const f=(await db.query('SELECT * FROM workforce_run_funding WHERE admission_id=$1',[parent.id])).rows[0];
    const h=f&&(await db.query("SELECT state FROM credit_holds WHERE id=$1 FOR SHARE",[f.hold_row_id])).rows[0];
    if(!f||f.budget_id!==b.id||f.pool_id!==p.id||h?.state!=='held')refuse('parent_funding_unavailable');
    await db.query(`INSERT INTO workforce_run_funding(admission_id,root_admission_id,budget_id,pool_id,hold_row_id,reserved_micro)
      VALUES($1,$2,$3,$4,$5,$6)`,[admission.id,f.root_admission_id,b.id,p.id,f.hold_row_id,String(amount)]);
    return;
  }
  // A fresh installation has no verified payment evidence yet, not a SQL fault.
  const evidence=(await db.query("SELECT to_regclass('billing_charges') charges,to_regclass('billing_account_binding') binding")).rows[0];
  if(!evidence.charges||!evidence.binding)refuse('pool_insufficient_eligible_funds');
  // Payment evidence before account locks, matching contribution/return/quarantine.
  const origins=(await db.query(`SELECT c.payment_intent FROM billing_charges c
    JOIN credit_grant_payment_origins o ON o.payment_intent=c.payment_intent
    JOIN workforce_contribution_lots l ON l.origin_grant_id=o.grant_id
    JOIN credit_grants g ON g.id=l.pool_grant_id WHERE g.user_id=$1
    ORDER BY c.payment_intent FOR UPDATE OF c`,[p.account_owner_id])).rows.map(x=>x.payment_intent);
  const account=(await db.query('SELECT * FROM credit_accounts WHERE id=$1 FOR UPDATE',[p.account_id])).rows[0];
  if(!account||account.user_id!==p.account_owner_id||account.owner_kind!=='project_pool'||account.is_frozen)refuse('pool_cannot_fund');
  const committed=(await db.query(`SELECT COALESCE(sum(CASE WHEN h.state='held' THEN h.amount_micro ELSE h.settled_micro END),0)::text AS total
    FROM workforce_run_funding f JOIN credit_holds h ON h.id=f.hold_row_id
    WHERE f.pool_id=$1 AND f.admission_id=f.root_admission_id`,[p.id])).rows[0].total;
  if(BigInt(committed)+amount>BigInt(b.maximum_micro)||BigInt(committed)+amount>BigInt(p.budget_max_micro))refuse('funding_pool_limit');
  const lots=(await db.query(`SELECT g.id,g.remaining_micro,
    g.remaining_micro-COALESCE((SELECT sum(f.reserved_micro) FROM credit_hold_funding f JOIN credit_holds h ON h.id=f.hold_row_id
      WHERE f.grant_id=g.id AND h.state='held'),0) AS available
    FROM credit_grants g JOIN workforce_contribution_lots l ON l.pool_grant_id=g.id
    JOIN workforce_funding_contributions c ON c.id=l.contribution_id
    JOIN credit_grant_payment_origins o ON o.grant_id=l.origin_grant_id
    JOIN billing_charges bc ON bc.payment_intent=o.payment_intent
    JOIN billing_account_binding binding ON binding.singleton=true AND binding.account_id=o.provider_account AND binding.mode=o.provider_mode
    WHERE g.user_id=$1 AND g.account_id=$2 AND g.kind='contribution' AND g.remaining_micro>0
      AND c.state='confirmed' AND c.campaign_id=$3 AND c.milestone_id=$4
      AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())
      AND bc.payment_intent=ANY($5::text[]) AND bc.refunded_micro=0
      AND NOT EXISTS(SELECT 1 FROM workforce_funding_origin_quarantine q WHERE q.grant_id=l.origin_grant_id)
    ORDER BY g.priority,g.expires_at NULLS LAST,g.created_at,g.id FOR UPDATE OF g`,
    [p.account_owner_id,p.account_id,p.campaign_id,p.milestone_id,origins])).rows;
  const eligible=lots.reduce((n,l)=>n+BigInt(l.remaining_micro),0n);
  if(eligible<BigInt(p.threshold_micro))refuse('milestone_threshold_unmet');
  const held=BigInt((await db.query("SELECT COALESCE(sum(amount_micro-settled_micro),0)::text AS total FROM credit_holds WHERE user_id=$1 AND state='held'",[p.account_owner_id])).rows[0].total);
  if(BigInt(account.balance)-held<amount)refuse('pool_insufficient_eligible_funds');
  const allocations=[];let need=amount;
  for(const lot of lots){const free=BigInt(lot.available);if(free<=0n)continue;const take=free<need?free:need;
    if(take>0n)allocations.push({grantId:lot.id,amountMicro:String(take)});need-=take;if(need===0n)break;}
  if(need>0n)refuse('pool_insufficient_eligible_funds');
  const hold=(await db.query(`INSERT INTO credit_holds(user_id,account_id,hold_id,surface,operation,amount_micro,expires_at)
    VALUES($1,$2,$3,'workforce','run',$4,clock_timestamp()+interval '60 seconds') RETURNING id`,
    [p.account_owner_id,p.account_id,admission.id,String(amount)])).rows[0];
  await saveHoldFunding(db,hold.id,allocations);
  await db.query(`INSERT INTO workforce_run_funding(admission_id,root_admission_id,budget_id,pool_id,hold_row_id,reserved_micro)
    VALUES($1,$1,$2,$3,$4,$5)`,[admission.id,b.id,p.id,hold.id,String(amount)]);
}
