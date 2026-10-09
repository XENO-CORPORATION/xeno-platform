/**
 * A person's API keys, read straight from the table for the data export, and one stand-in revoke.
 *
 * API keys are managed in one place: the XENO API portal (api.xenosystem.ai, repo xeno-api-platform,
 * portal/lib/platform-billing.ts). It makes a key with the `external_api_keys` row that ties it to a
 * billing project, applies the per-plan limit, lists and revokes. The platform has no key page and
 * no create route. Leaders keep it the same way: OpenAI on its developer platform, Anthropic in its
 * Console, both apart from the consumer app.
 *
 * `revokeApiKey` is a NAMED STAND-IN. On 2026-10-09 the portal's revoke route writes a column
 * `api_keys` does not have, and its working revoke sits at an unreachable path, so this was the
 * only revoke that worked. It does what the portal's own function does: `is_active = false` and the
 * mirror row marked. Exit: remove it when the portal's `DELETE /api/keys/:id` works.
 *
 * An agent's keys belong to the agent's own user row (/api/v2/agents) and never appear here.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export async function revokeApiKey(db, { userId, keyId }) {
  if (!UUID_RE.test(String(keyId))) return { notFound: true };
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`UPDATE api_keys SET is_active = FALSE WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`, [keyId, userId]);
    if (!rows[0]) { await client.query('ROLLBACK'); return { notFound: true }; }
    // the portal's mirror of this key, when it has one (a key made before the portal existed has none)
    const mirror = await client.query("SELECT to_regclass('public.external_api_keys') IS NOT NULL AS present");
    if (mirror.rows[0].present) await client.query("UPDATE external_api_keys SET legacy_status = 'REVOKED', updated_at = NOW() WHERE platform_api_key_id = $1", [keyId]);
    await client.query('COMMIT');
    return { ok: true, key: view(rows[0]) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (client !== db) client.release();
  }
}
