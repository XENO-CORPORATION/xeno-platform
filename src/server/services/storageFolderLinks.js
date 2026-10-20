/**
 * XENO Storage (codename Arca): a FOLDER shared by a link that REQUIRES SIGN-IN.
 *
 * Owner request 2026-10-20: share a folder with people outside the workspace (an investor reading a deck) through
 * one link that can be printed on a slide, where opening it means signing in to, or creating, a XENO account.
 * Nothing about the folder is public: the link alone shows a sign-in page that names nothing but "a folder".
 *
 * How it differs from the two shares that already exist (storageShares.js):
 *   - a person share names one account up front; this link names nobody, so it can go to someone not yet signed up;
 *   - a file link is a bearer capability (anyone holding it gets the bytes); this one is NOT: the bytes need a live
 *     account session as well as the link, and every open and download is recorded against that account.
 *
 * ACCESS IS TUPLES, like every other share (Storage rule 5). Opening a live link while signed in ADMITS that
 * account: a `person` viewer share on the folder, marked `via_link_id`, carrying the link's expiry, after which
 * `reconcileShares(owner)` writes the viewer tuples. Every listing and every byte checks those tuples, AND the link is
 * checked on every request too (live, not expired, owner still active, folder still the owner's). Revoking the link
 * revokes every share made through it and reconciles, so access stops at once. The owner can also remove one admitted
 * person; that person is then refused by the link from then on. The viewer is read-only: they list the folder (and the folders inside it) and
 * download files; they can never rename, move, delete or reshare. Only the token's SHA-256 is stored.
 *
 * Addresses: /storage/shared/<token>, a folder inside it /storage/shared/<token>/f/<folder id>, a file
 * /storage/shared/<token>/files/<file id>. Ids, never names, with the shared folder as the parent of everything.
 */
import crypto from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { reconcileShares, sharedFolderAccess } from './storageShares.js';

const isId = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const isLinkToken = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const MAX_DAYS = 365;
const LIVE = 'l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > now())';
const view = (r) => ({ id: r.id, kind: 'signin-link', folderId: r.folder_id, label: r.label || null, createdAt: r.created_at, expiresAt: r.expires_at, revokedAt: r.revoked_at || null, opens: Number(r.opens || 0), viewers: Number(r.viewers || 0) });

async function ownedPersonalFolder(db, userId, folderId) {
  if (!isId(folderId) || !isId(userId)) return null;
  return (await db.query('SELECT id, name FROM storage_folders WHERE id = $1 AND owner_user_id = $2 AND workspace_id IS NULL', [folderId, userId])).rows[0] || null;
}

