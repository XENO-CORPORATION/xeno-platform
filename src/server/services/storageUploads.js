/**
 * XENO Storage upload sessions: a file sent in parts straight to object storage, then registered once.
 *
 * Why (measured 2026-11-21): the web interface sent each file as ONE POST to /api/upload. Cloudflare refuses a request
 * body above 100 MB (413 after 1.1 MB, before the platform sees it), so no file over 100 MB could be uploaded at all,
 * and fetch() reports no upload progress, so a 50 MB file sat at "Uploading" for a minute with nothing to show. Every
 * byte also crossed the platform box's office line. The leaders split this the same way: Google Drive's resumable
 * uploads, Dropbox and Box upload sessions, S3/R2 multipart.
 *
 * The split:
 *   control plane (here, behind the account's sign-in): open a session (type, size cap, room in the pool, disk guard),
 *   report its parts (resume), complete it, abort it;
 *   data plane: each part goes to the object store directly. In production that is the objects host
 *   (xeno-storage workers/objects, objects.xenosystem.ai) with a session token signed here; where no objects host is
 *   configured (CI, local development, a deployment without R2) the same parts go to PUT .../parts/:n on this server.
 *
 * Completing is asynchronous, because the bytes must come to this machine once: Storage's rules have the security scan
 * and the content hash read the disk copy (SPEC rules 2 and 11). So complete answers at once (state `processing`), and
 * the work runs here: finish the multipart into `uploads/<id>`, stream it down while hashing, copy it inside the bucket
 * to `files/<aa>/<sha256>` (no bytes leave this machine), register it through registerManagedLibraryFile (the one
 * registration path: allowance, scan, rows), record its object, remove the staging object. The page polls the session.
 * Every step is idempotent, so a restart mid-way is finished by the sweep.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileStorage } from './artifactStorage.js';
import { assertStorageRoom } from './storageAllowance.js';
import { registerManagedLibraryFile } from './libraryAssets.js';
import { fileObjectKey } from './storageObjects.js';
import { check } from '../utils/authzReBAC.js';
import { ALLOWED_UPLOAD_MIMES } from '../utils/uploadPolicy.js';

export const PART_SIZE = 16 * 1024 * 1024;          // R2/S3: parts >= 5 MiB except the last, all the same size
export const MAX_PART_BYTES = PART_SIZE;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_HOURS = 24;

const fail = (code, message, status) => Object.assign(new Error(message), { code, status });
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
/** The largest file a session accepts (STORAGE_MAX_UPLOAD_BYTES, default 5 GiB: R2's single CopyObject limit). */
export const maxUploadBytes = (env = process.env) => Math.min(num(env.STORAGE_MAX_UPLOAD_BYTES, 5 * 1024 ** 3), 5 * 1024 ** 3);
/** Free disk this machine keeps after a file lands on it (STORAGE_MIN_FREE_BYTES, default 10 GiB). */
const minFreeBytes = (env = process.env) => num(env.STORAGE_MIN_FREE_BYTES, 10 * 1024 ** 3);

export const uploadSignedString = (sessionId, key, multipartId, partCount, partSize, expiry) =>
  `upload:v1\n${sessionId}\n${key}\n${multipartId}\n${partCount}\n${partSize}\n${expiry}`;

/** Where parts are sent: the objects host (production) or this server. */
export function transportFor(session, { env = process.env, store = fileStorage(), now = Date.now() } = {}) {
  const key = (env.DEPOT_OBJECT_URL_KEY || '').trim();
  if (key && store.kind === 'r2') {
    const base = (env.DEPOT_OBJECT_URL_BASE || 'https://objects.xenosystem.ai').replace(/\/+$/, '');
    const expiry = Math.floor(now / 1000) + TOKEN_HOURS * 3600;
    const s = crypto.createHmac('sha256', key).update(uploadSignedString(session.id, session.object_key, session.multipart_id, session.part_count, session.part_size, expiry)).digest('hex');
    const q = new URLSearchParams({ k: session.object_key, u: session.multipart_id, c: String(session.part_count), z: String(session.part_size), e: String(expiry), s });
    return { kind: 'objects', partUrl: `${base}/up/${session.id}/{n}?${q}`, expiresAt: new Date(expiry * 1000).toISOString() };
  }
  return { kind: 'platform', partUrl: `/api/library/uploads/${session.id}/parts/{n}` };
}

