/**
 * XENO Docs and Notes (Office › Write, Office › Notes) — documents that ARE Storage files, in XENO Docs' own format.
 *
 * Nothing about a document is stored twice. A document is a `user_files` row registered through the ONE path every
 * upload uses (registerManagedLibraryFile: hashed, allowance-checked, security-scanned), so it has Storage's stable
 * file id, shows up in Storage and the Library, is shared with Storage's shares, versioned with Storage's versions
 * (storageVersions.addVersion / restoreVersion) and trashed with the Library's trash. What this module adds:
 *
 *   - the format: XENO Docs' `.xdoc` (JSON around a ProseMirror document), validated on EVERY write by the format
 *     module cut from `@xenosystem/blocks/docs` (vendor/xdoc-format.mjs, generated — the same code the editor runs).
 *     Never HTML: the screen mounts XENO Docs' editor, which builds DOM only from its schema, and a node, mark or
 *     attribute that schema would not render (a script link, an unsafe image, an unknown block) is refused HERE, so an
 *     API caller or an agent that skips the editor cannot store one either. A link to another document is XENO
 *     Notes' `wikiLink` mark ({pageId: <file id>}).
 *   - input: `xdoc` (the file), `content` (the document) or `markdown` (converted by XENO Docs' Markdown engine — what
 *     an agent writes most naturally). Output: the file, its content, its words and a Markdown rendering.
 *   - documents written before the shared format (Markdown, text/markdown, 2026-10-20 → 10-23) still read: they are
 *     converted on read and become `.xdoc` on their next save. scripts/migrate-workspace-docs-to-xdoc.mjs does it for
 *     all of them at once, each as a NEW version (restore the previous one to undo it).
 *   - `metadata.xeno_doc = { kind: 'doc'|'note', title, format }` and `metadata.description` = the opening text, which
 *     is what the existing Library search matches, so search runs THROUGH listLibraryItems, not beside it;
 *   - backlinks: workspace_doc_links, rewritten from the newest version on every save, read back filtered by access.
 *
 * Scope (XENO-WORKFORCE-01 §8.11): a team workspace owns its documents (viewers read, editors write); in the Personal
 * workspace they are the person's own. A share from Storage lets someone else read (or, as editor, save) one.
 * Agents act for their owner and never above them. Every write is reversible: a save is a new version (restore the
 * previous one to undo it), a delete goes to the trash (restore undoes it).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { ensurePersonalWorkspace } from './personalWorkspace.js';
import { registerManagedLibraryFile, getAuthorizedLibraryFile, listLibraryItems } from './libraryAssets.js';
import { addVersion, restoreVersion, listVersions, latestFor, fileIdOf } from './storageVersions.js';
import { trashLibraryItem, restoreLibraryItem } from './libraryOrganise.js';
import { localLibraryPath } from './storageObjects.js';
import * as X from '../vendor/xdoc-format.mjs';

export class DocsError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'DocsError'; this.code = code; this.status = status; }
}

export const KINDS = Object.freeze(['doc', 'note']);
export const MAX_BYTES = 2 * 1024 * 1024;
export const MIME = 'application/json';
/** The bytes of a document saved before the shared format. Read, converted, never written any more. */
export const LEGACY_MIME = 'text/markdown';
export const FORMAT = X.XDOC_FORMAT;
/** Which `@xenosystem/blocks/docs` build this server validates with (the editor bundle must say the same). */
export const BUILT_FROM = X.BUILT_FROM;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tooLarge = () => new DocsError(`A document is at most ${MAX_BYTES / 1024 / 1024} MB`, 'too_large', 413);

// ─────────────────────────────────────────── who, where

async function personOf(db, actor) {
  if (!actor || !actor.id) throw new DocsError('No caller', 'not_allowed', 401);
  if (actor.kind !== 'agent') return { userId: String(actor.id), agentId: null };
  const r = (await db.query('SELECT owner_user_id FROM agent_identities WHERE user_id = $1', [actor.id])).rows[0];
  if (!r || !r.owner_user_id) throw new DocsError('This agent has no owner', 'no_owner', 403);
  return { userId: String(r.owner_user_id), agentId: String(actor.id) };
}

