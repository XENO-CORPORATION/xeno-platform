/**
 * XENO Storage (codename Arca), step 1: the METER and the ALLOWANCE.
 * Spec: `XENO STORAGE - SPEC.md` in the workspace root (§4 meter, §5 allowance).
 *
 * One account, one meter. Everything a person's account holds counts: uploads, chat attachments, generated
 * media and files in the trash (until they are purged), the way Google One and Dropbox count. A file that
 * belongs to a workspace counts toward that WORKSPACE's pool and is reported apart; it is not enforced yet.
 *
 * Over the allowance: new files are refused (507 storage_full). Nothing is ever deleted, and reading,
 * downloading, renaming, trashing and deleting always work, so a person can always get back under.
 *
 * The allowance comes from the plan (accountPlan.js `storageBytes`). The meter reads the rows themselves on
 * every call; there is no counter to drift.
 */
import { getEffectiveEntitlements } from './effectivePlan.js';

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
const PERSONAL = `f.workspace_id IS NULL AND COALESCE(f.owner_user_id, f.user_id) = $1`;

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
         FROM user_files f WHERE f.workspace_id IS NOT NULL AND f.created_by_user_id = $1 AND ${HELD} GROUP BY 1`, [userId]),
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
  if (workspaceId) return; // workspace pools are metered, not enforced yet (spec §5.4)
  const allowanceBytes = await storageAllowance(tx, userId);
  if (allowanceBytes === null) return;
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`storage:${userId}`]);
  const used = (await personalBytes(tx, userId)).bytes;
  if (used + Number(bytes) > allowanceBytes) throw new StorageFullError(used, allowanceBytes, Number(bytes));
}
