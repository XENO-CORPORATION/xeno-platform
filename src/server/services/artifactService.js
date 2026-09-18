/**
 * XENO Artifacts — the hosted home's rules, in one place.
 *
 * Mirrors the SDK's `XenoPageStore` contract so a page promoted from the CLI
 * is the same object here: index.html is the entry, supporting paths are
 * relative and stay inside the revision, the revision hash covers every file,
 * unchanged bytes are not a new revision, the whole revision fits 16 MB.
 *
 * Authority: the owner reads, revises, shares and deletes. A share token grants
 * READ of the current revision to anyone holding it; comments need an account.
 * Comments are delivered to the publishing session, which acknowledges them —
 * "delivered" is the session's word, not this service's.
 */
import crypto from 'crypto';
import { artifactStorage } from './artifactStorage.js';

export const ARTIFACT_MAX_BYTES = 16 * 1024 * 1024;
export const ARTIFACT_MAX_FILES = 255;
export const ARTIFACT_ENTRY = 'index.html';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.pdf': 'application/pdf', '.wasm': 'application/wasm',
};

export function contentTypeFor(path) {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

export class ArtifactError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code ?? 'artifact_error';
  }
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function mintId(prefix, length = 22) {
  const bytes = crypto.randomBytes(length);
  let out = prefix;
  for (let i = 0; i < length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** The SDK's path rule: relative, forward slashes, no empty/./.. segments, no filesystem-hostile characters, not the entry. */
export function normalizePath(path) {
  const trimmed = String(path ?? '').trim().replace(/\\/g, '/');
  if (!trimmed) throw new ArtifactError(400, 'A file path is required.', 'invalid_path');
  if (trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) throw new ArtifactError(400, `File path must be relative: ${path}`, 'invalid_path');
  const segments = trimmed.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) throw new ArtifactError(400, `File path must not contain empty, "." or ".." segments: ${path}`, 'invalid_path');
  // eslint-disable-next-line no-control-regex
  if (segments.some((s) => /[<>:"|?*\u0000-\u001f]/.test(s))) throw new ArtifactError(400, `File path contains characters a filesystem refuses: ${path}`, 'invalid_path');
  const joined = segments.join('/');
  if (joined === ARTIFACT_ENTRY) throw new ArtifactError(400, `${ARTIFACT_ENTRY} is the page itself; supporting files need another path.`, 'invalid_path');
  return joined;
}

export function extractTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html.slice(0, 8 * 1024));
  const title = match?.[1]?.replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, 200) : undefined;
}

/**
 * Validate a publish body and turn it into bytes + a manifest. Files arrive as
 * base64 in JSON (the CLI's promote path); the entry is plain text.
 */
export function prepareRevision(body) {
  const html = typeof body?.html === 'string' ? body.html : '';
  if (!html.trim()) throw new ArtifactError(400, 'A page needs HTML content.', 'missing_html');
  // A replacement character means the source was not valid UTF-8 when it was read. Publishing it
  // ships a page with a visible defect; refuse with the position, the way Claude Code's publish does.
  const bad = html.indexOf('\uFFFD');
  if (bad !== -1) {
    const before = html.slice(0, bad);
    const line = before.split('\n').length;
    const col = bad - before.lastIndexOf('\n');
    throw new ArtifactError(400, `The page contains the replacement character U+FFFD at line ${line}, column ${col}; the source file is not valid UTF-8 text.`, 'invalid_utf8');
  }
  const htmlBytes = Buffer.from(html, 'utf8');
  const files = new Map();
  const inputFiles = Array.isArray(body.files) ? body.files : [];
  if (inputFiles.length > ARTIFACT_MAX_FILES) throw new ArtifactError(400, `A page may carry at most ${ARTIFACT_MAX_FILES} files.`, 'too_many_files');
  for (const file of inputFiles) {
    const path = normalizePath(file?.path);
    if (files.has(path)) throw new ArtifactError(400, `Duplicate file path: ${path}`, 'invalid_path');
    if (typeof file.base64 !== 'string') throw new ArtifactError(400, `File ${path} needs base64 content.`, 'invalid_file');
    const bytes = Buffer.from(file.base64, 'base64');
    files.set(path, { bytes, contentType: typeof file.contentType === 'string' && file.contentType ? file.contentType.slice(0, 120) : contentTypeFor(path) });
  }
  const total = htmlBytes.length + [...files.values()].reduce((sum, f) => sum + f.bytes.length, 0);
  if (total > ARTIFACT_MAX_BYTES) throw new ArtifactError(413, `Page revision is ${total} bytes; the limit is ${ARTIFACT_MAX_BYTES}.`, 'too_large');

  const hash = crypto.createHash('sha256').update(htmlBytes);
  const manifest = { [ARTIFACT_ENTRY]: { sha256: sha256(htmlBytes), sizeBytes: htmlBytes.length, contentType: 'text/html; charset=utf-8' } };
  for (const [path, file] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    manifest[path] = { sha256: sha256(file.bytes), sizeBytes: file.bytes.length, contentType: file.contentType };
    hash.update(`\u0000${path}\u0000${manifest[path].sha256}`);
  }
  return {
    contentHash: hash.digest('hex'),
    sizeBytes: total,
    entryBytes: htmlBytes,
    files,
    manifest,
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : extractTitle(html),
    description: typeof body.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 1000) : undefined,
    icon: typeof body.icon === 'string' && /^[a-z][a-z-]{0,30}$/i.test(body.icon.trim()) ? body.icon.trim().toLowerCase() : undefined,
  };
}

