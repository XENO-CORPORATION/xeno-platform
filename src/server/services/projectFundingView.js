/**
 * The project page's Funding tab: what a project has been funded with and what may be spent on it, for anyone who can
 * see the project. It moves no money. Contributing, approving budgets and paying out stay on their own routes
 * (routes/workforceFundingRoutes.js), which need a sender-bound sign-in and a recent confirmation.
 *
 * Who gave what is not shown: a viewer sees totals and how many people, and their own part. A draft campaign is for the
 * people who manage the project until it opens. A monthly ceiling only narrows what may be spent, so a person with edit
 * access can propose one from here; an owner who did not propose it decides it (workforceFunding.js holds that rule).
 */
import crypto from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import * as funding from './workforceFunding.js';

export class ProjectFundingError extends Error {
  constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT = 'xeno-web', MONTH = 30 * 86400;
const can = async (db, userId, projectId, relation) => (await check(db, { object: `project:${projectId}`, relation, subject: `user:${userId}` })).allowed;
const opUuid = (userId, what, requestId) => {
  const h = crypto.createHash('sha256').update(`${userId}:${what}:${requestId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export async function read(db, me, projectId) {
  if (!UUID.test(String(projectId || '')) || !await can(db, me.id, projectId, 'viewer')) throw new ProjectFundingError('Project not found', 'project_not_found', 404);
  const admin = await can(db, me.id, projectId, 'admin'), editor = admin || await can(db, me.id, projectId, 'editor');
  const campaigns = (await db.query(`SELECT id, status, beneficiary, refund_terms, cancellation_terms, deliverable_license, created_at FROM workforce_funding_campaigns
    WHERE project_id = $1 AND ($2::boolean OR status <> 'draft') ORDER BY created_at DESC`, [projectId, admin])).rows;
  const ids = campaigns.map((c) => c.id);
  const milestones = ids.length ? (await db.query(`SELECT m.id, m.campaign_id, m.title, m.threshold_micro, m.budget_max_micro, m.status,
      COALESCE(SUM(k.amount_micro) FILTER (WHERE k.state = 'confirmed'), 0)::bigint AS raised_micro,
      COUNT(DISTINCT k.contributor_user_id) FILTER (WHERE k.state = 'confirmed')::int AS contributors,
      COALESCE(SUM(k.amount_micro) FILTER (WHERE k.state = 'confirmed' AND k.contributor_user_id = $2), 0)::bigint AS mine_micro
    FROM workforce_funding_milestones m LEFT JOIN workforce_funding_contributions k ON k.milestone_id = m.id
    WHERE m.campaign_id = ANY($1::uuid[]) GROUP BY m.id ORDER BY m.created_at`, [ids, me.id])).rows : [];
  const budgets = ids.length ? (await db.query(`SELECT b.id, b.purpose, b.maximum_micro, b.per_run_micro, b.state, b.created_at, COALESCE(u.display_name, u.username) AS spender
    FROM workforce_funding_budgets b JOIN workforce_funding_pools f ON f.id = b.pool_id LEFT JOIN users u ON u.id = b.spender_user_id
    WHERE f.campaign_id = ANY($1::uuid[]) AND b.state IN ('proposed', 'approved') ORDER BY b.created_at DESC`, [ids])).rows : [];
  const caps = (await db.query(`SELECT id, limit_micro, state, proposed_by_user_id FROM workforce_scope_spend_caps
    WHERE scope_kind = 'project' AND scope_id = $1 AND window_seconds = $2 AND state IN ('approved', 'proposed') ORDER BY created_at DESC`, [projectId, MONTH])).rows;
  const active = caps.find((c) => c.state === 'approved'), proposed = caps.find((c) => c.state === 'proposed');
  const grants = (await db.query(`SELECT g.id, g.amount_micro, g.state, t.title AS task FROM project_budget_grants g JOIN project_tasks t ON t.id = g.task_id
    WHERE g.project_id = $1 AND g.state IN ('proposed', 'accepted', 'dispatched') AND g.expires_at > now() ORDER BY g.created_at DESC LIMIT 50`, [projectId])).rows;
  return {
    canPropose: editor, canDecide: await can(db, me.id, projectId, 'owner'),
    campaigns: campaigns.map((c) => ({
      id: c.id, status: c.status, beneficiary: c.beneficiary, refundTerms: c.refund_terms, cancellationTerms: c.cancellation_terms, license: c.deliverable_license,
      milestones: milestones.filter((m) => m.campaign_id === c.id).map((m) => ({ id: m.id, title: m.title, status: m.status, thresholdMicro: Number(m.threshold_micro), budgetMaxMicro: Number(m.budget_max_micro), raisedMicro: Number(m.raised_micro), contributors: m.contributors, mineMicro: Number(m.mine_micro) })),
    })),
    budgets: budgets.map((b) => ({ id: b.id, purpose: b.purpose, maximumMicro: Number(b.maximum_micro), perRunMicro: Number(b.per_run_micro), state: b.state, spender: b.spender })),
    grants: grants.map((g) => ({ id: g.id, amountMicro: Number(g.amount_micro), state: g.state, task: g.task })),
    ceiling: {
      activeId: active?.id || null, limitMicro: active ? Number(active.limit_micro) : null,
      proposalId: proposed?.id || null, proposedMicro: proposed ? Number(proposed.limit_micro) : null, proposedByMe: proposed ? String(proposed.proposed_by_user_id) === String(me.id) : false,
    },
  };
}

const say = {
  independent_budget_approval_required: 'You proposed this one, so another owner of the project has to decide it.',
  scope_cap_already_decided: 'Someone already decided this.', scope_cap_changed: 'The ceiling changed. Look again before deciding.',
  scope_not_found: 'Project not found', project_not_found: 'Project not found',
};
const asFailure = (e) => {
  if (e instanceof funding.FundingError) { const reason = e.details?.reason || e.code; return new ProjectFundingError(say[reason] || 'That couldn’t be done.', reason, e.status); }
  return e;
};
const money = (credits) => {
  const micro = Number(credits) * 1e6;
  if (!Number.isInteger(Number(credits)) || !Number.isSafeInteger(micro) || micro < 0) throw new ProjectFundingError('Enter a whole number of credits.', 'ceiling_invalid');
  return micro;
};
const request = (r) => { if (typeof r !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(r)) throw new ProjectFundingError('Try again.', 'request_id_required'); return r; };

export async function proposeCeiling(db, me, projectId, { credits, requestId } = {}) {
  if (!UUID.test(String(projectId || ''))) throw new ProjectFundingError('Project not found', 'project_not_found', 404);
  try {
    const cap = await funding.proposeScopeSpendCap(db, { actorUserId: me.id, clientId: CLIENT }, { operationId: opUuid(me.id, 'ceiling', request(requestId)), scope: { kind: 'project', id: projectId }, windowSeconds: MONTH, limitMicro: String(money(credits)) });
    return { proposalId: cap.id, state: cap.state };
  } catch (e) { throw asFailure(e); }
}

export async function decideCeiling(db, me, projectId, proposalId, { approve, requestId } = {}) {
  if (!UUID.test(String(projectId || '')) || !UUID.test(String(proposalId || ''))) throw new ProjectFundingError('Project not found', 'project_not_found', 404);
  const row = (await db.query(`SELECT 1 FROM workforce_scope_spend_caps WHERE id = $1 AND scope_kind = 'project' AND scope_id = $2`, [proposalId, projectId])).rows[0];
  if (!row) throw new ProjectFundingError('Project not found', 'project_not_found', 404);
  const active = (await db.query(`SELECT id FROM workforce_scope_spend_caps WHERE scope_kind = 'project' AND scope_id = $1 AND window_seconds = $2 AND state = 'approved'`, [projectId, MONTH])).rows[0];
  try {
    const cap = await funding.decideScopeSpendCap(db, { actorUserId: me.id, clientId: CLIENT }, { capId: proposalId, operationId: opUuid(me.id, 'ceiling-decide', request(requestId)), decision: approve ? 'approved' : 'rejected', expectedActiveId: active?.id || null });
    return { proposalId: cap.id, state: cap.state };
  } catch (e) { throw asFailure(e); }
}
