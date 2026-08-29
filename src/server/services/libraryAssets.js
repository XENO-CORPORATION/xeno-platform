import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { CHAT_PROJECT_CONTRACTS } from '../config/chatProjectContracts.js';
import { check, writeTuples } from '../utils/authzReBAC.js';
import { withTransaction } from './chatProjectAuthority.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNATURE_VERSION = 'v1';
const GRANT_SIGNATURE_VERSION = 'v2';
const DEFAULT_LINK_TTL_SECONDS = 24 * 60 * 60;
const MAX_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

function sniffMime(buffer, declaredMime) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))) {
    return declaredMime || 'application/zip';
  }
  if (!buffer.includes(0) && ['text/plain', 'text/markdown', 'text/csv', 'text/html', 'application/json'].includes(declaredMime)) {
    return declaredMime;
  }
  return declaredMime || 'application/octet-stream';
}

export function decodeLegacyLibraryImageDataUrl(value) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(String(value || ''));
  if (!match) throw new Error('Legacy generation entry is not an image data URL');
  const buffer = Buffer.from(match[2].replace(/[\r\n]/g, ''), 'base64');
  if (!buffer.length) throw new Error('Legacy generation entry decoded to zero bytes');

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return { buffer, declaredMime: match[1].toLowerCase(), mimeType: 'image/png', extension: 'png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { buffer, declaredMime: match[1].toLowerCase(), mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { buffer, declaredMime: match[1].toLowerCase(), mimeType: 'image/webp', extension: 'webp' };
  }
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) {
    return { buffer, declaredMime: match[1].toLowerCase(), mimeType: 'image/gif', extension: 'gif' };
  }
  throw new Error(`Unsupported legacy image bytes (declared ${match[1].toLowerCase()})`);
}

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

const grantSignaturePayload = ({ assetId, grantId, expires, download }) =>
  [GRANT_SIGNATURE_VERSION, assetId, grantId, String(expires), download ? '1' : '0'].join(':');

export async function createAuthorizedLibraryContentPath(db, {
  assetId,
  principal,
  ttlSeconds,
  download = false,
  projectId = null,
  workspaceId = null,
}) {
  const file = await getAuthorizedLibraryFile(db, principal, assetId);
  if (!file || !file.ingestion_safe) return null;
  const ttl = Math.min(Math.max(Number(ttlSeconds) || DEFAULT_LINK_TTL_SECONDS, 60), MAX_LINK_TTL_SECONDS);
  const expires = Math.floor(Date.now() / 1000) + ttl;
  let authorizingResourceType = 'user';
  let authorizingResourceId = principal.id;
  if (projectId) {
    const verdict = await check(db, { object: `project:${projectId}`, relation: 'viewer', subject: `${principal.type}:${principal.id}` });
    if (!verdict.allowed) return null;
    const linked = await db.query('SELECT 1 FROM chat_project_assets WHERE project_id = $1 AND asset_id = $2', [projectId, assetId]);
    if (!linked.rowCount) return null;
    authorizingResourceType = 'project';
    authorizingResourceId = projectId;
  } else if (workspaceId) {
    const verdict = await check(db, { object: `workspace:${workspaceId}`, relation: 'viewer', subject: `${principal.type}:${principal.id}` });
    if (!verdict.allowed || file.workspace_id !== workspaceId) return null;
    authorizingResourceType = 'workspace';
    authorizingResourceId = workspaceId;
  }
  const { rows } = await db.query(
    `INSERT INTO library_asset_link_grants(
       asset_id, issued_by_user_id, authorizing_resource_type, authorizing_resource_id, expires_at
     ) VALUES ($1, $2, $3, $4, to_timestamp($5)) RETURNING id`,
    [assetId, principal.type === 'user' ? principal.id : null, authorizingResourceType, authorizingResourceId, expires],
  );
  const grantId = rows[0].id;
  const params = new URLSearchParams({
    v: GRANT_SIGNATURE_VERSION,
    grant: grantId,
    expires: String(expires),
    download: download ? '1' : '0',
    sig: sign(grantSignaturePayload({ assetId, grantId, expires, download })),
  });
  return { path: `/api/library/assets/${assetId}/content?${params.toString()}`, file, grantId };
}

