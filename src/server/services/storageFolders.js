/**
 * XENO Storage (codename Arca): FOLDERS. Spec: `XENO STORAGE - SPEC.md` section 7.1 in the workspace root.
 *
 * A folder is the account's own: only its owner sees or changes it. An item is in one folder or at the top.
 * Nothing here deletes a file: removing a folder is refused while anything is in it.
 */
import { cleanLibraryName, folderStanding } from './libraryOrganise.js';

const isId = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const view = (r) => ({ id: r.id, name: r.name, parentId: r.parent_id, createdAt: r.created_at, updatedAt: r.updated_at, ...(r.items === undefined ? {} : { items: Number(r.items), folders: Number(r.folders) }) });
const own = async (db, userId, id) => (isId(id) ? (await db.query('SELECT * FROM storage_folders WHERE id = $1 AND owner_user_id = $2', [id, userId])).rows[0] || null : null);
const sameName = (error) => error?.code === '23505';

/** The folders in one place (`parentId` null = the top), with how much each holds. */
export async function listFolders(db, userId, parentId = null) {
  if (parentId !== null && !(await own(db, userId, parentId))) return { notFound: true };
  const { rows } = await db.query(
    `SELECT f.*, (SELECT COUNT(*) FROM storage_item_folders i WHERE i.folder_id = f.id) AS items,
            (SELECT COUNT(*) FROM storage_folders c WHERE c.parent_id = f.id) AS folders
       FROM storage_folders f WHERE f.owner_user_id = $1 AND f.parent_id IS NOT DISTINCT FROM $2::uuid ORDER BY lower(f.name)`, [userId, parentId]);
  return { ok: true, folders: rows.map(view), path: parentId ? await folderPath(db, userId, parentId) : [] };
}

/** From the top down to this folder: [{ id, name }]. */
export async function folderPath(db, userId, id) {
  const { rows } = await db.query(
    `WITH RECURSIVE up AS (
       SELECT id, name, parent_id, 0 AS depth FROM storage_folders WHERE id = $1 AND owner_user_id = $2
       UNION ALL SELECT p.id, p.name, p.parent_id, up.depth + 1 FROM storage_folders p JOIN up ON p.id = up.parent_id WHERE up.depth < 64)
     SELECT id, name FROM up ORDER BY depth DESC`, [id, userId]);
  return rows;
}

/** Every folder of the account, flat, for a "move to" list. */
export async function allFolders(db, userId) {
  return (await db.query('SELECT id, name, parent_id FROM storage_folders WHERE owner_user_id = $1 ORDER BY lower(name)', [userId])).rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id }));
}

export async function createFolder(db, userId, { name, parentId = null }) {
  const clean = cleanLibraryName(name);
  if (!clean) return { invalid: true, code: 'invalid_name' };
  if (parentId !== null && !(await own(db, userId, parentId))) return { notFound: true };
  try { return { ok: true, folder: view((await db.query('INSERT INTO storage_folders (owner_user_id, parent_id, name) VALUES ($1, $2, $3) RETURNING *', [userId, parentId, clean])).rows[0]) }; }
  catch (error) { if (sameName(error)) return { conflict: true, code: 'folder_exists' }; throw error; }
}

/** Rename and/or move a folder. A folder cannot be moved into itself or into anything inside it. */
export async function updateFolder(db, userId, id, { name, parentId }) {
  const folder = await own(db, userId, id);
  if (!folder) return { notFound: true };
  let nextName = folder.name, nextParent = folder.parent_id;
  if (name !== undefined) { nextName = cleanLibraryName(name); if (!nextName) return { invalid: true, code: 'invalid_name' }; }
  if (parentId !== undefined) {
    if (parentId !== null) {
      if (!(await own(db, userId, parentId))) return { notFound: true };
      if ((await folderPath(db, userId, parentId)).some((p) => p.id === id)) return { conflict: true, code: 'folder_inside_itself' };
    }
    nextParent = parentId;
  }
  try { return { ok: true, folder: view((await db.query('UPDATE storage_folders SET name = $2, parent_id = $3, updated_at = now() WHERE id = $1 RETURNING *', [id, nextName, nextParent])).rows[0]) }; }
  catch (error) { if (sameName(error)) return { conflict: true, code: 'folder_exists' }; throw error; }
}

/** Remove an EMPTY folder. A folder that holds anything is refused: nothing is deleted by removing a folder. */
export async function removeFolder(db, userId, id) {
  const folder = await own(db, userId, id);
  if (!folder) return { notFound: true };
  const held = (await db.query('SELECT (SELECT COUNT(*) FROM storage_item_folders WHERE folder_id = $1) + (SELECT COUNT(*) FROM storage_folders WHERE parent_id = $1) AS n', [id])).rows[0];
  if (Number(held.n) > 0) return { conflict: true, code: 'folder_not_empty' };
  await db.query('DELETE FROM storage_folders WHERE id = $1', [id]);
  return { ok: true };
}

/** Put an item in one of the caller's folders, or back at the top (`folderId` null). Needs edit rights on the item. */
export async function moveItemToFolder(db, principal, source, id, folderId) {
  const who = await folderStanding(db, principal, source, id);
  if (who.invalid || who.notFound || who.forbidden) return who;
  if (folderId === null) { await db.query('DELETE FROM storage_item_folders WHERE source = $1 AND source_id = $2', [source, id]); return { ok: true, folderId: null }; }
  if (!(await own(db, principal.id, folderId))) return { notFound: true };
  await db.query(`INSERT INTO storage_item_folders (source, source_id, folder_id) VALUES ($1, $2, $3)
    ON CONFLICT (source, source_id) DO UPDATE SET folder_id = EXCLUDED.folder_id, placed_at = now()`, [source, id, folderId]);
  return { ok: true, folderId };
}
