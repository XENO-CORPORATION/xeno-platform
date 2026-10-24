/**
 * agentOverview.js — the agent page's Overview in one read, and the three controls that page gives a person
 * (owner, 2026-10-24: "redesign properly the interface … then we will need to update the platform").
 *
 * Every value comes from a record the platform already writes; nothing is estimated or made up:
 *   presence   — agentPresence.presenceOf (status, the task it is on and its last reported note, its question)
 *   needsYou   — its open questions, its work waiting for review, credentials about to expire, its cap nearly spent
 *   spend      — agent_spend_log (images, video and model calls through XENO tools), per day, against its own cap.
 *                A cloud run is billed by its own per-run budget and is NOT in this number; the page says so.
 *   groups     — its activity with XENO tool calls folded into bursts (one line per sitting, not one per call)
 *   versions   — how each version of its instructions worked out, from the cloud runs that pinned it. Work done
 *                from a CLI does not record which version it ran, so it is not counted (and the page says so).
 * Controls: message (a comment on the task it is on, which reaches it as a task event), pause / resume one place it
 * runs (one MCP connection; enforced in xenoMcpRoutes.callerOf), and its spending cap (enforced in
 * divisionAgentBudget.reserve, where every such spend is reserved).
 */
import * as agents from './platformAgents.js';
import * as presence from './agentPresence.js';
import * as tasksSvc from './xenoTasks.js';
import { capOf, CAP_WINDOW_DAYS } from './divisionAgentBudget.js';

export class OverviewError extends Error { constructor(message, code, status = 400) { super(message); this.name = 'OverviewError'; this.code = code; this.status = status; } }

const MICRO = 1_000_000;
const credits = (micro) => Math.round(Number(micro) / MICRO * 100) / 100;
const BURST_GAP_MS = 10 * 60e3;       // calls closer together than this are one sitting
const EXPIRING_MS = 7 * 24 * 3600e3;  // a credential this close to expiring needs renewing
const SPEND_DAYS = 14;

/** Keep only the task keys this person may open (an agent can work where its owner cannot see). */
async function visible(db, me, keys) {
  const ok = new Set();
  for (const k of new Set(keys)) {
    try { await tasksSvc.getTask(db, me, k); ok.add(k); } catch (e) { if (!(e instanceof tasksSvc.TaskError)) throw e; }
  }
  return ok;
}

/** XENO tool calls folded into sittings; task events and cloud runs stay single lines. Newest first. */
export function groupActivity(items) {
  const calls = items.filter((x) => x.kind === 'call').sort((a, b) => new Date(a.at) - new Date(b.at));
  const taskLines = items.filter((x) => x.kind === 'task');
  const bursts = [];
  for (const c of calls) {
    const last = bursts[bursts.length - 1];
    if (last && last.where === (c.where || null) && new Date(c.at) - new Date(last.to) <= BURST_GAP_MS) { last.to = c.at; last.calls.push(c); }
    else bursts.push({ where: c.where || null, from: c.at, to: c.at, calls: [c] });
  }
  const out = bursts.map((b) => {
    const tools = new Map();
    for (const c of b.calls) tools.set(c.what, (tools.get(c.what) || 0) + 1);
    // the task it worked on in that sitting: only when exactly one task saw its actions inside the window
    const near = new Set(taskLines.filter((t) => new Date(t.at) >= new Date(new Date(b.from).getTime() - BURST_GAP_MS) && new Date(t.at) <= new Date(new Date(b.to).getTime() + BURST_GAP_MS)).map((t) => t.task));
    return { kind: 'calls', at: b.to, from: b.from, to: b.to, where: b.where, count: b.calls.length,
      failed: b.calls.filter((c) => c.ok === false).length, task: near.size === 1 ? [...near][0] : null,
      tools: [...tools].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([name, n]) => ({ name, n })) };
  });
  return [...out, ...items.filter((x) => x.kind !== 'call')].sort((a, b) => new Date(b.at) - new Date(a.at));
}

