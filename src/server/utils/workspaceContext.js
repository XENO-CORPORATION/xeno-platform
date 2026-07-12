/**
 * Workspace request context + resource tenancy helpers (Phase 5).
 *
 * A request carries its active workspace in the `x-xeno-workspace` header (set by
 * the frontend WorkspaceContext). On resource CREATE we (a) stamp the resource's
 * workspace_id column where present and (b) write a ReBAC `parent` tuple
 * (`<type>:<id>#parent@workspace:<wsId>`) so authzReBAC.check inherits workspace
 * roles onto the resource (userset rewrite). Both are gated on the caller actually
 * being a member of the workspace.
 */
import { check, writeTuples } from './authzReBAC.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The validated active-workspace id from the request, or null. */
export function workspaceFromReq(req) {
  const h = req.headers?.['x-xeno-workspace'];
  return typeof h === 'string' && UUID_RE.test(h) ? h : null;
}

/** True iff the user holds any relation on the workspace. */
export async function isWorkspaceMember(db, workspaceId, userId) {
  if (!workspaceId) return false;
  const r = await check(db, { object: `workspace:${workspaceId}`, relation: 'member', subject: `user:${userId}` });
  return r.allowed;
}

/**
 * Link a freshly-created resource to a workspace: write the `parent` tuple so it
 * inherits workspace roles. Returns the workspace id if linked (so the caller can
 * also stamp its workspace_id column), else null. Never throws — tenancy tagging
 * must not break resource creation.
 */
export async function linkResourceToWorkspace(db, { workspaceId, userId, objectType, objectId }) {
  try {
    if (!workspaceId || !objectId) return null;
    if (!(await isWorkspaceMember(db, workspaceId, userId))) return null;
    await writeTuples(db, {
      writes: [{ object: `${objectType}:${objectId}`, relation: 'parent', subject: `workspace:${workspaceId}` }],
    });
    return workspaceId;
  } catch (e) {
    console.warn('[workspaceContext] link failed:', e.message);
    return null;
  }
}

/**
 * Post-insert convenience: stamp a resource row's workspace_id column AND write the
 * ReBAC parent tuple, from the request's workspace context (member-gated, best-effort).
 * `table` must be a trusted literal (never user input). Missing column is non-fatal.
 */
export async function tagResourceWorkspace(db, req, { objectType, objectId, table }) {
  const workspaceId = workspaceFromReq(req);
  const userId = req.user?.id;
  if (!workspaceId || !userId || !objectId) return null;
  if (!(await isWorkspaceMember(db, workspaceId, userId))) return null;
  if (table) {
    try { await db.query(`UPDATE ${table} SET workspace_id = $1 WHERE id = $2`, [workspaceId, objectId]); }
    catch (e) { /* column may not exist in this env — tuple below still enforces tenancy */ }
  }
  return linkResourceToWorkspace(db, { workspaceId, userId, objectType, objectId });
}

// ── Seats (Phase 4 per-seat billing enforcement) ─────────────────────────────
// Free/unsubscribed workspaces get a small default so small teams can try before
// subscribing; a Stripe per-seat subscription raises the limit (workspaces.metadata.billing.seat_limit).
const DEFAULT_FREE_SEATS = Number(process.env.WORKSPACE_FREE_SEATS || 3);

/** { limit, used, plan } — used = active members + pending invites. */
export async function workspaceSeatInfo(db, workspaceId, activeMembers) {
  const ws = (await db.query('SELECT metadata FROM workspaces WHERE id = $1', [workspaceId])).rows[0];
  const billing = ws?.metadata?.billing || {};
  const onTeamPlan = billing.plan === 'team' && ['active', 'trialing', 'past_due'].includes(billing.status);
  const limit = onTeamPlan && Number.isFinite(Number(billing.seat_limit))
    ? Number(billing.seat_limit)
    : DEFAULT_FREE_SEATS;
  const pending = Number((await db.query(
    "SELECT count(*)::int c FROM workspace_invites WHERE workspace_id = $1 AND status = 'pending'", [workspaceId],
  )).rows[0].c);
  return { limit, used: (activeMembers ?? 0) + pending, plan: onTeamPlan ? 'team' : 'free', seat_limit: limit };
}

export default { workspaceFromReq, isWorkspaceMember, linkResourceToWorkspace, workspaceSeatInfo };
