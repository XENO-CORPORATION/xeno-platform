/**
 * XENO workforce compensation (owner, 2026-10-29: "Agreements + credits, a person approves").
 * Tables: database/migrations/20261102190000-workforce-compensation.sql. Spec D13: nothing pays implicitly.
 *
 *   setAgreement     an admin records how a member is paid (it ENDS their previous agreement)
 *   endAgreement     an admin ends one
 *   listAgreements   an admin sees all; a member sees their own
 *   preparePayouts   an admin prepares one period's payouts from each active agreement and the member's work
 *                    report (workforceEvaluation's own projection, never a second count)
 *   decidePayout     an admin APPROVES (optionally with an edited amount) or SKIPS one; approving pays it
 *   listPayouts      an admin sees all; a member sees their own
 *   exportCsv        agreements (salaries included) and payouts for a period, for a payroll provider
 *
 * Rules held twice (here, and by the tables' triggers): only a PERSON sets agreements or decides payouts, never
 * an agent; a decided payout is fixed; nothing is deleted. The counts PREPARE a payout and never decide it.
 *
 * Money: credits move from the WORKSPACE wallet to the payee over the existing ledger -- recordUsageV2 debits
 * the workspace (idempotent on its transaction id), then ONE transaction credits the payee with a paid grant
 * and marks the payout paid, skipping the grant if one with the same source_ref exists. Both are keyed
 * `ws-comp:<payout id>`, so a retry after a crash pays exactly once. An agent's payout goes to its owner.
 */
import { authorityTransaction } from './workspaceOperationReceipts.js';
import { projectEvaluation, usableReader, isScopeAdmin } from './workforceEvaluation.js';
import { recordUsageV2, addGrantTx } from '../utils/creditLedgerV2.js';

export class CompensationError extends Error {
  constructor(code, reason) {
    super(reason); this.name = 'CompensationError'; this.code = code;
    this.status = { bad_input: 400, not_found: 404, conflict: 409, insufficient: 402 }[code] ?? 500;
    this.details = { schemaVersion: 1, reason };
  }
}
const fail = (code, reason) => { throw new CompensationError(code, reason); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v, what = 'id') => { if (typeof v !== 'string' || !UUID.test(v)) fail('bad_input', `invalid_${what}`); return v.toLowerCase(); };
const day = (v, what) => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(`${v}T00:00:00Z`))) fail('bad_input', `invalid_${what}`); return v; };
const micro = (v) => { if (typeof v !== 'string' || !/^[1-9]\d{0,17}$/.test(v)) fail('bad_input', 'invalid_amount'); return v; };
const only = (v, keys) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('bad_input', 'invalid_shape');
  for (const k of Object.keys(v)) if (!keys.includes(k)) fail('bad_input', 'unexpected_field');
  return v;
};
const BASES = ['per_period', 'per_accepted_task', 'revenue_share', 'salary_recorded'];

/** A human administrator of the workspace -- the only one who sets pay or decides a payout. */
async function admin(db, actorUserId, workspaceId) {
  const reader = await usableReader(db, actorUserId);
  if (!reader || reader.kind !== 'human' || !(await isScopeAdmin(db, reader, { type: 'workspace', id: workspaceId }))) fail('not_found', 'compensation_unavailable');
  return reader;
}
async function memberOf(db, workspaceId, principalId) {
  const r = (await db.query(`SELECT u.id, ai.owner_user_id AS agent_owner FROM users u LEFT JOIN agent_identities ai ON ai.user_id = u.id
     WHERE u.id = $1::uuid AND (EXISTS (SELECT 1 FROM relationship_tuples t WHERE t.object_type = 'workspace' AND t.object_id::text = $2::text
       AND t.subject_id::text = $1::text) OR EXISTS (SELECT 1 FROM workforce_employee_profiles p WHERE p.workspace_id = $2::uuid AND p.principal_id = $1::uuid))`,
  [principalId, workspaceId])).rows[0];
  if (!r) fail('not_found', 'member_unavailable');
  return { id: r.id, payee: r.agent_owner || r.id, agent: Boolean(r.agent_owner) };
}
// node-postgres parses a DATE as LOCAL midnight; toISOString() would shift it a day east of UTC. Read its own parts.
const ymd = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d);
const agreementOut = (a) => ({ id: a.id, workspaceId: a.workspace_id, principalId: a.principal_id, basis: a.basis,
  amountMicro: a.amount_micro == null ? null : String(a.amount_micro), shareBps: a.share_bps,
  salary: a.salary_minor == null ? null : { amountMinor: String(a.salary_minor), currency: a.salary_currency },
  period: a.period, startsOn: ymd(a.starts_on), note: a.note,
  state: a.state, endedOn: ymd(a.ended_on), createdAt: a.created_at });
