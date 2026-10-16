/**
 * Short-lived model keys for a signed-in person's own agent process (XENO Spawn's "XENO mode", 2026-10-16).
 *
 * Spawn starts Claude Code pointed at the XENO API and billed to the person's credits. It must not hold a long-lived
 * key, so each start asks for one key that lives for the session, goes into that one process's environment, and is
 * revoked when the session ends.
 *
 * A session key is an ordinary API key in every respect the gateway reads: an `api_keys` row (hashed, `expires_at`
 * set) and its `external_api_keys` link to the person's default API project, which is what bills it to their credits
 * and shows its usage beside their portal keys (`xeno-api-platform/portal/lib/platform-billing.ts`
 * createCanonicalApiKeyForLocalUser writes the same two rows). What is different, and deliberate:
 *   - it ALWAYS expires (5 to 720 minutes; default 60), so a key that leaks with a crashed process dies on its own;
 *   - at most LIVE_LIMIT are live per person, counted on unexpired, active session keys only;
 *   - only the person the key belongs to can revoke it, and revoking one that is gone answers 404;
 *   - it is listed with the person's keys on the portal (metadata.source = 'session-key'), so it is visible there.
 * The key's plaintext is returned once and never stored or logged; only its prefix and SHA-256 are kept.
 * `api_keys.expires_at` is `timestamp without time zone` holding UTC wall time (what the gateway, running in UTC, reads);
 * every write and comparison here is explicit about UTC so a server in another zone cannot shift a key's life.
 *
 * This is NOT a second key manager. Creating, listing and revoking a person's long-lived keys stays on the portal
 * (memory: api-keys-made-on-portal). This creates only expiring, per-session keys for a signed-in client.
 */
import crypto from 'node:crypto';

export const SOURCE_SYSTEM = 'xeno_private_api';
export const LIVE_LIMIT = 5;
export const TTL_MIN = 5;
export const TTL_MAX = 720;
export const TTL_DEFAULT = 60;
const DEFAULT_PROJECT_SLUG = 'default-api-project';
const DEFAULT_PROJECT_NAME = 'Default API Project';

export class SessionKeyError extends Error {
  constructor(message, code, http) { super(message); this.code = code; this.http = http; }
}

/** Where a session key is used: the gateway's Anthropic-compatible surface, and the models Claude Code's tiers map to. */
export function sessionKeyTarget(env = process.env) {
  const base = String(env.XENO_SESSION_KEY_BASE_URL || 'https://api.xenosystem.ai/anthropic').replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw new SessionKeyError('Session keys are not configured.', 'SESSION_KEYS_MISCONFIGURED', 503);
  return {
    baseUrl: base,
    models: {
      opus: env.XENO_SESSION_KEY_MODEL_OPUS || 'claude-opus-5-5',
      sonnet: env.XENO_SESSION_KEY_MODEL_SONNET || 'claude-sonnet-5-5',
      haiku: env.XENO_SESSION_KEY_MODEL_HAIKU || 'claude-haiku-5-5',
    },
  };
}

/** A whole number of minutes in range, or a refusal. An absent ttl is the default. */
export function readTtl(value) {
  if (value === undefined || value === null) return TTL_DEFAULT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < TTL_MIN || n > TTL_MAX) {
    throw new SessionKeyError(`ttlMinutes is a whole number from ${TTL_MIN} to ${TTL_MAX}.`, 'INVALID_TTL', 400);
  }
  return n;
}

/** A short, plain label (what the key is for, shown on the portal), or a refusal. */
export function readLabel(value) {
  if (value === undefined || value === null || value === '') return 'session key';
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new SessionKeyError('label is plain text of at most 64 characters.', 'INVALID_LABEL', 400);
  }
  return value.trim() || 'session key';
}

const slug = (v) => String(v || 'workspace').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';

/** The person's personal billing workspace and its default API project, made the same way the portal makes them. */
async function defaultProject(client, user) {
  await client.query(
    `INSERT INTO billing_workspaces (owner_user_id, workspace_type, name, slug, status, metadata)
     SELECT $1::uuid, 'personal', $2, $3, 'active', jsonb_build_object('source', 'session-key')
      WHERE NOT EXISTS (SELECT 1 FROM billing_workspaces WHERE owner_user_id = $1::uuid AND workspace_type = 'personal')
     ON CONFLICT (slug) DO NOTHING`,
    [user.id, `${user.username || 'user'} Workspace`, `${slug(user.username)}-workspace`]);
  const ws = (await client.query(
    `SELECT id FROM billing_workspaces WHERE owner_user_id = $1::uuid AND workspace_type = 'personal' ORDER BY created_at ASC LIMIT 1`,
    [user.id])).rows[0];
  if (!ws) throw new SessionKeyError('Your account has no billing workspace yet. Open the API portal once, then try again.', 'NO_BILLING_WORKSPACE', 409);
  await client.query(
    `INSERT INTO billing_workspace_members (workspace_id, user_id, member_role, member_status)
     SELECT $1::uuid, $2::uuid, 'owner', 'active'
      WHERE NOT EXISTS (SELECT 1 FROM billing_workspace_members WHERE workspace_id = $1::uuid AND user_id = $2::uuid)`,
    [ws.id, user.id]);
  await client.query(
    `INSERT INTO billing_projects (workspace_id, name, slug, status, metadata)
     VALUES ($1::uuid, $2, $3, 'active', jsonb_build_object('source', 'session-key'))
     ON CONFLICT (workspace_id, slug) DO NOTHING`,
    [ws.id, DEFAULT_PROJECT_NAME, DEFAULT_PROJECT_SLUG]);
  return (await client.query(`SELECT id FROM billing_projects WHERE workspace_id = $1::uuid AND slug = $2`, [ws.id, DEFAULT_PROJECT_SLUG])).rows[0].id;
}

