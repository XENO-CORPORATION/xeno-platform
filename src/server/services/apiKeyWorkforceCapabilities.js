import { normalizeOwnerScope } from './workforceScope.js';
import { resolvePrincipal } from './agentIdentity.js';
import { authorityTransaction, operationHash } from './workspaceOperationReceipts.js';
import { CLIENT_AUTHORITY, scopesForClient } from '../config/oidcAuthorityPolicy.js';
import { recentOidcAuthAllowed } from '../middleware/recentOidcAuth.js';
import { isOidcSessionActive } from '../utils/oidcProvider.js';
import { validApiKeyWorkforceScopes } from './apiKeyWorkforceAuthority.js';

export const API_KEY_WORKFORCE_GRANT_CLIENTS = Object.freeze(Object.keys(CLIENT_AUTHORITY).filter(id => scopesForClient(id).includes('workforce:manage')));
export class ApiKeyWorkforceCapabilityError extends Error {
  constructor(code, reason, details = {}) {
    super('API key workforce capability operation unavailable.');
    this.code = code; this.status = { bad_input: 400, denied: 403, conflict: 409, unavailable: 503 }[code] ?? 500;
    this.details = Object.freeze({ schemaVersion: 1, reason, ...details });
  }
}
const fail = (code, reason) => { throw new ApiKeyWorkforceCapabilityError(code, reason); };
const uuid = value => normalizeOwnerScope({ type: 'user', id: value }).id;
function record(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('bad_input', 'invalid_key_capability_shape');
  const copy = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !d.enumerable || !Object.hasOwn(d, 'value')) fail('bad_input', 'invalid_key_capability_shape');
    copy[key] = d.value;
  }
  return copy;
}
function request(value, mutate) {
  const input = record(value, mutate ? ['keyId', 'operationId', 'expectedRevision', 'action', 'scopes'] : ['keyId', 'operationId']);
  const result = { keyId: uuid(input.keyId), ...(Object.hasOwn(input, 'operationId') ? { operationId: uuid(input.operationId) } : {}) };
  if (!mutate) return result;
  if (!result.operationId || typeof input.expectedRevision !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(input.expectedRevision)
    || BigInt(input.expectedRevision) >= 9223372036854775807n || !['set-scopes', 'revoke-key'].includes(input.action)) fail('bad_input', 'invalid_key_capability_request');
  if (input.action === 'set-scopes') {
    if (!Array.isArray(input.scopes) || Object.getPrototypeOf(input.scopes) !== Array.prototype || input.scopes.length > 2) fail('bad_input', 'invalid_key_capability_scopes');
    // Descriptor checks precede copying; never execute array accessors.
    const descriptors = Object.getOwnPropertyDescriptors(input.scopes);
    if (Reflect.ownKeys(descriptors).length !== input.scopes.length + 1
      || Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || key !== 'length' && !/^(0|1)$/.test(key))
      || Object.entries(descriptors).some(([key, d]) => key !== 'length' && (!d.enumerable || !Object.hasOwn(d, 'value')))) fail('bad_input', 'invalid_key_capability_scopes');
    if (!validApiKeyWorkforceScopes(input.scopes)) fail('bad_input', 'invalid_key_capability_scopes');
  } else if (Object.hasOwn(input, 'scopes')) fail('bad_input', 'invalid_key_capability_scopes');
  return { ...result, expectedRevision: input.expectedRevision, action: input.action, scopes: input.action === 'set-scopes' ? [...input.scopes].sort() : [] };
}
function context(value) {
  const ctx = record(value, ['actorUserId', 'auth']);
  const actorUserId = uuid(ctx.actorUserId), auth = ctx.auth;
  if (!auth || auth.kind !== 'oidc' || typeof auth.dpopJkt !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(auth.dpopJkt)
    || !API_KEY_WORKFORCE_GRANT_CLIENTS.includes(auth.clientId) || !String(auth.scope).split(/\s+/).includes('workforce:manage')
    || !scopesForClient(auth.clientId)?.includes('workforce:manage') || !auth.sid) fail('denied', 'sender_bound_management_session_required');
  return { actorUserId, auth: { ...auth }, clientId: auth.clientId };
}
function recent(ctx) {
  if (!recentOidcAuthAllowed(ctx.auth, { scope: 'workforce:manage', clients: API_KEY_WORKFORCE_GRANT_CLIENTS })) fail('denied', 'recent_authentication_required');
}
async function keyAuthority(db, ctx, input, mutate) {
  // Same lock order as resource admission: principal(s), then credential key.
  // This discovery read confers no authority; key user_id is rechecked under lock.
  const discovered = (await db.query('SELECT user_id FROM api_keys WHERE id=$1', [input.keyId])).rows[0];
  if (!discovered) fail('denied', 'human_key_owner_required');
  const principalIds = [ctx.actorUserId, discovered.user_id];
  await db.query(`SELECT id FROM users WHERE id=ANY($1::uuid[])
    OR id IN (SELECT owner_user_id FROM agent_identities WHERE user_id=ANY($1::uuid[])) ORDER BY id FOR SHARE`, [principalIds]);
  await db.query('SELECT user_id FROM agent_identities WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR SHARE', [principalIds]);
  const actor = await resolvePrincipal(db, ctx.actorUserId);
  if (!actor?.usable || actor.kind !== 'human') fail('denied', 'human_key_owner_required');
  const keyPrincipal = discovered.user_id === actor.id ? actor : await resolvePrincipal(db, discovered.user_id);
  if (!keyPrincipal?.usable || !(keyPrincipal.kind === 'human' && keyPrincipal.id === actor.id
    || keyPrincipal.kind === 'agent' && keyPrincipal.owner?.id === actor.id)) fail('denied', 'human_key_owner_required');
  await db.query('SELECT user_id FROM oauth_user_auth_epochs WHERE user_id=$1 FOR SHARE', [ctx.actorUserId]);
  await db.query('SELECT sid FROM oauth_session_state WHERE sid=$1 FOR SHARE', [ctx.auth.sid]);
  if (!await isOidcSessionActive(db, { sid: ctx.auth.sid, userId: ctx.actorUserId, authEpoch: ctx.auth.authEpoch })) fail('denied', 'management_session_revoked');
  const registered = (await db.query('SELECT allowed_scopes FROM oauth_clients WHERE client_id=$1 FOR SHARE', [ctx.clientId])).rows[0];
  const required = ['workforce:manage', ...(mutate ? input.scopes : [])];
  const granted = new Set(String(ctx.auth.scope).split(/\s+/));
  if (!registered || !required.every(scope => registered.allowed_scopes?.includes(scope) && scopesForClient(ctx.clientId)?.includes(scope) && granted.has(scope))) fail('denied', 'management_scope_ceiling');
  if (mutate) recent(ctx);
  const key = (await db.query(`SELECT id,user_id,is_active,expires_at,created_at FROM api_keys WHERE id=$1 AND user_id=$2 ${mutate ? 'FOR UPDATE' : 'FOR SHARE'}`,
    [input.keyId, discovered.user_id])).rows[0];
  if (!key) fail('denied', 'human_key_owner_required');
  const incarnation = (await db.query(`SELECT extract(epoch FROM u.created_at)::text AS actor_created_at,
    extract(epoch FROM k.created_at)::text AS key_created_at,k.user_id AS key_user_id,
    extract(epoch FROM p.created_at)::text AS principal_created_at,a.owner_user_id AS agent_owner_id,
    extract(epoch FROM a.created_at)::text AS agent_created_at
    FROM users u CROSS JOIN api_keys k JOIN users p ON p.id=k.user_id LEFT JOIN agent_identities a ON a.user_id=k.user_id
    WHERE u.id=$1 AND k.id=$2`, [ctx.actorUserId, input.keyId])).rows[0];
  return { key, incarnationHash: operationHash(incarnation) };
}
const receipt = row => ({ operationId: row.operation_id, keyId: row.api_key_id, action: row.action,
  scopes: row.scopes, revision: String(row.revision), keyActive: row.key_active, committedAt: row.committed_at.toISOString() });
