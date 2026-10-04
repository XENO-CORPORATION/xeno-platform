import { randomUUID } from 'node:crypto';
import { check } from '../utils/authzReBAC.js';

// PUB-09: external work is contributor-funded by default — offers
// already refuse a foreign payer — and project money moves only
// under a separately accepted budget grant, before dispatch, with
// the accepting maintainer bound as payer. Offering an agent
// authorizes nothing: invoking another owner's agent needs that
// owner's live consent for the task, and every dispatch needs payer
// approval with it — consent alone never spends, approval alone
// never invokes. Accepting a grant or a contribution transfers
// nothing: this build creates no bounty or payout entitlement, and
// the proof counts the money tables to show it.
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

export async function requestBudgetGrant(poolOrClient, {
  projectId, taskId, requesterUserId, amountMicro, expiresAt,
}) {
  if (!projectId) throw new Error('projectId is required');
  if (!taskId) throw new Error('taskId is required');
  if (!requesterUserId) throw new Error('requesterUserId is required');
  const amount = Number(amountMicro);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('amountMicro must be a positive integer');
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime()) || expiry <= new Date()) throw new Error('expiresAt must be in the future');
  return withTx(poolOrClient, async (executor) => {
    const task = await taskProject(executor, taskId);
    if (String(task.projectId) !== String(projectId)) throw new Error('Task is not on this project');
    if (task.status === 'completed') throw new Error('Task is already completed');
    const { rows } = await executor.query(
      `INSERT INTO project_budget_grants (id, project_id, task_id, requester_user_id, amount_micro, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [randomUUID(), projectId, taskId, requesterUserId, amount, expiry.toISOString()],
    );
    return rows[0];
  });
}

async function decideGrant(executor, grantId, actorUserId, toState) {
  const grant = (await executor.query(
    `SELECT * FROM project_budget_grants WHERE id = $1 FOR UPDATE`, [grantId],
  )).rows[0];
  if (!grant) throw new Error('Grant not found');
  if (!(await isProjectAdmin(executor, grant.project_id, actorUserId))) {
    throw new Error('grant_decision_not_authorized');
  }
  return grant;
}

export async function acceptBudgetGrant(poolOrClient, { grantId, actorUserId }) {
  return withTx(poolOrClient, async (executor) => {
    const grant = await decideGrant(executor, grantId, actorUserId, 'accepted');
    if (grant.state !== 'proposed') throw new Error('Grant is not proposed');
    if (new Date(grant.expires_at) <= new Date()) throw new Error('Grant has expired');
    // Acceptance binds the accepting maintainer as payer: the
    // approval and the payer are one act, never separated.
    const { rows } = await executor.query(
      `UPDATE project_budget_grants SET state = 'accepted', payer_user_id = $2,
          decided_by_user_id = $2, decided_at = now() WHERE id = $1 RETURNING *`,
      [grantId, actorUserId],
    );
    return rows[0];
  });
}

export async function declineBudgetGrant(poolOrClient, { grantId, actorUserId }) {
  return withTx(poolOrClient, async (executor) => {
    const grant = await decideGrant(executor, grantId, actorUserId, 'declined');
    if (grant.state !== 'proposed') throw new Error('Grant is not proposed');
    const { rows } = await executor.query(
      `UPDATE project_budget_grants SET state = 'declined', decided_by_user_id = $2, decided_at = now()
        WHERE id = $1 RETURNING *`,
      [grantId, actorUserId],
    );
    return rows[0];
  });
}

export async function revokeBudgetGrant(poolOrClient, { grantId, actorUserId }) {
  return withTx(poolOrClient, async (executor) => {
    const grant = await decideGrant(executor, grantId, actorUserId, 'revoked');
    if (!['proposed', 'accepted'].includes(grant.state)) throw new Error('Grant is not live');
    const { rows } = await executor.query(
      `UPDATE project_budget_grants SET state = 'revoked', decided_by_user_id = $2, decided_at = now()
        WHERE id = $1 RETURNING *`,
      [grantId, actorUserId],
    );
    return rows[0];
  });
}

// Only the resource owner consents, per task, with an expiry. The
// row is the consent; offering the resource wrote no such row.
export async function consentAgentInvocation(poolOrClient, { resourceId, ownerUserId, taskId, expiresAt }) {
  if (!resourceId) throw new Error('resourceId is required');
  if (!ownerUserId) throw new Error('ownerUserId is required');
  if (!taskId) throw new Error('taskId is required');
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime()) || expiry <= new Date()) throw new Error('expiresAt must be in the future');
  return withTx(poolOrClient, async (executor) => {
    const resource = (await executor.query(
      `SELECT owner_user_id AS "ownerUserId", kind FROM workforce_resources WHERE id = $1`,
      [resourceId],
    )).rows[0];
    if (!resource) throw new Error('Resource not found');
    if (String(resource.ownerUserId) !== String(ownerUserId)) throw new Error('consent_not_owner');
    await taskProject(executor, taskId);
    const { rows } = await executor.query(
      `INSERT INTO agent_invocation_consents (resource_id, task_id, granted_by_user_id, expires_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (resource_id, task_id) DO UPDATE SET expires_at = $4, granted_at = now()
        RETURNING *`,
      [resourceId, taskId, ownerUserId, expiry.toISOString()],
    );
    return rows[0];
  });
}

async function liveConsent(executor, resourceId, taskId) {
  const { rows } = await executor.query(
    `SELECT 1 FROM agent_invocation_consents
      WHERE resource_id = $1 AND task_id = $2 AND expires_at > now()`,
    [resourceId, taskId],
  );
  return rows.length > 0;
}

// Project-funded dispatch: the grant must be accepted, live and
// unspent; the dispatcher must hold the project; invocation needs
// the owner's consent unless the dispatcher is the owner; payer
// approval is the grant's bound payer. The grant is single-use.
export async function dispatchProjectFundedWork(poolOrClient, { grantId, dispatcherUserId, resourceId }) {
  if (!grantId) throw new Error('grantId is required');
  if (!dispatcherUserId) throw new Error('dispatcherUserId is required');
  if (!resourceId) throw new Error('resourceId is required');
  return withTx(poolOrClient, async (executor) => {
    const grant = (await executor.query(
      `SELECT * FROM project_budget_grants WHERE id = $1 FOR UPDATE`, [grantId],
    )).rows[0];
    if (!grant) throw new Error('Grant not found');
    if (!(await isProjectAdmin(executor, grant.project_id, dispatcherUserId))) {
      throw new Error('dispatch_not_authorized');
    }
    if (grant.state !== 'accepted') throw new Error('grant_not_accepted');
    if (new Date(grant.expires_at) <= new Date()) throw new Error('grant_expired');
    const resource = (await executor.query(
      `SELECT owner_user_id AS "ownerUserId", kind FROM workforce_resources WHERE id = $1`,
      [resourceId],
    )).rows[0];
    if (!resource) throw new Error('Resource not found');
    if (String(resource.ownerUserId) !== String(dispatcherUserId)
      && !(await liveConsent(executor, resourceId, grant.task_id))) {
      throw new Error('invocation_consent_required');
    }
    const engagementId = randomUUID();
    const { rows } = await executor.query(
      `INSERT INTO task_engagements (id, offer_id, project_id, task_id, actor_user_id, resource_id, resource_kind,
          payer_user_id, spend_limit_micro, execute_allowed, expires_at, origin, accepted_by_user_id, grant_id)
        VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, FALSE, $9, 'grant', $10, $11) RETURNING *`,
      [engagementId, grant.project_id, grant.task_id, grant.requester_user_id, resourceId,
        resource.kind, grant.payer_user_id, Number(grant.amount_micro),
        new Date(grant.expires_at).toISOString(), dispatcherUserId, grantId],
    );
    await executor.query(`UPDATE project_budget_grants SET state = 'dispatched' WHERE id = $1`, [grantId]);
    return rows[0];
  });
}

export async function readBudgetGrant(poolOrClient, grantId) {
  const { rows } = await poolOrClient.query(`SELECT * FROM project_budget_grants WHERE id = $1`, [grantId]);
  if (rows.length === 0) throw new Error('Grant not found');
  return rows[0];
}
