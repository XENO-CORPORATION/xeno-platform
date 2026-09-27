import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import { scopesForClient } from '../config/oidcAuthorityPolicy.js';
import { normalizeOwnerScope } from '../services/workforceScope.js';
import { WorkforceResourceError } from '../services/workforceResources.js';
import { apiKeyWorkforceNamespace, validApiKeyWorkforceScopes } from '../services/apiKeyWorkforceAuthority.js';
import apiKeyWorkforceCapabilityRoutes from './apiKeyWorkforceCapabilityRoutes.js';
import workforceOwnershipTransferRoutes from './workforceOwnershipTransferRoutes.js';

const MAX_BODY_BYTES = 256 * 1024;
const ERRORS = Object.freeze({
  bad_input: [400, 'Invalid workforce request.'],
  denied: [403, 'Workforce access denied.'],
  not_found: [404, 'Workforce resource unavailable.'],
  needs_approval: [403, 'Workforce approval required.'],
  conflict: [409, 'Workforce request conflicts with current state.'],
  rate_limited: [429, 'Workforce request rate exceeded.'],
  unavailable: [503, 'Workforce service unavailable.'],
  timeout: [504, 'Workforce request timed out.'],
  internal: [500, 'Workforce request failed.'],
});
function fail(res, code, details) {
  const [status, error] = ERRORS[code] || ERRORS.internal;
  return res.status(status).json({ success: false, error, code, ...(details ? { details } : {}) });
}

const uuid = value => normalizeOwnerScope({ type: 'user', id: value }).id;
function matchingIdentity(value, request) {
  const operationId = uuid(value.operationId);
  const owner = normalizeOwnerScope(value.owner);
  const requestedOwner = normalizeOwnerScope(request.owner);
  if (operationId !== uuid(request.operationId) || owner.type !== requestedOwner.type || owner.id !== requestedOwner.id) throw new Error('Operation identity mismatch');
  return { operationId, owner };
}
const fields = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));

/** Admit only observed service states and project their documented fields.
 * A truthy object, unknown state or mismatched receipt is not a successful write. */
function responseObservation(observed, request, readOnly) {
  try {
    if (!observed || typeof observed !== 'object' || Array.isArray(observed) || observed.success === false) return null;
    if (observed.state === 'not-observed') {
      if (!readOnly || observed.operation !== null || observed.resource !== null || observed.version !== null || observed.replayed !== false) return null;
      return { state: 'not-observed', operation: null, resource: null, version: null, replayed: false };
    }
    const op = observed.operation;
    if (observed.state !== 'committed' || !op || op.schemaVersion !== 1 || op.state !== 'committed'
      || op.action !== 'agent.resource.create' || typeof observed.replayed !== 'boolean'
      || typeof op.resourceRevision !== 'string' || !/^[1-9][0-9]*$/.test(op.resourceRevision)
      || !(op.agentVersion === null || (Number.isSafeInteger(op.agentVersion) && op.agentVersion > 0))
      || typeof op.committedAt !== 'string' || !Number.isFinite(Date.parse(op.committedAt))) return null;
    const identity = matchingIdentity(op, request);
    const resourceId = uuid(op.resourceId);
    const operation = { schemaVersion: 1, ...identity, action: op.action, state: 'committed', resourceId,
      resourceRevision: op.resourceRevision, agentVersion: op.agentVersion, committedAt: op.committedAt };
    const access = observed.resourceAccess;
    if (!access || typeof access.allowed !== 'boolean') return null;
    let resource = null;
    let version = null;
    if (!access.allowed) {
      if (observed.resource !== null || observed.version !== null || access.reason !== 'no_access') return null;
    } else {
      if (!observed.resource || uuid(observed.resource.id) !== resourceId) return null;
      const resourceOwner = normalizeOwnerScope(observed.resource.owner);
      if (resourceOwner.type !== identity.owner.type || resourceOwner.id !== identity.owner.id) return null;
      resource = fields(observed.resource, ['id', 'kind', 'owner', 'createdByUserId', 'name', 'description', 'status', 'revision', 'createdAt', 'updatedAt']);
      if (op.agentVersion !== null) {
        if (!observed.version || uuid(observed.version.resourceId) !== resourceId || observed.version.version !== op.agentVersion) return null;
        version = fields(observed.version, ['resourceId', 'version', 'schemaVersion', 'content', 'contentHash', 'provenance', 'license', 'createdByUserId', 'createdAt']);
      } else if (observed.version !== null) return null;
    }
    return { state: 'committed', operation, resource, version,
      resourceAccess: access.allowed ? { allowed: true } : { allowed: false, reason: 'no_access' }, replayed: observed.replayed };
  } catch { return null; }
}

/** Scope is semantic: receipt lookup remains a read even though its explicit
 * owner/operation context is sent as POST JSON (not a URL/query-string leak). */
function requireWorkforceScope(scope) {
  return (req, res, next) => {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Authentication required.', code: 'denied' });
    if (req.auth?.kind === 'legacy') {
      // Existing authentication accepts HEADER JWTs, not cookies. No body or
      // Origin/client header may select a receipt namespace. This is a legacy
      // session namespace, not a claim that a caller is the xeno-web OAuth client.
      req.workforceContext = { actorUserId: req.user.id, clientId: 'legacy-workforce-session' };
      return next();
    }
    if (req.auth?.kind === 'api-key') {
      if (!validApiKeyWorkforceScopes(req.auth.scopes) || !req.auth.scopes.includes(scope)) return fail(res, 'denied');
      try { req.workforceContext = { actorUserId: req.user.id, clientId: apiKeyWorkforceNamespace(req.auth.keyId), apiKeyId: uuid(req.auth.keyId) }; }
      catch { return fail(res, 'denied'); }
      return next();
    }
    // Workspace-scoped or unknown key classes never become global credentials.
    if (req.auth?.kind !== 'oidc') return fail(res, 'denied');
    const clientId = req.auth.clientId;
    const ceiling = scopesForClient(clientId);
    const granted = new Set(String(req.auth.scope || '').split(/\s+/).filter(Boolean));
    if (!ceiling?.includes(scope) || !granted.has(scope)) {
      res.set('WWW-Authenticate', `${req.auth.dpopJkt ? 'DPoP' : 'Bearer'} error="insufficient_scope", scope="${scope}"`);
      return res.status(403).json({ success: false, error: 'Insufficient workforce scope.', code: 'denied', required_scope: scope });
    }
    req.workforceContext = { actorUserId: req.user.id, clientId };
    return next();
  };
}

