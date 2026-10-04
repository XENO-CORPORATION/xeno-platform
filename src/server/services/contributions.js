import { randomUUID } from 'node:crypto';
import { resolvePrincipal } from './agentIdentity.js';

// PUB-05: contribution records. Every contribution names its type, author,
// responsible human/account, optional agent/team provenance, target
// task/project, evidence and review state; submitted revisions are opaque
// immutable hashes — a dataset URN, a credit lot reference, a model
// checkpoint id — never forced into a Git commit. New submissions append
// revisions; history is never rewritten. Review-state transitions belong
// to the lifecycle build; records open as pending here.
const TYPES = ['code', 'documentation', 'design-assets', 'dataset',
  'evaluation', 'agent-work', 'credits', 'resource-offer'];
const EVIDENCE_REQUIRED = ['code', 'documentation', 'agent-work'];

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

function checkedEvidence(type, evidence) {
  if (!Array.isArray(evidence)) throw new Error('evidence must be an array');
  if (EVIDENCE_REQUIRED.includes(type) && evidence.length === 0) {
    throw new Error(`${type} contributions require evidence`);
  }
  for (const item of evidence) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('evidence items must be objects');
    }
  }
  return evidence;
}

function checkedHash(revisionHash) {
  if (typeof revisionHash !== 'string' || !revisionHash.trim() || revisionHash.length > 512) {
    throw new Error('revisionHash must be a non-empty string');
  }
  return revisionHash;
}

async function taskProject(executor, taskId) {
  const { rows } = await executor.query(
    `SELECT g.project_id AS "projectId" FROM project_tasks t
       JOIN project_milestones m ON m.id = t.milestone_id
       JOIN project_goals g ON g.id = m.goal_id
      WHERE t.id = $1`,
    [taskId],
  );
  if (rows.length === 0) throw new Error('Task not found');
  return rows[0].projectId;
}

export async function submitContribution(poolOrClient, {
  projectId, taskId = null, type, authorUserId, responsibleUserId,
  provenance = null, revisionHash, evidence = [],
}) {
  if (!projectId) throw new Error('projectId is required');
  if (!TYPES.includes(type)) throw new Error('Unknown contribution type');
  if (!authorUserId) throw new Error('authorUserId is required');
  if (!responsibleUserId) throw new Error('responsibleUserId is required');
  const hash = checkedHash(revisionHash);
  const items = checkedEvidence(type, evidence);
  if (provenance !== null && (typeof provenance !== 'object' || Array.isArray(provenance))) {
    throw new Error('provenance must be an object');
  }
  return withTx(poolOrClient, async (executor) => {
    const project = (await executor.query(`SELECT id FROM chat_projects WHERE id = $1`, [projectId])).rows[0];
    if (!project) throw new Error('Project not found');
    if (taskId !== null && String(await taskProject(executor, taskId)) !== String(projectId)) {
      throw new Error('Task is not on this project');
    }
    const author = await resolvePrincipal(executor, authorUserId);
    if (!author?.usable) throw new Error('author_not_usable');
    const responsible = await resolvePrincipal(executor, responsibleUserId);
    if (!responsible?.usable || responsible.kind !== 'human') {
      throw new Error('responsible_must_be_human');
    }
    const id = randomUUID();
    await executor.query(
      `INSERT INTO contributions (id, project_id, task_id, type, author_user_id, responsible_user_id, provenance, current_revision_no)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
      [id, projectId, taskId, type, authorUserId, responsibleUserId,
        provenance === null ? null : JSON.stringify(provenance)],
    );
    await executor.query(
      `INSERT INTO contribution_revisions (contribution_id, revision_no, revision_hash, evidence, submitted_by_user_id)
        VALUES ($1, 1, $2, $3, $4)`,
      [id, hash, JSON.stringify(items), authorUserId],
    );
    return readContribution(executor, id);
  });
}

export async function submitRevision(poolOrClient, { contributionId, actorUserId, revisionHash, evidence = [] }) {
  if (!contributionId) throw new Error('contributionId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  const hash = checkedHash(revisionHash);
  return withTx(poolOrClient, async (executor) => {
    const current = (await executor.query(
      `SELECT * FROM contributions WHERE id = $1 FOR UPDATE`, [contributionId],
    )).rows[0];
    if (!current) throw new Error('Contribution not found');
    if (String(actorUserId) !== String(current.author_user_id)
      && String(actorUserId) !== String(current.responsible_user_id)) {
      throw new Error('revision_not_authorized');
    }
    const items = checkedEvidence(current.type, evidence);
    const next = Number(current.current_revision_no) + 1;
    await executor.query(
      `INSERT INTO contribution_revisions (contribution_id, revision_no, revision_hash, evidence, submitted_by_user_id)
        VALUES ($1, $2, $3, $4, $5)`,
      [contributionId, next, hash, JSON.stringify(items), actorUserId],
    );
    await executor.query(
      `UPDATE contributions SET current_revision_no = $2 WHERE id = $1`,
      [contributionId, next],
    );
    return readContribution(executor, contributionId);
  });
}

export async function readContribution(poolOrClient, contributionId) {
  const { rows } = await poolOrClient.query(`SELECT * FROM contributions WHERE id = $1`, [contributionId]);
  if (rows.length === 0) throw new Error('Contribution not found');
  const record = rows[0];
  const revisions = (await poolOrClient.query(
    `SELECT revision_no AS "revisionNo", revision_hash AS "revisionHash", evidence,
            submitted_by_user_id AS "submittedBy", submitted_at AS "submittedAt"
       FROM contribution_revisions WHERE contribution_id = $1 ORDER BY revision_no`,
    [contributionId],
  )).rows;
  return {
    id: record.id,
    projectId: record.project_id,
    taskId: record.task_id,
    type: record.type,
    authorUserId: record.author_user_id,
    responsibleUserId: record.responsible_user_id,
    provenance: record.provenance,
    currentRevisionNo: Number(record.current_revision_no),
    reviewState: record.review_state,
    revisions,
  };
}
