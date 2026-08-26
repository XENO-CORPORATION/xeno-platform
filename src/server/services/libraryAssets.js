import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNATURE_VERSION = 'v1';
const DEFAULT_LINK_TTL_SECONDS = 24 * 60 * 60;
const MAX_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

const signingSecret = () => {
  const secret = process.env.LIBRARY_CONTENT_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('LIBRARY_CONTENT_SECRET or JWT_SECRET is required for signed Library links');
  return secret;
};

const signaturePayload = ({ assetId, userId, expires, download }) =>
  [SIGNATURE_VERSION, assetId, userId, String(expires), download ? '1' : '0'].join(':');

const sign = (payload) => crypto.createHmac('sha256', signingSecret()).update(payload).digest('hex');

export function isLibraryUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function createSignedLibraryContentPath({ assetId, userId, ttlSeconds, download = false }) {
  if (!isLibraryUuid(assetId) || !isLibraryUuid(userId)) throw new Error('Library link ids must be UUIDs');
  const ttl = Math.min(Math.max(Number(ttlSeconds) || DEFAULT_LINK_TTL_SECONDS, 60), MAX_LINK_TTL_SECONDS);
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const payload = signaturePayload({ assetId, userId, expires, download });
  const params = new URLSearchParams({
    v: SIGNATURE_VERSION,
    uid: userId,
    expires: String(expires),
    download: download ? '1' : '0',
    sig: sign(payload),
  });
  return `/api/library/assets/${assetId}/content?${params.toString()}`;
}

export function verifySignedLibraryContentRequest({ assetId, userId, expires, download, signature }) {
  if (!isLibraryUuid(assetId) || !isLibraryUuid(userId) || !/^\d{10,}$/.test(String(expires || ''))) return false;
  const expiresNumber = Number(expires);
  if (!Number.isSafeInteger(expiresNumber) || expiresNumber < Math.floor(Date.now() / 1000)) return false;
  if (expiresNumber > Math.floor(Date.now() / 1000) + MAX_LINK_TTL_SECONDS + 60) return false;
  if (!/^[a-f0-9]{64}$/i.test(String(signature || ''))) return false;
  const expected = sign(signaturePayload({ assetId, userId, expires: expiresNumber, download }));
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(String(signature), 'hex'));
}

export async function registerManagedLibraryFile(db, {
  userId,
  filename,
  originalName,
  mimeType,
  fileSize,
  storagePath,
  metadata = {},
}) {
  const { rows } = await db.query(
    `INSERT INTO user_files (
       user_id, filename, original_name, file_type, mime_type, file_size,
       storage_path, storage_type, metadata
     ) VALUES ($1, $2, $3, $4, $4, $5, $6, 'platform-upload', $7)
     RETURNING id, created_at`,
    [userId, filename, originalName, mimeType, fileSize, storagePath, metadata],
  );
  return rows[0];
}

export async function getManagedLibraryFile(db, assetId, userId) {
  if (!isLibraryUuid(assetId) || !isLibraryUuid(userId)) return null;
  const { rows } = await db.query(
    `SELECT id, original_name, filename, mime_type, file_size, storage_path
     FROM user_files
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       AND storage_type = 'platform-upload'`,
    [assetId, userId],
  );
  return rows[0] || null;
}