const where = 'actor_user_id=$1 AND client_id=$2 AND operation_id=$3';

export async function mutateApiKeyWorkforceCapabilities(pool, authenticatedContext, value) {
  const ctx = context(authenticatedContext), input = request(value, true); recent(ctx);
  const requestHash = operationHash(input);
  let awaitingCommit = false;
  try {
    return await authorityTransaction(pool, async db => {
      const { key, incarnationHash } = await keyAuthority(db, ctx, input, true);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`api-key-capability-operation:${ctx.actorUserId}:${ctx.clientId}:${input.operationId}`]);
      const prior = (await db.query(`SELECT * FROM api_key_workforce_operations WHERE ${where}`, [ctx.actorUserId, ctx.clientId, input.operationId])).rows[0];
      if (prior) {
        if (prior.api_key_id !== input.keyId || prior.key_incarnation_hash !== incarnationHash || prior.request_hash !== requestHash) fail('conflict', 'key_capability_operation_conflict');
        return { schemaVersion: 1, state: 'committed', operation: receipt(prior), replayed: true };
      }
      const current = (await db.query('SELECT revision FROM api_key_workforce_capabilities WHERE api_key_id=$1', [input.keyId])).rows[0];
      if (String(current?.revision ?? 0) !== input.expectedRevision) fail('conflict', 'key_capability_revision_conflict');
      if (input.action === 'set-scopes' && (!key.is_active || (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()))) fail('denied', 'key_inactive');
      const revision = (BigInt(input.expectedRevision) + 1n).toString();
      await db.query(`INSERT INTO api_key_workforce_capabilities(api_key_id,scopes,revision) VALUES($1,$2,$3)
        ON CONFLICT(api_key_id) DO UPDATE SET scopes=EXCLUDED.scopes,revision=EXCLUDED.revision,updated_at=clock_timestamp()`, [input.keyId, input.scopes, revision]);
      if (input.action === 'revoke-key') await db.query('UPDATE api_keys SET is_active=false WHERE id=$1', [input.keyId]);
      const row = (await db.query(`INSERT INTO api_key_workforce_operations(actor_user_id,client_id,operation_id,api_key_id,key_incarnation_hash,request_hash,action,scopes,revision,key_active)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [ctx.actorUserId, ctx.clientId, input.operationId, input.keyId, incarnationHash, requestHash,
      input.action, input.scopes, revision, input.action === 'revoke-key' ? false : key.is_active])).rows[0];
      awaitingCommit = true;
      return { schemaVersion: 1, state: 'committed', operation: receipt(row), replayed: false };
    });
  } catch (error) {
    if (awaitingCommit) throw new ApiKeyWorkforceCapabilityError('unavailable', 'key_capability_state_uncertain', { operationId: input.operationId, keyId: input.keyId });
    throw error;
  }
}
export async function readApiKeyWorkforceCapabilities(pool, authenticatedContext, value) {
  const ctx = context(authenticatedContext), input = request(value, false);
  return authorityTransaction(pool, async db => {
    const { key, incarnationHash } = await keyAuthority(db, ctx, input, false);
    const current = (await db.query('SELECT scopes,revision FROM api_key_workforce_capabilities WHERE api_key_id=$1', [input.keyId])).rows[0];
    let operation = null;
    if (input.operationId) {
      const prior = (await db.query(`SELECT * FROM api_key_workforce_operations WHERE ${where}`, [ctx.actorUserId, ctx.clientId, input.operationId])).rows[0];
      if (prior && (prior.api_key_id !== input.keyId || prior.key_incarnation_hash !== incarnationHash)) fail('conflict', 'key_capability_operation_conflict');
      if (prior) operation = receipt(prior);
    }
    return { schemaVersion: 1, keyId: input.keyId, revision: String(current?.revision ?? 0), scopes: current?.scopes ?? [], keyActive: key.is_active,
      state: input.operationId ? operation ? 'committed' : 'not-observed' : 'current', operation };
  });
}
