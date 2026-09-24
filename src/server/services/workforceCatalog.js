import { normalizeOwnerScope } from './workforceScope.js';
import { resolvePrincipal } from './agentIdentity.js';
import { check } from '../utils/authzReBAC.js';
import { authorityTransaction, lockWorkspaceAuthority, operationHash } from './workspaceOperationReceipts.js';
import { lockApiKeyWorkforceAuthority } from './apiKeyWorkforceAuthority.js';

export class WorkforceCatalogError extends Error {
  constructor(code = 'denied', reason = 'catalog_authority_unavailable') {
    super(code === 'bad_input' ? 'Invalid workforce catalog request.' : 'Workforce catalog unavailable.');
    this.code = code;
    this.status = code === 'bad_input' ? 400 : 403;
    this.details = Object.freeze({ schemaVersion: 1, reason });
  }
}
const fail = (code, reason) => { throw new WorkforceCatalogError(code, reason); };
const uuid = value => normalizeOwnerScope({ type: 'user', id: value }).id;
function record(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('bad_input', 'invalid_catalog_shape');
  const out = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !d.enumerable || !Object.hasOwn(d, 'value')) fail('bad_input', 'invalid_catalog_shape');
    out[key] = d.value;
  }
  return out;
}
/** VIEW-02's scoped views of the ONE catalog, never a second list API:
 *   owned     resources this owner OWNS (the original catalog, and the default).
 *   assigned  resources ASSIGNED INTO this workspace by an accepted, current assignment -- a
 *             workspace list "shows assigned resources only". Workspace owners only.
 *   project   the resources participating in ONE project, narrowed by the ASN-09 participation
 *             record -- "project views narrow participation". The project is named explicitly and
 *             must belong to the owner scope asked for. */
// VIEW-01, the GLOBAL view: every resource the caller may read, from every scope, in one list --
//   an AUTHORIZED AGGREGATE: exactly the union of the per-scope views the caller already passes,
//   computed by the same authority, so it can never show what those views would not.
const VIEWS = ['owned', 'assigned', 'project', 'global'];
const ACCESS = ['personal', 'workspace', 'assigned'];
function request(value) {
  const input = record(value, ['owner', 'expectedActorAccountId', 'limit', 'kind', 'status', 'cursor', 'view', 'projectId',
    'access', 'assignedTo', 'search']);
  const view = Object.hasOwn(input, 'view') ? input.view : 'owned';
  if (!VIEWS.includes(view)) fail('bad_input', 'invalid_catalog_view');
  // On the global view `owner` narrows the aggregate; on every other view it IS the scope.
  const owner = view === 'global' && !Object.hasOwn(input, 'owner') ? null : normalizeOwnerScope(input.owner);
  const expectedActorAccountId = uuid(input.expectedActorAccountId);
  if ((view === 'assigned' && owner.type !== 'workspace')
    || (view === 'project') !== Object.hasOwn(input, 'projectId')) fail('bad_input', 'invalid_catalog_view');
  // The aggregate's own filters. Refused on a scoped view rather than ignored: a filter that silently
  // does nothing reads as "no match" and would be believed.
  const globalOnly = ['access', 'assignedTo', 'search'].filter(key => Object.hasOwn(input, key));
  if (globalOnly.length && view !== 'global') fail('bad_input', 'invalid_catalog_filter');
  const access = Object.hasOwn(input, 'access') ? input.access : null;
  if (access !== null && !ACCESS.includes(access)) fail('bad_input', 'invalid_catalog_filter');
  const assignedTo = Object.hasOwn(input, 'assignedTo') ? uuid(input.assignedTo) : null;
  let search = null;
  if (Object.hasOwn(input, 'search')) {
    search = typeof input.search === 'string' ? input.search.trim() : '';
    if (!search || search.length > 100 || /[\u0000-\u001f\u007f]/.test(search)) fail('bad_input', 'invalid_catalog_filter');
  }
  const projectId = view === 'project' ? uuid(input.projectId) : null;
  const limit = Object.hasOwn(input, 'limit') ? input.limit : 50;
  const status = Object.hasOwn(input, 'status') ? input.status : 'active';
  const kind = Object.hasOwn(input, 'kind') ? input.kind : null;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !['active', 'archived'].includes(status)
    || (Object.hasOwn(input, 'kind') && !['agent', 'team'].includes(kind))) fail('bad_input', 'invalid_catalog_filter');
  let cursor = null;
  if (Object.hasOwn(input, 'cursor')) {
    if (typeof input.cursor !== 'string' || !/^[a-zA-Z0-9_-]{1,2048}$/.test(input.cursor)) fail('bad_input', 'invalid_catalog_cursor');
    try {
      const bytes = Buffer.from(input.cursor, 'base64url');
      if (bytes.toString('base64url') !== input.cursor) throw new Error('Noncanonical encoding');
      cursor = record(JSON.parse(bytes.toString('utf8')), ['schemaVersion', 'scopeHash', 'afterId', 'afterCreatedAt']);
      if (cursor.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(cursor.scopeHash) || uuid(cursor.afterId) !== cursor.afterId
        || typeof cursor.afterCreatedAt !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?\+00$/.test(cursor.afterCreatedAt)
        || !Number.isFinite(Date.parse(cursor.afterCreatedAt))) throw new Error('Invalid cursor');
    } catch { fail('bad_input', 'invalid_catalog_cursor'); }
  }
  return { owner, expectedActorAccountId, limit, status, kind, cursor, view, projectId, access, assignedTo, search };
}

