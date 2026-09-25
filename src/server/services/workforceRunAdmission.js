/**
 * XENO-WORKFORCE-01 RUN-01 / RUN-02 -- admitting one run.
 *
 *   RUN-01: "Admission records exact actor/principal, agent version, conversation, optional team,
 *            owner, target assignment/project, root binding, policy revision, entitlement and payer.
 *            Resolve from authoritative state; requested UI fields are not proof."
 *   RUN-02: "Contextual rights are the intersection of actor authorization, resource-use rights,
 *            target assignment, runtime capability policy, entitlement restrictions and explicit
 *            budget approval. No owner/assignment union via generic parent traversal."
 *
 * One act: `admitRun(pool, authenticatedContext, request)`. In ONE transaction it locks and resolves
 * every term from its own authoritative row, refuses on the first term that does not hold, and writes
 * one immutable admission (20260925130000-workforce-run-admissions.sql) that records each term and the
 * capabilities that survive ALL of them. A request id the caller sends is a question -- "may this run
 * use assignment X?" -- and the answer is read from X, never copied from the request.
 *
 * ── THE SIX TERMS OF THE INTERSECTION, AND WHERE EACH IS READ ──────────────────────────────────
 *   actor authorization  the authenticated principal, usable, human or agent-with-usable-owner, and
 *                        entitled to act FOR the target: the owner themselves (personal), or a
 *                        workspace editor (workspace / workspace-project). An agent needs exactly
 *                        editor -- ReBAC never escalates agents. A team run additionally needs the
 *                        actor's OWN admitted membership in the team, as `manager` or `worker`:
 *                        an `observer` may not dispatch (ROLE-02).
 *   resource-use rights  the agent resource is active and its CURRENT definition is the one pinned,
 *                        by content hash; its requested capabilities are the definition's own term.
 *   target assignment    the explicit target's grant, read from the effective-policy views that already
 *                        resolve liveness and inheritance (workforce_assignment_effective_policy,
 *                        workforce_participation_effective_policy). A personal target is the owner's
 *                        own resource: its grant is the definition's.
 *   runtime policy       an optional ceiling the calling runtime declares it can enforce -- a sandbox
 *                        that cannot write files narrows the admission, it can never widen it.
 *   entitlement          when the agent came from the marketplace (its version names one), an ACTIVE,
 *                        unexpired entitlement of the payer to that listing, and the capabilities the
 *                        listing version declares.
 *   budget approval      an explicit ceiling in integer micro-credits, positive, no larger than the
 *                        payer's available balance now. The payer is the actor's own account: a
 *                        workspace pool cannot fund a run until FUND-06 builds one, and there is no
 *                        silent fallback in either direction.
 * Each term is recorded; the database refuses an admission whose effective set is not inside every one.
 *
 * ── "NO UNION VIA GENERIC PARENT TRAVERSAL" ────────────────────────────────────────────────────
 * Authority for the TARGET is checked against the target, and authority for the RESOURCE comes from
 * the assignment or participation that binds it there -- never from ReBAC parent edges linking one to
 * the other (§12.1: "an assignment edge is not an authorization parent edge"). Owning a resource grants
 * nothing in a workspace it is not assigned into, and being admin of a workspace grants nothing over a
 * resource another owner lent it beyond what the assignment grants.
 *
 * Idempotency is the house shape: (actor, client, operation) with the canonical request hash and the
 * actor/owner incarnation; the same request returns the same admission, a changed one conflicts.
 */
import { resolvePrincipal } from './agentIdentity.js';
import { check } from '../utils/authzReBAC.js';
import { authorityTransaction, lockWorkspaceAuthority, operationHash } from './workspaceOperationReceipts.js';
import { lockApiKeyWorkforceAuthority } from './apiKeyWorkforceAuthority.js';

