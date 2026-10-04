import { randomUUID } from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { transitionInner } from './contributionLifecycle.js';
import { readContributionTerms, currentTermsVersion } from './contributions.js';

// PUB-10: submission integrity. A submission carries a retrievable
// artifact (diff or versioned artifact locator) and run references on
// each revision, reproducible check results bound to the revision they
// ran against, and license plus provenance on the record itself.
// Maintainers review the exact submitted revision: every review names
// its revision, and a new revision supersedes prior reviews and
// checks. Integration rechecks the target revision, the approval, the
// checks and the enforced policy atomically, at the maintainer
// authority, and only the maintainer side may integrate — never the
// author's own hand.
const DECISIONS = ['approve', 'request_changes', 'reject'];
const GATED_TYPES = ['code', 'documentation', 'agent-work'];

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

async function submittedRevision(executor, contributionId, revisionNo) {
  const no = Number(revisionNo);
  if (!Number.isInteger(no) || no < 1) throw new Error('revisionNo must be a positive integer');
  const { rows } = await executor.query(
    `SELECT * FROM contribution_revisions WHERE contribution_id = $1 AND revision_no = $2`,
    [contributionId, no],
  );
  if (rows.length === 0) throw new Error('Revision was never submitted');
  return rows[0];
}

async function lockedContribution(executor, contributionId) {
  const current = (await executor.query(
    `SELECT * FROM contributions WHERE id = $1 FOR UPDATE`, [contributionId],
  )).rows[0];
  if (!current) throw new Error('Contribution not found');
  return current;
}

export async function recordReview(poolOrClient, {
  contributionId, reviewerUserId, revisionNo, decision, rationale,
}) {
  if (!contributionId) throw new Error('contributionId is required');
  if (!reviewerUserId) throw new Error('reviewerUserId is required');
  if (!DECISIONS.includes(decision)) throw new Error('Unknown review decision');
  if (typeof rationale !== 'string' || !rationale.trim() || rationale.length > 4000) {
    throw new Error('a review rationale is required');
  }
  return withTx(poolOrClient, async (executor) => {
    const current = await lockedContribution(executor, contributionId);
    const revision = await submittedRevision(executor, contributionId, revisionNo);
    if (!(await isProjectAdmin(executor, current.project_id, reviewerUserId))) {
      throw new Error('review_not_authorized');
    }
    if (String(reviewerUserId) === String(current.author_user_id)) {
      throw new Error('self_review_refused');
    }
    const { rows } = await executor.query(
      `INSERT INTO contribution_reviews (id, contribution_id, revision_no, reviewer_user_id, decision, rationale)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [randomUUID(), contributionId, revision.revision_no, reviewerUserId, decision, rationale.trim()],
    );
    return rows[0];
  });
}

function checkedChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) throw new Error('checks must be a non-empty array');
  return checks.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('checks must be objects');
    const { name, status, definitionRef, inputDigest, runRef = null } = entry;
    if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new Error('check names its name');
    if (status !== 'pass' && status !== 'fail') throw new Error('check status is pass or fail');
    if (typeof definitionRef !== 'string' || !definitionRef.trim() || definitionRef.length > 512) {
      throw new Error('check names its reproducible definition');
    }
    if (typeof inputDigest !== 'string' || !inputDigest.trim() || inputDigest.length > 512) {
      throw new Error('check names its input digest');
    }
    if (runRef !== null && (typeof runRef !== 'string' || !runRef.trim() || runRef.length > 512)) {
      throw new Error('invalid check run reference');
    }
    return {
      name: name.trim(),
      status,
      definitionRef: definitionRef.trim(),
      inputDigest: inputDigest.trim(),
      runRef: runRef === null ? null : runRef.trim(),
    };
  });
}

export async function recordChecks(poolOrClient, { contributionId, actorUserId, revisionNo, checks }) {
  if (!contributionId) throw new Error('contributionId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  const items = checkedChecks(checks);
  return withTx(poolOrClient, async (executor) => {
    const current = await lockedContribution(executor, contributionId);
    const revision = await submittedRevision(executor, contributionId, revisionNo);
    const selfSide = String(actorUserId) === String(current.author_user_id)
      || String(actorUserId) === String(current.responsible_user_id);
    if (!selfSide && !(await isProjectAdmin(executor, current.project_id, actorUserId))) {
      throw new Error('checks_not_authorized');
    }
    const stored = [];
    for (const item of items) {
      const { rows } = await executor.query(
        `INSERT INTO contribution_checks (id, contribution_id, revision_no, name, status,
            definition_ref, input_digest, run_ref, recorded_by_user_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [randomUUID(), contributionId, revision.revision_no, item.name, item.status,
          item.definitionRef, item.inputDigest, item.runRef, actorUserId],
      );
      stored.push(rows[0]);
    }
    return stored;
  });
}