export async function verifyAuthorizedLibraryContentRequest(db, {
  assetId,
  grantId,
  expires,
  download,
  signature,
}) {
  if (!isLibraryUuid(assetId) || !isLibraryUuid(grantId) || !/^\d{10,}$/.test(String(expires || ''))) return null;
  const expiresNumber = Number(expires);
  if (!Number.isSafeInteger(expiresNumber) || expiresNumber < Math.floor(Date.now() / 1000)) return null;
  if (!/^[a-f0-9]{64}$/i.test(String(signature || ''))) return null;
  const expected = sign(grantSignaturePayload({ assetId, grantId, expires: expiresNumber, download }));
  if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(String(signature), 'hex'))) return null;
  const { rows } = await db.query(
    `SELECT * FROM library_asset_link_grants
     WHERE id = $1 AND asset_id = $2 AND revoked_at IS NULL
       AND expires_at > NOW() AND expires_at = to_timestamp($3)`,
    [grantId, assetId, expiresNumber],
  );
  const grant = rows[0];
  if (!grant) return null;
  if (grant.authorizing_resource_type === 'user') {
    const file = await getManagedLibraryFile(db, assetId, grant.authorizing_resource_id);
    return file ? { file, grant } : null;
  }
  if (grant.authorizing_resource_type === 'project') {
    const linked = await db.query(
      `SELECT f.id, f.original_name, f.filename, f.mime_type, f.file_size, f.storage_path
       FROM chat_project_assets pa JOIN user_files f ON f.id = pa.asset_id
       WHERE pa.project_id = $1 AND pa.asset_id = $2 AND f.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM library_asset_ingestions i WHERE i.asset_id = f.id AND i.state IN ('ready','unsupported'))`,
      [grant.authorizing_resource_id, assetId],
    );
    return linked.rows[0] ? { file: linked.rows[0], grant } : null;
  }
  const file = (await db.query(
    `SELECT id, original_name, filename, mime_type, file_size, storage_path
     FROM user_files WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM library_asset_ingestions i WHERE i.asset_id = user_files.id AND i.state IN ('ready','unsupported'))`,
    [assetId, grant.authorizing_resource_id],
  )).rows[0];
  return file ? { file, grant } : null;
}

export async function registerManagedLibraryFile(db, {
  userId,
  workspaceId = null,
  filename,
  originalName,
  mimeType,
  fileSize,
  storagePath,
  metadata = {},
}) {
  if (!isLibraryUuid(userId) || (workspaceId && !isLibraryUuid(workspaceId))) {
    throw new Error('Library owner ids must be UUIDs');
  }
  const bytes = await fs.promises.readFile(storagePath);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const detectedMime = sniffMime(bytes, mimeType);
  const semanticEnabled = CHAT_PROJECT_CONTRACTS.retrieval.semanticEnabledByDefault
    && process.env.CHAT_SEMANTIC_RETRIEVAL !== '0';
  if (Number(fileSize) !== bytes.length) throw new Error('Stored Library file size changed before registration');

  return withTransaction(db, async (tx) => {
    if (workspaceId) {
      const workspaceAccess = await check(tx, {
        object: `workspace:${workspaceId}`,
        relation: 'editor',
        subject: `user:${userId}`,
      });
      if (!workspaceAccess.allowed) throw new Error('Workspace editor access is required to register an asset');
    }
    const { rows } = await tx.query(
      `INSERT INTO user_files (
         user_id, owner_user_id, workspace_id, created_by_user_id,
         filename, original_name, file_type, mime_type, file_size,
         storage_path, storage_type, metadata, content_sha256
       ) VALUES (CASE WHEN $3::uuid IS NULL THEN $1::uuid ELSE NULL::uuid END, $2, $3, $1, $4, $5, $6, $6, $7, $8, 'platform-upload', $9, $10)
       RETURNING id, created_at, content_sha256, mime_type`,
      [
        userId,
        workspaceId ? null : userId,
        workspaceId,
        filename,
        originalName,
        detectedMime,
        bytes.length,
        storagePath,
        metadata,
        digest,
      ],
    );
    await writeTuples(tx, {
      writes: [{
        object: `library_asset:${rows[0].id}`,
        relation: workspaceId ? 'parent' : 'owner',
        subject: workspaceId ? `workspace:${workspaceId}` : `user:${userId}`,
      }],
    });
    await tx.query(
      `INSERT INTO library_asset_ingestions(
         asset_id, content_sha256, mime_type, state, embedding_model_id, embedding_dimensions, semantic_status
       ) VALUES ($1, $2, $3, 'quarantined', $4, $5, $6)
       ON CONFLICT (asset_id, content_sha256, extractor_version, embedding_model_id)
       DO NOTHING`,
      [
        rows[0].id,
        digest,
        detectedMime,
        semanticEnabled ? CHAT_PROJECT_CONTRACTS.retrieval.embeddingModelId : null,
        semanticEnabled ? CHAT_PROJECT_CONTRACTS.retrieval.embeddingDimensions : null,
        semanticEnabled ? 'pending' : 'disabled',
      ],
    );
    return { ...rows[0], ingestion_state: 'quarantined' };
  });
}

