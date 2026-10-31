/**
 * divisionAgentBudget.js — a division's AGENT budget (DIV-07): a cap on what the division's agents spend, never a
 * wallet. Every agent spend reserves its maximum here under the division's lock (agentMedia.js calls reserve/release);
 * the division page reads and sets it. Kept apart from agentMedia.js so the workforce code that mounts the division
 * page imports nothing but the database (NFR-09: the workforce graph stays in-process, no billing/email clients).
 */
import { check } from '../utils/authzReBAC.js';

export class BudgetError extends Error { constructor(message, code, status = 400) { super(message); this.name = 'BudgetError'; this.code = code; this.status = status; } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MICRO_PER_CREDIT = 1_000_000;   // the ledger's unit (creditLedgerV2.MICRO_PER_CREDIT), restated to keep this file import-free
const credits = (micro) => Math.round(Number(micro) / MICRO_PER_CREDIT * 100) / 100;

// ───────────────────────────── the division budget

/** A division's agent budget and what its agents spent in the current window (null when it has none). */
export async function budgetOf(db, divisionId) {
  if (!divisionId) return null;
  const b = (await db.query('SELECT * FROM division_agent_budgets WHERE division_id = $1', [divisionId])).rows[0];
  if (!b) return null;
  const spent = (await db.query(`SELECT COALESCE(sum(amount_micro), 0)::text AS s FROM agent_spend_log
    WHERE division_id = $1 AND state = 'reserved' AND created_at > now() - make_interval(days => $2)`, [divisionId, b.window_days])).rows[0].s;
  return { limitMicro: BigInt(b.limit_micro), spentMicro: BigInt(spent), windowDays: b.window_days, autoApprove: b.auto_approve,
    view: { limitCredits: credits(b.limit_micro), spentCredits: credits(spent), leftCredits: Math.max(0, credits(BigInt(b.limit_micro) - BigInt(spent))), windowDays: b.window_days, autoApprove: b.auto_approve, updatedAt: b.updated_at } };
}

/**
 * Reserve `amountMicro` of the agent's division budget for one spend, or refuse. Serialised per division by an
 * advisory lock, so two concurrent spends cannot both fit into the last of a budget. An agent in no division, or
 * in one without a budget, is not limited here (its owner's wallet and quota still are).
 */
export async function reserve(tx, agent, { kind, ref, amountMicro }) {
  if (agent.divisionId) await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`division-agent-budget:${agent.divisionId}`]);
  const b = await budgetOf(tx, agent.divisionId);
  if (b && b.spentMicro + BigInt(amountMicro) > b.limitMicro) {
    throw new BudgetError(`${agent.divisionName} has used its agent budget for this period (${b.view.spentCredits} of ${b.view.limitCredits} credits). A workspace admin can raise it on the division's page.`, 'division_budget_exhausted', 402);
  }
  // the agent's own cap (agent page), checked under its own lock so two spends cannot both fit into its last credits
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`agent-spend-cap:${agent.id}`]);
  const cap = await capOf(tx, agent.id);
  if (cap && cap.spentMicro + BigInt(amountMicro) > cap.limitMicro) {
    throw new BudgetError(`This agent has reached the spending cap its owner set (${cap.view.spentCredits} of ${cap.view.limitCredits} credits in the last ${CAP_WINDOW_DAYS} days). Its owner can raise it on the agent's page.`, 'agent_cap_reached', 402);
  }
  const id = (await tx.query(`INSERT INTO agent_spend_log (agent_user_id, division_id, payer_user_id, kind, ref, amount_micro)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [agent.id, agent.divisionId, agent.ownerId, kind, ref ? String(ref).slice(0, 200) : null, String(amountMicro)])).rows[0].id;
  return { id, budget: b };
}
// ───────────────────────────── one agent's own cap (the agent page)

export const CAP_WINDOW_DAYS = 30;
/** What one agent spent through XENO tools in the last 30 days, against the cap its owner set (null when none). */
export async function capOf(db, agentUserId) {
  const c = (await db.query('SELECT limit_micro, updated_at FROM agent_spend_caps WHERE agent_user_id = $1', [agentUserId])).rows[0];
  if (!c) return null;
  const spent = (await db.query(`SELECT COALESCE(sum(amount_micro), 0)::text AS s FROM agent_spend_log
    WHERE agent_user_id = $1 AND state = 'reserved' AND created_at > now() - make_interval(days => $2)`, [agentUserId, CAP_WINDOW_DAYS])).rows[0].s;
  return { limitMicro: BigInt(c.limit_micro), spentMicro: BigInt(spent),
    view: { limitCredits: credits(c.limit_micro), spentCredits: credits(spent), leftCredits: Math.max(0, credits(BigInt(c.limit_micro) - BigInt(spent))), windowDays: CAP_WINDOW_DAYS, updatedAt: c.updated_at } };
}

export async function release(db, spendId) {
  await db.query(`UPDATE agent_spend_log SET state = 'released' WHERE id = $1 AND state = 'reserved'`, [spendId]);
}

// ───────────────────────────── the division page: set and read the budget

export async function setBudget(db, me, divisionId, { credits: c, windowDays = 30, autoApprove = false } = {}) {
  if (!me || me.kind !== 'human') throw new BudgetError('Only a person sets a budget', 'not_allowed', 403);
  if (!UUID.test(String(divisionId || ''))) throw new BudgetError('Division not found', 'division_not_found', 404);
  const d = (await db.query('SELECT workspace_id FROM workforce_divisions WHERE id = $1', [divisionId])).rows[0];
  if (!d) throw new BudgetError('Division not found', 'division_not_found', 404);
  const admin = (await check(db, { object: `workspace:${d.workspace_id}`, relation: 'admin', subject: `user:${me.id}` })).allowed;
  if (!admin) throw new BudgetError('Only a workspace admin sets a division’s budget', 'not_allowed', 403);
  if (c === undefined) throw new BudgetError('Give the budget in credits, or null to remove it', 'invalid_budget');
  if (c === null) { await db.query('DELETE FROM division_agent_budgets WHERE division_id = $1', [divisionId]); return null; }
  const n = Number(c), w = Number(windowDays);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new BudgetError('The budget is between 0 and 10,000,000 credits', 'invalid_budget');
  if (!Number.isInteger(w) || w < 1 || w > 366) throw new BudgetError('The period is between 1 and 366 days', 'invalid_window');
  await db.query(`INSERT INTO division_agent_budgets (division_id, limit_micro, window_days, auto_approve, set_by_user_id, updated_at) VALUES ($1, $2, $3, $4, $5, now())
    ON CONFLICT (division_id) DO UPDATE SET limit_micro = EXCLUDED.limit_micro, window_days = EXCLUDED.window_days, auto_approve = EXCLUDED.auto_approve,
      set_by_user_id = EXCLUDED.set_by_user_id, updated_at = now()`, [divisionId, String(Math.round(n * MICRO_PER_CREDIT)), w, autoApprove === true, me.id]);
  return (await budgetOf(db, divisionId)).view;
}

/** Recent agent spending in a division, newest first, for its page. */
export async function divisionSpend(db, divisionId, { limit = 30 } = {}) {
  return (await db.query(`SELECT l.kind, l.ref, l.amount_micro, l.state, l.created_at, ai.public_id, COALESCE(u.display_name, u.username) AS agent_name
      FROM agent_spend_log l JOIN agent_identities ai ON ai.user_id = l.agent_user_id JOIN users u ON u.id = l.agent_user_id
      WHERE l.division_id = $1 AND NOT (l.kind = 'model' AND l.ref NOT LIKE '%:actual') ORDER BY l.created_at DESC LIMIT $2`, [divisionId, limit])).rows
    .map((r) => ({ agent: { id: r.public_id, name: r.agent_name }, kind: r.kind, credits: credits(r.amount_micro), released: r.state === 'released', at: r.created_at }));
}
