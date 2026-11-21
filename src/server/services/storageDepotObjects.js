/**
 * XENO Storage: the Depot namespace (xeno-depot decision 0001 §4, "file contents go through XENO Storage, never a
 * second R2 client in Depot").
 *
 * XENO Depot's server (Epic's Lore, MIT) keeps content-addressed, write-once objects: file fragments, revision
 * states, tree nodes, metadata blobs, each at most 256 KiB. This module is the store behind them. The interface is
 * shaped from Lore's own S3 store (`lore-aws`): put an object with one small metadata value, read it whole or by
 * range, ask which of a batch of hashes are present.
 *
 * The rules:
 *   - Per workspace. Object key `depot/<workspace-id>/<aa>/<hash>`; the same hash in two workspaces is two
 *     objects, so no tenant reads or poisons another's content (Lore: a hash never matches across partitions).
 *   - Written once. A second put of the same bytes is a no-op answer; a second put of DIFFERENT bytes under the
 *     same name is refused (`object_conflict`) and the first object stays. Nothing here overwrites; the only
 *     removal is `deleteDepotObject`, called by Depot once its own metadata says nothing references the hash.
 *   - The hash is Depot's name for the object (BLAKE3, opaque here: a payload can be compressed, so its bytes do
 *     not hash to the content's name). The wire check is the SHA-256 of the body, declared by the caller and
 *     recomputed here.
 *   - Metered on the workspace's pool (storageAllowance.js reads these rows, kind `depot`). New objects are
 *     refused when the pool is full (507); reads always work.
 *   - A row means the object was written AND read back at its size (storageObjects.js's rule).
 */
import crypto from 'node:crypto';
import { fileStorage } from './artifactStorage.js';
import { assertStorageRoom, StorageFullError } from './storageAllowance.js';

export const MAX_DEPOT_OBJECT_BYTES = 1024 * 1024;   // Lore's fragment cap is 256 KiB; the margin is for framing
export const MAX_META_LENGTH = 1024;
export const MAX_EXISTS_BATCH = 1000;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// printable ASCII only: the value travels back as an HTTP header
const META = /^[\x20-\x7e]*$/;

export const depotObjectKey = (workspaceId, hash) => `depot/${workspaceId}/${hash.slice(0, 2)}/${hash}`;

const fail = (code, message, status) => Object.assign(new Error(message), { code, status });
const sha256Hex = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function assertWorkspaceId(workspaceId) {
  if (!UUID.test(String(workspaceId))) throw fail('bad_workspace', 'workspace id must be a UUID', 400);
}
export function assertHash(hash) {
  if (!HEX64.test(String(hash))) throw fail('bad_hash', 'object hash must be 64 lowercase hex characters', 400);
}

/** Run `work(tx)` on one connection in a transaction; `commit: false` always rolls back (a check, not a write). */
async function inTransaction(db, work, { commit = true } = {}) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

/** The workspace's own Depot allowance in bytes, or null when its Depot content counts in the plan pool. */
export async function depotAllowance(db, workspaceId) {
  const row = (await db.query('SELECT bytes FROM storage_depot_allowances WHERE workspace_id = $1', [workspaceId])).rows[0];
  return row ? Number(row.bytes) : null;
}

/**
 * Refuse `bytes` more Depot content that would not fit. Call INSIDE a transaction. A workspace with its own Depot
 * allowance is checked against it under its own lock; otherwise against the plan pool (assertStorageRoom).
 */
export async function assertDepotRoom(tx, workspaceId, bytes) {
  const cap = await depotAllowance(tx, workspaceId);
  if (cap === null) return assertStorageRoom(tx, { workspaceId, bytes });
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`storage:depot:${workspaceId}`]);
  const used = Number((await tx.query('SELECT COALESCE(SUM(size_bytes), 0)::bigint AS b FROM storage_depot_objects WHERE workspace_id = $1', [workspaceId])).rows[0].b);
  if (used + Number(bytes) > cap) throw new StorageFullError(used, cap, Number(bytes));
}

async function workspaceExists(db, workspaceId) {
  return (await db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId])).rowCount > 0;
}

async function rowFor(db, workspaceId, hash) {
  return (await db.query(
    'SELECT hash, payload_sha256, size_bytes, meta, object_key FROM storage_depot_objects WHERE workspace_id = $1 AND hash = $2',
    [workspaceId, hash])).rows[0] || null;
}

const describe = (row) => ({ hash: row.hash, size: Number(row.size_bytes), sha256: row.payload_sha256, meta: row.meta ?? null });

