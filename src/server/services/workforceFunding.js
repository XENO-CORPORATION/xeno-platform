// Campaigns extend canonical projects. A campaign creator is attribution, never a
// substitute owner: every manage act rechecks the project's current ReBAC authority.
import { randomUUID } from 'node:crypto';
import { resolvePrincipal } from './agentIdentity.js';
import { check } from '../utils/authzReBAC.js';
import { authorityTransaction, lockWorkspaceAuthority, operationHash } from './workspaceOperationReceipts.js';
import { fundContributionTx, returnContributionTx } from '../utils/creditLedgerV2.js';

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
async function projectAuthority(db, actor, id, relation='admin') {
  const peek=(await db.query('SELECT workspace_id FROM chat_projects WHERE id=$1',[id])).rows[0];
  if (!peek) fail('not_found','project_not_found');
  if (peek.workspace_id) await lockWorkspaceAuthority(db,peek.workspace_id);
  await human(db,actor);
  const p=(await db.query('SELECT * FROM chat_projects WHERE id=$1 FOR SHARE',[id])).rows[0];
  if (!p || p.is_archived || p.workspace_id!==peek.workspace_id) fail('not_found','project_not_found');
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
