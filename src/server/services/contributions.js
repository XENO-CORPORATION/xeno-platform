import { randomUUID } from 'node:crypto';
import { resolvePrincipal } from './agentIdentity.js';
import { check } from '../utils/authzReBAC.js';
import { transitionInner } from './contributionLifecycle.js';
import { supersedePriorJudgments } from './submissionIntegrity.js';

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

// PUB-10: a revision may carry a retrievable artifact — a diff or a
// versioned artifact locator — plus run references, alongside its
// opaque hash. License and provenance stay on the record itself.
function checkedArtifact(artifact) {
  if (artifact === null || artifact === undefined) return null;
  if (typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new Error('artifact must be an object');
  }
  const locator = artifact.diffRef ?? artifact.artifactUrn ?? artifact.locator;
  if (typeof locator !== 'string' || !locator.trim() || locator.length > 1024) {
    throw new Error('artifact names a diff or versioned artifact locator');
  }
  if (artifact.runs !== undefined) {
    if (!Array.isArray(artifact.runs)
      || artifact.runs.some((r) => typeof r !== 'string' || !r.trim() || r.length > 512)) {
      throw new Error('artifact run references must be strings');
    }
  }
  return artifact;
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

export async function setContributionTerms(poolOrClient, { projectId, actorUserId, requiresCla, claId = null, claVersion = null }) {
  if (!projectId) throw new Error('projectId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  if (typeof requiresCla !== 'boolean') throw new Error('requiresCla must be boolean');
  if (requiresCla && (typeof claId !== 'string' || !claId.trim())) {
    throw new Error('a required contributor agreement names its id');
  }
  return withTx(poolOrClient, async (executor) => {
    const owner = (await executor.query(`SELECT owner_user_id FROM chat_projects WHERE id = $1`, [projectId])).rows[0];
    if (!owner) throw new Error('Project not found');
    let admin = owner.owner_user_id && String(owner.owner_user_id) === String(actorUserId);
    if (!admin) {
      admin = (await check(executor, {
        object: `project:${projectId}`, relation: 'admin', subject: `user:${actorUserId}`,
      })).allowed === true;
    }
    if (!admin) throw new Error('contribution_terms_not_authorized');
    const { rows } = await executor.query(
      `INSERT INTO project_contribution_terms (project_id, requires_cla, cla_id, cla_version, updated_by_user_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (project_id) DO UPDATE
          SET requires_cla = EXCLUDED.requires_cla, cla_id = EXCLUDED.cla_id,
              cla_version = EXCLUDED.cla_version, updated_by_user_id = EXCLUDED.updated_by_user_id,
              updated_at = now()
        RETURNING *`,
      [projectId, requiresCla, claId, claVersion, actorUserId],
    );
    return rows[0];
  });
}

export async function readContributionTerms(executor, projectId) {
  const { rows } = await executor.query(
    `SELECT requires_cla AS "requiresCla", cla_id AS "claId", cla_version AS "claVersion"
       FROM project_contribution_terms WHERE project_id = $1`,
    [projectId],
  );
  if (rows.length === 0) return { requiresCla: false, claId: null, claVersion: null };
  return rows[0];
}

// The terms version a contribution submits under: the project's published
// terms where published, else the current draft's, else none yet. The
// snapshot pins the contribution to the terms both sides saw.
export async function currentTermsVersion(executor, projectId) {
  const { rows } = await executor.query(
    `SELECT COALESCE(v.projection->>'termsVersion', (p.draft->>'termsVersion')) AS "termsVersion"
       FROM project_publications p
       LEFT JOIN project_publication_versions v
         ON v.project_id = p.project_id AND v.revision = p.published_revision
      WHERE p.project_id = $1`,
    [projectId],
  );
  if (rows.length === 0) return null;
  return rows[0].termsVersion ?? null;
}

export async function submitContribution(poolOrClient, {
  projectId, taskId = null, type, authorUserId, responsibleUserId,
  provenance = null, revisionHash, evidence = [],
  origin = null, rightsLicense = null, claId = null, artifact = null,
}) {
  if (!projectId) throw new Error('projectId is required');
  if (!TYPES.includes(type)) throw new Error('Unknown contribution type');
  if (!authorUserId) throw new Error('authorUserId is required');
  if (!responsibleUserId) throw new Error('responsibleUserId is required');
  // PUB-04: every contribution declares its origin and rights. No
  // declaration, no submission — reuse is never assumed.
  if (typeof origin !== 'string' || !origin.trim() || origin.length > 500) {
    throw new Error('origin declaration is required');
  }
  if (typeof rightsLicense !== 'string' || !rightsLicense.trim() || rightsLicense.length > 500) {
    throw new Error('rights declaration is required');
  }
  if (claId !== null && (typeof claId !== 'string' || !claId.trim() || claId.length > 200)) {
    throw new Error('invalid contributor agreement reference');
  }
  const hash = checkedHash(revisionHash);
  const items = checkedEvidence(type, evidence);
  const bundle = checkedArtifact(artifact);
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
    const terms = await readContributionTerms(executor, projectId);
    if (terms.requiresCla && claId !== terms.claId) {
      throw new Error('required contributor agreement is missing or mismatched');
    }
    const termsVersion = await currentTermsVersion(executor, projectId);
    const id = randomUUID();
    await executor.query(
      `INSERT INTO contributions (id, project_id, task_id, type, author_user_id, responsible_user_id, provenance,
          current_revision_no, origin, rights_license, cla_id, terms_version)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9, $10, $11)`,
      [id, projectId, taskId, type, authorUserId, responsibleUserId,
        provenance === null ? null : JSON.stringify(provenance),
        origin.trim(), rightsLicense.trim(), claId === null ? null : claId.trim(), termsVersion],
    );
    await executor.query(
      `INSERT INTO contribution_revisions (contribution_id, revision_no, revision_hash, evidence, submitted_by_user_id, artifact)
        VALUES ($1, 1, $2, $3, $4, $5)`,
      [id, hash, JSON.stringify(items), authorUserId, bundle === null ? null : JSON.stringify(bundle)],
    );
    return readContribution(executor, id);
  });
}

