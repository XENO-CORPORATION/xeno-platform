/**
 * XENO Storage (codename Arca): SHARING. Spec: `xeno-storage/SPEC.md` §7.2.
 *
 * What can be shared, by its OWNER only, revocable at once:
 *   a file   with a person (can view, or can edit) or by a secret link (view only, may expire)
 *   a folder with a person (can view, or can edit): everything in it, and in the folders inside it, now and later
 *   a folder with a TASK (task_folders): the same, for whoever works the task, while it is open
 *
 * "Can edit" on a file means: rename it and upload a new version. It never means delete, share or move.
 *
 * HOW ACCESS IS HELD. Every read path already asks the relationship tuples (the Library list, the content
 * route), so a share becomes tuples: `viewer` or `editor` on each file. A folder share is the same thing
 * worked out for every file under the folder. `reconcileShares(owner)` computes what SHOULD hold from the live
 * share rows and the folder tree, compares it with what this module granted before (`storage_access`), and
 * writes only the difference. It runs after anything that can change the answer: a share made or removed, an
 * item or a folder moved, a new version. One function, so no path can forget a case.
 *
 * A link is 256 bits of randomness; only its SHA-256 is stored. It serves the bytes through the same streamer
 * the owner uses: a file still in its security scan is not served, and only plain images are shown inline.
 */
import crypto from 'node:crypto';
import { check, writeTuples } from '../utils/authzReBAC.js';

const isId = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const MAX_DAYS = 365;
const ROLES = ['viewer', 'editor'];
const LIVE = `s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now())`;

async function ownedFile(db, userId, fileId) {
  if (!isId(fileId) || !isId(userId)) return null;
  const { rows } = await db.query(`SELECT id, original_name, filename, workspace_id FROM user_files WHERE id = $1 AND deleted_at IS NULL AND storage_type = 'platform-upload'`, [fileId]);
  if (!rows[0]) return null;
  const owner = await check(db, { object: `library_asset:${fileId}`, relation: 'owner', subject: `user:${userId}` });
  return owner.allowed ? rows[0] : null;
}
/** A personal folder the caller owns. Team folders are shared by workspace membership, not here. */
async function ownedFolder(db, userId, folderId) {
  if (!isId(folderId) || !isId(userId)) return null;
  return (await db.query('SELECT id, name FROM storage_folders WHERE id = $1 AND owner_user_id = $2 AND workspace_id IS NULL', [folderId, userId])).rows[0] || null;
}
const target = async (db, userId, { fileId, folderId }) => (folderId ? ((await ownedFolder(db, userId, folderId)) ? { column: 'folder_id', id: folderId } : null) : ((await ownedFile(db, userId, fileId)) ? { column: 'file_id', id: fileId } : null));
const view = (r) => ({ id: r.id, kind: r.kind, role: r.role || 'viewer', createdAt: r.created_at, expiresAt: r.expires_at, ...(r.kind === 'person' ? { person: { id: r.grantee_user_id, name: r.display_name || r.username, username: r.username } } : {}) });

/**
 * Make the tuples match the shares for everything one account owns. Safe to call at any time, any number of
 * times; it changes only what differs.
 */
