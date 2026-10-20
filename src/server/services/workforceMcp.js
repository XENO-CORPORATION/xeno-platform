/**
 * XENO-WORKFORCE-01 as agent capabilities (XENO WORKSPACE AGENT SURFACE - SPEC.md P1/P2, the division after Storage;
 * owner 2026-10-20: "recreate XENO in XENO"). The §11.1 semantic commands — agent.* — plus division.*, objective.*,
 * funding.* and run.*.
 *
 * ONE CODE PATH: every tool calls the SAME service function its /api/workforce, /api/divisions or coordination route
 * calls, with the same authenticated context shape ({ actorUserId, clientId }), so authorization, validation, the
 * closed error vocabulary (§11.1) and idempotency are the service's own. The arguments are the route's own body,
 * passed through unchanged; the actor is ALWAYS the calling principal (an agent acts as itself, capped by its owner),
 * and a body naming another actor is refused here exactly as the routes refuse it.
 *
 * Money and authority: funding contributions/returns, run admission and revocation are `irreversible` in the
 * catalogue, so a workspace credential needs `wallet:spend`/`agents:write` AND a fresh sign-in (step-up, §5 Q2);
 * a headless key is refused. That is this surface's equivalent of the routes' DPoP + recent-auth + ledger:spend.
 */
import * as resources from './workforceResources.js';
import * as catalog from './workforceCatalog.js';
import * as revision from './workforceAgentRevision.js';
import * as admission from './workforceRunAdmission.js';
import * as authority from './workforceRunAuthority.js';
import * as divisions from './workforceDivisions.js';
import * as goals from './projectWorktree.js';
import * as funding from './workforceFunding.js';
import { WORKFORCE_SHAPES } from '../routes/workforceRoutes.js';

/** §11.1 closed error vocabulary: a service error with one of these codes is the caller's answer, not a crash. */
export const WORKFORCE_CODES = Object.freeze(['bad_input', 'not_found', 'denied', 'needs_approval', 'conflict', 'rate_limited', 'unavailable', 'timeout', 'internal',
  'not_allowed', 'workspace_not_found', 'division_not_found', 'forbidden', 'invalid_name']);
export class WorkforceMcpError extends Error { constructor(message, code) { super(message); this.name = 'WorkforceMcpError'; this.code = code; } }
export const isWorkforceError = (e) => e instanceof WorkforceMcpError || (e && typeof e.code === 'string' && (WORKFORCE_CODES.includes(e.code) || /^[A-Z_]{4,64}$/.test(e.code) || (Number(e.status || e.statusCode) >= 400 && Number(e.status || e.statusCode) < 500)));

const CLIENT = 'xeno-mcp';
const ctxOf = (actor) => ({ actorUserId: String(actor.id), clientId: CLIENT });
const ok = (data) => { const d = data === undefined ? null : JSON.parse(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? String(v) : v))); return { content: [{ type: 'text', text: JSON.stringify(d, null, 2) }], structuredContent: d && typeof d === 'object' && !Array.isArray(d) ? d : { result: d } }; };
const FORBIDDEN = ['actorUserId', 'clientId', 'userId', 'principal', 'auth'];
const body = (a) => {
  const b = a && typeof a === 'object' && !Array.isArray(a) ? { ...a } : {};
  if (FORBIDDEN.some((k) => Object.hasOwn(b, k))) throw new WorkforceMcpError('The actor is the caller; a body may not name one', 'bad_input');
  return b;
};
const RO = { readOnlyHint: true, openWorldHint: false }, RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, DX = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
const free = (description, required = []) => ({ type: 'object', description, ...(required.length ? { required } : {}), additionalProperties: true });

