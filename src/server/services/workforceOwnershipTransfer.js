/**
 * XENO-WORKFORCE-01 OWN-05 -- ownership transfer of a workforce resource.
 *
 *   "Company-owned resources survive creator departure. Ownership transfer requires source
 *    authorization, destination acceptance, dependency/license review and an auditable operation;
 *    it never silently migrates secrets or active runs."
 *
 * The database (20260924160000-workforce-ownership-transfer.sql) owns INTEGRITY: the order of the
 * acts, what a review must contain, the preconditions of the move, and the move itself. This module
 * owns AUTHORITY: who may perform each act, decided against live ReBAC in the same transaction as
 * the write. Neither is sufficient alone, which is the split workforce assignments already use.
 *
 * Who may do what:
 *   propose / authorize  the SOURCE side -- a human owning a personal resource, or an `admin` of the
 *                        owning workspace. Authorization is a management act on a thing somebody
 *                        else will depend on, so a workspace `editor` (who may CREATE a resource) may
 *                        not give one away.
 *   review               either side, by a human who can manage the SOURCE -- the reviewer must be able
 *                        to see the definition's secret references and licences to enumerate them.
 *   accept               the DESTINATION side -- the receiving human, or an `admin` of the receiving
 *                        workspace. Never the source: nobody accepts a gift on the recipient's behalf.
 *   decline              either side, at any live step.
 *
 * Agents perform none of these acts. A transfer changes who answers for a resource, and LIFE-07 puts
 * that answer on an account; letting an agent move ownership would let it move the question of whose
 * agent it is. The refusal is explicit rather than implied by a missing tuple.
 *
 * A creator's departure needs NO transfer here, which is the first half of OWN-05: a
 * workspace-owned resource's owner is the workspace, `created_by_user_id` is ON DELETE SET NULL, and
 * nothing about ownership reads the creator. The suite asserts that directly.
 */
import { randomUUID } from 'node:crypto';
import { resolvePrincipal } from './agentIdentity.js';
import { check } from '../utils/authzReBAC.js';
import { authorityTransaction, lockWorkspaceAuthority, operationHash } from './workspaceOperationReceipts.js';
import { normalizeOwnerScope } from './workforceScope.js';

export class OwnershipTransferError extends Error {
  constructor(code, reason, status) {
    super(reason);
    this.name = 'OwnershipTransferError';
    this.code = code;
    this.status = status;
    this.details = Object.freeze({ schemaVersion: 1, reason });
  }
}
const fail = (code, reason) => {
  const status = { bad_input: 400, denied: 403, not_found: 404, conflict: 409 }[code] ?? 500;
  throw new OwnershipTransferError(code, reason, status);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, field) => {
  if (typeof value !== 'string' || !UUID.test(value)) fail('bad_input', `invalid_${field}`);
  return value.toLowerCase();
};
const scopeOf = (userId, workspaceId) => (userId ? { type: 'user', id: userId } : { type: 'workspace', id: workspaceId });
const sameScope = (a, b) => a.type === b.type && a.id === b.id;

/** The acting principal must be a usable HUMAN. See the module comment for why agents are refused. */
async function humanActor(db, actorUserId) {
  const principal = await resolvePrincipal(db, actorUserId);
  if (!principal?.usable) fail('denied', 'actor_unavailable');
  if (principal.kind !== 'human') fail('denied', 'transfer_requires_a_human');
  return principal;
}

/** May this human manage (give away / receive into) this owner scope? */
async function managesScope(db, actorUserId, scope) {
  if (scope.type === 'user') return scope.id === actorUserId;
  const status = (await db.query('SELECT status FROM workspaces WHERE id=$1 FOR SHARE', [scope.id])).rows[0]?.status;
  if (status !== 'active') return false;
  const verdict = await check(db, { object: `workspace:${scope.id}`, relation: 'admin', subject: `user:${actorUserId}` });
  return verdict.allowed && ['direct', 'role-hierarchy'].includes(verdict.via);
}

/** Lock order, identical for every step: workspace authority gates (sorted), then the resource. */
async function lockScopes(db, ...scopes) {
  const workspaces = [...new Set(scopes.filter((s) => s?.type === 'workspace').map((s) => s.id))].sort();
  for (const id of workspaces) await lockWorkspaceAuthority(db, id);
}