const defaultCreate = async (...args) => (await import('../services/workforceResources.js')).createWorkforceResource(...args);
const defaultCreateAndAssign = async (...args) => (await import('../services/workforceResources.js')).createAndAssignWorkforceResource(...args);
const defaultRead = async (...args) => (await import('../services/workforceResources.js')).readWorkforceResourceOperation(...args);
const defaultList = async (...args) => (await import('../services/workforceCatalog.js')).listOwnedWorkforceResources(...args);
const defaultAdmit = async (...args) => (await import('../services/workforceRunAdmission.js')).admitRun(...args);
const defaultReadAdmission = async (...args) => (await import('../services/workforceRunAdmission.js')).readRunAdmission(...args);
const defaultReadPin = async (...args) => (await import('../services/workforceRunAdmission.js')).readRunnablePin(...args);
const defaultReadCapacity = async (...args) => (await import('../services/workforceCapacity.js')).readWorkforceCapacity(...args);
const defaultReadEvaluation = async (...args) => (await import('../services/workforceEvaluation.js')).readWorkforceEvaluation(...args);
const runResults = (name) => async (...args) => (await import('../services/workforceRunResults.js'))[name](...args);
const memberRemoval = (name) => async (...args) => (await import('../services/workforceMemberRemoval.js'))[name](...args);
const agentRevision = (name) => async (...args) => (await import('../services/workforceAgentRevision.js'))[name](...args);
// RUN-03: the lease is signed with the platform's OWN active OIDC key -- the one published at
// /api/oauth2/jwks -- so any runtime can verify it offline against the public JWKS, and no key
// ever comes from a request.
const defaultAuthorizeStep = async (db, context, body) => {
  const [{ authorizeRunStep }, { getSigningKey }] = await Promise.all([
    import('../services/workforceRunAuthority.js'), import('../utils/oidcProvider.js')]);
  const key = await getSigningKey(db);
  return authorizeRunStep(db, context, body, { signingKey: { kid: key.kid, privatePem: key.privatePem } });
};
const defaultRevokeRun = async (db, context, body) => (await import('../services/workforceRunAuthority.js')).revokeRun(db, context, body.admissionId);
const defaultReadAuthority = async (db, context, body) => (await import('../services/workforceRunAuthority.js')).readRunAuthority(db, context, body.admissionId);

/** RUN-03: a step authorization is a signed lease plus its public record, and nothing else. */
const LEASE_FIELDS = ['schemaVersion', 'leaseId', 'admissionId', 'sequence', 'operation', 'capability', 'effectiveCapabilities', 'issuedAt', 'expiresAt', 'kid'];
function leaseObservation(value) {
  try {
    const l = value?.lease;
    if (!l || l.schemaVersion !== 1 || uuid(l.leaseId) !== l.leaseId || uuid(l.admissionId) !== l.admissionId
      || typeof l.sequence !== 'string' || !/^[1-9][0-9]{0,18}$/.test(l.sequence) || !capabilities(l.effectiveCapabilities)
      || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.token)
      || !(Date.parse(l.expiresAt) > Date.parse(l.issuedAt)) || Date.parse(l.expiresAt) - Date.parse(l.issuedAt) > 60_000) return null;
    return { lease: fields(l, LEASE_FIELDS), token: value.token };
  } catch { return null; }
}
function authorityObservation(value) {
  try {
    if (!value || value.schemaVersion !== 1 || uuid(value.admissionId) !== value.admissionId || typeof value.revoked !== 'boolean') return null;
    if (value.fencedByAdmissionId !== undefined && value.fencedByAdmissionId !== null && uuid(value.fencedByAdmissionId) !== value.fencedByAdmissionId) return null;
    return fields(value, ['schemaVersion', 'admissionId', 'revoked', 'reason', 'revokedAt', 'latestLeaseSequence', 'replayed', 'fencedByAdmissionId']);
  } catch { return null; }
}

/** RUN-01: an admission is reported only in the shape the service decided it. The router projects
 * the documented fields and refuses anything that is not a whole admission -- a truthy object is
 * not a run the platform agreed to. */
const ADMISSION_FIELDS = ['schemaVersion', 'admissionId', 'operationId', 'agent', 'target', 'team', 'conversationId', 'root',
  'entitlementId', 'payer', 'budget', 'parent', 'capabilities', 'memoryNamespace', 'admittedAt'];
function admissionObservation(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const a = value.admission ?? value;
    if (!a || a.schemaVersion !== 1 || uuid(a.admissionId) !== a.admissionId || !a.agent || !a.target || !a.payer || !a.budget
      || !a.capabilities || !Array.isArray(a.capabilities.effective) || !capabilities(a.capabilities.effective)
      || typeof a.admittedAt !== 'string' || !Number.isFinite(Date.parse(a.admittedAt))) return null;
    // RUN-10: a child names the admission it was carved from, one level below it, and nothing else.
    if (a.parent !== undefined && a.parent !== null && (uuid(a.parent.admissionId) !== a.parent.admissionId
      || !Number.isSafeInteger(a.parent.depth) || a.parent.depth < 1 || a.parent.depth > 8 || Object.keys(a.parent).length !== 2)) return null;
    const admission = fields(a, ADMISSION_FIELDS);
    return Object.hasOwn(value, 'admission')
      ? { admission, replayed: value.replayed === true }
      : { admission };
  } catch { return null; }
}
/** LIFE-09: capacity is reported for the scope ASKED about, as numbers derived at the read, never a
 * stored figure. A reply for another scope, or carrying a field outside this shape, is not reported. */
