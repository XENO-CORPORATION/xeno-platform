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
const defaultRead = async (...args) => (await import('../services/workforceResources.js')).readWorkforceResourceOperation(...args);
const defaultList = async (...args) => (await import('../services/workforceCatalog.js')).listOwnedWorkforceResources(...args);
const defaultAdmit = async (...args) => (await import('../services/workforceRunAdmission.js')).admitRun(...args);
const defaultReadAdmission = async (...args) => (await import('../services/workforceRunAdmission.js')).readRunAdmission(...args);
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
    return fields(value, ['schemaVersion', 'admissionId', 'revoked', 'reason', 'revokedAt', 'latestLeaseSequence', 'replayed']);
  } catch { return null; }
}

/** RUN-01: an admission is reported only in the shape the service decided it. The router projects
 * the documented fields and refuses anything that is not a whole admission -- a truthy object is
 * not a run the platform agreed to. */
const ADMISSION_FIELDS = ['schemaVersion', 'admissionId', 'operationId', 'agent', 'target', 'team', 'conversationId', 'root',
  'entitlementId', 'payer', 'budget', 'capabilities', 'memoryNamespace', 'admittedAt'];
function admissionObservation(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const a = value.admission ?? value;
    if (!a || a.schemaVersion !== 1 || uuid(a.admissionId) !== a.admissionId || !a.agent || !a.target || !a.payer || !a.budget
      || !a.capabilities || !Array.isArray(a.capabilities.effective) || !capabilities(a.capabilities.effective)
      || typeof a.admittedAt !== 'string' || !Number.isFinite(Date.parse(a.admittedAt))) return null;
    const admission = fields(a, ADMISSION_FIELDS);
    return Object.hasOwn(value, 'admission')
      ? { admission, replayed: value.replayed === true }
      : { admission };
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
  admitRun = defaultAdmit, readRunAdmission = defaultReadAdmission, authorizeRunStep = defaultAuthorizeStep,
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
      return fail(res, Object.hasOwn(ERRORS, error?.code) ? error.code : 'internal');
    }
  };
  router.post('/resources', authMiddleware, requireDpopIfBound, requireWorkforceScope('workforce:manage'), parse, handle(createWorkforceResource));
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
  for (const path of ['/resources', '/resources/list', '/resource-operations/read', '/run-admissions', '/run-admissions/read',
    '/run-admissions/authorize-step', '/run-admissions/revoke', '/run-admissions/authority']) {
    router.all(path, (_req, res) => res.set('Allow', 'POST').status(405).json({ success: false, code: 'bad_input', error: 'Method not allowed.' }));
  }
  router.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large' || error?.type === 'entity.parse.failed') return fail(res, 'bad_input');
    return fail(res, 'internal');
  });
  return router;
}

export default createWorkforceRouter();
