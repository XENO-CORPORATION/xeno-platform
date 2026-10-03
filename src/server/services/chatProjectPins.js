/**
 * Per-user project pins (sidebar "Pinned" block).
 *
 * A pin is a USER preference, not a project attribute (projects are shared in workspaces).
 * Authorization: pinning needs at least viewer on the project; reads re-check viewer through
 * the same ReBAC `check` the project list uses, so revoked access hides a pin without breaking
 * the list. Unpinning never needs access (a user must always be able to clear their own row).
 */
import { check } from '../utils/authzReBAC.js';
import { UUID_RE } from '../utils/workspaceContext.js';
import {
  ChatAuthorizationError,
  requireResourceRelation,
  userPrincipal,
  withTransaction,
} from './chatProjectAuthority.js';

export class ChatPinError extends Error {
  constructor(message, code = 'invalid_pin_order') {
    super(message);
    this.name = 'ChatPinError';
    this.code = code;
    this.status = 400;
  }
}

export function sendChatPinError(res, error) {
  if (!(error instanceof ChatPinError)) return false;
  res.status(error.status).json({ success: false, error: error.message, code: error.code });
  return true;
}

const lockUserPins = (client, userId) =>
  client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`chat_project_pins:${userId}`]);

async function canView(db, userId, projectId) {
  return (await check(db, { object: `project:${projectId}`, relation: 'viewer', subject: `user:${userId}` })).allowed;
}

/** Idempotent: pinning an already-pinned project keeps its position. Appends at the end. */
export async function pinProject(db, userId, projectId) {
  await requireResourceRelation(db, userPrincipal(userId), 'project', projectId, 'viewer');
  return withTransaction(db, async (client) => {
    await lockUserPins(client, userId);
    const { rows } = await client.query(
      `INSERT INTO chat_project_pins (user_id, project_id, position)
       SELECT $1::uuid, p.id, COALESCE((SELECT MAX(position) + 1 FROM chat_project_pins WHERE user_id = $1::uuid), 0)
       FROM chat_projects p WHERE p.id = $2::uuid
       ON CONFLICT (user_id, project_id) DO NOTHING
       RETURNING position`,
      [userId, projectId],
    );
    if (rows.length) return { pinned: true, pin_position: rows[0].position };
    const existing = await client.query(
      'SELECT position FROM chat_project_pins WHERE user_id = $1 AND project_id = $2',
      [userId, projectId],
    );
    if (!existing.rows.length) throw new ChatAuthorizationError();
    return { pinned: true, pin_position: existing.rows[0].position };
  });
}

/** Idempotent; deliberately no access check. */
export async function unpinProject(db, userId, projectId) {
  userPrincipal(userId);
  if (!UUID_RE.test(String(projectId || ''))) throw new ChatAuthorizationError('project id must be a UUID', 'invalid_id');
  await db.query('DELETE FROM chat_project_pins WHERE user_id = $1 AND project_id = $2', [userId, projectId]);
  return { pinned: false, pin_position: null };
}

/**
 * Replace the order. `orderedIds` must be EXACTLY the caller's currently visible pinned ids
 * (no missing, no extras, no duplicates). Pins whose project the caller can no longer see are
 * kept after the visible ones so restoring access restores the pin.
 */
export async function reorderPins(db, userId, orderedIds) {
  userPrincipal(userId);
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => !UUID_RE.test(String(id || '')))) {
    throw new ChatPinError('ids must be an array of project UUIDs');
  }
  if (new Set(orderedIds).size !== orderedIds.length) throw new ChatPinError('ids must not repeat');
  return withTransaction(db, async (client) => {
    await lockUserPins(client, userId);
    const { rows } = await client.query(
      'SELECT project_id FROM chat_project_pins WHERE user_id = $1 ORDER BY position, pinned_at',
      [userId],
    );
    const visible = [];
    const hidden = [];
    for (const row of rows) (await canView(client, userId, row.project_id) ? visible : hidden).push(row.project_id);
    const have = new Set(visible);
    if (orderedIds.length !== visible.length || orderedIds.some((id) => !have.has(id))) {
      throw new ChatPinError('ids must be exactly the pinned projects', 'pin_set_mismatch');
    }
    const finalOrder = [...orderedIds, ...hidden];
    for (let i = 0; i < finalOrder.length; i += 1) {
      await client.query(
        'UPDATE chat_project_pins SET position = $3 WHERE user_id = $1 AND project_id = $2',
        [userId, finalOrder[i], i],
      );
    }
    return { order: orderedIds };
  });
}

/** Adds `pinned` and `pin_position` (null when not pinned) to each project row. */
export async function annotateProjectPins(db, userId, projects) {
  if (!projects.length) return projects;
  const { rows } = await db.query(
    'SELECT project_id, position FROM chat_project_pins WHERE user_id = $1 AND project_id = ANY($2::uuid[])',
    [userId, projects.map((p) => p.id)],
  );
  const positions = new Map(rows.map((r) => [r.project_id, r.position]));
  return projects.map((p) => ({
    ...p,
    pinned: positions.has(p.id),
    pin_position: positions.has(p.id) ? positions.get(p.id) : null,
  }));
}