export class RunAdmissionError extends Error {
  constructor(code, reason, extra = {}) {
    super(reason);
    this.name = 'RunAdmissionError';
    this.code = code;
    this.status = { bad_input: 400, denied: 403, not_found: 404, needs_approval: 403, conflict: 409, unavailable: 503 }[code] ?? 500;
    this.details = Object.freeze({ schemaVersion: 1, reason, ...extra });
  }
}
const fail = (code, reason, extra) => { throw new RunAdmissionError(code, reason, extra); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY = /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$/;
const uuid = (value, field) => {
  if (typeof value !== 'string' || !UUID.test(value)) fail('bad_input', `invalid_${field}`);
  return value.toLowerCase();
};
const optionalUuid = (value, field) => (value === undefined || value === null ? null : uuid(value, field));
function record(value, allowed, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('bad_input', `invalid_${field}`);
  }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('bad_input', 'unknown_field', { field: `${field}.${key}` });
  return value;
}
function capabilities(value, field) {
  if (!Array.isArray(value) || value.length > 64 || !value.every((c) => typeof c === 'string' && CAPABILITY.test(c))) fail('bad_input', `invalid_${field}`);
  return [...new Set(value)].sort();
}
const within = (set, allowed) => set.filter((c) => allowed.includes(c));

function parse(context, value) {
  const ctx = record(context, ['actorUserId', 'clientId', 'apiKeyId'], 'context');
  if (typeof ctx.clientId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(ctx.clientId)) fail('bad_input', 'invalid_client');
  const input = record(value, ['operationId', 'expectedActorAccountId', 'agent', 'target', 'team', 'conversationId', 'root',
    'capabilities', 'runtimeCapabilities', 'budget'], 'request');
  const agent = record(input.agent, ['resourceId', 'version', 'contentHash'], 'agent');
  if (!Number.isSafeInteger(agent.version) || agent.version < 1) fail('bad_input', 'invalid_agent_version');
  if (typeof agent.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(agent.contentHash)) fail('bad_input', 'invalid_agent_content_hash');
  const target = record(input.target, ['kind', 'ownerUserId', 'assignmentId', 'projectId', 'participationId'], 'target');
  if (!['personal', 'workspace', 'project'].includes(target.kind)) fail('bad_input', 'invalid_target_kind');
  // The target shape is explicit: exactly the fields its kind needs, and nothing that another kind would read.
  const shape = { personal: ['kind', 'ownerUserId'], workspace: ['kind', 'assignmentId'], project: ['kind', 'projectId', 'participationId'] }[target.kind];
  for (const key of Object.keys(target)) if (!shape.includes(key)) fail('bad_input', 'target_field_conflict', { field: `target.${key}` });
  for (const key of shape.slice(1)) if (!Object.hasOwn(target, key)) fail('bad_input', 'target_field_missing', { field: `target.${key}` });
  const team = input.team === undefined || input.team === null ? null : record(input.team, ['teamId'], 'team');
  const root = input.root === undefined || input.root === null ? null : record(input.root, ['bindingId', 'installationId'], 'root');
  if (root && (typeof root.installationId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(root.installationId))) fail('bad_input', 'invalid_root_installation');
  if (root && target.kind !== 'project') fail('bad_input', 'root_requires_a_project');
  const budget = record(input.budget, ['ceilingMicro'], 'budget');
  if (typeof budget.ceilingMicro !== 'string' || !/^[1-9][0-9]{0,17}$/.test(budget.ceilingMicro)) fail('bad_input', 'invalid_budget_ceiling');
  return {
    actor: { actorUserId: uuid(ctx.actorUserId, 'actor'), clientId: ctx.clientId, ...(Object.hasOwn(ctx, 'apiKeyId') ? { apiKeyId: uuid(ctx.apiKeyId, 'api_key') } : {}) },
    request: {
      operationId: uuid(input.operationId, 'operation'),
      expectedActorAccountId: optionalUuid(input.expectedActorAccountId, 'expected_actor'),
      agent: { resourceId: uuid(agent.resourceId, 'agent_resource'), version: agent.version, contentHash: agent.contentHash },
      target: target.kind === 'personal' ? { kind: 'personal', ownerUserId: uuid(target.ownerUserId, 'target_owner') }
        : target.kind === 'workspace' ? { kind: 'workspace', assignmentId: uuid(target.assignmentId, 'assignment') }
          : { kind: 'project', projectId: uuid(target.projectId, 'project'), participationId: uuid(target.participationId, 'participation') },
      team: team ? { teamId: uuid(team.teamId, 'team') } : null,
      conversationId: optionalUuid(input.conversationId, 'conversation'),
      root: root ? { bindingId: uuid(root.bindingId, 'root_binding'), installationId: root.installationId } : null,
      capabilities: capabilities(input.capabilities, 'capabilities'),
      runtimeCapabilities: input.runtimeCapabilities === undefined || input.runtimeCapabilities === null ? null : capabilities(input.runtimeCapabilities, 'runtime_capabilities'),
      budget: { ceilingMicro: budget.ceilingMicro },
    },
  };
}

