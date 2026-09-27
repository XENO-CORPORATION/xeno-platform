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
 *   division (DIV-08)    when the target is division-scoped, the actor acts INSIDE that division --
 *                        `editor` on the division itself, or an administrator of its workspace. A
 *                        grant on a parent division or on the workspace alone does not reach it.
 *   budget approval      an explicit ceiling in integer micro-credits, positive, no larger than the
 *                        payer's available balance now. The payer is the actor's own account: a
 *                        workspace pool cannot fund a run until FUND-06 builds one, and there is no
 *                        silent fallback in either direction.
 *   parent (RUN-10)      optional: the admission this run is spawned inside. A child is a SUB-RESERVATION
 *                        of its parent, never a copy: same actor, client, payer and target; capabilities
 *                        inside the parent's; a ceiling carved out of what the parent has left after
 *                        every child already carved from it. The parent must still be live -- a run whose
 *                        parent or any ancestor was stopped spawns nothing. The child keeps its OWN agent
 *                        pin: which definition runs is a pin, how far it may go is the parent's live
 *                        ceiling, and those are different facts.
 * Each term is recorded; the database refuses an admission whose effective set is not inside every one --
 * and, for a child, one that is not inside its parent (20260927110000-workforce-nested-run-envelopes.sql).
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

/** A run's target: exactly the fields its kind needs, and nothing that another kind would read. */
function parseTarget(value) {
  const target = record(value, ['kind', 'ownerUserId', 'assignmentId', 'projectId', 'participationId'], 'target');
  if (!['personal', 'workspace', 'project'].includes(target.kind)) fail('bad_input', 'invalid_target_kind');
  const shape = { personal: ['kind', 'ownerUserId'], workspace: ['kind', 'assignmentId'], project: ['kind', 'projectId', 'participationId'] }[target.kind];
  for (const key of Object.keys(target)) if (!shape.includes(key)) fail('bad_input', 'target_field_conflict', { field: `target.${key}` });
  for (const key of shape.slice(1)) if (!Object.hasOwn(target, key)) fail('bad_input', 'target_field_missing', { field: `target.${key}` });
  return target.kind === 'personal' ? { kind: 'personal', ownerUserId: uuid(target.ownerUserId, 'target_owner') }
    : target.kind === 'workspace' ? { kind: 'workspace', assignmentId: uuid(target.assignmentId, 'assignment') }
      : { kind: 'project', projectId: uuid(target.projectId, 'project'), participationId: uuid(target.participationId, 'participation') };
}

function parse(context, value) {
  const ctx = record(context, ['actorUserId', 'clientId', 'apiKeyId'], 'context');
  if (typeof ctx.clientId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(ctx.clientId)) fail('bad_input', 'invalid_client');
  const input = record(value, ['operationId', 'expectedActorAccountId', 'agent', 'target', 'team', 'conversationId', 'root',
    'capabilities', 'runtimeCapabilities', 'budget', 'parent', 'taskRef'], 'request');
  const agent = record(input.agent, ['resourceId', 'version', 'contentHash'], 'agent');
  if (!Number.isSafeInteger(agent.version) || agent.version < 1) fail('bad_input', 'invalid_agent_version');
  if (typeof agent.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(agent.contentHash)) fail('bad_input', 'invalid_agent_content_hash');
  const target = parseTarget(input.target);
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
      target,
      team: team ? { teamId: uuid(team.teamId, 'team') } : null,
      conversationId: optionalUuid(input.conversationId, 'conversation'),
      root: root ? { bindingId: uuid(root.bindingId, 'root_binding'), installationId: root.installationId } : null,
      capabilities: capabilities(input.capabilities, 'capabilities'),
      runtimeCapabilities: input.runtimeCapabilities === undefined || input.runtimeCapabilities === null ? null : capabilities(input.runtimeCapabilities, 'runtime_capabilities'),
      budget: { ceilingMicro: budget.ceilingMicro },
      parent: input.parent === undefined || input.parent === null ? null
        : { admissionId: uuid(record(input.parent, ['admissionId'], 'parent').admissionId, 'parent_admission') },
      // RUN-04: the coordination task this run is for -- an opaque reference, recorded, never interpreted.
      taskRef: input.taskRef === undefined || input.taskRef === null ? null
        : (typeof input.taskRef === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.taskRef) ? input.taskRef : fail('bad_input', 'invalid_task_ref')),
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