const intString = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,30})$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
/** VIEW-03: a create-plus-assign result is the creation's own observation (the exact projection POST /resources
 * sends, so a client parses one shape) plus the owner it was created for and the assignments it made -- each
 * for a workspace the request ASKED for, in the order asked, with its state and the side still owed. An
 * assignment to a workspace nobody asked for, a missing one, or an owner that is not the requested owner is
 * not reported. */
const ASSIGNMENT_STATES = ['proposed', 'accepted'];
function createAndAssignObservation(value, request, readOnly) {
  try {
    const base = responseObservation(value, request, readOnly);
    if (!base || base.state !== 'committed') return null;
    const owner = normalizeOwnerScope(value.owner), asked = normalizeOwnerScope(request.owner);
    if (owner.type !== asked.type || owner.id !== asked.id) return null;
    const wanted = Array.isArray(request.assignments) ? request.assignments.map((a) => uuid(a.workspaceId)) : [];
    if (!Array.isArray(value.assignments) || value.assignments.length !== wanted.length) return null;
    const assignments = value.assignments.map((a, i) => {
      if (!a || uuid(a.assignmentId) !== a.assignmentId || uuid(a.workspaceId) !== wanted[i] || !ASSIGNMENT_STATES.includes(a.state)) throw new Error('Invalid assignment');
      if (uuid(a.sourceApprovedByUserId) !== a.sourceApprovedByUserId) throw new Error('Unapproved source');
      const accepted = a.state === 'accepted';
      if (accepted ? uuid(a.targetAcceptedByUserId) !== a.targetAcceptedByUserId || a.awaiting !== null
        : a.targetAcceptedByUserId !== null || a.awaiting !== 'target_acceptance') throw new Error('Inconsistent assignment state');
      const policy = a.policy;
      if (!policy || policy.schemaVersion !== 1 || !['none', 'explicit'].includes(policy.mode) || !Array.isArray(policy.capabilities)) throw new Error('Invalid policy');
      return { assignmentId: a.assignmentId, workspaceId: a.workspaceId, state: a.state,
        policy: { schemaVersion: 1, mode: policy.mode, capabilities: policy.capabilities.map(String) },
        sourceApprovedByUserId: a.sourceApprovedByUserId, targetAcceptedByUserId: a.targetAcceptedByUserId, awaiting: a.awaiting };
    });
    return { ...base, owner, assignments };
  } catch { return null; }
}
/** MKT-01/OWN-03: a revision reply is the receipt, and the version it wrote only to someone who may still revise it.
 * The receipt names the agent and operation asked about, and a version one greater than the one it revised. */
const REVISION_VERSION_FIELDS = ['resourceId', 'version', 'schemaVersion', 'content', 'contentHash', 'provenance', 'license', 'createdByUserId', 'createdAt'];
function revisionObservation(value, request, readOnly) {
  try {
    if (!value || value.schemaVersion !== 1 || typeof value.replayed !== 'boolean') return null;
    const access = value.access;
    if (!access || typeof access.allowed !== 'boolean') return null;
    if (value.state === 'not-observed') {
      if (!readOnly || value.revision !== null || value.version !== null || value.replayed !== false || access.allowed) return null;
      return { schemaVersion: 1, state: 'not-observed', replayed: false, revision: null, version: null, access: { allowed: false, reason: 'no_access' } };
    }
    const r = value.revision;
    if (value.state !== 'committed' || !r || uuid(r.operationId) !== uuid(request.operationId)
      || (request.resourceId !== undefined && uuid(r.resourceId) !== uuid(request.resourceId))
      || !Number.isSafeInteger(r.previousVersion) || r.previousVersion < 1 || r.version !== r.previousVersion + 1
      || (request.baseVersion !== undefined && r.previousVersion !== request.baseVersion)
      || typeof r.committedAt !== 'string' || !Number.isFinite(Date.parse(r.committedAt))) return null;
    const revision = { operationId: r.operationId, resourceId: r.resourceId, previousVersion: r.previousVersion, version: r.version, committedAt: r.committedAt };
    if (!access.allowed) {
      if (value.version !== null || access.reason !== 'no_access') return null;
      return { schemaVersion: 1, state: 'committed', replayed: value.replayed, revision, version: null, access: { allowed: false, reason: 'no_access' } };
    }
    const v = value.version;
    if (!v || uuid(v.resourceId) !== uuid(r.resourceId) || v.version !== r.version || !/^[0-9a-f]{64}$/.test(v.contentHash)) return null;
    return { schemaVersion: 1, state: 'committed', replayed: value.replayed, revision, version: fields(v, REVISION_VERSION_FIELDS), access: { allowed: true } };
  } catch { return null; }
}
function capacityObservation(value, request) {
  try {
    const owner = normalizeOwnerScope(value?.owner), asked = normalizeOwnerScope(request.owner);
    if (value.schemaVersion !== 1 || owner.type !== asked.type || owner.id !== asked.id
      || typeof value.derivedAt !== 'string' || !Number.isFinite(Date.parse(value.derivedAt))
      || !count(value.activeAdmissions) || !count(value.inFlightRuns) || !count(value.activeAgents)
      || value.inFlightRuns > value.activeAdmissions || value.activeAgents > value.activeAdmissions
      || !intString(value.committedCeilingMicro) || !Array.isArray(value.funding) || value.funding.length > 1000) return null;
    const funding = value.funding.map(f => {
      if (!f || uuid(f.payerUserId) !== f.payerUserId || typeof f.canFund !== 'boolean'
        || (Object.hasOwn(f, 'availableMicro') && !intString(f.availableMicro))) throw new Error('Invalid funding row');
      return { payerUserId: f.payerUserId, canFund: f.canFund, ...(Object.hasOwn(f, 'availableMicro') ? { availableMicro: f.availableMicro } : {}) };
    });
    if (new Set(funding.map(f => f.payerUserId)).size !== funding.length) return null;
    return { schemaVersion: 1, owner, derivedAt: value.derivedAt, activeAdmissions: value.activeAdmissions,
      inFlightRuns: value.inFlightRuns, activeAgents: value.activeAgents, committedCeilingMicro: value.committedCeilingMicro, funding };
  } catch { return null; }
}
/** LIFE-04: an evaluation is reported for the scope, subject and window ASKED about, as counts and the ids of
 * the records behind them. A reply about another subject or window, or carrying a field outside this shape --
 * a score above all -- is not reported. */
