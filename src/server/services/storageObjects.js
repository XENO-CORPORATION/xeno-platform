/**
 * XENO Storage (codename Arca), step 2: every file has a copy in OBJECT STORAGE.
 * Spec: `XENO STORAGE - SPEC.md` §6 in the workspace root.
 *
 * The standard migration, in its safe order: write both -> backfill -> verify -> (later) read from the object
 * store -> (later) retire the disk copy. This module is the first three. The disk stays the place files are
 * read from; the object store is the second copy, and the place a file is restored from if the disk loses it.
 *
 * Objects are content-addressed (`files/<aa>/<sha256>`), written once and never overwritten, so the same
 * bytes uploaded twice are one object and a copy can always be checked against its name.
 *
 * STEPS 4 AND 5 (2026-10-13): the object store is the HOME of a file's bytes and the server's disk is a CACHE.
 *   - `localLibraryPath` is how any code gets a path it can read: the cached copy, or the bytes fetched from
 *     the object store (hash checked) and cached. Every reader of a stored file uses it.
 *   - `evictLocalCopies` removes cached copies that have a verified object and have not been touched lately.
 *     It re-checks the object at the moment of removal, so a file is never removed on trust.
 *   - `sweepOrphanObjects` removes the objects of files that were deleted for good, once nothing else holds
 *     the same bytes.
 *
 * `storage_objects` records, per file row, the object that holds its bytes. A row there means: the object was
 * written AND read back at the right size. Nothing here deletes a file, a row or an object.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileStorage } from './artifactStorage.js';

export const fileObjectKey = (sha256) => `files/${sha256.slice(0, 2)}/${sha256}`;
const SHA = /^[0-9a-f]{64}$/;

const managedRoots = () => [path.resolve(process.cwd(), 'src/server/uploads'), path.resolve(process.cwd(), 'uploads')];
const underManagedRoot = (file) => { const resolved = path.resolve(file || ''); return managedRoots().some((root) => resolved.startsWith(root + path.sep)) ? resolved : null; };

/**
 * Copy one file's bytes to the object store and record it. Safe to call again: an object that is already
 * there is not rewritten. Returns { key, sizeBytes } or throws; it never changes the file or its row.
 */
export async function storeFileObject(db, file, { store = fileStorage() } = {}) {
  const disk = underManagedRoot(file.storage_path);
  if (!disk) throw Object.assign(new Error('file is not under a managed upload root'), { code: 'unmanaged_path' });
  const bytes = await fs.promises.readFile(disk);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (file.content_sha256 && file.content_sha256 !== sha256) throw Object.assign(new Error('bytes on disk no longer match the recorded hash'), { code: 'hash_mismatch' });
  const key = fileObjectKey(sha256);
  if (!(await store.head(key))) await store.put(key, bytes);
  const stored = await store.head(key);   // read back: a copy that cannot be found is not a copy
  if (!stored || stored.sizeBytes !== bytes.length) throw Object.assign(new Error('object store did not return the object at its size'), { code: 'verify_failed' });
  await db.query(
    `INSERT INTO storage_objects (file_id, sha256, object_key, size_bytes, backend) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (file_id) DO UPDATE SET sha256 = EXCLUDED.sha256, object_key = EXCLUDED.object_key, size_bytes = EXCLUDED.size_bytes, backend = EXCLUDED.backend, verified_at = now()`,
    [file.id, sha256, key, bytes.length, store.kind]);
  return { key, sizeBytes: bytes.length };
}

/** Copy every file that has no recorded object yet. Returns counts; one bad file never stops the rest. */
export async function syncFileObjects(db, { limit = 200, store = fileStorage(), log = console } = {}) {
  const { rows } = await db.query(
    `SELECT f.id, f.storage_path, f.content_sha256 FROM user_files f
      WHERE f.storage_type = 'platform-upload' AND f.storage_path IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM storage_objects o WHERE o.file_id = f.id)
        AND (f.deleted_at IS NULL OR EXISTS (SELECT 1 FROM library_trash lt WHERE lt.source = 'file' AND lt.source_id = f.id))
      ORDER BY f.created_at ASC LIMIT $1`, [limit]);
  const result = { stored: 0, failed: 0, bytes: 0, errors: {} };
  for (const file of rows) {
    try { const done = await storeFileObject(db, file, { store }); result.stored += 1; result.bytes += done.sizeBytes; }
    catch (error) { result.failed += 1; const code = error.code || 'error'; result.errors[code] = (result.errors[code] || 0) + 1; if (code === 'error') log.warn?.('[storage] copy failed:', file.id, error.message); }
  }
  return result;
}

/**
 * Put a file's bytes back on disk from its object when the disk copy is gone. The bytes are checked against
 * the recorded hash before they are written. Returns the path, or null when there is no object to restore from.
 */
