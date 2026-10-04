import { randomUUID } from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { readProjectPolicies } from './projectPolicies.js';
import { mutateProjectPublication } from './projectPublication.js';

// PUB-13: going private. The retreat revokes future public access
// across the controlled services — the project publication, every
// conversation publication, every live share link and every
// project-attributed artifact link — and records what it revoked.
// It refuses without an explicit acknowledgment that taken copies
// and forks cannot be recalled. The external repository mirror keeps
// its own visibility: changing it never moves the XENO project, and
// retreating the project never moves it.
export const UNRECALLABLE_WARNING =
  'Public copies and forks already taken cannot be recalled; this revokes future access in controlled services only.';

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

export async function linkRepository(poolOrClient, {
  projectId, actorUserId, provider, remoteUrl, repoVisibility,
}) {
  if (!projectId) throw new Error('projectId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  if (typeof provider !== 'string' || !provider.trim() || provider.length > 80) {
    throw new Error('provider names the repository host');
  }
  if (typeof remoteUrl !== 'string' || !remoteUrl.trim() || remoteUrl.length > 512) {
    throw new Error('remoteUrl names the repository');
  }
  if (!['public', 'private'].includes(repoVisibility)) throw new Error('Unknown repository visibility');
  return withTx(poolOrClient, async (executor) => {
    if (!(await isProjectAdmin(executor, projectId, actorUserId))) {
      throw new Error('repository_link_not_authorized');
    }
    const { rows } = await executor.query(
      `INSERT INTO project_repositories (project_id, provider, remote_url, repo_visibility, linked_by_user_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (project_id) DO UPDATE SET provider = $2, remote_url = $3,
          repo_visibility = $4, linked_by_user_id = $5, updated_at = now()
        RETURNING *`,
      [projectId, provider.trim(), remoteUrl.trim(), repoVisibility, actorUserId],
    );
    return rows[0];
  });
}

// The mirror's visibility is the maintainer's report of the host
// state. It touches the mirror row and nothing else — never the
// XENO project's own visibility.
export async function setRepositoryVisibility(poolOrClient, { projectId, actorUserId, repoVisibility }) {
  if (!['public', 'private'].includes(repoVisibility)) throw new Error('Unknown repository visibility');
  return withTx(poolOrClient, async (executor) => {
    if (!(await isProjectAdmin(executor, projectId, actorUserId))) {
      throw new Error('repository_link_not_authorized');
    }
    const { rows } = await executor.query(
      `UPDATE project_repositories SET repo_visibility = $2, updated_at = now()
        WHERE project_id = $1 RETURNING *`,
      [projectId, repoVisibility],
    );
    if (rows.length === 0) throw new Error('Repository is not linked');
    return rows[0];
  });
}

export async function readRepositoryLink(poolOrClient, projectId) {
  const { rows } = await poolOrClient.query(
    `SELECT * FROM project_repositories WHERE project_id = $1`, [projectId],
  );
  return rows[0] ?? null;
}

export async function retreatProjectToPrivate(poolOrClient, {
  projectId, actorUserId, acknowledgeUnrecallable = false, clientId = 'visibility-retreat',
}) {
  if (!projectId) throw new Error('projectId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  if (acknowledgeUnrecallable !== true) throw new Error('unrecallable_ack_required');
  if (!isPool(poolOrClient)) throw new Error('retreat requires a pool');
  // Fail-closed ordering: the sanctioned publication revoke commits
  // first, in its own authority transaction; the retreat sweep below
  // only ever removes more access, never restores any.
  const policies = await readProjectPolicies(poolOrClient, projectId);
  if (policies.visibility === 'private') throw new Error('already_private');
  const client = await poolOrClient.connect();
  try {
    if (!(await isProjectAdmin(client, projectId, actorUserId))) throw new Error('retreat_not_authorized');
  } finally {
    client.release();
  }
  let publicationRevoked = false;
  const pubRow = (await poolOrClient.query(
    `SELECT revision, visibility, published_revision FROM project_publications WHERE project_id = $1`,
    [projectId],
  )).rows[0];
  if (pubRow && pubRow.visibility !== 'private' && pubRow.published_revision !== null) {
    await mutateProjectPublication(poolOrClient, { actorUserId, clientId }, {
      projectId, expectedActorAccountId: actorUserId, operationId: randomUUID(),
      action: 'revoke', expectedRevision: String(pubRow.revision),
    });
    publicationRevoked = true;
  }
  return withTx(poolOrClient, async (executor) => {
    await executor.query(
      `INSERT INTO project_publications (project_id) VALUES ($1) ON CONFLICT DO NOTHING`, [projectId],
    );
    await executor.query(
      `UPDATE project_publications SET visibility = 'private', updated_at = now() WHERE project_id = $1`,
      [projectId],
    );
    const conversations = (await executor.query(
      `SELECT id FROM chat_conversations WHERE project_id = $1 AND deleted_at IS NULL`, [projectId],
    )).rows.map((r) => r.id);
    let revokedPubs = 0, revokedShares = 0;
    if (conversations.length > 0) {
      revokedPubs = (await executor.query(
        `UPDATE conversation_publications SET state = 'revoked', revoked_at = now()
          WHERE conversation_id = ANY($1::uuid[]) AND state = 'published'`,
        [conversations],
      )).rowCount;
      revokedShares = (await executor.query(
        `UPDATE chat_shared_conversations SET revoked_at = now()
          WHERE conversation_id = ANY($1::uuid[]) AND revoked_at IS NULL AND expires_at > now()`,
        [conversations],
      )).rowCount;
    }
    const revokedLinks = (await executor.query(
      `UPDATE artifact_public_links SET state = 'revoked', revoked_at = now()
        WHERE project_id = $1 AND state = 'published'`,
      [projectId],
    )).rowCount;
    // The mirror row is deliberately untouched: retreating the XENO
    // project never moves the repository's own visibility.
    const { rows } = await executor.query(
      `INSERT INTO project_visibility_retreats (project_id, from_visibility, publication_revoked,
          revoked_conversation_publications, revoked_share_links, revoked_artifact_links, warning, actor_user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [projectId, policies.visibility, publicationRevoked, revokedPubs, revokedShares,
        revokedLinks, UNRECALLABLE_WARNING, actorUserId],
    );
    return { ...rows[0], warning: UNRECALLABLE_WARNING };
  });
}
