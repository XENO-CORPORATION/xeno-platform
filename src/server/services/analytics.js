/**
 * XENO Analytics (Corpo › Analytics) — dashboards over data the platform ALREADY holds. Not a BI product (that is
 * xeno-spectra, SPEC draft): no connectors, no query language. A fixed catalogue of metrics, each one SQL written
 * here, read-only, scoped to one workspace. Every surface — the screen (routes/analyticsRoutes.js) and agents
 * (analyticsMcp.js) — calls these functions; there is no second path.
 *
 *   credits.spend      the workspace wallet (credit_accounts keyed by the workspace id): balance + spend per day
 *   tasks.throughput   XENO Tasks: created / closed per day, open by status, median cycle time (created → closed)
 *   storage.usage      Storage: bytes held vs the workspace's allowance, files by kind
 *   support.tickets    support_tickets raised from the workspace: open by status, median first response
 *   runs.agents        hosted agent runs (agent_cloud_runs) on the workspace's tasks: by state, budget reserved
 *
 * Scope (XENO-WORKFORCE-01 §8.11): the WORKSPACE owns its analytics. Any member (viewer) reads; editors save,
 * change and delete dashboards. An agent reads as its owner and never above them, and has no write here.
 * `division` narrows the metrics where a division is meaningful (tasks, runs: through workforce_project_divisions);
 * credits, storage and support are workspace-wide and say so (`scope: 'workspace'`).
 *
 * Publish metrics are not here yet: XENO Post's analytics are not exposed through services/xenoPost.js. That is a
 * gap, not a metric: nothing is reported until it is real.
 */
import { check } from '../utils/authzReBAC.js';
import { ensurePersonalWorkspace } from './personalWorkspace.js';
import { workspaceUsedBytes, workspaceStorageAllowance, storageUsage } from './storageAllowance.js';

export class AnalyticsError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'AnalyticsError'; this.code = code; this.status = status; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clampDays = (d) => { const n = Math.trunc(Number(d ?? 30)); if (!Number.isFinite(n) || n < 1) return 30; return Math.min(n, 365); };

/** The metrics there are. A widget may name only these. */
export const METRICS = Object.freeze([
  { id: 'credits.spend', title: 'Credits', scope: 'workspace', description: 'The workspace wallet: balance, credits spent per day and in total over the window.' },
  { id: 'tasks.throughput', title: 'Tasks', scope: 'division', description: 'XENO Tasks: created and closed per day, open tasks by status, median cycle time from created to done (hours).' },
  { id: 'storage.usage', title: 'Storage', scope: 'workspace', description: 'Bytes the workspace holds against its allowance, and files by kind.' },
  { id: 'support.tickets', title: 'Support', scope: 'workspace', description: 'Support tickets raised from this workspace: open by status, created in the window, median hours to first response.' },
  { id: 'runs.agents', title: 'Agent runs', scope: 'division', description: 'Hosted agent runs on the workspace’s tasks: count by state and credits reserved in the window.' },
]);
const METRIC_IDS = new Set(METRICS.map((m) => m.id));

// ─────────────────────────────────────────── who, where

async function personOf(db, actor) {
  if (!actor || !actor.id) throw new AnalyticsError('No caller', 'not_allowed', 401);
  if (actor.kind !== 'agent') return { userId: String(actor.id), agentId: null };
  const r = (await db.query('SELECT owner_user_id FROM agent_identities WHERE user_id = $1', [actor.id])).rows[0];
  if (!r || !r.owner_user_id) throw new AnalyticsError('This agent has no owner', 'no_owner', 403);
  return { userId: String(r.owner_user_id), agentId: String(actor.id) };
}