/**
 * Put-if-absent. Returns `{ created, object }`; `created` is false when the same bytes were already there.
 * Throws `bad_digest` (400), `too_large` (413), `object_conflict` (409), `storage_full` (507), `no_workspace` (404).
 */
export async function putDepotObject(db, { workspaceId, hash, bytes, sha256, meta = null }, { store = fileStorage() } = {}) {
  assertWorkspaceId(workspaceId); assertHash(hash);
  if (!Buffer.isBuffer(bytes)) throw fail('bad_body', 'the body must be the object bytes', 400);
  if (bytes.length > MAX_DEPOT_OBJECT_BYTES) throw fail('too_large', `an object is at most ${MAX_DEPOT_OBJECT_BYTES} bytes`, 413);
  if (!HEX64.test(String(sha256 || ''))) throw fail('bad_digest', 'X-Content-SHA256 (64 lowercase hex) is required', 400);
  const actual = sha256Hex(bytes);
  if (actual !== sha256) throw fail('bad_digest', 'the body does not match X-Content-SHA256', 400);
  if (meta !== null && (typeof meta !== 'string' || meta.length > MAX_META_LENGTH || !META.test(meta))) {
    throw fail('bad_meta', `object meta is printable ASCII, at most ${MAX_META_LENGTH} characters`, 400);
  }

  const existing = await rowFor(db, workspaceId, hash);
  if (existing) {
    if (existing.payload_sha256 !== actual) throw fail('object_conflict', 'an object with this hash already holds different bytes', 409);
    return { created: false, object: describe(existing) };
  }
  if (!(await workspaceExists(db, workspaceId))) throw fail('no_workspace', 'no such workspace', 404);

  // Cheap refusal before any bytes leave this process; the binding check is the locked one below.
  await inTransaction(db, (tx) => assertDepotRoom(tx, workspaceId, bytes.length), { commit: false });

  // The object first (outside any lock, so a workspace's pushes do not queue behind one R2 call), then its row.
  // A row is never written for bytes that are not in the store; an object refused for room afterwards stays
  // unrecorded and unmetered, and the next identical put adopts it.
  const key = depotObjectKey(workspaceId, hash);
  if (!(await store.putNew(key, bytes))) {
    // Already in the store with no row: an earlier write that never reached its row, or a racing writer.
    // Accept it only if it is these exact bytes; a stranger's bytes under this name are never adopted.
    const there = await store.get(key);
    if (!there || sha256Hex(there) !== actual) throw fail('object_conflict', 'an object with this hash already holds different bytes', 409);
  }
  const head = await store.head(key);   // read back: a copy that cannot be found is not a copy
  if (!head || head.sizeBytes !== bytes.length) throw fail('verify_failed', 'object store did not return the object at its size', 502);

  const inserted = await inTransaction(db, async (tx) => {
    await assertDepotRoom(tx, workspaceId, bytes.length);   // takes the pool's (or the Depot allowance's) lock
    return tx.query(
      `INSERT INTO storage_depot_objects (workspace_id, hash, payload_sha256, size_bytes, meta, object_key, backend)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (workspace_id, hash) DO NOTHING RETURNING hash`,
      [workspaceId, hash, actual, bytes.length, meta, key, store.kind]);
  });
  if (inserted.rowCount) return { created: true, object: { hash, size: bytes.length, sha256: actual, meta } };

  // A racing writer recorded the same name first: same bytes is the idempotent answer, different is refused.
  const winner = await rowFor(db, workspaceId, hash);
  if (winner?.payload_sha256 !== actual) throw fail('object_conflict', 'an object with this hash already holds different bytes', 409);
  return { created: false, object: describe(winner) };
}

/** The object's record, or null. */
export async function headDepotObject(db, { workspaceId, hash }) {
  assertWorkspaceId(workspaceId); assertHash(hash);
  const row = await rowFor(db, workspaceId, hash);
  return row ? describe(row) : null;
}

/**
 * The object's bytes, whole or `range` = { start, end } inclusive (end clamped to the object). Returns
 * `{ object, bytes, start, end }` or null when absent. Throws `range_not_satisfiable` (416).
 */
