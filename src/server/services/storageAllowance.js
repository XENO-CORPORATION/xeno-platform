/**
 * XENO Storage (codename Arca), step 1: the METER and the ALLOWANCE.
 * Spec: `XENO STORAGE - SPEC.md` in the workspace root (§4 meter, §5 allowance).
 *
 * One account, one meter. Everything a person's account holds counts: uploads, chat attachments, generated
 * media and files in the trash (until they are purged), the way Google One and Dropbox count. A file that
 * belongs to a workspace counts toward that WORKSPACE's pool, is reported apart, and is enforced against the
 * workspace's plan (D-1, 2026-10-20: the workspace is the unit of ownership and billing). A file in a person's
 * PERSONAL workspace is the same pool as their workspace-less files (ownerScope.js).
 *
 * Over the allowance: new files are refused (507 storage_full). Nothing is ever deleted, and reading,
 * downloading, renaming, trashing and deleting always work, so a person can always get back under.
 *
 * The allowance comes from the plan (accountPlan.js `storageBytes`). The meter reads the rows themselves on
 * every call; there is no counter to drift.
 */
import { getEffectiveEntitlements, getWorkspacePlan } from './effectivePlan.js';
import { entitlementsFor } from './accountPlan.js';
import { ownerScopeOf } from './ownerScope.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class StorageFullError extends Error {
  constructor(usedBytes, allowanceBytes, neededBytes) {
    super('Your storage is full. Free some space or upgrade your plan to add more files.');
    this.code = 'storage_full'; this.status = 507;
    this.usedBytes = usedBytes; this.allowanceBytes = allowanceBytes; this.neededBytes = neededBytes;
  }
}

// A file is held until it is purged: live, or soft-deleted but still restorable from the trash.
const HELD = `(f.deleted_at IS NULL OR EXISTS (SELECT 1 FROM library_trash lt WHERE lt.source = 'file' AND lt.source_id = f.id))`;
// D-1: a workspace-less file and a file in the owner's personal workspace are ONE pool (ownerScope.js).
const PERSONAL = `((f.workspace_id IS NULL AND COALESCE(f.owner_user_id, f.user_id) = $1)
  OR f.workspace_id IN (SELECT pw.id FROM workspaces pw WHERE pw.workspace_type = 'personal' AND pw.owner_user_id = $1))`;
const ACTIVE = new Set(['active', 'trialing', 'past_due']);