export async function readReviews(poolOrClient, contributionId) {
  const { rows } = await poolOrClient.query(
    `SELECT revision_no AS "revisionNo", reviewer_user_id AS "reviewerUserId",
            decision, rationale, superseded
       FROM contribution_reviews WHERE contribution_id = $1 ORDER BY created_at, id`,
    [contributionId],
  );
  return rows.map((r) => ({ ...r, revisionNo: Number(r.revisionNo) }));
}

export async function readChecks(poolOrClient, contributionId) {
  const { rows } = await poolOrClient.query(
    `SELECT revision_no AS "revisionNo", name, status, definition_ref AS "definitionRef",
            input_digest AS "inputDigest", run_ref AS "runRef", superseded
       FROM contribution_checks WHERE contribution_id = $1 ORDER BY created_at, id`,
    [contributionId],
  );
  return rows.map((r) => ({ ...r, revisionNo: Number(r.revisionNo) }));
}

// A new revision supersedes every review and check that judged an
// older one. Called from submitRevision inside its transaction.
export async function supersedePriorJudgments(executor, contributionId, currentRevisionNo) {
  await executor.query(
    `UPDATE contribution_reviews SET superseded = TRUE
      WHERE contribution_id = $1 AND revision_no < $2`,
    [contributionId, currentRevisionNo],
  );
  await executor.query(
    `UPDATE contribution_checks SET superseded = TRUE
      WHERE contribution_id = $1 AND revision_no < $2`,
    [contributionId, currentRevisionNo],
  );
}

function artifactLocator(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return null;
  const locator = artifact.diffRef ?? artifact.artifactUrn ?? artifact.locator;
  if (typeof locator !== 'string' || !locator.trim()) return null;
  return locator.trim();
}

// Merge rechecks everything atomically at the maintainer authority:
// exact target revision, a live approval on that revision, green
// checks where the type requires them, a retrievable artifact, and
// the enforced policy (contributor terms and pinned terms version).
export async function integrateContribution(poolOrClient, {
  contributionId, actorUserId, expectedRevisionNo, rationale,
}) {
  if (!contributionId) throw new Error('contributionId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  if (typeof rationale !== 'string' || !rationale.trim() || rationale.length > 4000) {
    throw new Error('an integration rationale is required');
  }
  const expected = Number(expectedRevisionNo);
  if (!Number.isInteger(expected) || expected < 1) throw new Error('expectedRevisionNo must be a positive integer');
  return withTx(poolOrClient, async (executor) => {
    const current = await lockedContribution(executor, contributionId);
    if (String(actorUserId) === String(current.author_user_id)) {
      throw new Error('self_integrate_refused');
    }
    if (!(await isProjectAdmin(executor, current.project_id, actorUserId))) {
      throw new Error('integrate_not_authorized');
    }
    if (current.review_state !== 'accepted') throw new Error('integrate_wrong_state');
    const live = Number(current.current_revision_no);
    if (live !== expected) throw new Error('stale_target_revision');
    const revision = await submittedRevision(executor, contributionId, live);
    if (artifactLocator(revision.artifact) === null) throw new Error('revision_has_no_artifact');
    const approval = (await executor.query(
      `SELECT decision FROM contribution_reviews
        WHERE contribution_id = $1 AND revision_no = $2 AND superseded = FALSE
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [contributionId, live],
    )).rows[0];
    if (!approval || approval.decision !== 'approve') throw new Error('no_approval_for_revision');
    if (GATED_TYPES.includes(current.type)) {
      const checks = (await executor.query(
        `SELECT status FROM contribution_checks
          WHERE contribution_id = $1 AND revision_no = $2 AND superseded = FALSE`,
        [contributionId, live],
      )).rows;
      if (checks.length === 0 || checks.some((c) => c.status !== 'pass')) {
        throw new Error('checks_not_green');
      }
    }
    const terms = await readContributionTerms(executor, current.project_id);
    if (terms.requiresCla && current.cla_id !== terms.claId) {
      throw new Error('contribution_policy_changed');
    }
    const termsVersion = await currentTermsVersion(executor, current.project_id);
    if ((current.terms_version ?? null) !== (termsVersion ?? null)) {
      throw new Error('contribution_policy_changed');
    }
    await transitionInner(executor, {
      contributionId, actorUserId, toState: 'integrated', rationale: rationale.trim(),
    });
    return { contributionId, revisionNo: live, state: 'integrated' };
  });
}