export async function restoreFileFromObject(db, file, { store = fileStorage() } = {}) {
  const disk = underManagedRoot(file.storage_path);
  if (!disk) return null;
  const { rows } = await db.query('SELECT sha256, object_key FROM storage_objects WHERE file_id = $1', [file.id]);
  if (!rows[0] || !SHA.test(rows[0].sha256)) return null;
  const bytes = await store.get(rows[0].object_key);
  if (!bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== rows[0].sha256) return null;
  await fs.promises.mkdir(path.dirname(disk), { recursive: true });
  const tmp = `${disk}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.restore`;
  await fs.promises.writeFile(tmp, bytes);
  await fs.promises.rename(tmp, disk);
  return disk;
}

/**
 * A path on this machine holding the file's bytes: the cached copy, or the bytes brought back from the object
 * store. `file` needs `id` and `storage_path`. Returns null when the bytes are in neither place.
 */
export async function localLibraryPath(db, file, { store = fileStorage() } = {}) {
  const disk = underManagedRoot(file?.storage_path);
  if (!disk) return null;
  try { if ((await fs.promises.stat(disk)).isFile()) return disk; } catch { /* not cached: fetch it */ }
  return restoreFileFromObject(db, file, { store }).catch(() => null);
}

/**
 * Remove cached copies that are safely in the object store. A copy is removed only when ALL hold: its file has
 * a recorded, verified object; the security scan has finished and passed (a file still being checked, or
 * refused, stays where the scanner reads it); the copy was not read or written in the last `idleHours`; and
 * the object is still there at its size when asked right now.
 */
export async function evictLocalCopies(db, { idleHours = 24, limit = 500, store = fileStorage(), now = Date.now(), log = console } = {}) {
  const { rows } = await db.query(
    `SELECT f.id, f.storage_path, o.object_key, o.size_bytes FROM user_files f JOIN storage_objects o ON o.file_id = f.id
      WHERE f.storage_type = 'platform-upload' AND f.storage_path IS NOT NULL
        AND (SELECT i.state FROM library_asset_ingestions i WHERE i.asset_id = f.id ORDER BY i.created_at DESC LIMIT 1) IN ('ready', 'unsupported')
      ORDER BY o.stored_at ASC LIMIT $1`, [limit * 20]);
  const result = { evicted: 0, bytes: 0, kept: 0, failed: 0 };
  const idleMs = idleHours * 3600000;
  for (const file of rows) {
    if (result.evicted >= limit) break;
    const disk = underManagedRoot(file.storage_path); if (!disk) continue;
    let stat; try { stat = await fs.promises.stat(disk); } catch { continue; }   // not cached
    if (now - Math.max(stat.mtimeMs, stat.atimeMs) < idleMs) { result.kept += 1; continue; }
    try {
      const head = await store.head(file.object_key);
      if (!head || head.sizeBytes !== Number(file.size_bytes) || stat.size !== Number(file.size_bytes)) { result.failed += 1; continue; }   // never remove on trust
      // the copy being removed must be the bytes the object was made from (objects are named by their hash)
      const local = crypto.createHash('sha256').update(await fs.promises.readFile(disk)).digest('hex');
      if (file.object_key !== fileObjectKey(local)) { result.failed += 1; continue; }
      await fs.promises.unlink(disk); result.evicted += 1; result.bytes += stat.size;
    } catch (error) { result.failed += 1; log.warn?.('[storage] eviction skipped:', file.id, error.message); }
  }
  return result;
}

/**
 * Objects of files that were deleted for good. The record is removed, and the object too once no other file
 * holds the same bytes (objects are content-addressed, so two files can share one).
 */
export async function sweepOrphanObjects(db, { limit = 500, store = fileStorage(), log = console } = {}) {
  const { rows } = await db.query(
    `SELECT o.file_id, o.sha256, o.object_key FROM storage_objects o JOIN user_files f ON f.id = o.file_id
      WHERE f.deleted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM library_trash lt WHERE lt.source = 'file' AND lt.source_id = f.id) LIMIT $1`, [limit]);
  const result = { records: 0, objects: 0 };
  for (const row of rows) {
    try {
      // the object first, the record after: a failed removal leaves the record, so the next pass tries again
      const still = await db.query('SELECT 1 FROM storage_objects WHERE sha256 = $1 AND file_id <> $2 LIMIT 1', [row.sha256, row.file_id]);
      if (!still.rows.length && await store.delete(row.object_key)) result.objects += 1;
      await db.query('DELETE FROM storage_objects WHERE file_id = $1', [row.file_id]); result.records += 1;
    } catch (error) { log.warn?.('[storage] orphan sweep skipped:', row.file_id, error.message); }
  }
  return result;
}

/** How much of the account's storage has a verified second copy. */
export async function objectCoverage(db) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS files, COUNT(o.file_id)::int AS copied, COALESCE(SUM(f.file_size), 0)::bigint AS bytes, COALESCE(SUM(o.size_bytes), 0)::bigint AS copied_bytes
       FROM user_files f LEFT JOIN storage_objects o ON o.file_id = f.id
      WHERE f.storage_type = 'platform-upload' AND f.deleted_at IS NULL`);
  return { files: rows[0].files, copied: rows[0].copied, bytes: Number(rows[0].bytes), copiedBytes: Number(rows[0].copied_bytes) };
}