const COUNT_KEYS = { stopped: ['stopped_by_actor', 'stopped_by_target', 'authority_lost'], handoff: ['offered', 'accepted', 'declined', 'expired'] };
const counts = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(k => count(value[k]));
const ids = value => Array.isArray(value) && value.length <= 500 && value.every(v => uuid(v) === v);
/** RUN-04: a run's result, the receipt of its delivery, and its outcome -- each for the run ASKED about. A
 * delivery for another child, or to another parent than the one asked for, is not reported. */
const OUTCOMES = ['completed', 'failed', 'interrupted'];
const INTERRUPTIONS = ['budget_exhausted', 'stopped', 'authority_lost', 'uncertain', 'blocked'];
function resultShape(r) {
  if (!r || !OUTCOMES.includes(r.outcome) || !(r.interruptedReason === null || INTERRUPTIONS.includes(r.interruptedReason))
    || (r.outcome === 'interrupted') !== (r.interruptedReason !== null) || typeof r.summary !== 'string' || !Array.isArray(r.artifacts)
    || !Number.isFinite(Date.parse(r.reportedAt))) throw new Error('Invalid result');
  const artifacts = r.artifacts.map(a => {
    if (!a || typeof a.name !== 'string' || typeof a.ref !== 'string' || (a.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(a.sha256))) throw new Error('Invalid artifact');
    return { name: a.name, ref: a.ref, ...(a.sha256 ? { sha256: a.sha256 } : {}) };
  });
  return { outcome: r.outcome, interruptedReason: r.interruptedReason, summary: r.summary, artifacts, reportedAt: r.reportedAt };
}
function deliveryShape(d) {
  if (!d || uuid(d.childAdmissionId) !== d.childAdmissionId || uuid(d.parentAdmissionId) !== d.parentAdmissionId || !OUTCOMES.includes(d.outcome)
    || !(d.interruptedReason === null || INTERRUPTIONS.includes(d.interruptedReason)) || !Number.isFinite(Date.parse(d.deliveredAt))) throw new Error('Invalid delivery');
  return { childAdmissionId: d.childAdmissionId, parentAdmissionId: d.parentAdmissionId, outcome: d.outcome,
    interruptedReason: d.interruptedReason, deliveredAt: d.deliveredAt };
}
function reportObservation(value) {
  try { return { replayed: value?.replayed === true, result: resultShape(value.result) }; } catch { return null; }
}
function deliveryObservation(value, request) {
  try {
    const delivery = deliveryShape(value?.delivery);
    if (delivery.childAdmissionId !== uuid(request.childAdmissionId) || delivery.parentAdmissionId !== uuid(request.parentAdmissionId)) return null;
    return { replayed: value.replayed === true, delivery };
  } catch { return null; }
}
function outcomeObservation(value, request) {
  try {
    if (!value || value.schemaVersion !== 1 || value.admissionId !== uuid(request.admissionId)) return null;
    if (!['running', ...OUTCOMES].includes(value.state)) return null;
    for (const id of [value.parentAdmissionId, value.conversationId]) if (id !== null && uuid(id) !== id) return null;
    if (value.taskRef !== null && (typeof value.taskRef !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.taskRef))) return null;
    const interruption = value.interruption === null ? null : (() => {
      const i = value.interruption;
      if (!i || !INTERRUPTIONS.includes(i.reason) || i.derivedFrom !== 'fence' || uuid(i.fencedByAdmissionId) !== i.fencedByAdmissionId) throw new Error('Invalid interruption');
      return { reason: i.reason, derivedFrom: 'fence', fencedByAdmissionId: i.fencedByAdmissionId };
    })();
    if (!Array.isArray(value.children) || value.children.length > 1000) return null;
    return { schemaVersion: 1, admissionId: value.admissionId, parentAdmissionId: value.parentAdmissionId, taskRef: value.taskRef,
      conversationId: value.conversationId, state: value.state,
      result: value.result === null ? null : resultShape(value.result), interruption,
      delivery: value.delivery === null ? null : deliveryShape(value.delivery),
      children: value.children.map(c => { if (uuid(c.admissionId) !== c.admissionId || typeof c.delivered !== 'boolean') throw new Error('Invalid child');
        return { admissionId: c.admissionId, delivered: c.delivered }; }) };
  } catch { return null; }
}
/** LIFE-02: a removal is reported for the membership ASKED about -- its decision, when it took effect, and for
 * each run it fenced whether that run is settled and, if not, what it still owes. A removal of another
 * membership, or a run row carrying anything outside this shape, is not reported. */
