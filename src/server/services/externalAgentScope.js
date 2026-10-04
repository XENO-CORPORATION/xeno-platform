import { randomUUID } from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { resolvePrincipal } from './agentIdentity.js';

// PUB-08: external contributors' agents run under scoped identities that
// cannot see internal-only data. A maintainer binds the contributor's
// agent user to the accepted engagement after verifying the chain
// (agent owned by the engagement's actor, engagement live). One uniform
// gate fronts every internal surface: conversations, credentials,
// unrelated projects and tasks, sibling claims, others' reviews and
// unaccepted drafts all fail closed; the agent reads its own task,
// engagement, claims, contributions and working memory only. Scope
// expiry revokes everything at once. Agents with no live scope read
// nothing through this gate.
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

export async function bindExternalAgent(poolOrClient, { engagementId, agentUserId, actorUserId, ttlSeconds = 86400 }) {
  if (!engagementId) throw new Error('engagementId is required');
  if (!agentUserId) throw new Error('agentUserId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  const ttl = Number(ttlSeconds);
  if (!Number.isInteger(ttl) || ttl <= 0) throw new Error('ttlSeconds must be positive');
  return withTx(poolOrClient, async (executor) => {
    const engagement = (await executor.query(
      `SELECT * FROM task_engagements WHERE id = $1`, [engagementId],
    )).rows[0];
    if (!engagement) throw new Error('Engagement not found');
    if (!(await isProjectAdmin(executor, engagement.project_id, actorUserId))) {
      throw new Error('bind_not_authorized');
    }
    if (engagement.state !== 'active') throw new Error('Engagement is not active');
    if (new Date(engagement.expires_at) <= new Date()) throw new Error('Engagement has expired');
    const agent = await resolvePrincipal(executor, agentUserId);
    if (!agent?.usable || agent.kind !== 'agent') throw new Error('scope_requires_agent');
    const identity = (await executor.query(
      `SELECT owner_user_id AS "owner" FROM agent_identities WHERE user_id = $1`,
      [agentUserId],
    )).rows[0];
    if (!identity || String(identity.owner) !== String(engagement.actor_user_id)) {
      throw new Error('agent_not_owned_by_actor');
    }
    const id = randomUUID();
    const { rows } = await executor.query(
      `INSERT INTO external_agent_scopes (id, agent_user_id, engagement_id, project_id, task_id, expires_at, bound_by_user_id)
        VALUES ($1, $2, $3, $4, $5, LEAST($6::timestamptz, now() + make_interval(secs => $7)), $8)
        RETURNING *`,
      [id, agentUserId, engagementId, engagement.project_id, engagement.task_id,
        engagement.expires_at, ttl, actorUserId],
    );
    return rows[0];
  });
}

// The one gate. Returns the live scope plus the agent owner's id, or
// throws. Every scoped reader below funnels through here.
async function liveScope(executor, agentUserId, projectId = null, taskId = null) {
  const { rows } = await executor.query(
    `SELECT s.*, a.owner_user_id AS "ownerUserId"
       FROM external_agent_scopes s
       JOIN agent_identities a ON a.user_id = s.agent_user_id
      WHERE s.agent_user_id = $1 AND s.expires_at > now()
        AND ($2::uuid IS NULL OR s.project_id = $2)
        AND ($3::uuid IS NULL OR s.task_id = $3)
      LIMIT 1`,
    [agentUserId, projectId, taskId],
  );
  if (rows.length === 0) throw new Error('no_live_scope');
  return rows[0];
}

function denied(surface) {
  throw new Error(`external_agent_denied:${surface}`);
}

export async function readScopedTask(poolOrClient, { agentUserId, taskId }) {
  const scope = await liveScope(poolOrClient, agentUserId, null, taskId);
  if (String(scope.task_id) !== String(taskId)) denied('task');
  const { rows } = await poolOrClient.query(`SELECT * FROM project_tasks WHERE id = $1`, [taskId]);
  return rows[0];
}

export async function readScopedEngagement(poolOrClient, { agentUserId, engagementId }) {
  const scope = await liveScope(poolOrClient, agentUserId);
  if (String(scope.engagement_id) !== String(engagementId)) denied('engagement');
  const { rows } = await poolOrClient.query(`SELECT * FROM task_engagements WHERE id = $1`, [engagementId]);
  return rows[0];
}

export async function readScopedClaim(poolOrClient, { agentUserId, claimId }) {
  const scope = await liveScope(poolOrClient, agentUserId);
  const { rows } = await poolOrClient.query(`SELECT * FROM task_claims WHERE id = $1`, [claimId]);
  if (rows.length === 0) throw new Error('Claim not found');
  // Own claims only: a sibling's claim on the same task is internal.
  if (String(rows[0].claimant_user_id) !== String(scope.ownerUserId)) denied('claim');
  return rows[0];
}

export async function readScopedContribution(poolOrClient, { agentUserId, contributionId }) {
  const scope = await liveScope(poolOrClient, agentUserId);
  const { rows } = await poolOrClient.query(`SELECT * FROM contributions WHERE id = $1`, [contributionId]);
  if (rows.length === 0) throw new Error('Contribution not found');
  if (String(rows[0].author_user_id) !== String(scope.ownerUserId)) denied('contribution');
  return rows[0];
}

export async function readScopedTransitions(poolOrClient, { agentUserId, contributionId }) {
  await readScopedContribution(poolOrClient, { agentUserId, contributionId });
  const { rows } = await poolOrClient.query(
    `SELECT * FROM contribution_transitions WHERE contribution_id = $1 ORDER BY created_at, id`,
    [contributionId],
  );
  return rows;
}

export async function readScopedConversation(poolOrClient, { agentUserId, conversationId }) {
  await liveScope(poolOrClient, agentUserId);
  const { rows } = await poolOrClient.query(`SELECT * FROM chat_conversations WHERE id = $1`, [conversationId]);
  if (rows.length === 0) throw new Error('Conversation not found');
  // Working memory only: conversations the agent itself runs. Every
  // internal conversation — maintainer, team, other agent — refuses.
  if (String(rows[0].owner_user_id) !== String(agentUserId)) denied('conversation');
  return rows[0];
}

export async function readScopedProject(poolOrClient, { agentUserId, projectId }) {
  const scope = await liveScope(poolOrClient, agentUserId, projectId);
  if (String(scope.project_id) !== String(projectId)) denied('project');
  const { rows } = await poolOrClient.query(`SELECT id, name FROM chat_projects WHERE id = $1`, [projectId]);
  return rows[0];
}

export async function readScopedCredential() {
  // Credentials have no scoped form: the surface exists only to refuse.
  denied('credential');
}

export async function readScopedDraft(poolOrClient, { agentUserId, projectId }) {
  await liveScope(poolOrClient, agentUserId, projectId);
  // Unaccepted drafts are internal even on the agent's own project.
  denied('draft');
}
