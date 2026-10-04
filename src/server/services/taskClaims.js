import { randomUUID, createHash } from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { resolvePrincipal } from './agentIdentity.js';

// PUB-07: bounty and paid task claims. An idempotent claim (task,
// claimant, commitment, expiry, idempotency key) takes the single live
// slot for its task; retries with the same key return the same claim
// while rivals are refused until the slot frees. Commit-and-reveal
// separates the true solver from copies: only the preimage matching
// the commitment reveals. Awards pay the recorded winner — the
// claimant, unless the task already resolved to someone else, in
// which case the award fails closed for a human to untangle.
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

async function taskRow(executor, taskId) {
  const { rows } = await executor.query(
    `SELECT t.id, t.status, t.assignee_user_id AS "assignee", g.project_id AS "projectId"
       FROM project_tasks t
       JOIN project_milestones m ON m.id = t.milestone_id
       JOIN project_goals g ON g.id = m.goal_id
      WHERE t.id = $1`,
    [taskId],
  );
  if (rows.length === 0) throw new Error('Task not found');
  return rows[0];
}

export async function claimTask(poolOrClient, { taskId, claimantUserId, commitment, idempotencyKey, ttlSeconds = 86400 }) {
  if (!taskId) throw new Error('taskId is required');
  if (!claimantUserId) throw new Error('claimantUserId is required');
  if (typeof commitment !== 'string' || !/^[a-f0-9]{64}$/.test(commitment)) {
    throw new Error('commitment must be a sha256 hex');
  }
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8 || idempotencyKey.length > 128) {
    throw new Error('idempotencyKey must be 8..128 chars');
  }
  const ttl = Number(ttlSeconds);
  if (!Number.isInteger(ttl) || ttl <= 0) throw new Error('ttlSeconds must be positive');
  return withTx(poolOrClient, async (executor) => {
    const claimant = await resolvePrincipal(executor, claimantUserId);
    if (!claimant?.usable) throw new Error('claimant_not_usable');
    const task = await taskRow(executor, taskId);
    if (task.status === 'completed') throw new Error('Task is already completed');
    const prior = (await executor.query(
      `SELECT * FROM task_claims WHERE task_id = $1 AND idempotency_key = $2`,
      [taskId, idempotencyKey],
    )).rows[0];
    if (prior) {
      if (String(prior.claimant_user_id) !== String(claimantUserId)) {
        throw new Error('claim_key_conflict');
      }
      return { claim: prior, duplicate: true };
    }
    const live = (await executor.query(
      `SELECT id FROM task_claims WHERE task_id = $1 AND state IN ('claimed', 'revealed')`,
      [taskId],
    )).rows[0];
    if (live) throw new Error('task_already_claimed');
    const id = randomUUID();
    try {
      const { rows } = await executor.query(
        `INSERT INTO task_claims (id, task_id, claimant_user_id, commitment, idempotency_key, expires_at)
          VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6)) RETURNING *`,
        [id, taskId, claimantUserId, commitment, idempotencyKey, ttl],
      );
      return { claim: rows[0], duplicate: false };
    } catch (err) {
      if (err?.code === '23505') throw new Error('task_already_claimed');
      throw err;
    }
  });
}