/** The acting principal, and the subject string ReBAC evaluates it as. */
async function actorPrincipal(db, actorUserId) {
  const principal = await resolvePrincipal(db, actorUserId);
  if (!principal?.usable || !['human', 'agent'].includes(principal.kind)) fail('denied', 'actor_unavailable');
  if (principal.kind === 'agent') {
    const owner = await resolvePrincipal(db, principal.owner.id);
    if (!owner?.usable || owner.kind !== 'human') fail('denied', 'actor_unavailable');
  }
  return { principal, subject: `${principal.kind === 'agent' ? 'agent' : 'user'}:${principal.id}` };
}

/** May this principal act FOR this workspace? Editor, or better for humans; exactly editor for agents. */
async function actsForWorkspace(db, actor, workspaceId) {
  const status = (await db.query('SELECT status FROM workspaces WHERE id=$1 FOR SHARE', [workspaceId])).rows[0]?.status;
  if (status !== 'active') return false;
  const verdict = await check(db, { object: `workspace:${workspaceId}`, relation: 'editor', subject: actor.subject });
  return verdict.allowed && ['direct', 'role-hierarchy'].includes(verdict.via);
}

async function incarnation(db, actorUserId) {
  const row = (await db.query(`SELECT extract(epoch FROM u.created_at)::text AS actor_created_at
    FROM users u WHERE u.id=$1`, [actorUserId])).rows[0];
  if (!row) fail('denied', 'identity_unavailable');
  return operationHash(row);
}

function publicAdmission(row) {
  return {
    schemaVersion: 1, admissionId: row.id, operationId: row.operation_id,
    agent: { resourceId: row.agent_resource_id, version: row.agent_version, contentHash: row.agent_content_hash },
    target: { kind: row.target_kind, ownerUserId: row.target_owner_user_id, workspaceId: row.target_workspace_id,
      projectId: row.project_id, assignmentId: row.assignment_id, assignmentRevision: row.assignment_revision === null ? null : String(row.assignment_revision),
      participationId: row.participation_id, participationRevision: row.participation_revision === null ? null : String(row.participation_revision) },
    team: row.team_id ? { teamId: row.team_id, membershipId: row.team_membership_id, function: row.team_function,
      membershipRevision: String(row.team_membership_revision), memberSetRevision: row.member_set_revision === null ? null : String(row.member_set_revision) } : null,
    conversationId: row.conversation_id,
    root: row.root_binding_id ? { bindingId: row.root_binding_id, revision: String(row.root_binding_revision), installationId: row.host_installation_id } : null,
    entitlementId: row.entitlement_id,
    payer: { kind: row.payer_kind, userId: row.payer_user_id },
    budget: { ceilingMicro: String(row.budget_ceiling_micro) },
    capabilities: { requested: row.requested_capabilities, effective: row.effective_capabilities, terms: row.rights },
    memoryNamespace: row.memory_namespace,
    admittedAt: row.admitted_at.toISOString(),
  };
}

