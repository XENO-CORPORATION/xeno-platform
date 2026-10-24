/**
 * Every project has its own Storage folder (owner, 2026-10-24: "every time the user creates a project a new folder
 * will be created for that project", "let's build it right away now").
 *
 * This is the SAME binding app projects use (`project_folders`, services/projectFolders.js, decision
 * `XENO WORKSHOP FILES IN STORAGE - DECISION.md`) under the app key `projects`, so there is one project↔folder table
 * and one folder check, never a second store. The folder is an ordinary Storage folder:
 *   - a personal project → a personal folder of its owner, under "Projects", counted in the owner's storage;
 *   - a workspace project → a team folder of that workspace, counted in the workspace's pool.
 * Access: workspace members reach a team folder through the workspace (storageFolders.js `inWorkspace`). For a personal
 * project, the people the owner invited to the project are given the folder by `reconcileShares` (its project branch),
 * the one writer of share access — so changing who is on the project must call `syncProjectFolderAccess`.
 *
 * Making the folder never blocks making the project: a project is not refused because a storage pool is full. When the
 * folder cannot be made now, the next open of the project makes it.
 *
 * The binding is made here, from the project's own row, never from a caller's say-so: the public route refuses the
 * `projects` app key (projectFolderRoutes.js), so nobody can bind someone else's project id to a folder of their own.
 */
import { ensureProjectFolder, ProjectFolderError } from './projectFolders.js';
import { updateFolder } from './storageFolders.js';
import { reconcileShares } from './storageShares.js';
import { cleanLibraryName } from './libraryOrganise.js';

export const PROJECTS_APP = 'projects';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function projectRow(db, projectId) {
  if (!UUID.test(String(projectId || ''))) return null;
  return (await db.query(
    `SELECT p.id, p.name, p.owner_user_id, p.workspace_id, p.created_by_user_id, w.owner_user_id AS workspace_owner
       FROM chat_projects p LEFT JOIN workspaces w ON w.id = p.workspace_id WHERE p.id = $1`, [projectId])).rows[0] || null;
}

async function boundFolder(db, projectId) {
  return (await db.query(
    `SELECT sf.id, sf.owner_user_id, sf.workspace_id, sf.name FROM project_folders pf JOIN storage_folders sf ON sf.id = pf.folder_id
      WHERE pf.app = $1 AND pf.project_id = $2`, [PROJECTS_APP, projectId])).rows[0] || null;
}

/** Who makes changes to the project's folder: its owner, or for a workspace project the creator, else the workspace owner. */
function actorsFor(p) {
  if (!p.workspace_id) return [p.owner_user_id];
  return [...new Set([p.created_by_user_id, p.workspace_owner].filter(Boolean))];
}

/**
 * The project's folder, made if it does not exist yet. Returns `{ folder, created }`, or `{ folder: null, reason }` when it
 * cannot be made right now (a full pool, nobody left who may add a team folder). Never throws for those.
 */
export async function ensureChatProjectFolder(db, projectId) {
  const p = await projectRow(db, projectId);
  if (!p) return { folder: null, reason: 'project_not_found' };
  const bound = await boundFolder(db, p.id);
  if (bound) return { folder: bound, created: false };
  let last = 'not_allowed';
  for (const actor of actorsFor(p)) {
    try {
      const made = await ensureProjectFolder(db, actor, { app: PROJECTS_APP, projectId: p.id, name: p.name, workspaceId: p.workspace_id || null });
      if (!p.workspace_id) await reconcileShares(db, p.owner_user_id);
      return { folder: await boundFolder(db, p.id), created: made.created };
    } catch (error) {
      if (!(error instanceof ProjectFolderError) && error?.code !== 'storage_full') throw error;
      last = error.code || 'not_allowed';
      if (last === 'storage_full') break;
    }
  }
  return { folder: null, reason: last };
}

/** After anyone joins, leaves or changes role on a personal project: re-derive who may open its folder. */
export async function syncProjectFolderAccess(db, projectId) {
  const p = await projectRow(db, projectId);
  if (p && !p.workspace_id && p.owner_user_id && (await boundFolder(db, p.id))) await reconcileShares(db, p.owner_user_id);
}

/** A renamed project renames its folder (a clash keeps the old name; the folder is found by id, never by name). */
export async function renameChatProjectFolder(db, projectId) {
  const p = await projectRow(db, projectId);
  const f = p && await boundFolder(db, p.id);
  if (!f) return;
  const name = cleanLibraryName(String(p.name || '').slice(0, 120));
  if (!name || name.toLowerCase() === String(f.name).toLowerCase()) return;
  for (const actor of actorsFor(p)) {
    const r = await updateFolder(db, actor, f.id, { name }).catch(() => null);
    if (r?.ok || r?.conflict) return;
  }
}

/**
 * Before a project is deleted for good. Nothing is deleted from Storage: the folder and its files stay in the owner's
 * (or workspace's) storage as an ordinary folder. Only the binding goes, and with it any access the project gave.
 */
export async function releaseChatProjectFolder(db, projectId) {
  const p = await projectRow(db, projectId);
  if (!p) return;
  await db.query('DELETE FROM project_folders WHERE app = $1 AND project_id = $2', [PROJECTS_APP, p.id]);
  if (!p.workspace_id && p.owner_user_id) await reconcileShares(db, p.owner_user_id);
}

/** What the project's files take up: every live file in its folder and the folders inside, each version counted, as
 *  the allowance counts them (storageAllowance.js reads the same rows). */
export async function projectFolderUsage(db, folderId) {
  const r = (await db.query(
    `WITH RECURSIVE tree AS (SELECT id, 0 AS depth FROM storage_folders WHERE id = $1
       UNION ALL SELECT c.id, t.depth + 1 FROM storage_folders c JOIN tree t ON c.parent_id = t.id WHERE t.depth < 64)
     SELECT COALESCE(SUM(f.file_size), 0)::bigint AS bytes, COUNT(DISTINCT COALESCE(f.file_id, f.id))::int AS files
       FROM tree JOIN storage_item_folders i ON i.folder_id = tree.id AND i.source = 'file'
       JOIN user_files f ON f.id = i.source_id AND f.deleted_at IS NULL`, [folderId])).rows[0];
  return { bytes: Number(r.bytes), files: r.files };
}