async function spendOf(db, agentUserId) {
  const days = (await db.query(`SELECT d::date AS day, COALESCE(sum(l.amount_micro), 0)::text AS micro
      FROM generate_series((now() AT TIME ZONE 'UTC')::date - ($2::int - 1), (now() AT TIME ZONE 'UTC')::date, interval '1 day') d
      LEFT JOIN agent_spend_log l ON l.agent_user_id = $1 AND l.state = 'reserved' AND (l.created_at AT TIME ZONE 'UTC')::date = d::date
     GROUP BY d ORDER BY d`, [agentUserId, SPEND_DAYS])).rows;
  const window = (await db.query(`SELECT COALESCE(sum(amount_micro), 0)::text AS s FROM agent_spend_log
      WHERE agent_user_id = $1 AND state = 'reserved' AND created_at > now() - make_interval(days => $2)`, [agentUserId, CAP_WINDOW_DAYS])).rows[0].s;
  const cap = await capOf(db, agentUserId);
  return { days: days.map((d) => ({ day: new Date(d.day).toISOString().slice(0, 10), credits: credits(d.micro) })),
    windowDays: CAP_WINDOW_DAYS, spentCredits: credits(window), capCredits: cap ? cap.view.limitCredits : null,
    covers: 'images, video and model calls through XENO tools' };
}

async function versionsOf(db, agentUserId, versionList) {
  const rows = (await db.query(`SELECT r.agent_version AS v, r.state, t.status FROM agent_cloud_runs r JOIN tasks t ON t.id = r.task_id
     WHERE r.agent_user_id = $1 AND t.deleted_at IS NULL`, [agentUserId])).rows;
  return versionList.map((v) => {
    const mine = rows.filter((r) => r.v === v.version);
    const n = (f) => mine.filter(f).length;
    return { version: v.version, createdAt: v.createdAt, by: v.by, runs: mine.length,
      completed: n((r) => r.state === 'completed'), failed: n((r) => ['failed', 'refused', 'uncertain'].includes(r.state)), stopped: n((r) => r.state === 'cancelled'),
      tasksDone: n((r) => r.status === 'done'), tasksInReview: n((r) => r.status === 'in_review'), tasksBlocked: n((r) => r.status === 'blocked') };
  });
}

async function needsYouOf(db, me, a, pres, spend) {
  const out = [];
  const ask = (await db.query(`SELECT 'T-' || t.number AS task, t.title, s.last_note, s.updated_at FROM task_agent_sessions s
      JOIN tasks t ON t.id = s.task_id AND t.deleted_at IS NULL AND t.status NOT IN ('done', 'wont_do')
     WHERE s.agent_user_id = $1 AND s.state = 'awaiting_input' ORDER BY s.updated_at DESC LIMIT 5`, [a.userId])).rows;
  const review = (await db.query(`SELECT 'T-' || number AS task, title, updated_at FROM tasks
     WHERE delegate_id = $1 AND status = 'in_review' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5`, [a.userId])).rows;
  const ok = await visible(db, me, [...ask.map((r) => r.task), ...review.map((r) => r.task)]);
  for (const r of ask) if (ok.has(r.task)) out.push({ kind: 'asks', task: r.task, title: r.title, note: r.last_note || '', at: r.updated_at });
  for (const r of review) if (ok.has(r.task)) out.push({ kind: 'review', task: r.task, title: r.title, at: r.updated_at });
  if (a.rights && (a.rights.manage || a.rights.runner)) {
    for (const c of a.credentials) {
      const left = new Date(c.expiresAt).getTime() - Date.now();
      if (left < EXPIRING_MS) out.push({ kind: 'expires', credentialId: c.id, label: c.label || 'Credential', expiresAt: c.expiresAt });
    }
  }
  if (spend.capCredits != null && spend.capCredits > 0 && spend.spentCredits >= spend.capCredits * 0.8) {
    out.push({ kind: 'cap', spentCredits: spend.spentCredits, capCredits: spend.capCredits });
  }
  return out;
}

/** The tasks handed to it that are not finished, newest first — only those this person may open. */
async function queueOf(db, me, agentUserId) {
  const rows = (await db.query(`SELECT 'T-' || number AS task, title, status, updated_at FROM tasks
     WHERE delegate_id = $1 AND deleted_at IS NULL AND status IN ('todo', 'in_progress', 'blocked', 'in_review')
     ORDER BY updated_at DESC LIMIT 12`, [agentUserId])).rows;
  const ok = await visible(db, me, rows.map((r) => r.task));
  return rows.filter((r) => ok.has(r.task)).map((r) => ({ task: r.task, title: r.title, status: r.status, at: r.updated_at }));
}