export async function admitRun(pool, authenticatedContext, value) {
  const { actor, request } = parse(authenticatedContext, value);
  // A comparison condition, never authentication: it closes an account switch between intent and dispatch.
  if (request.expectedActorAccountId && request.expectedActorAccountId !== actor.actorUserId) fail('conflict', 'actor_context_conflict');
  const requestHash = operationHash({ agent: request.agent, target: request.target, team: request.team, conversationId: request.conversationId,
    root: request.root, capabilities: request.capabilities, runtimeCapabilities: request.runtimeCapabilities, budget: request.budget });

  return authorityTransaction(pool, async (db) => {
    // ── the target, and the workspace authority gate that serializes it (the house lock order) ──
    let assignment = null, participation = null, project = null, targetWorkspace = null, targetOwner = null;
    if (request.target.kind === 'workspace') {
      assignment = (await db.query('SELECT * FROM workforce_workspace_assignments WHERE id=$1', [request.target.assignmentId])).rows[0];
      if (!assignment) fail('not_found', 'target_not_found');
      targetWorkspace = assignment.workspace_id;
    } else if (request.target.kind === 'project') {
      participation = (await db.query('SELECT * FROM workforce_project_participations WHERE id=$1', [request.target.participationId])).rows[0];
      if (!participation || participation.project_id !== request.target.projectId) fail('not_found', 'target_not_found');
      if (participation.target_kind === 'workspace') targetWorkspace = participation.workspace_id;
      else targetOwner = participation.personal_owner_user_id;
    } else {
      targetOwner = request.target.ownerUserId;
    }
    if (targetWorkspace) await lockWorkspaceAuthority(db, targetWorkspace);
    const ownerWorkspace = (await db.query('SELECT owner_workspace_id FROM workforce_resources WHERE id=$1', [request.agent.resourceId])).rows[0]?.owner_workspace_id;
    if (ownerWorkspace && ownerWorkspace !== targetWorkspace) await lockWorkspaceAuthority(db, ownerWorkspace);

    await db.query(`SELECT id FROM users WHERE id=$1 OR id IN (SELECT owner_user_id FROM agent_identities WHERE user_id=$1) ORDER BY id FOR SHARE`, [actor.actorUserId]);
    const who = await actorPrincipal(db, actor.actorUserId);
    await lockApiKeyWorkforceAuthority(db, actor, 'workforce:manage');

    // ── idempotency ─────────────────────────────────────────────────────────────────────────────
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`run-admission:${actor.actorUserId}:${actor.clientId}:${request.operationId}`]);
    const inc = await incarnation(db, actor.actorUserId);
    const prior = (await db.query('SELECT * FROM workforce_run_admissions WHERE actor_user_id=$1 AND client_id=$2 AND operation_id=$3',
      [actor.actorUserId, actor.clientId, request.operationId])).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash) fail('conflict', 'operation_payload_conflict');
      if (prior.incarnation_hash !== inc) fail('conflict', 'operation_incarnation_conflict');
      return { replayed: true, admission: publicAdmission(prior) };
    }

    // ── resource-use rights: the agent and the definition actually pinned ──────────────────────
    const agent = (await db.query(`SELECT * FROM workforce_resources WHERE id=$1 AND kind='agent' FOR SHARE`, [request.agent.resourceId])).rows[0];
    if (!agent || agent.status !== 'active') fail('not_found', 'agent_not_found');
    const version = (await db.query(`SELECT * FROM workforce_agent_versions WHERE resource_id=$1 ORDER BY version DESC LIMIT 1`, [agent.id])).rows[0];
    // The pin is to the CURRENT definition. A stale pin is a conflict, not a quiet run of something else.
    if (!version || version.version !== request.agent.version || version.content_hash !== request.agent.contentHash) {
      fail('conflict', 'agent_version_stale', { currentVersion: version?.version ?? null });
    }
    const definitionTerm = capabilities(Array.isArray(version.content?.requestedCapabilities) ? version.content.requestedCapabilities : [], 'definition_capabilities');

    // ── the target grant, from the views that already resolve liveness and inheritance ─────────
    let targetTerm;
    if (request.target.kind === 'personal') {
      // Your own agent, run for yourself: the grant is the definition. Nobody else's resource runs here.
      if (agent.owner_user_id !== targetOwner) fail('denied', 'resource_not_the_owners');
      targetTerm = definitionTerm;
    } else if (request.target.kind === 'workspace') {
      await db.query('SELECT id FROM workforce_workspace_assignments WHERE id=$1 FOR SHARE', [assignment.id]);
      // The view resolves the assignment's own liveness AND an inherit_parent parent's, so a revoked,
      // expired or orphaned grant reads as `none` here without this code re-deriving it.
      if (assignment.state !== 'accepted') fail('denied', 'assignment_not_live');
      const ep = (await db.query('SELECT * FROM workforce_assignment_effective_policy WHERE assignment_id=$1', [assignment.id])).rows[0];
      targetTerm = capabilities(ep?.effective_capabilities ?? [], 'target_capabilities');
    } else {
      await db.query('SELECT id FROM workforce_project_participations WHERE id=$1 FOR SHARE', [participation.id]);
      if (participation.state !== 'active') fail('denied', 'participation_not_live');
      project = (await db.query('SELECT * FROM chat_projects WHERE id=$1 FOR SHARE', [participation.project_id])).rows[0];
      if (!project || project.is_archived) fail('denied', 'project_not_live');
      if (participation.target_kind === 'workspace') {
        assignment = (await db.query('SELECT * FROM workforce_workspace_assignments WHERE id=$1 FOR SHARE', [participation.assignment_id])).rows[0];
        if (!assignment || assignment.state !== 'accepted') fail('denied', 'assignment_not_live');
      }
      const ep = (await db.query('SELECT * FROM workforce_participation_effective_policy WHERE participation_id=$1', [participation.id])).rows[0];
      targetTerm = capabilities(ep?.effective_capabilities ?? [], 'target_capabilities');
    }

    // The resource the target grants to must BE the agent -- or the team the agent runs within.
    const grantedResource = assignment?.resource_id ?? participation?.resource_id ?? agent.id;
    if (request.team ? grantedResource !== request.team.teamId : grantedResource !== agent.id) fail('denied', 'target_does_not_grant_this_resource');

    // ── actor authorization for the target ─────────────────────────────────────────────────────
    if (targetWorkspace) {
      if (!(await actsForWorkspace(db, who, targetWorkspace))) fail('denied', 'actor_cannot_act_for_target');
    } else if (who.principal.kind === 'human' ? who.principal.id !== targetOwner : who.principal.owner?.id !== targetOwner) {
      fail('denied', 'actor_cannot_act_for_target');
    }

    // ── the team, and the actor's own admitted membership in it (ROLE-02: observers do not dispatch) ──
    let team = null;
    if (request.team) {
      if (!assignment) fail('bad_input', 'team_requires_an_assignment');
      const member = (await db.query(`SELECT c.*, m.revision AS live_revision FROM workforce_assignment_active_member_candidates c
          JOIN workforce_team_memberships m ON m.id = c.membership_id
         WHERE c.assignment_id=$1 AND c.team_id=$2 AND c.member_principal_id=$3`, [assignment.id, request.team.teamId, who.principal.id])).rows[0];
      if (!member) fail('denied', 'actor_not_an_admitted_member');
      if (!['manager', 'worker'].includes(member.role)) fail('denied', 'observer_cannot_dispatch');
      // The agent that runs must itself be a member of the same admitted set.
      const agentMember = (await db.query(`SELECT 1 FROM workforce_assignment_active_member_candidates
         WHERE assignment_id=$1 AND team_id=$2 AND member_resource_id=$3`, [assignment.id, request.team.teamId, agent.id])).rowCount;
      if (!agentMember) fail('denied', 'agent_not_an_admitted_member');
      team = { id: request.team.teamId, membershipId: member.membership_id, membershipRevision: member.membership_revision,
        memberSetRevision: member.snapshot_revision, function: member.role };
    }

    // ── the conversation, if the run belongs to one: it must be in the target's scope ──────────
    if (request.conversationId) {
      const conv = (await db.query('SELECT * FROM chat_conversations WHERE id=$1 AND deleted_at IS NULL FOR SHARE', [request.conversationId])).rows[0];
      if (!conv) fail('not_found', 'conversation_not_found');
      const inScope = request.target.kind === 'project' ? conv.project_id === request.target.projectId
        : targetWorkspace ? conv.workspace_id === targetWorkspace && conv.project_id === null
          : conv.owner_user_id === targetOwner && conv.workspace_id === null;
      if (!inScope) fail('conflict', 'conversation_outside_target');
    }

    // ── the root binding, resolved by (project, installation) -- never by path (ASN-07/08) ─────
    let root = null;
    if (request.root) {
      const binding = (await db.query('SELECT * FROM chat_project_execution_root($1, $2)', [request.target.projectId, request.root.installationId])).rows
        .find((b) => b.binding_id === request.root.bindingId);
      if (!binding) fail('denied', 'root_binding_not_live');
      root = { bindingId: binding.binding_id, revision: binding.revision, installationId: request.root.installationId };
    }

    // ── the entitlement, when the definition came from the marketplace ─────────────────────────
    let entitlementId = null, entitlementTerm = null;
    const listingVersionId = version.provenance?.listingVersionId;
    if (listingVersionId) {
      const ent = (await db.query(`SELECT e.id, v.declared_capabilities FROM marketplace_listing_versions v
          JOIN marketplace_entitlements e ON e.listing_id = v.listing_id
         WHERE v.id=$1 AND e.user_id=$2 AND e.status='active' AND (e.expires_at IS NULL OR e.expires_at > now()) FOR SHARE OF e`,
      [listingVersionId, actor.actorUserId])).rows[0];
      if (!ent) fail('denied', 'entitlement_not_live');
      entitlementId = ent.id;
      entitlementTerm = capabilities(Array.isArray(ent.declared_capabilities) ? ent.declared_capabilities : [], 'entitlement_capabilities');
    }

    // ── budget approval: explicit, positive, and funded by the payer now ───────────────────────
    const payerUserId = who.principal.kind === 'agent' ? who.principal.owner.id : who.principal.id;
    const acct = (await db.query('SELECT balance, is_frozen FROM credit_accounts WHERE user_id=$1 FOR SHARE', [payerUserId])).rows[0];
    const held = BigInt((await db.query(`SELECT coalesce(sum(amount_micro - settled_micro),0)::text AS h FROM credit_holds
      WHERE user_id=$1 AND state='held' AND expires_at > now()`, [payerUserId])).rows[0].h);
    const available = acct ? BigInt(acct.balance) - held : 0n;
    if (!acct || acct.is_frozen) fail('needs_approval', 'payer_cannot_fund');
    if (BigInt(request.budget.ceilingMicro) > available) fail('needs_approval', 'budget_exceeds_available', { availableMicro: (available < 0n ? 0n : available).toString() });

    // ── the intersection ───────────────────────────────────────────────────────────────────────
    let effective = within(request.capabilities, definitionTerm);
    effective = within(effective, targetTerm);
    if (request.runtimeCapabilities) effective = within(effective, request.runtimeCapabilities);
    if (entitlementTerm) effective = within(effective, entitlementTerm);
    const rights = { definition: definitionTerm, target: targetTerm, runtime: request.runtimeCapabilities, entitlement: entitlementTerm };

    const memoryNamespace = request.target.kind === 'project' ? `project:${request.target.projectId}:agent:${agent.id}`
      : targetWorkspace ? `workspace:${targetWorkspace}:agent:${agent.id}` : `user:${targetOwner}:agent:${agent.id}`;
    const row = (await db.query(`INSERT INTO workforce_run_admissions(actor_user_id,client_id,operation_id,request_hash,incarnation_hash,
        agent_resource_id,agent_version,agent_content_hash,target_kind,target_owner_user_id,target_workspace_id,project_id,
        assignment_id,assignment_revision,participation_id,participation_revision,
        team_id,team_kind,team_membership_id,team_membership_revision,member_set_revision,team_function,
        conversation_id,root_binding_id,root_binding_revision,host_installation_id,entitlement_id,
        payer_kind,payer_user_id,budget_ceiling_micro,requested_capabilities,effective_capabilities,rights,memory_namespace)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'user',$28,$29,$30,$31,$32,$33)
      RETURNING *`,
    [actor.actorUserId, actor.clientId, request.operationId, requestHash, inc,
      agent.id, version.version, version.content_hash, request.target.kind,
      request.target.kind === 'workspace' ? null : targetOwner, targetWorkspace, request.target.kind === 'project' ? request.target.projectId : null,
      assignment?.id ?? null, assignment ? assignment.revision : null, participation?.id ?? null, participation ? participation.revision : null,
      team?.id ?? null, team ? 'team' : null, team?.membershipId ?? null, team?.membershipRevision ?? null, team?.memberSetRevision ?? null, team?.function ?? null,
      request.conversationId, root?.bindingId ?? null, root?.revision ?? null, root?.installationId ?? null, entitlementId,
      payerUserId, request.budget.ceilingMicro, JSON.stringify(request.capabilities), JSON.stringify(effective), JSON.stringify(rights), memoryNamespace])).rows[0];
    return { replayed: false, admission: publicAdmission(row) };
  });
}

/** Read one admission back, to its actor or to whoever may act for its target now. */
export async function readRunAdmission(pool, authenticatedContext, admissionId) {
  const actorUserId = uuid(authenticatedContext?.actorUserId, 'actor');
  const id = uuid(admissionId, 'admission');
  return authorityTransaction(pool, async (db) => {
    const row = (await db.query('SELECT * FROM workforce_run_admissions WHERE id=$1', [id])).rows[0];
    if (!row) fail('not_found', 'admission_not_found');
    if (row.actor_user_id !== actorUserId) {
      const who = await actorPrincipal(db, actorUserId);
      const allowed = row.target_workspace_id ? await actsForWorkspace(db, who, row.target_workspace_id) : who.principal.id === row.target_owner_user_id;
      // Existence is not disclosed to someone who could not see it.
      if (!allowed) fail('not_found', 'admission_not_found');
    }
    return publicAdmission(row);
  });
}
