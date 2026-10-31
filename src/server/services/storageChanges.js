/**
 * XENO Storage: "what changed since?" for the desktop drive (GET /api/library/changes). The rows are written by
 * triggers (migration 20261102120000-storage-changes.sql), so every write path is covered without remembering to.
 *
 * The cursor is the database's clock when the answer was read. A later read looks back an extra 5 seconds, so a
 * change committed a moment after its timestamp is not missed; the drive relisting a folder twice costs nothing.
 * A cursor older than the 7 days kept, or one that cannot be read, gets `rescan`: relist everything.
 */
const KEEP_DAYS = 7;
const OVERLAP_SECONDS = 5;
const MAX_FOLDERS = 500;

export async function storageChanges(db, userId, since) {
  const now = (await db.query('SELECT clock_timestamp() AS now')).rows[0].now;
  const cursor = new Date(now).toISOString();
  if (since === null || since === undefined || since === '') return { cursor, folders: [], rescan: false };
  const at = new Date(String(since));
  if (Number.isNaN(at.getTime()) || at.getTime() > new Date(now).getTime() + 60_000 || at.getTime() < new Date(now).getTime() - KEEP_DAYS * 86_400_000) {
    return { cursor, folders: [], rescan: true };
  }
  const { rows } = await db.query(
    `SELECT DISTINCT COALESCE(folder_id::text, 'root') AS folder FROM storage_changes
      WHERE owner_user_id = $1 AND at > $2::timestamptz - make_interval(secs => $3) AND at <= $4::timestamptz LIMIT $5`,
    [userId, at.toISOString(), OVERLAP_SECONDS, cursor, MAX_FOLDERS + 1]);
  // Old rows go a few at a time on reads, so the log never grows without a separate job.
  await db.query(`DELETE FROM storage_changes WHERE id IN (SELECT id FROM storage_changes WHERE at < now() - make_interval(days => $1) LIMIT 1000)`, [KEEP_DAYS]);
  if (rows.length > MAX_FOLDERS) return { cursor, folders: [], rescan: true };
  return { cursor, folders: rows.map(r => r.folder), rescan: false };
}