/** Make a sign-in link to a personal folder the caller owns. The token is returned ONCE. */
export async function createFolderLink(db, userId, folderId, { expiresInDays = null, label = null } = {}) {
  if (!(await ownedPersonalFolder(db, userId, folderId))) return { notFound: true };
  let expires = null;
  if (expiresInDays !== null && expiresInDays !== undefined && expiresInDays !== '') {
    const days = Number(expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return { invalid: true, code: 'invalid_expiry' };
    expires = new Date(Date.now() + days * 86400000);
  }
  const name = label === null || label === undefined ? null : String(label).trim().slice(0, 120) || null;
  const token = crypto.randomBytes(32).toString('base64url');
  const row = (await db.query(
    `INSERT INTO storage_folder_links (folder_id, owner_user_id, token_sha256, label, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [folderId, userId, hash(token), name, expires])).rows[0];
  return { ok: true, link: view(row), token };
}

/** The live links of one folder, with how often and by how many people each was opened. */
export async function listFolderLinks(db, userId, folderId) {
  if (!(await ownedPersonalFolder(db, userId, folderId))) return { notFound: true };
  const { rows } = await db.query(
    `SELECT l.*, (SELECT count(*) FROM storage_folder_link_events e WHERE e.link_id = l.id AND e.event = 'open') AS opens,
            (SELECT count(DISTINCT e.user_id) FROM storage_folder_link_events e WHERE e.link_id = l.id) AS viewers
       FROM storage_folder_links l WHERE l.folder_id = $1 AND l.owner_user_id = $2 AND ${LIVE} ORDER BY l.created_at`, [folderId, userId]);
  return { ok: true, links: rows.map(view) };
}

/** Who opened a link and what they downloaded: the owner's audit, newest first. */
export async function folderLinkActivity(db, userId, linkId) {
  if (!isId(linkId) || !isId(userId)) return { notFound: true };
  const link = (await db.query('SELECT * FROM storage_folder_links WHERE id = $1 AND owner_user_id = $2', [linkId, userId])).rows[0];
  if (!link) return { notFound: true };
  const { rows } = await db.query(
    `SELECT e.event, e.at, e.file_id, f.original_name AS file_name, u.id AS user_id, u.username, u.display_name, u.email
       FROM storage_folder_link_events e JOIN users u ON u.id = e.user_id LEFT JOIN user_files f ON f.id = e.file_id
      WHERE e.link_id = $1 ORDER BY e.at DESC LIMIT 500`, [linkId]);
  return { ok: true, link: view(link), events: rows.map((r) => ({ event: r.event, at: r.at, file: r.file_id ? { id: r.file_id, name: r.file_name } : null, person: { id: r.user_id, name: r.display_name || r.username, username: r.username, email: r.email } })) };
}

/** Turn a link off, and take back every share it admitted. Every request after this is refused, signed in or not. */
export async function revokeFolderLink(db, userId, linkId) {
  if (!isId(linkId) || !isId(userId)) return { notFound: true };
  const row = (await db.query('UPDATE storage_folder_links SET revoked_at = now() WHERE id = $1 AND owner_user_id = $2 AND revoked_at IS NULL RETURNING id', [linkId, userId])).rows[0];
  if (!row) return { notFound: true };
  await db.query('UPDATE storage_shares SET revoked_at = now() WHERE via_link_id = $1 AND revoked_at IS NULL', [linkId]);
  await reconcileShares(db, userId);
  return { ok: true };
}

/**
 * Let a signed-in account in through a live link: a viewer share on the folder, then reconcile. Returns
 * { ok: true } when the account can now read the folder, { refused: true } when the owner removed this person
 * from this link (they are not let back in by it). The owner is always in.
 */
export async function admitThroughLink(db, link, userId) {
  if (!link || !isId(userId)) return { refused: true };
  if (userId === link.owner_user_id) return { ok: true, owner: true };
  const removed = (await db.query(`SELECT 1 FROM storage_shares WHERE via_link_id = $1 AND grantee_user_id = $2 AND revoked_at IS NOT NULL LIMIT 1`, [link.id, userId])).rows[0];
  if (removed) return { refused: true };
  const live = (await db.query(`SELECT 1 FROM storage_shares WHERE folder_id = $1 AND grantee_user_id = $2 AND kind = 'person' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`, [link.folder_id, userId])).rows[0];
  if (!live) {
    await db.query(`INSERT INTO storage_shares (folder_id, owner_user_id, kind, grantee_user_id, role, via_link_id, expires_at)
      VALUES ($1, $2, 'person', $3, 'viewer', $4, $5) ON CONFLICT DO NOTHING`, [link.folder_id, link.owner_user_id, userId, link.id, link.expires_at || null]);
    await reconcileShares(db, link.owner_user_id);
  }
  return (await sharedFolderAccess(db, userId, link.folder_id)) ? { ok: true } : { refused: true };
}

/** May this account read this folder? The owner, or a folder share's tuples (storage_access, written by reconcileShares). */
export async function canReadFolder(db, link, userId, folderId) {
  if (userId === link.owner_user_id) return true;
  return Boolean(await sharedFolderAccess(db, userId, folderId));
}

/** The live link a token opens, with its folder, or null. Owner active, folder still theirs and personal. */
export async function resolveFolderLink(db, token) {
  if (!isLinkToken(token)) return null;
  const { rows } = await db.query(
    `SELECT l.id, l.folder_id, l.owner_user_id, l.label, l.expires_at, sf.name AS folder_name, u.display_name, u.username
       FROM storage_folder_links l
       JOIN storage_folders sf ON sf.id = l.folder_id AND sf.owner_user_id = l.owner_user_id AND sf.workspace_id IS NULL
       JOIN users u ON u.id = l.owner_user_id AND u.is_active = true
      WHERE l.token_sha256 = $1 AND ${LIVE}`, [hash(token)]);
  return rows[0] || null;
}

/** Is `folderId` the link's folder or one inside it? Walks UP from the folder, bounded. */
export async function folderInLink(db, link, folderId) {
  if (!link || !isId(folderId)) return false;
  if (folderId === link.folder_id) return true;
  const { rows } = await db.query(
    `WITH RECURSIVE up AS (SELECT id, parent_id, 0 AS depth FROM storage_folders WHERE id = $1 AND owner_user_id = $2
       UNION ALL SELECT p.id, p.parent_id, up.depth + 1 FROM storage_folders p JOIN up ON p.id = up.parent_id WHERE up.depth < 64)
     SELECT 1 FROM up WHERE id = $3 LIMIT 1`, [folderId, link.owner_user_id, link.folder_id]);
  return rows.length > 0;
}

/** One folder's contents as the link's viewer sees them, plus the way down from the shared folder. */
export async function listLinkFolder(db, link, folderId) {
  const at = folderId || link.folder_id;
  if (!(await folderInLink(db, link, at))) return null;
  const folders = (await db.query('SELECT id, name FROM storage_folders WHERE parent_id = $1 AND owner_user_id = $2 ORDER BY lower(name)', [at, link.owner_user_id])).rows;
  const files = (await db.query(
    `SELECT f.id, f.original_name, f.filename, f.mime_type, f.file_size, f.created_at
       FROM storage_item_folders i JOIN user_files f ON f.id = i.source_id
      WHERE i.source = 'file' AND i.folder_id = $1 AND f.deleted_at IS NULL AND f.storage_type = 'platform-upload'
      ORDER BY lower(coalesce(f.original_name, f.filename))`, [at])).rows;
  const path = [];
  let cursor = at;
  for (let i = 0; i < 64 && cursor; i += 1) {
    const row = (await db.query('SELECT id, name, parent_id FROM storage_folders WHERE id = $1', [cursor])).rows[0];
    if (!row) break;
    path.unshift({ id: row.id, name: row.name });
    if (row.id === link.folder_id) break;
    cursor = row.parent_id;
  }
  return { folderId: at, folders, files, path };
}

/** A file the link's viewer may download, with what the streamer needs, or null. */
export async function fileInLink(db, link, fileId) {
  if (!link || !isId(fileId)) return null;
  const row = (await db.query(
    `SELECT f.id, f.file_id, f.original_name, f.filename, f.mime_type, f.file_size, f.storage_path, f.storage_type, f.user_id, i.folder_id,
            EXISTS (SELECT 1 FROM library_asset_ingestions g WHERE g.asset_id = f.id AND g.state IN ('ready','unsupported')) AS ingestion_safe
       FROM user_files f JOIN storage_item_folders i ON i.source = 'file' AND i.source_id = f.id
      WHERE f.id = $1 AND f.deleted_at IS NULL AND f.storage_type = 'platform-upload'`, [fileId])).rows[0];
  if (!row || !(await folderInLink(db, link, row.folder_id))) return null;
  return row;
}

/** fileInLink, AND the account holds the viewer tuple on the file (or owns it). */
export async function readableFileInLink(db, link, userId, fileId) {
  const row = await fileInLink(db, link, fileId);
  if (!row) return null;
  if (userId === link.owner_user_id) return row;
  const viewer = await check(db, { object: `library_asset:${row.id}`, relation: 'viewer', subject: `user:${userId}` });
  return viewer.allowed ? row : null;
}

/** The audit trail: who (an account, always) did what through which link. */
export async function recordLinkEvent(db, link, userId, event, fileId = null) {
  if (!link || !isId(userId)) return;
  await db.query('INSERT INTO storage_folder_link_events (link_id, user_id, event, file_id) VALUES ($1, $2, $3, $4)', [link.id, userId, event, fileId]);
}
