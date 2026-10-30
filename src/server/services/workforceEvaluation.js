/**
 * XENO-WORKFORCE-01 LIFE-04 -- an evaluation is DERIVED from evidence for a stated window, never stored.
 *
 *   LIFE-04: "Evaluation is EVIDENCE-DERIVED, never a rating column. The estate already persists
 *            everything a performance view needs: admissions, receipts, contributions, reviewer decisions
 *            (RUN-06 ...), handoffs (HAND-01) and ledger settlements. An evaluation is a projection over
 *            those records for a stated window, not a stored score. A stored score is an unfalsifiable
 *            claim, and this estate's standing rule is that a claim without its procedure is not evidence."
 *
 * `readWorkforceEvaluation(pool, ctx, { owner, subject, window: { since, until }, expectedActorAccountId })`
 * reads, for one subject inside one scope and one half-open window [since, until):
 *   runs       admissions of the subject in the scope: admitted in the window, stopped in the window (by
 *              the closed revocation vocabulary), still active at the window's END, and children spawned
 *   steps      leases issued in the window: privileged calls and provider dispatches
 *   handoffs   for a principal: sent and received in the window, each in the state it was in at the END
 *   decisions  made by the principal, answered for by it (LIFE-07: an agent decided, it is responsible),
 *              or -- for an agent -- decided about it; by kind, and how many carried evidence
 *   records    the ids of every admission, handoff and decision counted, so each figure can be checked
 *
 *   tasks      (a principal only) XENO Tasks in the scope: what the subject directed (created, delegated to
 *              an agent, assigned), did (started, submitted for review, closed without review, commented)
 *              and REVIEWED (accepted, changes requested, how long each decision took after the task entered
 *              review, how many inside a minute), and the outcomes it answers for (finished, via an agent,
 *              accepted by a human, closed by an agent, never reviewed). Owner, 2026-10-29: tell a person who
 *              directs and checks agents' work from one who only sets agents running. "Answers for" uses the
 *              task's CURRENT assignee/delegate; every other figure is the event as it happened.
 *
 * THERE IS NO SCORE, and nothing here is written. It reports ACTIONS ON WORK, never activity on a machine (no
 * keystrokes, screenshots, presence or time-at-desk), and no model judges anyone: in the EU an AI system that
 * evaluates workers' performance is high-risk (AI Act Annex III 4(b)), and monitoring needs a works-council
 * agreement in Germany (BetrVG §87(1) 6). A person can always read their own; a decision about a person is a
 * person's, made on these records. No single number summarises a subject, because any such
 * number is a weighting somebody chose, and a weighting presented as a measurement is exactly the claim
 * without its procedure LIFE-04 forbids. A reader gets counts and the records behind them.
 *
 * ── REPRODUCIBLE FOR THE WINDOW ─────────────────────────────────────────────────────────────────────
 * Every input is an immutable, timestamped record -- admissions, revocations, leases and decision records
 * cannot be updated -- and a handoff's state is read AS OF the window's end from its own timestamps
 * (accepted_at, resolved_at), never from its current state. So the same window reads the same however much
 * evidence arrives after it, and the whole projection is ONE statement, so it is one snapshot.
 *
 * A step is timed by its lease's `issued_at`, which IS the signed `iat` claim and so is whole seconds: a
 * step belongs to the window containing the start of its second. Every other record is timed to the
 * microsecond. A window whose bounds fall on whole seconds counts steps exactly; one that does not may
 * place a step issued in its first or last second outside it.
 *
 * One caveat is structural and is reported rather than hidden: a record is stamped when its transaction
 * STARTS, so a record stamped inside a window can commit after a read of it. `settledBefore` is the read
 * time less five minutes -- well beyond any authority transaction (its statements time out at 5 s) -- and
 * `closed` says whether the whole window lies before it. A window that is not closed may still move.
 *
 * ── WHAT IT CANNOT SEE, SAID IN THE ANSWER ──────────────────────────────────────────────────────────────
 * This evaluation does not yet project contributions or linked settlements (review decisions come from XENO Tasks),
 * so `notRecorded` names those omissions. Financial contributions now exist in workforceFunding;
 * integrating their appropriate sanitized projection remains work, not evidence of absence.
 * An evaluation that silently omitted these categories would read as complete.
 *
 * ── WHO MAY READ ONE ────────────────────────────────────────────────────────────────────────────────────
 * A performance view is about a person or an agent someone answers for, so it is narrower than the
 * catalog: an ADMINISTRATOR of the scope (the personal owner, or a workspace admin -- directly, or by role
 * hierarchy for a human; an agent only by its exact grant), or the principal being evaluated, reading
 * itself. Anything else answers exactly like a scope that does not exist.
 */
