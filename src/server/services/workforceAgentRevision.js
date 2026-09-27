/**
 * XENO-WORKFORCE-01 MKT-01 / OWN-03 -- revising an agent's definition is its own right, exercised by one durable
 * command.
 *
 *   MKT-01: "Distinguish ownership, visibility, invoke permission, definition-edit permission, export/license
 *            rights and conversation collaboration."
 *   OWN-03: "Agent versions pin instructions, skill references and requested capabilities by version/hash ...
 *            Updating a definition does not mutate active runs."
 *
 * Before this there was no way to write a second version of a definition: it was created once and frozen, so the
 * right MKT-01 names -- definition-edit -- was held by nobody and decided by nothing. reviseAgentDefinition is that
 * right, and 20260927150000-workforce-agent-revision.sql is its receipt.
 *
 * WHO MAY REVISE: a HUMAN who manages the definition's owner scope at the SAME bar creation needs -- the person
 * themselves for a personal agent, an editor (or above) of the owning workspace for a company agent. That is
 * deliberately NOT the ownership bar: giving an agent away needs a workspace administrator (OWN-05), so an editor
 * may revise a company agent and may not transfer it. Holding any OTHER right -- seeing a listing, buying or renting
 * it, joining a shared conversation, having it assigned into your workspace -- confers nothing here, and is told the
 * agent does not exist. An AGENT may not revise a definition: a principal rewriting what principals are is the
 * self-modification the transfer and team-package paths refuse for the same reason.
 *
 * WHAT A REVISION MAY CHANGE: the definition's content -- instructions, skills, requested capabilities, secret
 * references -- and nothing else. Provenance and licence are INHERITED from the version it revises and cannot be
 * set: an imported definition revised is still imported under the licence it was bought under, so a revision can
 * never launder a non-redistributable definition into an "authored" one that export would then let through.
 *
 * HOW: the caller names the version it read (`baseVersion`, an If-Match); a stale base is refused with the current
 * version, never silently rebased. The new version is written, the resource's revision advances (so every snapshot
 * check -- a pending assignment's acceptance, a pending transfer -- sees that the definition moved), and the receipt
 * binds the version to (actor, client, operation). A retry returns the version it made and writes nothing; a retry
 * asking for different content conflicts. Existing runs are untouched: each admission pinned its own version by
 * number and hash, and nothing here rewrites a version.
 */
import { resolvePrincipal } from './agentIdentity.js';
import { check } from '../utils/authzReBAC.js';
import { authorityTransaction, lockWorkspaceAuthority, operationHash } from './workspaceOperationReceipts.js';
import { lockApiKeyWorkforceAuthority } from './apiKeyWorkforceAuthority.js';

export class AgentRevisionError extends Error {
  constructor(code, reason, extra = {}) {
    super(reason);
    this.name = 'AgentRevisionError';
    this.code = code;
    this.status = { bad_input: 400, denied: 403, not_found: 404, conflict: 409, unavailable: 503 }[code] ?? 500;
    this.details = Object.freeze({ schemaVersion: 1, reason, ...extra });
  }
}
const fail = (code, reason, extra) => { throw new AgentRevisionError(code, reason, extra); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, field) => {
  if (typeof value !== 'string' || !UUID.test(value)) fail('bad_input', `invalid_${field}`);
  return value.toLowerCase();
};
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$/;
const hashPattern = /^[a-f0-9]{64}$/;

function record(value, allowed, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('bad_input', `invalid_${field}`);
  const out = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail('bad_input', 'unknown_field', { field: `${field}.${String(key)}` });
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('bad_input', `invalid_${field}`);
    out[key] = descriptor.value;
  }
  return out;
}
function identifier(value) {
  if (typeof value !== 'string' || !identifierPattern.test(value)) fail('bad_input', 'invalid_identifier');
  return value;
}
function list(value, max, normalize, key) {
  if (!Array.isArray(value) || value.length > max || Object.getPrototypeOf(value) !== Array.prototype) fail('bad_input', 'invalid_list');
  const out = value.map(normalize);
  if (new Set(out.map(key)).size !== out.length) fail('bad_input', 'duplicate_reference');
  return out;
}

