/**
 * XENO Depot — the Platform half of its authority seam (xeno-depot/docs/decisions/0001-depot-foundation.md §3).
 *
 * Depot is a separate resource server, like XENO Connect: it VERIFIES, it never issues, and nothing reaches Lore except
 * through Depot's gate. The gate asks this module, over a service-authenticated route (routes/depotAuthorityRoutes.js),
 * what a token may do on one repo right now. Platform owns four things here:
 *
 *   1. The `xeno-depot` audience (utils/oidcProvider.js DEPOT_AUDIENCE). The first-party Depot CLI (`xeno-depot-cli`,
 *      device grant or loopback PKCE) acts as the PERSON. A self-registered agent CLI (RFC 7591, depot:* only) acts as
 *      that person's own agent for the app — the XENO Tasks rule, reusing its helpers rather than a second copy — with
 *      the person's access, the way a GitHub App's user-to-server token carries the user's access.
 *   2. The door: product_access_policy row 'depot' (staff-only until counsel clears the name; opening it is an UPDATE).
 *   3. Per-repo grants in relationship_tuples, in Depot's own vocabulary:
 *        depot_repo:<repo id>#workspace@workspace:<id>    the one workspace a repo belongs to
 *        depot_repo:<repo id>#<permission>@user:<id>      an explicit grant (a person or an agent)
 *      Depot's words are not the platform's ranked roles (viewer < editor < admin), so they are resolved HERE, never by
 *      the generic `parent` rewrite in authzReBAC.js: the workspace edge is named `workspace`, not `parent`, on purpose.
 *   4. The ceiling: what a repo grant allows is cut to what the token's scopes allow.
 *
 * Everything is derived at read time on every call: a suspension, a removed membership, a revoked grant or an ended
 * sign-in session takes effect on Depot's next request without anything having to propagate it.
 */
import { DEPOT_AUDIENCE, DEPOT_SCOPES, getClient, verifyDepotAccessToken } from '../utils/oidcProvider.js';
import { resolvePrincipal } from './agentIdentity.js';
import { isStaffPrincipal, loadProductPolicy, evaluateProductAccess } from './productAccess.js';
import { getActingEntitlements } from './effectivePlan.js';
import { boundAgentFor, mcpAgentFor } from './xenoTasks.js';
import { withTransaction } from './chatProjectAuthority.js';
import { UUID_RE } from '../utils/workspaceContext.js';

export { DEPOT_AUDIENCE };
export const DEPOT_PRODUCT = 'depot';
export const REPO_TYPE = 'depot_repo';

/** Depot's per-repo permissions (decision 0001 §3), and what each one carries with it. */
export const PERMISSIONS = Object.freeze(['read', 'write', 'review', 'merge', 'lock', 'admin']);
const IMPLIES = Object.freeze({
  read: ['read'],
  lock: ['lock', 'read'],
  review: ['review', 'read'],
  write: ['write', 'lock', 'read'],
  merge: ['merge', 'review', 'write', 'lock', 'read'],
  admin: ['admin', 'merge', 'review', 'write', 'lock', 'read'],
});
/** What a member's workspace role gives on every repo of that workspace, before any explicit grant. GitHub's model:
 *  org owners administer every repo; members get a base permission. Merging stays an explicit grant (a protected
 *  main, which a game project's assets need), so a plain member writes, locks and reviews but does not merge. */
const WORKSPACE_BASE = Object.freeze({
  owner: ['admin'], admin: ['admin'], editor: ['write', 'review'], reviewer: ['review'], viewer: ['read'], client: ['read'],
});
/** What each token scope allows at most. */
const SCOPE_CEILING = Object.freeze({
  'depot:read': ['read'],
  'depot:write': ['read', 'write', 'lock', 'review', 'merge'],
  'depot:admin': [...PERMISSIONS],
});

const REPO_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export class DepotAuthorityError extends Error {
  constructor(code, status, message) { super(message || code); this.code = code; this.status = status; }
}

