/**
 * D-3 (workforce spec §8.11.1, DECIDED 2026-10-20): a SERVICE principal is denied by default on Tasks, Storage and
 * Marketplace listings. A service has no owner, so there is nobody accountable for what it writes; it may act on
 * one of these surfaces only through a NAMED, per-capability grant IN THE WORKSPACE IT IS ACTING IN.
 *
 * The grant store is the existing ReBAC table (relationship_tuples), never a second one:
 *   object_type='capability', object_id=<capability>@<workspace id>, relation='grantee', subject_type='user', subject_id=<service id>
 * A grant made by one workspace's admin opens that workspace only (migration 20261020160000). A legacy UNSCOPED
 * tuple (object_id=<capability>) grants nothing: it named no workspace, so it would have applied platform-wide.
 * The service must also still be a MEMBER of the acting workspace; leaving it voids the grant with no cleanup step.
 * Only a `service` principal is affected: humans and agents keep their normal rules.
 */
import { resolvePrincipal } from './agentIdentity.js';
import { isWorkspaceMember, UUID_RE } from '../utils/workspaceContext.js';

export const SERVICE_CAPABILITIES = Object.freeze(['tasks', 'storage', 'marketplace.listings']);

/** The tuple object_id of a grant of `capability` in `workspaceId`. */
export const scopedCapability = (capability, workspaceId) => `${capability}@${workspaceId}`;

export class ServicePrincipalDeniedError extends Error {
  constructor(capability) {
    super(`A service account may not use ${capability} without a named grant in this workspace`);
    this.code = 'service_principal_denied'; this.status = 403; this.statusCode = 403; this.capability = capability;
  }
}

/** Throws unless `principal` is not a service, or holds a named grant for `capability` in `workspaceId` (the
 * workspace it is acting in) and is a member of it. `principal` is a resolved principal ({ id, kind }) or a bare id. */
export async function assertServiceGranted(db, principal, capability, { workspaceId = null } = {}) {
  if (!SERVICE_CAPABILITIES.includes(capability)) throw new Error(`unknown service capability: ${capability}`);
  const p = typeof principal === 'string' ? await resolvePrincipal(db, principal) : principal;
  if (!p || p.kind !== 'service') return;
  if (!workspaceId || !UUID_RE.test(String(workspaceId))) throw new ServicePrincipalDeniedError(capability);
  if (!(await isWorkspaceMember(db, String(workspaceId), String(p.id)))) throw new ServicePrincipalDeniedError(capability);
  const granted = (await db.query(
    `SELECT 1 FROM relationship_tuples WHERE object_type = 'capability' AND object_id = $1 AND relation = 'grantee'
       AND subject_type = 'user' AND subject_id = $2 LIMIT 1`, [scopedCapability(capability, String(workspaceId).toLowerCase()), String(p.id)])).rows.length > 0;
  if (!granted) throw new ServicePrincipalDeniedError(capability);
}