async function loadTransfer(db, transferId) {
  const row = (await db.query('SELECT * FROM workforce_ownership_transfers WHERE id=$1 FOR UPDATE', [transferId])).rows[0];
  if (!row) fail('not_found', 'transfer_not_found');
  return row;
}

export function publicTransfer(row) {
  return {
    schemaVersion: 1,
    id: row.id,
    resourceId: row.resource_id,
    resourceKind: row.resource_kind,
    from: scopeOf(row.from_owner_user_id, row.from_owner_workspace_id),
    to: scopeOf(row.to_owner_user_id, row.to_owner_workspace_id),
    state: row.state,
    revision: String(row.revision),
    resourceRevision: String(row.resource_revision),
    proposedBy: row.proposed_by_user_id,
    authorizedBy: row.source_authorized_by_user_id,
    authorizedAt: row.source_authorized_at?.toISOString?.() ?? null,
    reviewedBy: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at?.toISOString?.() ?? null,
    review: row.review,
    reviewedAgentVersion: row.reviewed_agent_version,
    acceptedBy: row.accepted_by_user_id,
    acceptedAt: row.accepted_at?.toISOString?.() ?? null,
    declinedBy: row.declined_by_user_id,
    declinedAt: row.declined_at?.toISOString?.() ?? null,
    declineReason: row.decline_reason,
    operationId: row.operation_id,
  };
}

/**
 * What a reviewer must be shown: the secret references and licences the resource's CURRENT
 * definition declares, and its version. The review they submit is compared against exactly this.
 */
export async function transferReviewSubject(pool, { actorUserId, transferId }) {
  return authorityTransaction(pool, async (db) => {
    const transfer = await loadTransfer(db, uuid(transferId, 'transfer'));
    const from = scopeOf(transfer.from_owner_user_id, transfer.from_owner_workspace_id);
    await lockScopes(db, from);
    await humanActor(db, actorUserId);
    if (!(await managesScope(db, actorUserId, from))) fail('not_found', 'transfer_not_found');
    const v = (await db.query(
      `SELECT version, content, license FROM workforce_agent_versions WHERE resource_id=$1 ORDER BY version DESC LIMIT 1`,
      [transfer.resource_id])).rows[0];
    return {
      schemaVersion: 1,
      agentVersion: v?.version ?? null,
      secretReferences: [...new Set((v?.content?.secretReferences ?? []).map((r) => r.name))].sort(),
      licenses: v?.license?.identifier ? [v.license.identifier] : [],
    };
  });
}

/** Source side: propose moving a resource to another owner scope. */
export async function proposeOwnershipTransfer(pool, { actorUserId, resourceId, to, expectedRevision }) {
  const destination = normalizeOwnerScope(to);
  const id = uuid(resourceId, 'resource');
  return authorityTransaction(pool, async (db) => {
    const peek = (await db.query('SELECT owner_user_id, owner_workspace_id FROM workforce_resources WHERE id=$1', [id])).rows[0];
    if (!peek) fail('not_found', 'resource_not_found');
    await lockScopes(db, scopeOf(peek.owner_user_id, peek.owner_workspace_id), destination);
    const resource = (await db.query('SELECT * FROM workforce_resources WHERE id=$1 FOR UPDATE', [id])).rows[0];
    const from = scopeOf(resource.owner_user_id, resource.owner_workspace_id);
    await humanActor(db, actorUserId);
    // A caller who cannot manage the source learns nothing about the resource -- the same answer as
    // a resource that does not exist.
    if (!(await managesScope(db, actorUserId, from))) fail('not_found', 'resource_not_found');
    if (sameScope(from, destination)) fail('bad_input', 'transfer_to_current_owner');
    if (expectedRevision !== undefined && String(resource.revision) !== String(expectedRevision)) {
      fail('conflict', 'resource_revision_changed');
    }
    if (destination.type === 'user') {
      const target = await resolvePrincipal(db, destination.id);
      if (!target?.usable || target.kind !== 'human') fail('bad_input', 'destination_unavailable');
    } else {
      const status = (await db.query('SELECT status FROM workspaces WHERE id=$1 FOR SHARE', [destination.id])).rows[0]?.status;
      if (status !== 'active') fail('bad_input', 'destination_unavailable');
    }
    const row = (await db.query(
      `INSERT INTO workforce_ownership_transfers(resource_id, resource_kind, from_owner_user_id, from_owner_workspace_id,
         to_owner_user_id, to_owner_workspace_id, resource_revision, proposed_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (resource_id) WHERE state IN ('proposed','authorized','reviewed') DO NOTHING
       RETURNING *`,
      [id, resource.kind, from.type === 'user' ? from.id : null, from.type === 'workspace' ? from.id : null,
        destination.type === 'user' ? destination.id : null, destination.type === 'workspace' ? destination.id : null,
        resource.revision, actorUserId])).rows[0];
    if (!row) fail('conflict', 'transfer_already_in_progress');
    return publicTransfer(row);
  });
}