export function expand(permissions) {
  const out = new Set();
  for (const p of permissions) for (const q of IMPLIES[p] || []) out.add(q);
  return out;
}
export function ceilingFor(scopes) {
  return new Set([...scopes].flatMap((s) => SCOPE_CEILING[s] || []));
}
const ordered = (set) => PERMISSIONS.filter((p) => set.has(p));
function repoIdOf(repoId) {
  const id = String(repoId || '');
  if (!REPO_ID_RE.test(id)) throw new DepotAuthorityError('invalid_repo_id', 400, 'repo id must be 1-64 letters, digits, - or _');
  return id;
}
function scopeList(value) {
  return [...new Set(String(value || '').split(/\s+/).filter((s) => DEPOT_SCOPES.includes(s)))];
}

// ── Who is acting ────────────────────────────────────────────────────────────

/**
 * The acting party behind a verified Depot token.
 *   first-party client (xeno-depot-cli)  → the person
 *   self-registered client               → the person's own agent for that app (or the agent they bound it to on the
 *                                          consent screen), acting with the PERSON's access — never as the person
 * `accountable` is always the human who answers for what is done.
 */
async function actorForToken(db, payload) {
  const client = payload.client_id ? await getClient(db, payload.client_id) : null;
  if (!client) throw new DepotAuthorityError('invalid_token', 401);
  const person = String(payload.sub);
  let principal;
  let via;
  if (client.dynamic) {
    const agentId = await boundAgentFor(db, person, client.client_id) || await mcpAgentFor(db, person, client.name);
    principal = await resolvePrincipal(db, agentId);
    if (!principal || principal.kind !== 'agent' || String(principal.owner?.id) !== person) throw new DepotAuthorityError('invalid_token', 401);
    via = 'agent_for_person';
  } else {
    principal = await resolvePrincipal(db, person);
    via = 'person';
  }
  return { principal, accountableId: person, via, clientId: client.client_id, scopes: scopeList(payload.scope), expiresAt: Number(payload.exp) * 1000 };
}

/** A signed-in website person (the workspace screens): acts as themself, with every Depot scope as the ceiling. */
export async function actorForSession(db, userId) {
  const principal = await resolvePrincipal(db, userId);
  if (!principal) throw new DepotAuthorityError('unknown_principal', 401);
  const accountable = principal.kind === 'agent' ? String(principal.owner.id) : String(principal.id);
  return { principal, accountableId: accountable, via: principal.kind === 'agent' ? 'agent' : 'person', clientId: null, scopes: [...DEPOT_SCOPES], expiresAt: null };
}

export async function verifyToken(db, token) {
  let payload;
  try { payload = await verifyDepotAccessToken(db, String(token || '')); } catch { payload = null; }
  if (!payload) throw new DepotAuthorityError('invalid_token', 401);
  return actorForToken(db, payload);
}

/** The door: is this principal let into Depot at all (product_access_policy 'depot'). Fails closed on no row. */
export async function doorFor(db, actor) {
  // Re-read now, never from the actor object: a suspension between two calls must close the door on the second one.
  const p = actor.principal ? await resolvePrincipal(db, actor.principal.id) : null;
  if (!p || !p.usable) return { allowed: false, reason: p ? p.unusableReason : 'unknown_principal', message: null };
  if (p.kind === 'service') return { allowed: false, reason: 'service_not_allowed', message: 'A service account has no one accountable for it; use an agent.' };
  const policy = await loadProductPolicy(db, DEPOT_PRODUCT);
  if (!policy) return { allowed: false, reason: 'no_policy', message: 'XENO Depot is not open yet.' };
  const entitlements = policy.access === 'paid-plan' ? (await getActingEntitlements(db, actor.accountableId)).entitlements : {};
  const v = evaluateProductAccess({ product: DEPOT_PRODUCT, policy, entitlements, staff: isStaffPrincipal(p) });
  return { allowed: v.allowed, reason: v.reason, message: v.message };
}

// ── Repo grants ─────────────────────────────────────────────────────────────

