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

/** How much of the account's storage has a verified second copy. */
export async function objectCoverage(db) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS files, COUNT(o.file_id)::int AS copied, COALESCE(SUM(f.file_size), 0)::bigint AS bytes, COALESCE(SUM(o.size_bytes), 0)::bigint AS copied_bytes
       FROM user_files f LEFT JOIN storage_objects o ON o.file_id = f.id
      WHERE f.storage_type = 'platform-upload' AND f.deleted_at IS NULL`);
  return { files: rows[0].files, copied: rows[0].copied, bytes: Number(rows[0].bytes), copiedBytes: Number(rows[0].copied_bytes) };
}
