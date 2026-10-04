import { randomUUID } from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { readProjectPolicies } from './projectPolicies.js';

// PUB-03: external developers submit participation offers, not privileged
// assignments. An offer grants nothing by itself; a maintainer's
// acceptance creates exactly one scoped task engagement naming approved
// actors, resources, payer, limits and expiry. Offers are contributor-
// funded (payer = offerer); project-funded work needs a budget grant
// (PUB-09) and refuses here. A pre-authorization policy may auto-accept
// low-risk offers, but auto-accepted engagements never carry execution
// rights or open spending — the schema enforces the execution half.
function isPool(poolOrClient) {
  return poolOrClient && typeof poolOrClient.totalCount === 'number';
}

async function withTx(poolOrClient, fn) {
  if (!isPool(poolOrClient)) return fn(poolOrClient);
  const client = await poolOrClient.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function isProjectAdmin(executor, projectId, actorUserId) {
  const { rows } = await executor.query(
    `SELECT owner_user_id FROM chat_projects WHERE id = $1`,
    [projectId],
  );
  if (rows.length === 0) throw new Error('Project not found');
  if (rows[0].owner_user_id && String(rows[0].owner_user_id) === String(actorUserId)) return true;
  const verdict = await check(executor, {
    object: `project:${projectId}`,
    relation: 'admin',
    subject: `user:${actorUserId}`,
  });
  return verdict.allowed === true;
}

async function taskProject(executor, taskId) {
  const { rows } = await executor.query(
    `SELECT g.project_id AS "projectId", t.status FROM project_tasks t
       JOIN project_milestones m ON m.id = t.milestone_id
       JOIN project_goals g ON g.id = m.goal_id
      WHERE t.id = $1`,
    [taskId],
  );
  if (rows.length === 0) throw new Error('Task not found');
  return rows[0];
}

export async function setOfferPolicy(poolOrClient, { projectId, actorUserId, autoAccept, maxSpendMicro }) {
  if (!projectId) throw new Error('projectId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  if (typeof autoAccept !== 'boolean') throw new Error('autoAccept must be boolean');
  const maxSpend = Number(maxSpendMicro);
  if (!Number.isInteger(maxSpend) || maxSpend < 0) throw new Error('maxSpendMicro must be a non-negative integer');
  return withTx(poolOrClient, async (executor) => {
    if (!(await isProjectAdmin(executor, projectId, actorUserId))) {
      throw new Error('offer_policy_not_authorized');
    }
    const { rows } = await executor.query(
      `INSERT INTO project_offer_policies (project_id, auto_accept, max_spend_micro, updated_by_user_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (project_id) DO UPDATE
          SET auto_accept = EXCLUDED.auto_accept, max_spend_micro = EXCLUDED.max_spend_micro,
              updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
        RETURNING *`,
      [projectId, autoAccept, maxSpend, actorUserId],
    );
    return rows[0];
  });
}

async function readOfferPolicy(executor, projectId) {
  const { rows } = await executor.query(
    `SELECT auto_accept AS "autoAccept", max_spend_micro AS "maxSpendMicro"
       FROM project_offer_policies WHERE project_id = $1`,
    [projectId],
  );
  if (rows.length === 0) return { autoAccept: false, maxSpendMicro: 0 };
  return { autoAccept: rows[0].autoAccept, maxSpendMicro: Number(rows[0].maxSpendMicro) };
}

// Submitting an offer writes one proposed row and grants nothing: no
// participation, no task assignment, no authority of any kind.
export async function submitOffer(poolOrClient, {
  projectId, actorUserId, resourceId, resourceKind, taskId,
  payerUserId, spendLimitMicro, executeRequested = false, expiresAt,
}) {
  if (!projectId) throw new Error('projectId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  if (!resourceId) throw new Error('resourceId is required');
  if (!['agent', 'team'].includes(resourceKind)) throw new Error('Unknown resource kind');
  if (!taskId) throw new Error('taskId is required');
  const spend = Number(spendLimitMicro);
  if (!Number.isInteger(spend) || spend < 0) throw new Error('spendLimitMicro must be a non-negative integer');
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime()) || expiry <= new Date()) throw new Error('expiresAt must be in the future');
  return withTx(poolOrClient, async (executor) => {
    const policies = await readProjectPolicies(executor, projectId);
    if (policies.visibility === 'private' || policies.contributionPolicy !== 'offers-open') {
      throw new Error('project_not_accepting_offers');
    }
    const task = await taskProject(executor, taskId);
    if (String(task.projectId) !== String(projectId)) throw new Error('Task is not on this project');
    if (task.status === 'completed') throw new Error('Task is already completed');
    const resource = (await executor.query(
      `SELECT owner_user_id AS "ownerUserId", kind FROM workforce_resources WHERE id = $1`,
      [resourceId],
    )).rows[0];
    if (!resource) throw new Error('Resource not found');
    if (String(resource.ownerUserId) !== String(actorUserId)) {
      throw new Error('Only the resource owner may offer it');
    }
    if (resource.kind !== resourceKind) throw new Error('Resource kind mismatch');
    if (String(payerUserId) !== String(actorUserId)) {
      throw new Error('project_funding_requires_grant');
    }
    const id = randomUUID();
    const { rows } = await executor.query(
      `INSERT INTO participation_offers (id, project_id, task_id, offered_by_user_id, resource_id, resource_kind,
          payer_user_id, spend_limit_micro, execute_requested, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, projectId, taskId, actorUserId, resourceId, resourceKind, payerUserId, spend, Boolean(executeRequested), expiry.toISOString()],
    );
    const offer = rows[0];
    // Pre-authorization: low-risk only — no execution requested, spend
    // within the policy cap, policy switched on. Anything else waits for
    // a maintainer. Auto-accepted engagements never carry execution.
    const policy = await readOfferPolicy(executor, projectId);
    if (policy.autoAccept && !offer.execute_requested && spend <= policy.maxSpendMicro) {
      const engagement = await acceptOfferInner(executor, offer, null, 'auto');
      return { offer: { ...offer, status: 'accepted' }, engagement, autoAccepted: true };
    }
    return { offer, engagement: null, autoAccepted: false };
  });
}

async function acceptOfferInner(executor, offer, actorUserId, origin) {
  if (offer.status !== 'proposed') throw new Error('Offer is not proposed');
  if (new Date(offer.expires_at) <= new Date()) {
    await executor.query(
      `UPDATE participation_offers SET status = 'expired', decided_at = now() WHERE id = $1`,
      [offer.id],
    );
    throw new Error('Offer has expired');
  }
  const task = await taskProject(executor, offer.task_id);
  if (task.status === 'completed') throw new Error('Task is already completed');
  const engagementId = randomUUID();
  const { rows } = await executor.query(
    `INSERT INTO task_engagements (id, offer_id, project_id, task_id, actor_user_id, resource_id, resource_kind,
        payer_user_id, spend_limit_micro, execute_allowed, expires_at, origin, accepted_by_user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [engagementId, offer.id, offer.project_id, offer.task_id, offer.offered_by_user_id, offer.resource_id,
      offer.resource_kind, offer.payer_user_id, Number(offer.spend_limit_micro),
      origin === 'manual' && offer.execute_requested === true, offer.expires_at, origin, actorUserId],
  );
  await executor.query(
    `UPDATE participation_offers SET status = 'accepted', decided_by_user_id = $2, decided_at = now() WHERE id = $1`,
    [offer.id, actorUserId],
  );
  return rows[0];
}

export async function acceptOffer(poolOrClient, { offerId, actorUserId }) {
  if (!offerId) throw new Error('offerId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  // Expiry marking commits on its own: the decision transaction below
  // rolls back on refusal, which would unmark it. The inner check remains
  // as a race backstop for offers expiring mid-decision.
  const probe = (await poolOrClient.query(`SELECT * FROM participation_offers WHERE id = $1`, [offerId])).rows[0];
  if (!probe) throw new Error('Offer not found');
  if (probe.status === 'proposed' && new Date(probe.expires_at) <= new Date()) {
    await poolOrClient.query(
      `UPDATE participation_offers SET status = 'expired', decided_at = now() WHERE id = $1 AND status = 'proposed'`,
      [offerId],
    );
    throw new Error('Offer has expired');
  }
  return withTx(poolOrClient, async (executor) => {
    const { rows } = await executor.query(`SELECT * FROM participation_offers WHERE id = $1`, [offerId]);
    if (rows.length === 0) throw new Error('Offer not found');
    const offer = rows[0];
    if (!(await isProjectAdmin(executor, offer.project_id, actorUserId))) {
      throw new Error('offer_decision_not_authorized');
    }
    return acceptOfferInner(executor, offer, actorUserId, 'manual');
  });
}

export async function declineOffer(poolOrClient, { offerId, actorUserId }) {
  if (!offerId) throw new Error('offerId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  return withTx(poolOrClient, async (executor) => {
    const { rows } = await executor.query(`SELECT * FROM participation_offers WHERE id = $1`, [offerId]);
    if (rows.length === 0) throw new Error('Offer not found');
    const offer = rows[0];
    if (!(await isProjectAdmin(executor, offer.project_id, actorUserId))) {
      throw new Error('offer_decision_not_authorized');
    }
    if (offer.status !== 'proposed') throw new Error('Offer is not proposed');
    const updated = await executor.query(
      `UPDATE participation_offers SET status = 'declined', decided_by_user_id = $2, decided_at = now()
        WHERE id = $1 RETURNING *`,
      [offerId, actorUserId],
    );
    return updated.rows[0];
  });
}

export async function withdrawOffer(poolOrClient, { offerId, actorUserId }) {
  if (!offerId) throw new Error('offerId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  return withTx(poolOrClient, async (executor) => {
    const { rows } = await executor.query(`SELECT * FROM participation_offers WHERE id = $1`, [offerId]);
    if (rows.length === 0) throw new Error('Offer not found');
    const offer = rows[0];
    if (String(offer.offered_by_user_id) !== String(actorUserId)) {
      throw new Error('offer_withdraw_not_authorized');
    }
    if (offer.status !== 'proposed') throw new Error('Offer is not proposed');
    const updated = await executor.query(
      `UPDATE participation_offers SET status = 'withdrawn', decided_by_user_id = $2, decided_at = now()
        WHERE id = $1 RETURNING *`,
      [offerId, actorUserId],
    );
    return updated.rows[0];
  });
}

export async function readOffer(poolOrClient, offerId) {
  const { rows } = await poolOrClient.query(`SELECT * FROM participation_offers WHERE id = $1`, [offerId]);
  if (rows.length === 0) throw new Error('Offer not found');
  return rows[0];
}

export async function readEngagement(poolOrClient, engagementId) {
  const { rows } = await poolOrClient.query(`SELECT * FROM task_engagements WHERE id = $1`, [engagementId]);
  if (rows.length === 0) throw new Error('Engagement not found');
  return rows[0];
}