const describe = (row) => ({
  id: row.id, name: row.name, mimeType: row.mime_type, size: Number(row.size_bytes), partSize: row.part_size,
  partCount: row.part_count, state: row.state, error: row.error || null, file: row.result || null,
  workspace: row.workspace_id || null, createdAt: row.created_at,
});

async function sessionFor(db, { userId, id }) {
  if (!UUID.test(String(id))) throw fail('not_found', 'No such upload', 404);
  const row = (await db.query('SELECT * FROM storage_upload_sessions WHERE id = $1 AND user_id = $2', [id, userId])).rows[0];
  if (!row) throw fail('not_found', 'No such upload', 404);
  return row;
}

async function freeDiskBytes(dir) {
  try { const s = await fs.promises.statfs(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

/** Open a session. Checks everything that can refuse the file before a byte is sent. */
export async function openUploadSession(db, { userId, workspaceId = null, name, mimeType, size, area = null }, { store = fileStorage(), env = process.env, uploadsDir } = {}) {
  const clean = path.basename(String(name || '')).trim();
  if (!clean || clean.length > 255) throw fail('bad_name', 'A file needs a name of at most 255 characters', 400);
  const type = String(mimeType || '').trim() || 'application/octet-stream';
  if (!ALLOWED_UPLOAD_MIMES.has(type)) throw fail('type_not_allowed', `Files of type '${type}' can’t be added yet`, 400);
  const bytes = Number(size);
  if (!Number.isInteger(bytes) || bytes < 1) throw fail('bad_size', 'The file is empty', 400);
  const cap = maxUploadBytes(env);
  if (bytes > cap) throw fail('too_large', `A file can be at most ${Math.round(cap / 1024 ** 3)} GB`, 413);
  if (workspaceId && !UUID.test(String(workspaceId))) throw fail('bad_workspace', 'Not a workspace', 400);
  if (workspaceId) {
    const ws = (await db.query('SELECT workspace_type, owner_user_id FROM workspaces WHERE id = $1', [workspaceId])).rows[0];
    if (!ws) throw fail('bad_workspace', 'No such workspace', 404);
    if (ws.workspace_type === 'personal') {
      if (String(ws.owner_user_id) !== String(userId)) throw fail('forbidden', 'You can’t add files to this workspace', 403);
    } else {
      const allowed = await check(db, { object: `workspace:${workspaceId}`, relation: 'editor', subject: `user:${userId}` });
      if (!allowed.allowed) throw fail('forbidden', 'You can’t add files to this workspace', 403);
    }
  }
  // the room is checked now (no reservation) and again when the file is registered
  const client = await db.connect();
  try { await client.query('BEGIN'); await assertStorageRoom(client, { userId, workspaceId, bytes }); }
  finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  if (uploadsDir) {
    const free = await freeDiskBytes(uploadsDir);
    if (free !== null && free - bytes < minFreeBytes(env)) throw fail('busy', 'XENO Storage can’t take a file this size right now. Try again later.', 503);
  }
  const id = crypto.randomUUID();
  const key = `uploads/${id}`;
  const partCount = Math.max(1, Math.ceil(bytes / PART_SIZE));
  const multipartId = await store.createMultipart(key);
  const { rows } = await db.query(
    `INSERT INTO storage_upload_sessions (id, user_id, workspace_id, name, mime_type, size_bytes, part_size, part_count, object_key, multipart_id, backend, area)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [id, userId, workspaceId, clean, type, bytes, PART_SIZE, partCount, key, multipartId, store.kind, area]);
  return { ...describe(rows[0]), parts: [], transport: transportFor(rows[0], { env, store }) };
}

/** The session, the parts the store already holds (resume), and a fresh token. */
export async function getUploadSession(db, { userId, id }, { store = fileStorage(), env = process.env } = {}) {
  const row = await sessionFor(db, { userId, id });
  const parts = row.state === 'uploading' ? ((await store.listParts(row.object_key, row.multipart_id)) || []) : [];
  return { ...describe(row), parts: parts.map((p) => ({ n: p.partNumber, size: p.size })), transport: row.state === 'uploading' ? transportFor(row, { env, store }) : null };
}

/** One part through this server (deployments without an objects host). */
export async function putUploadPart(db, { userId, id, partNumber, bytes }, { store = fileStorage() } = {}) {
  const row = await sessionFor(db, { userId, id });
  if (row.state !== 'uploading') throw fail('not_open', 'This upload is no longer open', 409);
  const n = Number(partNumber);
  if (!Number.isInteger(n) || n < 1 || n > row.part_count) throw fail('bad_part', 'No such part', 400);
  const expected = n < row.part_count ? row.part_size : Number(row.size_bytes) - (row.part_count - 1) * row.part_size;
  if (!Buffer.isBuffer(bytes) || bytes.length !== expected) throw fail('bad_part_size', `Part ${n} must be ${expected} bytes`, 400);
  return store.uploadPart(row.object_key, row.multipart_id, n, bytes);
}

/** Close the upload and start the work that turns it into a file. Answers at once; poll getUploadSession. */
export async function completeUploadSession(db, { userId, id }, { store = fileStorage(), uploadsDir, log = console } = {}) {
  const row = await sessionFor(db, { userId, id });
  if (row.state === 'done' || row.state === 'processing') return describe(row);
  if (row.state !== 'uploading') throw fail('not_open', 'This upload is no longer open', 409);
  const parts = (await store.listParts(row.object_key, row.multipart_id)) || [];
  const missing = [];
  for (let n = 1; n <= row.part_count; n += 1) if (!parts.find((p) => p.partNumber === n)) missing.push(n);
  if (missing.length) throw Object.assign(fail('incomplete', `${missing.length} part(s) have not arrived`, 409), { missing });
  const total = parts.reduce((s, p) => s + p.size, 0);
  if (total !== Number(row.size_bytes)) throw fail('size_mismatch', 'The parts don’t add up to the file’s size', 409);
  const claimed = await db.query("UPDATE storage_upload_sessions SET state = 'processing', updated_at = now() WHERE id = $1 AND state = 'uploading' RETURNING *", [id]);
  if (!claimed.rowCount) return describe(await sessionFor(db, { userId, id }));
  setImmediate(() => finishUpload(db, claimed.rows[0].id, { store, uploadsDir, log }).catch((e) => log.warn?.('[storage/uploads] finish:', e.message)));
  return describe(claimed.rows[0]);
}

/**
 * Turn a completed upload into a file. Idempotent: each step checks whether it already happened, so the sweep can run
 * it again after a restart. Marks the session `done` (with the same `file` shape POST /api/upload answers) or `failed`.
 */
export async function finishUpload(db, id, { store = fileStorage(), uploadsDir, log = console } = {}) {
  const row = (await db.query('SELECT * FROM storage_upload_sessions WHERE id = $1', [id])).rows[0];
  if (!row || row.state !== 'processing') return;
  let local = null;
  try {
    if (!(await store.head(row.object_key))) {
      const parts = (await store.listParts(row.object_key, row.multipart_id)) || [];
      await store.completeMultipart(row.object_key, row.multipart_id, parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));
    }
    const safe = row.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    local = path.join(uploadsDir, `${crypto.randomUUID()}-${safe}`);
    const got = await store.getToFile(row.object_key, local);
    if (!got || got.size !== Number(row.size_bytes)) throw new Error('the assembled file is not the size that was announced');
    const objectKey = fileObjectKey(got.sha256);
    if (!(await store.head(objectKey))) await store.copy(row.object_key, objectKey);   // inside the bucket
    const stored = await registerManagedLibraryFile(db, {
      userId: row.user_id, workspaceId: row.workspace_id, enforceAllowance: true,
      filename: path.basename(local), originalName: row.name, mimeType: row.mime_type, fileSize: got.size,
      storagePath: local, metadata: { source: 'upload', via: 'upload-session' }, area: row.area ?? null,
    });
    const head = await store.head(objectKey);
    if (head && head.sizeBytes === got.size) {
      await db.query(
        `INSERT INTO storage_objects (file_id, sha256, object_key, size_bytes, backend) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (file_id) DO NOTHING`, [stored.id, got.sha256, objectKey, got.size, store.kind]);
    }
    const result = { id: stored.id, fileId: stored.file_id ? String(stored.file_id) : null, name: row.name, size: got.size, type: row.mime_type };
    await db.query("UPDATE storage_upload_sessions SET state = 'done', result = $2, error = NULL, updated_at = now() WHERE id = $1", [id, result]);
    await store.delete(row.object_key).catch(() => {});
    local = null;   // the file is the Library's now
  } catch (error) {
    if (local) await fs.promises.unlink(local).catch(() => {});
    const message = error?.code === 'storage_full' ? 'Your storage is full' : 'The file couldn’t be added';
    log.warn?.('[storage/uploads] session', id, 'failed:', error.message);
    await db.query("UPDATE storage_upload_sessions SET state = 'failed', error = $2, updated_at = now() WHERE id = $1", [id, message]);
  }
}

/** Abort an open session and free its parts. Idempotent. */
export async function abortUploadSession(db, { userId, id }, { store = fileStorage() } = {}) {
  const row = await sessionFor(db, { userId, id });
  if (row.state !== 'uploading' && row.state !== 'failed') return describe(row);
  await store.abortMultipart(row.object_key, row.multipart_id).catch(() => {});
  await store.delete(row.object_key).catch(() => {});
  const { rows } = await db.query("UPDATE storage_upload_sessions SET state = 'aborted', updated_at = now() WHERE id = $1 RETURNING *", [id]);
  return describe(rows[0]);
}

/**
 * The sweeps: a `processing` session nobody touched for 15 minutes (its server restarted) is finished again, claimed
 * atomically so two replicas never run it together; an `uploading` session opened more than two days ago is aborted
 * (parts sent to the objects host never touch this server, so the age runs from creation; 5 GB at 1 Mbit/s is ~11 h).
 */
export async function sweepUploadSessions(db, { store = fileStorage(), uploadsDir, log = console } = {}) {
  const stuck = await db.query(
    `UPDATE storage_upload_sessions SET updated_at = now() WHERE id IN (
       SELECT id FROM storage_upload_sessions WHERE state = 'processing' AND updated_at < now() - interval '15 minutes' LIMIT 5
     ) RETURNING id`);
  for (const r of stuck.rows) await finishUpload(db, r.id, { store, uploadsDir, log });
  const idle = await db.query("SELECT id, user_id FROM storage_upload_sessions WHERE state = 'uploading' AND created_at < now() - interval '48 hours' LIMIT 50");
  for (const r of idle.rows) await abortUploadSession(db, { userId: r.user_id, id: r.id }, { store }).catch(() => {});
  return { resumed: stuck.rowCount, aborted: idle.rowCount };
}

export function startUploadSessionSweeps(db, { uploadsDir, everyMs = 5 * 60 * 1000, log = console } = {}) {
  const timer = setInterval(() => sweepUploadSessions(db, { uploadsDir, log }).catch((e) => log.warn?.('[storage/uploads] sweep:', e.message)), everyMs);
  timer.unref?.();
  return timer;
}