/** May this principal SEE the workspace -- `viewer` or above, directly (or by role hierarchy for a human),
 * exactly the catalog's scope rule. Seeing is not acting: acting is `actsForWorkspace`, one relation up. */
async function readsWorkspace(db, who, workspaceId) {
  const [subjectType, subjectId] = who.subject.split(':');
  await db.query(`SELECT relation FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1
    AND subject_type=$2 AND subject_id=$3 FOR SHARE`, [workspaceId, subjectType, subjectId]);
  const verdict = await check(db, { object: `workspace:${workspaceId}`, relation: 'viewer', subject: who.subject });
  return verdict.allowed && ['direct', ...(who.principal.kind === 'human' ? ['role-hierarchy'] : [])].includes(verdict.via);
}

/** DIV-08: may this principal act INSIDE this division? A division is an execution boundary, decided
 * by the existing ReBAC service (DIV-10: no division-specific permission engine or roster):
 *   - a human who administers the WORKSPACE acts in every division of it -- the workspace remains the
 *     single tenant (DIV-02), and a tenant's administrators are not locked out of their own org chart;
 *   - anyone else needs `editor` on the division ITSELF, held directly (or by role hierarchy for a
 *     human). Reaching it through a `parent` tuple does not count: `division` is deliberately absent
 *     from authzReBAC's PARENT_INHERITS, so a grant on `dev` never becomes a grant on `platform`
 *     (D15), and a workspace editor who inherits through the division's parent-workspace tuple is
 *     exactly the "UI label mistaken for pool enforcement" §21 forbids;
 *   - an agent gets exactly the relation it was granted, never a hierarchy, as everywhere else. */
export async function actsInDivision(db, who, workspaceId, divisionId) {
  if (who.principal.kind === 'human') {
    const admin = await check(db, { object: `workspace:${workspaceId}`, relation: 'admin', subject: who.subject });
    if (admin.allowed && ['direct', 'role-hierarchy'].includes(admin.via)) return true;
  }
  const [subjectType, subjectId] = who.subject.split(':');
  // Hold the granting rows through the decision, so a grant removed concurrently is honoured.
  await db.query(`SELECT relation FROM relationship_tuples WHERE object_type='division' AND object_id=$1
    AND subject_type=$2 AND subject_id=$3 FOR SHARE`, [divisionId, subjectType, subjectId]);
  const verdict = await check(db, { object: `division:${divisionId}`, relation: 'editor', subject: who.subject });
  return verdict.allowed && ['direct', ...(who.principal.kind === 'human' ? ['role-hierarchy'] : [])].includes(verdict.via);
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
    parent: row.parent_admission_id ? { admissionId: row.parent_admission_id, depth: row.nesting_depth } : null,
    taskRef: row.task_ref ?? null,
    capabilities: { requested: row.requested_capabilities, effective: row.effective_capabilities, terms: row.rights },
    memoryNamespace: row.memory_namespace,
    admittedAt: row.admitted_at.toISOString(),
  };
}

/** The facts both admission and the pin read resolve, IN ONE PLACE, in the house lock order: the
 * target and its workspace gate, the acting principal, the agent and its CURRENT definition, the
 * target's grant, that the target grants THIS resource, and that the actor may act for the target.
 * Admission and `readRunnablePin` both call it, so the read can never say an agent is runnable where
 * admitting it would refuse -- or the reverse. It resolves nothing about the team, conversation,
 * root, entitlement or budget: those belong to one admission, not to what may run where. */
