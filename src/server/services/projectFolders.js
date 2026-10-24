/**
 * Project folders — every file of an app's project lives in XENO Storage (migration 20261029100000-project-folders.sql;
 * decision: `XENO WORKSHOP FILES IN STORAGE - DECISION.md`, workspace root).
 *
 * One project ↔ one Storage folder, owned by the account that made the project (personal) or its workspace (team).
 * A path inside the project is one Storage FILE with a history: writing it again adds a version, never a second file,
 * and never overwrites. The app keeps a working copy (a sandbox volume) and syncs it through these calls; the folder
 * is the truth. Access is Storage's own (`folderAccess`) — this module adds no permission model of its own.
 *
 * Nothing here deletes bytes: removing a path puts its file in the Storage trash, where it can be restored.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createFolder, folderAccess } from './storageFolders.js';
import { registerManagedLibraryFile } from './libraryAssets.js';
import { addVersion } from './storageVersions.js';
import { assertStorageRoom } from './storageAllowance.js';
import { storeFileObject, localLibraryPath } from './storageObjects.js';
import { cleanLibraryName, trashLibraryItem } from './libraryOrganise.js';
import { reconcileShares, sharedFolderAccess } from './storageShares.js';

export class ProjectFolderError extends Error { constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP = /^[a-z][a-z0-9-]{1,63}$/;
const SHA = /^[0-9a-f]{64}$/;
/** The top folder an app's projects sit in, as a person browsing Storage reads it. */
const APP_LABEL = { 'xeno-workshop': 'XENO Workshop', projects: 'Projects' };
const MAX_DEPTH = 32;

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** `src/app.tsx` — forward slashes, no empty, `.` or `..` segment, nothing a folder or file name refuses. */
export function projectPath(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 1024) return null;
  const parts = raw.split('/');
  if (parts.length > MAX_DEPTH) return null;
  for (const p of parts) if (cleanLibraryName(p) !== p) return null;   // refuses '', '.', '..', '\\', controls, padding
  return parts.join('/');
}

function checkIds(app, projectId) {
  if (!APP.test(String(app || ''))) throw new ProjectFolderError('Unknown app', 'invalid_app');
  if (!UUID.test(String(projectId || ''))) throw new ProjectFolderError('A project id is a UUID', 'invalid_project');
}

async function binding(db, app, projectId) {
  return (await db.query('SELECT folder_id FROM project_folders WHERE app = $1 AND project_id = $2', [app, projectId])).rows[0] || null;
}

/**
 * The project's folder if `userId` may use it as `need`; ProjectFolderError otherwise. Unknown and forbidden look alike.
 * `edit` here means editing the project's FILES. A personal folder shared with someone as `editor` is view-only in
 * Storage's own folder check (they may not rearrange someone else's folders), but writing the project's files is what
 * that share is for, so it is honoured here — and every change it makes is made as the folder's OWNER (`actor`), so the
 * files stay the owner's, count toward the owner's storage, and stay readable by the owner and every other collaborator.
 */
export async function projectFolder(db, userId, app, projectId, need = 'view') {
  checkIds(app, projectId);
  const b = await binding(db, app, projectId);
  let folder = b && await folderAccess(db, userId, b.folder_id, need);
  if (!folder && b && need === 'edit' && (await sharedFolderAccess(db, userId, b.folder_id)) === 'edit') folder = await folderAccess(db, userId, b.folder_id, 'view');
  if (!folder) throw new ProjectFolderError('Project not found', 'project_not_found', 404);
  return folder;
}

/** Who a change in the project folder is made as: the workspace member themselves in a team folder, else the owner. */
const actorFor = (folder, userId) => (folder.workspace_id ? userId : folder.owner_user_id);