/** The workspace a repo belongs to, or null if the repo is not registered. */
export async function repoWorkspace(db, repoId) {
  const r = (await db.query(
    `SELECT subject_id FROM relationship_tuples WHERE object_type = $1 AND object_id = $2 AND relation = 'workspace' AND subject_type = 'workspace'`,
    [REPO_TYPE, repoId])).rows;
  return r.length ? String(r[0].subject_id) : null;
}

/** The workspace relations a user holds, the owner column included; empty when the workspace is not active. */
async function workspaceRelations(db, workspaceId, userId) {
  const r = (await db.query(
    `SELECT (w.owner_user_id::text = $2) AS owns,
            ARRAY(SELECT t.relation FROM relationship_tuples t WHERE t.object_type = 'workspace' AND t.object_id = $1
                     AND t.subject_type = 'user' AND t.subject_id = $2) AS relations
       FROM workspaces w WHERE w.id::text = $1 AND w.status = 'active'`, [workspaceId, String(userId)])).rows[0];
  if (!r) return [];
  return [...(r.owns ? ['owner'] : []), ...(r.relations || [])];
}

/** One user's permissions on one repo: their workspace role's base, plus their explicit grants. No ceiling applied. */
async function userPermissions(db, repoId, workspaceId, userId) {
  const held = [];
  for (const rel of await workspaceRelations(db, workspaceId, userId)) held.push(...(WORKSPACE_BASE[rel] || []));
  const grants = (await db.query(
    `SELECT relation FROM relationship_tuples WHERE object_type = $1 AND object_id = $2 AND subject_type = 'user' AND subject_id = $3`,
    [REPO_TYPE, repoId, String(userId)])).rows.map((r) => r.relation).filter((rel) => PERMISSIONS.includes(rel));
  return expand([...held, ...grants]);
}

/** What `actor` may do on a registered repo, ceiling applied. An agent acting on its own holds its own grants cut to
 *  its owner's (agents are owner-capped everywhere); one acting for its person holds the person's. */
async function effectivePermissions(db, actor, repoId, workspaceId) {
  const p = actor.principal;
  let held;
  if (actor.via === 'agent_for_person' || actor.via === 'person') {
    held = await userPermissions(db, repoId, workspaceId, actor.accountableId);
  } else {
    const own = await userPermissions(db, repoId, workspaceId, p.id);
    const owner = await userPermissions(db, repoId, workspaceId, actor.accountableId);
    held = new Set([...own].filter((x) => owner.has(x)));
  }
  const ceiling = ceilingFor(actor.scopes);
  return new Set([...held].filter((x) => ceiling.has(x)));
}

function principalView(actor) {
  const p = actor.principal;
  return {
    id: String(p.id), kind: p.kind, handle: p.handle || null,
    accountableUserId: actor.accountableId, via: actor.via, clientId: actor.clientId,
  };
}

/**
 * The gate's question: what may this actor do, on this repo (optional), right now. Always answers; a refused door or an
 * unknown repo is a verdict, not an error, so the gate can say exactly why.
 */
export async function authorityFor(db, actor, { repoId = null } = {}) {
  const door = await doorFor(db, actor);
  const out = {
    principal: principalView(actor), door, scopes: actor.scopes,
    authorityExpiresAt: actor.expiresAt, repo: null,
  };
  if (!repoId) return out;
  const id = repoIdOf(repoId);
  const workspaceId = await repoWorkspace(db, id);
  const permissions = door.allowed && workspaceId ? ordered(await effectivePermissions(db, actor, id, workspaceId)) : [];
  out.repo = { id, registered: Boolean(workspaceId), workspaceId, permissions };
  return out;
}

