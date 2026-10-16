/**
 * XENO Storage: retry-safe writes (xeno-storage/SPEC.md §7.3, "Restore and retry contract"; migration
 * 20261016200000). Stripe's idempotency model, narrowed to the three writes Storage makes: an upload, a new version,
 * a restore.
 *
 *   run(db, { userId, key, route, binding, apply }) — `apply` performs the write and returns { status, body } for a
 *   committed outcome, or throws / returns a non-2xx for one that did not commit. Under one advisory lock per
 *   (person, key): a recorded outcome with the SAME binding is returned as it was ({ replayed: true }); a different
 *   binding is a conflict; otherwise `apply` runs and a 2xx outcome is recorded. Nothing that failed is recorded.
 *   lookup(db, userId, key) — what became of a key, for a client whose reply was lost: committed (with the response)
 *   or unknown. Nothing is ever replayed on the server's side.
 *
 * The key itself is never stored or logged, only its hash.
 */
import crypto from 'node:crypto';

export const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;
const RETENTION = '24 hours';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const bindingHash = (parts) => sha(JSON.stringify(parts));

export class IdempotencyError extends Error { constructor(message, code, status) { super(message); this.code = code; this.status = status; } }

/** The key a request carries, or null when it carries none; an unusable one is refused. */
export function keyFrom(req) {
  const raw = req.get?.('idempotency-key') ?? req.headers?.['idempotency-key'];
  if (raw === undefined || raw === null || raw === '') return null;
  if (!KEY_RE.test(String(raw))) throw new IdempotencyError('An Idempotency-Key is 16 to 128 letters, digits, - or _.', 'invalid_idempotency_key', 400);
  return String(raw);
}

/** The SHA-256 of a file the server accepted (its real bytes, never a size a client claimed). */
export async function fileFingerprint(filePath) {
  const fs = await import('node:fs');
  return new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(filePath).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex'))); });
}

export async function run(db, { userId, key, route, binding, apply }) {
  if (!key) return { ...(await apply(db)), replayed: false };
  const keySha = sha(key), bindingSha = bindingHash({ route, ...binding });
  const client = typeof db.connect === 'function' ? await db.connect() : db, own = client !== db;
  try {
    // the lock serializes this key only; it is held for the whole write so a twin request waits and then sees the
    // first one's outcome. It is a session lock (the write may run several transactions of its own).
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [`storage-op:${userId}:${keySha}`]);
    try {
      const prior = (await client.query(`SELECT route, binding_sha256, status, response FROM storage_operations
          WHERE user_id = $1 AND key_sha256 = $2 AND created_at > now() - interval '${RETENTION}'`, [userId, keySha])).rows[0];
      if (prior) {
        if (prior.binding_sha256 !== bindingSha) throw new IdempotencyError('That Idempotency-Key was already used for a different request.', 'idempotency_key_mismatch', 409);
        return { status: prior.status, body: prior.response, replayed: true };
      }
      const outcome = await apply(db);
      if (outcome && outcome.status >= 200 && outcome.status < 300) {
        await client.query(`INSERT INTO storage_operations (user_id, key_sha256, route, binding_sha256, status, response) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (user_id, key_sha256) DO UPDATE SET route = EXCLUDED.route, binding_sha256 = EXCLUDED.binding_sha256, status = EXCLUDED.status,
            response = EXCLUDED.response, created_at = now() WHERE storage_operations.created_at <= now() - interval '${RETENTION}'`,
          [userId, keySha, route, bindingSha, outcome.status, JSON.stringify(outcome.body)]);
      }
      return { ...outcome, replayed: false };
    } finally { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`storage-op:${userId}:${keySha}`]).catch(() => {}); }
  } finally { if (own) client.release(); }
}

export async function lookup(db, userId, key) {
  if (!KEY_RE.test(String(key || ''))) throw new IdempotencyError('An Idempotency-Key is 16 to 128 letters, digits, - or _.', 'invalid_idempotency_key', 400);
  const row = (await db.query(`SELECT route, status, response, created_at FROM storage_operations
      WHERE user_id = $1 AND key_sha256 = $2 AND created_at > now() - interval '${RETENTION}'`, [userId, sha(key)])).rows[0];
  return row ? { state: 'committed', route: row.route, status: row.status, response: row.response, committedAt: row.created_at } : { state: 'unknown' };
}

/** Forget records past retention. Run by the storage sweep. */
export async function sweep(db) {
  return (await db.query(`DELETE FROM storage_operations WHERE created_at <= now() - interval '${RETENTION}'`)).rowCount;
}