async function step(pool, { actorUserId, transferId, expectedRevision }, apply) {
  const tid = uuid(transferId, 'transfer');
  return authorityTransaction(pool, async (db) => {
    const peek = (await db.query('SELECT * FROM workforce_ownership_transfers WHERE id=$1', [tid])).rows[0];
    if (!peek) fail('not_found', 'transfer_not_found');
    const from = scopeOf(peek.from_owner_user_id, peek.from_owner_workspace_id);
    const to = scopeOf(peek.to_owner_user_id, peek.to_owner_workspace_id);
    await lockScopes(db, from, to);
    await db.query('SELECT id FROM workforce_resources WHERE id=$1 FOR UPDATE', [peek.resource_id]);
    const transfer = await loadTransfer(db, tid);
    if (expectedRevision !== undefined && String(transfer.revision) !== String(expectedRevision)) {
      fail('conflict', 'transfer_revision_changed');
    }
    await humanActor(db, actorUserId);
    const [managesSource, managesDestination] = [await managesScope(db, actorUserId, from), await managesScope(db, actorUserId, to)];
    if (!managesSource && !managesDestination) fail('not_found', 'transfer_not_found');
    return apply(db, transfer, { managesSource, managesDestination, from, to });
  });
}

/** Source side: the owner's authorization. The proposer's act alone never counts as it. */
export function authorizeOwnershipTransfer(pool, args) {
  return step(pool, args, async (db, transfer, { managesSource }) => {
    if (!managesSource) fail('denied', 'source_authorization_required');
    if (transfer.state !== 'proposed') fail('conflict', 'transfer_not_proposed');
    const row = (await db.query(
      `UPDATE workforce_ownership_transfers SET state='authorized', revision=revision+1,
         source_authorized_by_user_id=$2, source_authorized_at=clock_timestamp(), updated_at=clock_timestamp()
       WHERE id=$1 RETURNING *`, [transfer.id, args.actorUserId])).rows[0];
    return publicTransfer(row);
  });
}

/** The dependency/licence review. The DATABASE compares it with what the resource declares. */
export function reviewOwnershipTransfer(pool, args) {
  return step(pool, args, async (db, transfer, { managesSource }) => {
    // The reviewer must be able to SEE the definition, which is the source's to show.
    if (!managesSource) fail('denied', 'review_requires_source_visibility');
    if (transfer.state !== 'authorized') fail('conflict', 'transfer_not_authorized');
    const review = args.review;
    if (!review || typeof review !== 'object' || Array.isArray(review)) fail('bad_input', 'invalid_review');
    const version = (await db.query('SELECT max(version) AS v FROM workforce_agent_versions WHERE resource_id=$1',
      [transfer.resource_id])).rows[0].v;
    if (args.agentVersion !== (version ?? null)) fail('conflict', 'definition_changed_since_read');
    try {
      const row = (await db.query(
        `UPDATE workforce_ownership_transfers SET state='reviewed', revision=revision+1, reviewed_by_user_id=$2,
           reviewed_at=clock_timestamp(), review=$3, reviewed_agent_version=$4, updated_at=clock_timestamp()
         WHERE id=$1 RETURNING *`, [transfer.id, args.actorUserId, JSON.stringify(review), version])).rows[0];
      return publicTransfer(row);
    } catch (error) {
      if (error.code === '23514') fail('bad_input', /secret references/.test(error.message)
        ? 'review_secret_references_incomplete' : /licences/.test(error.message)
          ? 'review_licenses_incomplete' : 'invalid_review');
      throw error;
    }
  });
}