/** Resolve the workspace (default: the person's Personal one) and require `need` in it. */
export async function scopeFor(db, actor, { workspace, division, need = 'viewer' } = {}) {
  const who = await personOf(db, actor);
  if (need !== 'viewer' && who.agentId) throw new AnalyticsError('Agents read analytics; a person changes dashboards', 'person_required', 403);
  let ws = workspace ? String(workspace) : null;
  if (ws && !UUID.test(ws)) throw new AnalyticsError('Invalid workspace id', 'invalid_workspace');
  if (!ws) ws = String((await ensurePersonalWorkspace(db, who.userId)).id);
  const ok = await check(db, { object: `workspace:${ws}`, relation: need, subject: `user:${who.userId}` });
  if (!ok.allowed) {
    const member = need === 'viewer' ? false : (await check(db, { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${who.userId}` })).allowed;
    if (!member) throw new AnalyticsError('You are not a member of that workspace', 'not_a_member', 403);
    throw new AnalyticsError('Only editors and admins can change dashboards', 'editor_required', 403);
  }
  const w = (await db.query('SELECT id, owner_user_id, workspace_type FROM workspaces WHERE id = $1', [ws])).rows[0];
  if (!w) throw new AnalyticsError('Workspace not found', 'not_found', 404);
  let div = null;
  if (division) {
    if (!UUID.test(String(division))) throw new AnalyticsError('Invalid division id', 'invalid_division');
    const d = (await db.query('SELECT id, name FROM workforce_divisions WHERE id = $1 AND workspace_id = $2', [division, ws])).rows[0];
    if (!d) throw new AnalyticsError('That division is not in this workspace', 'division_not_found', 404);
    div = d;
  }
  return { ...who, workspaceId: ws, personal: w.workspace_type === 'personal', ownerUserId: String(w.owner_user_id), division: div };
}

/**
 * The tasks this scope covers, as a SQL predicate on alias `t` with parameters starting at $1:
 * $1 workspace, $2 personal?, $3 owner, $4 division (or null).
 */
const TASK_SCOPE = `(
  (t.project_id IN (SELECT p.id FROM chat_projects p WHERE p.workspace_id = $1 OR ($2::boolean AND p.workspace_id IS NULL AND p.owner_user_id = $3::uuid))
   OR ($2::boolean AND $4::uuid IS NULL AND t.project_id IS NULL AND t.owner_user_id = $3::uuid))
  AND ($4::uuid IS NULL OR t.project_id IN (SELECT project_id FROM workforce_project_divisions WHERE division_id = $4::uuid)))`;
const taskArgs = (s) => [s.workspaceId, s.personal, s.ownerUserId, s.division ? s.division.id : null];

// ─────────────────────────────────────────── metrics

async function creditsSpend(db, s, days) {
  const acct = (await db.query('SELECT id, balance FROM credit_accounts WHERE user_id = $1', [s.workspaceId])).rows[0];
  if (!acct) return { wallet: false, balance: 0, spent: 0, series: [] };
  const rows = (await db.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, COALESCE(SUM(-amount), 0)::bigint AS spent
       FROM credit_transactions WHERE account_id = $1 AND amount < 0 AND created_at >= now() - make_interval(days => $2)
      GROUP BY 1 ORDER BY 1`, [acct.id, days])).rows;
  const series = rows.map((r) => ({ day: r.day, value: Number(r.spent) }));
  return { wallet: true, balance: Number(acct.balance), spent: series.reduce((a, r) => a + r.value, 0), series };
}

async function tasksThroughput(db, s, days) {
  const a = taskArgs(s);
  const [created, closed, open, cycle] = await Promise.all([
    db.query(`SELECT to_char(date_trunc('day', t.created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS n FROM tasks t WHERE ${TASK_SCOPE} AND t.created_at >= now() - make_interval(days => $5) GROUP BY 1 ORDER BY 1`, [...a, days]),
    db.query(`SELECT to_char(date_trunc('day', t.closed_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS n FROM tasks t WHERE ${TASK_SCOPE} AND t.status = 'done' AND t.closed_at >= now() - make_interval(days => $5) GROUP BY 1 ORDER BY 1`, [...a, days]),
    db.query(`SELECT t.status, COUNT(*)::int AS n FROM tasks t WHERE ${TASK_SCOPE} AND t.status NOT IN ('done', 'wont_do') GROUP BY 1 ORDER BY 1`, a),
    db.query(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.closed_at - t.created_at)) / 3600) AS h, COUNT(*)::int AS n
                FROM tasks t WHERE ${TASK_SCOPE} AND t.status = 'done' AND t.closed_at IS NOT NULL AND t.closed_at >= now() - make_interval(days => $5)`, [...a, days]),
  ]);
  const ser = (r) => r.rows.map((x) => ({ day: x.day, value: x.n }));
  return {
    created: created.rows.reduce((n, r) => n + r.n, 0), closed: closed.rows.reduce((n, r) => n + r.n, 0),
    createdSeries: ser(created), closedSeries: ser(closed),
    open: Object.fromEntries(open.rows.map((r) => [r.status, r.n])),
    medianCycleHours: cycle.rows[0].h === null ? null : Math.round(Number(cycle.rows[0].h) * 10) / 10,
  };
}

async function storageUsageMetric(db, s) {
  if (s.personal) {
    const u = await storageUsage(db, s.ownerUserId);
    return { usedBytes: u.usedBytes, allowanceBytes: u.allowanceBytes, files: u.files, byKind: u.byKind };
  }
  const [used, allowance, kinds] = await Promise.all([
    workspaceUsedBytes(db, s.workspaceId), workspaceStorageAllowance(db, s.workspaceId),
    db.query(`SELECT CASE WHEN mime_type LIKE 'image/%' THEN 'image' WHEN mime_type LIKE 'video/%' THEN 'video' WHEN mime_type LIKE 'audio/%' THEN 'audio' ELSE 'document' END AS kind,
                     COALESCE(SUM(file_size), 0)::bigint AS bytes, COUNT(*)::int AS files
                FROM user_files WHERE workspace_id = $1 AND deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC`, [s.workspaceId]),
  ]);
  return { usedBytes: used, allowanceBytes: allowance, files: kinds.rows.reduce((n, r) => n + r.files, 0), byKind: kinds.rows.map((r) => ({ kind: r.kind, bytes: Number(r.bytes), files: r.files })) };
}

async function supportTickets(db, s, days) {
  const [open, made, first] = await Promise.all([
    db.query(`SELECT status, COUNT(*)::int AS n FROM support_tickets WHERE workspace_id = $1 AND status NOT IN ('resolved', 'closed') AND merged_into_id IS NULL GROUP BY 1 ORDER BY 1`, [s.workspaceId]),
    db.query(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS n FROM support_tickets WHERE workspace_id = $1 AND created_at >= now() - make_interval(days => $2) GROUP BY 1 ORDER BY 1`, [s.workspaceId, days]),
    db.query(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_responded_at - created_at)) / 3600) AS h FROM support_tickets WHERE workspace_id = $1 AND first_responded_at IS NOT NULL AND created_at >= now() - make_interval(days => $2)`, [s.workspaceId, days]),
  ]);
  return {
    open: Object.fromEntries(open.rows.map((r) => [r.status, r.n])), openTotal: open.rows.reduce((n, r) => n + r.n, 0),
    created: made.rows.reduce((n, r) => n + r.n, 0), createdSeries: made.rows.map((r) => ({ day: r.day, value: r.n })),
    medianFirstResponseHours: first.rows[0].h === null ? null : Math.round(Number(first.rows[0].h) * 10) / 10,
  };
}

async function runsAgents(db, s, days) {
  const r = (await db.query(
    `SELECT r.state, COUNT(*)::int AS n, COALESCE(SUM(r.budget_credits), 0)::numeric AS budget
       FROM agent_cloud_runs r JOIN tasks t ON t.id = r.task_id
      WHERE ${TASK_SCOPE} AND r.created_at >= now() - make_interval(days => $5) GROUP BY 1 ORDER BY 1`, [...taskArgs(s), days])).rows;
  return { byState: Object.fromEntries(r.map((x) => [x.state, x.n])), total: r.reduce((n, x) => n + x.n, 0), budgetCredits: r.reduce((n, x) => n + Number(x.budget), 0) };
}

/** One metric's value, for this actor, now. */
export async function queryMetric(db, actor, { workspace, division, metric, days } = {}) {
  if (!METRIC_IDS.has(String(metric))) throw new AnalyticsError(`Unknown metric. Known: ${[...METRIC_IDS].join(', ')}`, 'unknown_metric');
  const s = await scopeFor(db, actor, { workspace, division });
  const m = METRICS.find((x) => x.id === metric), d = clampDays(days);
  if (s.division && m.scope !== 'division') throw new AnalyticsError(`${m.title} is workspace-wide; it has no division view`, 'not_division_scoped');
  const value = metric === 'credits.spend' ? await creditsSpend(db, s, d)
    : metric === 'tasks.throughput' ? await tasksThroughput(db, s, d)
    : metric === 'storage.usage' ? await storageUsageMetric(db, s)
    : metric === 'support.tickets' ? await supportTickets(db, s, d)
    : await runsAgents(db, s, d);
  return { metric, title: m.title, scope: s.division ? 'division' : 'workspace', workspaceId: s.workspaceId, division: s.division ? { id: s.division.id, name: s.division.name } : null, days: d, at: new Date().toISOString(), value };
}

export async function listMetrics(db, actor, { workspace } = {}) {
  const s = await scopeFor(db, actor, { workspace });
  const divisions = (await db.query("SELECT id, name FROM workforce_divisions WHERE workspace_id = $1 AND lifecycle = 'active' ORDER BY name", [s.workspaceId])).rows;
  return { workspaceId: s.workspaceId, metrics: METRICS, divisions };
}

// ─────────────────────────────────────────── dashboards

function cleanWidgets(widgets) {
  if (!Array.isArray(widgets)) throw new AnalyticsError('widgets must be a list', 'invalid_widgets');
  if (widgets.length > 24) throw new AnalyticsError('At most 24 widgets on a dashboard', 'invalid_widgets');
  return widgets.map((w) => {
    if (!w || !METRIC_IDS.has(String(w.metric))) throw new AnalyticsError(`Unknown metric in a widget: ${w && w.metric}`, 'unknown_metric');
    return { metric: String(w.metric), days: clampDays(w.days) };
  });
}
const cleanName = (n) => { const s = String(n ?? '').trim(); if (!s || s.length > 120) throw new AnalyticsError('A dashboard needs a name of 1–120 characters', 'invalid_name'); return s; };
const view = (r) => ({ id: r.id, name: r.name, widgets: r.widgets, createdBy: r.created_by_user_id, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at || null });

export async function listDashboards(db, actor, { workspace } = {}) {
  const s = await scopeFor(db, actor, { workspace });
  const rows = (await db.query('SELECT * FROM analytics_dashboards WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200', [s.workspaceId])).rows;
  return { workspaceId: s.workspaceId, dashboards: rows.map(view) };
}

export async function getDashboard(db, actor, { workspace, id } = {}) {
  const s = await scopeFor(db, actor, { workspace });
  const r = await one(db, s, id);
  return { dashboard: view(r) };
}

async function one(db, s, id, { includeDeleted = false } = {}) {
  if (!UUID.test(String(id || ''))) throw new AnalyticsError('Invalid dashboard id', 'invalid_dashboard');
  const r = (await db.query(`SELECT * FROM analytics_dashboards WHERE id = $1 AND workspace_id = $2 ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`, [id, s.workspaceId])).rows[0];
  if (!r) throw new AnalyticsError('Dashboard not found', 'not_found', 404);
  return r;
}

export async function createDashboard(db, actor, { workspace, name, widgets = [] } = {}) {
  const s = await scopeFor(db, actor, { workspace, need: 'editor' });
  const r = (await db.query('INSERT INTO analytics_dashboards (workspace_id, name, widgets, created_by_user_id) VALUES ($1, $2, $3::jsonb, $4) RETURNING *',
    [s.workspaceId, cleanName(name), JSON.stringify(cleanWidgets(widgets)), s.userId])).rows[0];
  return { dashboard: view(r) };
}

export async function updateDashboard(db, actor, { workspace, id, name, widgets } = {}) {
  const s = await scopeFor(db, actor, { workspace, need: 'editor' });
  const cur = await one(db, s, id);
  const r = (await db.query('UPDATE analytics_dashboards SET name = $3, widgets = $4::jsonb, updated_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING *',
    [cur.id, s.workspaceId, name === undefined ? cur.name : cleanName(name), JSON.stringify(widgets === undefined ? cur.widgets : cleanWidgets(widgets))])).rows[0];
  return { dashboard: view(r) };
}

export async function deleteDashboard(db, actor, { workspace, id } = {}) {
  const s = await scopeFor(db, actor, { workspace, need: 'editor' });
  const cur = await one(db, s, id);
  await db.query('UPDATE analytics_dashboards SET deleted_at = now() WHERE id = $1', [cur.id]);
  return { deleted: true, id: cur.id, undo: 'restore' };
}

export async function restoreDashboard(db, actor, { workspace, id } = {}) {
  const s = await scopeFor(db, actor, { workspace, need: 'editor' });
  const cur = await one(db, s, id, { includeDeleted: true });
  const r = (await db.query('UPDATE analytics_dashboards SET deleted_at = NULL, updated_at = now() WHERE id = $1 RETURNING *', [cur.id])).rows[0];
  return { dashboard: view(r) };
}
