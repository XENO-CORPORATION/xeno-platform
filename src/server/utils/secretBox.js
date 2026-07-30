/**
 * secretBox — authenticated encryption for secrets held at rest in Postgres.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-07-30 an audit of the live database found 100 YouTube OAuth
 * access/refresh tokens stored as plaintext `text` columns. Those tokens grant
 * upload and management access to real channels. Everything else checked out —
 * `api_keys` stores only `key_hash`, `user_sessions` only `*_token_hash`, and
 * `oauth_accounts` / `oauth_clients` / `webhooks` hold zero non-empty secrets —
 * so this is the one real at-rest exposure on the platform.
 *
 * It is also the prerequisite for BYOK. Accepting customers' own provider keys
 * into a store with no encryption would be worse than not offering the feature.
 *
 * DESIGN
 * ------
 * AES-256-GCM. Random 12-byte IV per value, 16-byte auth tag, all encoded into a
 * single self-describing string so no schema change is needed:
 *
 *     v1.<iv-b64>.<tag-b64>.<ciphertext-b64>
 *
 * The `v1.` prefix does three things:
 *   1. makes a stored value trivially identifiable as encrypted;
 *   2. lets `decrypt()` pass legacy plaintext through untouched, so this can be
 *      deployed BEFORE the rows are migrated and nothing breaks in between;
 *   3. leaves room to rotate to v2 without guessing at old values.
 *
 * GCM, not CBC: it authenticates. A tampered ciphertext throws rather than
 * decrypting to garbage that then gets sent to Google as a bearer token.
 *
 * KEY
 * ---
 * `SECRET_BOX_KEY` — 32 bytes, base64 or hex. Generate with:
 *     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * ⚠ Losing this key means the encrypted tokens are unrecoverable and every
 *   affected channel must be reconnected. Back it up where you back up nothing
 *   else — not in this repo, not in the database it protects.
 *
 * FAIL-CLOSED
 * -----------
 * `encrypt()` THROWS when the key is absent. It deliberately does not fall back
 * to storing plaintext: a silent fallback is how a column ends up looking
 * protected while holding cleartext, which is the exact failure this module was
 * written to correct.
 */

import crypto from 'node:crypto';

const PREFIX = 'v1.';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey = null;
let cachedRaw = null;

/** Decode SECRET_BOX_KEY (base64 or hex) into a 32-byte Buffer. */
function loadKey() {
  const raw = process.env.SECRET_BOX_KEY || '';
  if (!raw) return null;
  // Cache per raw value so a changed env var in a test is picked up.
  if (cachedKey && cachedRaw === raw) return cachedKey;

  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    try { buf = Buffer.from(raw, 'base64'); } catch { buf = null; }
  }
  if (!buf || buf.length !== KEY_BYTES) {
    throw new Error(`SECRET_BOX_KEY must decode to ${KEY_BYTES} bytes (got ${buf ? buf.length : 0})`);
  }
  cachedKey = buf;
  cachedRaw = raw;
  return buf;
}

/** True when a usable key is configured. */
export function isConfigured() {
  try { return loadKey() !== null; } catch { return false; }
}

/** True when `value` is already in the encrypted envelope format. */
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypt a secret. Throws if no key is configured — see FAIL-CLOSED above.
 * null/undefined/'' pass through unchanged so optional columns stay nullable.
 */
export function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  if (isEncrypted(plaintext)) return plaintext; // already sealed — idempotent

  const key = loadKey();
  if (!key) {
    throw new Error('SECRET_BOX_KEY is not configured — refusing to store a secret in plaintext');
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

/**
 * Decrypt a value.
 *
 * A value without the envelope prefix is LEGACY PLAINTEXT and is returned as-is.
 * That is what makes this deployable before the backfill: reads keep working on
 * un-migrated rows. Once every row is encrypted, that branch simply stops being
 * reached. It throws on a malformed or tampered envelope rather than returning
 * something that would then be used as a bearer token.
 */
export function decrypt(value) {
  if (value === null || value === undefined || value === '') return value;
  if (!isEncrypted(value)) return value; // legacy plaintext, pre-backfill

  const key = loadKey();
  if (!key) {
    throw new Error('SECRET_BOX_KEY is not configured — cannot decrypt a stored secret');
  }

  const parts = String(value).slice(PREFIX.length).split('.');
  if (parts.length !== 3) throw new Error('secretBox: malformed envelope');

  const [ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export default { encrypt, decrypt, isEncrypted, isConfigured };
