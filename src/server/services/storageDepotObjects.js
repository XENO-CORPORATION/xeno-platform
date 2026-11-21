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
import { assertStorageRoom } from './storageAllowance.js';

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
  await inTransaction(db, (tx) => assertStorageRoom(tx, { workspaceId, bytes: bytes.length }), { commit: false });

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
    await assertStorageRoom(tx, { workspaceId, bytes: bytes.length });   // takes the pool's lock
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

/** What Depot holds in a workspace: `{ bytes, objects }`. */
export async function depotUsage(db, workspaceId) {
  assertWorkspaceId(workspaceId);
  const { rows } = await db.query(
    'SELECT COALESCE(SUM(size_bytes), 0)::bigint AS bytes, COUNT(*)::int AS objects FROM storage_depot_objects WHERE workspace_id = $1', [workspaceId]);
  return { bytes: Number(rows[0].bytes), objects: rows[0].objects };
}
