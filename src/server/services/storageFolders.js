/**
 * XENO Storage (codename Arca): FOLDERS. Spec: `XENO STORAGE - SPEC.md` section 7.1 in the workspace root.
 *
 * A folder is either PERSONAL (one account's own: only its owner sees or changes it) or a TEAM folder (it
 * belongs to a workspace: every member with view rights sees it, every member with edit rights changes it).
 * The scope is set when a top-level folder is made and is inherited by everything inside it; a folder never
 * moves between a person and a workspace, or between two workspaces.
 *
 * An item is in one folder or at the top. A team folder holds only that workspace's own files.
 * Nothing here deletes a file: removing a folder is refused while anything is in it.
 */
import { check } from '../utils/authzReBAC.js';
import { cleanLibraryName, folderStanding } from './libraryOrganise.js';

const isId = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const view = (r) => ({ id: r.id, name: r.name, parentId: r.parent_id, workspaceId: r.workspace_id || null, createdAt: r.created_at, updatedAt: r.updated_at, ...(r.items === undefined ? {} : { items: Number(r.items), folders: Number(r.folders) }) });
const sameName = (error) => error?.code === '23505';
const RANK = { view: 1, edit: 2 };

/** What the caller may do in a workspace: 'edit', 'view' or null. */
async function inWorkspace(db, userId, workspaceId) {
  if (!isId(workspaceId)) return null;
  const subject = `user:${userId}`, object = `workspace:${workspaceId}`;
  if ((await check(db, { object, relation: 'editor', subject })).allowed) return 'edit';
  return (await check(db, { object, relation: 'viewer', subject })).allowed ? 'view' : null;
}
/** The folder, if the caller may use it at least as `need` ('view' or 'edit'); else null. */
async function reach(db, userId, id, need = 'edit') {
  if (!isId(id)) return null;
  const folder = (await db.query('SELECT * FROM storage_folders WHERE id = $1', [id])).rows[0];
  if (!folder) return null;
  const can = folder.workspace_id ? await inWorkspace(db, userId, folder.workspace_id) : folder.owner_user_id === userId ? 'edit' : null;
  return can && RANK[can] >= RANK[need] ? folder : null;
}

/** The folders in one place, with how much each holds. `parentId` null is the top: the caller's own, or a workspace's. */
export async function listFolders(db, userId, parentId = null, workspaceId = null) {
  let scope = workspaceId;
  if (parentId !== null) { const parent = await reach(db, userId, parentId, 'view'); if (!parent) return { notFound: true }; scope = parent.workspace_id || null; }
  else if (workspaceId !== null && !(await inWorkspace(db, userId, workspaceId))) return { notFound: true };
  const { rows } = await db.query(
    `SELECT f.*, (SELECT COUNT(*) FROM storage_item_folders i WHERE i.folder_id = f.id) AS items,
            (SELECT COUNT(*) FROM storage_folders c WHERE c.parent_id = f.id) AS folders
       FROM storage_folders f
      WHERE f.parent_id IS NOT DISTINCT FROM $2::uuid
        AND (($3::uuid IS NULL AND f.workspace_id IS NULL AND f.owner_user_id = $1) OR f.workspace_id = $3::uuid)
      ORDER BY lower(f.name)`, [userId, parentId, scope]);
  return { ok: true, folders: rows.map(view), path: parentId ? await folderPath(db, parentId) : [], workspaceId: scope };
}

/** From the top down to this folder: [{ id, name }]. The caller's right to the folder is checked by the caller. */
export async function folderPath(db, id) {
  const { rows } = await db.query(
    `WITH RECURSIVE up AS (
       SELECT id, name, parent_id, 0 AS depth FROM storage_folders WHERE id = $1
       UNION ALL SELECT p.id, p.name, p.parent_id, up.depth + 1 FROM storage_folders p JOIN up ON p.id = up.parent_id WHERE up.depth < 64)
     SELECT id, name FROM up ORDER BY depth DESC`, [id]);
  return rows;
}

/** Every folder of one scope, flat, for a "move to" list. */
export async function allFolders(db, userId, workspaceId = null) {
  if (workspaceId !== null && !(await inWorkspace(db, userId, workspaceId))) return [];
  const { rows } = await db.query(
    `SELECT id, name, parent_id, workspace_id FROM storage_folders
      WHERE ($2::uuid IS NULL AND workspace_id IS NULL AND owner_user_id = $1) OR workspace_id = $2::uuid ORDER BY lower(name)`, [userId, workspaceId]);
  return rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id, workspaceId: r.workspace_id || null }));
}