const OWES = ['fence', 'lease_expiry', 'report_or_delivery'];
function removalShape(r, request) {
  if (!r || r.schemaVersion !== 1 || r.membershipId !== uuid(request.membershipId) || uuid(r.teamId) !== r.teamId) throw new Error('Invalid removal');
  const d = r.decision;
  if (!d || uuid(d.actorUserId) !== d.actorUserId || typeof d.clientId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(d.clientId)
    || uuid(d.operationId) !== d.operationId) throw new Error('Invalid decision');
  if (!Number.isFinite(Date.parse(r.removedAt)) || !(r.archivedAt === null || Number.isFinite(Date.parse(r.archivedAt)))) throw new Error('Invalid time');
  if (!Array.isArray(r.runs) || r.runs.length > 1000 || typeof r.settled !== 'boolean') throw new Error('Invalid runs');
  const runs = r.runs.map(x => {
    if (!x || uuid(x.admissionId) !== x.admissionId || ![x.fenced, x.leaseLive, x.accounted, x.settled].every(b => typeof b === 'boolean')
      || !(x.owes === null ? x.settled : OWES.includes(x.owes) && !x.settled)) throw new Error('Invalid run');
    return { admissionId: x.admissionId, fenced: x.fenced, leaseLive: x.leaseLive, accounted: x.accounted, settled: x.settled, owes: x.owes };
  });
  if (r.settled !== runs.every(x => x.settled)) throw new Error('Inconsistent settlement');
  return { schemaVersion: 1, membershipId: r.membershipId, teamId: r.teamId,
    decision: { actorUserId: d.actorUserId, clientId: d.clientId, operationId: d.operationId },
    removedAt: r.removedAt, archivedAt: r.archivedAt, runs, settled: r.settled };
}
function removalObservation(value, request) {
  try { return { replayed: value?.replayed === true, removal: removalShape(value.removal, request) }; } catch { return null; }
}
function removalReadObservation(value, request) {
  try { return removalShape(value, request); } catch { return null; }
}
function evaluationObservation(value, request) {
  try {
    const owner = normalizeOwnerScope(value?.owner), asked = normalizeOwnerScope(request.owner);
    if (value.schemaVersion !== 1 || owner.type !== asked.type || owner.id !== asked.id) return null;
    if (JSON.stringify(value.subject) !== JSON.stringify(request.subject)) return null;
    if (Date.parse(value.window?.since) !== Date.parse(request.window?.since) || Date.parse(value.window?.until) !== Date.parse(request.window?.until)) return null;
    for (const t of [value.derivedAt, value.settledBefore]) if (typeof t !== 'string' || !Number.isFinite(Date.parse(t))) return null;
    const r = value.runs, st = value.steps, d = value.decisions, rec = value.records;
    if (typeof value.closed !== 'boolean' || !r || !count(r.admitted) || !count(r.children) || !count(r.activeAtEnd) || !counts(r.stopped, COUNT_KEYS.stopped)
      || !st || !count(st.privilegedCalls) || !count(st.providerDispatches)) return null;
    if (value.handoffs !== null && !(value.handoffs && counts(value.handoffs.sent, COUNT_KEYS.handoff) && counts(value.handoffs.received, COUNT_KEYS.handoff))) return null;
    if (!d || !count(d.withEvidence) || !d.byRelation || typeof d.byRelation !== 'object') return null;
    const byRelation = {};
    for (const [relation, kinds] of Object.entries(d.byRelation)) {
      if (!['made', 'answeredFor', 'about'].includes(relation) || !kinds || typeof kinds !== 'object') return null;
      byRelation[relation] = {};
      for (const [kind, n] of Object.entries(kinds)) { if (!/^[a-z]+\.[a-z]+$/.test(kind) || !count(n)) return null; byRelation[relation][kind] = n; }
    }
    if (!rec || !ids(rec.admissions) || !ids(rec.handoffs) || !ids(rec.decisions) || typeof rec.truncated !== 'boolean') return null;
    if (!Array.isArray(value.notRecorded) || !value.notRecorded.every(s => typeof s === 'string' && /^[a-zA-Z]{1,40}$/.test(s))) return null;
    return { schemaVersion: 1, owner, subject: value.subject, window: { since: value.window.since, until: value.window.until },
      derivedAt: value.derivedAt, settledBefore: value.settledBefore, closed: value.closed,
      runs: { admitted: r.admitted, children: r.children, activeAtEnd: r.activeAtEnd, stopped: fields(r.stopped, COUNT_KEYS.stopped) },
      steps: { privilegedCalls: st.privilegedCalls, providerDispatches: st.providerDispatches },
      handoffs: value.handoffs === null ? null : { sent: fields(value.handoffs.sent, COUNT_KEYS.handoff), received: fields(value.handoffs.received, COUNT_KEYS.handoff) },
      decisions: { byRelation, withEvidence: d.withEvidence },
      records: { admissions: rec.admissions, handoffs: rec.handoffs, decisions: rec.decisions, truncated: rec.truncated },
      notRecorded: value.notRecorded };
  } catch { return null; }
}
/** RUN-01's precondition: the pin reported is for the agent and the target ASKED about, in its whole
 * shape -- a reply about another resource or another target is not an answer to this question. */
function pinObservation(value, request) {
  try {
    if (!value || value.schemaVersion !== 1 || !value.agent || !value.target || !value.terms) return null;
    const a = value.agent;
    if (uuid(a.resourceId) !== a.resourceId || a.resourceId !== uuid(request.agent?.resourceId)
      || !Number.isSafeInteger(a.version) || a.version < 1 || typeof a.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(a.contentHash)) return null;
    if (JSON.stringify(value.target) !== JSON.stringify(request.target && Object.fromEntries(Object.entries(request.target)
      .map(([k, v]) => [k, k === 'kind' ? v : uuid(v)])))) return null;
    const team = request.team ? { teamId: uuid(request.team.teamId) } : null;
    if (JSON.stringify(value.team ?? null) !== JSON.stringify(team)) return null;
    if (!capabilities(value.terms.definition) || !capabilities(value.terms.target)) return null;
    return { schemaVersion: 1, agent: { resourceId: a.resourceId, version: a.version, contentHash: a.contentHash },
      target: value.target, team, terms: { definition: value.terms.definition, target: value.terms.target } };
  } catch { return null; }
}
const capabilities = value => Array.isArray(value) && value.length <= 64
  && value.every(c => typeof c === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$/.test(c));
const revisionString = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value);
/** VIEW-02: each scoped view carries ONLY its own scope's facts. An assigned row carries this
 * workspace's assignment, a project row this project's participation -- and neither carries an
 * `owner`, because the source owner of a resource assigned in is not this scope's to disclose. */