/**
 * Mint one session key for `user` (a person; the route refuses agents and services). `clientId` is the OIDC client that
 * asked (recorded, so the portal can say "made by XENO Spawn"). Returns the plaintext ONCE.
 */
export async function createSessionKey(client, user, { ttlMinutes, label, clientId = null } = {}) {
  const ttl = readTtl(ttlMinutes);
  const name = readLabel(label);
  const target = sessionKeyTarget();
  // one person's mints are serialized, so the live limit holds under concurrency
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`session-keys:${user.id}`]);
  const live = (await client.query(
    `SELECT count(*)::int AS n FROM api_keys ak
       JOIN external_api_keys eak ON eak.platform_api_key_id = ak.id AND eak.source_system = $2
      WHERE ak.user_id = $1::uuid AND ak.is_active AND ak.expires_at > (now() AT TIME ZONE 'UTC') AND eak.metadata->>'source' = 'session-key'`,
    [user.id, SOURCE_SYSTEM])).rows[0].n;
  if (live >= LIVE_LIMIT) {
    throw new SessionKeyError(`You already have ${LIVE_LIMIT} live session keys. End a session, or wait for one to expire.`, 'SESSION_KEY_LIMIT', 429);
  }
  const projectId = await defaultProject(client, user);
  const raw = `xeno-${crypto.randomBytes(24).toString('hex')}`;
  const prefix = raw.slice(0, 16);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const row = (await client.query(
    `INSERT INTO api_keys (user_id, key_prefix, key_hash, name, rate_limit_per_minute, rate_limit_per_day, daily_credit_limit,
                           is_active, usage_count, created_at, expires_at)
     VALUES ($1::uuid, $2, $3, $4, 120, 100000, NULL, true, 0, now() AT TIME ZONE 'UTC', (now() AT TIME ZONE 'UTC') + make_interval(mins => $5))
     RETURNING id::text AS id, to_char(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at`,
    [user.id, prefix, hash, name, ttl])).rows[0];
  await client.query(
    `INSERT INTO external_api_keys (source_system, external_key_id, platform_api_key_id, platform_project_id, external_user_id,
                                    external_email, key_prefix, legacy_status, legacy_created_at, legacy_expires_at,
                                    legacy_total_requests, legacy_total_tokens, metadata)
     VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7, 'ACTIVE', now(), $8::timestamptz, 0, 0, $9::jsonb)`,
    [SOURCE_SYSTEM, `session:${row.id}`, row.id, projectId, user.id, String(user.email || '').toLowerCase() || null, prefix,
      row.expires_at, JSON.stringify({ keyName: name, source: 'session-key', clientId })]);
  return {
    key: { id: row.id, token: raw, expiresAt: row.expires_at, baseUrl: target.baseUrl, models: target.models },
    audit: { keyId: row.id, ttlMinutes: ttl, clientId, keyPrefix: prefix },
  };
}

/** Revoke one of `user`'s session keys. Only session keys, only their own: anything else is not found. */
export async function revokeSessionKey(client, user, keyId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(keyId || ''))) {
    throw new SessionKeyError('No such session key.', 'NOT_FOUND', 404);
  }
  const done = (await client.query(
    `UPDATE api_keys ak SET is_active = false
       FROM external_api_keys eak
      WHERE ak.id = $2::uuid AND ak.user_id = $1::uuid AND ak.is_active
        AND eak.platform_api_key_id = ak.id AND eak.source_system = $3 AND eak.metadata->>'source' = 'session-key'
      RETURNING ak.id::text AS id`,
    [user.id, keyId, SOURCE_SYSTEM])).rows[0];
  if (!done) throw new SessionKeyError('No such session key.', 'NOT_FOUND', 404);
  await client.query(`UPDATE external_api_keys SET legacy_status = 'REVOKED', updated_at = now() WHERE platform_api_key_id = $1::uuid AND source_system = $2`,
    [done.id, SOURCE_SYSTEM]);
  return { id: done.id };
}