import { normalizeOwnerScope } from './workforceScope.js';
import { resolvePrincipal } from './agentIdentity.js';
import { check } from '../utils/authzReBAC.js';
import { authorityTransaction } from './workspaceOperationReceipts.js';
import { lockApiKeyWorkforceAuthority } from './apiKeyWorkforceAuthority.js';

export const EVALUATION_RECORD_LIMIT = 500;
export const EVALUATION_MAX_WINDOW_DAYS = 366;
// Review decisions are read from XENO Tasks (a task leaving review), so they are no longer unrecorded.
export const EVALUATION_NOT_RECORDED = Object.freeze(['contributions']);

export class WorkforceEvaluationError extends Error {
  constructor(code = 'not_found', reason = 'evaluation_unavailable') {
    super(code === 'bad_input' ? 'Invalid workforce evaluation request.' : 'Workforce evaluation unavailable.');
    this.name = 'WorkforceEvaluationError';
    this.code = code;
    this.status = code === 'bad_input' ? 400 : code === 'denied' ? 403 : 404;
    this.details = Object.freeze({ schemaVersion: 1, reason });
  }
}
const fail = (code, reason) => { throw new WorkforceEvaluationError(code, reason); };
const uuid = (value) => normalizeOwnerScope({ type: 'user', id: value }).id;

function record(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('bad_input', 'invalid_evaluation_shape');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('bad_input', 'invalid_evaluation_shape');
  return value;
}
function instant(value) {
  if (typeof value !== 'string' || value.length > 40) fail('bad_input', 'invalid_evaluation_window');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail('bad_input', 'invalid_evaluation_window');
  return new Date(ms);
}

function input(context, value) {
  const ctx = record(context, ['actorUserId', 'clientId', 'apiKeyId']);
  if (typeof ctx.clientId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(ctx.clientId)) fail('bad_input', 'invalid_evaluation_context');
  const body = record(value, ['owner', 'subject', 'window', 'expectedActorAccountId']);
  let owner, actorUserId, expected, subject;
  try {
    owner = normalizeOwnerScope(body.owner);
    actorUserId = uuid(ctx.actorUserId);
    expected = uuid(body.expectedActorAccountId);
  } catch { fail('bad_input', 'invalid_evaluation_shape'); }
  if (expected !== actorUserId) fail('denied', 'actor_precondition_mismatch');
  const s = record(body.subject, ['kind', 'resourceId', 'userId']);
  try {
    if (s.kind === 'agent' && Object.keys(s).length === 2) subject = { kind: 'agent', resourceId: uuid(s.resourceId) };
    else if (s.kind === 'principal' && Object.keys(s).length === 2) subject = { kind: 'principal', userId: uuid(s.userId) };
  } catch { /* falls through to the refusal */ }
  if (!subject) fail('bad_input', 'invalid_evaluation_subject');
  const w = record(body.window, ['since', 'until']);
  const since = instant(w.since), until = instant(w.until);
  if (!(since < until) || until - since > EVALUATION_MAX_WINDOW_DAYS * 86_400_000) fail('bad_input', 'invalid_evaluation_window');
  return { actor: { actorUserId, clientId: ctx.clientId, ...(Object.hasOwn(ctx, 'apiKeyId') ? { apiKeyId: uuid(ctx.apiKeyId) } : {}) },
    owner, subject, window: { since, until } };
}

/** The principal who ACTS for a subject: the person themselves, or the agent account linked to an agent
 * definition (agent_identities.workforce_resource_id, OWN-02's edge). Null when a definition has none. */
async function actingPrincipal(db, subject) {
  if (subject.kind === 'principal') return subject.userId;
  return (await db.query('SELECT user_id FROM agent_identities WHERE workforce_resource_id = $1', [subject.resourceId])).rows[0]?.user_id || null;
}

/** Someone above the acting principal in the workspace's reporting line (workforce_employee_profiles), at any
 * level -- the same readers People already allows for private fields. Bounded, and a loop ends it. */
async function managesInWorkspace(db, workspaceId, readerId, principalId) {
  if (!principalId) return false;
  const r = await db.query(`WITH RECURSIVE up AS (
      SELECT manager_principal_id AS m, 1 AS d FROM workforce_employee_profiles WHERE workspace_id = $1 AND principal_id = $2
      UNION
      SELECT e.manager_principal_id, up.d + 1 FROM up JOIN workforce_employee_profiles e ON e.workspace_id = $1 AND e.principal_id = up.m WHERE up.d < 12)
    SELECT EXISTS (SELECT 1 FROM up WHERE m = $3) AND EXISTS (SELECT 1 FROM workspaces WHERE id = $1 AND status = 'active') AS yes`, [workspaceId, principalId, readerId]);
  return r.rows[0].yes === true;
}