const payoutOut = (p) => ({ id: p.id, workspaceId: p.workspace_id, agreementId: p.agreement_id, principalId: p.principal_id, payeeUserId: p.payee_user_id,
  periodStart: ymd(p.period_start), periodEnd: ymd(p.period_end), evidence: p.evidence, preparedMicro: String(p.prepared_micro), amountMicro: String(p.amount_micro),
  state: p.state, decidedBy: p.decided_by_user_id, decidedAt: p.decided_at, decisionNote: p.decision_note, paidAt: p.paid_at });

export async function setAgreement(pool, ctx, value) {
  const v = only(value, ['workspaceId', 'principalId', 'basis', 'amountMicro', 'shareBps', 'salary', 'period', 'startsOn', 'note']);
  const ws = id(v.workspaceId, 'workspace'), pid = id(v.principalId, 'principal');
  if (!BASES.includes(v.basis)) fail('bad_input', 'invalid_basis');
  const amount = ['per_period', 'per_accepted_task'].includes(v.basis) ? micro(v.amountMicro) : (v.amountMicro == null ? null : fail('bad_input', 'amount_not_for_basis'));
  const share = v.basis === 'revenue_share' ? (Number.isInteger(v.shareBps) && v.shareBps >= 1 && v.shareBps <= 10000 ? v.shareBps : fail('bad_input', 'invalid_share')) : (v.shareBps == null ? null : fail('bad_input', 'share_not_for_basis'));
  let salary = null;
  if (v.basis === 'salary_recorded') {
    const s = only(v.salary, ['amountMinor', 'currency']);
    if (typeof s.amountMinor !== 'string' || !/^[1-9]\d{0,14}$/.test(s.amountMinor) || typeof s.currency !== 'string' || !/^[A-Z]{3}$/.test(s.currency)) fail('bad_input', 'invalid_salary');
    salary = s;
  } else if (v.salary != null) fail('bad_input', 'salary_not_for_basis');
  const period = v.period == null ? 'month' : ['week', 'month'].includes(v.period) ? v.period : fail('bad_input', 'invalid_period');
  const startsOn = day(v.startsOn, 'start');
  const note = v.note == null ? '' : typeof v.note === 'string' && v.note.length <= 500 ? v.note : fail('bad_input', 'invalid_note');
  return authorityTransaction(pool, async (db) => {
    const me = await admin(db, ctx.actorUserId, ws);
    await memberOf(db, ws, pid);
    await db.query(`UPDATE workforce_comp_agreements SET state='ended', ended_on=current_date, ended_by_user_id=$3
      WHERE workspace_id=$1 AND principal_id=$2 AND state='active'`, [ws, pid, me.id]);
    const a = (await db.query(`INSERT INTO workforce_comp_agreements(workspace_id,principal_id,basis,amount_micro,share_bps,salary_minor,salary_currency,period,starts_on,note,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [ws, pid, v.basis, amount, share, salary?.amountMinor ?? null, salary?.currency ?? null, period, startsOn, note, me.id])).rows[0];
    return { agreement: agreementOut(a) };
  });
}

export async function endAgreement(pool, ctx, value) {
  const v = only(value, ['workspaceId', 'agreementId']);
  const ws = id(v.workspaceId, 'workspace'), aid = id(v.agreementId, 'agreement');
  return authorityTransaction(pool, async (db) => {
    const me = await admin(db, ctx.actorUserId, ws);
    const a = (await db.query(`UPDATE workforce_comp_agreements SET state='ended', ended_on=current_date, ended_by_user_id=$3
      WHERE id=$1 AND workspace_id=$2 AND state='active' RETURNING *`, [aid, ws, me.id])).rows[0];
    if (!a) fail('not_found', 'agreement_unavailable');
    return { agreement: agreementOut(a) };
  });
}

/** An admin sees the workspace's; anyone else, only their own. */
async function readerScope(db, actorUserId, ws) {
  const reader = await usableReader(db, actorUserId);
  if (!reader || reader.kind !== 'human') fail('not_found', 'compensation_unavailable');
  const isAdmin = await isScopeAdmin(db, reader, { type: 'workspace', id: ws });
  if (!isAdmin && !(await db.query("SELECT 1 FROM workspaces WHERE id=$1 AND status='active'", [ws])).rowCount) fail('not_found', 'compensation_unavailable');
  return { reader, isAdmin };
}

export async function listAgreements(pool, ctx, value) {
  const v = only(value, ['workspaceId']);
  const ws = id(v.workspaceId, 'workspace');
  return authorityTransaction(pool, async (db) => {
    const { reader, isAdmin } = await readerScope(db, ctx.actorUserId, ws);
    const rows = (await db.query(`SELECT * FROM workforce_comp_agreements WHERE workspace_id=$1 ${isAdmin ? '' : 'AND principal_id=$2'}
      ORDER BY state, created_at DESC LIMIT 500`, isAdmin ? [ws] : [ws, reader.id])).rows;
    return { canManage: isAdmin, agreements: rows.map(agreementOut) };
  });
}

/** Period bounds: a month or a week starting on `periodStart` (YYYY-MM-DD). */
function periodEnd(start, period) {
  const d = new Date(`${start}T00:00:00Z`);
  if (period === 'week') d.setUTCDate(d.getUTCDate() + 7); else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export async function preparePayouts(pool, ctx, value) {
  const v = only(value, ['workspaceId', 'periodStart', 'period']);
  const ws = id(v.workspaceId, 'workspace'), start = day(v.periodStart, 'period');
  const period = v.period == null ? 'month' : ['week', 'month'].includes(v.period) ? v.period : fail('bad_input', 'invalid_period');
  const end = periodEnd(start, period);
  if (Date.parse(`${end}T00:00:00Z`) > Date.now()) fail('bad_input', 'period_not_over');
  return authorityTransaction(pool, async (db) => {
    const me = await admin(db, ctx.actorUserId, ws);
    const agreements = (await db.query(`SELECT * FROM workforce_comp_agreements WHERE workspace_id=$1 AND state='active' AND period=$2
      AND basis IN ('per_period','per_accepted_task','revenue_share') AND starts_on < $3 ORDER BY created_at`, [ws, period, end])).rows;
    const prepared = [], existing = [];
    for (const a of agreements) {
      const done = (await db.query('SELECT * FROM workforce_comp_payouts WHERE agreement_id=$1 AND period_start=$2 AND period_end=$3', [a.id, start, end])).rows[0];
      if (done) { existing.push(payoutOut(done)); continue; }
      const m = await memberOf(db, ws, a.principal_id).catch(() => null);
      if (!m) continue;
      // the member's own work report for the period: the counts the payout is prepared from
      const e = await projectEvaluation(db, { type: 'workspace', id: ws }, { kind: 'principal', userId: a.principal_id },
        { since: new Date(`${start}T00:00:00Z`), until: new Date(`${end}T00:00:00Z`) }, a.principal_id);
      const accepted = e.tasks.outcomes.acceptedByHuman;
      const amount = a.basis === 'per_period' ? BigInt(a.amount_micro)
        : a.basis === 'per_accepted_task' ? BigInt(a.amount_micro) * BigInt(accepted)
          : 0n; // revenue_share: no revenue a member earns a workspace is recorded yet -- prepared at zero, and it says so
      const evidence = { basis: a.basis, acceptedByHuman: accepted, done: e.tasks.outcomes.done, neverReviewed: e.tasks.outcomes.neverReviewed,
        taskIds: e.records.tasks, ...(a.basis === 'revenue_share' ? { revenueRecorded: false } : {}), derivedAt: e.derivedAt };
      const p = (await db.query(`INSERT INTO workforce_comp_payouts(workspace_id,agreement_id,principal_id,payee_user_id,period_start,period_end,evidence,prepared_micro,amount_micro,prepared_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING *`, [ws, a.id, a.principal_id, m.payee, start, end, JSON.stringify(evidence), amount.toString(), me.id])).rows[0];
      prepared.push(payoutOut(p));
    }
    return { periodStart: start, periodEnd: end, prepared, existing };
  });
}

export async function listPayouts(pool, ctx, value) {
  const v = only(value, ['workspaceId', 'state']);
  const ws = id(v.workspaceId, 'workspace');
  if (v.state != null && !['prepared', 'approved', 'paid', 'skipped'].includes(v.state)) fail('bad_input', 'invalid_state');
  return authorityTransaction(pool, async (db) => {
    const { reader, isAdmin } = await readerScope(db, ctx.actorUserId, ws);
    const args = [ws]; let where = 'workspace_id=$1';
    if (!isAdmin) { args.push(reader.id); where += ` AND (principal_id=$${args.length} OR payee_user_id=$${args.length})`; }
    if (v.state) { args.push(v.state); where += ` AND state=$${args.length}`; }
    const rows = (await db.query(`SELECT * FROM workforce_comp_payouts WHERE ${where} ORDER BY period_start DESC, created_at DESC LIMIT 500`, args)).rows;
    return { canManage: isAdmin, payouts: rows.map(payoutOut) };
  });
}

export async function decidePayout(pool, ctx, value) {
  const v = only(value, ['workspaceId', 'payoutId', 'decision', 'amountMicro', 'note']);
  const ws = id(v.workspaceId, 'workspace'), pid = id(v.payoutId, 'payout');
  if (!['approve', 'skip'].includes(v.decision)) fail('bad_input', 'invalid_decision');
  const edited = v.amountMicro == null ? null : (v.amountMicro === '0' ? '0' : micro(v.amountMicro));
  const note = v.note == null ? '' : typeof v.note === 'string' && v.note.length <= 500 ? v.note : fail('bad_input', 'invalid_note');
  // 1) the decision, by a person
  const decided = await authorityTransaction(pool, async (db) => {
    const me = await admin(db, ctx.actorUserId, ws);
    const p = (await db.query('SELECT * FROM workforce_comp_payouts WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [pid, ws])).rows[0];
    if (!p) fail('not_found', 'payout_unavailable');
    if (p.state !== 'prepared') return { payout: p, replay: true };
    const state = v.decision === 'skip' ? 'skipped' : 'approved';
    const amount = edited ?? String(p.amount_micro);
    if (state === 'approved' && amount === '0') fail('bad_input', 'nothing_to_pay');
    const row = (await db.query(`UPDATE workforce_comp_payouts SET state=$2, amount_micro=$3, decided_by_user_id=$4, decided_at=now(), decision_note=$5
      WHERE id=$1 RETURNING *`, [pid, state, amount, me.id, note])).rows[0];
    return { payout: row, replay: false };
  });
  if (decided.payout.state !== 'approved') return { payout: payoutOut(decided.payout), replayed: decided.replay };
  return payApproved(pool, decided.payout);
}

/** Pay an APPROVED payout: debit the workspace wallet, then credit the payee and mark it paid in one
 * transaction. Both halves are keyed `ws-comp:<id>`, so calling this again (a retry) pays once. */
export async function payApproved(pool, p) {
  const ref = `ws-comp:${p.id}`, amount = BigInt(p.amount_micro);
  try {
    await recordUsageV2(pool, p.workspace_id, { surface: 'workspace', operation: 'compensation-out', transactionId: ref, costMicro: Number(amount),
      dimensions: { payout_id: p.id } });
  } catch (e) {
    if (e.code === 'INSUFFICIENT_CREDITS') fail('insufficient', 'workspace_wallet_insufficient');
    throw e;
  }
  const paid = await authorityTransaction(pool, async (db) => {
    const row = (await db.query('SELECT * FROM workforce_comp_payouts WHERE id=$1 FOR UPDATE', [p.id])).rows[0];
    if (row.state === 'paid') return row;
    const granted = (await db.query('SELECT 1 FROM credit_grants WHERE user_id=$1 AND source_ref=$2', [row.payee_user_id, ref])).rowCount;
    if (!granted) {
      await db.query(`INSERT INTO credit_accounts(user_id,owner_kind,balance) VALUES($1,'user',0) ON CONFLICT(user_id) DO NOTHING`, [row.payee_user_id]);
      await addGrantTx(db, row.payee_user_id, { amountMicro: Number(amount), kind: 'paid', sourceRef: ref });
    }
    return (await db.query("UPDATE workforce_comp_payouts SET state='paid', paid_at=now() WHERE id=$1 RETURNING *", [p.id])).rows[0];
  });
  return { payout: payoutOut(paid), replayed: false };
}

/** Agreements (salaries included) and the payouts of one period, as CSV for a payroll provider. */
export async function exportCsv(pool, ctx, value) {
  const v = only(value, ['workspaceId', 'periodStart', 'period']);
  const ws = id(v.workspaceId, 'workspace'), start = day(v.periodStart, 'period');
  const end = periodEnd(start, v.period === 'week' ? 'week' : 'month');
  return authorityTransaction(pool, async (db) => {
    await admin(db, ctx.actorUserId, ws);
    const rows = (await db.query(`SELECT a.principal_id, COALESCE(NULLIF(u.display_name,''), u.username) AS name, (ai.user_id IS NOT NULL) AS agent,
        a.basis, a.amount_micro, a.share_bps, a.salary_minor, a.salary_currency, a.period, a.starts_on,
        p.state AS payout_state, p.amount_micro AS payout_micro, p.paid_at
      FROM workforce_comp_agreements a JOIN users u ON u.id = a.principal_id LEFT JOIN agent_identities ai ON ai.user_id = a.principal_id
      LEFT JOIN workforce_comp_payouts p ON p.agreement_id = a.id AND p.period_start = $2 AND p.period_end = $3
      WHERE a.workspace_id = $1 AND a.starts_on < $3 AND (a.state = 'active' OR a.ended_on >= $2) ORDER BY name`, [ws, start, end])).rows;
    const cell = (x) => { const s = x == null ? '' : String(x); return /[",\n\r]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${(/^[=+\-@\t]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
    const credits = (m) => (m == null ? '' : (Number(BigInt(m) / 10000n) / 100).toFixed(2));
    const head = ['principal_id', 'name', 'kind', 'basis', 'credits_per_unit', 'revenue_share_percent', 'salary', 'salary_currency', 'period', 'starts_on', 'payout_state', 'payout_credits', 'paid_at'];
    const lines = rows.map((r) => [r.principal_id, r.name, r.agent ? 'agent' : 'person', r.basis, credits(r.amount_micro), r.share_bps == null ? '' : (r.share_bps / 100).toFixed(2),
      r.salary_minor == null ? '' : (Number(r.salary_minor) / 100).toFixed(2), r.salary_currency || '', r.period, ymd(r.starts_on), r.payout_state || '', credits(r.payout_micro), r.paid_at ? new Date(r.paid_at).toISOString() : ''].map(cell).join(','));
    return { filename: `compensation-${start}.csv`, csv: [head.join(','), ...lines].join('\r\n') + '\r\n' };
  });
}
