/**
 * XENO-WORKFORCE-01 RUN-04 -- a child's result, its explicit interruption, and its delivery to its parent.
 *
 *   RUN-04: "Children inherit a subset of the parent's authorized context, not all memberships or
 *            credentials. Persist parent/task/session IDs, results, artifacts, delivery receipts and
 *            explicit interrupted state. Result delivery is idempotent to the correct parent."
 *
 * Three acts, over 20260927120000-workforce-run-results.sql:
 *
 *   reportRunResult    the runtime reports what a run produced: completed, failed, or INTERRUPTED with a
 *                      closed reason (RUN-07's: budget_exhausted, stopped, authority_lost, uncertain, blocked),
 *                      a summary and artifact references. Once per run; a repeat of the same report returns
 *                      the same record, a different one conflicts. A run already delivered takes no report.
 *   deliverRunResult   hands a child's outcome to ITS parent, once. The receipt is keyed by the child, so a
 *                      retry returns the same receipt, and the parent is read from the child's own edge, so
 *                      it cannot be delivered anywhere else. An unreported child whose chain was stopped is
 *                      delivered as interrupted, for the stop's reason -- the parent is never left waiting on
 *                      a run that will not report, and never told it finished.
 *   readRunOutcome     the run's parent, task and session ids; its result, or its interruption derived from a
 *                      fence, or `running`; and its delivery receipt.
 *
 * Only the admitted actor on the admitted client acts on a run -- the same rule as its steps (RUN-03) --
 * and anyone else is told the run does not exist. A report is metadata: artifact CONTENT is never stored
 * here, only references to where it lives.
 */
import { createHash } from 'node:crypto';
import { authorityTransaction } from './workspaceOperationReceipts.js';
import { lockApiKeyWorkforceAuthority } from './apiKeyWorkforceAuthority.js';

export class RunResultError extends Error {
  constructor(code, reason, extra = {}) {
    super(reason);
    this.name = 'RunResultError';
    this.code = code;
    this.status = { bad_input: 400, denied: 403, not_found: 404, conflict: 409 }[code] ?? 500;
    this.details = Object.freeze({ schemaVersion: 1, reason, ...extra });
  }
}
const fail = (code, reason, extra) => { throw new RunResultError(code, reason, extra); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASONS = ['budget_exhausted', 'stopped', 'authority_lost', 'uncertain', 'blocked'];
const OUTCOMES = ['completed', 'failed', 'interrupted'];
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
const canonical = (value) => JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));

