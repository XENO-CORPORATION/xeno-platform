/**
 * XENO-WORKFORCE-01 LIFE-02 -- removal is REVOCATION plus SETTLEMENT, and the two are separate.
 *
 *   LIFE-02: "Revoking eligibility is immediate ...; settling what the principal was doing is not. In-flight
 *            runs reach a durable resumable state (RUN-07), reservations settle or release (RUN-10), and
 *            only then is the membership archived. A removal that silently cancels funded work, or
 *            silently lets it continue, are both defects."
 *
 * Three acts over 20260927130000-workforce-member-removal.sql:
 *
 *   removeTeamMember        in ONE transaction: a `member.remove` decision (who decided, the account that
 *                           answers for it, why), the membership revoked, every run it was doing fenced
 *                           durably at once, and the removal recorded. Idempotent on (actor, client,
 *                           operation): a retry returns the same removal.
 *   readMemberRemoval       what the removal fenced, and for each run whether it is SETTLED -- fenced, no
 *                           live lease, and accounted for -- or still owes a report or a delivery.
 *   archiveMemberRemoval    marks the removal archived, and is refused while any of its runs is unsettled.
 *
 * WHO MAY REMOVE: a workspace administrator of the team's workspace, or a `manager` of the team (ROLE-02,
 * "admit/remove members"). A manager may not remove itself -- leaving is a different act, and a manager
 * removing the last check on itself is the self-approval FUND-13 forbids. Anyone else is told the
 * membership does not exist.
 */
import { resolvePrincipal } from './agentIdentity.js';
import { check } from '../utils/authzReBAC.js';
import { authorityTransaction, lockWorkspaceAuthority, operationHash } from './workspaceOperationReceipts.js';
import { lockApiKeyWorkforceAuthority } from './apiKeyWorkforceAuthority.js';

export class MemberRemovalError extends Error {
  constructor(code, reason, extra = {}) {
    super(reason);
    this.name = 'MemberRemovalError';
    this.code = code;
    this.status = { bad_input: 400, denied: 403, not_found: 404, conflict: 409 }[code] ?? 500;
    this.details = Object.freeze({ schemaVersion: 1, reason, ...extra });
  }
}
const fail = (code, reason, extra) => { throw new MemberRemovalError(code, reason, extra); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, field) => {
  if (typeof value !== 'string' || !UUID.test(value)) fail('bad_input', `invalid_${field}`);
  return value.toLowerCase();
};
function record(value, allowed, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('bad_input', `invalid_${field}`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('bad_input', 'unknown_field', { field: `${field}.${key}` });
  return value;
}
function actorOf(context) {
  const ctx = record(context, ['actorUserId', 'clientId', 'apiKeyId'], 'context');
  if (typeof ctx.clientId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(ctx.clientId)) fail('bad_input', 'invalid_client');
  return { actorUserId: uuid(ctx.actorUserId, 'actor'), clientId: ctx.clientId, ...(Object.hasOwn(ctx, 'apiKeyId') ? { apiKeyId: uuid(ctx.apiKeyId, 'api_key') } : {}) };
}

/** The membership and its team, locked in the house order; and whether the actor may remove from it. */
async function authorizeRemoval(db, actor, membershipId, { forMutation }) {
  const peek = (await db.query(`SELECT m.team_id, t.owner_workspace_id FROM workforce_team_memberships m
    JOIN workforce_resources t ON t.id = m.team_id WHERE m.id=$1`, [membershipId])).rows[0];
  if (!peek) fail('not_found', 'membership_not_found');
  if (peek.owner_workspace_id) await lockWorkspaceAuthority(db, peek.owner_workspace_id);
  const membership = (await db.query(`SELECT * FROM workforce_team_memberships WHERE id=$1 ${forMutation ? 'FOR UPDATE' : ''}`, [membershipId])).rows[0];
  const principal = await resolvePrincipal(db, actor.actorUserId);
  if (!principal?.usable || !['human', 'agent'].includes(principal.kind)) fail('not_found', 'membership_not_found');
  if (principal.kind === 'agent') {
    const human = await resolvePrincipal(db, principal.owner.id);
    if (!human?.usable || human.kind !== 'human') fail('not_found', 'membership_not_found');
  }
  const subject = `${principal.kind === 'agent' ? 'agent' : 'user'}:${principal.id}`;
  let authority = null;
  if (peek.owner_workspace_id) {
    const admin = await check(db, { object: `workspace:${peek.owner_workspace_id}`, relation: 'admin', subject });
    if (admin.allowed && ['direct', ...(principal.kind === 'human' ? ['role-hierarchy'] : [])].includes(admin.via)) authority = `workspace:${peek.owner_workspace_id}#admin`;
  }
  if (!authority) {
    const manager = (await db.query(`SELECT id FROM workforce_team_memberships WHERE team_id=$1 AND member_principal_id=$2
      AND state='active' AND role='manager' FOR SHARE`, [membership.team_id, principal.id])).rows[0];
    if (manager) {
      if (manager.id === membership.id) fail('denied', 'manager_cannot_remove_itself');
      authority = `team:${membership.team_id}#manager`;
    }
  }
  if (!authority) fail('not_found', 'membership_not_found');
  return { membership, principal, authority, workspaceId: peek.owner_workspace_id };
}

async function removalState(db, membershipId) {
  const removal = (await db.query('SELECT * FROM workforce_membership_removals WHERE membership_id=$1', [membershipId])).rows[0];
  if (!removal) return null;
  const runs = (await db.query(`SELECT admission_id, fenced, lease_live, accounted FROM workforce_membership_removal_runs($1,$2)`,
    [membershipId, removal.removed_at])).rows.map((r) => ({
    admissionId: r.admission_id, fenced: r.fenced, leaseLive: r.lease_live, accounted: r.accounted,
    settled: r.fenced && !r.lease_live && r.accounted,
    owes: !r.fenced ? 'fence' : r.lease_live ? 'lease_expiry' : !r.accounted ? 'report_or_delivery' : null,
  }));
  return {
    schemaVersion: 1, membershipId, teamId: removal.team_id,
    decision: { actorUserId: removal.decision_actor_user_id, clientId: removal.decision_client_id, operationId: removal.decision_operation_id },
    removedAt: removal.removed_at.toISOString(),
    archivedAt: removal.archived_at?.toISOString() ?? null,
    runs, settled: runs.every((r) => r.settled),
  };
}

export async function removeTeamMember(pool, authenticatedContext, value) {
  const actor = actorOf(authenticatedContext);
  const input = record(value, ['operationId', 'membershipId', 'rationale'], 'request');
  const operationId = uuid(input.operationId, 'operation');
  const membershipId = uuid(input.membershipId, 'membership');
  if (typeof input.rationale !== 'string' || !input.rationale.trim() || input.rationale.length > 4000) fail('bad_input', 'rationale_required');
  const rationale = input.rationale.trim();
  return authorityTransaction(pool, async (db) => {
    const { membership, principal, authority, workspaceId } = await authorizeRemoval(db, actor, membershipId, { forMutation: true });
    await lockApiKeyWorkforceAuthority(db, actor, 'workforce:manage');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`member-removal:${actor.actorUserId}:${actor.clientId}:${operationId}`]);
    const requestHash = operationHash({ membershipId, rationale });
    const prior = (await db.query(`SELECT * FROM workforce_operations WHERE actor_user_id=$1 AND client_id=$2 AND operation_id=$3`,
      [actor.actorUserId, actor.clientId, operationId])).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash || prior.kind !== 'member.remove') fail('conflict', 'operation_payload_conflict');
      return { replayed: true, removal: await removalState(db, membershipId) };
    }
    if (membership.state !== 'active') fail('conflict', 'membership_not_active');

    // The decision: who decided, the account that answers for it (LIFE-07), under which authority, and why.
    const responsible = principal.kind === 'agent' ? principal.owner.id : principal.id;
    await db.query(`INSERT INTO workforce_operations(actor_user_id,client_id,operation_id,request_hash,kind,subject_type,subject_id,
        deciding_principal_id,responsible_account_id,authority,rationale,workspace_id)
      VALUES($1,$2,$3,$4,'member.remove','membership',$5,$6,$7,$8,$9,$10)`,
    [actor.actorUserId, actor.clientId, operationId, requestHash, membershipId, principal.id, responsible, authority, rationale, workspaceId]);
    // Revocation, immediate.
    const removedAt = (await db.query(`UPDATE workforce_team_memberships SET state='revoked', revision=revision+1, revoked_at=clock_timestamp(),
      updated_at=clock_timestamp() WHERE id=$1 RETURNING revoked_at`, [membershipId])).rows[0].revoked_at;
    // Every run the membership was doing is fenced by that UPDATE, in this transaction -- the migration's
    // trigger on the membership row, so the page and any other writer revoking a seat fence exactly the same
    // runs. What this act adds is the decision above and the settlement record below.
    await db.query(`INSERT INTO workforce_membership_removals(membership_id,team_id,decision_actor_user_id,decision_client_id,decision_operation_id,removed_at)
      VALUES($1,$2,$3,$4,$5,$6)`, [membershipId, membership.team_id, actor.actorUserId, actor.clientId, operationId, removedAt]);
    return { replayed: false, removal: await removalState(db, membershipId) };
  });
}