async function personalBytes(db, userId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(f.file_size), 0)::bigint AS bytes, COUNT(*)::int AS files,
            COALESCE(SUM(f.file_size) FILTER (WHERE f.deleted_at IS NOT NULL), 0)::bigint AS trash_bytes
       FROM user_files f WHERE ${PERSONAL} AND ${HELD}`, [userId]);
  return { bytes: Number(rows[0].bytes), files: rows[0].files, trashBytes: Number(rows[0].trash_bytes) };
}

/** The storage a plan includes, in bytes. `null` = no limit (internal accounts). */
export async function storageAllowance(db, userId) {
  const { entitlements } = await getEffectiveEntitlements(db, userId);
  if (entitlements?.storageBytes === null) return null;
  // extra space on top of the plan: a purchase, or a grant by staff (storage_grants)
  const extra = (await db.query('SELECT COALESCE(SUM(bytes), 0)::bigint AS bytes FROM storage_grants WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())', [userId])).rows[0];
  return (Number(entitlements?.storageBytes) || 0) + Number(extra.bytes);
}

/** What the account holds and what it may hold. */
export async function storageUsage(db, userId) {
  if (!UUID.test(String(userId))) throw new Error('storage owner must be a UUID');
  const [mine, allowanceBytes, kinds, shared] = await Promise.all([
    personalBytes(db, userId),
    storageAllowance(db, userId),
    db.query(
      `SELECT CASE WHEN f.mime_type LIKE 'image/%' THEN 'image' WHEN f.mime_type LIKE 'video/%' THEN 'video'
                   WHEN f.mime_type LIKE 'audio/%' THEN 'audio' WHEN f.mime_type LIKE 'model/%' THEN '3d' ELSE 'document' END AS kind,
              COALESCE(SUM(f.file_size), 0)::bigint AS bytes, COUNT(*)::int AS files
         FROM user_files f WHERE ${PERSONAL} AND ${HELD} GROUP BY 1 ORDER BY 2 DESC`, [userId]),
    db.query(
      `SELECT f.workspace_id AS id, COALESCE(SUM(f.file_size), 0)::bigint AS bytes, COUNT(*)::int AS files
         FROM user_files f WHERE f.workspace_id IS NOT NULL AND f.created_by_user_id = $1 AND ${HELD}
            AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = f.workspace_id AND w.workspace_type = 'personal') GROUP BY 1`, [userId]),
  ]);
  return {
    usedBytes: mine.bytes, files: mine.files, trashBytes: mine.trashBytes,
    allowanceBytes, remainingBytes: allowanceBytes === null ? null : Math.max(0, allowanceBytes - mine.bytes),
    full: allowanceBytes !== null && mine.bytes >= allowanceBytes,
    byKind: kinds.rows.map(r => ({ kind: r.kind, bytes: Number(r.bytes), files: r.files })),
    // files this person put in workspaces: they count toward those workspaces, shown for information
    workspaces: shared.rows.map(r => ({ id: r.id, bytes: Number(r.bytes), files: r.files })),
  };
}

/**
 * Refuse a new personal file that would not fit. Call INSIDE the transaction that inserts the row: it takes
 * a per-account lock, so two uploads racing for the last free megabyte cannot both be admitted.
 */
export async function assertStorageRoom(tx, { userId, workspaceId = null, bytes }) {
  if (workspaceId) {
    const scope = await ownerScopeOf(tx, { workspaceId });
    if (!scope.personal) return assertWorkspaceRoom(tx, scope.workspaceId, bytes);
    userId = scope.accountableUserId; // a personal workspace IS the person's pool
  }
  const allowanceBytes = await storageAllowance(tx, userId);
  if (allowanceBytes === null) return;
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`storage:${userId}`]);
  const used = (await personalBytes(tx, userId)).bytes;
  if (used + Number(bytes) > allowanceBytes) throw new StorageFullError(used, allowanceBytes, Number(bytes));
}

/**
 * A shared workspace's pool (spec §5.4, enforced since 2026-10-20). The plan attaches to the WORKSPACE: an active
 * workspace subscription's plan, otherwise the owner's own plan (Studio includes a shared workspace). The plan
 * Team is PER SEAT, pooled (decided 2026-10-20, XENO PRICING ledger §6): the team plan's `storageBytes` times the
 * workspace's paid seats (`metadata.billing.seat_limit`, the one seat store, written by setWorkspacePlan). Unknown
 * seats count as one. Agents are never seats. Other plans are a flat pool. `null` = no limit (internal).
 * Fails CLOSED: an unreadable plan is Free.
 */
export async function workspaceStorageAllowance(db, workspaceId) {
  const w = (await db.query('SELECT owner_user_id, metadata FROM workspaces WHERE id = $1', [workspaceId])).rows[0];
  if (!w) return 0;
  const billing = w.metadata?.billing || {};
  const { plan } = await getWorkspacePlan(db, workspaceId); // D-1: the workspace's own plan (effectivePlan.js)
  const bytes = entitlementsFor(plan).storageBytes;
  if (bytes === null) return null;
  const perPlan = Number(bytes) || 0;
  if (plan !== 'team') return perPlan;
  const seats = Number(billing.seat_limit);
  return perPlan * (Number.isInteger(seats) && seats >= 1 ? seats : 1);
}

export async function workspaceUsedBytes(db, workspaceId) {
  return Number((await db.query(`SELECT COALESCE(SUM(f.file_size), 0)::bigint AS bytes FROM user_files f WHERE f.workspace_id = $1 AND ${HELD}`, [workspaceId])).rows[0].bytes);
}

async function assertWorkspaceRoom(tx, workspaceId, bytes) {
  const allowanceBytes = await workspaceStorageAllowance(tx, workspaceId);
  if (allowanceBytes === null) return;
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`storage:workspace:${workspaceId}`]);
  const used = await workspaceUsedBytes(tx, workspaceId);
  if (used + Number(bytes) > allowanceBytes) throw new StorageFullError(used, allowanceBytes, Number(bytes));
}