function scopedFacts(view, item) {
  if (view === 'owned') return {};
  if (view === 'assigned') {
    const a = item.assignment;
    if (!a || uuid(a.id) !== a.id || !(a.divisionId === null || uuid(a.divisionId) === a.divisionId) || !revisionString(a.revision)
      || typeof a.acceptedAt !== 'string' || !Number.isFinite(Date.parse(a.acceptedAt))
      || !['none', 'explicit'].includes(a.effectiveMode) || !capabilities(a.effectiveCapabilities)) throw new Error('Invalid assignment facts');
    return { assignment: fields(a, ['id', 'divisionId', 'revision', 'acceptedAt', 'effectiveMode', 'effectiveCapabilities']) };
  }
  const p = item.participation;
  if (!p || uuid(p.id) !== p.id || !['workspace', 'personal'].includes(p.targetKind) || typeof p.responsibility !== 'string'
    || !p.responsibility.trim() || Buffer.byteLength(p.responsibility, 'utf8') > 200 || !revisionString(p.revision)
    || !capabilities(p.effectiveCapabilities)) throw new Error('Invalid participation facts');
  return { participation: fields(p, ['id', 'targetKind', 'responsibility', 'revision', 'effectiveCapabilities']) };
}
/** VIEW-01: a global row states HOW the caller reaches it. Owner and creator appear only with owner
 * access -- a row reached solely through an assignment names neither, exactly as the assigned view. */
function globalFacts(item, request) {
  const access = item.access;
  if (!Array.isArray(access) || !access.length || new Set(access).size !== access.length
    || access.some(a => !['personal', 'workspace', 'assigned'].includes(a))) throw new Error('Invalid access');
  if (request.access !== undefined && !access.includes(request.access)) throw new Error('Access filter not honoured');
  const into = item.assignedInto;
  if (!Array.isArray(into) || into.some(id => uuid(id) !== id) || new Set(into).size !== into.length
    || (into.length > 0) !== access.includes('assigned')) throw new Error('Invalid assignment facts');
  if (request.assignedTo !== undefined && !into.includes(uuid(request.assignedTo))) throw new Error('Assignment filter not honoured');
  const owned = access.includes('personal') || access.includes('workspace');
  if (owned !== (Object.hasOwn(item, 'owner') && Object.hasOwn(item, 'createdByUserId'))) {
    throw new Error('Owner facts appear exactly when the caller reads the owner scope');
  }
  if (!owned) return { access, assignedInto: into };
  const owner = normalizeOwnerScope(item.owner);
  if ((owner.type === 'user') !== access.includes('personal') || (owner.type === 'workspace') !== access.includes('workspace')) {
    throw new Error('Owner scope does not match access');
  }
  if (request.owner !== undefined) {
    const wanted = normalizeOwnerScope(request.owner);
    if (wanted.type !== owner.type || wanted.id !== owner.id) throw new Error('Owner filter not honoured');
  }
  if (!(item.createdByUserId === null || uuid(item.createdByUserId) === item.createdByUserId)) throw new Error('Invalid creator');
  return { access, owner, createdByUserId: item.createdByUserId, assignedInto: into };
}
function catalogObservation(value, request) {
  try {
    if (!value || typeof value !== 'object' || value.success === false) return null;
    const view = request.view ?? 'owned';
    if (view === 'global') return globalObservation(value, request);
    const owner = normalizeOwnerScope(value.owner), requested = normalizeOwnerScope(request.owner);
    if (value.schemaVersion !== 1 || value.scope !== view || !['owned', 'assigned', 'project'].includes(view)
      || owner.type !== requested.type || owner.id !== requested.id
      || (view === 'project' ? value.projectId !== uuid(request.projectId) : Object.hasOwn(value, 'projectId'))
      || !Array.isArray(value.items) || value.items.length > (request.limit ?? 50)
      || !(value.nextCursor === null || (typeof value.nextCursor === 'string' && /^[a-zA-Z0-9_-]{1,2048}$/.test(value.nextCursor)))) return null;
    const items = value.items.map(item => {
      if (view === 'owned') {
        const scope = normalizeOwnerScope(item.owner);
        if (scope.type !== owner.type || scope.id !== owner.id) throw new Error('Invalid catalog owner');
      } else if (Object.hasOwn(item, 'owner') || Object.hasOwn(item, 'createdByUserId')) {
        throw new Error('A scoped view never discloses the source owner or its creator attribution');
      }
      if (uuid(item.id) !== item.id || !['agent', 'team'].includes(item.kind)
        || item.status !== (request.status ?? 'active') || (request.kind !== undefined && item.kind !== request.kind)
        || typeof item.name !== 'string' || !item.name.trim() || Buffer.byteLength(item.name, 'utf8') > 200
        || typeof item.description !== 'string' || Buffer.byteLength(item.description, 'utf8') > 4096
        || (view === 'owned' && !(item.createdByUserId === null || uuid(item.createdByUserId) === item.createdByUserId))
        || typeof item.revision !== 'string' || !/^[1-9][0-9]{0,18}$/.test(item.revision)
        || typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string'
        || !Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.updatedAt))) throw new Error('Invalid catalog metadata');
      return { ...fields(item, ['id', 'kind', ...(view === 'owned' ? ['owner', 'createdByUserId'] : []), 'name', 'description',
        'status', 'revision', 'createdAt', 'updatedAt']), ...scopedFacts(view, item) };
    });
    // Owned rows are one per resource. A scoped row is one per assignment or participation, so its
    // uniqueness is that record's id -- a resource assigned in, revoked and assigned again appears
    // once per live assignment, and only one of those can be live at a time.
    const keys = items.map(item => view === 'owned' ? item.id : (item.assignment ?? item.participation).id);
    if (new Set(keys).size !== items.length) return null;
    return { schemaVersion: 1, scope: view, owner, ...(view === 'project' ? { projectId: value.projectId } : {}),
      items, nextCursor: value.nextCursor };
  } catch { return null; }
}

const itemMetadataValid = (item, request) => uuid(item.id) === item.id && ['agent', 'team'].includes(item.kind)
  && item.status === (request.status ?? 'active') && (request.kind === undefined || item.kind === request.kind)
  && typeof item.name === 'string' && item.name.trim() && Buffer.byteLength(item.name, 'utf8') <= 200
  && typeof item.description === 'string' && Buffer.byteLength(item.description, 'utf8') <= 4096
  && typeof item.revision === 'string' && /^[1-9][0-9]{0,18}$/.test(item.revision)
  && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string'
  && Number.isFinite(Date.parse(item.createdAt)) && Number.isFinite(Date.parse(item.updatedAt));
