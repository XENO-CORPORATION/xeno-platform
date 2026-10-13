/**
 * XENO Storage (codename Arca): VERSIONS of a file. Spec: `XENO STORAGE - SPEC.md` section 7.3.
 *
 * A new version is a NEW file row made by the one registration path every upload uses, so it is hashed,
 * checked against the plan's allowance and put through the security scan like any other upload; nothing about
 * a version skips a check. The new row points at the one it replaces (`replaces_asset_id`). The older row
 * stays, with its bytes, and is no longer listed.
 *
 * What a person put ON the file moves to the new version in the same transaction: its folder, its star, its
 * area and its shares, so a link or a share keeps opening "the file", which is now its newest version.
 * A chat that attached the older version keeps that exact version: its reference is to the older row.
 *
 * Every version counts toward storage until the file is deleted for good, which removes them all.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { withTransaction } from './chatProjectAuthority.js';
import { reconcileShares } from './storageShares.js';

const isId = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** The current (newest) row of a file the caller owns (or, with `orEdits`, may edit), or null. A row that has been replaced is not current. */
async function ownedCurrent(db, userId, fileId, orEdits = false) {
  if (!isId(fileId) || !isId(userId)) return null;
  const { rows } = await db.query(
    `SELECT f.* FROM user_files f WHERE f.id = $1 AND f.deleted_at IS NULL AND f.storage_type = 'platform-upload'
        AND NOT EXISTS (SELECT 1 FROM user_files n WHERE n.replaces_asset_id = f.id)`, [fileId]);
  if (!rows[0]) return null;
  const owner = await check(db, { object: `library_asset:${fileId}`, relation: 'owner', subject: `user:${userId}` });
  if (owner.allowed) return rows[0];
  // someone the owner gave "can edit" may add a version; the file stays the owner's
  if (orEdits && !rows[0].workspace_id && (await db.query(`SELECT 1 FROM storage_access WHERE kind = 'file' AND target_id = $1 AND user_id = $2 AND role = 'editor'`, [fileId, userId])).rows.length) return rows[0];
  return null;
}

/** Newest first: [{ id, sizeBytes, createdAt, current }]. */
export async function listVersions(db, userId, fileId) {
  if (!(await ownedCurrent(db, userId, fileId))) return { notFound: true };
  const { rows } = await db.query(
    `WITH RECURSIVE chain AS (
       SELECT id, replaces_asset_id, file_size, created_at, 0 AS depth FROM user_files WHERE id = $1
       UNION ALL SELECT p.id, p.replaces_asset_id, p.file_size, p.created_at, chain.depth + 1 FROM user_files p JOIN chain ON p.id = chain.replaces_asset_id WHERE chain.depth < 500)
     SELECT id, file_size, created_at, depth FROM chain ORDER BY depth`, [fileId]);
  return { ok: true, versions: rows.map((r) => ({ id: r.id, sizeBytes: Number(r.file_size), createdAt: r.created_at, current: r.depth === 0 })) };
}

/**
 * Make `stored` (bytes already written under a managed upload root) the new version of a file.
 * `register` is registerManagedLibraryFile, passed in so this module adds no second way to create a file.
 */
export async function addVersion(db, userId, fileId, stored, register) {
  const old = await ownedCurrent(db, userId, fileId, true);
  if (!old) return { notFound: true };
  // the new version belongs to the file's owner (and counts toward the owner's storage), whoever uploads it
  const ownerId = old.workspace_id ? userId : (old.owner_user_id || old.user_id);
  const created = await register(db, {
    userId: ownerId, workspaceId: old.workspace_id || null, enforceAllowance: true, area: null,
    filename: stored.filename, originalName: old.original_name || old.filename, mimeType: stored.mimeType,
    fileSize: stored.fileSize, storagePath: stored.storagePath, metadata: { ...(old.metadata || {}), source: 'upload', version_of: old.id },
  });
  const link = () => withTransaction(db, async (tx) => {
    // two people replacing the same file at once: the second finds it already replaced and stops
    const raced = await tx.query('SELECT 1 FROM user_files WHERE replaces_asset_id = $1 FOR UPDATE', [old.id]);
    if (raced.rows.length) throw Object.assign(new Error('The file was replaced by someone else just now.'), { code: 'version_conflict', status: 409 });
    await tx.query('UPDATE user_files SET replaces_asset_id = $2 WHERE id = $1', [created.id, old.id]);
    for (const table of ['storage_item_folders', 'library_item_stars', 'library_item_areas']) {
      await tx.query(`DELETE FROM ${table} WHERE source = 'file' AND source_id = $1`, [created.id]);   // the new row's own defaults give way
      await tx.query(`UPDATE ${table} SET source_id = $2 WHERE source = 'file' AND source_id = $1`, [old.id, created.id]);
    }
    await tx.query(`UPDATE storage_shares SET file_id = $2 WHERE file_id = $1 AND revoked_at IS NULL`, [old.id, created.id]);
    // access follows the file to its newest version: direct shares and the shares of the folders it is in
    if (!old.workspace_id) await reconcileShares(tx, ownerId);
  });
  // if it cannot become the new version, the row just made is withdrawn rather than left as a stray file
  try { await link(); } catch (error) { await db.query('UPDATE user_files SET deleted_at = now() WHERE id = $1', [created.id]); throw error; }
  return { ok: true, file: { id: created.id, replaces: old.id } };
}

/** Bring an older version back: its bytes become a NEW newest version, so nothing in between is lost. */
export async function restoreVersion(db, userId, fileId, versionId, register) {
  const listed = await listVersions(db, userId, fileId);
  if (listed.notFound) return listed;
  if (!listed.versions.some((v) => v.id === versionId && !v.current)) return { notFound: true };
  const source = (await db.query('SELECT storage_path, mime_type, file_size FROM user_files WHERE id = $1', [versionId])).rows[0];
  const from = path.resolve(source.storage_path || '');
  if (!fs.existsSync(from)) return { conflict: true, code: 'version_bytes_missing' };
  const to = path.join(path.dirname(from), `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(from)}`);
  await fs.promises.copyFile(from, to);
  try { return await addVersion(db, userId, fileId, { filename: path.basename(to), mimeType: source.mime_type, fileSize: Number(source.file_size), storagePath: to }, register); }
  catch (error) { await fs.promises.unlink(to).catch(() => {}); throw error; }
}