const prefixFor = (artifactId, revision) => `artifacts/${artifactId}/r${revision}/`;

async function storeRevision(storage, artifactId, revision, prepared) {
  const prefix = prefixFor(artifactId, revision);
  await storage.put(`${prefix}${ARTIFACT_ENTRY}`, prepared.entryBytes, 'text/html; charset=utf-8');
  for (const [path, file] of prepared.files) await storage.put(`${prefix}${path}`, file.bytes, file.contentType);
  return prefix;
}

export function publicUrlFor(artifactId, origin) {
  return `${origin.replace(/\/$/, '')}/a/${artifactId}`;
}

// ───────────────────────────── writes ─────────────────────────────

export async function createArtifact(db, { ownerUserId, body, sourceArtifactId }) {
  const prepared = prepareRevision(body);
  const storage = artifactStorage();
  const id = mintId('a_');
  const prefix = await storeRevision(storage, id, 1, prepared);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO artifacts (id, owner_user_id, title, description, icon, current_revision, source_artifact_id)
       VALUES ($1, $2, $3, $4, $5, 1, $6)`,
      [id, ownerUserId, prepared.title ?? 'Untitled page', prepared.description ?? null, prepared.icon ?? null, sourceArtifactId ?? null],
    );
    await client.query(
      `INSERT INTO artifact_revisions (artifact_id, revision, content_hash, size_bytes, storage_prefix, files) VALUES ($1, 1, $2, $3, $4, $5)`,
      [id, prepared.contentHash, prepared.sizeBytes, prefix, JSON.stringify(prepared.manifest)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return getArtifactForOwner(db, id, ownerUserId);
}

export async function reviseArtifact(db, { artifactId, ownerUserId, body }) {
  const current = await getArtifactForOwner(db, artifactId, ownerUserId);
  if (!current) throw new ArtifactError(404, 'Artifact not found.', 'not_found');
  const prepared = prepareRevision(body);
  const latest = (await db.query('SELECT content_hash FROM artifact_revisions WHERE artifact_id=$1 AND revision=$2', [artifactId, current.currentRevision])).rows[0];
  if (latest && latest.content_hash === prepared.contentHash) return { ...current, unchanged: true };
  const revision = current.currentRevision + 1;
  const prefix = await storeRevision(artifactStorage(), artifactId, revision, prepared);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Serialize concurrent revisions on the row; the second writer sees the bumped number and fails the PK, never overwrites.
    const locked = (await client.query('SELECT current_revision FROM artifacts WHERE id=$1 FOR UPDATE', [artifactId])).rows[0];
    if (!locked || locked.current_revision !== current.currentRevision) throw new ArtifactError(409, 'The artifact changed while this revision was being prepared; publish again.', 'revision_conflict');
    await client.query(
      `INSERT INTO artifact_revisions (artifact_id, revision, content_hash, size_bytes, storage_prefix, files) VALUES ($1, $2, $3, $4, $5, $6)`,
      [artifactId, revision, prepared.contentHash, prepared.sizeBytes, prefix, JSON.stringify(prepared.manifest)],
    );
    await client.query(
      `UPDATE artifacts SET current_revision=$2, title=COALESCE($3, title), description=COALESCE($4, description), icon=COALESCE($5, icon), updated_at=NOW() WHERE id=$1`,
      [artifactId, revision, prepared.title ?? null, prepared.description ?? null, prepared.icon ?? null],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return getArtifactForOwner(db, artifactId, ownerUserId);
}

/**
 * Audience + version pinning.
 *   private   — the owner only
 *   link      — anyone holding the share token (a NEW token each time it is enabled; off = every old link dead)
 *   workspace — active members of one of the owner's billing workspaces, signed in, no token
 * `sharedRevision` pins what viewers see (null/undefined = always the latest). The owner always sees the latest.
 */
export async function setVisibility(db, { artifactId, ownerUserId, visibility, workspaceId, sharedRevision }) {
  if (!['private', 'link', 'workspace'].includes(visibility)) throw new ArtifactError(400, 'visibility must be "private", "link" or "workspace".', 'invalid_visibility');
  const current = await getArtifactForOwner(db, artifactId, ownerUserId);
  if (!current) throw new ArtifactError(404, 'Artifact not found.', 'not_found');
  let pinned = null;
  if (sharedRevision !== undefined && sharedRevision !== null) {
    pinned = Number.parseInt(String(sharedRevision), 10);
    if (!Number.isInteger(pinned) || pinned < 1 || pinned > current.currentRevision) throw new ArtifactError(400, `sharedRevision must be between 1 and ${current.currentRevision}.`, 'invalid_revision');
  }
  if (visibility === 'private') {
    await db.query(`UPDATE artifacts SET visibility='private', share_token_hash=NULL, workspace_id=NULL, shared_revision=$2, updated_at=NOW() WHERE id=$1`, [artifactId, pinned]);
    return { ...(await getArtifactForOwner(db, artifactId, ownerUserId)), shareToken: null };
  }
  if (visibility === 'workspace') {
    if (typeof workspaceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new ArtifactError(400, 'workspaceId is required for workspace sharing.', 'invalid_workspace');
    const member = (await db.query(
      `SELECT 1 FROM billing_workspace_members WHERE workspace_id=$1 AND user_id=$2 AND member_status='active' LIMIT 1`,
      [workspaceId, ownerUserId],
    )).rows[0];
    if (!member) throw new ArtifactError(403, 'You are not an active member of that workspace.', 'not_a_member');
    await db.query(`UPDATE artifacts SET visibility='workspace', workspace_id=$2, share_token_hash=NULL, shared_revision=$3, updated_at=NOW() WHERE id=$1`, [artifactId, workspaceId, pinned]);
    return { ...(await getArtifactForOwner(db, artifactId, ownerUserId)), shareToken: null };
  }
  // A new token every time link sharing is (re)enabled: turning it off revokes every old link.
  const shareToken = mintId('s_', 32);
  await db.query(`UPDATE artifacts SET visibility='link', share_token_hash=$2, workspace_id=NULL, shared_revision=$3, updated_at=NOW() WHERE id=$1`, [artifactId, sha256(shareToken), pinned]);
  return { ...(await getArtifactForOwner(db, artifactId, ownerUserId)), shareToken };
}

export async function deleteArtifact(db, { artifactId, ownerUserId }) {
  const result = await db.query(`UPDATE artifacts SET deleted_at=NOW(), visibility='private', share_token_hash=NULL WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, [artifactId, ownerUserId]);
  if (result.rowCount === 0) throw new ArtifactError(404, 'Artifact not found.', 'not_found');
  return { deleted: true };
}

