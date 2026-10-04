import { check } from '../utils/authzReBAC.js';

// PUB-01: ownership, visibility, contribution policy and execution
// permissions are four independent fields. Each setter writes exactly one
// column; reads join them without merging their meanings. Unlisted
// visibility grants projection reads through a direct link and NOTHING
// else — it never authorizes contribution, execution or administration,
// and public visibility exposes only the allowlisted published
// projection, never the workspace, conversations, paths or credentials.
const CONTRIBUTION_POLICIES = ['offers-open', 'maintainers-only', 'closed'];
const EXECUTION_POLICIES = ['sandbox-only', 'maintainer-runners', 'none'];

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

async function setPolicy(poolOrClient, column, allowed, { projectId, actorUserId, value }) {
  if (!projectId) throw new Error('projectId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  if (!allowed.includes(value)) throw new Error(`Unknown ${column}`);
  return withTx(poolOrClient, async (executor) => {
    if (!(await isProjectAdmin(executor, projectId, actorUserId))) {
      throw new Error('policy_change_not_authorized');
    }
    await executor.query(
      `INSERT INTO project_publications (project_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [projectId],
    );
    const { rows } = await executor.query(
      `UPDATE project_publications SET ${column} = $2, updated_at = now()
        WHERE project_id = $1 RETURNING *`,
      [projectId, value],
    );
    return rows[0];
  });
}

export function setContributionPolicy(poolOrClient, args) {
  return setPolicy(poolOrClient, 'contribution_policy', CONTRIBUTION_POLICIES, args);
}

export function setExecutionPolicy(poolOrClient, args) {
  return setPolicy(poolOrClient, 'execution_policy', EXECUTION_POLICIES, args);
}

export async function readProjectPolicies(poolOrClient, projectId) {
  const { rows } = await poolOrClient.query(
    `SELECT c.owner_user_id AS "ownerUserId", p.visibility, p.contribution_policy AS "contributionPolicy",
            p.execution_policy AS "executionPolicy", p.published_revision AS "publishedRevision"
       FROM chat_projects c LEFT JOIN project_publications p ON p.project_id = c.id
      WHERE c.id = $1`,
    [projectId],
  );
  if (rows.length === 0) throw new Error('Project not found');
  const row = rows[0];
  return {
    ownerUserId: row.ownerUserId,
    visibility: row.visibility ?? 'private',
    contributionPolicy: row.contributionPolicy ?? 'maintainers-only',
    executionPolicy: row.executionPolicy ?? 'none',
    publishedRevision: row.publishedRevision === null || row.publishedRevision === undefined
      ? null
      : String(row.publishedRevision),
  };
}

// One decision point. viaLink models possession of an unlisted URL: it
// opens the published projection and authorizes nothing beyond that.
// Owners and project admins hold every action subject to the policies;
// strangers never execute or administer, and contribute only by offer
// where the contribution policy opens that door (PUB-03 refines offers).
export async function authorizeProjectAction(poolOrClient, { projectId, viewerUserId, action, viaLink = false }) {
  if (!['read-public', 'contribute', 'execute', 'admin'].includes(action)) {
    throw new Error('Unknown action');
  }
  const policies = await readProjectPolicies(poolOrClient, projectId);
  let privileged = false;
  if (viewerUserId) {
    privileged = String(policies.ownerUserId || '') === String(viewerUserId);
    if (!privileged) {
      const verdict = await check(poolOrClient, {
        object: `project:${projectId}`,
        relation: 'admin',
        subject: `user:${viewerUserId}`,
      });
      privileged = verdict.allowed === true;
    }
  }
  if (privileged) {
    if (action === 'execute') return policies.executionPolicy !== 'none';
    return true;
  }
  if (action === 'read-public') {
    if (policies.visibility === 'public') return true;
    if (policies.visibility === 'unlisted' && viaLink) return true;
    return false;
  }
  if (action === 'contribute') {
    return policies.visibility !== 'private' && policies.contributionPolicy === 'offers-open';
  }
  return false;
}