/** An administrator of the scope, a manager above the subject in it, or the principal reading itself; anyone else sees nothing. */
async function mayRead(db, actorUserId, owner, subject, acting = null) {
  const reader = await usableReader(db, actorUserId);
  if (!reader) return false;
  if (subject.kind === 'principal' && subject.userId === reader.id) return true;
  if (await isScopeAdmin(db, reader, owner)) return true;
  return owner.type === 'workspace' && reader.kind === 'human' && await managesInWorkspace(db, owner.id, reader.id, acting);
}
async function usableReader(db, actorUserId) {
  const reader = await resolvePrincipal(db, actorUserId);
  if (!reader?.usable || !['human', 'agent'].includes(reader.kind)) return null;
  if (reader.kind === 'agent') {
    const human = await resolvePrincipal(db, reader.owner.id);
    if (!human?.usable || human.kind !== 'human') return null;
  }
  return reader;
}
/** The personal owner, or an administrator of the workspace (directly, or by role hierarchy for a human). */
async function isScopeAdmin(db, reader, owner) {
  if (owner.type === 'user') return reader.kind === 'human' && reader.id === owner.id;
  const status = (await db.query('SELECT status FROM workspaces WHERE id=$1 FOR SHARE', [owner.id])).rows[0]?.status;
  if (status !== 'active') return false;
  const subjectRef = `${reader.kind === 'agent' ? 'agent' : 'user'}:${reader.id}`;
  const verdict = await check(db, { object: `workspace:${owner.id}`, relation: 'admin', subject: subjectRef });
  return verdict.allowed && ['direct', ...(reader.kind === 'human' ? ['role-hierarchy'] : [])].includes(verdict.via);
}