/** Comments an artifact may take per hour before the queue refuses — the same 60 Claude Code caps its watch at. */
export const ARTIFACT_COMMENT_HOURLY_CAP = 60;

/**
 * A person's comment. `parentId` makes it a reply in a thread; `toAgent` (default true) puts it on
 * the publishing session's queue — a note between reviewers stays on the page and is never delivered.
 */
export async function addComment(db, { artifactId, userId, body, selector, parentId, toAgent = true, access }) {
  const artifact = await resolveReadable(db, { artifactId, userId, shareToken: access?.shareToken });
  if (!artifact) throw new ArtifactError(404, 'Artifact not found.', 'not_found');
  const text = String(body ?? '').trim();
  if (!text) throw new ArtifactError(400, 'A comment needs text.', 'missing_body');
  let parent = null;
  if (parentId !== undefined && parentId !== null) {
    parent = (await db.query(`SELECT id FROM artifact_comments WHERE id=$1 AND artifact_id=$2 AND parent_id IS NULL`, [String(parentId), artifactId])).rows[0]?.id ?? null;
    if (!parent) throw new ArtifactError(400, 'parentId must be a top-level comment on this artifact.', 'invalid_parent');
  }
  const recent = (await db.query(`SELECT count(*)::int AS n FROM artifact_comments WHERE artifact_id=$1 AND created_at > NOW() - interval '1 hour'`, [artifactId])).rows[0].n;
  if (recent >= ARTIFACT_COMMENT_HOURLY_CAP) throw new ArtifactError(429, `This page has taken ${ARTIFACT_COMMENT_HOURLY_CAP} comments in the last hour; try again later.`, 'comment_rate_limited');
  const id = mintId('c_');
  const row = (await db.query(
    `INSERT INTO artifact_comments (id, artifact_id, revision, user_id, body, selector, parent_id, author_kind, to_agent) VALUES ($1, $2, $3, $4, $5, $6, $7, 'user', $8)
     RETURNING id, artifact_id, revision, user_id, body, selector, parent_id, author_kind, to_agent, created_at, delivered_at`,
    [id, artifactId, artifact.access === 'owner' ? artifact.currentRevision : artifact.viewRevision, userId, text.slice(0, 20000), typeof selector === 'string' && selector.trim() ? selector.trim().slice(0, 500) : null, parent, toAgent !== false],
  )).rows[0];
  return commentView(row);
}

