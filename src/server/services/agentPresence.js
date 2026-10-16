/**
 * Is an agent available, and what has it been doing? (owner, 2026-10-16: "see if this agent is online or not,
 * connected or not, so that we see if it's available to delegate / hand off to, and see the logs".)
 *
 * PRESENCE is derived, never set by the agent, from four facts the platform already records (a revoked credential
 * or connection counts for nothing: a run that ended and lost its credential is not still "working"):
 *   working  — a cloud run of it is live, or one of its credentials / connections answered in the last 2 minutes
 *   online   — it was seen in the last 15 minutes (a local CLI between calls)
 *   cloud    — not seen lately, but the person can start a cloud run of it: work handed to it starts at once
 *   offline  — none of the above, but it can still connect (a live credential, a webhook): work waits until it does
 *   new      — it has never connected and has no way to; it needs a credential or a cloud run
 *   paused   — it has no owner who can answer for it (agentAccess): nothing runs
 * `canTakeWork` says whether handing it work now would do something without the person's further help.
 *
 * ACTIVITY is one time-ordered list from the records each surface already writes: what it did on tasks
 * (task_events), its XENO MCP calls (metadata only — never arguments or results), and its cloud runs.
 */
import * as agents from './platformAgents.js';
import { resolvePrincipal } from './agentIdentity.js';
import * as tasksSvc from './xenoTasks.js';

const WORKING_MS = 2 * 60e3, ONLINE_MS = 15 * 60e3;
const LIVE_RUN = ['starting', 'queued', 'running'];

async function facts(db, agentUserId) {
  const q = (sql, p = [agentUserId]) => db.query(sql, p).then((r) => r.rows[0] || {});
  const [seen, run, cred, hook] = await Promise.all([
    q(`SELECT GREATEST(
         (SELECT max(last_used_at) FROM task_agent_tokens WHERE agent_user_id = $1 AND revoked_at IS NULL AND expires_at > now()),
         (SELECT max(last_used_at) FROM mcp_connections WHERE agent_user_id = $1 AND revoked_at IS NULL)) AS at`),
    q(`SELECT id, state, created_at FROM agent_cloud_runs WHERE agent_user_id = $1 AND state = ANY($2) ORDER BY created_at DESC LIMIT 1`, [agentUserId, LIVE_RUN]),
    q(`SELECT count(*)::int AS n FROM task_agent_tokens WHERE agent_user_id = $1 AND revoked_at IS NULL AND expires_at > now()`),
    q(`SELECT 1 AS yes FROM task_agent_webhooks WHERE agent_user_id = $1`),
  ]);
  return { seenAt: seen.at || null, run: run.id ? { id: String(run.id), state: run.state, since: run.created_at } : null, credentials: cred.n || 0, webhook: !!hook.yes };
}

/** The presence of one agent (by its user id), as `viewerRights` allow (they decide whether `cloud` applies). */
export async function presenceOf(db, agentUserId, viewerRights = null) {
  const p = await resolvePrincipal(db, agentUserId);
  if (p && p.unusableReason === 'needs_owner') return { state: 'paused', label: 'Paused — needs an owner', canTakeWork: false, seenAt: null };
  const f = await facts(db, agentUserId);
  const age = f.seenAt ? Date.now() - new Date(f.seenAt).getTime() : Infinity;
  const canRun = !!(viewerRights && (viewerRights.runner || viewerRights.manage));
  const base = { seenAt: f.seenAt, run: f.run };
  if (f.run) return { ...base, state: 'working', label: f.run.state === 'running' ? 'Working in the cloud' : 'Starting in the cloud', canTakeWork: true };
  if (age < WORKING_MS) return { ...base, state: 'working', label: 'Working now', canTakeWork: true };
  if (age < ONLINE_MS) return { ...base, state: 'online', label: 'Online', canTakeWork: true };
  if (canRun) return { ...base, state: 'cloud', label: f.seenAt ? 'Offline here — runs in the cloud' : 'Runs in the cloud', canTakeWork: true };
  if (f.credentials || f.webhook) return { ...base, state: 'offline', label: 'Offline — work waits until it connects', canTakeWork: false };
  return { ...base, state: 'new', label: 'Not connected yet', canTakeWork: false };
}

