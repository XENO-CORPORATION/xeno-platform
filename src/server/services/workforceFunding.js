// Campaigns extend canonical projects. A campaign creator is attribution, never a
// substitute owner: every manage act rechecks the project's current ReBAC authority.
import { randomUUID } from 'node:crypto';
import { resolvePrincipal } from './agentIdentity.js';
import { check } from '../utils/authzReBAC.js';
import { authorityTransaction, lockWorkspaceAuthority, operationHash } from './workspaceOperationReceipts.js';
import { fundContributionTx, returnContributionTx } from '../utils/creditLedgerV2.js';
import { pinChatTariff } from '../utils/creditCosts.js';
import { lockFundingScopes } from './workforceScopeSpendCaps.js';

export class FundingError extends Error {
  constructor(code, reason) {
    super(reason); this.name = 'FundingError'; this.code = code;
    this.status = { bad_input:400, denied:403, not_found:404, conflict:409, unavailable:503 }[code] ?? 500;
    this.details = { schemaVersion:1, reason };
  }
}
const fail = (code, reason) => { throw new FundingError(code, reason); };
const uuid = value => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail('bad_input','invalid_id');
  return value.toLowerCase();
};
const text = (v,max) => {
  if (typeof v !== 'string' || !v.trim() || v.includes('\0') || Buffer.byteLength(v)>max) fail('bad_input','invalid_text');
  return v.trim();
};
const amount = v => {
  if (typeof v !== 'string' || !/^[1-9][0-9]{0,17}$/.test(v)) fail('bad_input','invalid_amount');
  return v;
};
const shape = (v,keys) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k=>!keys.includes(k))) fail('bad_input','invalid_shape');
  return v;
};
const context = v => {
  shape(v,['actorUserId','clientId']);
  if (typeof v.clientId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(v.clientId)) fail('bad_input','invalid_client');
  return { actorUserId:uuid(v.actorUserId),clientId:v.clientId };
};
async function human(db, actor, { lock = true } = {}) {
  if (lock) await db.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[actor]);
  const p=await resolvePrincipal(db,actor);
  if (!p?.usable || p.kind!=='human') fail('denied','usable_human_required');
  return p;
}
async function projectAuthority(db, actor, id, relation='admin', { allowArchived=false }={}) {
  const peek=(await db.query('SELECT workspace_id FROM chat_projects WHERE id=$1',[id])).rows[0];
  if (!peek) fail('not_found','project_not_found');
  if (peek.workspace_id) await lockWorkspaceAuthority(db,peek.workspace_id);
  await human(db,actor);
  const p=(await db.query('SELECT * FROM chat_projects WHERE id=$1 FOR SHARE',[id])).rows[0];
  if (!p || (p.is_archived && !allowArchived) || p.workspace_id!==peek.workspace_id) fail('not_found','project_not_found');
  if (p.workspace_id) {
    const workspace=(await db.query('SELECT status FROM workspaces WHERE id=$1 FOR SHARE',[p.workspace_id])).rows[0];
    if(workspace?.status!=='active') fail('not_found','project_not_found');
  }
  // Pin the direct project grant and its containment edge while checking ReBAC;
  // revocation cannot win after this check but before the management write.
  await db.query(`SELECT object_id FROM relationship_tuples
    WHERE (object_type='project' AND object_id=$1) OR (object_type='workspace' AND object_id=$2)
    ORDER BY object_type,object_id,relation,subject_type,subject_id FOR SHARE`,[id,p.workspace_id]);
  if (!(await check(db,{object:`project:${id}`,relation,subject:`user:${actor}`})).allowed) fail('not_found','project_not_found');
  return p;
}
async function activeCampaignProject(db, campaign) {
  const p=(await db.query('SELECT is_archived FROM chat_projects WHERE id=$1 FOR SHARE',[campaign.project_id])).rows[0];
  if(!p || p.is_archived) fail('not_found','campaign_not_found');
}
async function campaignAuthority(db,actor,id) {
  const peek=(await db.query('SELECT project_id FROM workforce_funding_campaigns WHERE id=$1',[id])).rows[0];
  if (!peek) fail('not_found','campaign_not_found');
  await projectAuthority(db,actor,peek.project_id);
  const c=(await db.query('SELECT * FROM workforce_funding_campaigns WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if (!c || c.project_id!==peek.project_id) fail('not_found','campaign_not_found');
  return c;
}
const termsOf = c => ({ version:c.terms_version,beneficiary:c.beneficiary,cancellationTerms:c.cancellation_terms,
  refundTerms:c.refund_terms,deliverableLicense:c.deliverable_license });
const milestoneOf = m => ({ id:m.id,key:m.milestone_key,title:m.title,acceptanceCriteria:m.acceptance_criteria,
  thresholdMicro:String(m.threshold_micro),budgetMaxMicro:String(m.budget_max_micro),termsVersion:m.terms_version });

export async function createFundingCampaign(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['operationId','projectId','beneficiary','cancellationTerms','refundTerms','deliverableLicense']);
  const input={operationId:uuid(v.operationId),projectId:uuid(v.projectId),beneficiary:text(v.beneficiary,500),
    cancellationTerms:text(v.cancellationTerms,10000),refundTerms:text(v.refundTerms,10000),deliverableLicense:text(v.deliverableLicense,120)};
  return authorityTransaction(pool,async db=>{
    await projectAuthority(db,a.actorUserId,input.projectId);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`campaign:${a.actorUserId}:${a.clientId}:${input.operationId}`]);
    const prior=(await db.query('SELECT * FROM workforce_funding_campaigns WHERE owner_user_id=$1 AND client_id=$2 AND operation_id=$3',
      [a.actorUserId,a.clientId,input.operationId])).rows[0];
    const hash=operationHash(input);
    if(prior) { if(prior.request_hash!==hash) fail('conflict','operation_payload_conflict'); return {id:prior.id,status:prior.status,terms:termsOf(prior),replayed:true}; }
    const c=(await db.query(`INSERT INTO workforce_funding_campaigns
      (project_id,owner_user_id,client_id,operation_id,request_hash,beneficiary,cancellation_terms,refund_terms,deliverable_license)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[input.projectId,a.actorUserId,a.clientId,input.operationId,hash,
      input.beneficiary,input.cancellationTerms,input.refundTerms,input.deliverableLicense])).rows[0];
    return {id:c.id,status:c.status,terms:termsOf(c),replayed:false};
  });
}
export async function createFundingMilestone(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['campaignId','key','title','criteria','thresholdMicro','budgetMaxMicro']);
  const id=uuid(v.campaignId),key=text(v.key,64),title=text(v.title,200),threshold=amount(v.thresholdMicro),budget=amount(v.budgetMaxMicro);
  if(!/^[a-z][a-z0-9._-]{0,63}$/.test(key) || BigInt(budget)<BigInt(threshold)
    || !Array.isArray(v.criteria) || !v.criteria.length || v.criteria.length>32) fail('bad_input','invalid_milestone');
  const criteria={items:v.criteria.map(c=>text(c,1000))};
  return authorityTransaction(pool,async db=>{
    const c=await campaignAuthority(db,a.actorUserId,id);
    if(c.status!=='draft') fail('conflict','campaign_terms_locked');
    const prior=(await db.query('SELECT * FROM workforce_funding_milestones WHERE campaign_id=$1 AND milestone_key=$2',[id,key])).rows[0];
    if(prior) {
      if(operationHash([prior.title,prior.acceptance_criteria,String(prior.threshold_micro),String(prior.budget_max_micro)])!==operationHash([title,criteria,threshold,budget])) fail('conflict','milestone_payload_conflict');
      return milestoneOf(prior);
    }
    const m=(await db.query(`INSERT INTO workforce_funding_milestones(campaign_id,milestone_key,title,acceptance_criteria,threshold_micro,budget_max_micro,terms_version)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,key,title,criteria,threshold,budget,c.terms_version])).rows[0];
    const poolId=randomUUID();
    const account=(await db.query("INSERT INTO credit_accounts(user_id,owner_kind,balance) VALUES($1,'project_pool',0) RETURNING id",[poolId])).rows[0];
    await db.query('INSERT INTO workforce_funding_pools(id,campaign_id,milestone_id,account_id,account_owner_id) VALUES($1,$2,$3,$4,$1)',[poolId,id,m.id,account.id]);
    return milestoneOf(m);
  });
}
export async function setFundingCampaignStatus(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['campaignId','status','expectedRevision']),id=uuid(v.campaignId);
  if(!['paused','closed','cancelled','reconciling','open'].includes(v.status)
    || typeof v.expectedRevision!=='string' || !/^[1-9][0-9]*$/.test(v.expectedRevision)) fail('bad_input','invalid_campaign_transition');
  return authorityTransaction(pool,async db=>{
    const c=await campaignAuthority(db,a.actorUserId,id);
    if(String(c.revision)!==v.expectedRevision) fail('conflict','campaign_revision_changed');
    const permitted={open:['paused','closed','cancelled','reconciling'],paused:['open','closed','cancelled','reconciling'],
      reconciling:['paused','closed','cancelled'],closed:[],cancelled:[],draft:[]};
    if(!permitted[c.status]?.includes(v.status)) fail('conflict','invalid_campaign_transition');
    const row=(await db.query('UPDATE workforce_funding_campaigns SET status=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING revision',
      [id,v.status])).rows[0];
    return {id,status:v.status,revision:String(row.revision)};
  });
}
export async function openFundingCampaign(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['campaignId']),id=uuid(v.campaignId);
  return authorityTransaction(pool,async db=>{
    const c=await campaignAuthority(db,a.actorUserId,id);
    if(c.status==='open') return {id,status:'open'};
    if(c.status!=='draft') fail('conflict','campaign_not_draft');
    if(!(await db.query('SELECT 1 FROM workforce_funding_milestones WHERE campaign_id=$1',[id])).rowCount) fail('conflict','campaign_requires_milestone');
    await db.query("UPDATE workforce_funding_campaigns SET status='open',revision=revision+1,updated_at=now() WHERE id=$1",[id]);
    return {id,status:'open'};
  });
}
export async function acceptFundingMilestone(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['operationId','milestoneId','expectedRevision','admissionIds','criteriaConfirmed','contributorStatement','rationale']);
  const input={operationId:uuid(v.operationId),milestoneId:uuid(v.milestoneId),expectedRevision:text(v.expectedRevision,20),
    contributorStatement:text(v.contributorStatement,4000),rationale:text(v.rationale,4000)};
  if(!/^[1-9][0-9]*$/.test(input.expectedRevision)||!Array.isArray(v.admissionIds)||!v.admissionIds.length||v.admissionIds.length>32
    ||!Array.isArray(v.criteriaConfirmed)||v.criteriaConfirmed.length>32||!v.criteriaConfirmed.every(x=>x===true))fail('bad_input','invalid_milestone_evidence');
  input.admissionIds=[...new Set(v.admissionIds.map(uuid))].sort();input.criteriaConfirmed=v.criteriaConfirmed;
  return authorityTransaction(pool,async db=>{
    const peek=(await db.query('SELECT campaign_id FROM workforce_funding_milestones WHERE id=$1',[input.milestoneId])).rows[0];
    if(!peek)fail('not_found','milestone_not_found');
    const c=await campaignAuthority(db,a.actorUserId,peek.campaign_id);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`milestone-accept:${a.actorUserId}:${a.clientId}:${input.operationId}`]);
    const hash=operationHash(input);
    const previous=(await db.query('SELECT * FROM workforce_operations WHERE actor_user_id=$1 AND client_id=$2 AND operation_id=$3',[a.actorUserId,a.clientId,input.operationId])).rows[0];
    if(previous){if(previous.kind!=='milestone.accept'||previous.request_hash!==hash)fail('conflict','operation_payload_conflict');return {milestoneId:input.milestoneId,status:'accepted',replayed:true};}
    const m=(await db.query('SELECT * FROM workforce_funding_milestones WHERE id=$1 FOR UPDATE',[input.milestoneId])).rows[0];
    if(!['open','funded','active'].includes(m.status)||String(m.revision)!==input.expectedRevision)fail('conflict','milestone_revision_changed');
    if(input.criteriaConfirmed.length!==m.acceptance_criteria.items.length)fail('bad_input','every_acceptance_criterion_required');
    const evidence=[];
    for(const id of input.admissionIds) {
      const row=(await db.query(`SELECT a.actor_user_id,a.project_id,r.outcome,r.report_hash FROM workforce_run_admissions a
        JOIN workforce_run_results r ON r.admission_id=a.id JOIN workforce_run_funding f ON f.admission_id=a.id
        JOIN workforce_funding_pools p ON p.id=f.pool_id WHERE a.id=$1 AND p.milestone_id=$2`,[id,m.id])).rows[0];
      if(!row||row.project_id!==c.project_id||row.outcome!=='completed')fail('conflict','completed_milestone_evidence_required');
      const producer=await resolvePrincipal(db,row.actor_user_id);
      if(row.actor_user_id===a.actorUserId||producer?.owner?.id===a.actorUserId)fail('denied','independent_milestone_review_required');
      evidence.push({admissionId:id,reportHash:row.report_hash});
    }
    const project=(await db.query('SELECT workspace_id FROM chat_projects WHERE id=$1',[c.project_id])).rows[0];
    await db.query(`INSERT INTO workforce_operations(actor_user_id,client_id,operation_id,request_hash,kind,subject_type,subject_id,
      deciding_principal_id,responsible_account_id,authority,rationale,evidence,workspace_id)
      VALUES($1,$2,$3,$4,'milestone.accept','milestone',$5,$1,$1,$6,$7,$8,$9)`,
      [a.actorUserId,a.clientId,input.operationId,hash,m.id,`project:${c.project_id}#admin`,input.rationale,JSON.stringify(evidence),project.workspace_id]);
    await db.query(`INSERT INTO workforce_milestone_acceptances(milestone_id,actor_user_id,client_id,operation_id,terms_version,contributor_statement,criteria_count)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[m.id,a.actorUserId,a.clientId,input.operationId,m.terms_version,input.contributorStatement,input.criteriaConfirmed.length]);
    for(const item of evidence)await db.query('INSERT INTO workforce_milestone_evidence(milestone_id,admission_id,report_hash) VALUES($1,$2,$3)',[m.id,item.admissionId,item.reportHash]);
    await db.query("UPDATE workforce_funding_milestones SET status='accepted',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",[m.id]);
    return {milestoneId:m.id,status:'accepted',replayed:false};
  });
}
// The contribution preview contains terms and totals only, never project content,
// membership, prompts, credentials or a source-lot list. Authentication is required.
export async function readFundingOffer(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['campaignId','milestoneId']);
  return authorityTransaction(pool,async db=>{
    await human(db,a.actorUserId);
    const c=(await db.query("SELECT * FROM workforce_funding_campaigns WHERE id=$1 AND status='open' FOR SHARE",[uuid(v.campaignId)])).rows[0];
    if(!c) fail('not_found','campaign_not_found');
    await activeCampaignProject(db,c);
    const m=(await db.query('SELECT * FROM workforce_funding_milestones WHERE id=$1 AND campaign_id=$2 FOR SHARE',[uuid(v.milestoneId),c.id])).rows[0];
    if(!m) fail('not_found','milestone_not_found');
    const terms={campaignId:c.id,projectId:c.project_id,terms:termsOf(c),milestone:milestoneOf(m)};
    return {...terms,consentHash:operationHash(terms)};
  });
}
export async function contributeFunding(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['operationId','campaignId','milestoneId','amountMicro','consentHash','confirmed']);
  if(v.confirmed!==true || typeof v.consentHash!=='string' || !/^[a-f0-9]{64}$/.test(v.consentHash)) fail('bad_input','explicit_confirmation_required');
  const input={operationId:uuid(v.operationId),campaignId:uuid(v.campaignId),milestoneId:uuid(v.milestoneId),amountMicro:amount(v.amountMicro),consentHash:v.consentHash};
  let committing=false;
  try {
    return await authorityTransaction(pool,async db=>{
      // Match ordinary billing's account -> user lock order. This early identity
      // observation is rechecked under the ledger-held user lock before confirmation.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`contribution-actor:${a.actorUserId}`]);
      await human(db,a.actorUserId,{lock:false});
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`contribution:${a.actorUserId}:${a.clientId}:${input.operationId}`]);
      const prior=(await db.query('SELECT * FROM workforce_funding_contributions WHERE contributor_user_id=$1 AND client_id=$2 AND operation_id=$3',
        [a.actorUserId,a.clientId,input.operationId])).rows[0];
      const hash=operationHash(input);
      if(prior) { if(prior.request_hash!==hash) fail('conflict','operation_payload_conflict'); return contributionOf(prior,true); }
      const c=(await db.query("SELECT * FROM workforce_funding_campaigns WHERE id=$1 AND status='open' FOR SHARE",[input.campaignId])).rows[0];
      if(!c) fail('not_found','campaign_not_found');
      await activeCampaignProject(db,c);
      const m=(await db.query("SELECT * FROM workforce_funding_milestones WHERE id=$1 AND campaign_id=$2 AND status='open' FOR SHARE",[input.milestoneId,c.id])).rows[0];
      if(!m) fail('not_found','milestone_not_found');
      const terms={campaignId:c.id,projectId:c.project_id,terms:termsOf(c),milestone:milestoneOf(m)};
      if(operationHash(terms)!==input.consentHash) fail('conflict','funding_terms_changed');
      const row=(await db.query(`INSERT INTO workforce_funding_contributions
        (campaign_id,milestone_id,contributor_user_id,client_id,idempotency_key,operation_id,request_hash,amount_micro,terms_version,restriction,state)
        VALUES($1,$2,$3,$4,$5::text,$5::uuid,$6,$7,$8,$9,'pending') RETURNING *`,
        [c.id,m.id,a.actorUserId,a.clientId,input.operationId,hash,input.amountMicro,c.terms_version,terms])).rows[0];
      await fundContributionTx(db,row.id);
      await human(db,a.actorUserId);
      const result=(await db.query("UPDATE workforce_funding_contributions SET state='confirmed',updated_at=now() WHERE id=$1 RETURNING *",[row.id])).rows[0];
      committing=true;
      return contributionOf(result,false);
    });
  } catch(error) {
    if(committing) fail('unavailable','contribution_state_uncertain');
    throw error;
  }
}
export async function returnFundingContribution(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['contributionId']),id=uuid(v.contributionId);
  let committing=false;
  try {
    return await authorityTransaction(pool,async db=>{
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`contribution-actor:${a.actorUserId}`]);
      await human(db,a.actorUserId,{lock:false});
      const result=await returnContributionTx(db,id,a.actorUserId);
      await human(db,a.actorUserId);
      committing=true;
      return {contributionId:id,state:'returned',...result};
    });
  } catch(error) { if(committing) fail('unavailable','contribution_state_uncertain'); throw error; }
}
function contributionOf(c,replayed) {
  return {id:c.id,operationId:c.operation_id,campaignId:c.campaign_id,milestoneId:c.milestone_id,
    amountMicro:String(c.amount_micro),termsVersion:c.terms_version,state:c.state,replayed};
}
export async function readFundingContribution(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['operationId']);
  return authorityTransaction(pool,async db=>{
    await human(db,a.actorUserId);
    const c=(await db.query('SELECT * FROM workforce_funding_contributions WHERE contributor_user_id=$1 AND client_id=$2 AND operation_id=$3',
      [a.actorUserId,a.clientId,uuid(v.operationId)])).rows[0];
    if(!c)return {state:'not-observed'};
    const quarantines=(await db.query(`SELECT DISTINCT q.event_id,q.reason,q.state FROM workforce_funding_origin_quarantine q
      JOIN workforce_contribution_lots l ON l.origin_grant_id=q.grant_id WHERE l.contribution_id=$1 ORDER BY q.event_id`,[c.id])).rows;
    return {...contributionOf(c,true),availability:quarantines.length?'quarantined':c.state==='returned'?'returned':'restricted',
      reconciliationRequired:quarantines.length>0,quarantines:quarantines.map(q=>({reason:q.reason,state:q.state}))};
  });
}

// Private contributor accounting is independent of project membership. A contribution
// buys no project access; this report exposes only that contributor's financial facts.
export async function readContributorFunding(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['contributionId']),id=uuid(v.contributionId);
  return authorityTransaction(pool,async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await human(db,a.actorUserId);
    const c=(await db.query('SELECT * FROM workforce_funding_contributions WHERE id=$1 AND contributor_user_id=$2',[id,a.actorUserId])).rows[0];
    if(!c)fail('not_found','contribution_not_found');
    const lots=(await db.query(`SELECT l.amount_micro,g.remaining_micro,g.expires_at<=now() AS expired,
      EXISTS(SELECT 1 FROM workforce_funding_origin_quarantine q WHERE q.grant_id=l.origin_grant_id) AS quarantined,
      COALESCE((SELECT sum(f.reserved_micro) FROM credit_hold_funding f JOIN credit_holds h ON h.id=f.hold_row_id
        WHERE f.grant_id=g.id AND h.state='held'),0)::text AS committed_micro,
      COALESCE((SELECT r.amount_micro FROM workforce_funding_return_lots r WHERE r.contribution_id=l.contribution_id AND r.pool_grant_id=l.pool_grant_id),0)::text AS returned_micro
      FROM workforce_contribution_lots l JOIN credit_grants g ON g.id=l.pool_grant_id WHERE l.contribution_id=$1`,[id])).rows;
    let confirmed=0n,consumed=0n,returned=0n,committed=0n,available=0n,expired=0n,quarantined=0n;
    for(const lot of lots) {
      const original=BigInt(lot.amount_micro),remaining=BigInt(lot.remaining_micro),back=BigInt(lot.returned_micro),held=BigInt(lot.committed_micro);
      if(remaining<0n||back<0n||held<0n||held>remaining||remaining+back>original)fail('unavailable','contribution_accounting_inconsistent');
      confirmed+=original;consumed+=original-remaining-back;returned+=back;committed+=held;
      const free=remaining-held;
      // Categories are disjoint. Disputed residual value stays quarantined even
      // when its expiry elapsed; held liability stays committed regardless of either.
      if(lot.quarantined)quarantined+=free;
      else if(lot.expired)expired+=free;
      else available+=free;
    }
    if(confirmed!==BigInt(c.amount_micro)||confirmed!==consumed+returned+committed+available+expired+quarantined)fail('unavailable','contribution_accounting_inconsistent');
    const returnRow=(await db.query('SELECT expired_micro FROM workforce_funding_returns WHERE contribution_id=$1',[id])).rows[0];
    const disputed=(await db.query(`SELECT EXISTS(SELECT 1 FROM workforce_contribution_lots l
      JOIN workforce_funding_origin_quarantine q ON q.grant_id=l.origin_grant_id WHERE l.contribution_id=$1) AS yes`,[id])).rows[0].yes;
    const accepted=(await db.query(`SELECT a.contributor_statement,a.criteria_count,a.terms_version,a.accepted_at,
      (SELECT count(*)::int FROM workforce_milestone_evidence e WHERE e.milestone_id=a.milestone_id) AS evidence_count
      FROM workforce_milestone_acceptances a WHERE a.milestone_id=$1`,[c.milestone_id])).rows[0];
    return {contributionId:c.id,campaignId:c.campaign_id,milestoneId:c.milestone_id,state:c.state,termsVersion:c.terms_version,
      milestoneEvidence:accepted?{status:'accepted',statement:accepted.contributor_statement,criteriaCount:accepted.criteria_count,
        termsVersion:accepted.terms_version,evidenceCount:accepted.evidence_count,acceptedAt:accepted.accepted_at.toISOString()}:null,
      amounts:{confirmedMicro:String(confirmed),committedMicro:String(committed),consumedMicro:String(consumed),returnedMicro:String(returned),
        availableMicro:String(available),expiredMicro:String(expired),quarantinedMicro:String(quarantined)},
      expiredReturnedMicro:String(returnRow?.expired_micro??0),reconciliationRequired:disputed,
      asOf:(await db.query('SELECT transaction_timestamp() AS t')).rows[0].t.toISOString()};
  });
}

// Budget authority is separate from campaign management: an editor plans, a different
// project owner approves, and a named human/agent spends only through subsequent admission.
async function budgetPool(db,actor,poolId,relation,{requireOpen=true}={}) {
  const p=(await db.query(`SELECT p.*,c.project_id FROM workforce_funding_pools p
    JOIN workforce_funding_campaigns c ON c.id=p.campaign_id WHERE p.id=$1`,[poolId])).rows[0];
  if(!p)fail('not_found','funding_pool_not_found');
  await projectAuthority(db,actor,p.project_id,relation,{allowArchived:!requireOpen});
  const campaign=(await db.query('SELECT * FROM workforce_funding_campaigns WHERE id=$1 FOR SHARE',[p.campaign_id])).rows[0];
  if(!campaign||(requireOpen&&!['draft','open','paused'].includes(campaign.status)))fail('conflict','campaign_not_budgetable');
  const milestone=(await db.query('SELECT * FROM workforce_funding_milestones WHERE id=$1 AND campaign_id=$2 FOR SHARE',[p.milestone_id,p.campaign_id])).rows[0];
  if(!milestone)fail('not_found','milestone_not_found');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`funding-budget:${poolId}`]);
  const termsHash=operationHash({campaignId:campaign.id,projectId:campaign.project_id,terms:termsOf(campaign),milestone:milestoneOf(milestone)});
  return {pool:p,campaign,milestone,termsHash};
}
function budgetOf(r,replayed=false) {
  return {id:r.id,poolId:r.pool_id,proposedByUserId:r.proposed_by_user_id,spenderUserId:r.spender_user_id,
    operationId:r.operation_id,maximumMicro:String(r.maximum_micro),perRunMicro:String(r.per_run_micro),
    purpose:r.purpose,priceVersion:r.price_version,model:r.price_snapshot?.model??null,termsHash:r.terms_hash,state:r.state,revision:String(r.revision),
    decidedByUserId:r.decided_by_user_id,decisionOperationId:r.decision_operation_id,
    ...(r.window_seconds!=null?{window:{seconds:r.window_seconds,limitMicro:String(r.window_limit_micro)}}:{}),replayed};
}
export async function readFundingPrice(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['poolId','model']),poolId=uuid(v.poolId),model=text(v.model,100);
  return authorityTransaction(pool,async db=>{
    await budgetPool(db,a.actorUserId,poolId,'editor');
    try { return {model,priceVersion:pinChatTariff(model).version}; }
    catch { fail('bad_input','invalid_funding_model'); }
  });
}
export async function proposeFundingBudget(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['operationId','poolId','spenderUserId','maximumMicro','perRunMicro','purpose','priceVersion','termsHash','model','window']);
  const input={operationId:uuid(v.operationId),poolId:uuid(v.poolId),spenderUserId:uuid(v.spenderUserId),
    maximumMicro:amount(v.maximumMicro),perRunMicro:amount(v.perRunMicro),purpose:text(v.purpose,2000),
    priceVersion:text(v.priceVersion,128),termsHash:text(v.termsHash,64),model:text(v.model,100)};
  if(!/^[a-f0-9]{64}$/.test(input.termsHash)||BigInt(input.perRunMicro)>BigInt(input.maximumMicro))fail('bad_input','invalid_budget');
  if(v.window!==undefined) {
    const w=shape(v.window,['seconds','limitMicro']);
    if(!Number.isSafeInteger(w.seconds)||w.seconds<1||w.seconds>31536000)fail('bad_input','invalid_budget_window');
    const limit=amount(w.limitMicro);
    if(BigInt(limit)>BigInt(input.maximumMicro)||BigInt(input.perRunMicro)>BigInt(limit))fail('bad_input','invalid_budget_window');
    input.window={seconds:w.seconds,limitMicro:limit};
  }
  return authorityTransaction(pool,async db=>{
    const p=await budgetPool(db,a.actorUserId,input.poolId,'editor');
    const prior=(await db.query('SELECT * FROM workforce_funding_budgets WHERE proposed_by_user_id=$1 AND client_id=$2 AND operation_id=$3',
      [a.actorUserId,a.clientId,input.operationId])).rows[0];
    const hash=operationHash(input);
    if(prior){if(prior.request_hash!==hash)fail('conflict','operation_payload_conflict');return budgetOf(prior,true);}
    if(p.termsHash!==input.termsHash)fail('conflict','funding_terms_changed');
    let tariff;
    try { tariff=pinChatTariff(input.model); } catch { fail('bad_input','invalid_funding_model'); }
    if(tariff.version!==input.priceVersion)fail('conflict','funding_price_changed');
    if(BigInt(input.maximumMicro)>BigInt(p.milestone.budget_max_micro))fail('denied','budget_exceeds_contributor_limit');
    const spender=await resolvePrincipal(db,input.spenderUserId);
    if(!spender?.usable||!['human','agent'].includes(spender.kind))fail('denied','spender_unavailable');
    const r=(await db.query(`INSERT INTO workforce_funding_budgets
      (pool_id,proposed_by_user_id,spender_user_id,client_id,operation_id,request_hash,terms_hash,maximum_micro,per_run_micro,purpose,price_version,price_snapshot,window_seconds,window_limit_micro)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[input.poolId,a.actorUserId,input.spenderUserId,a.clientId,
      input.operationId,hash,p.termsHash,input.maximumMicro,input.perRunMicro,input.purpose,input.priceVersion,JSON.stringify(tariff),input.window?.seconds??null,input.window?.limitMicro??null])).rows[0];
    return budgetOf(r);
  });
}
export async function decideFundingBudget(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['budgetId','operationId','decision','expectedRevision']);
  const id=uuid(v.budgetId),op=uuid(v.operationId);
  if(!['approved','rejected'].includes(v.decision)||typeof v.expectedRevision!=='string'||!/^\d+$/.test(v.expectedRevision))fail('bad_input','invalid_budget_decision');
  return authorityTransaction(pool,async db=>{
    const peek=(await db.query('SELECT pool_id FROM workforce_funding_budgets WHERE id=$1',[id])).rows[0];
    if(!peek)fail('not_found','budget_not_found');
    const p=await budgetPool(db,a.actorUserId,peek.pool_id,'owner');
    const b=(await db.query('SELECT * FROM workforce_funding_budgets WHERE id=$1 FOR UPDATE',[id])).rows[0];
    const spender=await resolvePrincipal(db,b.spender_user_id);
    if(b.proposed_by_user_id===a.actorUserId||b.spender_user_id===a.actorUserId||spender?.owner?.id===a.actorUserId) {
      fail('denied','independent_budget_approval_required');
    }
    if(b.decision_operation_id===op&&b.decided_by_user_id===a.actorUserId&&b.state===v.decision)return budgetOf(b,true);
    if(b.state!=='proposed'||String(b.revision)!==v.expectedRevision)fail('conflict','budget_revision_changed');
    if(p.termsHash!==b.terms_hash)fail('conflict','funding_terms_changed');
    if(v.decision==='approved'&&!b.price_snapshot)fail('conflict','funding_price_unpinned');
    if(!spender?.usable)fail('denied','spender_unavailable');
    if(v.decision==='approved'&&(await db.query("SELECT 1 FROM workforce_funding_budgets WHERE pool_id=$1 AND state='approved'",[b.pool_id])).rowCount) {
      fail('conflict','pool_already_has_active_budget');
    }
    const r=(await db.query(`UPDATE workforce_funding_budgets SET state=$2,revision=revision+1,
      decided_by_user_id=$3,decision_operation_id=$4,decided_at=now() WHERE id=$1 RETURNING *`,[id,v.decision,a.actorUserId,op])).rows[0];
    return budgetOf(r);
  });
}
export async function revokeFundingBudget(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['budgetId','expectedRevision']),id=uuid(v.budgetId);
  if(typeof v.expectedRevision!=='string'||!/^\d+$/.test(v.expectedRevision))fail('bad_input','invalid_budget_revision');
  return authorityTransaction(pool,async db=>{
    const peek=(await db.query('SELECT pool_id FROM workforce_funding_budgets WHERE id=$1',[id])).rows[0];
    if(!peek)fail('not_found','budget_not_found');
    await budgetPool(db,a.actorUserId,peek.pool_id,'owner',{requireOpen:false});
    const b=(await db.query('SELECT * FROM workforce_funding_budgets WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(b.state==='revoked')return budgetOf(b,true);
    if(b.state!=='approved'||String(b.revision)!==v.expectedRevision)fail('conflict','budget_revision_changed');
    return budgetOf((await db.query(`UPDATE workforce_funding_budgets SET state='revoked',revision=revision+1,
      revoked_by_user_id=$2,revoked_at=now() WHERE id=$1 RETURNING *`,[id,a.actorUserId])).rows[0]);
  });
}
function capScope(value) {
  shape(value,['kind','id']);
  if(!['project','workspace'].includes(value.kind))fail('bad_input','invalid_cap_scope');
  return {kind:value.kind,id:uuid(value.id)};
}
async function scopeCapAuthority(db,actor,scope,relation) {
  if(scope.kind==='project') {
    const p=await projectAuthority(db,actor,scope.id,relation);
    await lockFundingScopes(db,p.id,p.workspace_id);
  } else {
    await lockWorkspaceAuthority(db,scope.id);await human(db,actor);
    const w=(await db.query('SELECT status FROM workspaces WHERE id=$1 FOR SHARE',[scope.id])).rows[0];
    await db.query(`SELECT object_id FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1
      ORDER BY relation,subject_type,subject_id FOR SHARE`,[scope.id]);
    if(w?.status!=='active'||!(await check(db,{object:`workspace:${scope.id}`,relation,subject:`user:${actor}`})).allowed)fail('not_found','scope_not_found');
    await lockFundingScopes(db,null,scope.id);
  }
}
const capOf=(r,replayed=false)=>({id:r.id,scope:{kind:r.scope_kind,id:r.scope_id},operationId:r.operation_id,
  windowSeconds:r.window_seconds,limitMicro:String(r.limit_micro),state:r.state,proposedByUserId:r.proposed_by_user_id,
  decidedByUserId:r.decided_by_user_id,supersededBy:r.superseded_by,replayed});
export async function proposeScopeSpendCap(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['operationId','scope','windowSeconds','limitMicro']),scope=capScope(v.scope);
  if(!Number.isSafeInteger(v.windowSeconds)||v.windowSeconds<1||v.windowSeconds>31536000
    ||typeof v.limitMicro!=='string'||!/^(0|[1-9][0-9]{0,17})$/.test(v.limitMicro))fail('bad_input','invalid_scope_cap');
  const input={operationId:uuid(v.operationId),scope,windowSeconds:v.windowSeconds,limitMicro:v.limitMicro};
  return authorityTransaction(pool,async db=>{
    await scopeCapAuthority(db,a.actorUserId,scope,'editor');
    const hash=operationHash(input);
    const prior=(await db.query('SELECT * FROM workforce_scope_spend_caps WHERE proposed_by_user_id=$1 AND client_id=$2 AND operation_id=$3',
      [a.actorUserId,a.clientId,input.operationId])).rows[0];
    if(prior){if(prior.request_hash!==hash)fail('conflict','operation_payload_conflict');return capOf(prior,true);}
    return capOf((await db.query(`INSERT INTO workforce_scope_spend_caps(scope_kind,scope_id,project_id,workspace_id,proposed_by_user_id,
      client_id,operation_id,request_hash,window_seconds,limit_micro) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [scope.kind,scope.id,scope.kind==='project'?scope.id:null,scope.kind==='workspace'?scope.id:null,a.actorUserId,a.clientId,input.operationId,hash,input.windowSeconds,input.limitMicro])).rows[0]);
  });
}
export async function decideScopeSpendCap(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['capId','operationId','decision','expectedActiveId']),id=uuid(v.capId),op=uuid(v.operationId);
  if(!['approved','rejected'].includes(v.decision))fail('bad_input','invalid_cap_decision');
  const expected=v.expectedActiveId==null?null:uuid(v.expectedActiveId);
  return authorityTransaction(pool,async db=>{
    const peek=(await db.query('SELECT scope_kind,scope_id FROM workforce_scope_spend_caps WHERE id=$1',[id])).rows[0];
    if(!peek)fail('not_found','scope_cap_not_found');
    await scopeCapAuthority(db,a.actorUserId,{kind:peek.scope_kind,id:peek.scope_id},'owner');
    const c=(await db.query('SELECT * FROM workforce_scope_spend_caps WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(c.proposed_by_user_id===a.actorUserId)fail('denied','independent_budget_approval_required');
    if(c.decision_operation_id===op&&c.decided_by_user_id===a.actorUserId&&c.state===v.decision)return capOf(c,true);
    if(c.state!=='proposed')fail('conflict','scope_cap_already_decided');
    if(v.decision==='approved') {
      const active=(await db.query("SELECT id FROM workforce_scope_spend_caps WHERE scope_kind=$1 AND scope_id=$2 AND window_seconds=$3 AND state='approved' FOR UPDATE",[c.scope_kind,c.scope_id,c.window_seconds])).rows[0];
      if((active?.id??null)!==expected)fail('conflict','scope_cap_changed');
      if(active)await db.query("UPDATE workforce_scope_spend_caps SET state='superseded',superseded_by=$2 WHERE id=$1",[active.id,c.id]);
    }
    return capOf((await db.query('UPDATE workforce_scope_spend_caps SET state=$2,decided_by_user_id=$3,decision_operation_id=$4,decided_at=clock_timestamp() WHERE id=$1 RETURNING *',
      [c.id,v.decision,a.actorUserId,op])).rows[0]);
  });
}
export async function readScopeSpendCaps(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['scope']),scope=capScope(v.scope);
  return authorityTransaction(pool,async db=>{
    await scopeCapAuthority(db,a.actorUserId,scope,'viewer');
    return {scope,caps:(await db.query('SELECT * FROM workforce_scope_spend_caps WHERE scope_kind=$1 AND scope_id=$2 ORDER BY created_at,id',[scope.kind,scope.id])).rows.map(r=>capOf(r))};
  });
}

export async function readFundingBudget(pool,ctx,value) {
  const a=context(ctx),v=shape(value,['budgetId']),id=uuid(v.budgetId);
  return authorityTransaction(pool,async db=>{
    const peek=(await db.query('SELECT pool_id FROM workforce_funding_budgets WHERE id=$1',[id])).rows[0];
    if(!peek)fail('not_found','budget_not_found');
    await budgetPool(db,a.actorUserId,peek.pool_id,'viewer',{requireOpen:false});
    return budgetOf((await db.query('SELECT * FROM workforce_funding_budgets WHERE id=$1',[id])).rows[0]);
  });
}
