import { randomUUID } from 'node:crypto';
import { normalizeOwnerScope } from './workforceScope.js';
import { authorizeOwnerManagement } from './workforceAuthority.js';
import { resolvePrincipal } from './agentIdentity.js';
import { authorityTransaction, lockWorkspaceAuthority, operationHash } from './workspaceOperationReceipts.js';
import { lockApiKeyWorkforceAuthority } from './apiKeyWorkforceAuthority.js';

export class WorkforceResourceError extends Error {
  constructor(code, reason, extra = {}) {
    super(code === 'bad_input' ? 'Invalid workforce resource request.' : 'Workforce resource operation unavailable.');
    this.name = 'WorkforceResourceError';
    this.code = code;
    this.status = { bad_input: 400, denied: 403, conflict: 409, unavailable: 503 }[code] ?? 500;
    this.details = Object.freeze({ schemaVersion: 1, reason, ...extra });
  }
}
const fail = (code, reason) => { throw new WorkforceResourceError(code, reason); };
const uuid = value => normalizeOwnerScope({ type: 'user', id: value }).id;
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$/;
const hashPattern = /^[a-f0-9]{64}$/;

// Only own data fields: no getters, inherited state, unknown fields or arbitrary
// config/env maps enter hashing or persistence. Limits apply before serialization.
function record(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('bad_input', 'invalid_shape');
  const out = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail('bad_input', 'unknown_field');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('bad_input', 'invalid_shape');
    out[key] = descriptor.value;
  }
  return out;
}
function text(value, max, { empty = false } = {}) {
  if (typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value, 'utf8') > max
    || (!empty && !value.trim())) fail('bad_input', 'invalid_text');
  return value;
}
function identifier(value) {
  if (typeof value !== 'string' || !identifierPattern.test(value)) fail('bad_input', 'invalid_identifier');
  return value;
}
function list(value, max, normalize, key) {
  if (!Array.isArray(value) || value.length > max || Object.getPrototypeOf(value) !== Array.prototype) fail('bad_input', 'invalid_list');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) fail('bad_input', 'invalid_list');
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('bad_input', 'invalid_list');
    result.push(normalize(descriptor.value));
  }
  if (new Set(result.map(key)).size !== result.length) fail('bad_input', 'duplicate_reference');
  return result;
}
function definition(value) {
  const input = record(value, ['schemaVersion', 'instructions', 'skills', 'requestedCapabilities', 'secretReferences', 'provenance', 'license']);
  if (input.schemaVersion !== 1) fail('bad_input', 'unsupported_definition_schema');
  const instructions = text(input.instructions, 32768, { empty: true });
  const skills = list(input.skills, 64, value => {
    const skill = record(value, ['id', 'version', 'hash']);
    if (typeof skill.hash !== 'string' || !hashPattern.test(skill.hash)) fail('bad_input', 'invalid_definition_hash');
    return { id: identifier(skill.id), version: identifier(skill.version), hash: skill.hash };
  }, skill => skill.id);
  const requestedCapabilities = list(input.requestedCapabilities, 64, identifier, value => value);
  const secretReferences = list(Object.hasOwn(input, 'secretReferences') ? input.secretReferences : [], 32, value => {
    const reference = record(value, ['name', 'ref']);
    if (typeof reference.name !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(reference.name)) fail('bad_input', 'invalid_secret_reference');
    // A canonical reference ID only, never a secret value, URI or env payload.
    return { name: reference.name, ref: uuid(reference.ref) };
  }, reference => reference.name);
  let provenance = {};
  if (Object.hasOwn(input, 'provenance')) {
    const p = record(input.provenance, ['source', 'sourceVersion']);
    if (!['authored', 'imported'].includes(p.source)) fail('bad_input', 'invalid_provenance');
    provenance = { source: p.source };
    if (Object.hasOwn(p, 'sourceVersion')) provenance.sourceVersion = identifier(p.sourceVersion);
  }
  let license = {};
  if (Object.hasOwn(input, 'license')) {
    const l = record(input.license, ['identifier']);
    license = { identifier: identifier(l.identifier) };
  }
  return { schemaVersion: 1, content: { instructions, skills, requestedCapabilities, secretReferences }, provenance, license };
}
function context(value) {
  const input = record(value, ['actorUserId', 'clientId', 'apiKeyId']);
  if (typeof input.clientId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(input.clientId)) fail('bad_input', 'invalid_client');
  return { actorUserId: uuid(input.actorUserId), clientId: input.clientId,
    ...(Object.hasOwn(input, 'apiKeyId') ? { apiKeyId: uuid(input.apiKeyId) } : {}) };
}
function request(value, create) {
  const input = record(value, create ? ['operationId', 'owner', 'kind', 'name', 'description', 'definition', 'expectedActorAccountId'] : ['operationId', 'owner', 'expectedActorAccountId']);
  const result = { operationId: uuid(input.operationId), owner: normalizeOwnerScope(input.owner),
    ...(Object.hasOwn(input, 'expectedActorAccountId') ? { expectedActorAccountId: uuid(input.expectedActorAccountId) } : {}) };
  if (!create) return result;
  if (!['agent', 'team'].includes(input.kind)) fail('bad_input', 'invalid_resource_kind');
  if (input.kind === 'team' && Object.hasOwn(input, 'definition')) fail('bad_input', 'team_definition_forbidden');
  return { ...result, kind: input.kind, name: text(input.name, 200).trim(),
    description: text(Object.hasOwn(input, 'description') ? input.description : '', 4096, { empty: true }),
    definition: input.kind === 'agent' ? definition(input.definition) : null };
}

