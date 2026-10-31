/**
 * Library: duplicate a file, and put an item into a project.
 *
 * A copy is a new file with its own id, history and place in the allowance, never a second name for the same row. Someone a
 * file was shared with may copy it into their own Library, because they can already download it; their copy is theirs. A copy of
 * a workspace's file stays in that workspace, for whoever may add files there (registerManagedLibraryFile checks).
 *
 * Moving to a project is filing the item in the project's own Storage folder (services/chatProjectFolders.js), so the people on the
 * project reach it the way they reach everything else there. moveItemToFolder still decides whether this person may move this item, and a
 * personal file does not go into a workspace's folder: that would hand it to the workspace.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { registerManagedLibraryFile } from './libraryAssets.js';
import { localLibraryPath } from './storageObjects.js';
import { moveItemToFolder, folderAccess } from './storageFolders.js';
import { sharedFolderAccess } from './storageShares.js';
import { ensureChatProjectFolder } from './chatProjectFolders.js';
import { requireResourceRelation, userPrincipal, ChatAuthorizationError } from './chatProjectAuthority.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The name a copy gets: "report copy.pdf", then "report copy 2.pdf". */
async function copyName(db, userId, workspaceId, name) {
  const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  const taken = new Set((await db.query(`SELECT original_name FROM user_files WHERE deleted_at IS NULL AND original_name LIKE $1 AND ${workspaceId ? 'workspace_id = $2' : 'COALESCE(owner_user_id, user_id) = $2'}`, [`${stem} copy%`, workspaceId || userId])).rows.map((r) => r.original_name));
  let n = 1, out = `${stem} copy${ext}`;
  while (taken.has(out)) out = `${stem} copy ${++n}${ext}`;
  return out;
}

export async function duplicateFile(db, userId, fileId) {
  if (!UUID.test(String(fileId))) return { invalid: true };
  const f = (await db.query(`SELECT f.*, w.workspace_type, sif.folder_id FROM user_files f LEFT JOIN workspaces w ON w.id = f.workspace_id
      LEFT JOIN storage_item_folders sif ON sif.source = 'file' AND sif.source_id = f.id
     WHERE f.id = $1 AND f.deleted_at IS NULL AND f.storage_type = 'platform-upload'`, [fileId])).rows[0];
  if (!f) return { notFound: true };
  const own = String(f.owner_user_id || f.user_id) === String(userId), teamFile = f.workspace_id && f.workspace_type !== 'personal';
  if (!own && !teamFile) {
    const direct = (await db.query(`SELECT 1 FROM storage_access WHERE kind = 'file' AND target_id = $1 AND user_id = $2`, [f.id, userId])).rows.length > 0;
    const viaFolder = f.folder_id ? await sharedFolderAccess(db, userId, f.folder_id) : null;
    if (!direct && !viaFolder) return { notFound: true };   // someone else's file answers as one that does not exist
  }
  const source = await localLibraryPath(db, f);
  if (!source) return { conflict: true, code: 'file_unavailable' };
  const workspaceId = teamFile ? f.workspace_id : own ? f.workspace_id : null;
  const name = await copyName(db, userId, teamFile ? f.workspace_id : null, f.original_name || f.filename);
  const dest = path.join(path.dirname(source), `${crypto.randomUUID()}${path.extname(f.filename || '')}`);
  await fs.promises.copyFile(source, dest);
  let made;
  try {
    made = await registerManagedLibraryFile(db, { userId, workspaceId, filename: path.basename(dest), originalName: name, mimeType: f.mime_type, fileSize: (await fs.promises.stat(dest)).size, storagePath: dest, metadata: { duplicated_from: f.id }, area: null, enforceAllowance: true });
  } catch (e) {
    await fs.promises.rm(dest, { force: true });
    if (e.code === 'storage_full') return { full: true };
    if (/editor access/.test(e.message)) return { forbidden: true };
    throw e;
  }
  // beside the original, when the original is in a folder this person may file things in
  if (f.folder_id && (own || teamFile) && await folderAccess(db, userId, f.folder_id, 'edit')) await moveItemToFolder(db, { type: 'user', id: userId }, 'file', made.id, f.folder_id);
  return { ok: true, file: { id: made.id, fileId: made.file_id, name } };
}

/** projectId null takes the item out of its folder. */
export async function moveToProject(db, userId, source, id, projectId) {
  const principal = { type: 'user', id: userId };
  if (projectId === null) return moveItemToFolder(db, principal, source, id, null);
  if (!UUID.test(String(projectId))) return { invalid: true };
  try { await requireResourceRelation(db, userPrincipal(userId), 'project', projectId, 'editor'); }
  catch (e) { if (e instanceof ChatAuthorizationError) return { notFound: true }; throw e; }
  const out = await ensureChatProjectFolder(db, projectId);
  if (!out.folder) return out.reason === 'storage_full' ? { full: true } : { conflict: true, code: out.reason };
  return moveItemToFolder(db, principal, source, id, out.folder.id);
}