function globalObservation(value, request) {
  if (value.schemaVersion !== 1 || value.scope !== 'global' || Object.hasOwn(value, 'owner') || Object.hasOwn(value, 'projectId')
    || !Array.isArray(value.items) || value.items.length > (request.limit ?? 50)
    || !(value.nextCursor === null || (typeof value.nextCursor === 'string' && /^[a-zA-Z0-9_-]{1,2048}$/.test(value.nextCursor)))) return null;
  const search = typeof request.search === 'string' ? request.search.trim().toLowerCase() : null;
  const items = value.items.map(item => {
    if (!itemMetadataValid(item, request)) throw new Error('Invalid catalog metadata');
    if (search && !item.name.toLowerCase().includes(search) && !item.description.toLowerCase().includes(search)) {
      throw new Error('Search filter not honoured');
    }
    return { ...fields(item, ['id', 'kind', 'name', 'description', 'status', 'revision', 'createdAt', 'updatedAt']),
      ...globalFacts(item, request) };
  });
  // One global row per RESOURCE -- a resource reached two ways is still one row.
  if (new Set(items.map(item => item.id)).size !== items.length) return null;
  return { schemaVersion: 1, scope: 'global', items, nextCursor: value.nextCursor };
}

/** Mount with databaseMiddleware; each endpoint authenticates itself. Services
 * are injectable for HTTP boundary qualification only, never from request data.
 * Domain input normalization, canonical principal/ReBAC checks and transactions
 * belong to the real service, not the renderer or this routing adapter. */