export async function submitRevision(poolOrClient, { contributionId, actorUserId, revisionHash, evidence = [], artifact = null }) {
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
    // Accepted and terminal contributions are read-only: a rebase after
    // acceptance is a new contribution, not a rewrite. A rebase during
    // review returns the record to submitted for re-review.
    if (['accepted', 'integrated', 'rejected', 'withdrawn'].includes(current.review_state)) {
      throw new Error(`contribution is ${current.review_state} and read-only`);
    }
    const items = checkedEvidence(current.type, evidence);
    const bundle = checkedArtifact(artifact);
    const next = Number(current.current_revision_no) + 1;
    await executor.query(
      `INSERT INTO contribution_revisions (contribution_id, revision_no, revision_hash, evidence, submitted_by_user_id, artifact)
        VALUES ($1, $2, $3, $4, $5, $6)`,
      [contributionId, next, hash, JSON.stringify(items), actorUserId,
        bundle === null ? null : JSON.stringify(bundle)],
    );
    await executor.query(
      `UPDATE contributions SET current_revision_no = $2 WHERE id = $1`,
      [contributionId, next],
    );
    // PUB-10: the new revision supersedes every judgment on an older one.
    await supersedePriorJudgments(executor, contributionId, next);
    if (['review', 'checks_pending', 'changes_requested'].includes(current.review_state)) {
      await transitionInner(executor, {
        contributionId, actorUserId, toState: 'submitted',
        rationale: `revision ${next} supersedes ${current.review_state}; re-review required`,
      });
    }
    return readContribution(executor, contributionId);
  });
}

export async function readContribution(poolOrClient, contributionId) {
  const { rows } = await poolOrClient.query(`SELECT * FROM contributions WHERE id = $1`, [contributionId]);
  if (rows.length === 0) throw new Error('Contribution not found');
  const record = rows[0];
  const revisions = (await poolOrClient.query(
    `SELECT revision_no AS "revisionNo", revision_hash AS "revisionHash", evidence, artifact,
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
    origin: record.origin,
    rightsLicense: record.rights_license,
    claId: record.cla_id,
    termsVersion: record.terms_version,
    revisions,
  };
}