export async function readMemberRemoval(pool, authenticatedContext, value) {
  const actor = actorOf(authenticatedContext);
  const input = record(value, ['membershipId'], 'request');
  const membershipId = uuid(input.membershipId, 'membership');
  return authorityTransaction(pool, async (db) => {
    await authorizeRemoval(db, actor, membershipId, { forMutation: false }).catch((e) => {
      // Once removed, the removed member's own manager seat is gone; a manager who removed another keeps reading.
      if (e.details?.reason === 'manager_cannot_remove_itself') fail('not_found', 'membership_not_found');
      throw e;
    });
    await lockApiKeyWorkforceAuthority(db, actor, 'workforce:read');
    const state = await removalState(db, membershipId);
    if (!state) fail('not_found', 'removal_not_found');
    return state;
  });
}

export async function archiveMemberRemoval(pool, authenticatedContext, value) {
  const actor = actorOf(authenticatedContext);
  const input = record(value, ['membershipId'], 'request');
  const membershipId = uuid(input.membershipId, 'membership');
  return authorityTransaction(pool, async (db) => {
    await authorizeRemoval(db, actor, membershipId, { forMutation: true });
    await lockApiKeyWorkforceAuthority(db, actor, 'workforce:manage');
    const state = await removalState(db, membershipId);
    if (!state) fail('not_found', 'removal_not_found');
    if (state.archivedAt) return { replayed: true, removal: state };
    const unsettled = state.runs.filter((r) => !r.settled);
    if (unsettled.length) fail('conflict', 'removal_not_settled', { unsettled: unsettled.map((r) => ({ admissionId: r.admissionId, owes: r.owes })) });
    await db.query('UPDATE workforce_membership_removals SET archived_at=clock_timestamp(), archived_by_user_id=$2 WHERE membership_id=$1',
      [membershipId, actor.actorUserId]);
    return { replayed: false, removal: await removalState(db, membershipId) };
  });
}