export async function revealClaim(poolOrClient, { claimId, claimantUserId, secret }) {
  if (!claimId) throw new Error('claimId is required');
  if (!claimantUserId) throw new Error('claimantUserId is required');
  if (typeof secret !== 'string' || secret.length === 0) throw new Error('secret is required');
  const probe = (await poolOrClient.query(`SELECT * FROM task_claims WHERE id = $1`, [claimId])).rows[0];
  if (!probe) throw new Error('Claim not found');
  if (['claimed', 'revealed'].includes(probe.state) && new Date(probe.expires_at) <= new Date()) {
    await poolOrClient.query(
      `UPDATE task_claims SET state = 'expired', decided_at = now() WHERE id = $1 AND state IN ('claimed', 'revealed')`,
      [claimId],
    );
    throw new Error('Claim has expired');
  }
  return withTx(poolOrClient, async (executor) => {
    const claim = (await executor.query(`SELECT * FROM task_claims WHERE id = $1 FOR UPDATE`, [claimId])).rows[0];
    if (claim.state !== 'claimed') throw new Error(`Claim is ${claim.state}`);
    if (String(claim.claimant_user_id) !== String(claimantUserId)) {
      throw new Error('reveal_not_authorized');
    }
    const digest = createHash('sha256').update(secret, 'utf8').digest('hex');
    if (digest !== claim.commitment) throw new Error('reveal_mismatch');
    const { rows } = await executor.query(
      `UPDATE task_claims SET state = 'revealed', revealed_secret = $2 WHERE id = $1 RETURNING *`,
      [claimId, secret],
    );
    return rows[0];
  });
}

export async function awardClaim(poolOrClient, { claimId, actorUserId }) {
  if (!claimId) throw new Error('claimId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  const probe = (await poolOrClient.query(`SELECT * FROM task_claims WHERE id = $1`, [claimId])).rows[0];
  if (!probe) throw new Error('Claim not found');
  if (['claimed', 'revealed'].includes(probe.state) && new Date(probe.expires_at) <= new Date()) {
    await poolOrClient.query(
      `UPDATE task_claims SET state = 'expired', decided_at = now() WHERE id = $1 AND state IN ('claimed', 'revealed')`,
      [claimId],
    );
    throw new Error('Claim has expired');
  }
  return withTx(poolOrClient, async (executor) => {
    const claim = (await executor.query(`SELECT * FROM task_claims WHERE id = $1 FOR UPDATE`, [claimId])).rows[0];
    if (claim.state !== 'revealed') throw new Error(`Claim is ${claim.state}`);
    const task = await taskRow(executor, claim.task_id);
    if (!(await isProjectAdmin(executor, task.projectId, actorUserId))) {
      throw new Error('award_not_authorized');
    }
    if (task.assignee && String(task.assignee) !== String(claim.claimant_user_id)) {
      throw new Error('task_assigned_elsewhere');
    }
    await executor.query(`UPDATE project_tasks SET assignee_user_id = $2 WHERE id = $1`, [claim.task_id, claim.claimant_user_id]);
    const { rows } = await executor.query(
      `UPDATE task_claims SET state = 'awarded', winner_user_id = $2, decided_by_user_id = $3, decided_at = now()
        WHERE id = $1 RETURNING *`,
      [claimId, claim.claimant_user_id, actorUserId],
    );
    return rows[0];
  });
}

export async function releaseClaim(poolOrClient, { claimId, actorUserId }) {
  if (!claimId) throw new Error('claimId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  return withTx(poolOrClient, async (executor) => {
    const claim = (await executor.query(`SELECT * FROM task_claims WHERE id = $1 FOR UPDATE`, [claimId])).rows[0];
    if (!claim) throw new Error('Claim not found');
    if (!['claimed', 'revealed'].includes(claim.state)) throw new Error(`Claim is ${claim.state}`);
    const task = await taskRow(executor, claim.task_id);
    const selfSide = String(actorUserId) === String(claim.claimant_user_id);
    if (!selfSide && !(await isProjectAdmin(executor, task.projectId, actorUserId))) {
      throw new Error('release_not_authorized');
    }
    const { rows } = await executor.query(
      `UPDATE task_claims SET state = 'released', decided_by_user_id = $2, decided_at = now()
        WHERE id = $1 RETURNING *`,
      [claimId, actorUserId],
    );
    return rows[0];
  });
}

export async function readClaim(poolOrClient, claimId) {
  const { rows } = await poolOrClient.query(`SELECT * FROM task_claims WHERE id = $1`, [claimId]);
  if (rows.length === 0) throw new Error('Claim not found');
  return rows[0];
}