/** The content of a revision -- the same grammar creation accepts, minus provenance and licence, which are inherited. */
function content(value) {
  const input = record(value, ['schemaVersion', 'instructions', 'skills', 'requestedCapabilities', 'secretReferences', 'provenance', 'license'], 'definition');
  // Named, not merely unknown: a caller asking to relabel what it is revising is told why it cannot.
  if (Object.hasOwn(input, 'provenance') || Object.hasOwn(input, 'license')) fail('bad_input', 'provenance_and_license_are_inherited');
  if (input.schemaVersion !== 1) fail('bad_input', 'unsupported_definition_schema');
  const instructions = input.instructions;
  if (typeof instructions !== 'string' || instructions.includes('\0') || Buffer.byteLength(instructions, 'utf8') > 32768) fail('bad_input', 'invalid_text');
  const skills = list(input.skills, 64, (item) => {
    const skill = record(item, ['id', 'version', 'hash'], 'skill');
    if (typeof skill.hash !== 'string' || !hashPattern.test(skill.hash)) fail('bad_input', 'invalid_definition_hash');
    return { id: identifier(skill.id), version: identifier(skill.version), hash: skill.hash };
  }, (s) => s.id);
  const requestedCapabilities = list(input.requestedCapabilities, 64, identifier, (c) => c);
  const secretReferences = list(Object.hasOwn(input, 'secretReferences') ? input.secretReferences : [], 32, (item) => {
    const reference = record(item, ['name', 'ref'], 'secret_reference');
    if (typeof reference.name !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(reference.name)) fail('bad_input', 'invalid_secret_reference');
    // A reference id only -- never a secret value, URI or env payload.
    return { name: reference.name, ref: uuid(reference.ref, 'secret_reference') };
  }, (r) => r.name);
  return { instructions, skills, requestedCapabilities, secretReferences };
}
function actorOf(context) {
  const ctx = record(context, ['actorUserId', 'clientId', 'apiKeyId'], 'context');
  if (typeof ctx.clientId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(ctx.clientId)) fail('bad_input', 'invalid_client');
  return { actorUserId: uuid(ctx.actorUserId, 'actor'), clientId: ctx.clientId,
    ...(Object.hasOwn(ctx, 'apiKeyId') ? { apiKeyId: uuid(ctx.apiKeyId, 'api_key') } : {}) };
}
function parseRevision(value) {
  const input = record(value, ['operationId', 'resourceId', 'baseVersion', 'definition'], 'request');
  if (!Number.isSafeInteger(input.baseVersion) || input.baseVersion < 1) fail('bad_input', 'invalid_base_version');
  return { operationId: uuid(input.operationId, 'operation'), resourceId: uuid(input.resourceId, 'resource'),
    baseVersion: input.baseVersion, content: content(input.definition) };
}

const ownerOf = (row) => (row.owner_user_id ? { type: 'user', id: row.owner_user_id } : { type: 'workspace', id: row.owner_workspace_id });

/** May this principal revise a definition owned by this scope? A human only, at creation's bar -- never ownership's. */
async function mayRevise(db, principal, owner) {
  if (!principal?.usable || principal.kind !== 'human') return false;
  if (owner.type === 'user') return principal.id === owner.id;
  const status = (await db.query('SELECT status FROM workspaces WHERE id=$1 FOR SHARE', [owner.id])).rows[0]?.status;
  if (status !== 'active') return false;
  const verdict = await check(db, { object: `workspace:${owner.id}`, relation: 'editor', subject: `user:${principal.id}` });
  return verdict.allowed && ['direct', 'role-hierarchy'].includes(verdict.via);
}

/**
 * Lock the agent in the house order -- the owning workspace's authority gate, the workspace row, the principal
 * rows, then the resource -- and re-read it under the lock, because a transfer may have moved it in between.
 */