/** Owner READ authority is distinct from creation and individual creator receipt
 * readback. A resource creator never automatically gains catalog-wide access.
 * Every list holds the canonical workspace gate, owner/principal rows and direct
 * granting tuple rows through its metadata query/transaction commit. Personal
 * delegation writers should also use the owner row FOR UPDATE; tuple row locks
 * independently serialize deletion of an existing grant with this read. */
async function authorizeRead(db, actorId, owner) {
  if (owner.type === 'workspace') {
    const statuses = await lockWorkspaces(db, [owner.id]);
    if (statuses.get(owner.id) !== 'active') fail();
  }
  const principal = await lockReader(db, actorId, owner.type === 'user' ? [owner.id] : []);
  if (!(await scopeReadable(db, principal, owner))) fail();
  return principal;
}

/** Workspace authority gates in sorted order, then those rows -- the declared lock order. */
async function lockWorkspaces(db, ids) {
  const sorted = [...new Set(ids)].sort();
  for (const id of sorted) await lockWorkspaceAuthority(db, id);
  if (!sorted.length) return new Map();
  const { rows } = await db.query('SELECT id,status FROM workspaces WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [sorted]);
  return new Map(rows.map(row => [row.id, row.status]));
}

/** The acting principal, its identity rows held, usable -- and an agent's owner usable too. */
async function lockReader(db, actorId, ownerUserIds) {
  const identities = [actorId, ...ownerUserIds];
  await db.query(`SELECT id FROM users WHERE id=ANY($1::uuid[])
    OR id IN (SELECT owner_user_id FROM agent_identities WHERE user_id=ANY($1::uuid[])) ORDER BY id FOR SHARE`, [identities]);
  await db.query('SELECT user_id FROM agent_identities WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR SHARE', [identities]);
  const principal = await resolvePrincipal(db, actorId);
  if (!principal?.usable || !['human', 'agent'].includes(principal.kind)) fail();
  if (principal.kind === 'agent') {
    const human = await resolvePrincipal(db, principal.owner.id);
    if (!human?.usable || human.kind !== 'human') fail();
  }
  return principal;
}

/** THE read rule, used by every view. A human reads their own personal scope and any workspace they
 * hold viewer-or-above on DIRECTLY; an agent reads exactly what it was granted, never by hierarchy. */
async function scopeReadable(db, principal, owner) {
  if (owner.type === 'user') {
    const human = owner.id === principal.id ? principal : await resolvePrincipal(db, owner.id);
    if (!human?.usable || human.kind !== 'human') return false;
    if (principal.kind === 'human') return principal.id === owner.id;
    if (principal.owner.id !== owner.id) return false;
  }
  const subjectType = principal.kind === 'agent' ? 'agent' : 'user';
  await db.query(`SELECT relation FROM relationship_tuples WHERE object_type=$1 AND object_id=$2
    AND subject_type=$3 AND subject_id=$4 FOR SHARE`, [owner.type, owner.id, subjectType, principal.id]);
  const verdict = await check(db, { object: `${owner.type}:${owner.id}`, subject: `${subjectType}:${principal.id}`,
    relation: owner.type === 'user' ? 'workforce_resource_reader' : 'viewer' });
  return verdict.allowed && ['direct', ...(principal.kind === 'human' ? ['role-hierarchy'] : [])].includes(verdict.via);
}

/** VIEW-01: every scope the caller may read, each decided by `scopeReadable` -- the same rule the
 * per-scope views use, so the aggregate is exactly their union and never a way around them.
 * Candidates are the workspaces the caller holds any tuple on; each is then checked under its lock,
 * so a grant revoked while this runs is honoured and a stray tuple (`member`, `parent`) admits
 * nothing. */
async function authorizeGlobal(db, actorId) {
  const candidates = (await db.query(`SELECT DISTINCT lower(object_id) AS id FROM relationship_tuples
    WHERE object_type='workspace' AND subject_type IN ('user','agent') AND subject_id=$1
      AND object_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`, [actorId])).rows.map(row => row.id);
  const statuses = await lockWorkspaces(db, candidates);
  const principal = await lockReader(db, actorId, []);
  const personalId = principal.kind === 'human' ? principal.id : principal.owner.id;
  const users = (await scopeReadable(db, principal, { type: 'user', id: personalId })) ? [personalId] : [];
  const workspaces = [];
  for (const [id, status] of [...statuses].sort(([a], [b]) => a.localeCompare(b))) {
    if (status === 'active' && await scopeReadable(db, principal, { type: 'workspace', id })) workspaces.push(id);
  }
  return { principal, users, workspaces };
}

/** Scoped listing over the one catalog: the owner's OWNED resources, the resources ASSIGNED INTO a
 * workspace, or the resources participating in ONE project (VIEW-02). No global aggregation.
 * Cursor is a validated, context-bound navigation hint, NOT an authorization
 * credential. All predicates and live read authority are checked on every page.
 * created_at,id gives stable keyset order without truncating PG microseconds.
 *
 * WHAT A SCOPED VIEW MAY SAY about a resource it does not own is the second half of VIEW-02:
 * "unauthorized assignment names, counts, credentials and private resource metadata must not leak".
 * So an assigned or participating row carries the resource's identity and display metadata, plus
 * THIS scope's own assignment/participation facts. It never carries the source owner's identity, its
 * creator attribution, the resource's other assignments or their count, or anything from its
 * definition. What another workspace granted is that workspace's business. */
export async function listOwnedWorkforceResources(pool, authenticatedContext, value) {
  const ctx = record(authenticatedContext, ['actorUserId', 'clientId', 'apiKeyId']);
  const actorId = uuid(ctx.actorUserId);
  if (typeof ctx.clientId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(ctx.clientId)) fail('bad_input', 'invalid_catalog_context');
  const input = request(value);
  if (input.expectedActorAccountId !== actorId) fail('denied', 'actor_precondition_mismatch');
  return authorityTransaction(pool, async db => {
    // The cursor timestamp is formatted at a declared UTC timezone independently
    // of session defaults. No locale timestamp parsing or JS millisecond cursor.
    await db.query("SET LOCAL TIME ZONE 'UTC'");
    let principal, readable = null;
    if (input.view === 'global') {
      readable = await authorizeGlobal(db, actorId);
      principal = readable.principal;
      // A filter naming a scope the caller cannot read is refused exactly like reading that scope:
      // filtering by it would otherwise be an oracle for what it owns or has assigned.
      if (input.owner && !(input.owner.type === 'user' ? readable.users : readable.workspaces).includes(input.owner.id)) fail();
      if (input.assignedTo && !readable.workspaces.includes(input.assignedTo)) fail();
    } else {
      principal = await authorizeRead(db, actorId, input.owner);
    }
    await lockApiKeyWorkforceAuthority(db, { ...ctx, actorUserId: actorId }, 'workforce:read');
    const scopeHash = operationHash({ schemaVersion: 1, scope: input.view, actorId, actorKind: principal.kind,
      clientId: ctx.clientId, owner: input.owner, kind: input.kind, status: input.status,
      ...(input.view === 'project' ? { projectId: input.projectId } : {}),
      ...(input.view === 'global' ? { access: input.access, assignedTo: input.assignedTo, search: input.search } : {}) });
    if (input.cursor && input.cursor.scopeHash !== scopeHash) fail('bad_input', 'catalog_cursor_scope_mismatch');
    const after = [input.cursor?.afterCreatedAt ?? null, input.cursor?.afterId ?? null];
    let rows;
    if (input.view === 'global') {
      // One row per RESOURCE, keyed by the resource's own (created_at,id), carrying every way the caller
      // reaches it. Assignments are read only into workspaces the caller can read, so a resource's other
      // assignments -- their targets and their count -- never reach this row.
      const pattern = input.search === null ? null : `%${input.search.replace(/[\\%_]/g, c => `\\${c}`)}%`;
      ({ rows } = await db.query(`WITH assigned AS (
          SELECT a.resource_id, array_agg(DISTINCT a.workspace_id ORDER BY a.workspace_id)::text[] AS into_ws
            FROM workforce_workspace_assignments a
           WHERE a.workspace_id = ANY($2::uuid[]) AND a.state='accepted' AND a.valid_from<=now()
             AND (a.valid_until IS NULL OR a.valid_until>now())
           GROUP BY a.resource_id)
        SELECT r.id,r.kind,r.owner_user_id,r.owner_workspace_id,r.created_by_user_id,r.name,r.description,r.status,r.revision,
          r.created_at,r.updated_at,r.created_at::text AS cursor_created_at,
          coalesce(r.owner_user_id = ANY($1::uuid[]), false) AS personal_access,
          coalesce(r.owner_workspace_id = ANY($2::uuid[]), false) AS workspace_access,
          coalesce(s.into_ws, '{}'::text[]) AS assigned_into
        FROM workforce_resources r LEFT JOIN assigned s ON s.resource_id = r.id
        WHERE (r.owner_user_id = ANY($1::uuid[]) OR r.owner_workspace_id = ANY($2::uuid[]) OR s.resource_id IS NOT NULL)
          AND ($3::text IS NULL OR r.kind=$3::text) AND r.status=$4
          AND ($5::timestamptz IS NULL OR (r.created_at,r.id)<($5::timestamptz,$6::uuid))
          AND ($7::uuid IS NULL OR r.owner_user_id=$7::uuid) AND ($8::uuid IS NULL OR r.owner_workspace_id=$8::uuid)
          AND ($9::text IS NULL OR ($9::text='personal' AND r.owner_user_id = ANY($1::uuid[]))
            OR ($9::text='workspace' AND r.owner_workspace_id = ANY($2::uuid[])) OR ($9::text='assigned' AND s.resource_id IS NOT NULL))
          AND ($10::text IS NULL OR $10::text = ANY(s.into_ws))
          AND ($11::text IS NULL OR r.name ILIKE $11::text OR r.description ILIKE $11::text)
        ORDER BY r.created_at DESC,r.id DESC LIMIT $12 FOR SHARE OF r`,
      [readable.users, readable.workspaces, input.kind, input.status, ...after,
        input.owner?.type === 'user' ? input.owner.id : null, input.owner?.type === 'workspace' ? input.owner.id : null,
        input.access, input.assignedTo, pattern, input.limit + 1]));
    } else if (input.view === 'owned') {
      ({ rows } = await db.query(`SELECT id,kind,created_by_user_id,name,description,status,revision,
        created_at,updated_at,created_at::text AS cursor_created_at FROM workforce_resources
        WHERE ${input.owner.type === 'user' ? 'owner_user_id' : 'owner_workspace_id'}=$1
          AND ($2::text IS NULL OR kind=$2) AND status=$3
          AND ($4::timestamptz IS NULL OR (created_at,id)<($4::timestamptz,$5::uuid))
        ORDER BY created_at DESC,id DESC LIMIT $6 FOR SHARE`,
      [input.owner.id, input.kind, input.status, ...after, input.limit + 1]));
    } else if (input.view === 'assigned') {
      // Keyed by the ASSIGNMENT's own (created_at,id), so the keyset stays total when one resource
      // is assigned into this workspace more than once over time. Only an assignment that grants
      // something NOW is listed -- a proposal, a revocation or an expiry is not "assigned".
      ({ rows } = await db.query(`SELECT r.id,r.kind,r.created_by_user_id,r.name,r.description,r.status,r.revision,
          r.created_at,r.updated_at,a.id AS assignment_id,a.target_division_id,a.accepted_at,a.revision AS assignment_revision,
          ep.effective_mode,ep.effective_capabilities,a.created_at::text AS cursor_created_at, a.id AS cursor_id
        FROM workforce_workspace_assignments a
        JOIN workforce_resources r ON r.id=a.resource_id
        JOIN workforce_assignment_effective_policy ep ON ep.assignment_id=a.id
        WHERE a.workspace_id=$1 AND a.state='accepted' AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())
          AND ($2::text IS NULL OR r.kind=$2) AND r.status=$3
          AND ($4::timestamptz IS NULL OR (a.created_at,a.id)<($4::timestamptz,$5::uuid))
        ORDER BY a.created_at DESC,a.id DESC LIMIT $6 FOR SHARE OF a`,
      [input.owner.id, input.kind, input.status, ...after, input.limit + 1]));
    } else {
      // The project must belong to the owner scope that was authorized above; asking about another
      // scope's project reads as the same denial as asking about one that does not exist.
      const project = (await db.query(`SELECT id FROM chat_projects WHERE id=$1 AND ${input.owner.type === 'user'
        ? 'owner_user_id' : 'workspace_id'}=$2 FOR SHARE`, [input.projectId, input.owner.id])).rows[0];
      if (!project) fail();
      ({ rows } = await db.query(`SELECT r.id,r.kind,r.created_by_user_id,r.name,r.description,r.status,r.revision,
          r.created_at,r.updated_at,pp.id AS participation_id,pp.target_kind,pp.responsibility,pp.revision AS participation_revision,
          ep.effective_capabilities,pp.created_at::text AS cursor_created_at, pp.id AS cursor_id
        FROM workforce_project_participations pp
        JOIN workforce_resources r ON r.id=pp.resource_id
        JOIN workforce_participation_effective_policy ep ON ep.participation_id=pp.id
        WHERE pp.project_id=$1 AND pp.state='active' AND ($2::text IS NULL OR r.kind=$2) AND r.status=$3
          AND ($4::timestamptz IS NULL OR (pp.created_at,pp.id)<($4::timestamptz,$5::uuid))
        ORDER BY pp.created_at DESC,pp.id DESC LIMIT $6 FOR SHARE OF pp`,
      [input.projectId, input.kind, input.status, ...after, input.limit + 1]));
    }
    const page = rows.slice(0, input.limit), last = page.at(-1);
    const items = page.map(row => {
      const item = { id: row.id, kind: row.kind,
        name: row.name, description: row.description, status: row.status, revision: String(row.revision),
        createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
      // Who CREATED a resource is attribution inside its owner scope. An owner's own list shows it; a
      // workspace the resource was assigned into, or a project it participates in, does not.
      if (input.view === 'global') {
        const access = [...(row.personal_access ? ['personal'] : []), ...(row.workspace_access ? ['workspace'] : []),
          ...(row.assigned_into.length ? ['assigned'] : [])];
        // Owner and creator are shown only when the caller can read the OWNER scope. A resource reached
        // only by an assignment into one of the caller's workspaces shows neither (VIEW-02's rule).
        const ownerFacts = row.personal_access || row.workspace_access ? {
          owner: row.owner_user_id ? { type: 'user', id: row.owner_user_id } : { type: 'workspace', id: row.owner_workspace_id },
          createdByUserId: row.created_by_user_id } : {};
        return { ...item, access, ...ownerFacts, assignedInto: row.assigned_into };
      }
      if (input.view === 'owned') return { ...item, owner: input.owner, createdByUserId: row.created_by_user_id };
      if (input.view === 'assigned') return { ...item, assignment: { id: row.assignment_id, divisionId: row.target_division_id,
        revision: String(row.assignment_revision), acceptedAt: row.accepted_at.toISOString(),
        effectiveMode: row.effective_mode, effectiveCapabilities: row.effective_capabilities } };
      return { ...item, participation: { id: row.participation_id, targetKind: row.target_kind,
        responsibility: row.responsibility, revision: String(row.participation_revision),
        effectiveCapabilities: row.effective_capabilities } };
    });
    const nextCursor = rows.length > input.limit ? Buffer.from(JSON.stringify({ schemaVersion: 1, scopeHash,
      afterId: last.cursor_id ?? last.id, afterCreatedAt: last.cursor_created_at })).toString('base64url') : null;
    return { schemaVersion: 1, scope: input.view, ...(input.view === 'global' ? {} : { owner: input.owner }),
      ...(input.view === 'project' ? { projectId: input.projectId } : {}), items, nextCursor };
  });
}