/** Everything the Overview shows, for a person who may see the agent (agent_not_found otherwise). */
export async function overview(db, me, publicId) {
  const a = await agents.get(db, me, publicId);
  const pres = await presence.presenceOf(db, a.userId, a.rights);
  const act = await presence.activity(db, me, publicId, { limit: 200 });
  const spend = await spendOf(db, a.userId);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const since = (x) => new Date(x.at) >= today;
  return {
    agentId: a.id, presence: pres,
    today: { taskActions: act.items.filter((x) => x.kind === 'task' && since(x)).length, toolCalls: act.items.filter((x) => x.kind === 'call' && since(x)).length },
    queue: await queueOf(db, me, a.userId),
    needsYou: await needsYouOf(db, me, a, pres, spend),
    spend,
    groups: groupActivity(act.items).slice(0, 12),
    versions: await versionsOf(db, a.userId, a.versions || []),
    connections: a.connections,
  };
}

// ───────────────────────────── controls

/** Tell it something: a comment on the task it is on (or `task`), which reaches it as a task event. */
export async function message(db, me, publicId, { body, task } = {}) {
  const a = await agents.get(db, me, publicId);
  if (!a.rights || !(a.rights.manage || a.rights.runner)) throw new OverviewError('Only someone who may run this agent can message it', 'not_allowed', 403);
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw new OverviewError('Write the message', 'invalid_body');
  let key = task ? String(task) : null;
  if (!key) { const p = await presence.presenceOf(db, a.userId, a.rights); key = (p.asking && p.asking.task) || (p.doing && p.doing.task) || null; }
  if (!key) throw new OverviewError(`${a.name} is not on a task right now. Hand it a task, or open one of its tasks and comment there.`, 'no_current_task', 409);
  const t = await tasksSvc.getTask(db, me, key);
  // a message to the agent goes where the agent works: a task it is the delegate of
  if (!t.delegate || t.delegate.id !== String(a.userId)) throw new OverviewError(`${key} is not ${a.name}’s task`, 'not_its_task', 409);
  await tasksSvc.commentTask(db, me, key, { body: text });
  return { task: key };
}

/** Pause or resume one place it runs. Paused: its next call is refused; resumed: it answers again. */
export async function setConnectionPaused(db, me, publicId, connectionId, paused) {
  const a = await agents.get(db, me, publicId);
  if (!a.rights || !a.rights.manage) throw new OverviewError('Only whoever manages this agent can pause where it runs', 'not_allowed', 403);
  if (!/^[0-9a-f-]{36}$/i.test(String(connectionId || ''))) throw new OverviewError('Connection not found', 'connection_not_found', 404);
  const row = (await db.query(`UPDATE mcp_connections SET paused_at = ${paused ? 'COALESCE(paused_at, now())' : 'NULL'}
      WHERE id = $1 AND agent_user_id = $2 AND revoked_at IS NULL RETURNING id, client_name, last_used_at, paused_at`, [connectionId, a.userId])).rows[0];
  if (!row) throw new OverviewError('Connection not found', 'connection_not_found', 404);
  return { id: String(row.id), client: row.client_name, lastUsedAt: row.last_used_at, pausedAt: row.paused_at || null };
}

/** Its spending cap in credits over the last 30 days, or null to remove it. */
export async function setSpendCap(db, me, publicId, { credits: c } = {}) {
  const a = await agents.get(db, me, publicId);
  if (!a.rights || !a.rights.manage) throw new OverviewError('Only whoever manages this agent can set its cap', 'not_allowed', 403);
  if (c === undefined) throw new OverviewError('Give the cap in credits, or null to remove it', 'invalid_cap');
  if (c === null) { await db.query('DELETE FROM agent_spend_caps WHERE agent_user_id = $1', [a.userId]); return { capCredits: null }; }
  const n = Number(c);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new OverviewError('The cap is between 0 and 10,000,000 credits', 'invalid_cap');
  await db.query(`INSERT INTO agent_spend_caps (agent_user_id, limit_micro, set_by_user_id, updated_at) VALUES ($1, $2, $3, now())
    ON CONFLICT (agent_user_id) DO UPDATE SET limit_micro = EXCLUDED.limit_micro, set_by_user_id = EXCLUDED.set_by_user_id, updated_at = now()`,
    [a.userId, String(Math.round(n * MICRO)), me.id]);
  return { capCredits: credits(Math.round(n * MICRO)) };
}
