import { resolvePrincipal } from './agentIdentity.js';
import { readPublicProject } from './projectPublication.js';
import { REDISTRIBUTABLE_LICENCES } from './marketplaceTeamPackages.js';

// PUB-14: public project fork and export. The fork reads only the
// live public projection — the same surface a stranger sees — so
// drafts, funds, rentals, credentials, memberships and private
// history cannot cross by construction. The upstream license must
// permit redistribution; the fork takes independent ownership and
// records its upstream provenance. Forks submit upstream through the
// ordinary contribution path, which this build reuses unmodified.
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

// The forkable bundle: the live public projection plus the license
// verdict. Anything unpublished refuses here, before a row exists.
export async function exportProjectBundle(poolOrClient, projectId) {
  let projection;
  try {
    projection = await readPublicProject(poolOrClient, projectId);
  } catch {
    throw new Error('project_not_public');
  }
  if (!REDISTRIBUTABLE_LICENCES.has(projection.license)) {
    throw new Error('fork_refused_not_redistributable');
  }
  return {
    upstreamProjectId: projection.projectId,
    upstreamRevision: projection.revision,
    license: projection.license,
    metadata: projection,
  };
}

export async function forkProject(poolOrClient, { upstreamProjectId, forkerUserId, name = null }) {
  if (!upstreamProjectId) throw new Error('upstreamProjectId is required');
  if (!forkerUserId) throw new Error('forkerUserId is required');
  if (name !== null && (typeof name !== 'string' || !name.trim() || name.length > 200)) {
    throw new Error('invalid fork name');
  }
  const bundle = await exportProjectBundle(poolOrClient, upstreamProjectId);
  return withTx(poolOrClient, async (executor) => {
    const forker = await resolvePrincipal(executor, forkerUserId);
    if (!forker?.usable) throw new Error('forker_not_usable');
    const upstream = (await executor.query(
      `SELECT owner_user_id FROM chat_projects WHERE id = $1`, [upstreamProjectId],
    )).rows[0];
    if (!upstream) throw new Error('Upstream project not found');
    const title = name === null ? `${bundle.metadata.title} fork` : name.trim();
    const fork = (await executor.query(
      `INSERT INTO chat_projects (user_id, owner_user_id, name) VALUES ($1, $1, $2) RETURNING *`,
      [forkerUserId, title],
    )).rows[0];
    // Independent ownership by construction: the fork names the
    // forker, copies no membership tuple, and starts with no tasks,
    // funds, credentials or history of any kind.
    const { rows } = await executor.query(
      `INSERT INTO project_forks (fork_project_id, upstream_project_id, upstream_revision,
          upstream_license, metadata, forked_by_user_id)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [fork.id, upstreamProjectId, bundle.upstreamRevision, bundle.license,
        JSON.stringify(bundle.metadata), forkerUserId],
    );
    return { fork: fork, provenance: rows[0] };
  });
}

export async function readForkProvenance(poolOrClient, forkProjectId) {
  const { rows } = await poolOrClient.query(
    `SELECT fork_project_id AS "forkProjectId", upstream_project_id AS "upstreamProjectId",
            upstream_revision AS "upstreamRevision", upstream_license AS "upstreamLicense",
            metadata, forked_by_user_id AS "forkedBy", forked_at AS "forkedAt"
       FROM project_forks WHERE fork_project_id = $1`,
    [forkProjectId],
  );
  return rows[0] ?? null;
}