async function lockAgent(db, actor, resourceId) {
  const peek = (await db.query(`SELECT owner_user_id, owner_workspace_id FROM workforce_resources WHERE id=$1 AND kind='agent'`, [resourceId])).rows[0];
  if (!peek) fail('not_found', 'agent_not_found');
  const owner = ownerOf(peek);
  if (owner.type === 'workspace') {
    await lockWorkspaceAuthority(db, owner.id);
    await db.query('SELECT id FROM workspaces WHERE id=$1 FOR SHARE', [owner.id]);
  }
  await db.query(`SELECT id FROM users WHERE id=$1 OR id IN (SELECT owner_user_id FROM agent_identities WHERE user_id=$1) ORDER BY id FOR SHARE`, [actor.actorUserId]);
  const agent = (await db.query(`SELECT * FROM workforce_resources WHERE id=$1 AND kind='agent' FOR UPDATE`, [resourceId])).rows[0];
  if (!agent) fail('not_found', 'agent_not_found');
  const locked = ownerOf(agent);
  if (locked.type !== owner.type || locked.id !== owner.id) fail('conflict', 'agent_owner_changed');
  return { agent, owner };
}

function versionOf(row) {
  return { resourceId: row.resource_id, version: row.version, schemaVersion: row.schema_version, content: row.content,
    contentHash: row.content_hash, provenance: row.provenance, license: row.license, createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString() };
}
async function observed(db, receipt, replayed, { withContent }) {
  const result = { schemaVersion: 1, state: 'committed', replayed,
    revision: { operationId: receipt.operation_id, resourceId: receipt.resource_id, previousVersion: receipt.previous_version,
      version: receipt.version, committedAt: receipt.committed_at.toISOString() },
    version: null, access: { allowed: false, reason: 'no_access' } };
  // The receipt is the actor's own and always confirms the outcome; the definition itself is shown only to someone
  // who may still revise it.
  if (!withContent) return result;
  const row = (await db.query('SELECT * FROM workforce_agent_versions WHERE resource_id=$1 AND version=$2', [receipt.resource_id, receipt.version])).rows[0];
  if (!row) fail('unavailable', 'retained_version_unavailable');
  return { ...result, version: versionOf(row), access: { allowed: true } };
}
const receiptWhere = 'actor_user_id=$1 AND client_id=$2 AND operation_id=$3';