/** A folder named `name` in `parentId` (or at the top of the scope), made if missing. Same name, any case, is the same folder. */
async function folderNamed(db, userId, { name, parentId = null, workspaceId = null }) {
  const made = await createFolder(db, userId, { name, parentId, workspaceId });
  if (made.ok) return made.folder.id;
  if (made.conflict && made.code === 'folder_exists') {
    const row = (await db.query(
      `SELECT id FROM storage_folders WHERE parent_id IS NOT DISTINCT FROM $1::uuid AND lower(name) = lower($2)
          AND (($3::uuid IS NULL AND workspace_id IS NULL AND owner_user_id = $4) OR ($3::uuid IS NOT NULL AND workspace_id = $3::uuid))
        ORDER BY created_at LIMIT 1`, [parentId, cleanLibraryName(name), workspaceId, userId])).rows[0];
    if (row) return row.id;
  }
  if (made.notFound || made.forbidden) throw new ProjectFolderError('You cannot add folders there', 'not_allowed', 403);
  throw new ProjectFolderError('That folder name is not allowed', made.code || 'invalid_name');
}

/**
 * The project's folder, made on first use: "<App> / <project name>" in the caller's own Storage, or in `workspaceId`'s
 * when the project belongs to a company. Idempotent — a project already bound returns its folder (if the caller may
 * see it), whatever name or workspace is passed.
 */
export async function ensureProjectFolder(db, userId, { app, projectId, name, workspaceId = null }) {
  checkIds(app, projectId);
  if (workspaceId !== null && !UUID.test(String(workspaceId))) throw new ProjectFolderError('A workspace id is a UUID', 'invalid_workspace');
  if (await binding(db, app, projectId)) return { created: false, folder: await projectFolder(db, userId, app, projectId, 'view') };
  // a NEW project needs room in the pool it will fill: a full one refuses it (507 storage_full) before anything is
  // made. An existing project always opens — reading and freeing space must work when full.
  await assertStorageRoom(db, { userId, workspaceId, bytes: 1 });
  const title = cleanLibraryName(String(name || '').slice(0, 120)) || 'Untitled project';
  const root = await folderNamed(db, userId, { name: APP_LABEL[app] || app, workspaceId });
  // two projects may share a name; the second gets its id beside it rather than the first one's files
  let folderId;
  const first = await createFolder(db, userId, { name: title, parentId: root });
  if (first.ok) folderId = first.folder.id;
  else if (first.conflict) {
    const second = await createFolder(db, userId, { name: `${title.slice(0, 100)} · ${projectId.slice(0, 8)}`, parentId: root });
    if (!second.ok) throw new ProjectFolderError('Could not make the project folder', second.code || 'folder_failed', 409);
    folderId = second.folder.id;
  } else throw new ProjectFolderError('You cannot add folders there', 'not_allowed', 403);
  const won = (await db.query(`INSERT INTO project_folders (app, project_id, folder_id, created_by) VALUES ($1, $2, $3, $4)
    ON CONFLICT (app, project_id) DO NOTHING RETURNING folder_id`, [app, projectId, folderId, userId])).rows[0];
  // lost a race with another first open: drop the empty folder we made and use theirs
  if (!won) { await db.query('DELETE FROM storage_folders WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM storage_item_folders WHERE folder_id = $1)', [folderId]); return { created: false, folder: await projectFolder(db, userId, app, projectId, 'view') }; }
  return { created: true, folder: await projectFolder(db, userId, app, projectId, 'view') };
}

const CURRENT = `SELECT f.id, f.file_id, f.mime_type, f.file_size, f.content_sha256, f.storage_path, f.created_at FROM user_files f
   WHERE f.file_id = pf.file_id AND f.deleted_at IS NULL AND f.storage_type = 'platform-upload'
     AND NOT EXISTS (SELECT 1 FROM user_files n WHERE n.replaces_asset_id = f.id)
   ORDER BY f.created_at DESC LIMIT 1`;

/** Every file of the project with its current version: what a working copy needs to know to be in step. */
export async function listProjectFiles(db, userId, app, projectId) {
  const folder = await projectFolder(db, userId, app, projectId, 'view');
  const { rows } = await db.query(`SELECT pf.path, cur.* FROM project_files pf CROSS JOIN LATERAL (${CURRENT}) cur
     WHERE pf.app = $1 AND pf.project_id = $2 ORDER BY pf.path`, [app, projectId]);
  return { folderId: folder.id, files: rows.map((r) => ({ path: r.path, fileId: String(r.file_id), versionId: String(r.id), size: Number(r.file_size), sha256: r.content_sha256, mimeType: r.mime_type, updatedAt: r.created_at })) };
}