// ONE statement: one snapshot, so no figure can come from a different moment than another.
const PROJECTION = `
WITH RECURSIVE
params AS (SELECT $1::uuid AS ws, $2::uuid AS owner_user, $3::text AS kind, $4::uuid AS subject,
                  $5::timestamptz AS since, $6::timestamptz AS until, $7::int AS lim, $8::uuid AS tsub),
scope_adm AS (
  SELECT a.* FROM workforce_run_admissions a, params p
   WHERE a.admitted_at < p.until
     AND ((p.ws IS NOT NULL AND a.target_workspace_id = p.ws)
       OR (p.ws IS NULL AND a.target_workspace_id IS NULL AND a.target_owner_user_id = p.owner_user))
     AND CASE WHEN p.kind = 'agent' THEN a.agent_resource_id = p.subject ELSE a.actor_user_id = p.subject END),
chain AS (
  SELECT s.id AS admission_id, s.id AS node, s.parent_admission_id AS parent, 0 AS hop FROM scope_adm s
  UNION ALL
  SELECT c.admission_id, a.id, a.parent_admission_id, c.hop + 1
    FROM chain c JOIN workforce_run_admissions a ON a.id = c.parent WHERE c.hop < 16),
-- Fenced AS OF the window's end: a revocation of the run or any ancestor stamped before it.
fenced AS (
  SELECT DISTINCT c.admission_id FROM chain c JOIN workforce_run_revocations r ON r.admission_id = c.node, params p
   WHERE r.revoked_at < p.until),
in_window AS (SELECT s.* FROM scope_adm s, params p WHERE s.admitted_at >= p.since),
stops AS (
  SELECT r.reason, count(*)::int AS n FROM workforce_run_revocations r JOIN scope_adm s ON s.id = r.admission_id, params p
   WHERE r.revoked_at >= p.since AND r.revoked_at < p.until GROUP BY r.reason),
steps AS (
  SELECT l.operation, count(*)::int AS n FROM workforce_run_leases l JOIN scope_adm s ON s.id = l.admission_id, params p
   WHERE l.issued_at >= p.since AND l.issued_at < p.until GROUP BY l.operation),
hand AS (
  SELECT h.id, h.created_at,
         CASE WHEN h.source_principal_id = p.subject THEN 'sent' ELSE 'received' END AS direction,
         CASE WHEN h.accepted_at IS NOT NULL AND h.accepted_at < p.until THEN 'accepted'
              WHEN h.resolved_at IS NOT NULL AND h.resolved_at < p.until THEN h.state
              ELSE 'offered' END AS state_at_end
    FROM workforce_handoffs h, params p
   WHERE p.kind = 'principal' AND (h.source_principal_id = p.subject OR h.target_principal_id = p.subject)
     AND h.created_at >= p.since AND h.created_at < p.until
     AND ((p.ws IS NOT NULL AND (h.source_workspace_id = p.ws OR h.target_workspace_id = p.ws))
       OR (p.ws IS NULL AND h.source_workspace_id IS NULL AND h.target_workspace_id IS NULL))),
dec AS (
  SELECT o.operation_id, o.kind, o.committed_at, (jsonb_array_length(o.evidence) > 0) AS evidenced,
         CASE WHEN p.kind = 'agent' THEN 'about'
              WHEN o.deciding_principal_id = p.subject THEN 'made' ELSE 'answeredFor' END AS relation
    FROM workforce_operations o, params p
   WHERE o.committed_at >= p.since AND o.committed_at < p.until
     AND ((p.ws IS NOT NULL AND o.workspace_id = p.ws) OR (p.ws IS NULL AND o.workspace_id IS NULL))
     AND CASE WHEN p.kind = 'agent' THEN o.subject_type = 'resource' AND o.subject_id = p.subject
              ELSE o.deciding_principal_id = p.subject OR o.responsible_account_id = p.subject END),
-- XENO Tasks (owner, 2026-10-29: see whether a person directs and checks the work, or only sets agents
-- running). Only for a principal: a task names users, and an agent DEFINITION has no task identity.
scope_tasks AS (
  SELECT t.id, t.assignee_id, t.delegate_id FROM tasks t LEFT JOIN chat_projects cp ON cp.id = t.project_id, params p
   WHERE p.tsub IS NOT NULL
     AND ((p.ws IS NOT NULL AND cp.workspace_id = p.ws)
       OR (p.ws IS NULL AND ((t.project_id IS NULL AND t.owner_user_id = p.owner_user)
                          OR (t.project_id IS NOT NULL AND cp.workspace_id IS NULL AND cp.owner_user_id = p.owner_user))))),
tev AS (
  SELECT e.*, st.assignee_id AS t_assignee, st.delegate_id AS t_delegate
    FROM task_events e JOIN scope_tasks st ON st.id = e.task_id, params p
   WHERE e.created_at >= p.since AND e.created_at < p.until),
mine AS (SELECT e.* FROM tev e, params p WHERE e.actor_id = p.tsub),
-- A review decision is the subject moving a task OUT of review; its time is measured from the task's last
-- entry INTO review (which may lie before the window).
rev AS (
  SELECT e.task_id, e.to_value,
         EXTRACT(EPOCH FROM e.created_at - (SELECT max(x.created_at) FROM task_events x
           WHERE x.task_id = e.task_id AND x.kind = 'status' AND x.to_value = 'in_review' AND x.created_at <= e.created_at)) AS secs
    FROM mine e WHERE e.kind = 'status' AND e.from_value = 'in_review' AND e.to_value IN ('done', 'in_progress')),
-- Outcomes: tasks the subject answers for (assignee or agent delegate, as they stand now) finished in the window.
done_ev AS (
  SELECT e.task_id, e.actor_kind, e.from_value,
         EXISTS (SELECT 1 FROM task_events d WHERE d.task_id = e.task_id AND d.kind = 'delegated' AND d.to_value IS NOT NULL
                  AND d.created_at <= e.created_at) AS via_agent
    FROM tev e, params p
   WHERE e.kind = 'status' AND e.to_value = 'done' AND (e.t_assignee = p.tsub OR e.t_delegate = p.tsub)),
-- Spend (owner, 2026-10-29: cost against finished, reviewed work), counted only where a record ties it to
-- the scope. The usage ledger names who PAID, never which workspace (api_usage_logs.workspace_id is a BILLING
-- workspace, a different id space), so it counts in a PERSONAL scope only: what the owner paid, directly and
-- through each agent, and what an agent spent acting for them. In a WORKSPACE, what is tied to it is the
-- charge on the runs admitted there (their ledger holds: settled, and still reserved), in either scope.
paid AS (
  SELECT coalesce(u.actual_cost_micro, 0) AS c, u.dimensions->>'agent_user_id' AS ag
    FROM api_usage_logs u, params p
   WHERE p.tsub IS NOT NULL AND p.ws IS NULL AND u.user_id = p.tsub AND u.user_id = p.owner_user
     AND u.created_at >= p.since AND u.created_at < p.until),
acted AS (
  SELECT coalesce(u.actual_cost_micro, 0) AS c
    FROM api_usage_logs u, params p
   WHERE p.tsub IS NOT NULL AND p.ws IS NULL AND u.dimensions ? 'agent_user_id' AND u.dimensions->>'agent_user_id' = p.tsub::text
     AND u.user_id = p.owner_user AND u.created_at >= p.since AND u.created_at < p.until),
run_holds AS (
  SELECT h.state, h.amount_micro, h.settled_micro FROM in_window a
    LEFT JOIN workforce_run_holds wh ON wh.admission_id = a.id
    LEFT JOIN workforce_run_funding wf ON wf.admission_id = a.id
    JOIN credit_holds h ON h.id = coalesce(wh.hold_row_id, wf.hold_row_id)
   WHERE a.parent_admission_id IS NULL),
-- Media an agent committed (images, video) is a separate log; reported apart, never added to the above. In a
-- workspace it is the media charged to that workspace's divisions; in a personal scope, the owner's own.
media AS (
  SELECT m.amount_micro AS c FROM agent_spend_log m, params p
   WHERE p.tsub IS NOT NULL AND m.agent_user_id = p.tsub AND m.state = 'reserved' AND m.created_at >= p.since AND m.created_at < p.until
     AND ((p.ws IS NULL AND m.payer_user_id = p.owner_user AND m.division_id IS NULL)
       OR (p.ws IS NOT NULL AND m.division_id IN (SELECT id FROM workforce_divisions WHERE workspace_id = p.ws))))
SELECT
  clock_timestamp() AS derived_at,
  clock_timestamp() - interval '5 minutes' AS settled_before,
  (SELECT count(*)::int FROM in_window) AS admitted,
  (SELECT count(*)::int FROM in_window WHERE parent_admission_id IS NOT NULL) AS children,
  (SELECT count(*)::int FROM scope_adm s WHERE NOT EXISTS (SELECT 1 FROM fenced f WHERE f.admission_id = s.id)) AS active_at_end,
  (SELECT coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) FROM stops) AS stops,
  (SELECT coalesce(jsonb_object_agg(operation, n), '{}'::jsonb) FROM steps) AS steps,
  (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM
     (SELECT direction || ':' || state_at_end AS k, count(*)::int AS n FROM hand GROUP BY 1) x) AS handoffs,
  (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM
     (SELECT relation || ':' || kind AS k, count(*)::int AS n FROM dec GROUP BY 1) x) AS decisions,
  (SELECT count(*)::int FROM dec WHERE evidenced) AS evidenced_decisions,
  (SELECT coalesce(array_agg(id ORDER BY admitted_at, id), '{}') FROM (SELECT id, admitted_at FROM in_window ORDER BY admitted_at, id LIMIT (SELECT lim FROM params)) x) AS admission_ids,
  (SELECT count(*)::int FROM in_window) > (SELECT lim FROM params) AS admissions_truncated,
  (SELECT coalesce(array_agg(id ORDER BY created_at, id), '{}') FROM (SELECT id, created_at FROM hand ORDER BY created_at, id LIMIT (SELECT lim FROM params)) x) AS handoff_ids,
  (SELECT count(*)::int FROM hand) > (SELECT lim FROM params) AS handoffs_truncated,
  (SELECT coalesce(array_agg(operation_id ORDER BY committed_at, operation_id), '{}') FROM (SELECT operation_id, committed_at FROM dec ORDER BY committed_at, operation_id LIMIT (SELECT lim FROM params)) x) AS decision_ids,
  (SELECT count(*)::int FROM dec) > (SELECT lim FROM params) AS decisions_truncated,
  (SELECT jsonb_build_object(
     'created',            count(*) FILTER (WHERE kind = 'created'),
     'delegatedToAgents',  count(*) FILTER (WHERE kind = 'delegated' AND to_value IS NOT NULL),
     'assignedToOthers',   count(*) FILTER (WHERE kind = 'assigned' AND to_value IS NOT NULL AND to_value <> (SELECT tsub::text FROM params)),
     'started',            count(*) FILTER (WHERE kind = 'status' AND to_value = 'in_progress' AND from_value IS DISTINCT FROM 'in_review'),
     'submittedForReview', count(*) FILTER (WHERE kind = 'status' AND to_value = 'in_review'),
     'closedWithoutReview',count(*) FILTER (WHERE kind = 'status' AND to_value = 'done' AND from_value IS DISTINCT FROM 'in_review'),
     'comments',           count(*) FILTER (WHERE kind = 'comment')) FROM mine) AS task_mine,
  (SELECT jsonb_build_object(
     'accepted',             count(*) FILTER (WHERE to_value = 'done'),
     'changesRequested',     count(*) FILTER (WHERE to_value = 'in_progress'),
     'decidedWithinAMinute', count(*) FILTER (WHERE secs IS NOT NULL AND secs < 60),
     'medianSeconds',        percentile_cont(0.5) WITHIN GROUP (ORDER BY secs)) FROM rev) AS task_reviews,
  (SELECT jsonb_build_object(
     'done',              count(*),
     'viaAgent',          count(*) FILTER (WHERE via_agent),
     'acceptedByHuman',   count(*) FILTER (WHERE from_value = 'in_review' AND actor_kind = 'human'),
     'closedByAgent',     count(*) FILTER (WHERE actor_kind = 'agent'),
     'neverReviewed',     count(*) FILTER (WHERE from_value IS DISTINCT FROM 'in_review')) FROM done_ev) AS task_outcomes,
  (SELECT coalesce(array_agg(DISTINCT task_id), '{}') FROM (SELECT task_id FROM done_ev LIMIT (SELECT lim FROM params)) x) AS task_ids,
  (SELECT count(*)::int FROM done_ev) > (SELECT lim FROM params) AS tasks_truncated,
  (SELECT jsonb_build_object('micro', coalesce(sum(c), 0)::text, 'requests', count(*), 'viaAgentsMicro', coalesce(sum(c) FILTER (WHERE ag IS NOT NULL), 0)::text) FROM paid) AS spend_paid,
  (SELECT coalesce(jsonb_agg(x ORDER BY (x->>'micro')::bigint DESC), '[]'::jsonb) FROM
     (SELECT jsonb_build_object('agentUserId', ag, 'micro', sum(c)::text, 'requests', count(*)) AS x FROM paid WHERE ag IS NOT NULL GROUP BY ag ORDER BY sum(c) DESC LIMIT 10) y) AS spend_by_agent,
  (SELECT jsonb_build_object('micro', coalesce(sum(c), 0)::text, 'requests', count(*)) FROM acted) AS spend_acted,
  (SELECT coalesce(sum(c), 0)::text FROM media) AS spend_media,
  (SELECT jsonb_build_object('settledMicro', coalesce(sum(settled_micro) FILTER (WHERE state = 'settled'), 0)::text,
                             'reservedMicro', coalesce(sum(amount_micro) FILTER (WHERE state = 'held'), 0)::text) FROM run_holds) AS spend_runs`;