/** Presence for every agent the person can see — the sidebar and the list. */
export async function presenceAll(db, me) {
  const list = await agents.list(db, me);
  const out = [];
  for (const a of list) out.push({ id: a.id, name: a.name, division: a.division ? a.division.name : null, ...(await presenceOf(db, a.userId, a.rights)) });
  return out;
}

/** One agent's activity: tasks, MCP calls and cloud runs, newest first. `before` is an ISO time for paging. */
export async function activity(db, me, publicId, { limit = 50, before = null } = {}) {
  const a = await agents.get(db, me, publicId);            // the viewer may see it, or agent_not_found
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const cut = before && !Number.isNaN(new Date(before).getTime()) ? new Date(before) : new Date(Date.now() + 1000);
  const [tasks, calls, runs] = await Promise.all([
    db.query(`SELECT e.id, e.kind, e.from_value, e.to_value, e.note, e.created_at, 'T-' || t.number AS task, t.title
        FROM task_events e JOIN tasks t ON t.id = e.task_id
       WHERE e.actor_id = $1 AND e.created_at < $2 AND t.deleted_at IS NULL ORDER BY e.created_at DESC LIMIT $3`, [a.userId, cut, n]),
    db.query(`SELECT k.id, k.tool, k.category, k.outcome, k.error_code, k.latency_ms, k.started_at, c.client_name
        FROM mcp_calls k JOIN mcp_connections c ON c.id = k.connection_id
       WHERE c.agent_user_id = $1 AND k.started_at < $2 ORDER BY k.started_at DESC LIMIT $3`, [a.userId, cut, n]),
    db.query(`SELECT r.id, r.state, r.reason, r.created_at, r.ended_at, 'T-' || t.number AS task
        FROM agent_cloud_runs r JOIN tasks t ON t.id = r.task_id
       WHERE r.agent_user_id = $1 AND r.created_at < $2 ORDER BY r.created_at DESC LIMIT $3`, [a.userId, cut, n]),
  ]);
  // a task event is shown only for a task the viewer may open — through the task service's own reader, so its
  // title never reaches someone who cannot see the task (an agent can work on projects its owner is not on)
  const seen = new Map();
  for (const key of new Set(tasks.rows.map((e) => e.task))) {
    try { await tasksSvc.getTask(db, me, key); seen.set(key, true); } catch (err) { if (err instanceof tasksSvc.TaskError) seen.set(key, false); else throw err; }
  }
  const items = [
    ...tasks.rows.filter((e) => seen.get(e.task)).map((e) => ({ id: 'e' + e.id, at: e.created_at, kind: 'task', what: e.kind, task: e.task, title: e.title, detail: e.kind === 'status' ? `${e.from_value || ''} → ${e.to_value || ''}` : e.kind === 'activity' ? `${e.from_value || ''}${e.note ? ': ' + e.note : ''}` : (e.note || '') })),
    ...calls.rows.map((k) => ({ id: 'c' + k.id, at: k.started_at, kind: 'call', what: k.tool, detail: `${k.outcome}${k.error_code ? ' (' + k.error_code + ')' : ''} · ${k.latency_ms} ms`, where: k.client_name, ok: k.outcome === 'ok' })),
    ...runs.rows.map((r) => ({ id: 'r' + r.id, at: r.created_at, kind: 'run', what: r.state, task: r.task, detail: r.reason || '', endedAt: r.ended_at })),
  ].sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, n);
  return { agent: { id: a.id, name: a.name }, presence: await presenceOf(db, a.userId, a.rights), items, next: items.length === n ? new Date(items[items.length - 1].at).toISOString() : null };
}
