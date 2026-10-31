/**
 * Task folders — a task names the Storage folders its work lives in (migration 20261016120000-task-folders.sql).
 *
 * "Inputs are in #Weapon renders, put results in #Weapon videos": the person links folders to the task, uploads the
 * data there, and whoever takes the task — person or agent — can open exactly those folders, with nothing copied and
 * no per-project storage of its own. Access is granted by the one reconciler every folder share uses
 * (storageShares.reconcileShares), so it is added when someone starts working the task and taken away when the link
 * goes, the task closes, or they stop working it. Agents reach the same folders over XENO MCP (library tools) and
 * read where to look from get_task / the guidance.
 *
 * Rules: linking needs edit rights on the TASK (you change it) and on the FOLDER (you may share it: its owner, or an
 * editor of its team). A team folder is reached by team membership; the link still tells the worker where to look.
 */
import * as tasks from './xenoTasks.js';
import { reconcileShares } from './storageShares.js';
import { check } from '../utils/authzReBAC.js';

export class TaskFolderError extends Error { constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = new Set(['viewer', 'editor']);
const MAX = 20;

/** A folder `me` may hand out: their own personal folder, or a team folder in a workspace they can edit. */
async function shareableFolder(db, me, folderId) {
  if (!UUID.test(String(folderId || ''))) return null;
  const f = (await db.query('SELECT id, name, owner_user_id, workspace_id, parent_id FROM storage_folders WHERE id = $1', [folderId])).rows[0];
  if (!f) return null;
  if (!f.workspace_id) return String(f.owner_user_id) === String(me.id) ? f : null;
  return (await check(db, { object: `workspace:${f.workspace_id}`, relation: 'editor', subject: `user:${me.id}` })).allowed ? f : null;
}

/** Where a folder is, as a path of names — the worker reads it ("My files / Weapons / Renders"). */
async function pathOf(db, folderId) {
  const names = [];
  let id = folderId;
  for (let i = 0; id && i < 32; i += 1) { const r = (await db.query('SELECT id, name, parent_id FROM storage_folders WHERE id = $1', [id])).rows[0]; if (!r) break; names.unshift(r.name); id = r.parent_id; }
  return names.join(' / ');
}

const view = async (db, r) => ({ id: String(r.folder_id), name: r.name, path: await pathOf(db, r.folder_id), role: r.role, team: !!r.workspace_id, url: `/workspace/storage/f/${r.folder_id}`, addedAt: r.created_at });

/** The folders a task names. Visible to anyone who can see the task — names and paths only; opening a folder is
 *  Storage's own check, which the link grants to whoever works the task. */
export async function listTaskFolders(db, me, key) {
  const t = await tasks.getTask(db, me, key);
  const rows = (await db.query(`SELECT tf.folder_id, tf.role, tf.created_at, f.name, f.workspace_id FROM task_folders tf JOIN storage_folders f ON f.id = tf.folder_id
     WHERE tf.task_id = $1 ORDER BY tf.created_at`, [t.id])).rows;
  const out = []; for (const r of rows) out.push(await view(db, r));
  return out;
}

/** Owners whose folders a task links — the accounts to reconcile when the task's people or status change. */
async function owners(db, taskId) {
  return (await db.query(`SELECT DISTINCT f.owner_user_id FROM task_folders tf JOIN storage_folders f ON f.id = tf.folder_id AND f.workspace_id IS NULL WHERE tf.task_id = $1`, [taskId])).rows.map((r) => r.owner_user_id);
}
/** Make folder access match the task again (call after assignee/delegate/reviewer/status change). Cheap when none. */
export async function reconcileTask(db, taskId) {
  for (const o of await owners(db, taskId)) await reconcileShares(db, o);
}

export async function addTaskFolder(db, me, key, { folderId, role = 'viewer' } = {}) {
  const t = await tasks.getTask(db, me, key);
  if (!t.can || !t.can.work) throw new TaskFolderError(tasks.NOT_YOURS, 'not_your_task', 403);   // owner, 2026-10-23: only whoever works it
  if (!ROLES.has(role)) throw new TaskFolderError('role is viewer or editor', 'invalid_role');
  const f = await shareableFolder(db, me, folderId);
  if (!f) throw new TaskFolderError('Folder not found, or not yours to share', 'folder_not_found', 404);
  const n = (await db.query('SELECT count(*)::int AS n FROM task_folders WHERE task_id = $1', [t.id])).rows[0].n;
  if (n >= MAX) throw new TaskFolderError(`A task names at most ${MAX} folders`, 'too_many_folders', 409);
  await db.query(`INSERT INTO task_folders (task_id, folder_id, role, added_by) VALUES ($1, $2, $3, $4)
    ON CONFLICT (task_id, folder_id) DO UPDATE SET role = EXCLUDED.role`, [t.id, f.id, role, me.id]);
  if (!f.workspace_id) await reconcileShares(db, f.owner_user_id);
  return listTaskFolders(db, me, key);
}

export async function removeTaskFolder(db, me, key, folderId) {
  const t = await tasks.getTask(db, me, key);
  if (!t.can || !t.can.work) throw new TaskFolderError(tasks.NOT_YOURS, 'not_your_task', 403);   // owner, 2026-10-23: only whoever works it
  const r = (await db.query(`DELETE FROM task_folders tf USING storage_folders f WHERE tf.task_id = $1 AND tf.folder_id = $2 AND f.id = tf.folder_id RETURNING f.owner_user_id, f.workspace_id`, [t.id, folderId])).rows[0];
  if (!r) throw new TaskFolderError('That folder is not on this task', 'not_linked', 404);
  if (!r.workspace_id) await reconcileShares(db, r.owner_user_id);
  return listTaskFolders(db, me, key);
}

/** Folders `me` can link: their own and their teams' — for the #folder picker. `q` narrows by name. */
export async function linkableFolders(db, me, { q = '' } = {}) {
  const like = '%' + String(q || '').toLowerCase().replace(/[%_]/g, '') + '%';
  const rows = (await db.query(`SELECT f.id, f.name, f.workspace_id, w.name AS team FROM storage_folders f LEFT JOIN workspaces w ON w.id = f.workspace_id
     WHERE lower(f.name) LIKE $2 AND (
       (f.workspace_id IS NULL AND f.owner_user_id = $1)
       OR (f.workspace_id IS NOT NULL AND (w.owner_user_id = $1 OR EXISTS (SELECT 1 FROM relationship_tuples t WHERE t.object_type = 'workspace' AND t.object_id = f.workspace_id::text
            AND t.subject_type = 'user' AND t.subject_id = $1::text AND t.relation IN ('owner', 'admin', 'editor')))))
     ORDER BY lower(f.name) LIMIT 50`, [me.id, like])).rows;
  const out = []; for (const r of rows) out.push({ id: String(r.id), name: r.name, path: await pathOf(db, r.id), team: r.team || null });
  return out;
}