/**
 * The publishing session's reply, posted by the OWNER (the session acts as them) into a thread.
 * Never queued for delivery — it is the agent talking, not to it.
 */
export async function addAgentReply(db, { artifactId, ownerUserId, parentId, body }) {
  const artifact = await getArtifactForOwner(db, artifactId, ownerUserId);
  if (!artifact) throw new ArtifactError(404, 'Artifact not found.', 'not_found');
  const text = String(body ?? '').trim();
  if (!text) throw new ArtifactError(400, 'A reply needs text.', 'missing_body');
  const parent = (await db.query(`SELECT id, revision FROM artifact_comments WHERE id=$1 AND artifact_id=$2`, [String(parentId ?? ''), artifactId])).rows[0];
  if (!parent) throw new ArtifactError(400, 'parentId must be a comment on this artifact.', 'invalid_parent');
  const rootId = (await db.query(`SELECT COALESCE(parent_id, id) AS root FROM artifact_comments WHERE id=$1`, [parent.id])).rows[0].root;
  const id = mintId('c_');
  const row = (await db.query(
    `INSERT INTO artifact_comments (id, artifact_id, revision, user_id, body, parent_id, author_kind, to_agent, delivered_at) VALUES ($1, $2, $3, $4, $5, $6, 'agent', FALSE, NOW())
     RETURNING id, artifact_id, revision, user_id, body, selector, parent_id, author_kind, to_agent, created_at, delivered_at`,
    [id, artifactId, artifact.currentRevision, ownerUserId, text.slice(0, 20000), rootId],
  )).rows[0];
  return commentView(row);
}