async function requireDoor(db, actor) {
  const door = await doorFor(db, actor);
  if (!door.allowed) throw new DepotAuthorityError('door_closed', 403, door.message || 'XENO Depot is not open to this account');
}
function requireScope(actor, scope) {
  if (!actor.scopes.includes(scope)) throw new DepotAuthorityError('insufficient_scope', 403, `this sign-in lacks ${scope}`);
}
async function requireRepoPermission(db, actor, repoId, permission) {
  const workspaceId = await repoWorkspace(db, repoId);
  if (!workspaceId) throw new DepotAuthorityError('repo_not_found', 404);
  const perms = await effectivePermissions(db, actor, repoId, workspaceId);
  if (!perms.has('read')) throw new DepotAuthorityError('repo_not_found', 404);   // never confirm a repo to someone who cannot read it
  if (!perms.has(permission)) throw new DepotAuthorityError('not_allowed', 403, `needs ${permission} on this repo`);
  return workspaceId;
}

/**
 * Depot created a repo: record which workspace it belongs to and make the accountable person its admin. Called by
 * Depot BEFORE it reports the repo as created, so a repo never exists without an owner here. Needs depot:admin and a
 * workspace role that may create (owner, admin or member). Repeating the same registration answers the same result.
 */
export async function registerRepo(db, actor, { repoId, workspaceId }) {
  const id = repoIdOf(repoId);
  if (!UUID_RE.test(String(workspaceId || ''))) throw new DepotAuthorityError('workspace_required', 400);
  await requireDoor(db, actor);
  requireScope(actor, 'depot:admin');
  const rels = await workspaceRelations(db, String(workspaceId), actor.accountableId);
  if (!rels.some((r) => ['owner', 'admin', 'editor'].includes(r))) throw new DepotAuthorityError('not_allowed', 403, 'only a workspace owner, admin or member can create a repo there');
  return withTransaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${REPO_TYPE}:${id}`]);
    const existing = await repoWorkspace(tx, id);
    if (existing && existing !== String(workspaceId)) throw new DepotAuthorityError('repo_exists', 409, 'that repo id belongs to another workspace');
    if (!existing) {
      await tx.query(`INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id)
        VALUES ($1, $2, 'workspace', 'workspace', $3), ($1, $2, 'admin', 'user', $4) ON CONFLICT DO NOTHING`,
      [REPO_TYPE, id, String(workspaceId), actor.accountableId]);
    }
    return { id, workspaceId: String(workspaceId), created: !existing };
  });
}

/** Depot deleted a repo: remove every tuple it had. Needs depot:admin and admin on the repo. */
export async function unregisterRepo(db, actor, { repoId }) {
  const id = repoIdOf(repoId);
  await requireDoor(db, actor);
  requireScope(actor, 'depot:admin');
  await requireRepoPermission(db, actor, id, 'admin');
  const r = await db.query('DELETE FROM relationship_tuples WHERE object_type = $1 AND object_id = $2', [REPO_TYPE, id]);
  return { id, removed: r.rowCount };
}

/** Everyone with an explicit grant on a repo, and the workspace it inherits from. Needs read on it. */
export async function listGrants(db, actor, { repoId }) {
  const id = repoIdOf(repoId);
  await requireDoor(db, actor);
  const workspaceId = await requireRepoPermission(db, actor, id, 'read');
  const rows = (await db.query(
    `SELECT t.relation, t.subject_id, t.created_at, COALESCE(u.display_name, u.username) AS name, u.username,
            (ai.user_id IS NOT NULL) AS is_agent
       FROM relationship_tuples t JOIN users u ON u.id::text = t.subject_id
       LEFT JOIN agent_identities ai ON ai.user_id = u.id
      WHERE t.object_type = $1 AND t.object_id = $2 AND t.subject_type = 'user'
      ORDER BY t.created_at, t.subject_id`, [REPO_TYPE, id])).rows;
  return {
    repoId: id, workspaceId,
    grants: rows.filter((r) => PERMISSIONS.includes(r.relation)).map((r) => ({
      userId: String(r.subject_id), handle: r.username, name: r.name, kind: r.is_agent ? 'agent' : 'human',
      permission: r.relation, grantedAt: r.created_at,
    })),
  };
}

/** Who may be granted on a repo: a usable person in its workspace, or a usable agent whose owner is one. */
async function assertGrantee(db, workspaceId, userId) {
  if (!UUID_RE.test(String(userId || ''))) throw new DepotAuthorityError('invalid_user', 400);
  const p = await resolvePrincipal(db, userId);
  if (!p || !p.usable || p.kind === 'service') throw new DepotAuthorityError('invalid_user', 400, 'that account cannot hold a grant');
  const member = p.kind === 'agent' ? String(p.owner.id) : String(p.id);
  if (!(await workspaceRelations(db, workspaceId, member)).length) throw new DepotAuthorityError('not_a_member', 400, 'grants go to people in the repo’s workspace, or to their agents');
  return p;
}

/** Give one permission on a repo. Needs depot:admin and admin on the repo. */
export async function grant(db, actor, { repoId, userId, permission }) {
  const id = repoIdOf(repoId);
  if (!PERMISSIONS.includes(permission)) throw new DepotAuthorityError('invalid_permission', 400, `permission is one of ${PERMISSIONS.join(', ')}`);
  await requireDoor(db, actor);
  requireScope(actor, 'depot:admin');
  const workspaceId = await requireRepoPermission(db, actor, id, 'admin');
  await assertGrantee(db, workspaceId, userId);
  const r = await db.query(`INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id)
    VALUES ($1, $2, $3, 'user', $4) ON CONFLICT DO NOTHING`, [REPO_TYPE, id, permission, String(userId)]);
  return { repoId: id, userId: String(userId), permission, added: r.rowCount === 1 };
}

/** Take one permission away. Needs depot:admin and admin on the repo. The last admin cannot be removed: a repo
 *  always has someone who can manage it (workspace owners and admins also administer it through their role). */
export async function revoke(db, actor, { repoId, userId, permission }) {
  const id = repoIdOf(repoId);
  if (!PERMISSIONS.includes(permission)) throw new DepotAuthorityError('invalid_permission', 400);
  await requireDoor(db, actor);
  requireScope(actor, 'depot:admin');
  await requireRepoPermission(db, actor, id, 'admin');
  return withTransaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${REPO_TYPE}:${id}`]);
    if (permission === 'admin') {
      const admins = (await tx.query(`SELECT count(*)::int AS n FROM relationship_tuples WHERE object_type = $1 AND object_id = $2
        AND relation = 'admin' AND subject_type = 'user'`, [REPO_TYPE, id])).rows[0].n;
      const holds = (await tx.query(`SELECT 1 FROM relationship_tuples WHERE object_type = $1 AND object_id = $2 AND relation = 'admin'
        AND subject_type = 'user' AND subject_id = $3`, [REPO_TYPE, id, String(userId)])).rows.length;
      if (holds && admins <= 1) throw new DepotAuthorityError('last_admin', 409, 'a repo keeps at least one admin; grant another first');
    }
    const r = await tx.query(`DELETE FROM relationship_tuples WHERE object_type = $1 AND object_id = $2 AND relation = $3
      AND subject_type = 'user' AND subject_id = $4`, [REPO_TYPE, id, permission, String(userId)]);
    return { repoId: id, userId: String(userId), permission, removed: r.rowCount === 1 };
  });
}

/** The repos an actor can read in one workspace (the workspace screens' repo list reads Depot for names; this says which ids). */
export async function readableRepos(db, actor, { workspaceId }) {
  if (!UUID_RE.test(String(workspaceId || ''))) throw new DepotAuthorityError('workspace_required', 400);
  await requireDoor(db, actor);
  const ids = (await db.query(`SELECT object_id FROM relationship_tuples WHERE object_type = $1 AND relation = 'workspace'
    AND subject_type = 'workspace' AND subject_id = $2 ORDER BY object_id`, [REPO_TYPE, String(workspaceId)])).rows.map((r) => r.object_id);
  const out = [];
  for (const id of ids) {
    const perms = await effectivePermissions(db, actor, id, String(workspaceId));
    if (perms.has('read')) out.push({ id, permissions: ordered(perms) });
  }
  return { workspaceId: String(workspaceId), repos: out };
}