function parseReport(value) {
  const input = record(value, ['admissionId', 'outcome', 'interruptedReason', 'summary', 'artifacts'], 'request');
  if (!OUTCOMES.includes(input.outcome)) fail('bad_input', 'invalid_outcome');
  const interrupted = input.outcome === 'interrupted';
  if (interrupted !== (input.interruptedReason !== undefined && input.interruptedReason !== null)) fail('bad_input', 'interrupted_reason_mismatch');
  if (interrupted && !REASONS.includes(input.interruptedReason)) fail('bad_input', 'invalid_interrupted_reason');
  const summary = input.summary ?? '';
  if (typeof summary !== 'string' || Buffer.byteLength(summary, 'utf8') > 16384 || summary.includes('\0')) fail('bad_input', 'invalid_summary');
  const artifacts = input.artifacts ?? [];
  if (!Array.isArray(artifacts) || artifacts.length > 64) fail('bad_input', 'invalid_artifacts');
  const seen = new Set();
  const refs = artifacts.map((a) => {
    const art = record(a, ['name', 'ref', 'sha256'], 'artifact');
    if (typeof art.name !== 'string' || !/^[^\0]{1,200}$/.test(art.name)) fail('bad_input', 'invalid_artifact');
    // A reference: an opaque id or a URL-like locator. Content is refused by shape: bounded, one line.
    if (typeof art.ref !== 'string' || art.ref.length > 2048 || !/^[A-Za-z0-9][A-Za-z0-9._:/@+#?=&%~-]*$/.test(art.ref)) fail('bad_input', 'invalid_artifact_ref');
    if (art.sha256 !== undefined && (typeof art.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(art.sha256))) fail('bad_input', 'invalid_artifact_hash');
    if (seen.has(art.name)) fail('bad_input', 'duplicate_artifact');
    seen.add(art.name);
    return { name: art.name, ref: art.ref, ...(art.sha256 ? { sha256: art.sha256 } : {}) };
  });
  return { admissionId: uuid(input.admissionId, 'admission'), outcome: input.outcome,
    interruptedReason: interrupted ? input.interruptedReason : null, summary, artifacts: refs };
}

/** The run, when the actor may act on it: its admitted actor on its admitted client. Otherwise it does not exist. */
async function ownRun(db, actor, admissionId, lock = '') {
  const row = (await db.query(`SELECT * FROM workforce_run_admissions WHERE id=$1 ${lock}`, [admissionId])).rows[0];
  if (!row || row.actor_user_id !== actor.actorUserId || row.client_id !== actor.clientId) fail('not_found', 'admission_not_found');
  return row;
}

function publicResult(row) {
  return row ? { outcome: row.outcome, interruptedReason: row.interrupted_reason, summary: row.summary, artifacts: row.artifacts,
    reportedAt: row.reported_at.toISOString() } : null;
}
function publicDelivery(row) {
  return row ? { childAdmissionId: row.child_admission_id, parentAdmissionId: row.parent_admission_id, outcome: row.delivered_outcome,
    interruptedReason: row.delivered_reason, deliveredAt: row.delivered_at.toISOString() } : null;
}

export async function reportRunResult(pool, authenticatedContext, value) {
  const actor = actorOf(authenticatedContext);
  const report = parseReport(value);
  const reportHash = createHash('sha256').update(canonical({ outcome: report.outcome, interruptedReason: report.interruptedReason,
    summary: report.summary, artifacts: report.artifacts })).digest('hex');
  return authorityTransaction(pool, async (db) => {
    await ownRun(db, actor, report.admissionId);
    await lockApiKeyWorkforceAuthority(db, actor, 'workforce:manage');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`run-outcome:${report.admissionId}`]);
    const prior = (await db.query('SELECT * FROM workforce_run_results WHERE admission_id=$1', [report.admissionId])).rows[0];
    if (prior) {
      if (prior.report_hash !== reportHash) fail('conflict', 'result_already_reported');
      return { replayed: true, result: publicResult(prior) };
    }
    if ((await db.query('SELECT 1 FROM workforce_run_result_deliveries WHERE child_admission_id=$1', [report.admissionId])).rowCount) {
      fail('conflict', 'result_already_delivered');
    }
    const row = (await db.query(`INSERT INTO workforce_run_results(admission_id,outcome,interrupted_reason,summary,artifacts,report_hash,reported_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [report.admissionId, report.outcome, report.interruptedReason, report.summary,
      JSON.stringify(report.artifacts), reportHash, actor.actorUserId])).rows[0];
    return { replayed: false, result: publicResult(row) };
  });
}

/** What a run's fence says about it: interrupted, for the fence's reason -- or null if nothing fences it. */
async function fenceOutcome(db, admissionId) {
  const f = (await db.query(`SELECT r.admission_id, r.reason FROM workforce_run_revocations r
     WHERE r.admission_id = workforce_run_admission_fence($1)`, [admissionId])).rows[0];
  return f ? { outcome: 'interrupted', interruptedReason: f.reason === 'authority_lost' ? 'authority_lost' : 'stopped', fencedBy: f.admission_id } : null;
}

export async function deliverRunResult(pool, authenticatedContext, value) {
  const actor = actorOf(authenticatedContext);
  const input = record(value, ['childAdmissionId', 'parentAdmissionId'], 'request');
  const childId = uuid(input.childAdmissionId, 'child_admission');
  const parentId = uuid(input.parentAdmissionId, 'parent_admission');
  return authorityTransaction(pool, async (db) => {
    const child = await ownRun(db, actor, childId, 'FOR KEY SHARE');
    await lockApiKeyWorkforceAuthority(db, actor, 'workforce:manage');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`run-outcome:${childId}`]);
    // "To the correct parent": the parent asked for must be the child's own. Asked for another, the answer is
    // a conflict naming the rule -- the actor admitted both runs, so there is nothing to hide from them.
    if (!child.parent_admission_id) fail('conflict', 'run_has_no_parent');
    if (child.parent_admission_id !== parentId) fail('conflict', 'not_this_runs_parent');
    const prior = (await db.query('SELECT * FROM workforce_run_result_deliveries WHERE child_admission_id=$1', [childId])).rows[0];
    if (prior) return { replayed: true, delivery: publicDelivery(prior) };
    const res = (await db.query('SELECT * FROM workforce_run_results WHERE admission_id=$1', [childId])).rows[0];
    const outcome = res ? { outcome: res.outcome, interruptedReason: res.interrupted_reason } : await fenceOutcome(db, childId);
    if (!outcome) fail('conflict', 'result_not_ready');
    const row = (await db.query(`INSERT INTO workforce_run_result_deliveries(child_admission_id,parent_admission_id,delivered_outcome,delivered_reason,delivered_by_user_id)
      VALUES($1,$2,$3,$4,$5) RETURNING *`, [childId, parentId, outcome.outcome, outcome.interruptedReason, actor.actorUserId])).rows[0];
    return { replayed: false, delivery: publicDelivery(row) };
  });
}

export async function readRunOutcome(pool, authenticatedContext, value) {
  const actor = actorOf(authenticatedContext);
  const input = record(value, ['admissionId'], 'request');
  const admissionId = uuid(input.admissionId, 'admission');
  return authorityTransaction(pool, async (db) => {
    const run = await ownRun(db, actor, admissionId);
    await lockApiKeyWorkforceAuthority(db, actor, 'workforce:read');
    const res = (await db.query('SELECT * FROM workforce_run_results WHERE admission_id=$1', [admissionId])).rows[0];
    const fence = res ? null : await fenceOutcome(db, admissionId);
    const delivery = (await db.query('SELECT * FROM workforce_run_result_deliveries WHERE child_admission_id=$1', [admissionId])).rows[0];
    const children = (await db.query(`SELECT a.id, d.child_admission_id IS NOT NULL AS delivered FROM workforce_run_admissions a
      LEFT JOIN workforce_run_result_deliveries d ON d.child_admission_id = a.id WHERE a.parent_admission_id=$1 ORDER BY a.admitted_at, a.id`, [admissionId])).rows;
    return {
      schemaVersion: 1, admissionId,
      parentAdmissionId: run.parent_admission_id, taskRef: run.task_ref, conversationId: run.conversation_id,
      state: res ? res.outcome : fence ? 'interrupted' : 'running',
      result: publicResult(res),
      interruption: res ? null : fence && { reason: fence.interruptedReason, derivedFrom: 'fence', fencedByAdmissionId: fence.fencedBy },
      delivery: publicDelivery(delivery),
      children: children.map((c) => ({ admissionId: c.id, delivered: c.delivered })),
    };
  });
}
