import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { resolvePrincipal } from './agentIdentity.js';

// FORGE-03: the GitHub App path. Only approved Apps install, and only
// with minimum permissions — least privilege is a ceiling, not a
// suggestion. Execution receives short-lived installation tokens
// scoped to repositories and permissions; maintainer credentials
// never leave for outside execution under any kind name. Acting as
// the installation and attributing the human or agent are recorded
// as two separate facts on every ledger entry.
export const MINIMUM_PERMISSIONS = Object.freeze({
  contents: 'read', pull_requests: 'write', checks: 'read', metadata: 'read',
});
const LEVEL_RANK = { read: 1, write: 2, admin: 3 };
export const MAX_TOKEN_TTL_SECONDS = 3600;

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

function checkedPermissions(permissions, ceiling, venue) {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    throw new Error(`${venue} names its permissions`);
  }
  const keys = Object.keys(permissions);
  if (keys.length === 0) throw new Error(`${venue} names its permissions`);
  for (const key of keys) {
    const level = permissions[key];
    if (!LEVEL_RANK[level]) throw new Error(`unknown permission level for ${key}`);
    const cap = ceiling[key];
    if (!cap || LEVEL_RANK[level] > LEVEL_RANK[cap]) {
      throw new Error(`${venue}_permissions_excessive`);
    }
  }
  return permissions;
}

export async function approveGithubApp(poolOrClient, { appId, name, actorUserId, projectId }) {
  if (!appId) throw new Error('appId is required');
  if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new Error('invalid app name');
  return withTx(poolOrClient, async (executor) => {
    if (!(await isProjectAdmin(executor, projectId, actorUserId))) {
      throw new Error('app_approval_not_authorized');
    }
    const { rows } = await executor.query(
      `INSERT INTO github_apps (app_id, name, approved, approved_by_user_id, approved_at)
        VALUES ($1, $2, TRUE, $3, now())
        ON CONFLICT (app_id) DO UPDATE SET name = $2, approved = TRUE,
          approved_by_user_id = $3, approved_at = now()
        RETURNING *`,
      [String(appId), name.trim(), actorUserId],
    );
    return rows[0];
  });
}