/** [tool, title, annotations, description, input, run(db, actor, args)] */
const DEFS = [
  // ── agent.* (§11.1)
  ['resource_create', 'Create an agent or team', DX, 'agent.resource.create: create a workforce resource (an agent or a team) owned by you or a workspace you manage. Body is the /api/workforce/resources body: { schemaVersion, operationId, owner, kind, definition, … }. Repeat with the same operationId to read the same result back.', free('{ schemaVersion: 1, operationId: uuid, owner: { type, id }, kind: "agent" | "team", definition }', ['operationId']), (db, a, v) => resources.createWorkforceResource(db, ctxOf(a), v)],
  ['resource_create_and_assign', 'Create and assign an agent or team', DX, 'agent.resource.create with an assignment, in ONE durable command (VIEW-03). Body is the /api/workforce/resources/create-and-assign body.', free('the create-and-assign body', ['operationId']), (db, a, v) => resources.createAndAssignWorkforceResource(db, ctxOf(a), v)],
  ['resource_operation_get', 'Read a create operation', RO, 'Read back a resource create by its operationId (a write that may have happened is read here, never re-sent).', free('{ operationId }', ['operationId']), (db, a, v) => resources.readWorkforceResourceOperation(db, ctxOf(a), v)],
  ['resource_get', 'Read an agent definition', RO, 'agent.resource.get: an agent or team definition at its current (or named) version.', free('the /resources/definition/read body'), (db, a, v) => revision.readAgentDefinition(db, ctxOf(a), v)],
  ['resource_update', 'Revise an agent definition', DX, 'agent.resource.update: a new version of an agent’s definition. Pass the version you read (stale → conflict with the current version).', free('the /resources/revise-definition body', ['operationId']), (db, a, v) => revision.reviseAgentDefinition(db, ctxOf(a), v)],
  ['resource_revision_get', 'Read a definition revision', RO, 'Read back one definition revision by its operation.', free('the /resources/revise-definition/read body'), (db, a, v) => revision.readAgentRevision(db, ctxOf(a), v)],
  ['catalog_list', 'List agents and teams', RO, 'agent.catalog.list: the agents and teams you can see, in an explicit global or scoped view, paged by cursor.', free('the /resources/list body: { schemaVersion, view, cursor?, limit? }'), (db, a, v) => catalog.listOwnedWorkforceResources(db, ctxOf(a), v)],
  // ── run.* (RUN-01/02/03)
  ['admission_create', 'Admit a run', DX, 'run.admission.create (agent.execution.start’s admission): admit one run of a pinned agent at a target, committing the payer’s budget. Read the pin first with run_pin_get.', free('the /run-admissions body', ['operationId']), (db, a, v) => admission.admitAccountRun(db, ctxOf(a), v)],
  ['admission_get', 'Read a run admission', RO, 'run.admission.get: one admission as you may see it.', free('{ admissionId, expectedActorAccountId? }', ['admissionId']), (db, a, v) => admission.readRunAdmission(db, ctxOf(a), v.admissionId, { expectedActorAccountId: v.expectedActorAccountId })],
  ['admission_list', 'List run admissions', RO, 'run.admission.list: a project’s or an agent’s admissions.', free('the /run-admissions/list body'), (db, a, v) => admission.listRunAdmissions(db, ctxOf(a), v)],
  ['admission_operation_get', 'Read an admission operation', RO, 'Read back an admission by its operationId.', free('{ operationId }', ['operationId']), (db, a, v) => admission.readRunAdmissionOperation(db, ctxOf(a), v)],
  ['pin_get', 'Read the runnable pin', RO, 'run.pin.get: the current { resourceId, version, contentHash } of an agent as runnable at one target, by you — what an admission must name. Writes nothing.', free('the /run-admissions/pin body'), (db, a, v) => admission.readRunnablePin(db, ctxOf(a), v)],
  ['admission_revoke', 'Revoke a run', DX, 'run.admission.revoke (agent.execution.cancel): stop a run; its next step is refused.', free('{ admissionId }', ['admissionId']), (db, a, v) => authority.revokeRun(db, ctxOf(a), v.admissionId)],
  ['authority_get', 'Read a run’s live authority', RO, 'run.authority.get: what a run may still do, re-derived from live rows.', free('{ admissionId }', ['admissionId']), (db, a, v) => authority.readRunAuthority(db, ctxOf(a), v.admissionId)],
  // ── division.*
  ['division_list', 'List divisions', RO, 'division.division.list: the divisions of a workspace (default: your personal one).', free('{ workspaceId?, archived? }'), (db, a, v) => divisions.list(db, meOf(a), { workspaceId: v.workspaceId || null, archived: v.archived === true })],
  ['division_get', 'Read a division', RO, 'division.division.get: one division — head, parent, children, agents, projects.', free('{ id }', ['id']), (db, a, v) => divisions.get(db, meOf(a), v.id)],
  ['division_home', 'Read a division’s home', RO, 'division.division.home: everything working in a division — members, agents, objectives, active runs, spend, funding, projects, handoffs, decisions; what you may not see arrives closed.', free('{ id }', ['id']), async (db, a, v) => (await import('./divisionHome.js')).readDivisionHome(db, meOf(a), v.id)],
  ['division_create', 'Create a division', RW, 'division.division.create (workspace admin): { workspaceId?, name, parentId? }.', free('{ workspaceId?, name, parentId? }', ['name']), (db, a, v) => divisions.create(db, meOf(a), v)],
  ['division_update', 'Change a division', RW, 'division.division.update (workspace admin): { id, name?, parentId?, headId? }.', free('{ id, name?, parentId?, headId? }', ['id']), (db, a, v) => { const { id, ...rest } = v; return divisions.update(db, meOf(a), id, rest); }],
  ['division_archive', 'Archive a division', DX, 'division.division.archive: one-way; refused while it has active children.', free('{ id }', ['id']), (db, a, v) => divisions.archive(db, meOf(a), v.id)],
  // ── objective.*
  ['objective_create', 'Create an objective', RW, 'objective.objective.create: { workspaceId, divisionId, title, successEvidence, ownerUserId, windowStart, windowEnd }.', free('the /coordination/objectives body', ['title']), (db, a, v) => goals.createObjective(db, { ...v, actorUserId: String(a.id) })],
  ['objective_get', 'Read an objective', RO, 'objective.objective.get: { objectiveId }.', free('{ objectiveId }', ['objectiveId']), (db, a, v) => goals.readObjective(db, { ...v, actorUserId: String(a.id) })],
  ['objective_update', 'Change an objective', RW, 'objective.objective.update: { objectiveId, title?, successEvidence?, ownerUserId?, windowEnd? }.', free('the /coordination/objectives/update body', ['objectiveId']), (db, a, v) => goals.updateObjective(db, { ...v, actorUserId: String(a.id) })],
  ['objective_complete', 'Complete an objective', DX, 'objective.objective.complete: { objectiveId }.', free('{ objectiveId }', ['objectiveId']), (db, a, v) => goals.completeObjective(db, { ...v, actorUserId: String(a.id) })],
  ['objective_link_goal', 'Link a goal to an objective', RW, 'objective.goal.link: { goalId, objectiveId }.', free('{ goalId, objectiveId }', ['goalId', 'objectiveId']), (db, a, v) => goals.linkGoalToObjective(db, { ...v, actorUserId: String(a.id) })],
  // ── funding.* (§11.1 agent.funding.*)
  ['funding_price', 'Price a funding budget', RO, 'funding.budget.price: what a budget would cost, before proposing it.', free('the /funding/budgets/price body'), (db, a, v) => funding.readFundingPrice(db, ctxOf(a), v)],
  ['funding_budget_propose', 'Propose a funding budget', RW, 'funding.budget.propose (agent.funding.budget_set): a proposal a manager decides; it spends nothing by itself.', free('the /funding/budgets body'), (db, a, v) => funding.proposeFundingBudget(db, ctxOf(a), v)],
  ['funding_budget_get', 'Read a funding budget', RO, 'funding.budget.get (agent.funding.pool_get).', free('the /funding/budgets/read body'), (db, a, v) => funding.readFundingBudget(db, ctxOf(a), v)],
  ['funding_offer_get', 'Read a funding offer', RO, 'funding.offer.get: a project’s open funding offer and its terms.', free('the /funding/offers/read body'), (db, a, v) => funding.readFundingOffer(db, ctxOf(a), v)],
  ['funding_contribute', 'Contribute credits to a project', DX, 'funding.contribution.create (agent.funding.contribute): move your owner’s credits into a project’s funding. Irreversible spend: needs wallet:spend and a fresh sign-in.', free('the /funding/contributions body', ['operationId']), (db, a, v) => funding.contributeFunding(db, ctxOf(a), v)],
  ['funding_contribution_get', 'Read a contribution', RO, 'funding.contribution.get (agent.funding.contribution_get).', free('the /funding/contributions/read body'), (db, a, v) => funding.readFundingContribution(db, ctxOf(a), v)],
  ['funding_contribution_return', 'Return a contribution', DX, 'funding.contribution.return (agent.funding.return): return an unspent contribution to its contributor.', free('the /funding/contributions/return body'), (db, a, v) => funding.returnFundingContribution(db, ctxOf(a), v)],
];
const meOf = (actor) => ({ id: String(actor.id), kind: actor.kind || 'agent' });

