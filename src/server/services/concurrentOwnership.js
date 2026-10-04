// RUN-08: concurrent code work uses explicit file/task ownership or isolated
// worktrees, plus reviewed integration. Path locks are exclusive per
// project: a shared task assignment does NOT share the lock -- two agents on
// one task still refuse each other's overlapping paths, because shared
// assignment never made concurrent writes to one directory safe. Task claims
// are exclusive per task. The alternative to locking is an isolated
// worktree (own branch and root prefix), and a worktree integrates only
// under review by a project holder other than its author. checkWriteAllowed
// is the enforcement point: a write needs the actor's lock on the path or
// the actor's active worktree above it -- nothing else.
import { check } from '../utils/authzReBAC.js';

const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, what = 'id') => {
  if (typeof value !== 'string' || !UUID.test(value)) bad('bad_input', `invalid_${what}`);
  return value;
};

export const MAX_LOCK_TTL_SECONDS = 86400;

async function withTx(poolOrClient, fn) {
  if (typeof poolOrClient.connect === 'function' && typeof poolOrClient.totalCount === 'number') {
    const client = await poolOrClient.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return fn(poolOrClient);
}

async function holdsProject(client, userId, projectId) {
  for (const relation of ['owner', 'editor']) {
    if ((await check(client, { object: `project:${projectId}`, relation, subject: `user:${userId}` })).allowed) return true;
  }
  return false;
}

async function heldProject(client, actor, projectId) {
  const project = (await client.query('SELECT id FROM chat_projects WHERE id=$1 AND is_archived=FALSE', [projectId])).rows[0];
  if (!project) bad('not_found', 'project_not_found');
  if (!(await holdsProject(client, actor, projectId))) bad('denied', 'project_not_held');
  return project.id;
}

const cleanPath = (p) => {
  if (typeof p !== 'string' || !p.trim() || p.startsWith('/') || p.includes('..')) bad('bad_input', 'invalid_path');
  return p.trim().replace(/\/+$/, '');
};

const overlaps = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

const ttlExpires = (ttlSeconds) => {
  const ttl = ttlSeconds == null ? 3600 : ttlSeconds;
  if (!Number.isInteger(ttl) || ttl <= 0) bad('bad_input', 'invalid_ttl');
  if (ttl > MAX_LOCK_TTL_SECONDS) bad('bad_input', 'lock_ttl_exceeded');
  return new Date(Date.now() + ttl * 1000);
};

/** Acquire exclusive path locks. Overlapping live locks held by others refuse, task sharing or not. */
export async function acquireFileOwnership(poolOrClient, { actorUserId, projectId, paths, taskRef, ttlSeconds }) {
  const actor = uuid(actorUserId, 'actor');
  const pid = uuid(projectId, 'project');
  if (!Array.isArray(paths) || paths.length === 0) bad('bad_input', 'paths_required');
  const clean = [...new Set(paths.map(cleanPath))];
  const task = taskRef == null ? null : String(taskRef);
  return withTx(poolOrClient, async (client) => {
    await heldProject(client, actor, pid);
    const expires = ttlExpires(ttlSeconds);
    await client.query('DELETE FROM concurrent_path_locks WHERE project_id=$1 AND expires_at <= now()', [pid]);
    const live = (await client.query(
      'SELECT path, holder_user_id FROM concurrent_path_locks WHERE project_id=$1', [pid])).rows;
    const conflicts = [];
    for (const p of clean) {
      for (const lock of live) {
        if (lock.holder_user_id !== actor && overlaps(p, lock.path)) {
          conflicts.push({ path: p, lockedBy: lock.holder_user_id, lockedPath: lock.path });
        }
      }
    }
    if (conflicts.length > 0) {
      throw Object.assign(new Error('paths_locked'), { code: 'conflict', details: { conflicts } });
    }
    for (const p of clean) {
      await client.query(
        `INSERT INTO concurrent_path_locks(project_id,path,holder_user_id,task_ref,expires_at)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT (project_id,path) DO UPDATE SET holder_user_id=$3, task_ref=$4, expires_at=$5`,
        [pid, p, actor, task, expires.toISOString()],
      );
    }
    return { projectId: pid, holderUserId: actor, paths: clean, expiresAt: expires.toISOString() };
  });
}

export async function releaseFileOwnership(poolOrClient, { actorUserId, projectId, paths }) {
  const actor = uuid(actorUserId, 'actor');
  const pid = uuid(projectId, 'project');
  if (!Array.isArray(paths) || paths.length === 0) bad('bad_input', 'paths_required');
  const clean = [...new Set(paths.map(cleanPath))];
  return withTx(poolOrClient, async (client) => {
    await heldProject(client, actor, pid);
    for (const p of clean) {
      const lock = (await client.query(
        'SELECT holder_user_id FROM concurrent_path_locks WHERE project_id=$1 AND path=$2', [pid, p])).rows[0];
      if (!lock) continue;
      if (lock.holder_user_id !== actor) bad('denied', 'release_not_authorized');
      await client.query('DELETE FROM concurrent_path_locks WHERE project_id=$1 AND path=$2', [pid, p]);
    }
    return { projectId: pid, released: clean };
  });
}

/** Claim a task exclusively. One holder; the claim is the coordination, not a lock share. */
export async function acquireTaskOwnership(poolOrClient, { actorUserId, projectId, taskRef, ttlSeconds }) {
  const actor = uuid(actorUserId, 'actor');
  const pid = uuid(projectId, 'project');
  if (typeof taskRef !== 'string' || !taskRef.trim()) bad('bad_input', 'task_ref_required');
  return withTx(poolOrClient, async (client) => {
    await heldProject(client, actor, pid);
    const expires = ttlExpires(ttlSeconds);
    await client.query('DELETE FROM concurrent_task_claims WHERE project_id=$1 AND task_ref=$2 AND expires_at <= now()', [pid, taskRef]);
    const live = (await client.query(
      'SELECT holder_user_id FROM concurrent_task_claims WHERE project_id=$1 AND task_ref=$2', [pid, taskRef])).rows[0];
    if (live && live.holder_user_id !== actor) bad('conflict', 'task_claimed');
    await client.query(
      `INSERT INTO concurrent_task_claims(project_id,task_ref,holder_user_id,expires_at) VALUES($1,$2,$3,$4)
       ON CONFLICT (project_id,task_ref) DO UPDATE SET holder_user_id=$3, expires_at=$4`,
      [pid, taskRef, actor, expires.toISOString()],
    );
    return { projectId: pid, taskRef, holderUserId: actor, expiresAt: expires.toISOString() };
  });
}

/** Open an isolated worktree: own branch, own root prefix, active until integrated or abandoned. */
export async function createIsolatedWorktree(poolOrClient, { actorUserId, projectId, taskRef, branch, rootPrefix }) {
  const actor = uuid(actorUserId, 'actor');
  const pid = uuid(projectId, 'project');
  if (typeof taskRef !== 'string' || !taskRef.trim()) bad('bad_input', 'task_ref_required');
  if (typeof branch !== 'string' || !branch.trim() || branch.includes(' ')) bad('bad_input', 'invalid_branch');
  if (typeof rootPrefix !== 'string' || !rootPrefix.trim() || rootPrefix.startsWith('/')) bad('bad_input', 'invalid_prefix');
  const prefix = rootPrefix.trim().replace(/\/+$/, '') + '/';
  return withTx(poolOrClient, async (client) => {
    await heldProject(client, actor, pid);
    try {
      const row = (await client.query(
        `INSERT INTO isolated_worktrees(project_id,task_ref,author_user_id,branch,root_prefix)
         VALUES($1,$2,$3,$4,$5) RETURNING id, status`,
        [pid, taskRef.trim(), actor, branch.trim(), prefix],
      )).rows[0];
      return { worktreeId: row.id, status: row.status, branch: branch.trim(), rootPrefix: prefix };
    } catch (error) {
      if (error && error.code === '23505') bad('conflict', 'branch_in_use');
      throw error;
    }
  });
}

/** Reviewed integration: a holder other than the author merges the worktree back. */
export async function integrateWorktree(poolOrClient, { actorUserId, worktreeId }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(worktreeId, 'worktree');
  return withTx(poolOrClient, async (client) => {
    const tree = (await client.query('SELECT * FROM isolated_worktrees WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!tree) bad('not_found', 'worktree_not_found');
    if (tree.status !== 'active') bad('conflict', 'worktree_not_active');
    if (!(await holdsProject(client, actor, tree.project_id))) bad('denied', 'integrate_not_authorized');
    if (tree.author_user_id === actor) bad('denied', 'self_integrate_refused');
    await client.query(
      `UPDATE isolated_worktrees SET status='integrated', integrated_by_user_id=$2, integrated_at=now() WHERE id=$1`,
      [id, actor],
    );
    return { worktreeId: id, status: 'integrated', integratedByUserId: actor };
  });
}

/**
 * The enforcement point. A write is allowed iff the actor holds a live lock
 * covering the path or owns an active worktree above it. Expired locks read
 * as absent (lazy expiry); anything else is refused by name.
 */
export async function checkWriteAllowed(poolOrClient, { actorUserId, projectId, path }) {
  const actor = uuid(actorUserId, 'actor');
  const pid = uuid(projectId, 'project');
  const clean = cleanPath(path);
  return withTx(poolOrClient, async (client) => {
    await heldProject(client, actor, pid);
    const lock = (await client.query(
      `SELECT path FROM concurrent_path_locks
       WHERE project_id=$1 AND holder_user_id=$2 AND expires_at > now()`, [pid, actor])).rows
      .some((r) => clean === r.path || clean.startsWith(`${r.path}/`));
    if (lock) return { allowed: true, basis: 'file-ownership' };
    const tree = (await client.query(
      `SELECT root_prefix FROM isolated_worktrees
       WHERE project_id=$1 AND author_user_id=$2 AND status='active'`, [pid, actor])).rows
      .some((r) => clean.startsWith(r.root_prefix));
    if (tree) return { allowed: true, basis: 'isolated-worktree' };
    return { allowed: false, reason: 'no_ownership' };
  });
}