export async function createFolder(db, userId, { name, parentId = null, workspaceId = null }) {
  const clean = cleanLibraryName(name);
  if (!clean) return { invalid: true, code: 'invalid_name' };
  let scope = workspaceId;
  if (parentId !== null) { const parent = await reach(db, userId, parentId); if (!parent) return { notFound: true }; scope = parent.workspace_id || null; }
  else if (workspaceId !== null) { const can = await inWorkspace(db, userId, workspaceId); if (!can) return { notFound: true }; if (can !== 'edit') return { forbidden: true }; }
  try { return { ok: true, folder: view((await db.query('INSERT INTO storage_folders (owner_user_id, parent_id, name, workspace_id) VALUES ($1, $2, $3, $4) RETURNING *', [userId, parentId, clean, scope])).rows[0]) }; }
  catch (error) { if (sameName(error)) return { conflict: true, code: 'folder_exists' }; throw error; }
}

/** Rename and/or move a folder. It stays in its own scope, and cannot go into itself or anything inside it. */
export async function updateFolder(db, userId, id, { name, parentId }) {
  const folder = await reach(db, userId, id);
  if (!folder) return { notFound: true };
  let nextName = folder.name, nextParent = folder.parent_id;
  if (name !== undefined) { nextName = cleanLibraryName(name); if (!nextName) return { invalid: true, code: 'invalid_name' }; }
  if (parentId !== undefined) {
    if (parentId !== null) {
      const parent = await reach(db, userId, parentId);
      if (!parent) return { notFound: true };
      if ((parent.workspace_id || null) !== (folder.workspace_id || null)) return { conflict: true, code: 'folder_other_place' };
      if ((await folderPath(db, parentId)).some((p) => p.id === id)) return { conflict: true, code: 'folder_inside_itself' };
    }
    nextParent = parentId;
  }
  try { return { ok: true, folder: view((await db.query('UPDATE storage_folders SET name = $2, parent_id = $3, updated_at = now() WHERE id = $1 RETURNING *', [id, nextName, nextParent])).rows[0]) }; }
  catch (error) { if (sameName(error)) return { conflict: true, code: 'folder_exists' }; throw error; }
}

/** Remove an EMPTY folder. A folder that holds anything is refused: nothing is deleted by removing a folder. */
export async function removeFolder(db, userId, id) {
  const folder = await reach(db, userId, id);
  if (!folder) return { notFound: true };
  const held = (await db.query('SELECT (SELECT COUNT(*) FROM storage_item_folders WHERE folder_id = $1) + (SELECT COUNT(*) FROM storage_folders WHERE parent_id = $1) AS n', [id])).rows[0];
  if (Number(held.n) > 0) return { conflict: true, code: 'folder_not_empty' };
  await db.query('DELETE FROM storage_folders WHERE id = $1', [id]);
  return { ok: true };
}

/** Put an item in a folder the caller may edit, or back at the top (`folderId` null). Needs edit rights on the item. */
export async function moveItemToFolder(db, principal, source, id, folderId) {
  const who = await folderStanding(db, principal, source, id);
  if (who.invalid || who.notFound || who.forbidden) return who;
  if (folderId === null) { await db.query('DELETE FROM storage_item_folders WHERE source = $1 AND source_id = $2', [source, id]); return { ok: true, folderId: null }; }
  const folder = await reach(db, principal.id, folderId);
  if (!folder) return { notFound: true };
  // a team folder holds that workspace's own files; a personal folder holds what is not a team's
  const home = source === 'file' ? (await db.query('SELECT workspace_id FROM user_files WHERE id = $1', [id])).rows[0]?.workspace_id || null : null;
  if ((folder.workspace_id || null) !== home) return { conflict: true, code: 'folder_other_place' };
  await db.query(`INSERT INTO storage_item_folders (source, source_id, folder_id) VALUES ($1, $2, $3)
    ON CONFLICT (source, source_id) DO UPDATE SET folder_id = EXCLUDED.folder_id, placed_at = now()`, [source, id, folderId]);
  return { ok: true, folderId };
}