/**
 * What each tool's ROUTE answers, so a capability answers exactly that (owner/coordinator 2026-10-20):
 *   path      → the route's own projection (WORKFORCE_SHAPES, shared with the route — one function)
 *   wrap      → the route returns the service result unprojected, under this key ('result', 'division') or spread
 */
export const TOOL_ROUTE = Object.freeze({
  resource_create: { path: '/resources' }, resource_create_and_assign: { path: '/resources/create-and-assign' },
  resource_operation_get: { path: '/resource-operations/read' }, resource_get: { path: '/resources/definition/read' },
  resource_update: { path: '/resources/revise-definition' }, resource_revision_get: { path: '/resources/revise-definition/read' },
  catalog_list: { path: '/resources/list' },
  admission_create: { path: '/run-admissions' }, admission_get: { path: '/run-admissions/read' }, admission_list: { path: '/run-admissions/list' },
  admission_operation_get: { path: '/run-admissions/operations/read' }, pin_get: { path: '/run-admissions/pin' },
  admission_revoke: { path: '/run-admissions/revoke' }, authority_get: { path: '/run-admissions/authority' },
  division_list: { wrap: '...' }, division_get: { wrap: 'division' }, division_home: { wrap: 'home' }, division_create: { wrap: 'division' }, division_update: { wrap: 'division' }, division_archive: { wrap: 'division' },
  objective_create: { wrap: 'result' }, objective_get: { wrap: 'result' }, objective_update: { wrap: 'result' }, objective_complete: { wrap: 'result' }, objective_link_goal: { wrap: 'result' },
  funding_price: { wrap: 'result' }, funding_budget_propose: { wrap: 'result' }, funding_budget_get: { wrap: 'result' }, funding_offer_get: { wrap: 'result' },
  funding_contribute: { wrap: 'result' }, funding_contribution_get: { wrap: 'result' }, funding_contribution_return: { wrap: 'result' },
});