export async function reconcileShares(db, ownerUserId) {
  if (!isId(ownerUserId)) return { added: 0, removed: 0 };
  // every folder reached by a live folder share, with the strongest role given to each person
  const folders = (await db.query(
    `WITH RECURSIVE tree AS (
       SELECT s.folder_id AS id, s.grantee_user_id AS user_id, s.role, 0 AS depth FROM storage_shares s
        WHERE s.owner_user_id = $1 AND s.kind = 'person' AND s.folder_id IS NOT NULL AND ${LIVE}
       UNION ALL
       -- a folder linked to a task: whoever works the task (assignee, delegate, reviewer) may open it while the
       -- link stands and the task is open (task_folders, 20261016120000). Closing the task or removing the link
       -- takes it away on the next reconcile.
       SELECT tf.folder_id, w.user_id, tf.role, 0 FROM task_folders tf
         JOIN storage_folders sf ON sf.id = tf.folder_id AND sf.owner_user_id = $1 AND sf.workspace_id IS NULL
         JOIN tasks t ON t.id = tf.task_id AND t.deleted_at IS NULL AND t.status NOT IN ('done', 'wont_do')
         CROSS JOIN LATERAL (VALUES (t.assignee_id), (t.delegate_id), (t.reviewer_id)) AS w(user_id)
        WHERE w.user_id IS NOT NULL AND w.user_id <> $1
       UNION ALL
       -- a personal project's own folder (project_folders, app 'projects'; services/chatProjectFolders.js): the people
       -- the owner put on the project may open it, editors and admins to change files, viewers and reviewers to read.
       -- Removing someone from the project, or deleting the project, takes it away on the next reconcile.
       SELECT pf.folder_id, rt.subject_id::uuid, CASE WHEN rt.relation IN ('editor', 'admin') THEN 'editor' ELSE 'viewer' END, 0
         FROM project_folders pf
         JOIN storage_folders sf ON sf.id = pf.folder_id AND sf.owner_user_id = $1 AND sf.workspace_id IS NULL
         JOIN chat_projects cp ON cp.id = pf.project_id AND cp.owner_user_id = $1
         JOIN relationship_tuples rt ON rt.object_type = 'project' AND rt.object_id = cp.id::text AND rt.subject_type = 'user'
          AND rt.relation IN ('viewer', 'reviewer', 'editor', 'admin')
          AND rt.subject_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND rt.subject_id <> $1::text
        WHERE pf.app = 'projects'
       UNION ALL SELECT c.id, tree.user_id, tree.role, tree.depth + 1 FROM storage_folders c JOIN tree ON c.parent_id = tree.id WHERE tree.depth < 64)
     SELECT id, user_id, MAX(CASE role WHEN 'editor' THEN 2 ELSE 1 END) AS rank FROM tree GROUP BY id, user_id`, [ownerUserId])).rows;
  const want = new Map();   // "kind|target|user" -> role
  const put = (kind, id, user, rank) => { const k = `${kind}|${id}|${user}`; if ((want.get(k) || 0) < rank) want.set(k, rank); };
  for (const f of folders) put('folder', f.id, f.user_id, Number(f.rank));
  const direct = (await db.query(`SELECT s.file_id AS id, s.grantee_user_id AS user_id, s.role FROM storage_shares s JOIN user_files f ON f.id = s.file_id AND f.deleted_at IS NULL WHERE s.owner_user_id = $1 AND s.kind = 'person' AND s.file_id IS NOT NULL AND ${LIVE}`, [ownerUserId])).rows;   // a file deleted for good is shared with nobody
  for (const d of direct) put('file', d.id, d.user_id, d.role === 'editor' ? 2 : 1);
  if (folders.length) {
    const inside = (await db.query(`SELECT i.source_id AS id, i.folder_id FROM storage_item_folders i WHERE i.source = 'file' AND i.folder_id = ANY($1::uuid[])`, [[...new Set(folders.map((f) => f.id))]])).rows;
    const byFolder = new Map(); for (const f of folders) (byFolder.get(f.id) || byFolder.set(f.id, []).get(f.id)).push(f);
    for (const item of inside) for (const f of byFolder.get(item.folder_id) || []) put('file', item.id, f.user_id, Number(f.rank));
  }
  const have = (await db.query('SELECT kind, target_id, user_id, role FROM storage_access WHERE owner_user_id = $1', [ownerUserId])).rows;
  const had = new Map(have.map((r) => [`${r.kind}|${r.target_id}|${r.user_id}`, r.role === 'editor' ? 2 : 1]));
  const writes = [], deletes = []; let added = 0, removed = 0;
  const role = (rank) => (rank === 2 ? 'editor' : 'viewer');
  for (const [key, rank] of want) {
    if (had.get(key) === rank) continue;
    const [kind, id, user] = key.split('|');
    await db.query(`INSERT INTO storage_access (kind, target_id, user_id, role, owner_user_id) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (kind, target_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [kind, id, user, role(rank), ownerUserId]);
    if (kind === 'file') {
      writes.push({ object: `library_asset:${id}`, relation: 'viewer', subject: `user:${user}` });
      if (rank === 2) writes.push({ object: `library_asset:${id}`, relation: 'editor', subject: `user:${user}` });
      else if (had.get(key) === 2) deletes.push({ object: `library_asset:${id}`, relation: 'editor', subject: `user:${user}` });
    }
    added += 1;
  }
  for (const [key, rank] of had) {
    if (want.has(key)) continue;
    const [kind, id, user] = key.split('|');
    await db.query('DELETE FROM storage_access WHERE kind = $1 AND target_id = $2 AND user_id = $3', [kind, id, user]);
    if (kind === 'file') { deletes.push({ object: `library_asset:${id}`, relation: 'viewer', subject: `user:${user}` }); if (rank === 2) deletes.push({ object: `library_asset:${id}`, relation: 'editor', subject: `user:${user}` }); }
    removed += 1;
  }
  if (writes.length || deletes.length) await writeTuples(db, { writes, deletes });
  return { added, removed };
}

/** Everyone a file or folder is shared with, and a file's live links (never the link itself: it is shown once). */
export async function listShares(db, userId, where) {
  const t = await target(db, userId, where);
  if (!t) return { notFound: true };
  const { rows } = await db.query(
    `SELECT s.*, u.username, u.display_name FROM storage_shares s LEFT JOIN users u ON u.id = s.grantee_user_id
      WHERE s.${t.column} = $1 AND ${LIVE} ORDER BY s.created_at`, [t.id]);
  return { ok: true, shares: rows.map(view) };
}

/** Give one account access to a file or a folder. `who` is an email address or a username. */
export async function shareWithPerson(db, userId, where, who, role = 'viewer') {
  const t = await target(db, userId, where);
  if (!t) return { notFound: true };
  if (!ROLES.includes(role)) return { invalid: true, code: 'invalid_role' };
  const key = String(who || '').trim().toLowerCase().replace(/^@/, '');
  if (!key || key.length > 254) return { invalid: true, code: 'invalid_person' };
  const person = (await db.query(`SELECT id, username, display_name FROM users WHERE is_active = true AND (lower(email) = $1 OR lower(username) = $1) LIMIT 1`, [key])).rows[0];
  // XENO accounts are already findable by username, so a typo is said plainly rather than hidden
  if (!person) return { notFound: true, code: 'person_not_found' };
  if (person.id === userId) return { invalid: true, code: 'own_file' };
  const existing = (await db.query(`SELECT * FROM storage_shares s WHERE s.${t.column} = $1 AND s.grantee_user_id = $2 AND s.kind = 'person' AND s.revoked_at IS NULL`, [t.id, person.id])).rows[0];
  const row = existing
    ? (await db.query('UPDATE storage_shares SET role = $2 WHERE id = $1 RETURNING *', [existing.id, role])).rows[0]
    : (await db.query(`INSERT INTO storage_shares (${t.column}, owner_user_id, kind, grantee_user_id, role) VALUES ($1, $2, 'person', $3, $4) RETURNING *`, [t.id, userId, person.id, role])).rows[0];
  await reconcileShares(db, userId);
  return { ok: true, share: view({ ...row, username: person.username, display_name: person.display_name }) };
}

/** Make a secret link to a FILE. The token is returned ONCE; only its hash is kept. */
export async function createLink(db, userId, fileId, { expiresInDays = null } = {}) {
  if (!(await ownedFile(db, userId, fileId))) return { notFound: true };
  let expires = null;
  if (expiresInDays !== null && expiresInDays !== undefined) { const days = Number(expiresInDays); if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return { invalid: true, code: 'invalid_expiry' }; expires = new Date(Date.now() + days * 86400000); }
  const token = crypto.randomBytes(32).toString('base64url');
  const row = (await db.query(`INSERT INTO storage_shares (file_id, owner_user_id, kind, token_sha256, expires_at) VALUES ($1, $2, 'link', $3, $4) RETURNING *`, [fileId, userId, hash(token), expires])).rows[0];
  return { ok: true, share: view(row), token };
}

/** Take a share back. A person loses access at once; a link stops working at once. */
export async function revokeShare(db, userId, shareId) {
  if (!isId(shareId)) return { notFound: true };
  const row = (await db.query(`UPDATE storage_shares SET revoked_at = now() WHERE id = $1 AND owner_user_id = $2 AND revoked_at IS NULL RETURNING *`, [shareId, userId])).rows[0];
  if (!row) return { notFound: true };
  if (row.kind === 'person') await reconcileShares(db, userId);
  return { ok: true };
}

/** The folders shared with this person, top-most only (a folder inside a shared folder is reached through it). */
export async function foldersSharedWith(db, userId) {
  const { rows } = await db.query(
    `SELECT f.id, f.name, f.parent_id, a.role, u.username, u.display_name FROM storage_access a
       JOIN storage_folders f ON f.id = a.target_id JOIN users u ON u.id = f.owner_user_id
      WHERE a.kind = 'folder' AND a.user_id = $1
        AND NOT EXISTS (SELECT 1 FROM storage_access p WHERE p.kind = 'folder' AND p.user_id = $1 AND p.target_id = f.parent_id)
      ORDER BY lower(f.name)`, [userId]);
  return rows.map((r) => ({ id: r.id, name: r.name, role: r.role, owner: r.display_name || r.username, items: 0, folders: 0 }));
}

/** What a folder share lets this person do in a folder: 'edit', 'view' or null. */
export async function sharedFolderAccess(db, userId, folderId) {
  const row = (await db.query(`SELECT role FROM storage_access WHERE kind = 'folder' AND target_id = $1 AND user_id = $2`, [folderId, userId])).rows[0];
  return row ? (row.role === 'editor' ? 'edit' : 'view') : null;
}

/** The file a live link opens, or null. The owner must still be an active account. */
export async function fileForLink(db, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { rows } = await db.query(
    `SELECT f.id, f.original_name, f.filename, f.mime_type, f.file_size, f.storage_path,
            EXISTS (SELECT 1 FROM library_asset_ingestions i WHERE i.asset_id = f.id AND i.state IN ('ready','unsupported')) AS ingestion_safe
       FROM storage_shares s JOIN user_files f ON f.id = s.file_id JOIN users u ON u.id = s.owner_user_id
      WHERE s.token_sha256 = $1 AND s.kind = 'link' AND ${LIVE}
        AND f.deleted_at IS NULL AND f.storage_type = 'platform-upload' AND u.is_active = true`, [hash(token)]);
  return rows[0] || null;
}
