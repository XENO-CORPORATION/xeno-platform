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
function request(value) {
  const input = record(value, ['owner', 'expectedActorAccountId', 'limit', 'kind', 'status', 'cursor']);
  const owner = normalizeOwnerScope(input.owner), expectedActorAccountId = uuid(input.expectedActorAccountId);
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
  return { owner, expectedActorAccountId, limit, status, kind, cursor };
}

/** Owner READ authority is distinct from creation and individual creator receipt
 * readback. A resource creator never automatically gains catalog-wide access.
 * Every list holds the canonical workspace gate, owner/principal rows and direct
 * granting tuple rows through its metadata query/transaction commit. Personal
 * delegation writers should also use the owner row FOR UPDATE; tuple row locks
 * independently serialize deletion of an existing grant with this read. */
async function authorizeRead(db, actorId, owner) {
  if (owner.type === 'workspace') {
    await lockWorkspaceAuthority(db, owner.id);
    const row = (await db.query('SELECT id,status FROM workspaces WHERE id=$1 FOR SHARE', [owner.id])).rows[0];
    if (row?.status !== 'active') fail();
  }
  const identities = owner.type === 'user' ? [actorId, owner.id] : [actorId];
  await db.query(`SELECT id FROM users WHERE id=ANY($1::uuid[])
    OR id IN (SELECT owner_user_id FROM agent_identities WHERE user_id=ANY($1::uuid[])) ORDER BY id FOR SHARE`, [identities]);
  await db.query('SELECT user_id FROM agent_identities WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR SHARE', [identities]);
  const principal = await resolvePrincipal(db, actorId);
  if (!principal?.usable || !['human', 'agent'].includes(principal.kind)) fail();
  if (principal.kind === 'agent') {
    const human = await resolvePrincipal(db, principal.owner.id);
    if (!human?.usable || human.kind !== 'human') fail();
  }
  if (owner.type === 'user') {
    const human = owner.id === principal.id ? principal : await resolvePrincipal(db, owner.id);
    if (!human?.usable || human.kind !== 'human') fail();
    if (principal.kind === 'human') {
      if (principal.id !== owner.id) fail();
      return principal;
    }
    if (principal.owner.id !== owner.id) fail();
  }
  const subjectType = principal.kind === 'agent' ? 'agent' : 'user';
  await db.query(`SELECT relation FROM relationship_tuples WHERE object_type=$1 AND object_id=$2
    AND subject_type=$3 AND subject_id=$4 FOR SHARE`, [owner.type, owner.id, subjectType, principal.id]);
  const verdict = await check(db, { object: `${owner.type}:${owner.id}`, subject: `${subjectType}:${principal.id}`,
    relation: owner.type === 'user' ? 'workforce_resource_reader' : 'viewer' });
  if (!verdict.allowed || !['direct', ...(principal.kind === 'human' ? ['role-hierarchy'] : [])].includes(verdict.via)) fail();
  return principal;
}

/** Explicit owned-resource listing only; no assigned/shared/global aggregation.
 * Cursor is a validated, context-bound navigation hint, NOT an authorization
 * credential. All predicates and live read authority are checked on every page.
 * created_at,id gives stable keyset order without truncating PG microseconds. */
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
    const principal = await authorizeRead(db, actorId, input.owner);
    await lockApiKeyWorkforceAuthority(db, { ...ctx, actorUserId: actorId }, 'workforce:read');
    const scopeHash = operationHash({ schemaVersion: 1, scope: 'owned', actorId, actorKind: principal.kind,
      clientId: ctx.clientId, owner: input.owner, kind: input.kind, status: input.status });
    if (input.cursor && input.cursor.scopeHash !== scopeHash) fail('bad_input', 'catalog_cursor_scope_mismatch');
    const { rows } = await db.query(`SELECT id,kind,owner_user_id,owner_workspace_id,created_by_user_id,name,description,status,revision,
      created_at,updated_at,created_at::text AS cursor_created_at FROM workforce_resources
      WHERE ${input.owner.type === 'user' ? 'owner_user_id' : 'owner_workspace_id'}=$1
        AND ($2::text IS NULL OR kind=$2) AND status=$3
        AND ($4::timestamptz IS NULL OR (created_at,id)<($4::timestamptz,$5::uuid))
      ORDER BY created_at DESC,id DESC LIMIT $6 FOR SHARE`,
    [input.owner.id, input.kind, input.status, input.cursor?.afterCreatedAt ?? null, input.cursor?.afterId ?? null, input.limit + 1]);
    const page = rows.slice(0, input.limit), last = page.at(-1);
    const items = page.map(row => ({ id: row.id, kind: row.kind, owner: input.owner, createdByUserId: row.created_by_user_id,
      name: row.name, description: row.description, status: row.status, revision: String(row.revision),
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }));
    const nextCursor = rows.length > input.limit ? Buffer.from(JSON.stringify({ schemaVersion: 1, scopeHash,
      afterId: last.id, afterCreatedAt: last.cursor_created_at })).toString('base64url') : null;
    return { schemaVersion: 1, scope: 'owned', owner: input.owner, items, nextCursor };
  });
}