async function scopeFor(db, actor, { workspace, need = 'viewer' } = {}) {
  const who = await personOf(db, actor);
  let ws = workspace ? String(workspace) : null;
  if (ws && !UUID.test(ws)) throw new DocsError('Invalid workspace id', 'invalid_workspace');
  if (!ws) ws = String((await ensurePersonalWorkspace(db, who.userId)).id);
  const w = (await db.query('SELECT id, owner_user_id, workspace_type FROM workspaces WHERE id = $1', [ws])).rows[0];
  if (!w) throw new DocsError('Workspace not found', 'not_found', 404);
  const personal = w.workspace_type === 'personal';
  if (personal && String(w.owner_user_id) !== who.userId) throw new DocsError('You are not a member of that workspace', 'not_a_member', 403);
  if (!personal) {
    const ok = await check(db, { object: `workspace:${ws}`, relation: need, subject: `user:${who.userId}` });
    if (!ok.allowed) {
      const member = need === 'viewer' ? false : (await check(db, { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${who.userId}` })).allowed;
      if (!member) throw new DocsError('You are not a member of that workspace', 'not_a_member', 403);
      throw new DocsError('Only editors and admins can write documents here', 'editor_required', 403);
    }
  }
  return { ...who, workspaceId: ws, personal };
}

// ─────────────────────────────────────────── the format (XENO Docs' .xdoc)

const cleanKind = (k) => { if (!KINDS.includes(String(k))) throw new DocsError('kind must be doc or note', 'invalid_kind'); return String(k); };
const cleanTitle = (t) => { const s = String(t ?? '').replace(/[\u0000-\u001f]/g, ' ').trim(); if (!s || s.length > 200) throw new DocsError('A title of 1–200 characters is required', 'invalid_title'); return s; };
const refusal = (e) => Object.assign(new DocsError(e && e.message ? e.message : 'Not a XENO document', 'invalid_document'), { problems: ((e && e.problems) || []).slice(0, 20) });

/**
 * The document a caller sent, as validated `.xdoc` content. Exactly one of xdoc / content / markdown. A refusal names
 * what was wrong (the format's own problem list), so an agent can fix its input instead of guessing.
 */
function contentFrom({ xdoc, content, markdown } = {}) {
  const given = [xdoc, content, markdown].filter((v) => v !== undefined && v !== null);
  if (given.length > 1) throw new DocsError('Send one of xdoc, content or markdown', 'invalid_document');
  if (!given.length) return null;
  let c;
  if (markdown !== undefined && markdown !== null) {
    if (typeof markdown !== 'string') throw new DocsError('markdown must be text', 'invalid_markdown');
    if (markdown.includes('\u0000')) throw new DocsError('markdown cannot contain NUL', 'invalid_markdown');
    if (Buffer.byteLength(markdown, 'utf8') > MAX_BYTES) throw tooLarge();
    c = X.markdownToDocument(markdown.replace(/\r\n?/g, '\n'));
  } else if (xdoc !== undefined && xdoc !== null) {
    if (typeof xdoc === 'string' && Buffer.byteLength(xdoc, 'utf8') > MAX_BYTES) throw tooLarge();
    try { c = X.parseXdoc(xdoc).content; } catch (e) { throw refusal(e); }
  } else c = content;
  const problems = X.validateContent(c);
  if (problems.length) throw Object.assign(new DocsError(`The document contains content XENO Docs will not show (${problems[0].detail} at ${problems[0].path})`, 'invalid_document'), { problems: problems.slice(0, 20) });
  return c;
}

/** The document's words, without structure: what the Library search reads. */
export const plainText = (content) => X.plainText(content);
/** The ids the document's page links point at. */
export const linksIn = (content) => X.pageLinksIn(content);
const fileName = (title) => `${title.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 120) || 'Untitled'}${X.XDOC_EXTENSION}`;
const uploadsRoot = () => path.resolve(process.cwd(), fs.existsSync(path.resolve(process.cwd(), 'src/server')) ? 'src/server/uploads' : 'uploads');

async function writeBytes(content, title, created) {
  const text = X.serializeXdoc({ title, content, created: created ?? Date.now(), lastModified: Date.now() });
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw tooLarge();
  const dir = uploadsRoot(); await fs.promises.mkdir(dir, { recursive: true });
  const name = `${crypto.randomUUID()}-doc${X.XDOC_EXTENSION}`, to = path.join(dir, name);
  await fs.promises.writeFile(to, text, 'utf8');
  return { filename: name, storagePath: to, fileSize: Buffer.byteLength(text, 'utf8'), mimeType: MIME, originalName: fileName(title) };
}
const meta = (kind, title, content, agentId) => ({ source: 'xeno-docs', xeno_doc: { kind, title, format: X.XDOC_FORMAT }, description: plainText(content).slice(0, 2000), ...(agentId ? { last_edited_by_agent: agentId } : {}) });

/** A version's bytes as content: `.xdoc` as written, or a pre-format Markdown version converted on read. */
export function readContent(text, docMeta) {
  if (docMeta && docMeta.format === X.XDOC_FORMAT) { const f = X.parseXdoc(text); return { content: f.content, created: f.created, format: 'xdoc' }; }
  return { content: X.markdownToDocument(String(text).replace(/\r\n?/g, '\n')), created: null, format: 'markdown' };
}

async function indexLinks(db, fileId, content) {
  await db.query('DELETE FROM workspace_doc_links WHERE source_file_id = $1', [fileId]);
  const targets = linksIn(content).filter((t) => UUID.test(t) && t !== String(fileId).toLowerCase());
  if (targets.length) await db.query('INSERT INTO workspace_doc_links (source_file_id, target_file_id) SELECT $1, t FROM unnest($2::uuid[]) t ON CONFLICT DO NOTHING', [fileId, targets]);
}

// ─────────────────────────────────────────── reading

/** The document `id` (its file id, or any version's id) as the newest version the caller may see, or null. */
async function current(db, who, id, relation = 'viewer') {
  if (!UUID.test(String(id || ''))) throw new DocsError('Invalid document id', 'invalid_document');
  const versionId = await latestFor(db, String(id));
  const f = await getAuthorizedLibraryFile(db, { type: 'user', id: who.userId }, versionId, relation);
  if (!f) return null;
  const row = (await db.query('SELECT id, file_id, metadata, created_at, workspace_id, owner_user_id FROM user_files WHERE id = $1', [f.id])).rows[0];
  if (!row || !row.metadata || !row.metadata.xeno_doc) return null;
  return { ...f, metadata: row.metadata, created_at: row.created_at };
}
const viewOf = (f, extra = {}) => ({ id: String(f.file_id), versionId: String(f.id), kind: f.metadata.xeno_doc.kind, title: f.metadata.xeno_doc.title,
  excerpt: (f.metadata.description || '').slice(0, 200), updatedAt: f.created_at, ...extra });

/**
 * The bytes through the ONE reader (cached copy, or the object store). A document is a file this module wrote and
 * validated; it is rendered by XENO Docs' editor from its schema, never as HTML, so it is served while the scan runs.
 * It is validated again on the way OUT, so a file changed behind this module's back is refused, not shown.
 */
async function bytesOf(db, f) {
  const disk = await localLibraryPath(db, f);
  if (!disk) throw new DocsError('The document’s contents are not available right now', 'content_missing', 503);
  const text = await fs.promises.readFile(disk, 'utf8');
  try { return readContent(text, f.metadata.xeno_doc); } catch (e) { throw refusal(e); }
}

export async function getDoc(db, actor, { id } = {}) {
  const who = await personOf(db, actor);
  const f = await current(db, who, id);
  if (!f) throw new DocsError('Document not found', 'not_found', 404);
  const r = await bytesOf(db, f);
  const canEdit = !!(await getAuthorizedLibraryFile(db, { type: 'user', id: who.userId }, f.id, 'editor'));
  const at = new Date(f.created_at).getTime();
  const xdoc = { format: X.XDOC_FORMAT, version: X.XDOC_VERSION, title: f.metadata.xeno_doc.title, content: r.content, created: r.created ?? at, lastModified: at, wordCount: X.wordCount(r.content) };
  return {
    doc: viewOf(f, { format: r.format, xdoc, content: r.content, text: plainText(r.content), markdown: X.documentToMarkdown(r.content), canEdit, links: linksIn(r.content) }),
    backlinks: (await backlinksOf(db, who, f.file_id)),
  };
}

async function backlinksOf(db, who, fileId) {
  const rows = (await db.query('SELECT source_file_id FROM workspace_doc_links WHERE target_file_id = $1 ORDER BY created_at DESC LIMIT 200', [fileId])).rows;
  const out = [];
  for (const r of rows) { const f = await current(db, who, String(r.source_file_id)); if (f) out.push(viewOf(f)); }
  return out;
}

export async function listDocs(db, actor, { workspace, kind, query } = {}) {
  const s = await scopeFor(db, actor, { workspace });
  const k = cleanKind(kind || 'doc');
  const q = String(query || '').trim();
  let ids;
  if (q) {
    // the existing Library search (title and opening text), in this workspace only
    const r = await listLibraryItems(db, s.userId, { query: q.slice(0, 200), place: s.personal ? 'personal' : s.workspaceId, tab: 'files', limit: 200 });
    ids = r.items.filter((i) => i.source === 'file').map((i) => String(i.source_id));
    if (!ids.length) return { workspaceId: s.workspaceId, kind: k, query: q, docs: [] };
  }
  const where = s.personal ? 'f.owner_user_id = $1' : 'f.workspace_id = $1 AND f.owner_user_id IS NULL';
  const rows = (await db.query(
    `SELECT f.id, f.file_id, f.metadata, f.created_at FROM user_files f
      WHERE ${where} AND f.deleted_at IS NULL AND f.storage_type = 'platform-upload' AND f.metadata->'xeno_doc'->>'kind' = $2
        AND NOT EXISTS (SELECT 1 FROM user_files n WHERE n.replaces_asset_id = f.id)
        AND ($3::uuid[] IS NULL OR f.id = ANY($3::uuid[]))
      ORDER BY f.created_at DESC LIMIT 500`, [s.personal ? s.userId : s.workspaceId, k, ids || null])).rows;
  return { workspaceId: s.workspaceId, kind: k, ...(q ? { query: q } : {}), docs: rows.map((r) => viewOf(r)) };
}

export async function docVersions(db, actor, { id } = {}) {
  const who = await personOf(db, actor);
  const f = await current(db, who, id);
  if (!f) throw new DocsError('Document not found', 'not_found', 404);
  const r = await listVersions(db, who.userId, String(f.id));
  if (r.notFound) throw new DocsError('Only the document’s owner or the workspace’s editors see its versions', 'forbidden', 403);
  return { id: String(f.file_id), versions: r.versions };
}

// ─────────────────────────────────────────── writing (all reversible)

export async function createDoc(db, actor, { workspace, kind, title, xdoc, content, markdown } = {}) {
  const s = await scopeFor(db, actor, { workspace, need: 'editor' });
  const k = cleanKind(kind), t = cleanTitle(title), c = contentFrom({ xdoc, content, markdown }) || X.emptyContent();
  const b = await writeBytes(c, t);
  let row;
  try {
    row = await registerManagedLibraryFile(db, { userId: s.userId, workspaceId: s.personal ? null : s.workspaceId, enforceAllowance: true, area: null,
      filename: b.filename, originalName: b.originalName, mimeType: MIME, fileSize: b.fileSize, storagePath: b.storagePath, metadata: meta(k, t, c, s.agentId) });
  } catch (e) {
    await fs.promises.unlink(b.storagePath).catch(() => {});
    if (e && e.code === 'storage_full') throw new DocsError(e.message, 'storage_full', 507);
    throw e;
  }
  await indexLinks(db, row.file_id, c);
  return getDoc(db, actor, { id: String(row.file_id) });
}

/**
 * Save a new version. `expectedVersion` (the versionId the editor opened) refuses a save on top of someone else's
 * newer version instead of silently replacing it. Undo a save with restoreDocVersion(previous version). A legacy
 * (Markdown) document saved with only a new title is rewritten as `.xdoc` — the same words, the shared format.
 */
export async function saveDoc(db, actor, { id, title, xdoc, content, markdown, expectedVersion } = {}) {
  const who = await personOf(db, actor);
  const f = await current(db, who, id);
  if (!f) throw new DocsError('Document not found', 'not_found', 404);
  if (expectedVersion && String(expectedVersion) !== String(f.id)) throw Object.assign(new DocsError('Someone saved a newer version since you opened this', 'version_conflict', 409), { current: String(f.id) });
  const t = title === undefined ? f.metadata.xeno_doc.title : cleanTitle(title);
  const sent = contentFrom({ xdoc, content, markdown });
  const was = await bytesOf(db, f);
  const c = sent || was.content;
  const b = await writeBytes(c, t, was.created ?? undefined);
  let r;
  try { r = await addVersion(db, who.userId, String(f.id), b, registerManagedLibraryFile); }
  catch (e) {
    await fs.promises.unlink(b.storagePath).catch(() => {});
    if (e && e.code === 'version_conflict') throw new DocsError(e.message, 'version_conflict', 409);
    if (e && e.code === 'storage_full') throw new DocsError(e.message, 'storage_full', 507);
    throw e;
  }
  if (r.notFound) { await fs.promises.unlink(b.storagePath).catch(() => {}); throw new DocsError('You can read this document but not change it', 'forbidden', 403); }
  await db.query(`UPDATE user_files SET metadata = metadata || $2::jsonb, original_name = $3 WHERE id = $1`, [r.file.id, JSON.stringify(meta(f.metadata.xeno_doc.kind, t, c, who.agentId)), b.originalName]);
  if (!who.agentId) await db.query(`UPDATE user_files SET metadata = metadata - 'last_edited_by_agent' WHERE id = $1`, [r.file.id]);
  await indexLinks(db, f.file_id, c);
  return { ...(await getDoc(db, actor, { id: String(f.file_id) })), previousVersion: String(f.id) };
}

export async function restoreDocVersion(db, actor, { id, versionId } = {}) {
  const who = await personOf(db, actor);
  const f = await current(db, who, id);
  if (!f) throw new DocsError('Document not found', 'not_found', 404);
  if (!UUID.test(String(versionId || ''))) throw new DocsError('Invalid version id', 'invalid_version');
  const r = await restoreVersion(db, who.userId, String(f.id), String(versionId), registerManagedLibraryFile);
  if (r.notFound) throw new DocsError('That version is not an earlier version of this document you may restore', 'not_found', 404);
  if (r.conflict) throw new DocsError('That version’s contents are not available', r.code || 'conflict', 409);
  // the restored bytes carry the old version's words AND its format; keep title, format, excerpt and links in step
  const back = (await db.query('SELECT metadata FROM user_files WHERE id = $1', [versionId])).rows[0];
  if (back) await db.query(`UPDATE user_files SET metadata = metadata || $2::jsonb WHERE id = $1`, [r.file.id, JSON.stringify({ xeno_doc: back.metadata.xeno_doc, description: back.metadata.description || '' })]);
  const out = await getDoc(db, actor, { id: String(f.file_id) });
  await indexLinks(db, f.file_id, out.doc.content);
  return { ...out, previousVersion: String(f.id) };
}

export async function trashDoc(db, actor, { id } = {}) {
  const who = await personOf(db, actor);
  const f = await current(db, who, id);
  if (!f) throw new DocsError('Document not found', 'not_found', 404);
  const r = await trashLibraryItem(db, { type: 'user', id: who.userId }, 'file', String(f.id));
  if (r.forbidden) throw new DocsError('Only the document’s owner can delete it', 'forbidden', 403);
  if (!r.ok) throw new DocsError('The document could not be moved to the trash', r.code || 'conflict', 409);
  return { trashed: true, id: String(f.file_id), undo: 'restore' };
}

export async function untrashDoc(db, actor, { id } = {}) {
  const who = await personOf(db, actor);
  if (!UUID.test(String(id || ''))) throw new DocsError('Invalid document id', 'invalid_document');
  const versionId = await latestFor(db, String(id));
  const isDoc = (await db.query(`SELECT 1 FROM user_files WHERE id = $1 AND metadata ? 'xeno_doc'`, [versionId])).rows.length;
  if (!isDoc) throw new DocsError('Document not found', 'not_found', 404);
  const r = await restoreLibraryItem(db, { type: 'user', id: who.userId }, 'file', versionId);
  if (r.notFound) throw new DocsError('Document not found', 'not_found', 404);
  if (r.forbidden) throw new DocsError('Only the document’s owner can restore it', 'forbidden', 403);
  if (!r.ok) throw new DocsError('The document is not in the trash', r.code || 'conflict', 409);
  return getDoc(db, actor, { id: (await fileIdOf(db, versionId)) || versionId });
}

// ─────────────────────────────────────────── migration (scripts/migrate-workspace-docs-to-xdoc.mjs)

/** Every document whose NEWEST version is still pre-format Markdown. Read-only. */
export async function legacyDocs(db) {
  return (await db.query(
    `SELECT f.id, f.file_id, f.metadata->'xeno_doc'->>'kind' AS kind, f.metadata->'xeno_doc'->>'title' AS title, f.owner_user_id, f.workspace_id, f.user_id
       FROM user_files f
      WHERE f.metadata ? 'xeno_doc' AND f.deleted_at IS NULL AND COALESCE(f.metadata->'xeno_doc'->>'format', '') <> $1
        AND NOT EXISTS (SELECT 1 FROM user_files n WHERE n.replaces_asset_id = f.id)
      ORDER BY f.created_at`, [X.XDOC_FORMAT])).rows;
}

/**
 * Rewrite one legacy document as `.xdoc` — a NEW version made as the file's owner (restore the previous version to
 * undo it). The words come from XENO Docs' Markdown engine and are validated like any save.
 */
export async function migrateLegacyDoc(db, row) {
  // a Personal document is its owner's; a team document belongs to the workspace, so its owner makes the version
  const ownerId = row.owner_user_id ? String(row.owner_user_id)
    : String((await db.query('SELECT owner_user_id FROM workspaces WHERE id = $1', [row.workspace_id])).rows[0]?.owner_user_id || row.user_id);
  return saveDoc(db, { id: ownerId, kind: 'human' }, { id: String(row.file_id), title: row.title, expectedVersion: String(row.id) });
}