async function current(db, app, projectId, p) {
  return (await db.query(`SELECT pf.path, cur.* FROM project_files pf CROSS JOIN LATERAL (${CURRENT}) cur
     WHERE pf.app = $1 AND pf.project_id = $2 AND pf.path = $3`, [app, projectId, p])).rows[0] || null;
}

/** One file of the project, for reading its bytes. */
export async function readProjectFile(db, userId, app, projectId, rawPath) {
  await projectFolder(db, userId, app, projectId, 'view');
  const p = projectPath(rawPath);
  if (!p) throw new ProjectFolderError('Not a valid project path', 'invalid_path');
  const row = await current(db, app, projectId, p);
  if (!row) throw new ProjectFolderError('No such file in the project', 'file_not_found', 404);
  // the object store is the home and this disk a cache: read through the one path that brings evicted bytes back
  return { ...row, local_path: await localLibraryPath(db, row) };
}

/** The Storage folder a path's file sits in: its directories, made as sub-folders of the project folder.
 *  Storage folder names compare without case and project paths do not, so `Src/a` and `src/b` share one sub-folder.
 *  Harmless: the sub-folders are for a person browsing Storage; `project_files` is what maps a path to its file. */
async function folderFor(db, userId, folder, p) {
  let at = folder.id;
  for (const dir of p.split('/').slice(0, -1)) at = await folderNamed(db, actorFor(folder, userId), { name: dir, parentId: at });
  return at;
}

/**
 * Write `bytes` at `rawPath`. A new path becomes a new Storage file (scanned, metered, in its directory's sub-folder);
 * an existing path gets a new VERSION. The same bytes again change nothing. `ifMatch` (the sha256 the writer last saw)
 * refuses a write on top of a version the writer has not seen — a working copy never silently drops another's change.
 */
