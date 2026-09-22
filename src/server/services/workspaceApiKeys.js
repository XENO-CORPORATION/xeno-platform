import crypto from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { operationIdentity as receiptIdentity, readWorkspaceOperation, transactWorkspaceOperation, workspaceOperationIncarnation } from './workspaceOperationReceipts.js';

export const WORKSPACE_KEY_PREFIX = 'xeno-ws-v1_';
export const WORKSPACE_KEY_SCOPES = Object.freeze(['workspace:read', 'workspace:members:read']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const error = (status, code) => Object.assign(new Error(code), { status, code });
export const isWorkspaceApiKey = value => /^xeno-ws-/i.test(String(value || ''));
export function workspaceKeyFromHeaders(headers) {
  const credentials = [headers.authorization, headers['x-api-key']].flatMap(value =>
    (Array.isArray(value) ? value : [value]).filter(value => typeof value === 'string')
      .flatMap(value => value.split(',')).map(value => value.trim().replace(/^(?:Bearer|DPoP)\s+/i, '')));
  const keys = credentials.filter(isWorkspaceApiKey);
  if (!keys.length) return null;
  // Never let a weaker or different credential supplied alongside this class
  // change the selected authority (including duplicated/merged HTTP headers).
  return keys.length === 1 && credentials.length === 1 ? { key: keys[0] } : { error: 'Ambiguous workspace credentials' };
}
export function workspaceKeyRoute(method, originalUrl) {
  if (method !== 'GET' && method !== 'HEAD') return null;
  const path = String(originalUrl || '').split('?')[0];
  const match = /^\/api\/workspaces\/([0-9a-f-]{36})(\/members)?\/?$/i.exec(path);
  if (!match || !UUID.test(match[1])) return null;
  return { workspaceId: match[1].toLowerCase(), scope: match[2] ? 'workspace:members:read' : 'workspace:read' };
}
export async function resolveWorkspaceApiKey(req, raw) {
  // Recognized credential classes fail terminally, including malformed versions.
  if (!/^xeno-ws-v1_[0-9a-f]{64}$/.test(raw)) return { status: 401, error: 'Invalid workspace API key' };
  const route = workspaceKeyRoute(req.method, req.originalUrl);
  if (!route) return { status: 403, error: 'Workspace key is not permitted on this route' };
  const { rows } = await req.db.query(`SELECT k.id AS key_id, k.workspace_id, k.scopes,
      u.id,u.username,u.email,u.display_name,u.avatar_url,u.created_at,u.email_verified,u.is_active
    FROM workspace_api_keys k JOIN users u ON u.id=k.created_by_user_id
    JOIN workspaces w ON w.id=k.workspace_id
    WHERE k.key_hash=$1 AND k.revoked_at IS NULL AND k.expires_at>now()
      AND u.is_active=true AND w.status='active' AND k.workspace_id=$2`, [hash(raw), route.workspaceId]);
  const row = rows[0];
  if (!row) return { status: 401, error: 'Invalid workspace API key' };
  if (!row.scopes.includes(route.scope)) return { status: 403, error: 'Workspace key scope is insufficient' };
  if (!(await check(req.db, { object: `workspace:${row.workspace_id}`, subject: `user:${row.id}`, relation: 'viewer' })).allowed) return { status: 403, error: 'Workspace key issuer is no longer a member' };
  const { key_id, workspace_id, scopes, ...user } = row;
  return { user, auth: { kind: 'workspace-api-key', keyId: key_id, workspaceId: workspace_id, scopes } };
}
const projection = row => ({ id: row.id, workspace_id: row.workspace_id, created_by_user_id: row.created_by_user_id,
  name: row.name, prefix: row.key_prefix, scopes: row.scopes, revision: row.revision,
  created_at: row.created_at, expires_at: row.expires_at, revoked_at: row.revoked_at, replaced_by: row.replaced_by });
function validateInput(input, prior) {
  const name = input?.name ?? prior?.name;
  const scopes = input?.scopes ?? prior?.scopes;
  const expiresAt = new Date(input?.expires_at ?? prior?.expires_at);
  if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[\x00-\x1f]/.test(name)
    || !Array.isArray(scopes) || !scopes.length || scopes.length > 2 || new Set(scopes).size !== scopes.length
    || scopes.some(scope => !WORKSPACE_KEY_SCOPES.includes(scope))
    || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + 90 * 86400_000) throw error(400, 'invalid_workspace_key_request');
  return { name: name.trim(), scopes, expiresAt };
}
async function assertAdmin(db, workspaceId, actor) {
  if (!UUID.test(workspaceId) || !UUID.test(actor)) throw error(400, 'invalid_workspace_identity');
  const workspace = await db.query(`SELECT extract(epoch FROM w.created_at)::text AS workspace_created_at,
    extract(epoch FROM u.created_at)::text AS actor_created_at FROM workspaces w JOIN users u ON u.id=$2
    WHERE w.id=$1 AND w.status='active' AND u.is_active=true`, [workspaceId, actor]);
  if (!workspace.rowCount || !(await check(db, { object: `workspace:${workspaceId}`, subject: `user:${actor}`, relation: 'admin' })).allowed) throw error(403, 'workspace_admin_required');
  return hash(JSON.stringify(workspace.rows[0]));
}
export async function listWorkspaceApiKeys(db, workspaceId, actor, options = {}) {
  await assertAdmin(db, workspaceId, actor);
  const limit = options.limit === undefined ? 100 : Number(options.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw error(400, 'invalid_workspace_key_page');
  let after = null;
  if (options.cursor !== undefined) {
    if (typeof options.cursor !== 'string' || !/^[a-z0-9_-]{1,512}$/i.test(options.cursor)) throw error(400, 'invalid_workspace_key_cursor');
    let cursor;
    try { cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')); } catch { throw error(400, 'invalid_workspace_key_cursor'); }
    if (!cursor || Object.keys(cursor).length !== 3 || cursor.version !== 1 || cursor.workspaceId !== workspaceId.toLowerCase() || !UUID.test(cursor.keyId)) throw error(400, 'invalid_workspace_key_cursor');
    after = cursor.keyId;
    if (!(await db.query('SELECT 1 FROM workspace_api_keys WHERE id=$1 AND workspace_id=$2', [after, workspaceId])).rowCount) throw error(409, 'workspace_key_cursor_unavailable');
  }
  // The cursor identifies the row, not a rounded JavaScript timestamp: retain
  // PostgreSQL microsecond precision and stable ordering at identical times.
  const rows = (await db.query(`SELECT * FROM workspace_api_keys WHERE workspace_id=$1
    AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM workspace_api_keys WHERE id=$2 AND workspace_id=$1))
    ORDER BY created_at DESC,id DESC LIMIT $3`, [workspaceId, after, limit + 1])).rows;
  const page = rows.slice(0, limit), last = page.at(-1);
  return { keys: page.map(projection), next_cursor: rows.length > limit ? Buffer.from(JSON.stringify({ version: 1, workspaceId: workspaceId.toLowerCase(), keyId: last.id })).toString('base64url') : null };
}
function operationIdentity(workspaceId, actor, clientId, operationId) {
  if (!UUID.test(workspaceId) || !UUID.test(actor) || !UUID.test(operationId)
    || typeof clientId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(clientId)) throw error(400, 'invalid_workspace_key_operation');
  return [workspaceId.toLowerCase(), actor.toLowerCase(), clientId, operationId.toLowerCase()];
}
function fingerprint(action, input) {
  const fields = action === 'create' ? ['name', 'scopes', 'expires_at', 'operation_id']
    : action === 'rotate' ? ['id', 'expected_revision', 'name', 'scopes', 'expires_at', 'operation_id'] : ['id', 'expected_revision', 'operation_id'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) throw error(400, 'invalid_workspace_key_request');
  // Fixed field order; omitted and explicit null remain distinct. We fingerprint
  // supplied intent, not defaults read from a key that rotation will later revoke.
  return hash(JSON.stringify([action, fields.filter(key => key !== 'operation_id').map(key => [key, Object.hasOwn(input, key) ? input[key] : { absent: true }])]));
}
export async function readWorkspaceKeyOperation(db, workspaceId, actor, clientId, operationId) {
  return readWorkspaceOperation(db, receiptIdentity('key', workspaceId, actor, clientId, operationId), db => workspaceOperationIncarnation(db, workspaceId, actor));
}
/** One transaction: mutation, audit and optional public operation receipt commit
 * together. Legacy requests without operation_id remain single-attempt only.
 * Receipted replay never returns a secret. Lost first delivery requires an
 * explicitly confirmed rotation of the identified key, not another create.
 * ReBAC is checked at admission. A concurrent role revocation does not abort an
 * already admitted transaction; later requests always re-check current roles. */
export async function mutateWorkspaceApiKey(pool, workspaceId, actor, action, input = {}, clientId, options = {}) {
  if (!['create', 'rotate', 'revoke'].includes(action)) throw error(400, 'invalid_workspace_key_action');
  const identity = input?.operation_id === undefined ? null : operationIdentity(workspaceId, actor, clientId, input.operation_id);
  const requestHash = identity ? fingerprint(action, input) : null;
  if (options.abandon === true && !identity) throw error(400, 'invalid_workspace_key_operation');
  if (identity) {
    const result = await transactWorkspaceOperation(pool, {
      identity: receiptIdentity('key', workspaceId, actor, clientId, input.operation_id), requestHash,
      authorizeIdentity: db => workspaceOperationIncarnation(db, workspaceId, actor), authorizeMutation: db => assertAdmin(db, workspaceId, actor),
      ...(options.abandon === true ? { abandonment: () => ({ operation_id: identity[3], workspace_id: identity[0], actor_user_id: identity[1], client_id: clientId,
        action, abandoned: true, previous_key_id: action === 'create' ? null : input.id, committed_at: new Date().toISOString() }) } : {}),
      apply: db => applyKeyMutation(db, workspaceId, actor, action, input),
      receipt: (value, rejection) => ({ operation_id: identity[3], workspace_id: identity[0], actor_user_id: identity[1], client_id: clientId,
        action, ...(rejection ? { rejection } : { key: value.key }), previous_key_id: action === 'create' ? null : input.id, committed_at: new Date().toISOString() }),
      rejectedCodes: ['invalid_workspace_key_request','invalid_workspace_key_revision','workspace_key_not_found','workspace_key_conflict'],
    });
    return { ...(result.result ?? (result.operation.key ? { key: result.operation.key } : {})), operation: result.operation, replayed: result.replayed };
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await assertAdmin(db, workspaceId, actor);
    const result = await applyKeyMutation(db, workspaceId, actor, action, input);
    await db.query('COMMIT'); return result;
  } catch (failure) { await db.query('ROLLBACK'); throw failure; } finally { db.release(); }
}
async function applyKeyMutation(db, workspaceId, actor, action, input) {
    let prior;
    if (action !== 'create') {
      if (!UUID.test(input.id) || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 1) throw error(400, 'invalid_workspace_key_revision');
      prior = (await db.query('SELECT * FROM workspace_api_keys WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [input.id, workspaceId])).rows[0];
      if (!prior) throw error(404, 'workspace_key_not_found');
      if (prior.revoked_at || prior.revision !== input.expected_revision) throw error(409, 'workspace_key_conflict');
    }
    let result;
    if (action === 'revoke') {
      result = { key: projection((await db.query('UPDATE workspace_api_keys SET revoked_at=now(),revision=revision+1 WHERE id=$1 RETURNING *', [prior.id])).rows[0]) };
    } else {
      const { name, scopes, expiresAt } = validateInput(input, prior);
      const secret = WORKSPACE_KEY_PREFIX + crypto.randomBytes(32).toString('hex');
      const record = (await db.query(`INSERT INTO workspace_api_keys(workspace_id,created_by_user_id,name,key_prefix,key_hash,scopes,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [workspaceId, actor, name, secret.slice(0, 24), hash(secret), scopes, expiresAt])).rows[0];
      if (prior) await db.query('UPDATE workspace_api_keys SET revoked_at=now(),revision=revision+1,replaced_by=$2 WHERE id=$1', [prior.id, record.id]);
      result = { key: projection(record), secret };
    }
    await db.query('INSERT INTO workspace_audit(workspace_id,actor_user_id,action,target,metadata) VALUES($1,$2,$3,$4,$5)',
      [workspaceId, actor, `api_key.${action}`, result.key.id, JSON.stringify({ scopes: result.key.scopes, ...(prior ? { previous_key_id: prior.id } : {}) })]);
    return result;
}
