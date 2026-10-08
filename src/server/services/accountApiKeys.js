/**
 * Personal API keys: the keys a person makes for their own account, for the CLI and their scripts.
 *
 * They live in the same `api_keys` table every XENO service already authenticates against
 * (middleware/auth.js resolveApiKeyUser, and the gateway's own lookup), in the same at-rest form:
 * the first 16 characters as a prefix, plus sha256 of the whole key. Nothing here changes how a
 * key is checked; this only lets a person make, see, rename and revoke their own.
 *
 * - The key is shown once, when it is made. Only its hash is stored, so a lost key is replaced,
 *   never recovered.
 * - A person's own keys only. An agent's keys belong to the agent's own user row and are managed
 *   at /api/v2/agents, so they never appear here.
 * - Revoking keeps the row (is_active = false) so usage records still name the key they came from.
 */
import crypto from 'crypto';

export const MAX_ACTIVE_KEYS = 20;
export const EXPIRY_DAYS = Object.freeze([null, 30, 90, 365]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cleanKeyName(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const name = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  return name && name.length <= 100 ? name : null;
}

const view = (row) => ({
  id: row.id,
  name: row.name,
  // enough to recognise a key in a list, never enough to use it
  preview: `${row.key_prefix}…`,
  is_active: row.is_active === true && !(row.expires_at && new Date(row.expires_at) < new Date()),
  revoked: row.is_active !== true,
  expired: Boolean(row.expires_at && new Date(row.expires_at) < new Date()),
  created_at: row.created_at,
  expires_at: row.expires_at,
  last_used_at: row.last_used_at,
  usage_count: Number(row.usage_count) || 0,
});
const COLUMNS = 'id, name, key_prefix, is_active, created_at, expires_at, last_used_at, usage_count';

export async function listApiKeys(db, userId) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM api_keys WHERE user_id = $1 ORDER BY is_active DESC, created_at DESC`, [userId]);
  return rows.map(view);
}

export async function createApiKey(db, { userId, name, expiresInDays = null }) {
  const clean = cleanKeyName(name);
  if (!clean) return { invalid: true, code: 'invalid_name' };
  const days = expiresInDays == null ? null : Number(expiresInDays);
  if (!EXPIRY_DAYS.includes(days)) return { invalid: true, code: 'invalid_expiry' };
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    // Lock the account row so two requests cannot both pass the count.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const active = await client.query(
      `SELECT count(*)::int AS n FROM api_keys WHERE user_id = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId],
    );
    if (active.rows[0].n >= MAX_ACTIVE_KEYS) { await client.query('ROLLBACK'); return { conflict: true, code: 'too_many_keys', limit: MAX_ACTIVE_KEYS }; }
    // The canonical form the gateway mints: `xeno-` + 48 hex characters (192 bits).
    const raw = `xeno-${crypto.randomBytes(24).toString('hex')}`;
    const { rows } = await client.query(
      `INSERT INTO api_keys (user_id, key_prefix, key_hash, name, is_active, expires_at)
       VALUES ($1, $2, $3, $4, TRUE, CASE WHEN $5::int IS NULL THEN NULL ELSE NOW() + make_interval(days => $5::int) END)
       RETURNING ${COLUMNS}`,
      [userId, raw.slice(0, 16), crypto.createHash('sha256').update(raw).digest('hex'), clean, days],
    );
    await client.query('COMMIT');
    return { ok: true, key: view(rows[0]), secret: raw };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (client !== db) client.release();
  }
}

export async function renameApiKey(db, { userId, keyId, name }) {
  if (!UUID_RE.test(String(keyId))) return { notFound: true };
  const clean = cleanKeyName(name);
  if (!clean) return { invalid: true, code: 'invalid_name' };
  const { rows } = await db.query(`UPDATE api_keys SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`, [keyId, userId, clean]);
  return rows[0] ? { ok: true, key: view(rows[0]) } : { notFound: true };
}

export async function revokeApiKey(db, { userId, keyId }) {
  if (!UUID_RE.test(String(keyId))) return { notFound: true };
  const { rows } = await db.query(`UPDATE api_keys SET is_active = FALSE WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`, [keyId, userId]);
  return rows[0] ? { ok: true, key: view(rows[0]) } : { notFound: true };
}