export function resolveManagedLibraryPath(storagePath) {
  const resolved = path.resolve(storagePath || '');
  const allowedRoots = [
    path.resolve(process.cwd(), 'src/server/uploads'),
    path.resolve(process.cwd(), 'uploads'),
  ];
  const allowed = allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
  if (!allowed || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  return resolved;
}

export async function assertOwnedLibraryAttachments(db, userId, attachments) {
  if (attachments == null) return;
  if (!Array.isArray(attachments)) {
    const error = new Error('Message attachments must be an array');
    error.code = 'invalid_attachments';
    throw error;
  }
  const ids = [...new Set(attachments.map((attachment) => attachment?.asset_id).filter(Boolean))];
  if (ids.some((id) => !isLibraryUuid(id))) {
    const error = new Error('Library attachment ids must be UUIDs');
    error.code = 'invalid_library_asset_id';
    throw error;
  }
  if (ids.length === 0) return;
  const { rows } = await db.query(
    `SELECT id FROM user_files
     WHERE user_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
    [userId, ids],
  );
  if (rows.length !== ids.length) {
    const error = new Error('One or more Library assets are unavailable');
    error.code = 'library_asset_not_found';
    throw error;
  }
}

export async function listLibraryItems(db, userId, params = {}) {
  const tab = ['all', 'images', 'files'].includes(String(params.tab)) ? String(params.tab) : 'all';
  const query = String(params.query || '').trim().slice(0, 200);
  const sort = ['updated', 'created', 'name', 'size'].includes(String(params.sort)) ? String(params.sort) : 'updated';
  const limit = Math.min(Math.max(parseInt(params.limit, 10) || 100, 1), 200);
  const offset = Math.max(parseInt(params.offset, 10) || 0, 0);
  const orderBy = {
    updated: 'updated_at DESC NULLS LAST, created_at DESC',
    created: 'created_at DESC NULLS LAST',
    name: 'name ASC, updated_at DESC NULLS LAST',
    size: 'size_bytes DESC NULLS LAST, updated_at DESC NULLS LAST',
  }[sort];
  const sql = `
    WITH library_items AS (
      SELECT 'artifact:' || a.id::text AS id, 'artifact'::text AS source, a.id AS source_id,
        a.title AS name, CASE WHEN a.kind = 'image' THEN 'images' ELSE 'files' END AS category,
        a.kind AS item_type, CASE a.kind WHEN 'html' THEN 'text/html' WHEN 'code' THEN 'text/plain'
          WHEN 'document' THEN 'text/plain' ELSE 'image/*' END AS mime_type,
        octet_length(a.content)::bigint AS size_bytes, a.preview_text AS description,
        CASE WHEN a.kind = 'image' AND (a.content LIKE 'https://%' OR a.content LIKE 'http://%' OR a.content LIKE '/%') THEN a.content ELSE NULL END AS preview_url,
        a.conversation_id, c.title AS conversation_title, a.created_at, a.updated_at
      FROM chat_artifacts a LEFT JOIN chat_conversations c ON c.id = a.conversation_id
      WHERE a.user_id = $1 AND a.is_archived = FALSE
      UNION ALL
      SELECT 'file:' || f.id::text, 'file'::text, f.id, COALESCE(NULLIF(f.original_name, ''), f.filename),
        CASE WHEN COALESCE(f.mime_type, f.file_type, '') LIKE 'image/%' THEN 'images' ELSE 'files' END,
        CASE WHEN COALESCE(f.mime_type, f.file_type, '') LIKE 'image/%' THEN 'image'
          WHEN COALESCE(f.mime_type, '') LIKE 'video/%' THEN 'video'
          WHEN COALESCE(f.mime_type, '') LIKE 'audio/%' THEN 'audio' ELSE 'file' END,
        COALESCE(f.mime_type, f.file_type, 'application/octet-stream'), f.file_size::bigint,
        COALESCE(f.metadata->>'description', f.metadata->>'prompt', ''),
        CASE WHEN f.storage_type = 'platform-upload' AND COALESCE(f.mime_type, f.file_type, '') LIKE 'image/%'
          THEN '/api/library/assets/' || f.id::text || '/content' ELSE NULL END,
        NULL::uuid, NULL::text, f.created_at AT TIME ZONE 'UTC', COALESCE(f.last_used_at, f.created_at) AT TIME ZONE 'UTC'
      FROM user_files f WHERE f.user_id = $1 AND f.deleted_at IS NULL
      UNION ALL
      SELECT 'generation:' || g.id::text || ':' || generated.ordinality::text, 'generation'::text, g.id,
        COALESCE(NULLIF(left(g.prompt, 96), ''), 'Generated image'), 'images'::text, 'image'::text, 'image/*'::text,
        NULL::bigint, g.prompt, CASE WHEN generated.url LIKE 'https://%' OR generated.url LIKE 'http://%' OR generated.url LIKE '/%' THEN generated.url ELSE NULL END,
        NULL::uuid, NULL::text, g.created_at AT TIME ZONE 'UTC', g.created_at AT TIME ZONE 'UTC'
      FROM image_generations g CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(g.image_urls) = 'array' THEN g.image_urls ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS generated(url, ordinality) WHERE g.user_id = $1
      UNION ALL
      SELECT 'image_asset:' || ia.id::text, 'image_asset'::text, ia.id, ia.name, 'images'::text, 'image'::text,
        COALESCE(NULLIF(ia.format, ''), 'image/*'), ia.file_size::bigint, COALESCE(ia.prompt, ''),
        CASE WHEN COALESCE(ia.thumbnail_url, ia.file_url) LIKE 'https://%' OR COALESCE(ia.thumbnail_url, ia.file_url) LIKE 'http://%'
          OR COALESCE(ia.thumbnail_url, ia.file_url) LIKE '/%' THEN COALESCE(ia.thumbnail_url, ia.file_url) ELSE NULL END,
        NULL::uuid, NULL::text, ia.created_at AT TIME ZONE 'UTC', ia.created_at AT TIME ZONE 'UTC'
      FROM image_assets ia WHERE ia.user_id = $1
    )
    SELECT * FROM library_items
    WHERE ($2 = 'all' OR category = $2)
      AND ($3 = '' OR name ILIKE '%' || $3 || '%' OR description ILIKE '%' || $3 || '%')
    ORDER BY ${orderBy} LIMIT $4 OFFSET $5`;
  const { rows } = await db.query(sql, [userId, tab, query, limit, offset]);
  return { items: rows, tab, sort, limit, offset };
}

export async function deleteLibraryItem(db, userId, source, id) {
  if (!isLibraryUuid(id)) return { invalid: true };
  if (source === 'artifact') return db.query('DELETE FROM chat_artifacts WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
  if (source === 'file') return db.query('UPDATE user_files SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id', [id, userId]);
  if (source === 'generation') return db.query('DELETE FROM image_generations WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
  if (source === 'image_asset') return db.query('DELETE FROM image_assets WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
  return { unsupported: true };
}
