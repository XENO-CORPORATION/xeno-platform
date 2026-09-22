/**
 * Workforce scope contract v1 (XENO-WORKFORCE-01, OWN-01 / ASN-03 / ASN-09).
 *
 * These pure functions validate representations only. A well-formed UUID does
 * not prove that a record exists, an assignment is accepted, or consent is valid.
 * The canonical service must resolve records and check live authorization,
 * ownership, assignment acceptance, member admission and policy independently.
 * Never attach assignment edges as generic ReBAC parent edges.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class WorkforceScopeError extends Error {
  constructor(reason, field) {
    super(reason === 'scope_mismatch'
      ? 'Project participation targets do not agree.'
      : 'Invalid workforce scope contract.');
    this.name = 'WorkforceScopeError';
    this.code = 'bad_input';
    this.status = 400;
    this.details = Object.freeze({ schemaVersion: 1, reason, field });
  }
}

function fail(reason, field) {
  throw new WorkforceScopeError(reason, field);
}

// Read descriptors rather than invoking getters or accepting inherited fields.
function record(value, allowed, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('invalid_shape', field);
  }
  const result = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail('unknown_field', field);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid_shape', field);
    result[key] = descriptor.value;
  }
  return result;
}

function uuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('invalid_id', field);
  return value.toLowerCase();
}

/**
 * This is a resource owner, not the authenticated actor/principal. An agent's
 * effective principal and owner cascade remain the canonical identity service's
 * responsibility; an owner scope must never replace that principal in authz.
 * @returns {Readonly<{type: 'user'|'workspace', id: string}>}
 */
export function normalizeOwnerScope(value) {
  const input = record(value, ['type', 'id'], 'owner');
  if (!['user', 'workspace'].includes(input.type)) fail('invalid_variant', 'owner.type');
  return Object.freeze({ type: input.type, id: uuid(input.id, 'owner.id') });
}

/**
 * Personal: { type: 'personal-project', ownerUserId, projectId }.
 * Workspace: { type: 'workspace-project', workspaceId, workspaceAssignmentId, projectId }.
 * The owner identifies the TARGET project; it need not own the offered resource.
 * Workspace assignment acceptance and personal consent are service checks, not
 * caller-supplied booleans. Cross-variant fields are refused, even when null.
 */
export function normalizeProjectParticipationTarget(value) {
  const input = record(value,
    ['type', 'ownerUserId', 'workspaceId', 'workspaceAssignmentId', 'projectId'], 'target');
  if (input.type === 'personal-project') {
    if (Object.hasOwn(input, 'workspaceId') || Object.hasOwn(input, 'workspaceAssignmentId')) {
      fail('contradictory_variant', 'target');
    }
    return Object.freeze({
      type: input.type,
      ownerUserId: uuid(input.ownerUserId, 'target.ownerUserId'),
      projectId: uuid(input.projectId, 'target.projectId'),
    });
  }
  if (input.type === 'workspace-project') {
    if (Object.hasOwn(input, 'ownerUserId')) fail('contradictory_variant', 'target');
    return Object.freeze({
      type: input.type,
      workspaceId: uuid(input.workspaceId, 'target.workspaceId'),
      workspaceAssignmentId: uuid(input.workspaceAssignmentId, 'target.workspaceAssignmentId'),
      projectId: uuid(input.projectId, 'target.projectId'),
    });
  }
  fail('invalid_variant', 'target.type');
}

/**
 * Agent: { type: 'agent', id, teamId? }; team: { type: 'team', id }.
 * Omit teamId for a direct agent; no default team is synthesized. A supplied
 * teamId selects one context only and still requires canonical membership checks.
 */
export function normalizeWorkforceParticipant(value) {
  const input = record(value, ['type', 'id', 'teamId'], 'participant');
  if (!['agent', 'team'].includes(input.type)) fail('invalid_variant', 'participant.type');
  if (input.type === 'team' && Object.hasOwn(input, 'teamId')) {
    fail('contradictory_variant', 'participant');
  }
  const result = { type: input.type, id: uuid(input.id, 'participant.id') };
  if (Object.hasOwn(input, 'teamId')) result.teamId = uuid(input.teamId, 'participant.teamId');
  return Object.freeze(result);
}

/**
 * Compare every target field after normalization. Callers must independently
 * resolve the second target from authoritative records; agreement alone never
 * proves permission. Returns a fresh immutable target, not an allow decision.
 */
export function assertProjectParticipationTargetAgreement(requested, resolved) {
  const left = normalizeProjectParticipationTarget(requested);
  const right = normalizeProjectParticipationTarget(resolved);
  if (left.type !== right.type
    || Object.keys(left).some(key => left[key] !== right[key])) {
    fail('scope_mismatch', 'target');
  }
  return left;
}
