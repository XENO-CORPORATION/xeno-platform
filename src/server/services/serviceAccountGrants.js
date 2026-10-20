/**
 * D-3 grants, managed by a workspace admin (owner approval 2026-10-20). A SERVICE principal is denied on Tasks,
 * Storage and Marketplace listings unless it holds a NAMED grant (servicePrincipalGate.js): the ReBAC tuple
 *   capability:<name> #grantee @ user:<service id>
 * This module is the one writer of those tuples from the product. It never invents a second grant store.
 *
 * Who may grant: an ADMIN of a workspace the service account is a MEMBER of. The admin sees only the service accounts
 * in their workspace, and every grant or revoke writes a workspace_audit row in that workspace, in the same
 * transaction as the tuple, so a change without its audit row cannot exist.
 *
 * A grant is SCOPED to the workspace it was made in (object_id = <capability>@<workspace id>): the gate honours it only
 * when the service acts in that workspace, so one workspace's admin can never open another tenant. Legacy unscoped
 * tuples are not shown and grant nothing (migration 20261020160000 refuses new ones).
 */
import { check } from '../utils/authzReBAC.js';
import { SERVICE_CAPABILITIES, scopedCapability } from './servicePrincipalGate.js';
import { withTransaction } from './chatProjectAuthority.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CAPABILITY_LABELS = Object.freeze({ tasks: 'Tasks', storage: 'Storage', 'marketplace.listings': 'Marketplace listings' });

export class ServiceGrantError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

async function requireAdmin(db, workspaceId, userId) {
  if (!UUID.test(String(workspaceId))) throw new ServiceGrantError(400, 'invalid_workspace_id', 'Invalid workspace id');
  const r = await check(db, { object: `workspace:${workspaceId}`, relation: 'admin', subject: `user:${userId}` });
  if (!r.allowed) throw new ServiceGrantError(403, 'not_workspace_admin', 'Only a workspace admin manages service accounts');
}

const MEMBER_SERVICES = `
  SELECT DISTINCT u.id, u.username, u.display_name, u.created_at
    FROM relationship_tuples t JOIN users u ON u.id::text = t.subject_id
   WHERE t.object_type = 'workspace' AND t.object_id = $1 AND t.subject_type = 'user' AND u.role = 'service'`;

async function grantsOf(db, workspaceId, ids) {
  if (!ids.length) return new Map();
  const scoped = new Map(SERVICE_CAPABILITIES.map((c) => [scopedCapability(c, String(workspaceId).toLowerCase()), c]));
  const rows = (await db.query(
    `SELECT subject_id, object_id FROM relationship_tuples
      WHERE object_type = 'capability' AND relation = 'grantee' AND subject_type = 'user' AND subject_id = ANY($1::text[])
        AND object_id = ANY($2::text[])`,
    [ids.map(String), [...scoped.keys()]])).rows;
  const by = new Map(ids.map((id) => [String(id), []]));
  for (const r of rows) by.get(r.subject_id)?.push(scoped.get(r.object_id));
  return by;
}

const shape = (u, caps) => ({
  id: String(u.id), name: u.display_name || u.username || 'Service account', username: u.username || null, createdAt: u.created_at,
  capabilities: SERVICE_CAPABILITIES.map((c) => ({ name: c, label: CAPABILITY_LABELS[c] || c, granted: caps.includes(c) })),
});

/** The service accounts in this workspace, each with its named grants. Admin only. */
export async function listServiceAccounts(db, { workspaceId, userId }) {
  await requireAdmin(db, workspaceId, userId);
  const svcs = (await db.query(`${MEMBER_SERVICES} ORDER BY u.created_at`, [String(workspaceId)])).rows;
  const grants = await grantsOf(db, workspaceId, svcs.map((s) => s.id));
  return { capabilities: SERVICE_CAPABILITIES.map((c) => ({ name: c, label: CAPABILITY_LABELS[c] || c })), serviceAccounts: svcs.map((s) => shape(s, grants.get(String(s.id)) || [])) };
}

export async function getServiceAccount(db, { workspaceId, userId, serviceId }) {
  await requireAdmin(db, workspaceId, userId);
  if (!UUID.test(String(serviceId))) throw new ServiceGrantError(404, 'service_account_not_found', 'Service account not found');
  const s = (await db.query(`${MEMBER_SERVICES} AND u.id = $2`, [String(workspaceId), serviceId])).rows[0];
  if (!s) throw new ServiceGrantError(404, 'service_account_not_found', 'Service account not found');
  const recent = (await db.query(
    `SELECT a.action, a.metadata, a.created_at, a.actor_user_id, COALESCE(u.display_name, u.username) AS actor
       FROM workspace_audit a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.workspace_id = $1 AND a.target = $2 AND a.action IN ('service.grant', 'service.revoke')
      ORDER BY a.created_at DESC LIMIT 50`, [workspaceId, `user:${serviceId}`])).rows;
  return { serviceAccount: shape(s, (await grantsOf(db, workspaceId, [s.id])).get(String(s.id)) || []),
    history: recent.map((r) => ({ action: r.action, capability: r.metadata?.capability || null, at: r.created_at, actor: r.actor || null })) };
}

/** Grant (granted=true) or revoke a named capability. Idempotent; writes an audit row only when something changed. */
export async function setServiceGrant(db, { workspaceId, userId, serviceId, capability, granted }) {
  await requireAdmin(db, workspaceId, userId);
  if (!SERVICE_CAPABILITIES.includes(capability)) throw new ServiceGrantError(400, 'unknown_capability', 'Unknown capability');
  return withTransaction(db, async (tx) => {
    const s = (await tx.query(`${MEMBER_SERVICES} AND u.id = $2`, [String(workspaceId), UUID.test(String(serviceId)) ? serviceId : null])).rows[0];
    if (!s) throw new ServiceGrantError(404, 'service_account_not_found', 'Service account not found');
    const tuple = ['capability', scopedCapability(capability, String(workspaceId).toLowerCase()), 'grantee', 'user', String(s.id)];
    const changed = granted
      ? (await tx.query(`INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id)
           SELECT $1::text, $2::text, $3::text, $4::text, $5::text WHERE NOT EXISTS (SELECT 1 FROM relationship_tuples
             WHERE object_type = $1::text AND object_id = $2::text AND relation = $3::text AND subject_type = $4::text AND subject_id = $5::text)`, tuple)).rowCount
      : (await tx.query(`DELETE FROM relationship_tuples WHERE object_type = $1 AND object_id = $2 AND relation = $3
           AND subject_type = $4 AND subject_id = $5`, tuple)).rowCount;
    if (changed) {
      await tx.query('INSERT INTO workspace_audit (workspace_id, actor_user_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)',
        [workspaceId, userId, granted ? 'service.grant' : 'service.revoke', `user:${s.id}`, { capability, scope: 'workspace' }]);
    }
    const caps = (await grantsOf(tx, workspaceId, [s.id])).get(String(s.id)) || [];
    return { changed: changed > 0, serviceAccount: shape(s, caps) };
  });
}