export async function markCommentsDelivered(db, { artifactId, ownerUserId, commentIds }) {
  const ids = Array.isArray(commentIds) ? commentIds.filter((id) => typeof id === 'string').slice(0, 200) : [];
  if (!ids.length) return { delivered: 0 };
  const result = await db.query(
    `UPDATE artifact_comments c SET delivered_at = NOW()
       FROM artifacts a
      WHERE c.artifact_id = a.id AND a.id = $1 AND a.owner_user_id = $2 AND c.id = ANY($3::text[]) AND c.delivered_at IS NULL`,
    [artifactId, ownerUserId, ids],
  );
  return { delivered: result.rowCount };
}

/**
 * Retention: artifacts past `expires_at` are soft-deleted in bounded batches. Policy is set per
 * artifact at publish time from ARTIFACTS_RETENTION_DAYS_PRIVATE / _SHARED (unset = keep forever),
 * and re-derived when sharing changes. Never throws — hygiene must not take a request down.
 */
export function retentionDaysFor(visibility, env = process.env) {
  const raw = env[visibility === 'private' ? 'ARTIFACTS_RETENTION_DAYS_PRIVATE' : 'ARTIFACTS_RETENTION_DAYS_SHARED'];
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  // A malformed value keeps "never" rather than becoming 0 — a retention system must not fail towards deleting everything.
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

export async function applyRetentionPolicy(db, artifactId, env = process.env) {
  const row = (await db.query(`SELECT visibility FROM artifacts WHERE id=$1 AND deleted_at IS NULL`, [artifactId])).rows[0];
  if (!row) return;
  const days = retentionDaysFor(row.visibility, env);
  await db.query(`UPDATE artifacts SET expires_at = CASE WHEN $2::int IS NULL THEN NULL ELSE NOW() + ($2::int || ' days')::interval END WHERE id=$1`, [artifactId, days]);
}

export async function sweepExpiredArtifacts(db, { limit = 200 } = {}) {
  try {
    const result = await db.query(
      `UPDATE artifacts SET deleted_at=NOW(), visibility='private', share_token_hash=NULL, workspace_id=NULL
        WHERE id IN (SELECT id FROM artifacts WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at < NOW() LIMIT $1)`,
      [limit],
    );
    return { expired: result.rowCount };
  } catch (error) {
    console.error('[artifacts] retention sweep failed:', error?.message ?? error);
    return { expired: 0, error: String(error?.message ?? error) };
  }
}

// ───────────────────────────── reads ─────────────────────────────

function artifactView(row) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    kind: row.kind,
    title: row.title,
    description: row.description ?? undefined,
    icon: row.icon ?? undefined,
    currentRevision: row.current_revision,
    visibility: row.visibility,
    workspaceId: row.workspace_id ?? undefined,
    sharedRevision: row.shared_revision ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    sourceArtifactId: row.source_artifact_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function commentView(row) {
  return {
    id: row.id, artifactId: row.artifact_id, revision: row.revision, userId: row.user_id, body: row.body, selector: row.selector ?? undefined,
    parentId: row.parent_id ?? undefined, authorKind: row.author_kind ?? 'user', toAgent: row.to_agent !== false,
    createdAt: row.created_at, deliveredAt: row.delivered_at ?? undefined, ...(row.display_name ? { author: row.display_name } : {}),
  };
}

export async function getArtifactForOwner(db, artifactId, ownerUserId) {
  const row = (await db.query(`SELECT * FROM artifacts WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, [artifactId, ownerUserId])).rows[0];
  return row ? artifactView(row) : null;
}

export async function listArtifactsForOwner(db, ownerUserId, { limit = 50 } = {}) {
  const rows = (await db.query(`SELECT * FROM artifacts WHERE owner_user_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT $2`, [ownerUserId, Math.min(200, Math.max(1, limit))])).rows;
  return rows.map(artifactView);
}

/**
 * Who may read: the owner, or anyone presenting the live share token. Returns
 * the artifact with `access` = 'owner' | 'link', or null (which the routes
 * report as 404 — a private artifact must not confirm its existence).
 */
export async function resolveReadable(db, { artifactId, userId, shareToken }) {
  const row = (await db.query(`SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL`, [artifactId])).rows[0];
  if (!row) return null;
  const view = artifactView(row);
  // What a viewer sees: the pinned revision if the owner pinned one, else the latest. The owner always sees the latest.
  const viewRevision = row.shared_revision ?? row.current_revision;
  if (userId && row.owner_user_id === userId) return { ...view, access: 'owner', viewRevision: row.current_revision };
  if (row.visibility === 'link' && typeof shareToken === 'string' && shareToken && row.share_token_hash) {
    const presented = Buffer.from(sha256(shareToken));
    const expected = Buffer.from(row.share_token_hash);
    if (presented.length === expected.length && crypto.timingSafeEqual(presented, expected)) return { ...view, access: 'link', viewRevision };
  }
  if (row.visibility === 'workspace' && userId && row.workspace_id) {
    const member = (await db.query(
      `SELECT 1 FROM billing_workspace_members WHERE workspace_id=$1 AND user_id=$2 AND member_status='active' LIMIT 1`,
      [row.workspace_id, userId],
    )).rows[0];
    if (member) return { ...view, access: 'workspace', viewRevision };
  }
  return null;
}

export async function getRevision(db, artifactId, revision) {
  const row = (await db.query(`SELECT * FROM artifact_revisions WHERE artifact_id=$1 AND revision=$2`, [artifactId, revision])).rows[0];
  if (!row) return null;
  return { artifactId: row.artifact_id, revision: row.revision, contentHash: row.content_hash, sizeBytes: row.size_bytes, storagePrefix: row.storage_prefix, files: row.files, createdAt: row.created_at };
}

export async function listRevisions(db, artifactId) {
  const rows = (await db.query(`SELECT revision, content_hash, size_bytes, created_at FROM artifact_revisions WHERE artifact_id=$1 ORDER BY revision`, [artifactId])).rows;
  return rows.map((row) => ({ revision: row.revision, contentHash: row.content_hash, sizeBytes: row.size_bytes, createdAt: row.created_at }));
}

/** Bytes of one published file, refusing paths outside the revision's manifest. */
export async function readFile(db, { artifactId, revision, path }) {
  const rev = await getRevision(db, artifactId, revision);
  if (!rev) return null;
  const normalized = path === '' || path === ARTIFACT_ENTRY ? ARTIFACT_ENTRY : (() => { try { return normalizePath(path); } catch { return null; } })();
  if (!normalized || !rev.files[normalized]) return null;
  const bytes = await artifactStorage().get(`${rev.storagePrefix}${normalized}`);
  if (!bytes) return null;
  return { bytes, contentType: rev.files[normalized].contentType ?? contentTypeFor(normalized) };
}

export async function listComments(db, { artifactId, undeliveredOnly = false }) {
  const rows = (await db.query(
    `SELECT c.*, u.display_name FROM artifact_comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.artifact_id=$1 ${undeliveredOnly ? 'AND c.delivered_at IS NULL AND c.to_agent AND c.author_kind = \'user\'' : ''} ORDER BY c.created_at ASC LIMIT 500`,
    [artifactId],
  )).rows;
  return rows.map(commentView);
}

export const _internal = { mintId, prefixFor };