export async function registerInstallation(poolOrClient, {
  appId, installationId, account, permissions, actorUserId, projectId,
}) {
  if (!installationId) throw new Error('installationId is required');
  if (typeof account !== 'string' || !account.trim() || account.length > 200) {
    throw new Error('invalid installation account');
  }
  const grant = checkedPermissions(permissions, MINIMUM_PERMISSIONS, 'installation');
  return withTx(poolOrClient, async (executor) => {
    if (!(await isProjectAdmin(executor, projectId, actorUserId))) {
      throw new Error('installation_not_authorized');
    }
    const app = (await executor.query(
      `SELECT approved FROM github_apps WHERE app_id = $1`, [String(appId)],
    )).rows[0];
    if (!app || !app.approved) throw new Error('app_not_approved');
    try {
      const { rows } = await executor.query(
        `INSERT INTO github_installations (installation_id, app_id, account, permissions, registered_by_user_id)
          VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [String(installationId), String(appId), account.trim(), JSON.stringify(grant), actorUserId],
      );
      return rows[0];
    } catch (err) {
      if (err && err.code === '23505') throw new Error('installation_exists');
      throw err;
    }
  });
}

function digestOf(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function mintInstallationToken(poolOrClient, {
  installationId, actorUserId, forUserId, repositories, permissions, ttlSeconds = 600,
}) {
  if (!installationId) throw new Error('installationId is required');
  if (!forUserId) throw new Error('forUserId is required');
  if (!Array.isArray(repositories) || repositories.length === 0 || repositories.length > 100
    || repositories.some((r) => typeof r !== 'string' || !r.trim() || r.length > 512)) {
    throw new Error('repositories names one to one hundred repositories');
  }
  const ttl = Number(ttlSeconds);
  if (!Number.isInteger(ttl) || ttl <= 0) throw new Error('ttlSeconds must be positive');
  if (ttl > MAX_TOKEN_TTL_SECONDS) throw new Error('token_ttl_excessive');
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  return withTx(poolOrClient, async (executor) => {
    const minter = await resolvePrincipal(executor, actorUserId);
    if (!minter?.usable) throw new Error('minter_not_usable');
    const installation = (await executor.query(
      `SELECT * FROM github_installations WHERE installation_id = $1`, [String(installationId)],
    )).rows[0];
    if (!installation) throw new Error('Installation not found');
    // FORGE-05: the terminal state reports first.
    if (installation.uninstalled) throw new Error('installation_uninstalled');
    if (installation.suspended) throw new Error('installation_suspended');
    const grant = checkedPermissions(permissions, installation.permissions, 'token');
    const subject = await resolvePrincipal(executor, forUserId);
    if (!subject?.usable) throw new Error('token_subject_not_usable');
    const { rows } = await executor.query(
      `INSERT INTO github_app_tokens (installation_id, token_digest, repositories, permissions,
          expires_at, minted_by_user_id, minted_for_user_id)
        VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5), $6, $7)
        RETURNING id, installation_id AS "installationId", repositories, permissions,
          expires_at AS "expiresAt"`,
      [installation.installation_id, digestOf(token), JSON.stringify(repositories),
        JSON.stringify(grant), ttl, actorUserId, forUserId],
    );
    return { ...rows[0], token };
  });
}

// The only credential an outside agent execution may receive is a
// short-lived installation token. Maintainer credential kinds refuse
// here, whatever the caller claims to need them for.
export async function requestExecutionCredentials(poolOrClient, { kind, agentUserId, ...tokenArgs }) {
  if (kind !== 'installation-token') throw new Error('maintainer_credentials_never_leave');
  if (!agentUserId) throw new Error('agentUserId is required');
  const subject = await resolvePrincipal(poolOrClient, agentUserId);
  if (!subject?.usable || subject.kind !== 'agent') throw new Error('execution_subject_must_be_agent');
  return mintInstallationToken(poolOrClient, { ...tokenArgs, forUserId: agentUserId });
}

export async function verifyInstallationToken(poolOrClient, token) {
  if (typeof token !== 'string' || !token) throw new Error('token_unknown');
  const row = (await poolOrClient.query(
    `SELECT t.*, i.suspended, i.uninstalled, i.app_id AS "appId" FROM github_app_tokens t
       JOIN github_installations i ON i.installation_id = t.installation_id
      WHERE t.token_digest = $1`,
    [digestOf(token)],
  )).rows[0];
  if (!row) throw new Error('token_unknown');
  if (row.uninstalled) throw new Error('installation_uninstalled');
  if (row.suspended) throw new Error('installation_suspended');
  if (new Date(row.expires_at) <= new Date()) throw new Error('token_expired');
  // FORGE-05: a revoked repository poisons every token scoped to it.
  const revoked = (await poolOrClient.query(
    `SELECT 1 FROM installation_repo_revocations WHERE installation_id = $1 AND repository = ANY($2)`,
    [row.installation_id, row.repositories],
  )).rows[0];
  if (revoked) throw new Error('token_scope_revoked');
  return row;
}

// Acting-as and attributed-to stay separate: the installation is the
// actor, the human or agent is the attribution, and the ledger keeps
// both on every entry.
export async function recordInstallationAction(poolOrClient, { token, action, target, repository }) {
  if (typeof action !== 'string' || !action.trim() || action.length > 120) {
    throw new Error('invalid action');
  }
  if (typeof target !== 'string' || !target.trim() || target.length > 512) {
    throw new Error('invalid target');
  }
  return withTx(poolOrClient, async (executor) => {
    const grant = await verifyInstallationToken(executor, token);
    if (!grant.repositories.includes(repository)) throw new Error('token_repository_out_of_scope');
    const subject = await resolvePrincipal(executor, grant.minted_for_user_id);
    if (!subject?.usable) throw new Error('token_subject_not_usable');
    const { rows } = await executor.query(
      `INSERT INTO github_action_ledger (installation_id, acted_as, attributed_user_id,
          attributed_kind, action, target)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [grant.installation_id, `installation:${grant.installation_id}`,
        grant.minted_for_user_id, subject.kind, action.trim(), target.trim()],
    );
    return rows[0];
  });
}

export async function readInstallationLedger(poolOrClient, installationId) {
  const { rows } = await poolOrClient.query(
    `SELECT acted_as AS "actedAs", attributed_user_id AS "attributedUser",
            attributed_kind AS "attributedKind", action, target, created_at AS "at"
       FROM github_action_ledger WHERE installation_id = $1 ORDER BY created_at, id`,
    [String(installationId)],
  );
  return rows;
}