export async function getDepotObject(db, { workspaceId, hash, range = null }, { store = fileStorage() } = {}) {
  assertWorkspaceId(workspaceId); assertHash(hash);
  const row = await rowFor(db, workspaceId, hash);
  if (!row) return null;
  const object = describe(row);
  if (range) {
    const end = Math.min(range.end ?? object.size - 1, object.size - 1);
    if (range.start >= object.size || range.start > end) throw Object.assign(fail('range_not_satisfiable', 'range outside the object', 416), { size: object.size });
    const bytes = await store.getRange(row.object_key, range.start, end);
    if (!bytes || bytes.length !== end - range.start + 1) throw fail('object_missing', 'the object store did not return the recorded range', 502);
    return { object, bytes, start: range.start, end };
  }
  const bytes = await store.get(row.object_key);
  if (!bytes || bytes.length !== object.size || sha256Hex(bytes) !== object.sha256) throw fail('object_missing', 'the object store did not return the recorded object', 502);
  return { object, bytes, start: 0, end: object.size - 1 };
}

/** Which of `hashes` the workspace holds: `{ present: { <hash>: { size, meta } }, absent: [...] }`. */
export async function depotObjectsExist(db, { workspaceId, hashes }) {
  assertWorkspaceId(workspaceId);
  if (!Array.isArray(hashes)) throw fail('bad_body', '`hashes` must be an array', 400);
  if (hashes.length > MAX_EXISTS_BATCH) throw fail('too_many', `at most ${MAX_EXISTS_BATCH} hashes per call`, 400);
  const unique = [...new Set(hashes)];
  unique.forEach(assertHash);
  const { rows } = unique.length ? await db.query(
    'SELECT hash, size_bytes, meta FROM storage_depot_objects WHERE workspace_id = $1 AND hash = ANY($2::text[])', [workspaceId, unique]) : { rows: [] };
  const present = Object.fromEntries(rows.map((r) => [r.hash, { size: Number(r.size_bytes), meta: r.meta ?? null }]));
  return { present, absent: unique.filter((h) => !present[h]) };
}

/**
 * Remove an object Depot no longer references (Lore's obliterate: Depot deletes the association in its own
 * metadata store, decides nothing in any partition still points at the hash, then calls this). Idempotent:
 * returns false when there was nothing to remove.
 *
 * The row goes first, so the bytes stop being served and metered at once; the object after. A failed object
 * removal leaves unrecorded bytes that a later put of the same content adopts (putDepotObject's `putNew` path),
 * so nothing is left half-visible. This is the ONE delete in XENO Storage that is driven by its caller: Depot owns
 * the reference set of its own content. Library files are still never deleted here (rule 8).
 */
export async function deleteDepotObject(db, { workspaceId, hash }, { store = fileStorage(), log = console } = {}) {
  assertWorkspaceId(workspaceId); assertHash(hash);
  const removed = await db.query('DELETE FROM storage_depot_objects WHERE workspace_id = $1 AND hash = $2 RETURNING object_key', [workspaceId, hash]);
  if (!removed.rowCount) return false;
  try { await store.delete(removed.rows[0].object_key); }
  catch (error) { log.warn?.('[storage/depot] object removal failed; the bytes stay unrecorded:', hash, error.message); }
  return true;
}

export const MAX_URL_TTL_SECONDS = 300;
export const depotUrlSignedString = (workspaceId, hash, expiry) => `depot:v1\n${workspaceId}\n${hash}\n${expiry}`;

/**
 * Short-lived read URLs on the objects host (xeno-storage `workers/objects`, objects.xenosystem.ai), so a clone
 * reads straight from R2 at the edge instead of through this backend. Only an object recorded in THIS workspace
 * gets a URL; the signature binds workspace, hash and expiry (HMAC-SHA256, key DEPOT_OBJECT_URL_KEY, the same
 * value the Worker holds). Returns `{ urls: { <hash>: { url, size, sha256, meta } }, absent, expiresAt }`.
 * Throws `not_configured` (503) when no key is set, so a missing secret never yields unsigned URLs.
 */
export async function signDepotObjectUrls(db, { workspaceId, hashes, ttlSeconds = MAX_URL_TTL_SECONDS }, { env = process.env, now = Date.now() } = {}) {
  assertWorkspaceId(workspaceId);
  const key = (env.DEPOT_OBJECT_URL_KEY || '').trim();
  if (!key) throw fail('not_configured', 'signed object URLs are not configured on this server', 503);
  const ttl = Number(ttlSeconds);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_URL_TTL_SECONDS) throw fail('bad_ttl', `ttl is 1..${MAX_URL_TTL_SECONDS} seconds`, 400);
  const base = (env.DEPOT_OBJECT_URL_BASE || 'https://objects.xenosystem.ai').replace(/\/+$/, '');
  const { present, absent } = await depotObjectsExist(db, { workspaceId, hashes });
  const rows = Object.keys(present).length ? (await db.query(
    'SELECT hash, payload_sha256 FROM storage_depot_objects WHERE workspace_id = $1 AND hash = ANY($2::text[])', [workspaceId, Object.keys(present)])).rows : [];
  const shaOf = Object.fromEntries(rows.map((r) => [r.hash, r.payload_sha256]));
  const expiry = Math.floor(now / 1000) + ttl;
  const urls = {};
  for (const [hash, info] of Object.entries(present)) {
    const sig = crypto.createHmac('sha256', key).update(depotUrlSignedString(workspaceId, hash, expiry)).digest('hex');
    urls[hash] = { url: `${base}/d/${workspaceId}/${hash}?e=${expiry}&s=${sig}`, size: info.size, sha256: shaOf[hash], meta: info.meta };
  }
  return { urls, absent, expiresAt: new Date(expiry * 1000).toISOString() };
}

