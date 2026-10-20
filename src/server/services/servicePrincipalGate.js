/**
 * D-3 (workforce spec §8.11.1, DECIDED 2026-10-20): a SERVICE principal is denied by default on Tasks, Storage and
 * Marketplace listings. A service has no owner, so there is nobody accountable for what it writes; it may act on
 * one of these surfaces only through a NAMED, per-capability grant.
 *
 * The grant store is the existing ReBAC table (relationship_tuples), never a second one:
 *   object_type='capability', object_id=<capability>, relation='grantee', subject_type='user', subject_id=<service id>
 * Writing a tuple is audited the way every ReBAC write is (created_at, and the operator who wrote it in the
 * platform audit). Only a `service` principal is affected: humans and agents keep their normal rules.
 */
import { resolvePrincipal } from './agentIdentity.js';

export const SERVICE_CAPABILITIES = Object.freeze(['tasks', 'storage', 'marketplace.listings']);

export class ServicePrincipalDeniedError extends Error {
  constructor(capability) {
    super(`A service account may not use ${capability} without a named grant`);
    this.code = 'service_principal_denied'; this.status = 403; this.statusCode = 403; this.capability = capability;
  }
}

/** Throws unless `principal` is not a service, or holds a named grant for `capability`. `principal` is a resolved
 * principal ({ id, kind }) or a bare user id. */
export async function assertServiceGranted(db, principal, capability) {
  if (!SERVICE_CAPABILITIES.includes(capability)) throw new Error(`unknown service capability: ${capability}`);
  const p = typeof principal === 'string' ? await resolvePrincipal(db, principal) : principal;
  if (!p || p.kind !== 'service') return;
  const granted = (await db.query(
    `SELECT 1 FROM relationship_tuples WHERE object_type = 'capability' AND object_id = $1 AND relation = 'grantee'
       AND subject_type = 'user' AND subject_id = $2 LIMIT 1`, [capability, String(p.id)])).rows.length > 0;
  if (!granted) throw new ServicePrincipalDeniedError(capability);
}