/**
 * Destination side: accept, writing the decision record and moving the owner in one transaction.
 * The decision names the deciding principal AND the responsible account (LIFE-07) -- for a human
 * acceptor they are the same id, which is a fact worth storing rather than inferring.
 */
export function acceptOwnershipTransfer(pool, args) {
  return step(pool, args, async (db, transfer, { managesDestination, to }) => {
    if (!managesDestination) fail('denied', 'destination_acceptance_required');
    if (transfer.state !== 'reviewed') fail('conflict', 'transfer_not_reviewed');
    if (typeof args.rationale !== 'string' || !args.rationale.trim() || args.rationale.length > 4000) {
      fail('bad_input', 'rationale_required');
    }
    const clientId = 'workforce-ownership-transfer';
    const operationId = randomUUID();
    await db.query(
      `INSERT INTO workforce_operations(actor_user_id, client_id, operation_id, request_hash, kind, subject_type, subject_id,
         deciding_principal_id, responsible_account_id, authority, rationale, evidence, workspace_id)
       VALUES ($1,$2,$3,$4,'resource.transfer','resource',$5,$1,$1,$6,$7,$8,$9)`,
      [args.actorUserId, clientId, operationId,
        operationHash({ transferId: transfer.id, revision: String(transfer.revision), to }),
        transfer.resource_id,
        to.type === 'workspace' ? `workspace:${to.id}#admin` : `user:${to.id}`,
        args.rationale.trim(),
        JSON.stringify([{ transferId: transfer.id, review: transfer.review, reviewedAgentVersion: transfer.reviewed_agent_version,
          authorizedBy: transfer.source_authorized_by_user_id, reviewedBy: transfer.reviewed_by_user_id }]),
        to.type === 'workspace' ? to.id : null]);
    try {
      const row = (await db.query(
        `UPDATE workforce_ownership_transfers SET state='accepted', revision=revision+1, accepted_by_user_id=$2,
           accepted_at=clock_timestamp(), operation_actor_user_id=$2, operation_client_id=$3, operation_id=$4,
           updated_at=clock_timestamp()
         WHERE id=$1 RETURNING *`, [transfer.id, args.actorUserId, clientId, operationId])).rows[0];
      return publicTransfer(row);
    } catch (error) {
      if (error.code === '23514') {
        const reason = /live assignment/.test(error.message) ? 'live_assignments_must_be_settled'
          : /changed since this transfer/.test(error.message) ? 'resource_changed_since_proposal'
            : /definition version/.test(error.message) ? 'definition_changed_since_review'
              : /current owner/.test(error.message) ? 'source_owner_changed'
                : 'transfer_precondition_failed';
        fail('conflict', reason);
      }
      throw error;
    }
  });
}

/** Either side may decline a live transfer, saying why. */
export function declineOwnershipTransfer(pool, args) {
  return step(pool, args, async (db, transfer) => {
    if (!['proposed', 'authorized', 'reviewed'].includes(transfer.state)) fail('conflict', 'transfer_not_live');
    if (typeof args.reason !== 'string' || !args.reason.trim() || args.reason.length > 1000) fail('bad_input', 'reason_required');
    const row = (await db.query(
      `UPDATE workforce_ownership_transfers SET state='declined', revision=revision+1, declined_by_user_id=$2,
         declined_at=clock_timestamp(), decline_reason=$3, updated_at=clock_timestamp()
       WHERE id=$1 RETURNING *`, [transfer.id, args.actorUserId, args.reason.trim()])).rows[0];
    return publicTransfer(row);
  });
}

/** Read a transfer: visible to whoever manages either side, and to nobody else. */
export function readOwnershipTransfer(pool, args) {
  return step(pool, args, async (_db, transfer) => publicTransfer(transfer));
}
