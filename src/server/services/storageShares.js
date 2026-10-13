/**
 * XENO Storage (codename Arca): SHARING one file. Spec: `XENO STORAGE - SPEC.md` section 7.2.
 *
 * Two ways, both read-only, both given only by the file's OWNER, both revocable at once:
 *   person  another XENO account, named by email or username. The access is a `viewer` relationship tuple on
 *           the file, so every existing read path (the Library list, the content route) honours it with no
 *           second permission system. The file then appears under "Shared with me" for that person.
 *   link    a secret link anyone can open. 256 bits of randomness; only its SHA-256 is stored. It can expire.
 *
 * A link serves the bytes through the same streamer the owner uses, so its rules hold: a file still in its
 * security scan is not served, and only plain images are shown inline (everything else downloads).
 */
import crypto from 'node:crypto';
import { check, writeTuples } from '../utils/authzReBAC.js';

const isId = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const MAX_DAYS = 365;

async function ownedFile(db, userId, fileId) {
  if (!isId(fileId) || !isId(userId)) return null;
  const { rows } = await db.query(`SELECT id, original_name, filename, workspace_id FROM user_files WHERE id = $1 AND deleted_at IS NULL AND storage_type = 'platform-upload'`, [fileId]);
  if (!rows[0]) return null;
  const owner = await check(db, { object: `library_asset:${fileId}`, relation: 'owner', subject: `user:${userId}` });
  return owner.allowed ? rows[0] : null;
}
const view = (r) => ({ id: r.id, kind: r.kind, createdAt: r.created_at, expiresAt: r.expires_at, ...(r.kind === 'person' ? { person: { id: r.grantee_user_id, name: r.display_name || r.username, username: r.username } } : {}) });

/** Everyone a file is shared with, and its live links (never the link itself: it is shown once, when made). */
export async function listShares(db, userId, fileId) {
  if (!(await ownedFile(db, userId, fileId))) return { notFound: true };
  const { rows } = await db.query(
    `SELECT s.*, u.username, u.display_name FROM storage_shares s LEFT JOIN users u ON u.id = s.grantee_user_id
      WHERE s.file_id = $1 AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now()) ORDER BY s.created_at`, [fileId]);
  return { ok: true, shares: rows.map(view) };
}

/** Give one account read access. `who` is an email address or a username. */
export async function shareWithPerson(db, userId, fileId, who) {
  if (!(await ownedFile(db, userId, fileId))) return { notFound: true };
  const key = String(who || '').trim().toLowerCase().replace(/^@/, '');
  if (!key || key.length > 254) return { invalid: true, code: 'invalid_person' };
  const person = (await db.query(`SELECT id, username, display_name FROM users WHERE is_active = true AND (lower(email) = $1 OR lower(username) = $1) LIMIT 1`, [key])).rows[0];
  // the same answer whether or not the account exists would hide a typo from the owner; XENO accounts are
  // already findable by username, so this says so plainly
  if (!person) return { notFound: true, code: 'person_not_found' };
  if (person.id === userId) return { invalid: true, code: 'own_file' };
  const existing = (await db.query(`SELECT * FROM storage_shares WHERE file_id = $1 AND grantee_user_id = $2 AND kind = 'person' AND revoked_at IS NULL`, [fileId, person.id])).rows[0];
  const row = existing || (await db.query(`INSERT INTO storage_shares (file_id, owner_user_id, kind, grantee_user_id) VALUES ($1, $2, 'person', $3) RETURNING *`, [fileId, userId, person.id])).rows[0];
  await writeTuples(db, { writes: [{ object: `library_asset:${fileId}`, relation: 'viewer', subject: `user:${person.id}` }] });
  return { ok: true, share: view({ ...row, username: person.username, display_name: person.display_name }) };
}

/** Make a secret link. The token is returned ONCE; only its hash is kept. */
export async function createLink(db, userId, fileId, { expiresInDays = null } = {}) {
  if (!(await ownedFile(db, userId, fileId))) return { notFound: true };
  let expires = null;
  if (expiresInDays !== null && expiresInDays !== undefined) { const days = Number(expiresInDays); if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return { invalid: true, code: 'invalid_expiry' }; expires = new Date(Date.now() + days * 86400000); }
  const token = crypto.randomBytes(32).toString('base64url');
  const row = (await db.query(`INSERT INTO storage_shares (file_id, owner_user_id, kind, token_sha256, expires_at) VALUES ($1, $2, 'link', $3, $4) RETURNING *`, [fileId, userId, hash(token), expires])).rows[0];
  return { ok: true, share: view(row), token };
}

/** Take a share back. A person loses the file at once; a link stops working at once. */
export async function revokeShare(db, userId, shareId) {
  if (!isId(shareId)) return { notFound: true };
  const row = (await db.query(`UPDATE storage_shares SET revoked_at = now() WHERE id = $1 AND owner_user_id = $2 AND revoked_at IS NULL RETURNING *`, [shareId, userId])).rows[0];
  if (!row) return { notFound: true };
  if (row.kind === 'person') await writeTuples(db, { deletes: [{ object: `library_asset:${row.file_id}`, relation: 'viewer', subject: `user:${row.grantee_user_id}` }] });
  return { ok: true };
}

/** The file a live link opens, or null. The owner must still be an active account. */
export async function fileForLink(db, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { rows } = await db.query(
    `SELECT f.id, f.original_name, f.filename, f.mime_type, f.file_size, f.storage_path,
            EXISTS (SELECT 1 FROM library_asset_ingestions i WHERE i.asset_id = f.id AND i.state IN ('ready','unsupported')) AS ingestion_safe
       FROM storage_shares s JOIN user_files f ON f.id = s.file_id JOIN users u ON u.id = s.owner_user_id
      WHERE s.token_sha256 = $1 AND s.kind = 'link' AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now())
        AND f.deleted_at IS NULL AND f.storage_type = 'platform-upload' AND u.is_active = true`, [hash(token)]);
  return rows[0] || null;
}
