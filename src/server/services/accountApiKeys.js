/**
 * A person's API keys, read straight from the table, for the copy of their data (accountExport.js).
 *
 * API keys are managed in one place: the XENO API portal (api.xenosystem.ai, repo xeno-api-platform,
 * portal/lib/platform-billing.ts). It makes a key with the `external_api_keys` row that ties it to a
 * billing project, applies the per-plan limit, lists and revokes. The platform has no key page and
 * writes no key. Leaders keep it the same way: OpenAI on its developer platform, Anthropic in its
 * Console, both apart from the consumer app.
 *
 * (A stand-in revoke lived here for one day, 2026-10-09, while the portal's own revoke route was
 * broken. The portal's was fixed and proven on a real key the same day, and the stand-in removed.)
 *
 * An agent's keys belong to the agent's own user row (/api/v2/agents) and never appear here.
 */
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