/** Revise an agent's definition. `baseVersion` is the version the caller read; the result is the version written. */
export async function reviseAgentDefinition(pool, authenticatedContext, value) {
  const actor = actorOf(authenticatedContext);
  const input = parseRevision(value);
  const requestHash = operationHash({ resourceId: input.resourceId, baseVersion: input.baseVersion, content: input.content });
  let awaitingCommit = false;
  try {
    return await authorityTransaction(pool, async (db) => {
      // The house order: workspace gate, workspace row, principal rows and the resource (lockAgent), then the key.
      const { agent, owner } = await lockAgent(db, actor, input.resourceId);
      await lockApiKeyWorkforceAuthority(db, actor, 'workforce:manage');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`workforce-revise:${actor.actorUserId}:${actor.clientId}:${input.operationId}`]);
      const principal = await resolvePrincipal(db, actor.actorUserId);
      const allowed = await mayRevise(db, principal, owner);
      const prior = (await db.query(`SELECT * FROM workforce_agent_revisions WHERE ${receiptWhere}`, [actor.actorUserId, actor.clientId, input.operationId])).rows[0];
      if (prior) {
        if (prior.resource_id !== input.resourceId || prior.request_hash !== requestHash) fail('conflict', 'operation_payload_conflict');
        return observed(db, prior, true, { withContent: allowed });
      }
      // Anyone without the right is told the agent does not exist -- the same answer as an id that names nothing, so
      // holding some OTHER right over it (a listing, a rental, an assignment) is no oracle for this one.
      // One exception, and it reveals nothing: an agent acting for a human who could revise this definition is told
      // the real reason, because that human can already see it.
      if (principal?.usable && principal.kind === 'agent') {
        const human = principal.owner?.id ? await resolvePrincipal(db, principal.owner.id) : null;
        if (human?.usable && (await mayRevise(db, human, owner))) fail('denied', 'revision_requires_a_human');
      }
      if (!allowed) fail('not_found', 'agent_not_found');
      if (agent.status !== 'active') fail('conflict', 'agent_archived');
      const current = (await db.query('SELECT * FROM workforce_agent_versions WHERE resource_id=$1 ORDER BY version DESC LIMIT 1', [agent.id])).rows[0];
      if (!current) fail('conflict', 'agent_has_no_definition');
      // An If-Match: a revision of something the caller did not read is a conflict, never a silent rebase.
      if (current.version !== input.baseVersion) fail('conflict', 'agent_version_stale', { currentVersion: current.version });
      // Provenance and licence travel from the version revised, unchanged.
      const next = { schemaVersion: 1, content: input.content, provenance: current.provenance, license: current.license };
      const contentHash = operationHash(next);
      if (contentHash === current.content_hash) fail('conflict', 'definition_unchanged');
      const version = current.version + 1;
      await db.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,schema_version,provenance,license,created_by_user_id)
        VALUES($1,$2,$3,$4,1,$5,$6,$7)`, [agent.id, version, next.content, contentHash, next.provenance, next.license, actor.actorUserId]);
      // The definition moved, so the resource did: every snapshot check that compares the revision now sees it.
      const resource = (await db.query(`UPDATE workforce_resources SET revision=revision+1, updated_at=clock_timestamp() WHERE id=$1 RETURNING revision`, [agent.id])).rows[0];
      // committed_at is the transaction's now(), the same instant the version's created_at took -- never a value read
      // back through JavaScript, whose Date keeps milliseconds and would no longer equal it.
      const receipt = (await db.query(`INSERT INTO workforce_agent_revisions(actor_user_id,client_id,operation_id,resource_id,previous_version,version,request_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [actor.actorUserId, actor.clientId, input.operationId, agent.id, current.version, version, requestHash])).rows[0];
      if (owner.type === 'workspace') {
        await db.query(`INSERT INTO workspace_audit(workspace_id,actor_user_id,action,target,metadata) VALUES($1,$2,'workforce_agent_revised',$3,$4)`,
          [owner.id, actor.actorUserId, `workforce_resource:${agent.id}`,
            { schemaVersion: 1, operationId: input.operationId, resourceId: agent.id, previousVersion: current.version, version,
              resourceRevision: String(resource.revision) }]);
      }
      const result = await observed(db, receipt, false, { withContent: true });
      awaitingCommit = true;
      return result;
    });
  } catch (error) {
    // A lost COMMIT is not proof of rollback: reconcile this same operation through readAgentRevision.
    if (awaitingCommit) throw new AgentRevisionError('unavailable', 'operation_state_uncertain', { operationId: input.operationId });
    throw error;
  }
}

/** Reconcile a revision by its operation id -- the actor's own receipt, or `not-observed`. Writes nothing. */
export async function readAgentRevision(pool, authenticatedContext, value) {
  const actor = actorOf(authenticatedContext);
  const input = record(value, ['operationId'], 'request');
  const operationId = uuid(input.operationId, 'operation');
  return authorityTransaction(pool, async (db) => {
    await lockApiKeyWorkforceAuthority(db, actor, 'workforce:read');
    const receipt = (await db.query(`SELECT * FROM workforce_agent_revisions WHERE ${receiptWhere}`, [actor.actorUserId, actor.clientId, operationId])).rows[0];
    if (!receipt) return { schemaVersion: 1, state: 'not-observed', replayed: false, revision: null, version: null, access: { allowed: false, reason: 'no_access' } };
    const agent = (await db.query('SELECT owner_user_id, owner_workspace_id FROM workforce_resources WHERE id=$1', [receipt.resource_id])).rows[0];
    const allowed = Boolean(agent) && (await mayRevise(db, await resolvePrincipal(db, actor.actorUserId), ownerOf(agent)));
    return observed(db, receipt, true, { withContent: allowed });
  });
}
