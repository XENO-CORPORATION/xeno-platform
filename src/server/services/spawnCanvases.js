/**
 * Spawn cloud canvases: the shared thing behind XENO Multiplayer's `spawn.canvas/<canvasId>` (owner-approved multiplayer
 * work, 2026-10-28; proposal from the Spawn session). The CANVAS is the shared thing, not its machine: `id` is Spawn's own
 * project UUID (in every Spawn URL), and `machine_id` may be replaced without the canvas, its links or its document
 * changing.
 *
 * Roles come from the platform's ReBAC, never from Spawn:
 *   - the canvas is a child of its workspace (`spawn_canvas:<id>#parent@workspace:<w>`), so workspace roles apply:
 *     admin/owner → owner, editor → editor, viewer → viewer;
 *   - a person may be invited to ONE canvas (`spawn_canvas:<id>#editor|viewer@user:<u>`) without the workspace;
 *   - an agent is never above editor, and never above the person it acts for.
 * Removing an invite revokes the person's live connections (services/liveTickets.js revoke).
 */
import { check, writeTuples } from '../utils/authzReBAC.js';
import * as compute from './compute.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MACHINE_ID = /^mch_[0-9a-f]{32}$/;
export const INVITE_ROLES = ['editor', 'viewer'];

export class CanvasError extends Error {
  constructor(message, code, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}

/** The person (and agent) behind the caller. */
async function personOf(db, actor) {
  if (!actor || !actor.id) throw new CanvasError('Sign in first', 'not_signed_in', 401);
  if (actor.kind === 'service') throw new CanvasError('A service account cannot hold a canvas', 'not_allowed', 403);
  if (actor.kind !== 'agent') return { userId: String(actor.id), agentId: null };
  const r = (await db.query('SELECT owner_user_id FROM agent_identities WHERE user_id = $1', [actor.id])).rows[0];
  if (!r || !r.owner_user_id) throw new CanvasError('This agent has no owner', 'no_owner', 403);
  return { userId: String(r.owner_user_id), agentId: String(actor.id) };
}

const shape = (row, role) => ({ id: row.id, name: row.name, workspaceId: String(row.workspace_id), machineId: row.machine_id || null,
  createdAt: row.created_at, role, url: `/workspace/${row.workspace_id}/spawn/projects/${row.id}` });

async function rowOf(db, id) {
  if (!UUID.test(String(id || ''))) throw new CanvasError('A canvas id is a UUID', 'invalid_canvas');
  const row = (await db.query('SELECT * FROM spawn_canvases WHERE id = $1 AND deleted_at IS NULL', [String(id).toLowerCase()])).rows[0];
  if (!row) throw new CanvasError('Canvas not found', 'canvas_not_found', 404);
  return row;
}

/** The caller's role on a canvas, or a refusal. */
export async function canvasRole(db, actor, id) {
  const row = await rowOf(db, id);
  const who = await personOf(db, actor);
  const has = async (relation) => (await check(db, { object: `spawn_canvas:${row.id}`, relation, subject: `user:${who.userId}` })).allowed;
  let role = await has('admin') ? 'owner' : await has('editor') ? 'editor' : await has('viewer') ? 'viewer' : null;
  if (!role) throw new CanvasError('You have no access to that canvas', 'not_a_member', 403);
  if (who.agentId && role === 'owner') role = 'editor';
  return { row, role, ...who };
}

/** Create a canvas (idempotent on its id) — pressing Cloud in Spawn. A workspace editor, the machine in that workspace. */
export async function createCanvas(db, actor, { id, name, machineId, workspace } = {}) {
  if (!UUID.test(String(id || ''))) throw new CanvasError('A canvas id is a UUID', 'invalid_canvas');
  const cid = String(id).toLowerCase();
  const label = String(name ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Canvas';
  if (machineId != null && !MACHINE_ID.test(String(machineId))) throw new CanvasError('machineId must be a machine id', 'invalid_machine');
  let ctx;
  if (machineId) {
    const r = await compute.machineRole(db, actor, machineId, { workspace });
    if (r.role === 'viewer') throw new CanvasError('Only editors and admins can do that', 'editor_required', 403);
    ctx = r.ctx;
  } else ctx = await compute.workspaceFor(db, actor, workspace, 'editor');
  const existing = (await db.query('SELECT * FROM spawn_canvases WHERE id = $1', [cid])).rows[0];
  if (existing) {
    if (String(existing.workspace_id) !== String(ctx.workspaceId) || existing.deleted_at) throw new CanvasError('That canvas id belongs to another workspace', 'canvas_conflict', 409);
    if (machineId && existing.machine_id !== machineId) {
      await db.query('UPDATE spawn_canvases SET machine_id = $2 WHERE id = $1', [cid, machineId]);
      existing.machine_id = machineId;
    }
    return shape(existing, (await canvasRole(db, actor, cid)).role);
  }
  const row = (await db.query(`INSERT INTO spawn_canvases (id, workspace_id, machine_id, name, created_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO NOTHING RETURNING *`, [cid, ctx.workspaceId, machineId || null, label, ctx.userId])).rows[0]
    || (await db.query('SELECT * FROM spawn_canvases WHERE id = $1', [cid])).rows[0];
  if (String(row.workspace_id) !== String(ctx.workspaceId)) throw new CanvasError('That canvas id belongs to another workspace', 'canvas_conflict', 409);
  await writeTuples(db, { writes: [{ object: `spawn_canvas:${cid}`, relation: 'parent', subject: `workspace:${ctx.workspaceId}` }] });
  return shape(row, (await canvasRole(db, actor, cid)).role);
}

export async function getCanvas(db, actor, id) {
  const { row, role } = await canvasRole(db, actor, id);
  return shape(row, role);
}

/** People invited to this canvas alone (workspace members are not listed: they come with the workspace). */
export async function listInvites(db, actor, id) {
  const { row, role } = await canvasRole(db, actor, id);
  if (role !== 'owner') throw new CanvasError('Only the canvas owner manages invites', 'owner_required', 403);
  const r = await db.query(`SELECT t.relation, t.subject_id, u.display_name, u.username FROM relationship_tuples t LEFT JOIN users u ON u.id::text = t.subject_id
     WHERE t.object_type = 'spawn_canvas' AND t.object_id = $1 AND t.subject_type = 'user' AND t.relation = ANY($2) ORDER BY t.relation, u.username`, [row.id, INVITE_ROLES]);
  return r.rows.map((x) => ({ userId: x.subject_id, role: x.relation, name: x.display_name || x.username || null }));
}

/** Invite one person to this canvas as editor or viewer (a person, never an agent). */
export async function invite(db, actor, id, { userId, role }) {
  const c = await canvasRole(db, actor, id);
  if (c.role !== 'owner' || c.agentId) throw new CanvasError('Only the canvas owner, in person, invites', 'owner_required', 403);
  if (!INVITE_ROLES.includes(role)) throw new CanvasError('role must be editor or viewer', 'invalid_role');
  if (!UUID.test(String(userId || ''))) throw new CanvasError('userId must be an account id', 'invalid_user');
  const u = (await db.query(`SELECT u.id FROM users u WHERE u.id = $1 AND u.is_active AND NOT EXISTS (SELECT 1 FROM agent_identities a WHERE a.user_id = u.id)`, [userId])).rows[0];
  if (!u) throw new CanvasError('No such person', 'user_not_found', 404);
  await writeTuples(db, { deletes: INVITE_ROLES.filter((r) => r !== role).map((r) => ({ object: `spawn_canvas:${c.row.id}`, relation: r, subject: `user:${userId}` })),
    writes: [{ object: `spawn_canvas:${c.row.id}`, relation: role, subject: `user:${userId}` }] });
  return { userId: String(userId), role };
}

/** Remove an invite, and close that person's live connections to the canvas (and their agents'). */
export async function uninvite(db, actor, id, userId, { revoke } = {}) {
  const c = await canvasRole(db, actor, id);
  if (c.role !== 'owner' || c.agentId) throw new CanvasError('Only the canvas owner, in person, removes an invite', 'owner_required', 403);
  if (!UUID.test(String(userId || ''))) throw new CanvasError('userId must be an account id', 'invalid_user');
  const r = await writeTuples(db, { deletes: INVITE_ROLES.map((role) => ({ object: `spawn_canvas:${c.row.id}`, relation: role, subject: `user:${userId}` })) });
  // Only when no access is left: a workspace member keeps the canvas through the workspace.
  const still = (await check(db, { object: `spawn_canvas:${c.row.id}`, relation: 'viewer', subject: `user:${userId}` })).allowed;
  const live = revoke && !still ? await revoke(db, `spawn.canvas/${c.row.id}`, String(userId)) : null;
  return { removed: r.removed, live };
}

/** The canvases bound to a machine (for the service tickets its Spawn server gets; services/computePorts.js). */
export async function canvasesOnMachine(db, machineId, limit = 20) {
  return (await db.query('SELECT id FROM spawn_canvases WHERE machine_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT $2', [machineId, limit])).rows.map((r) => r.id);
}