/** Receipt identity is deliberately narrower than management authority. A
 * revoked creator may confirm their own outcome without seeing current resource
 * data. Usable principal and exact incarnation still gate that confirmation. */
async function lockOperationActor(db, actor, owner) {
  if (owner.type === 'workspace') {
    await lockWorkspaceAuthority(db, owner.id);
    await db.query('SELECT id FROM workspaces WHERE id=$1 FOR SHARE', [owner.id]);
  }
  const ids = owner.type === 'user' ? [actor.actorUserId, owner.id] : [actor.actorUserId];
  await db.query(`SELECT id FROM users WHERE id = ANY($1::uuid[])
    OR id IN (SELECT owner_user_id FROM agent_identities WHERE user_id = ANY($1::uuid[])) ORDER BY id FOR SHARE`, [ids]);
  await db.query('SELECT user_id FROM agent_identities WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR SHARE', [ids]);
  const principal = await resolvePrincipal(db, actor.actorUserId);
  if (!principal?.usable || !['human', 'agent'].includes(principal.kind)) fail('denied', 'actor_unavailable');
  if (principal.kind === 'agent') {
    const human = await resolvePrincipal(db, principal.owner.id);
    if (!human?.usable || human.kind !== 'human') fail('denied', 'actor_unavailable');
  }
  return principal;
}
async function incarnation(db, actor, owner, principal) {
  const actorRow = (await db.query(`SELECT extract(epoch FROM u.created_at)::text AS actor_created_at,
    a.owner_user_id AS agent_owner_id, extract(epoch FROM a.created_at)::text AS agent_created_at,
    extract(epoch FROM h.created_at)::text AS agent_owner_created_at
    FROM users u LEFT JOIN agent_identities a ON a.user_id=u.id LEFT JOIN users h ON h.id=a.owner_user_id WHERE u.id=$1`, [actor.actorUserId])).rows[0];
  const ownerRow = (await db.query(`SELECT extract(epoch FROM created_at)::text AS owner_created_at
    FROM ${owner.type === 'user' ? 'users' : 'workspaces'} WHERE id=$1`, [owner.id])).rows[0];
  if (!actorRow?.actor_created_at || !ownerRow?.owner_created_at) fail('denied', 'identity_unavailable');
  return operationHash({ ...actorRow, ...ownerRow, actorKind: principal.kind, owner });
}
const operationWhere = 'actor_user_id=$1 AND client_id=$2 AND operation_id=$3';
const identity = (actor, input) => [actor.actorUserId, actor.clientId, input.operationId];
function operation(row) {
  return { schemaVersion: 1, operationId: row.operation_id, action: 'agent.resource.create', state: 'committed',
    owner: { type: row.owner_type, id: row.owner_id }, resourceId: row.resource_id,
    resourceRevision: String(row.resource_revision), agentVersion: row.agent_version,
    committedAt: row.committed_at.toISOString() };
}
async function observed(db, actor, input, receipt, replayed) {
  const result = { state: 'committed', operation: operation(receipt), resource: null, version: null,
    resourceAccess: { allowed: false, reason: 'no_access' }, replayed };
  // The read endpoint is limited to this actor's creation receipt, never a
  // general resource reader or a blanket implication from create privileges.
  try { await authorizeOwnerManagement(db, actor.actorUserId, input.owner, { action: 'create_resource', forMutation: true }); }
  catch (error) { if (error.code === 'denied') return result; throw error; }
  const row = (await db.query('SELECT * FROM workforce_resources WHERE id=$1 FOR SHARE', [receipt.resource_id])).rows[0];
  if (!row || (row.owner_user_id ? 'user' : 'workspace') !== input.owner.type
    || (row.owner_user_id ?? row.owner_workspace_id) !== input.owner.id) return result;
  result.resource = { id: row.id, kind: row.kind, owner: input.owner, createdByUserId: row.created_by_user_id,
    name: row.name, description: row.description, status: row.status, revision: String(row.revision),
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  if (receipt.agent_version !== null) {
    const version = (await db.query('SELECT * FROM workforce_agent_versions WHERE resource_id=$1 AND version=$2', [row.id, receipt.agent_version])).rows[0];
    if (!version) fail('unavailable', 'retained_version_unavailable');
    result.version = { resourceId: row.id, version: version.version, schemaVersion: version.schema_version,
      content: version.content, contentHash: version.content_hash, provenance: version.provenance, license: version.license,
      createdByUserId: version.created_by_user_id, createdAt: version.created_at.toISOString() };
  }
  result.resourceAccess = { allowed: true };
  return result;
}

async function transact(pool, actor, input, create) {
  // This is a precondition, never authentication. It closes account-switch races
  // between a prepared client intent and token acquisition for actual dispatch.
  if (input.expectedActorAccountId && input.expectedActorAccountId !== actor.actorUserId) fail('conflict', 'actor_context_conflict');
  const requestHash = create ? operationHash({ owner: input.owner, kind: input.kind, name: input.name,
    description: input.description, definition: input.definition,
    ...(input.expectedActorAccountId ? { expectedActorAccountId: input.expectedActorAccountId } : {}) }) : null;
  let awaitingCommit = false;
  try {
    return await authorityTransaction(pool, async db => {
      const principal = await lockOperationActor(db, actor, input.owner);
      await lockApiKeyWorkforceAuthority(db, actor, create ? 'workforce:manage' : 'workforce:read');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`workforce-create:${actor.actorUserId}:${actor.clientId}:${input.operationId}`]);
      const prior = (await db.query(`SELECT * FROM workforce_resource_operations WHERE ${operationWhere}`, identity(actor, input))).rows[0];
      if (prior) {
        if (prior.owner_type !== input.owner.type || prior.owner_id !== input.owner.id) fail('conflict', 'operation_scope_conflict');
        if (prior.incarnation_hash !== await incarnation(db, actor, input.owner, principal)) fail('conflict', 'operation_incarnation_conflict');
        if (create && prior.request_hash !== requestHash) fail('conflict', 'operation_payload_conflict');
        return observed(db, actor, input, prior, true);
      }
      if (!create) return { state: 'not-observed', operation: null, resource: null, version: null, replayed: false };
      await authorizeOwnerManagement(db, actor.actorUserId, input.owner, { action: 'create_resource', forMutation: true });
      const incarnationHash = await incarnation(db, actor, input.owner, principal);
      const resourceId = randomUUID();
      await db.query(`INSERT INTO workforce_resources(id,kind,owner_user_id,owner_workspace_id,created_by_user_id,name,description)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [resourceId, input.kind, input.owner.type === 'user' ? input.owner.id : null,
        input.owner.type === 'workspace' ? input.owner.id : null, actor.actorUserId, input.name, input.description]);
      if (input.definition) {
        const d = input.definition;
        await db.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,schema_version,provenance,license,created_by_user_id)
          VALUES($1,1,$2,$3,$4,$5,$6,$7)`, [resourceId, d.content, operationHash(d), d.schemaVersion, d.provenance, d.license, actor.actorUserId]);
      }
      // Existing workspace audit only supports workspace owners. The fixed-column
      // receipt is also the personal creation audit; no alternate outbox is claimed.
      if (input.owner.type === 'workspace') await db.query(`INSERT INTO workspace_audit(workspace_id,actor_user_id,action,target,metadata)
        VALUES($1,$2,'workforce_resource_created',$3,$4)`, [input.owner.id, actor.actorUserId, `workforce_resource:${resourceId}`,
        { schemaVersion: 1, operationId: input.operationId, resourceId, kind: input.kind, resourceRevision: '1', agentVersion: input.definition ? 1 : null }]);
      const receipt = (await db.query(`INSERT INTO workforce_resource_operations(actor_user_id,client_id,operation_id,owner_type,owner_id,
        request_hash,incarnation_hash,resource_id,resource_revision,agent_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9) RETURNING *`,
      [...identity(actor, input), input.owner.type, input.owner.id, requestHash, incarnationHash, resourceId, input.definition ? 1 : null])).rows[0];
      const result = await observed(db, actor, input, receipt, false);
      awaitingCommit = true;
      return result;
    });
  } catch (error) {
    // A lost COMMIT response is not proof of rollback. Reconcile the same durable
    // operation; do not encourage redispatch with a fresh operation identity.
    if (awaitingCommit) throw new WorkforceResourceError('unavailable', 'operation_state_uncertain', { operationId: input.operationId, owner: input.owner });
    throw error;
  }
}

/** Authenticated context comes exclusively from server auth, never request data.
 * Definition references request capabilities; they grant no tool/secret access.
 * This creates no principal, assignment, membership, session or execution. */
export function createWorkforceResource(pool, authenticatedContext, value) {
  return transact(pool, context(authenticatedContext), request(value, true), true);
}
export function readWorkforceResourceOperation(pool, authenticatedContext, value) {
  return transact(pool, context(authenticatedContext), request(value, false), false);
}