export async function writeProjectFile(db, userId, app, projectId, rawPath, { bytes, mimeType = 'application/octet-stream', uploadsDir, ifMatch = null }) {
  const folder = await projectFolder(db, userId, app, projectId, 'edit');
  const p = projectPath(rawPath);
  if (!p) throw new ProjectFolderError('Not a valid project path', 'invalid_path');
  if (!Buffer.isBuffer(bytes)) throw new ProjectFolderError('No file content', 'no_content');
  if (ifMatch !== null && !SHA.test(ifMatch)) throw new ProjectFolderError('If-Match is the sha256 of the version you have', 'invalid_if_match');
  const digest = sha256(bytes);
  const before = await current(db, app, projectId, p);
  if (ifMatch !== null && (before?.content_sha256 || null) !== ifMatch) throw new ProjectFolderError('The file changed since you last read it', 'version_conflict', 409);
  if (before && before.content_sha256 === digest) return { unchanged: true, path: p, fileId: String(before.file_id), versionId: String(before.id), sha256: digest };

  const name = p.split('/').pop();
  const storagePath = path.join(uploadsDir, `${crypto.randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  await fs.promises.writeFile(storagePath, bytes);
  const stored = { filename: path.basename(storagePath), mimeType, fileSize: bytes.length, storagePath };
  try {
    let versionId;
    if (before) {
      const out = await addVersion(db, actorFor(folder, userId), String(before.id), stored, registerManagedLibraryFile);
      if (out.notFound) throw new ProjectFolderError('You cannot change this file', 'not_allowed', 403);
      versionId = out.file.id;
    } else {
      const created = await registerManagedLibraryFile(db, { userId: actorFor(folder, userId), workspaceId: folder.workspace_id || null, enforceAllowance: true, area: null,
        filename: stored.filename, originalName: name, mimeType, fileSize: bytes.length, storagePath, metadata: { source: 'project', app, projectId, path: p } });
      const won = (await db.query(`INSERT INTO project_files (app, project_id, path, file_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (app, project_id, path) DO NOTHING RETURNING file_id`, [app, projectId, p, created.file_id])).rows[0];
      if (!won) {
        // another writer made this path first: ours is withdrawn, and the caller re-reads and retries on top of theirs
        await db.query('UPDATE user_files SET deleted_at = now() WHERE id = $1', [created.id]);
        throw new ProjectFolderError('The file changed since you last read it', 'version_conflict', 409);
      }
      await db.query(`INSERT INTO storage_item_folders (source, source_id, folder_id) VALUES ('file', $1, $2) ON CONFLICT (source, source_id) DO NOTHING`, [created.id, await folderFor(db, userId, folder, p)]);
      if (!folder.workspace_id) await reconcileShares(db, folder.owner_user_id);   // a shared project folder shares its new file too
      versionId = created.id;
    }
    await db.query('UPDATE project_files SET updated_at = now() WHERE app = $1 AND project_id = $2 AND path = $3', [app, projectId, p]);
    const now = await current(db, app, projectId, p);
    storeFileObject(db, { id: now.id, storage_path: now.storage_path, content_sha256: now.content_sha256 }).catch((e) => console.warn('[Storage] project file copy failed, the sweep will retry:', e.message));
    return { created: !before, path: p, fileId: String(now.file_id), versionId: String(versionId), sha256: digest };
  } catch (error) {
    // the bytes stay only if a row now points at them
    const kept = (await db.query('SELECT 1 FROM user_files WHERE storage_path = $1 AND deleted_at IS NULL', [storagePath])).rows.length;
    if (!kept) await fs.promises.unlink(storagePath).catch(() => {});
    throw error;
  }
}

/** Take a path out of the project. Its file goes to the Storage trash, restorable for the trash period. */
export async function removeProjectFile(db, userId, app, projectId, rawPath, { ifMatch = null } = {}) {
  const folder = await projectFolder(db, userId, app, projectId, 'edit');
  const p = projectPath(rawPath);
  if (!p) throw new ProjectFolderError('Not a valid project path', 'invalid_path');
  if (ifMatch !== null && !SHA.test(ifMatch)) throw new ProjectFolderError('If-Match is the sha256 of the version you have', 'invalid_if_match');
  const row = await current(db, app, projectId, p);
  if (!row) throw new ProjectFolderError('No such file in the project', 'file_not_found', 404);
  // never remove a version the remover has not seen: someone may have changed it since
  if (ifMatch !== null && row.content_sha256 !== ifMatch) throw new ProjectFolderError('The file changed since you last read it', 'version_conflict', 409);
  // the one access check has run; the trash is entered on the owner's behalf, so a collaborator can remove a path too
  const out = await trashLibraryItem(db, { type: 'user', id: actorFor(folder, userId) }, 'file', String(row.id));
  if (out.forbidden || out.notFound) throw new ProjectFolderError('You cannot remove this file', 'not_allowed', 403);
  await db.query('DELETE FROM project_files WHERE app = $1 AND project_id = $2 AND path = $3', [app, projectId, p]);
  await db.query(`INSERT INTO project_file_events (app, project_id, path, kind, file_id) VALUES ($1, $2, $3, 'remove', $4)`, [app, projectId, p, row.file_id]);
  return { removed: true, path: p, fileId: String(row.file_id) };
}

/**
 * Rename or move a path. The file keeps its id and history (a working copy renaming `a.ts` to `b.ts` is one file, not a
 * delete and a new file); its Storage name and sub-folder follow. Refused onto a path that exists, and with `ifMatch`,
 * refused when the file changed since the mover last read it.
 */
export async function moveProjectFile(db, userId, app, projectId, rawFrom, rawTo, { ifMatch = null } = {}) {
  const folder = await projectFolder(db, userId, app, projectId, 'edit');
  const from = projectPath(rawFrom), to = projectPath(rawTo);
  if (!from || !to) throw new ProjectFolderError('Not a valid project path', 'invalid_path');
  if (ifMatch !== null && !SHA.test(ifMatch)) throw new ProjectFolderError('If-Match is the sha256 of the version you have', 'invalid_if_match');
  const row = await current(db, app, projectId, from);
  if (!row) throw new ProjectFolderError('No such file in the project', 'file_not_found', 404);
  if (ifMatch !== null && row.content_sha256 !== ifMatch) throw new ProjectFolderError('The file changed since you last read it', 'version_conflict', 409);
  if (from === to) return { moved: false, from, to, fileId: String(row.file_id), versionId: String(row.id), sha256: row.content_sha256 };
  let moved;
  try {
    moved = await db.query('UPDATE project_files SET path = $4, updated_at = now() WHERE app = $1 AND project_id = $2 AND path = $3', [app, projectId, from, to]);
  } catch (error) {
    if (error?.code === '23505') throw new ProjectFolderError('Something is already at that path', 'path_exists', 409);
    throw error;
  }
  if (!moved.rowCount) throw new ProjectFolderError('The file changed since you last read it', 'version_conflict', 409);
  const target = await folderFor(db, userId, folder, to);
  await db.query('UPDATE user_files SET original_name = $2 WHERE file_id = $1', [row.file_id, to.split('/').pop()]);
  await db.query(`UPDATE storage_item_folders SET folder_id = $2, placed_at = now()
     WHERE source = 'file' AND source_id IN (SELECT id FROM user_files WHERE file_id = $1)`, [row.file_id, target]);
  await db.query(`INSERT INTO project_file_events (app, project_id, path, kind, file_id) VALUES ($1, $2, $3, 'remove', $4)`, [app, projectId, from, row.file_id]);
  if (!folder.workspace_id) await reconcileShares(db, folder.owner_user_id);
  return { moved: true, from, to, fileId: String(row.file_id), versionId: String(row.id), sha256: row.content_sha256 };
}

/**
 * What changed in the project since `since` (the `cursor` an earlier call returned): a path written, by anyone and by
 * any route (a new version made in Storage itself counts), or a path gone (removed, moved away, or its file put in the
 * Storage trash). Changes are reported at least once; apply them by `versionId`, which is idempotent. The cursor trails
 * the clock by a moment, so a write still committing is reported on the next call rather than skipped.
 */
export async function projectChanges(db, userId, app, projectId, since = null) {
  await projectFolder(db, userId, app, projectId, 'view');
  const after = since ? new Date(since) : new Date(0);
  if (Number.isNaN(after.getTime())) throw new ProjectFolderError('Not a cursor from this feed', 'invalid_cursor');
  // user_files keeps timestamps WITHOUT a zone: every comparison here is made as timestamptz, or a cursor sent with an
  // offset would be read as wall-clock time and silently skip hours of changes
  const upto = (await db.query("SELECT clock_timestamp() - interval '2 seconds' AS t")).rows[0].t;
  const written = (await db.query(`SELECT pf.path, cur.id, cur.file_id, cur.content_sha256, cur.file_size, GREATEST(cur.created_at::timestamptz, pf.updated_at::timestamptz) AS at
       FROM project_files pf CROSS JOIN LATERAL (${CURRENT}) cur
      WHERE pf.app = $1 AND pf.project_id = $2 AND GREATEST(cur.created_at::timestamptz, pf.updated_at::timestamptz) > $3::timestamptz AND GREATEST(cur.created_at::timestamptz, pf.updated_at::timestamptz) <= $4::timestamptz`,
    [app, projectId, after, upto])).rows;
  const trashed = (await db.query(`SELECT pf.path, pf.file_id, MAX(f.deleted_at::timestamptz) AS at FROM project_files pf JOIN user_files f ON f.file_id = pf.file_id
      WHERE pf.app = $1 AND pf.project_id = $2 AND f.deleted_at::timestamptz > $3::timestamptz AND f.deleted_at::timestamptz <= $4::timestamptz
        AND NOT EXISTS (SELECT 1 FROM user_files live WHERE live.file_id = pf.file_id AND live.deleted_at IS NULL)
      GROUP BY pf.path, pf.file_id`, [app, projectId, after, upto])).rows;
  const gone = (await db.query('SELECT path, file_id, at FROM project_file_events WHERE app = $1 AND project_id = $2 AND at > $3::timestamptz AND at <= $4::timestamptz',
    [app, projectId, after, upto])).rows;
  const changes = [
    ...written.map((r) => ({ kind: 'put', path: r.path, fileId: String(r.file_id), versionId: String(r.id), sha256: r.content_sha256, size: Number(r.file_size), at: r.at })),
    ...[...trashed, ...gone].map((r) => ({ kind: 'remove', path: r.path, fileId: r.file_id ? String(r.file_id) : null, at: r.at })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
  return { cursor: new Date(Math.max(after.getTime(), new Date(upto).getTime())).toISOString(), changes };
}