const RUN_STOPS = ['stopped_by_actor', 'stopped_by_target', 'authority_lost'];
const STEP_KINDS = ['privileged_call', 'provider_dispatch'];
const HANDOFF_STATES = ['offered', 'accepted', 'declined', 'expired'];
const TASK_MINE = ['created', 'delegatedToAgents', 'assignedToOthers', 'started', 'submittedForReview', 'closedWithoutReview', 'comments'];
const TASK_OUTCOMES = ['done', 'viaAgent', 'acceptedByHuman', 'closedByAgent', 'neverReviewed'];

export async function readWorkforceEvaluation(pool, authenticatedContext, value) {
  const { actor, owner, subject, window } = input(authenticatedContext, value);
  return authorityTransaction(pool, async (db) => {
    const acting = await actingPrincipal(db, subject);
    if (!(await mayRead(db, actor.actorUserId, owner, subject, acting))) fail('not_found', 'evaluation_unavailable');
    await lockApiKeyWorkforceAuthority(db, actor, 'workforce:read');
    return project(db, owner, subject, window, acting);
  });
}

async function project(db, owner, subject, window, acting) {
  {
    const r = (await db.query(PROJECTION, [owner.type === 'workspace' ? owner.id : null, owner.type === 'user' ? owner.id : null,
      subject.kind, subject.kind === 'agent' ? subject.resourceId : subject.userId, window.since, window.until, EVALUATION_RECORD_LIMIT, acting])).rows[0];
    const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, Number(obj[k] ?? 0)]));
    const handoffs = subject.kind === 'principal'
      ? { sent: pick(Object.fromEntries(Object.entries(r.handoffs).filter(([k]) => k.startsWith('sent:')).map(([k, n]) => [k.slice(5), n])), HANDOFF_STATES),
        received: pick(Object.fromEntries(Object.entries(r.handoffs).filter(([k]) => k.startsWith('received:')).map(([k, n]) => [k.slice(9), n])), HANDOFF_STATES) }
      : null;
    const byRelation = {};
    for (const [key, n] of Object.entries(r.decisions).sort(([a], [b]) => a.localeCompare(b))) {
      const [relation, kind] = key.split(':');
      (byRelation[relation] ??= {})[kind] = Number(n);
    }
    return {
      schemaVersion: 1, owner, subject,
      window: { since: window.since.toISOString(), until: window.until.toISOString() },
      derivedAt: r.derived_at.toISOString(),
      settledBefore: r.settled_before.toISOString(),
      closed: window.until <= r.settled_before,
      runs: { admitted: r.admitted, children: r.children, activeAtEnd: r.active_at_end, stopped: pick(r.stops, RUN_STOPS) },
      steps: { privilegedCalls: Number(r.steps.privileged_call ?? 0), providerDispatches: Number(r.steps.provider_dispatch ?? 0) },
      handoffs,
      decisions: { byRelation, withEvidence: r.evidenced_decisions },
      records: {
        admissions: r.admission_ids, handoffs: r.handoff_ids, decisions: r.decision_ids,
        ...(acting ? { tasks: r.task_ids } : {}),
        truncated: Boolean(r.admissions_truncated || r.handoffs_truncated || r.decisions_truncated || (acting && r.tasks_truncated)),
      },
      // an agent definition is read through its agent account, and says which one
      ...(subject.kind === 'agent' ? { actingPrincipal: acting } : {}),
      tasks: acting ? {
        mine: pick(r.task_mine, TASK_MINE),
        reviews: { ...pick(r.task_reviews, ['accepted', 'changesRequested', 'decidedWithinAMinute']),
          medianSeconds: r.task_reviews.medianSeconds == null ? null : Math.round(Number(r.task_reviews.medianSeconds)) },
        outcomes: pick(r.task_outcomes, TASK_OUTCOMES),
      } : null,
      // credits as charged (micro, as strings: they are bigints). `paid` = what this principal paid, part of it
      // through agents (byAgent, top 10); `asAgent` = what it spent acting as an agent; `agentMedia` = images
      // and video an agent committed, a separate log, never added to the others.
      spend: acting ? {
        paid: { micro: r.spend_paid.micro, requests: Number(r.spend_paid.requests), viaAgentsMicro: r.spend_paid.viaAgentsMicro },
        byAgent: r.spend_by_agent.map((x) => ({ agentUserId: x.agentUserId, micro: x.micro, requests: Number(x.requests) })),
        asAgent: { micro: r.spend_acted.micro, requests: Number(r.spend_acted.requests) },
        agentMediaMicro: r.spend_media,
        runs: { settledMicro: r.spend_runs.settledMicro, reservedMicro: r.spend_runs.reservedMicro },
        usage: owner.type === 'user' ? 'counted' : 'not-tied-to-workspace',
      } : null,
      notRecorded: [...EVALUATION_NOT_RECORDED, ...(acting ? [] : ['tasks', 'spend'])],
    };
  }
}
export { RUN_STOPS, STEP_KINDS, HANDOFF_STATES };
// For workforceCompensation.js: the same evidence and the same administrator rule, never a second copy.
export { project as projectEvaluation, usableReader, isScopeAdmin };

