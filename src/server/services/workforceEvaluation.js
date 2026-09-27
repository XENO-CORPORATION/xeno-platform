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
 * THERE IS NO SCORE, and nothing here is written. No single number summarises a subject, because any such
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
 * Contributions (PUB/FUND), reviewer decisions (RUN-06) and settlements linked to a run do not exist, so
 * `notRecorded` names them in every answer. An evaluation that silently omitted them would read as
 * complete; one that estimated them would be the masquerade FUND-12 forbids.
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
export const EVALUATION_NOT_RECORDED = Object.freeze(['contributions', 'reviewerDecisions', 'settlements']);

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

/** An administrator of the scope, or the principal reading itself; anyone else sees nothing. */
async function mayRead(db, actorUserId, owner, subject) {
  const reader = await resolvePrincipal(db, actorUserId);
  if (!reader?.usable || !['human', 'agent'].includes(reader.kind)) return false;
  if (reader.kind === 'agent') {
    const human = await resolvePrincipal(db, reader.owner.id);
    if (!human?.usable || human.kind !== 'human') return false;
  }
  if (subject.kind === 'principal' && subject.userId === reader.id) return true;
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
                  $5::timestamptz AS since, $6::timestamptz AS until, $7::int AS lim),
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
              ELSE o.deciding_principal_id = p.subject OR o.responsible_account_id = p.subject END)
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
  (SELECT count(*)::int FROM dec) > (SELECT lim FROM params) AS decisions_truncated`;

const RUN_STOPS = ['stopped_by_actor', 'stopped_by_target', 'authority_lost'];
const STEP_KINDS = ['privileged_call', 'provider_dispatch'];
const HANDOFF_STATES = ['offered', 'accepted', 'declined', 'expired'];

export async function readWorkforceEvaluation(pool, authenticatedContext, value) {
  const { actor, owner, subject, window } = input(authenticatedContext, value);
  return authorityTransaction(pool, async (db) => {
    if (!(await mayRead(db, actor.actorUserId, owner, subject))) fail('not_found', 'evaluation_unavailable');
    await lockApiKeyWorkforceAuthority(db, actor, 'workforce:read');
    const r = (await db.query(PROJECTION, [owner.type === 'workspace' ? owner.id : null, owner.type === 'user' ? owner.id : null,
      subject.kind, subject.kind === 'agent' ? subject.resourceId : subject.userId, window.since, window.until, EVALUATION_RECORD_LIMIT])).rows[0];
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
        truncated: Boolean(r.admissions_truncated || r.handoffs_truncated || r.decisions_truncated),
      },
      notRecorded: [...EVALUATION_NOT_RECORDED],
    };
  });
}
export { RUN_STOPS, STEP_KINDS, HANDOFF_STATES };
