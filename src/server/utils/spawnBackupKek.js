/**
 * The platform key that wraps a Spawn backup's data key in standard mode (the iCloud model; wrap type 0x03).
 *
 * SPAWN_BACKUP_KEK: 32 bytes (64 hex characters or base64/base64url), in the backend's environment and the secrets store,
 * never in the database or in Storage. It is its own key, apart from SECRET_BOX_KEY, so a leak of one exposes neither the
 * other nor the backups. SPAWN_BACKUP_KEK_VERSION names it (default 1); a wrap records the version it was made with.
 *
 * AES-256-GCM. The additional data binds a wrap to its account, its row and its key version, so a wrap copied to another
 * account, another row or relabelled with another version does not open.
 *
 * FAIL-CLOSED: with no key configured nothing is wrapped or unwrapped; callers answer 503, never store the data key bare.
 * ⚠ Losing the key makes every standard-mode backup unreadable: it must be kept in a second place off the VM.
 */
import crypto from 'node:crypto';

const FORMAT = 1; // byte 0 of a wrap: this layout (version, 12-byte iv, 16-byte tag, ciphertext)

export class KekUnavailableError extends Error {
  constructor() { super('the backup key service is not configured'); this.code = 'kek_unavailable'; }
}

function parseKey(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, 'hex');
  const b = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return b.length === 32 ? b : null;
}

/** The configured key and its version, or null. Read on each call, so a rotated environment takes effect on restart. */
export function currentKek(env = process.env) {
  const key = parseKey(env.SPAWN_BACKUP_KEK);
  if (!key) return null;
  const version = Number.parseInt(env.SPAWN_BACKUP_KEK_VERSION || '1', 10);
  return { key, version: Number.isInteger(version) && version >= 1 ? version : 1 };
}

const aadOf = ({ userId, wrapId, version }) => Buffer.from(`xeno-spawn-backup-account-wrap|v${FORMAT}|${userId}|${wrapId}|kek${version}`);

/** Wrap a 32-byte data key. Returns { wrapped (base64url), version }. */
export function wrapDataKey(dataKey, { userId, wrapId }, env = process.env) {
  const kek = currentKek(env);
  if (!kek) throw new KekUnavailableError();
  if (!Buffer.isBuffer(dataKey) || dataKey.length !== 32) throw new Error('a data key is 32 bytes');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek.key, iv);
  cipher.setAAD(aadOf({ userId, wrapId, version: kek.version }));
  const ct = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  const wrapped = Buffer.concat([Buffer.from([FORMAT]), iv, cipher.getAuthTag(), ct]).toString('base64url');
  return { wrapped, version: kek.version };
}

/** Unwrap; throws on any mismatch (wrong account, row, version or key). Only the CURRENT key version can open a wrap. */
export function unwrapDataKey(wrapped, { userId, wrapId, version }, env = process.env) {
  const kek = currentKek(env);
  if (!kek) throw new KekUnavailableError();
  if (kek.version !== version) throw new Error(`this wrap was made with key version ${version}; the configured key is version ${kek.version}`);
  const buf = Buffer.from(String(wrapped), 'base64url');
  if (buf.length !== 1 + 12 + 16 + 32 || buf[0] !== FORMAT) throw new Error('not an account wrap');
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek.key, buf.subarray(1, 13));
  decipher.setAAD(aadOf({ userId, wrapId, version }));
  decipher.setAuthTag(buf.subarray(13, 29));
  return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]);
}