// ── ROSTER: the same evaluation for every member of a group, one row each ───────────────────────────────
// Owner, 2026-10-29: team and division views, and a manager across their reports. A group is read from the
// records that already say who is in it, never a list the caller supplies:
//   team      active team memberships (people, and agent definitions through their agent account) plus
//             People profiles that name the team
//   division  People profiles in the division or any division below it
//   reports   People profiles whose reporting line reaches the given person, at any level
// Who may read one: an administrator of the workspace, or a person reading their own reports. Each member's
// row is that member's evaluation, so it says nothing a member's own report would not.
export const ROSTER_MEMBER_LIMIT = 100;
const GROUP_KINDS = ['team', 'division', 'reports'];

function rosterInput(context, value) {
  const body = record(value, ['owner', 'group', 'window', 'expectedActorAccountId']);
  const g = record(body.group, ['kind', 'id']);
  if (!GROUP_KINDS.includes(g.kind)) fail('bad_input', 'invalid_roster_group');
  let groupId; try { groupId = uuid(g.id); } catch { fail('bad_input', 'invalid_roster_group'); }
  // validate the rest exactly as a single evaluation does, with a placeholder subject
  const base = input(context, { owner: body.owner, subject: { kind: 'principal', userId: groupId }, window: body.window, expectedActorAccountId: body.expectedActorAccountId });
  if (base.owner.type !== 'workspace') fail('bad_input', 'roster_needs_workspace');
  return { ...base, group: { kind: g.kind, id: groupId } };
}