export async function getManagedLibraryFile(db, assetId, userId) {
  if (!isLibraryUuid(assetId) || !isLibraryUuid(userId)) return null;
  const { rows } = await db.query(
    `SELECT id, original_name, filename, mime_type, file_size, storage_path
     FROM user_files
     WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL
       AND storage_type = 'platform-upload'
       AND EXISTS (SELECT 1 FROM library_asset_ingestions i WHERE i.asset_id = user_files.id AND i.state IN ('ready','unsupported'))`,
    [assetId, userId],
  );
  return rows[0] || null;
}

export async function getAuthorizedLibraryFile(db, principal, assetId, relation = 'viewer') {
  if (!isLibraryUuid(assetId) || !isLibraryUuid(principal?.id)) return null;
  const authorization = await check(db, {
    object: `library_asset:${assetId}`,
    relation,
    subject: `${principal.type || 'user'}:${principal.id}`,
  });
  if (!authorization.allowed) return null;
  const { rows } = await db.query(
    `SELECT f.id, f.original_name, f.filename, f.mime_type, f.file_size, f.storage_path,
            f.owner_user_id, f.workspace_id, f.content_sha256,
            latest.state AS ingestion_state,
            COALESCE(latest.state IN ('ready','unsupported'), FALSE) AS ingestion_safe,
            COALESCE(latest.state = 'ready', FALSE) AS ingestion_ready
     FROM user_files f
     LEFT JOIN LATERAL (
       SELECT state FROM library_asset_ingestions WHERE asset_id = f.id ORDER BY created_at DESC LIMIT 1
     ) latest ON TRUE
     WHERE f.id = $1 AND f.deleted_at IS NULL AND f.storage_type = 'platform-upload'
    `,
    [assetId],
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

export async function assertAuthorizedLibraryAttachments(db, principal, attachments) {
  if (attachments == null) return;
  if (!Array.isArray(attachments)) throw Object.assign(new Error('Message attachments must be an array'), { code: 'invalid_attachments' });
  const ids = [...new Set(attachments.map((attachment) => attachment?.asset_id).filter(Boolean))];
  if (ids.some((id) => !isLibraryUuid(id))) {
    throw Object.assign(new Error('Library attachment ids must be UUIDs'), { code: 'invalid_library_asset_id' });
  }
  for (const id of ids) {
    const file = await getAuthorizedLibraryFile(db, principal, id);
    if (!file || !file.ingestion_safe) {
      throw Object.assign(new Error('One or more Library assets are unavailable'), { code: 'library_asset_not_found' });
    }
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
        NULL::uuid AS asset_id,
        a.conversation_id, c.title AS conversation_title, a.created_at, a.updated_at
      FROM chat_artifacts a LEFT JOIN chat_conversations c ON c.id = a.conversation_id
      WHERE a.is_archived = FALSE AND (
        EXISTS (SELECT 1 FROM relationship_tuples rt WHERE rt.object_type='artifact' AND rt.object_id=a.id::text
          AND rt.subject_type='user' AND rt.subject_id=$1::text AND rt.relation IN ('owner','admin','editor','reviewer','viewer'))
        OR EXISTS (SELECT 1 FROM relationship_tuples child
          JOIN relationship_tuples access ON access.object_type=child.subject_type AND access.object_id=child.subject_id
          WHERE child.object_type='artifact' AND child.object_id=a.id::text AND child.relation='parent'
            AND access.subject_type='user' AND access.subject_id=$1::text
            AND access.relation IN ('owner','admin','editor','reviewer','viewer'))
        OR EXISTS (SELECT 1 FROM relationship_tuples child
          JOIN relationship_tuples project_parent ON project_parent.object_type='project'
            AND project_parent.object_id=child.subject_id AND project_parent.relation='parent'
          JOIN relationship_tuples workspace_access ON workspace_access.object_type=project_parent.subject_type
            AND workspace_access.object_id=project_parent.subject_id
          WHERE child.object_type='artifact' AND child.object_id=a.id::text AND child.relation='parent'
            AND child.subject_type='project' AND workspace_access.subject_type='user'
            AND workspace_access.subject_id=$1::text
            AND workspace_access.relation IN ('owner','admin','editor','reviewer','viewer'))
      )
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
        f.id,
        NULL::uuid, NULL::text, f.created_at AT TIME ZONE 'UTC', COALESCE(f.last_used_at, f.created_at) AT TIME ZONE 'UTC'
      FROM user_files f WHERE f.deleted_at IS NULL AND (
        EXISTS (SELECT 1 FROM relationship_tuples rt WHERE rt.object_type='library_asset' AND rt.object_id=f.id::text
          AND rt.subject_type='user' AND rt.subject_id=$1::text AND rt.relation IN ('owner','admin','editor','reviewer','viewer'))
        OR EXISTS (SELECT 1 FROM relationship_tuples child
          JOIN relationship_tuples access ON access.object_type=child.subject_type AND access.object_id=child.subject_id
          WHERE child.object_type='library_asset' AND child.object_id=f.id::text AND child.relation='parent'
            AND access.subject_type='user' AND access.subject_id=$1::text
            AND access.relation IN ('owner','admin','editor','reviewer','viewer'))
        OR EXISTS (SELECT 1 FROM relationship_tuples child
          JOIN relationship_tuples project_parent ON project_parent.object_type='project'
            AND project_parent.object_id=child.subject_id AND project_parent.relation='parent'
          JOIN relationship_tuples workspace_access ON workspace_access.object_type=project_parent.subject_type
            AND workspace_access.object_id=project_parent.subject_id
          WHERE child.object_type='library_asset' AND child.object_id=f.id::text AND child.relation='parent'
            AND child.subject_type='project' AND workspace_access.subject_type='user'
            AND workspace_access.subject_id=$1::text
            AND workspace_access.relation IN ('owner','admin','editor','reviewer','viewer'))
      )
        AND COALESCE(f.metadata->>'source', '') <> 'legacy-image-generation'
      UNION ALL
      SELECT 'generation:' || g.id::text || ':' || generated.ordinality::text, 'generation'::text, g.id,
        COALESCE(NULLIF(left(g.prompt, 96), ''), 'Generated image'), 'images'::text, 'image'::text,
        COALESCE(migrated.mime_type, 'image/*')::text,
        migrated.file_size::bigint, g.prompt,
        CASE WHEN migrated.id IS NOT NULL THEN '/api/library/assets/' || migrated.id::text || '/content'
          WHEN generated.url LIKE 'https://%' OR generated.url LIKE 'http://%' OR generated.url LIKE '/%' THEN generated.url ELSE NULL END,
        migrated.id,
        NULL::uuid, NULL::text, g.created_at AT TIME ZONE 'UTC', g.created_at AT TIME ZONE 'UTC'
      FROM image_generations g CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(g.image_urls) = 'array' THEN g.image_urls ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS generated(url, ordinality)
      LEFT JOIN LATERAL (
        SELECT f.id, f.file_size, f.mime_type
        FROM user_files f
        WHERE f.user_id = g.user_id AND f.deleted_at IS NULL AND f.storage_type = 'platform-upload'
          AND f.metadata->>'source' = 'legacy-image-generation'
          AND f.metadata->>'legacy_generation_id' = g.id::text
          AND f.metadata->>'legacy_ordinal' = generated.ordinality::text
        ORDER BY f.created_at ASC LIMIT 1
      ) migrated ON TRUE
      WHERE g.user_id = $1::uuid
      UNION ALL
      SELECT 'image_asset:' || ia.id::text, 'image_asset'::text, ia.id, ia.name, 'images'::text, 'image'::text,
        COALESCE(NULLIF(ia.format, ''), 'image/*'), ia.file_size::bigint, COALESCE(ia.prompt, ''),
        CASE WHEN COALESCE(ia.thumbnail_url, ia.file_url) LIKE 'https://%' OR COALESCE(ia.thumbnail_url, ia.file_url) LIKE 'http://%'
          OR COALESCE(ia.thumbnail_url, ia.file_url) LIKE '/%' THEN COALESCE(ia.thumbnail_url, ia.file_url) ELSE NULL END,
        NULL::uuid,
        NULL::uuid, NULL::text, ia.created_at AT TIME ZONE 'UTC', ia.created_at AT TIME ZONE 'UTC'
      FROM image_assets ia WHERE ia.user_id = $1::uuid
    )
    SELECT * FROM library_items
    WHERE ($2 = 'all' OR category = $2)
      AND ($3 = '' OR name ILIKE '%' || $3 || '%' OR description ILIKE '%' || $3 || '%')
    ORDER BY ${orderBy} LIMIT $4 OFFSET $5`;
  const { rows } = await db.query(sql, [userId, tab, query, limit, offset]);
  return { items: rows, tab, sort, limit, offset };
}

export async function deleteLibraryItem(db, principalOrUserId, source, id) {
  if (!isLibraryUuid(id)) return { invalid: true };
  const principal = typeof principalOrUserId === 'string'
    ? { type: 'user', id: principalOrUserId }
    : principalOrUserId;
  const userId = principal.id;
  if (source === 'artifact') {
    const allowed = await check(db, { object: `artifact:${id}`, relation: 'owner', subject: `${principal.type}:${principal.id}` });
    if (!allowed.allowed) return { rows: [] };
    return db.query('DELETE FROM chat_artifacts WHERE id = $1 RETURNING id', [id]);
  }
  if (source === 'file') {
    const allowed = await check(db, { object: `library_asset:${id}`, relation: 'owner', subject: `${principal.type}:${principal.id}` });
    if (!allowed.allowed) return { rows: [] };
    const references = await db.query('SELECT count(*)::int AS count FROM chat_project_assets WHERE asset_id = $1', [id]);
    if (references.rows[0].count > 0) return { conflict: true, referenceCount: references.rows[0].count };
    return withTransaction(db, async (tx) => {
      await tx.query('UPDATE library_asset_link_grants SET revoked_at = NOW() WHERE asset_id = $1 AND revoked_at IS NULL', [id]);
      return tx.query('UPDATE user_files SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id', [id]);
    });
  }
  if (source === 'generation') return db.query('DELETE FROM image_generations WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
  if (source === 'image_asset') return db.query('DELETE FROM image_assets WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
  return { unsupported: true };
}