// ── uploads through the objects host: bytes go client → edge → R2, never through this backend ──
// Measured 2026-11-21: through the backend, PUT was flat at ~1.5 MB/s whatever the concurrency, because the box's office
// uplink (2.8–3.4 MB/s) carried every byte twice; the locked allowance section was 4.5 ms p50, not the limit.
export const MAX_UPLOAD_BATCH = 1000;
export const depotPutSignedString = (workspaceId, hash, sha256, size, expiry, meta) =>
  `depot:v1:put\n${workspaceId}\n${hash}\n${sha256}\n${size}\n${expiry}\n${meta}`;
export const depotReceiptString = (workspaceId, hash, sha256, size, meta) => `depot:v1:stored\n${workspaceId}\n${hash}\n${sha256}\n${size}\n${meta}`;

function urlKey(env) {
  const key = (env.DEPOT_OBJECT_URL_KEY || '').trim();
  if (!key) throw fail('not_configured', 'signed object URLs are not configured on this server', 503);
  return key;
}

/** Validate a batch of `{ hash, size, sha256, meta }` descriptions; returns them normalised. */
function uploadBatch(objects) {
  if (!Array.isArray(objects) || !objects.length) throw fail('bad_body', '`objects` must be a non-empty array', 400);
  if (objects.length > MAX_UPLOAD_BATCH) throw fail('too_many', `at most ${MAX_UPLOAD_BATCH} objects per call`, 400);
  const seen = new Set();
  return objects.map((o) => {
    assertHash(o?.hash);
    if (seen.has(o.hash)) throw fail('bad_body', `hash ${o.hash} appears twice`, 400);
    seen.add(o.hash);
    const size = Number(o.size), sha256 = String(o.sha256 || '').toLowerCase(), meta = o.meta ?? '';
    if (!Number.isInteger(size) || size < 0 || size > MAX_DEPOT_OBJECT_BYTES) throw fail('too_large', `size is 0..${MAX_DEPOT_OBJECT_BYTES}`, 400);
    if (!HEX64.test(sha256)) throw fail('bad_digest', 'sha256 (64 lowercase hex) is required', 400);
    if (typeof meta !== 'string' || meta.length > MAX_META_LENGTH || !META.test(meta)) throw fail('bad_meta', `meta is printable ASCII, at most ${MAX_META_LENGTH} characters`, 400);
    return { hash: o.hash, size, sha256, meta, receipt: o.receipt };
  });
}

async function existingShas(db, workspaceId, hashes) {
  const { rows } = await db.query('SELECT hash, payload_sha256 FROM storage_depot_objects WHERE workspace_id = $1 AND hash = ANY($2::text[])', [workspaceId, hashes]);
  return new Map(rows.map((r) => [r.hash, r.payload_sha256]));
}

/**
 * Signed PUT URLs for a batch. Objects already recorded with the same bytes need no upload (`present`); a name already
 * holding different bytes is a `conflict`. The room check covers the batch's new bytes (no reservation: the binding
 * check is at commit). Returns `{ urls: { <hash>: url }, present, conflicts, expiresAt }`.
 */