async function resolveRunnable(db, actor, request, scope, beforeResource = async () => {}) {
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
    await lockApiKeyWorkforceAuthority(db, actor, scope);

    // Admission replays a prior decision here, before any rights are re-read.
    const early = await beforeResource(who);
    if (early) return { early };

    // ── NFR-07: a target the actor may not SEE answers like one that does not exist ────────────
    // "Unauthorized IDs do not reveal existence through error-detail differences." Every refusal below
    // this line names a fact about the target -- that it is revoked, archived, grants another resource,
    // lies in a division. Said to someone who cannot see the target, each is an existence oracle: an
    // unknown id answered `target_not_found` and a real one `actor_cannot_act_for_target`. So the
    // visibility question is asked FIRST, under the catalog's own rule (VIEW-01/02 -- a viewer of the
    // workspace, or the personal owner), and failing it is `target_not_found`, byte for byte. A reader of
    // the scope still gets the precise reason: they can already see the assignment in the catalog.
    // A personal target is the actor's own scope or it is not theirs to name; either way it is not a
    // hidden row, so it keeps its own refusal.
    if (targetWorkspace && !(await readsWorkspace(db, who, targetWorkspace))) fail('not_found', 'target_not_found');
    if (!targetWorkspace && request.target.kind === 'project'
      && (who.principal.kind === 'human' ? who.principal.id : who.principal.owner?.id) !== targetOwner) fail('not_found', 'target_not_found');

    // ── resource-use rights: the agent and the definition actually pinned ──────────────────────
    const agent = (await db.query(`SELECT * FROM workforce_resources WHERE id=$1 AND kind='agent' FOR SHARE`, [request.agent.resourceId])).rows[0];
    if (!agent || agent.status !== 'active') fail('not_found', 'agent_not_found');
    const version = (await db.query(`SELECT * FROM workforce_agent_versions WHERE resource_id=$1 ORDER BY version DESC LIMIT 1`, [agent.id])).rows[0];
    // An active agent always has a definition; one without is not runnable, and says so rather than
    // letting a caller pin to nothing.
    if (!version) fail('not_found', 'agent_not_found');
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

    // ── DIV-08: the division the run executes in, when the target is division-scoped ────────────
    // A division-targeted assignment (DIV-05) puts the run INSIDE that division, directly or through
    // a project participation built on it. Being able to act for the workspace is not enough.
    // OWN-06: an archived division admits no new run, though its history stays readable.
    const divisionId = assignment?.target_division_id ?? null;
    if (divisionId) {
      const division = (await db.query('SELECT workspace_id, lifecycle FROM workforce_divisions WHERE id=$1 FOR SHARE', [divisionId])).rows[0];
      if (!division || division.lifecycle !== 'active') fail('denied', 'division_not_live');
      if (!(await actsInDivision(db, who, division.workspace_id, divisionId))) fail('denied', 'actor_outside_division');
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

    return { who, agent, version, definitionTerm, targetTerm, assignment, participation, project, targetWorkspace, targetOwner, team };
}

export async function admitRun(pool, authenticatedContext, value) {
  const { actor, request } = parse(authenticatedContext, value);
  // A comparison condition, never authentication: it closes an account switch between intent and dispatch.
  if (request.expectedActorAccountId && request.expectedActorAccountId !== actor.actorUserId) fail('conflict', 'actor_context_conflict');
  const requestHash = operationHash({ agent: request.agent, target: request.target, team: request.team, conversationId: request.conversationId,
    root: request.root, capabilities: request.capabilities, runtimeCapabilities: request.runtimeCapabilities, budget: request.budget,
    ...(request.parent ? { parent: request.parent } : {}), ...(request.taskRef ? { taskRef: request.taskRef } : {}) });

  return authorityTransaction(pool, async (db) => {
    // The actor incarnation is read inside the idempotency hook and recorded on the new admission.
    let inc;
    const resolved = await resolveRunnable(db, actor, request, 'workforce:manage', async () => {
      // ── idempotency ─────────────────────────────────────────────────────────────────────────────
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`run-admission:${actor.actorUserId}:${actor.clientId}:${request.operationId}`]);
      inc = await incarnation(db, actor.actorUserId);
      const prior = (await db.query('SELECT * FROM workforce_run_admissions WHERE actor_user_id=$1 AND client_id=$2 AND operation_id=$3',
        [actor.actorUserId, actor.clientId, request.operationId])).rows[0];
      if (prior) {
        if (prior.request_hash !== requestHash) fail('conflict', 'operation_payload_conflict');
        if (prior.incarnation_hash !== inc) fail('conflict', 'operation_incarnation_conflict');
        return { replayed: true, admission: publicAdmission(prior) };
      }

      return null;
    });
    if (resolved.early) return resolved.early;
    const { who, agent, version, definitionTerm, targetTerm, assignment, participation, targetWorkspace, targetOwner, team } = resolved;
    // The pin is to the CURRENT definition. A stale pin is a conflict, not a quiet run of something else.
    if (version.version !== request.agent.version || version.content_hash !== request.agent.contentHash) {
      fail('conflict', 'agent_version_stale', { currentVersion: version.version });
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

    // ── RUN-10: a child is a sub-reservation of a live parent, never a copied ceiling ──────────
    let parent = null;
    if (request.parent) {
      // Locked FOR NO KEY UPDATE: every child of one parent is decided in turn, so the remaining envelope read
      // here is the one the insert commits against. The database guard holds the same rule on its own.
      parent = (await db.query('SELECT * FROM workforce_run_admissions WHERE id=$1 FOR NO KEY UPDATE', [request.parent.admissionId])).rows[0];
      // A parent the actor did not admit is indistinguishable from one that does not exist.
      if (!parent || parent.actor_user_id !== actor.actorUserId || parent.client_id !== actor.clientId) fail('not_found', 'parent_admission_not_found');
      const fence = (await db.query('SELECT workforce_run_admission_fence($1) AS f', [parent.id])).rows[0].f;
      if (fence) fail('denied', 'parent_admission_revoked');
      const sameTarget = parent.target_kind === request.target.kind
        && (request.target.kind === 'personal' ? parent.target_owner_user_id === targetOwner
          : request.target.kind === 'workspace' ? parent.assignment_id === request.target.assignmentId
            : parent.participation_id === request.target.participationId);
      if (!sameTarget || parent.payer_user_id !== payerUserId) fail('conflict', 'child_outside_parent_target');
      // RUN-04: a child inherits a subset of its parent's context -- its root among it, or none.
      if (root && (root.bindingId !== parent.root_binding_id || root.installationId !== parent.host_installation_id)) {
        fail('conflict', 'child_outside_parent_root');
      }
      if (parent.nesting_depth >= 8) fail('denied', 'nesting_too_deep');
      // A child may do nothing its parent may not: its effective set is narrowed by the parent's too.
      effective = within(effective, parent.effective_capabilities);
      const carved = BigInt((await db.query('SELECT coalesce(sum(budget_ceiling_micro),0)::text AS c FROM workforce_run_admissions WHERE parent_admission_id=$1',
        [parent.id])).rows[0].c);
      const remaining = BigInt(parent.budget_ceiling_micro) - carved;
      if (BigInt(request.budget.ceilingMicro) > remaining) {
        fail('needs_approval', 'budget_exceeds_parent_envelope', { remainingMicro: (remaining < 0n ? 0n : remaining).toString() });
      }
    }

    const memoryNamespace = request.target.kind === 'project' ? `project:${request.target.projectId}:agent:${agent.id}`
      : targetWorkspace ? `workspace:${targetWorkspace}:agent:${agent.id}` : `user:${targetOwner}:agent:${agent.id}`;
    const row = (await db.query(`INSERT INTO workforce_run_admissions(actor_user_id,client_id,operation_id,request_hash,incarnation_hash,
        agent_resource_id,agent_version,agent_content_hash,target_kind,target_owner_user_id,target_workspace_id,project_id,
        assignment_id,assignment_revision,participation_id,participation_revision,
        team_id,team_kind,team_membership_id,team_membership_revision,member_set_revision,team_function,
        conversation_id,root_binding_id,root_binding_revision,host_installation_id,entitlement_id,
        payer_kind,payer_user_id,budget_ceiling_micro,requested_capabilities,effective_capabilities,rights,memory_namespace,
        parent_admission_id,nesting_depth,task_ref)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'user',$28,$29,$30,$31,$32,$33,$34,$35,$36)
      RETURNING *`,
    [actor.actorUserId, actor.clientId, request.operationId, requestHash, inc,
      agent.id, version.version, version.content_hash, request.target.kind,
      request.target.kind === 'workspace' ? null : targetOwner, targetWorkspace, request.target.kind === 'project' ? request.target.projectId : null,
      assignment?.id ?? null, assignment ? assignment.revision : null, participation?.id ?? null, participation ? participation.revision : null,
      team?.id ?? null, team ? 'team' : null, team?.membershipId ?? null, team?.membershipRevision ?? null, team?.memberSetRevision ?? null, team?.function ?? null,
      request.conversationId, root?.bindingId ?? null, root?.revision ?? null, root?.installationId ?? null, entitlementId,
      payerUserId, request.budget.ceilingMicro, JSON.stringify(request.capabilities), JSON.stringify(effective), JSON.stringify(rights), memoryNamespace,
      parent?.id ?? null, parent ? parent.nesting_depth + 1 : 0, request.taskRef])).rows[0];
    return { replayed: false, admission: publicAdmission(row) };
  });
}