/** Shape a service result exactly as its route would. Null from a projection is a refusal, as on the route. */
export function shapeResult(tool, value, request) {
  const r = TOOL_ROUTE[tool];
  if (!r) throw new WorkforceMcpError(`No route shape for ${tool}`, 'internal');
  if (r.path) {
    const [project, readOnly] = WORKFORCE_SHAPES[r.path];
    const out = project(value, request, readOnly);
    if (!out) throw new WorkforceMcpError('Workforce request failed.', 'internal');
    return out;
  }
  if (r.wrap === '...') return { ...(value || {}) };
  return { [r.wrap]: value === undefined ? null : value };
}

export const TOOLS = DEFS.map(([name, title, annotations, description, inputSchema]) => ({ name, title, annotations, description, inputSchema }));
const RUN = new Map(DEFS.map((d) => [d[0], d[5]]));

export async function callTool(db, actor, name, args = {}) {
  const run = RUN.get(name);
  if (!run) throw new WorkforceMcpError(`Unknown tool ${name}`, 'not_found');
  const request = body(args);
  try { return ok(shapeResult(name, await run(db, actor, request), request)); }
  catch (e) {
    if (e instanceof WorkforceMcpError) throw e;
    if (isWorkforceError(e)) throw new WorkforceMcpError(e.details && e.details.reason ? `${e.code}: ${e.details.reason}` : (e.reason || e.message || e.code), e.code);
    throw e;
  }
}