async function groupMembers(db, ws, group) {
  const q = group.kind === 'team' ? `
      SELECT m.member_principal_id AS id FROM workforce_team_memberships m JOIN workforce_resources t ON t.id = m.team_id
       WHERE m.team_id = $2 AND m.state = 'active' AND m.member_principal_id IS NOT NULL AND t.owner_workspace_id = $1
      UNION SELECT ai.user_id FROM workforce_team_memberships m JOIN workforce_resources t ON t.id = m.team_id
        JOIN agent_identities ai ON ai.workforce_resource_id = m.member_resource_id
       WHERE m.team_id = $2 AND m.state = 'active' AND t.owner_workspace_id = $1
      UNION SELECT principal_id FROM workforce_employee_profiles WHERE workspace_id = $1 AND team_resource_id = $2`
    : group.kind === 'division' ? `
      WITH RECURSIVE d AS (SELECT id, 0 AS depth FROM workforce_divisions WHERE id = $2 AND workspace_id = $1
        UNION SELECT c.id, d.depth + 1 FROM workforce_divisions c JOIN d ON c.parent_division_id = d.id WHERE d.depth < 12)
      SELECT principal_id AS id FROM workforce_employee_profiles WHERE workspace_id = $1 AND division_id IN (SELECT id FROM d)`
      : `
      WITH RECURSIVE down AS (SELECT principal_id AS id, 1 AS depth FROM workforce_employee_profiles WHERE workspace_id = $1 AND manager_principal_id = $2
        UNION SELECT e.principal_id, down.depth + 1 FROM workforce_employee_profiles e JOIN down ON e.manager_principal_id = down.id
         WHERE e.workspace_id = $1 AND down.depth < 12)
      SELECT id FROM down`;
  const ids = (await db.query(q, [ws, group.id])).rows.map((r) => r.id).filter(Boolean);
  return [...new Set(ids)];
}