export async function signDepotUploadUrls(db, { workspaceId, objects, ttlSeconds = MAX_URL_TTL_SECONDS }, { env = process.env, now = Date.now() } = {}) {
  assertWorkspaceId(workspaceId);
  const key = urlKey(env);
  const ttl = Number(ttlSeconds);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_URL_TTL_SECONDS) throw fail('bad_ttl', `ttl is 1..${MAX_URL_TTL_SECONDS} seconds`, 400);
  const batch = uploadBatch(objects);
  if (!(await workspaceExists(db, workspaceId))) throw fail('no_workspace', 'no such workspace', 404);
  const known = await existingShas(db, workspaceId, batch.map((o) => o.hash));
  const present = [], conflicts = [], wanted = [];
  for (const o of batch) {
    const sha = known.get(o.hash);
    if (sha === undefined) wanted.push(o); else if (sha === o.sha256) present.push(o.hash); else conflicts.push(o.hash);
  }
  const newBytes = wanted.reduce((n, o) => n + o.size, 0);
  if (newBytes) await inTransaction(db, (tx) => assertDepotRoom(tx, workspaceId, newBytes), { commit: false });
  const base = (env.DEPOT_OBJECT_URL_BASE || 'https://objects.xenosystem.ai').replace(/\/+$/, '');
  const expiry = Math.floor(now / 1000) + ttl;
  const urls = {};
  for (const o of wanted) {
    const sig = crypto.createHmac('sha256', key).update(depotPutSignedString(workspaceId, o.hash, o.sha256, o.size, expiry, o.meta)).digest('hex');
    urls[o.hash] = `${base}/d/${workspaceId}/${o.hash}?e=${expiry}&sha=${o.sha256}&n=${o.size}&m=${encodeURIComponent(o.meta)}&s=${sig}`;
  }
  return { urls, present, conflicts, expiresAt: new Date(expiry * 1000).toISOString() };
}

/**
 * Record a batch the objects host stored. Each object carries the Worker's receipt (HMAC over workspace, hash, sha256,
 * size, meta), so a row is only ever written for bytes the edge verified, without this backend touching R2. One locked
 * room check for the batch, one insert. Returns `{ committed, existing, conflicts }`; throws `bad_receipt` (400) and
 * `storage_full` (507) for the whole batch.
 */
export async function commitDepotObjects(db, { workspaceId, objects }, { env = process.env, store = fileStorage() } = {}) {
  assertWorkspaceId(workspaceId);
  const key = urlKey(env);
  const batch = uploadBatch(objects);
  for (const o of batch) {
    const expected = crypto.createHmac('sha256', key).update(depotReceiptString(workspaceId, o.hash, o.sha256, o.size, o.meta)).digest();
    const given = /^[0-9a-f]{64}$/.test(String(o.receipt || '')) ? Buffer.from(o.receipt, 'hex') : Buffer.alloc(0);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw fail('bad_receipt', `object ${o.hash} has no valid receipt from the objects host`, 400);
  }
  if (!(await workspaceExists(db, workspaceId))) throw fail('no_workspace', 'no such workspace', 404);
  const known = await existingShas(db, workspaceId, batch.map((o) => o.hash));
  const fresh = batch.filter((o) => !known.has(o.hash));
  const inserted = new Set();
  if (fresh.length) {
    await inTransaction(db, async (tx) => {
      await assertDepotRoom(tx, workspaceId, fresh.reduce((n, o) => n + o.size, 0));   // takes the pool's lock
      const { rows } = await tx.query(
        `INSERT INTO storage_depot_objects (workspace_id, hash, payload_sha256, size_bytes, meta, object_key, backend)
         SELECT $1::uuid, x.hash, x.sha, x.size, NULLIF(x.meta, ''), 'depot/' || $1::text || '/' || substr(x.hash, 1, 2) || '/' || x.hash, $2
           FROM unnest($3::text[], $4::text[], $5::bigint[], $6::text[]) AS x(hash, sha, size, meta)
         ON CONFLICT (workspace_id, hash) DO NOTHING RETURNING hash`,
        [workspaceId, store.kind, fresh.map((o) => o.hash), fresh.map((o) => o.sha256), fresh.map((o) => o.size), fresh.map((o) => o.meta)]);
      rows.forEach((r) => inserted.add(r.hash));
    });
  }
  const after = await existingShas(db, workspaceId, batch.filter((o) => !inserted.has(o.hash)).map((o) => o.hash));
  const committed = [...inserted], existing = [], conflicts = [];
  for (const o of batch) {
    if (inserted.has(o.hash)) continue;
    if (after.get(o.hash) === o.sha256) existing.push(o.hash); else conflicts.push(o.hash);
  }
  return { committed, existing, conflicts };
}

/** What Depot holds in a workspace: `{ bytes, objects }`. */
export async function depotUsage(db, workspaceId) {
  assertWorkspaceId(workspaceId);
  const { rows } = await db.query(
    'SELECT COALESCE(SUM(size_bytes), 0)::bigint AS bytes, COUNT(*)::int AS objects FROM storage_depot_objects WHERE workspace_id = $1', [workspaceId]);
  return { bytes: Number(rows[0].bytes), objects: rows[0].objects };
}