/** RUN-01's precondition, read before admitting: the CURRENT version pin of an agent as runnable at one
 * target, by this actor -- the `{ resourceId, version, contentHash }` an admission must name.
 *
 * Admission takes the pin as a PRECONDITION and refuses a stale one (`agent_version_stale`), the way an
 * HTTP `If-Match` refuses a stale ETag or a Kubernetes update a stale `resourceVersion`: the host
 * commits to the definition it saw, and a definition that changed in between is a conflict rather than
 * a quiet run of something else. Before this read nothing returned a pin, so no host could admit.
 *
 * It answers under ADMISSION'S OWN RULE, by calling the same `resolveRunnable`: the target and its
 * liveness, the agent and its current definition, that the target grants this resource, that the actor
 * may act for the target, and -- for a team run -- the actor's and the agent's admitted membership. So
 * it never reports an agent runnable where admitting it would refuse on one of those terms, and it
 * discloses exactly what admission would: an admission already returns the pin and the definition's
 * capability term to its actor. A workspace VIEWER, who may see an assigned resource in the catalog but
 * may not dispatch it, is refused here exactly as by admission.
 *
 * NOT resolved, and so still able to refuse at admission: the conversation, the root binding, the
 * entitlement of a bought agent and the budget. Those belong to one admission, not to whether this agent
 * may run here. It writes nothing.
 *
 * This is deliberately NOT section 11.1's `agent.resource.get`: that is a catalog read of one resource
 * under the catalog's visibility rule (VIEW-02), and it remains unbuilt. A pin is authorized by the RUN rule. */