export async function readWorkforceRoster(pool, authenticatedContext, value) {
  const { actor, owner, group, window } = rosterInput(authenticatedContext, value);
  return authorityTransaction(pool, async (db) => {
    const reader = await usableReader(db, actor.actorUserId);
    const own = group.kind === 'reports' && reader?.kind === 'human' && reader.id === group.id
      && (await db.query("SELECT 1 FROM workspaces WHERE id = $1 AND status = 'active'", [owner.id])).rowCount === 1;
    if (!reader || (!own && !(await isScopeAdmin(db, reader, owner)))) fail('not_found', 'roster_unavailable');
    await lockApiKeyWorkforceAuthority(db, actor, 'workforce:read');
    const ids = await groupMembers(db, owner.id, group);
    const shown = ids.slice(0, ROSTER_MEMBER_LIMIT);
    const people = new Map((await db.query(`SELECT u.id, COALESCE(NULLIF(u.display_name, ''), u.username) AS name,
        (ai.user_id IS NOT NULL) AS agent FROM users u LEFT JOIN agent_identities ai ON ai.user_id = u.id WHERE u.id = ANY($1::uuid[])`, [shown])).rows.map((r) => [r.id, r]));
    const members = [];
    const big = (v) => BigInt(String(v || '0'));
    const total = { tasksCreated: 0, delegatedToAgents: 0, reviewDecisions: 0, decidedWithinAMinute: 0, done: 0, neverReviewed: 0, closedByAgent: 0, runs: 0, spentMicro: 0n, asAgentMicro: 0n };
    for (const id of shown) {
      const e = await project(db, owner, { kind: 'principal', userId: id }, window, id);
      const row = {
        principalId: id, name: people.get(id)?.name || 'Unknown', kind: people.get(id)?.agent ? 'agent' : 'human',
        tasksCreated: e.tasks.mine.created, delegatedToAgents: e.tasks.mine.delegatedToAgents,
        reviewDecisions: e.tasks.reviews.accepted + e.tasks.reviews.changesRequested, decidedWithinAMinute: e.tasks.reviews.decidedWithinAMinute,
        done: e.tasks.outcomes.done, neverReviewed: e.tasks.outcomes.neverReviewed, closedByAgent: e.tasks.outcomes.closedByAgent,
        runs: e.runs.admitted,
        // one figure, never a sum of both sources (a run's charge is also usage): runs in a workspace, usage in a personal scope
        spentMicro: owner.type === 'user' ? e.spend.paid.micro : e.spend.runs.settledMicro, asAgentMicro: e.spend.asAgent.micro,
      };
      members.push(row);
      for (const k of Object.keys(total)) total[k] = typeof total[k] === 'bigint' ? total[k] + big(row[k]) : total[k] + row[k];
    }
    return {
      schemaVersion: 1, owner, group,
      window: { since: window.since.toISOString(), until: window.until.toISOString() },
      derivedAt: new Date().toISOString(),
      members, total: { ...total, spentMicro: String(total.spentMicro), asAgentMicro: String(total.asAgentMicro) },
      truncated: ids.length > shown.length,
    };
  });
}