export function createWorkforceRouter({ createWorkforceResource = defaultCreate, readWorkforceResourceOperation = defaultRead, listOwnedWorkforceResources = defaultList,
  createAndAssignWorkforceResource = defaultCreateAndAssign,
  admitRun = defaultAdmit, readRunAdmission = defaultReadAdmission, readRunnablePin = defaultReadPin, readWorkforceCapacity = defaultReadCapacity,
  readWorkforceEvaluation = defaultReadEvaluation,
  reportRunResult = runResults('reportRunResult'), deliverRunResult = runResults('deliverRunResult'), readRunOutcome = runResults('readRunOutcome'),
  removeTeamMember = memberRemoval('removeTeamMember'), readMemberRemoval = memberRemoval('readMemberRemoval'), archiveMemberRemoval = memberRemoval('archiveMemberRemoval'),
  reviseAgentDefinition = agentRevision('reviseAgentDefinition'), readAgentRevision = agentRevision('readAgentRevision'),
  authorizeRunStep = defaultAuthorizeStep,
  revokeRun = defaultRevokeRun, readRunAuthority = defaultReadAuthority } = {}) {
  const router = express.Router();
  router.use('/api-key-capabilities', apiKeyWorkforceCapabilityRoutes);
  // OWN-05: two-sided, reviewed, audited ownership transfer. Its own stricter auth bar -- see the router.
  router.use('/ownership-transfers', workforceOwnershipTransferRoutes);
  const parse = express.json({ limit: MAX_BODY_BYTES, strict: true });
  const handle = (service, readOnly = false, project = responseObservation) => async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(res, 'bad_input');
      // The app may already have parsed JSON with a wider limit. Re-apply this
      // route's limit and reject authentication claims before dispatch.
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) return fail(res, 'bad_input');
      if (['actorUserId', 'clientId', 'userId', 'principal', 'auth'].some(key => Object.hasOwn(body, key))) return fail(res, 'bad_input');
      const observed = project(await service(req.db, req.workforceContext, body), body, readOnly);
      if (!observed) return fail(res, 'internal');
      return res.json({ ...observed, success: true });
    } catch (error) {
      if (error instanceof WorkforceResourceError && error.code === 'unavailable'
        && error.details?.schemaVersion === 1 && error.details.reason === 'operation_state_uncertain') {
        try {
          const identity = matchingIdentity(error.details, req.body);
          return fail(res, 'unavailable', { schemaVersion: 1, reason: 'operation_state_uncertain', ...identity });
        } catch { return fail(res, 'internal'); }
      }
      // A run-admission refusal carries its typed reason, because the reason IS the answer a client
      // acts on (re-pin a stale version, ask for budget approval, re-admit a member). Only the
      // closed schemaVersion + reason (+ the one documented number) cross; nothing else of `details`.
      if (error?.name === 'RunAdmissionError' && Object.hasOwn(ERRORS, error.code)
        && typeof error.details?.reason === 'string' && /^[a-z_]{1,64}$/.test(error.details.reason)) {
        const extra = {};
        if (Number.isSafeInteger(error.details.currentVersion)) extra.currentVersion = error.details.currentVersion;
        if (typeof error.details.availableMicro === 'string' && /^[0-9]{1,20}$/.test(error.details.availableMicro)) extra.availableMicro = error.details.availableMicro;
        if (typeof error.details.field === 'string' && /^[a-zA-Z.]{1,64}$/.test(error.details.field)) extra.field = error.details.field;
        if (typeof error.details.revocation === 'string' && /^[a-z_]{1,32}$/.test(error.details.revocation)) extra.revocation = error.details.revocation;
        return fail(res, error.code, { schemaVersion: 1, reason: error.details.reason, ...extra });
      }
      // LIFE-02: a removal refusal carries its reason, and an unsettled one says what is still owed -- the
      // ids of the runs and the one thing each owes, and nothing else of the service's detail.
      if (error?.name === 'MemberRemovalError' && Object.hasOwn(ERRORS, error.code)
        && typeof error.details?.reason === 'string' && /^[a-z_]{1,64}$/.test(error.details.reason)) {
        const extra = {};
        try {
          if (Array.isArray(error.details.unsettled) && error.details.unsettled.length <= 1000) {
            extra.unsettled = error.details.unsettled.map(u => {
              if (uuid(u?.admissionId) !== u.admissionId || !OWES.includes(u.owes)) throw new Error('Invalid unsettled run');
              return { admissionId: u.admissionId, owes: u.owes };
            });
          }
        } catch { return fail(res, 'internal'); }
        return fail(res, error.code, { schemaVersion: 1, reason: error.details.reason, ...extra });
      }
      // MKT-01/OWN-03: a revision refusal carries its reason, and a stale base the current version to re-read.
      if (error?.name === 'AgentRevisionError' && Object.hasOwn(ERRORS, error.code)
        && typeof error.details?.reason === 'string' && /^[a-z_]{1,64}$/.test(error.details.reason)) {
        if (error.code === 'unavailable' && error.details.reason === 'operation_state_uncertain') {
          try { return fail(res, 'unavailable', { schemaVersion: 1, reason: 'operation_state_uncertain', operationId: uuid(req.body.operationId) }); }
          catch { return fail(res, 'internal'); }
        }
        const extra = Number.isSafeInteger(error.details.currentVersion) ? { currentVersion: error.details.currentVersion } : {};
        return fail(res, error.code, { schemaVersion: 1, reason: error.details.reason, ...extra });
      }
      return fail(res, Object.hasOwn(ERRORS, error?.code) ? error.code : 'internal');
    }
  };
  router.post('/resources', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:manage'), parse, handle(createWorkforceResource));
  // VIEW-03: create a resource and assign it in ONE durable command. A SIBLING of /resources rather than an
  // extra field on it: shipped clients parse that response strictly, and an added key would fail every one.
  router.post('/resources/create-and-assign', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:manage'), parse,
    handle(createAndAssignWorkforceResource, false, createAndAssignObservation));
  router.post('/resources/list', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:read'), parse, handle(listOwnedWorkforceResources, true, catalogObservation));
  router.post('/resource-operations/read', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:read'), parse, handle(readWorkforceResourceOperation, true));
  // RUN-01/RUN-02: admit one run. The service resolves every fact from authoritative rows and computes
  // the intersection; this adapter only authenticates (workforce:manage -- admitting a run commits a
  // payer's budget) and bounds the body. Reading an admission back is a workforce:read.
  router.post('/run-admissions', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:manage'), parse,
    handle(admitRun, false, admissionObservation));
  router.post('/run-admissions/read', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:read'), parse,
    handle((db, context, body) => {
      if (Object.keys(body).some(key => key !== 'admissionId')) throw Object.assign(new Error('unknown field'), { code: 'bad_input' });
      return readRunAdmission(db, context, body.admissionId);
    }, true, admissionObservation));
  // LIFE-09: what a scope is running and can still fund, derived at the read. A read, like the catalog.
  router.post('/capacity', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:read'), parse,
    handle(readWorkforceCapacity, true, capacityObservation));
  // LIFE-04: an evaluation of one subject for a stated window, derived at the read. A read, like capacity.
  router.post('/evaluation', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:read'), parse,
    handle(readWorkforceEvaluation, true, evaluationObservation));
  // RUN-01's precondition: the current pin of an agent as runnable at one target, by this actor -- what an
  // admission must name. A read, resolved under admission's own rule; it commits nothing.
  router.post('/run-admissions/pin', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:read'), parse,
    handle(readRunnablePin, true, pinObservation));
  // RUN-03: before each privileged call and each new provider dispatch the runtime asks again, and the
  // answer -- a signed lease of at most 60 s, or a typed refusal -- is re-derived from live rows. A
  // manage act because a lease authorizes spending. Stopping a run is too; reading its state is a read.
  const onlyAdmission = (service) => (db, context, body) => {
    if (Object.keys(body).some(key => key !== 'admissionId')) throw Object.assign(new Error('unknown field'), { code: 'bad_input' });
    return service(db, context, body);
  };
  router.post('/run-admissions/authorize-step', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:manage'), parse,
    handle(authorizeRunStep, false, leaseObservation));
  router.post('/run-admissions/revoke', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:manage'), parse,
    handle(onlyAdmission(revokeRun), false, authorityObservation));
  router.post('/run-admissions/authority', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:read'), parse,
    handle(onlyAdmission(readRunAuthority), true, authorityObservation));
  // RUN-04: a run's result is reported and delivered to its parent -- both manage acts, because a delivered
  // outcome is what the parent then acts on; reading a run's outcome is a read.
  router.post('/run-admissions/result', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:manage'), parse,
    handle(reportRunResult, false, reportObservation));
  router.post('/run-admissions/deliver', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:manage'), parse,
    handle(deliverRunResult, false, deliveryObservation));
  router.post('/run-admissions/outcome', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:read'), parse,
    handle(readRunOutcome, true, outcomeObservation));
  // LIFE-02: removing a team member is a decided manage act that revokes at once; archiving it waits for the
  // work it fenced to settle; reading what it still owes is a read.
  router.post('/member-removals', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:manage'), parse,
    handle(removeTeamMember, false, removalObservation));
  router.post('/member-removals/read', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:read'), parse,
    handle(readMemberRemoval, true, removalReadObservation));
  router.post('/member-removals/archive', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:manage'), parse,
    handle(archiveMemberRemoval, false, removalObservation));
  // MKT-01/OWN-03: revising a definition is a manage act -- the right to change what an agent IS -- and reconciling
  // one by its operation id is a read.
  router.post('/resources/revise-definition', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:manage'), parse,
    handle(reviseAgentDefinition, false, revisionObservation));
  router.post('/resources/revise-definition/read', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:read'), parse,
    handle(readAgentRevision, true, revisionObservation));
  for (const path of ['/resources', '/resources/create-and-assign', '/resources/revise-definition', '/resources/revise-definition/read', '/resources/list', '/resource-operations/read', '/run-admissions', '/run-admissions/read', '/run-admissions/pin', '/capacity', '/evaluation',
    '/run-admissions/authorize-step', '/run-admissions/revoke', '/run-admissions/authority',
    '/run-admissions/result', '/run-admissions/deliver', '/run-admissions/outcome',
    '/member-removals', '/member-removals/read', '/member-removals/archive']) {
    router.all(path, (_req, res) => res.set('Allow', 'POST').status(405).json({ success: false, code: 'bad_input', error: 'Method not allowed.' }));
  }
  router.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large' || error?.type === 'entity.parse.failed') return fail(res, 'bad_input');
    return fail(res, 'internal');
  });
  return router;
}

export default createWorkforceRouter();