export async function readRunnablePin(pool, authenticatedContext, value) {
  const ctx = record(authenticatedContext, ['actorUserId', 'clientId', 'apiKeyId'], 'context');
  if (typeof ctx.clientId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(ctx.clientId)) fail('bad_input', 'invalid_client');
  const actor = { actorUserId: uuid(ctx.actorUserId, 'actor'), clientId: ctx.clientId,
    ...(Object.hasOwn(ctx, 'apiKeyId') ? { apiKeyId: uuid(ctx.apiKeyId, 'api_key') } : {}) };
  const input = record(value, ['expectedActorAccountId', 'agent', 'target', 'team'], 'request');
  const agent = record(input.agent, ['resourceId'], 'agent');
  const request = {
    agent: { resourceId: uuid(agent.resourceId, 'agent_resource') },
    target: parseTarget(input.target),
    team: input.team === undefined || input.team === null ? null : { teamId: uuid(record(input.team, ['teamId'], 'team').teamId, 'team') },
  };
  const expected = optionalUuid(input.expectedActorAccountId, 'expected_actor');
  if (expected && expected !== actor.actorUserId) fail('conflict', 'actor_context_conflict');
  return authorityTransaction(pool, async (db) => {
    const r = await resolveRunnable(db, actor, request, 'workforce:read');
    return { schemaVersion: 1,
      agent: { resourceId: r.agent.id, version: r.version.version, contentHash: r.version.content_hash },
      target: request.target, team: request.team,
      // What admission would record as the definition and target terms; the runtime ceiling and an
      // entitlement can only narrow this further.
      terms: { definition: r.definitionTerm, target: r.targetTerm } };
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
