import { normalizeOwnerScope } from './workforceScope.js';

export const API_KEY_WORKFORCE_SCOPES = Object.freeze(['workforce:read', 'workforce:manage']);
const uuid = value => normalizeOwnerScope({ type: 'user', id: value }).id;
export const apiKeyWorkforceNamespace = keyId => `api-key.${uuid(keyId)}`;
export function validApiKeyWorkforceScopes(value) {
  return Array.isArray(value) && value.length <= 2 && new Set(value).size === value.length
    && value.every(scope => API_KEY_WORKFORCE_SCOPES.includes(scope));
}
const denied = () => { throw Object.assign(new Error('Workforce key authority unavailable.'), { code: 'denied', status: 403 }); };

/** A missing additive table means no grants, preserving old non-workforce API
 * behavior during rollout. A database error is never swallowed as permission. */
export async function readApiKeyWorkforceScopes(db, keyId) {
  const exists = (await db.query("SELECT to_regclass('api_key_workforce_capabilities') IS NOT NULL AS present")).rows[0]?.present === true;
  if (!exists) return [];
  const row = (await db.query('SELECT scopes FROM api_key_workforce_capabilities WHERE api_key_id=$1', [uuid(keyId)])).rows[0];
  return row && validApiKeyWorkforceScopes(row.scopes) ? [...row.scopes] : [];
}

/** Same-transaction admission, after workspace/principal locks and BEFORE any
 * resource read/write. Grant/revocation writers take the same key FOR UPDATE;
 * existing direct key revocation also conflicts with this row's SHARE lock.
 * Ingress scopes narrow requests but are never reused as current authority. */
export async function lockApiKeyWorkforceAuthority(db, context, requiredScope) {
  if (!Object.hasOwn(context, 'apiKeyId')) {
    if (context.clientId.startsWith('api-key.')) denied();
    return;
  }
  const keyId = uuid(context.apiKeyId);
  if (context.clientId !== apiKeyWorkforceNamespace(keyId) || !API_KEY_WORKFORCE_SCOPES.includes(requiredScope)) denied();
  const key = (await db.query(`SELECT id FROM api_keys WHERE id=$1 AND user_id=$2 AND is_active=true
    AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE`, [keyId, context.actorUserId])).rows[0];
  if (!key || !(await readApiKeyWorkforceScopes(db, keyId)).includes(requiredScope)) denied();
}
