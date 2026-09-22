import { normalizeOwnerScope } from './workforceScope.js';
import { resolvePrincipal } from './agentIdentity.js';
import { check } from '../utils/authzReBAC.js';
import { lockWorkspaceAuthority } from './workspaceOperationReceipts.js';

export class WorkforceAuthorityError extends Error {
  constructor(code = 'denied') {
    super(code === 'bad_input' ? 'Invalid workforce authority request.' : 'Workforce authority unavailable.');
    this.name = 'WorkforceAuthorityError';
    this.code = code;
    this.status = code === 'bad_input' ? 400 : 403;
    this.details = Object.freeze({ schemaVersion: 1, reason: code === 'bad_input' ? 'unsupported_action' : 'authority_unavailable' });
  }
}

const deny = () => { throw new WorkforceAuthorityError(); };
const isUsable = principal => principal?.usable === true;

/**
 * Authorize an action against a canonical resource OWNER, never an assignment.
 * The only supported action is create_resource. This is NOT permission to edit,
 * transfer, delete, delegate, admit execution or spend. New actions require their
 * own policy and tests; unknown/missing actions fail closed.
 *
 * actorUserId MUST come from server authentication, never a request body. Its
 * UUID shape is input validation only: resolvePrincipal derives human/agent/
 * service and live owner suspension. Caller-supplied principal types are unused.
 *
 * Personal humans can create for themselves. An agent needs a direct
 * user:<its-human-owner>#workforce_resource_creator@agent:<actor> tuple. This
 * purpose-specific delegation grants creation only, not owner impersonation.
 * This module does not issue delegations. Its eventual writer/revoker must lock
 * that owner user row FOR UPDATE in the same transaction as the tuple change.
 * Workspace creation requires editor (human role hierarchy applies); agents
 * need exactly editor. Generic membership and inherited parent edges never
 * establish owner authority. Workspace creator departure does not revoke an
 * otherwise-authorized workspace manager.
 *
 * MUTATIONS: call with forMutation:true on the SAME checked-out transaction
 * client after BEGIN and before the write. Keep authorization, revisions,
 * receipt/outbox and mutation in that transaction; no network I/O. Workspace
 * order: canonical authority advisory gate, workspace row, principal rows.
 * Membership writers must use lockWorkspaceAuthority too. This helper neither
 * starts nor commits a transaction. Default read checks take no locks and are
 * observations only, never reusable mutation/admission receipts.
 */
export async function authorizeOwnerManagement(db, actorUserId, ownerScope, { action, forMutation = false } = {}) {
  if (action !== 'create_resource' || typeof forMutation !== 'boolean') throw new WorkforceAuthorityError('bad_input');
  const owner = normalizeOwnerScope(ownerScope);
  const actorId = normalizeOwnerScope({ type: 'user', id: actorUserId }).id;

  if (owner.type === 'workspace') {
    if (forMutation) await lockWorkspaceAuthority(db, owner.id);
    const { rows } = await db.query(
      `SELECT id, status FROM workspaces WHERE id=$1${forMutation ? ' FOR SHARE' : ''}`, [owner.id],
    );
    if (rows[0]?.status !== 'active') deny();
  }

  if (forMutation) {
    const identities = owner.type === 'user' ? [actorId, owner.id] : [actorId];
    // Serialize account suspension and agent retirement with this operation.
    // Sort principal row locks for stable ordering across shared owners.
    await db.query(`SELECT id FROM users WHERE id = ANY($1::uuid[])
      OR id IN (SELECT owner_user_id FROM agent_identities WHERE user_id = ANY($1::uuid[]))
      ORDER BY id FOR SHARE`, [identities]);
    await db.query('SELECT user_id FROM agent_identities WHERE user_id = ANY($1::uuid[]) ORDER BY user_id FOR SHARE', [identities]);
  }
  const principal = await resolvePrincipal(db, actorId);
  if (!isUsable(principal) || !['human', 'agent'].includes(principal.kind)) deny();
  // resolvePrincipal's owner cascade checks suspension; independently reject a
  // missing/nonhuman owner too (a dangling join must not become usable authority).
  const agentOwner = principal.kind === 'agent' ? await resolvePrincipal(db, principal.owner.id) : null;
  if (principal.kind === 'agent' && (!isUsable(agentOwner) || agentOwner.kind !== 'human')) deny();
  const subject = `${principal.kind === 'agent' ? 'agent' : 'user'}:${principal.id}`;
  let relation;

  if (owner.type === 'user') {
    const ownerPrincipal = owner.id === actorId ? principal : await resolvePrincipal(db, owner.id);
    if (!isUsable(ownerPrincipal) || ownerPrincipal.kind !== 'human') deny();
    if (principal.kind === 'human') {
      if (principal.id !== owner.id) deny();
      relation = 'self';
    } else {
      if (principal.owner?.id !== owner.id) deny();
      relation = 'workforce_resource_creator';
      const verdict = await check(db, { object: `user:${owner.id}`, relation, subject });
      if (!verdict.allowed || verdict.via !== 'direct') deny();
    }
  } else {
    relation = 'editor';
    const verdict = await check(db, { object: `workspace:${owner.id}`, relation, subject });
    if (!verdict.allowed || !['direct', 'role-hierarchy'].includes(verdict.via)) deny();
  }
  return Object.freeze({ owner, principal, subject, relation, action });
}
