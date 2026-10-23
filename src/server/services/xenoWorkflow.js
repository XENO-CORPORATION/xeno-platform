/**
 * XENO Automate (Dev › Automate) = XENO Workflow. The workspace's automations are xeno-workflow workflows — the
 * product's own graph format, node catalogue and engine — and this file is the FRONT-END to its headless runner
 * (xeno-workflow src/headless, docs/HEADLESS-RUNNER.md). Owner, 2026-10-23: "for automate we already have xeno workflow
 * that needs to power this … why are you inventing stuff that we already have as products?" No engine lives here.
 *
 * What this file owns, and only this:
 *   the record     a workspace's workflows (graph + state), their runs (the durable delivery queue) and results
 *   the triggers   platform events — a task moves, a ticket is opened, a form is answered, a schedule, a signed
 *                  webhook — become ONE queued run per (workflow, event) and are delivered to the runner
 *   the authority  a run acts as the workflow's own platform agent, holding EXACTLY the capabilities its graph calls,
 *                  granted when a HUMAN admin enabled it; each run carries a short-lived xwk_ key for that agent, so
 *                  every action goes through /api/v1 like any other key: scope, grant, the person's own rights,
 *                  step-up (a headless key never passes it), and run admission / the sales gate inside the services
 *
 * Calls to the runner carry a 60-second ES256 assertion signed with the platform OIDC key (the one at
 * /api/oauth2/jwks): aud `xeno-workflow`, typ `xeno-workflow-assertion+jwt`, and for a run, the run id and the SHA-256
 * of the exact body. The same RFC 7523 shape XENO Publish uses for XENO Post (services/xenoPost.js).
 *
 * Ownership (XENO-WORKFORCE-01 §8.11): the WORKSPACE owns its workflows; members read, admins write, an agent's write
 * is always a DRAFT and only a person enables one (a database trigger holds that too). Fail closed: without
 * XENO_WORKFLOW_RUNNER_URL a run is never attempted and the screen says Automate is not set up.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getSigningKey } from '../utils/oidcProvider.js';
import { issuer } from '../config/hosts.js';
import { check } from '../utils/authzReBAC.js';
import { ensurePersonalWorkspace } from './personalWorkspace.js';
import { encrypt, decrypt } from '../utils/secretBox.js';
import { byName } from '../capabilities/catalogue.js';
import { WORKSPACE_SCOPES } from '../capabilities/scopes.js';
import { validateIanaTimeZone } from './chatScheduleRecurrence.js';
import * as creds from './workspaceCredentials.js';
import { mcpAgentFor } from './xenoTasks.js';

export class AutomateError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'AutomateError'; this.code = code; this.status = status; this.statusCode = status; }
}

export const ASSERTION_AUDIENCE = 'xeno-workflow';
export const ASSERTION_TYP = 'xeno-workflow-assertion+jwt';
export const TRIGGER_TYPE = 'xeno-platform-trigger';
export const ACTION_TYPE = 'xeno-platform-capability';
export const EVENTS = Object.freeze(['task.status_changed', 'support.ticket_created', 'form.response_submitted', 'schedule', 'webhook']);
const TASK_STATUSES = ['raised', 'todo', 'in_progress', 'blocked', 'in_review', 'done', 'wont_do'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAPABILITY_NAME = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_-]*){1,4}$/;
const MAX_NODES = 300, MAX_EDGES = 1000, MAX_GRAPH_BYTES = 512 * 1024;
export const MAX_ATTEMPTS = 5, LEASE_MS = 7 * 60_000, WEBHOOK_TOLERANCE_MS = 5 * 60_000;
export const LOOP_LIMIT = { runs: 100, windowMinutes: 10 };
// node config fields that hold secrets, when the runner's catalogue has not been read yet (it names them itself)
const SECRET_FIELDS_FALLBACK = { 'http-request': ['authUsername', 'authPassword', 'oauthToken'] };

/** Where the xeno-workflow runner lives, or null when this platform is not wired to it. Read at call time. */
export function runnerBase() {
  const raw = String(process.env.XENO_WORKFLOW_RUNNER_URL || '').trim().replace(/\/+$/, '');
  return raw || null;
}

// ─────────────────────────────────────────── who, where

async function personOf(db, actor) {
  if (!actor || !actor.id) throw new AutomateError('No caller', 'not_allowed', 401);
  if (actor.kind !== 'agent') return { userId: String(actor.id), agentId: null, kind: actor.kind === 'service' ? 'service' : 'human' };
  const r = (await db.query('SELECT owner_user_id FROM agent_identities WHERE user_id = $1', [actor.id])).rows[0];
  if (!r || !r.owner_user_id) throw new AutomateError('This agent has no owner', 'no_owner', 403);
  return { userId: String(r.owner_user_id), agentId: String(actor.id), kind: 'agent' };
}
const rel = async (db, ws, relation, userId) => (await check(db, { object: `workspace:${ws}`, relation, subject: `user:${userId}` })).allowed;
async function isAdmin(db, ws, userId) {
  const w = (await db.query('SELECT owner_user_id, workspace_type FROM workspaces WHERE id = $1', [ws])).rows[0];
  if (!w) return false;
  if (w.workspace_type === 'personal') return String(w.owner_user_id) === String(userId);
  return rel(db, ws, 'admin', userId);
}
/** viewer reads · admin writes (an agent writes for an admin owner, always as a draft). */
export async function scopeFor(db, actor, workspace, need = 'viewer') {
  const who = await personOf(db, actor);
  if (who.kind === 'service') throw new AutomateError('A service account cannot use Automate', 'not_allowed', 403);
  let ws = workspace ? String(workspace) : null;
  if (ws && !UUID.test(ws)) throw new AutomateError('Invalid workspace id', 'invalid_workspace');
  if (!ws) ws = String((await ensurePersonalWorkspace(db, who.userId)).id);
  const w = (await db.query('SELECT id, owner_user_id, workspace_type FROM workspaces WHERE id = $1', [ws])).rows[0];
  if (!w) throw new AutomateError('Workspace not found', 'not_found', 404);
  if (w.workspace_type === 'personal') {
    if (String(w.owner_user_id) !== who.userId) throw new AutomateError('You are not a member of that workspace', 'not_a_member', 403);
  } else if (!(await rel(db, ws, need, who.userId))) {
    if (need === 'viewer' || !(await rel(db, ws, 'viewer', who.userId))) throw new AutomateError('You are not a member of that workspace', 'not_a_member', 403);
    throw new AutomateError('Only a workspace admin can create or change workflows', 'admin_required', 403);
  }
  return { ...who, workspaceId: ws };
}

// ─────────────────────────────────────────── the runner (one HTTP path)

/** The 60-second assertion for one runner call. `body` is the exact bytes of a run request. */
export async function mintAssertion(db, { userId, agentId = null, workspaceId, purpose, runId = null, body = null }) {
  const key = await getSigningKey(db);
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: String(userId), xeno_workspace: String(workspaceId), purpose, jti: crypto.randomUUID(),
    ...(agentId ? { act: { sub: String(agentId) } } : {}),
    ...(purpose === 'run' ? { run_id: String(runId), body_sha256: crypto.createHash('sha256').update(body).digest('hex') } : {}) };
  return jwt.sign({ ...claims, iat: now, exp: now + 60 }, key.privatePem, { algorithm: 'ES256', keyid: key.kid, issuer: issuer(), audience: ASSERTION_AUDIENCE, header: { typ: ASSERTION_TYP, kid: key.kid, alg: 'ES256' } });
}

/** One call to the runner. Returns { status, data } for any HTTP answer; throws only when nothing answered. */
async function callRunner(db, ctx, method, path, { body, purpose, runId, timeoutMs = 15_000, fetchImpl = globalThis.fetch } = {}) {
  const base = runnerBase();
  if (!base) throw new AutomateError('Automate is not set up on this server yet', 'automate_not_configured', 503);
  const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const token = await mintAssertion(db, { userId: ctx.userId, agentId: ctx.agentId, workspaceId: ctx.workspaceId, purpose, runId, body: bytes });
  let res;
  try {
    res = await fetchImpl(base + path, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(bytes ? { 'content-type': 'application/json' } : {}) }, body: bytes || undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) { throw new AutomateError('The XENO Workflow runner did not answer', 'runner_unreachable', 502); }
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, data, retryAfter: Number(res.headers.get('retry-after')) || null };
}

let catalogueCache = null;   // { at, nodes }
/** The node types the runner offers — xeno-workflow's own catalogue, read from it, cached 10 minutes. */
export async function runnerCatalogue(db, actor, { workspace, fetchImpl, fresh = false } = {}) {
  const ctx = await scopeFor(db, actor, workspace, 'viewer');
  if (!fresh && catalogueCache && Date.now() - catalogueCache.at < 10 * 60_000) return catalogueCache.nodes;
  const r = await callRunner(db, ctx, 'GET', '/v1/catalogue', { purpose: 'catalogue', fetchImpl });
  if (r.status !== 200 || !r.data || !Array.isArray(r.data.nodes)) throw new AutomateError(`The XENO Workflow runner refused the catalogue (${r.status})`, 'runner_error', 502);
  catalogueCache = { at: Date.now(), nodes: r.data.nodes };
  return r.data.nodes;
}
export function _resetCatalogueCache() { catalogueCache = null; }

/** The workspace capabilities a workflow's action node may call: REST-surfaced, runnable headless, not irreversible. */
export function actionCapabilities() {
  return [...byName.values()].filter((c) => c.surfaces.includes('rest') && c.class !== 'irreversible' && c.mode !== 'on-screen-only' && !c.agentsOnly)
    .map((c) => ({ name: c.name, title: c.title, description: c.description, scope: c.scope, class: c.class, input: c.input }));
}

// ─────────────────────────────────────────── cron (5 fields, IANA time zone) for the schedule event

const CRON_RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
function cronField(src, [lo, hi]) {
  const out = new Set();
  for (const part of String(src).split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new AutomateError(`Not a cron field: ${part}`, 'invalid_cron');
    let a = lo, b = hi;
    if (m[1] !== '*') { const [x, y] = m[1].split('-').map(Number); a = x; b = y ?? (m[2] ? hi : x); }
    const step = m[2] ? Number(m[2]) : 1;
    if (a < lo || b > hi || a > b || step < 1) throw new AutomateError(`Cron value out of range: ${part}`, 'invalid_cron');
    for (let i = a; i <= b; i += step) out.add(i);
  }
  return out;
}
export function parseCron(expr) {
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length !== 5) throw new AutomateError('A schedule has five fields: minute hour day month weekday', 'invalid_cron');
  const [min, hour, dom, mon, dow] = f.map((x, i) => cronField(x, CRON_RANGES[i]));
  if (dow.has(7)) { dow.delete(7); dow.add(0); }
  return { min, hour, dom, mon, dow, domAny: f[2] === '*', dowAny: f[4] === '*' };
}
function zoneParts(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return { month: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24, minute: Number(p.minute), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
/** The next minute after `after` that the expression fires, in `tz` (searched minute by minute, at most a year). */
export function nextCron(expr, tz = 'UTC', after = new Date()) {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  let t = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  for (let i = 0; i < 366 * 24 * 60; i++, t = new Date(t.getTime() + 60_000)) {
    const z = zoneParts(t, tz);
    if (!c.min.has(z.minute) || !c.hour.has(z.hour) || !c.mon.has(z.month)) continue;
    const domOk = c.dom.has(z.day), dowOk = c.dow.has(z.dow);
    if (c.domAny && c.dowAny ? true : c.domAny ? dowOk : c.dowAny ? domOk : domOk || dowOk) return t;
  }
  throw new AutomateError('That schedule never fires', 'invalid_cron');
}

// ─────────────────────────────────────────── the graph (xeno-workflow's WorkflowDefinition, verbatim)

const str = (v, field, max, required = true) => {
  if (v == null || v === '') { if (required) throw new AutomateError(`${field} is required`, 'invalid_workflow'); return ''; }
  if (typeof v !== 'string') throw new AutomateError(`${field} must be text`, 'invalid_workflow');
  const s = v.replace(/\u0000/g, '').trim();
  if (required && !s) throw new AutomateError(`${field} is required`, 'invalid_workflow');
  if (s.length > max) throw new AutomateError(`${field} is longer than ${max} characters`, 'invalid_workflow');
  return s;
};

/**
 * Check a graph and derive what the platform needs from it. The runner checks node types again before running; this
 * catches, at save time, what would otherwise fail on the first run: an unknown action, a secret typed into the graph,
 * an irreversible capability (a headless key never passes step-up), a malformed schedule.
 */
export function analyseGraph(graph, { catalogue = null } = {}) {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) throw new AutomateError('A workflow graph is an object with nodes and edges', 'invalid_workflow');
  if (Buffer.byteLength(JSON.stringify(graph)) > MAX_GRAPH_BYTES) throw new AutomateError('This workflow is too large', 'invalid_workflow');
  const nodes = graph.nodes, edges = graph.edges ?? [];
  if (!Array.isArray(nodes) || !nodes.length) throw new AutomateError('A workflow needs at least one step', 'invalid_workflow');
  if (!Array.isArray(edges)) throw new AutomateError('edges must be a list', 'invalid_workflow');
  if (nodes.length > MAX_NODES || edges.length > MAX_EDGES) throw new AutomateError(`A workflow has at most ${MAX_NODES} steps and ${MAX_EDGES} connections`, 'invalid_workflow');
  const known = catalogue ? new Map(catalogue.map((n) => [n.type, n])) : null;
  const ids = new Set();
  const outNodes = nodes.map((n) => {
    if (!n || typeof n !== 'object') throw new AutomateError('Every step is an object', 'invalid_workflow');
    const id = str(n.id, 'A step id', 100), type = str(n.type, 'A step type', 100);
    if (ids.has(id)) throw new AutomateError(`Two steps share the id ${id}`, 'invalid_workflow');
    ids.add(id);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(type)) throw new AutomateError(`Not a step type: ${type}`, 'invalid_workflow');
    if (known && !known.has(type)) throw new AutomateError(`The step "${n.label || id}" uses ${type}, which runs only in the XENO Workflow desktop app`, 'node_not_available');
    const config = n.config && typeof n.config === 'object' && !Array.isArray(n.config) ? n.config : {};
    const secretKeys = known ? (known.get(type).secretFields || []) : (SECRET_FIELDS_FALLBACK[type] || []);
    for (const k of secretKeys) {
      const v = config[k];
      if (typeof v === 'string' && v.trim() && !v.startsWith('$cred:')) throw new AutomateError(`The step "${n.label || id}" has a secret typed into ${k}. Workspace workflows never store secrets; call a workspace action instead.`, 'secret_in_graph');
    }
    const pos = n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y) ? { x: n.position.x, y: n.position.y } : { x: 0, y: 0 };
    return { id, type, label: typeof n.label === 'string' ? n.label.slice(0, 200) : id, config, position: pos, ...(n.disabled ? { disabled: true } : {}), ...(n.errorHandling ? { errorHandling: n.errorHandling } : {}) };
  });
  const outEdges = edges.map((e, i) => {
    if (!e || !ids.has(e.source) || !ids.has(e.target)) throw new AutomateError('A connection points at a step that does not exist', 'invalid_workflow');
    return { id: typeof e.id === 'string' ? e.id.slice(0, 100) : `e${i}`, source: e.source, sourcePort: String(e.sourcePort || ''), target: e.target, targetPort: String(e.targetPort || ''), ...(e.kind === 'exec' || e.kind === 'data' ? { kind: e.kind } : {}) };
  });

  const triggers = outNodes.filter((n) => n.type === TRIGGER_TYPE && !n.disabled);
  if (triggers.length > 1) throw new AutomateError('A workflow starts from exactly one workspace event', 'invalid_workflow');
  let event = null, triggerConfig = {};
  if (triggers.length) {
    const c = triggers[0].config;
    event = String(c.event || '');
    if (!EVENTS.includes(event)) throw new AutomateError(`Not a workspace event: ${event || '(none)'}`, 'invalid_trigger');
    if (event === 'task.status_changed') {
      const s = String(c.taskStatus || '');
      if (s && !TASK_STATUSES.includes(s)) throw new AutomateError(`Not a task status: ${s}`, 'invalid_trigger');
      triggerConfig = s ? { taskStatus: s } : {};
    } else if (event === 'support.ticket_created') {
      const k = String(c.ticketKind || '').trim();
      if (k && !/^[a-z_]{2,30}$/.test(k)) throw new AutomateError('Not a ticket kind', 'invalid_trigger');
      triggerConfig = k ? { ticketKind: k } : {};
    } else if (event === 'form.response_submitted') {
      const f = String(c.formId || '').trim();
      triggerConfig = f ? { formId: f.slice(0, 200) } : {};
    } else if (event === 'schedule') {
      const cron = str(c.cron, 'Schedule', 120), timezone = String(c.timezone || 'UTC').trim() || 'UTC';
      parseCron(cron);
      if (!validateIanaTimeZone(timezone)) throw new AutomateError(`Not a time zone: ${timezone}`, 'invalid_trigger');
      triggerConfig = { cron, timezone };
    }
  }

  const caps = new Set();
  for (const n of outNodes.filter((x) => x.type === ACTION_TYPE)) {
    const name = String(n.config.capability || '').trim();
    if (!CAPABILITY_NAME.test(name)) throw new AutomateError(`The step "${n.label}" names no workspace action`, 'invalid_action');
    const cap = byName.get(name);
    if (!cap || !cap.surfaces.includes('rest')) throw new AutomateError(`Unknown workspace action: ${name}`, 'invalid_action');
    if (cap.class === 'irreversible') throw new AutomateError(`${name} cannot be undone, so it needs a person on screen; a workflow cannot do it`, 'action_needs_person');
    if (cap.mode === 'on-screen-only' || cap.agentsOnly) throw new AutomateError(`${name} cannot run in a workflow`, 'invalid_action');
    caps.add(name);
  }
  const capabilities = [...caps].sort();
  // a write scope carries its area's read scope (an area's services read what they change — XENO Tasks refuses a
  // tasks:write credential without tasks:read). Scopes are only the ceiling: the grants are the capabilities above.
  const withRead = (sc) => { const [area, level] = sc.split(':'); return level === 'read' ? [sc] : [sc, `${area}:read`]; };
  const scopes = [...new Set(capabilities.flatMap((c) => withRead(byName.get(c).scope)))].filter((s) => WORKSPACE_SCOPES.includes(s)).sort();
  const clean = {
    id: typeof graph.id === 'string' ? graph.id.slice(0, 100) : '', name: typeof graph.name === 'string' ? graph.name.slice(0, 200) : '',
    description: typeof graph.description === 'string' ? graph.description.slice(0, 2000) : '', version: Number.isInteger(graph.version) ? graph.version : 2,
    nodes: outNodes, edges: outEdges, variables: graph.variables && typeof graph.variables === 'object' && !Array.isArray(graph.variables) ? graph.variables : {},
    ...(Array.isArray(graph.groups) ? { groups: graph.groups } : {}), ...(Array.isArray(graph.stickyNotes) ? { stickyNotes: graph.stickyNotes } : {}),
    createdAt: typeof graph.createdAt === 'string' ? graph.createdAt : '', updatedAt: typeof graph.updatedAt === 'string' ? graph.updatedAt : '',
  };
  return { graph: clean, event, triggerConfig, capabilities, scopes };
}

/** A starter graph: a workspace event → one workspace action, wired the way the xeno-workflow editor wires it. */
export function starterGraph(event = 'task.status_changed') {
  return {
    id: '', name: '', description: '', version: 2, variables: {}, createdAt: '', updatedAt: '',
    nodes: [
      { id: 'trigger', type: TRIGGER_TYPE, label: 'When', config: { event, taskStatus: 'done', ticketKind: '', formId: '', cron: '0 9 * * 1-5', timezone: 'UTC' }, position: { x: 0, y: 0 } },
    ],
    edges: [],
  };
}

// ─────────────────────────────────────────── views

const view = (w, { canEdit = false } = {}) => ({
  id: String(w.id), workspaceId: String(w.workspace_id), name: w.name, description: w.description, graph: w.graph,
  trigger: w.trigger_event ? { event: w.trigger_event, ...w.trigger_config } : null,
  capabilities: w.capabilities || [], scopes: w.scopes || [],
  state: w.state, disabledReason: w.disabled_reason || null, failureThreshold: w.failure_threshold, consecutiveFailures: w.consecutive_failures,
  webhookPath: w.trigger_event === 'webhook' ? `/api/automate/hooks/${w.id}` : null, hasWebhookSecret: !!w.webhook_secret_enc,
  nextRunAt: w.next_run_at, createdByKind: w.created_by_kind, enabledBy: w.enabled_by ? String(w.enabled_by) : null, enabledAt: w.enabled_at,
  revision: w.revision, createdAt: w.created_at, updatedAt: w.updated_at, canEdit,
});
const runView = (r) => ({
  id: String(r.id), workflowId: String(r.workflow_id), workflowName: r.workflow_name || undefined, trigger: r.trigger_event, state: r.state,
  attempt: r.attempt, resumed: !!r.resumed, executionId: r.execution_id || null, steps: r.steps || [], error: r.error || null, errorCode: r.error_code || null,
  input: r.input, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, availableAt: r.available_at,
});

async function loadOwned(db, actor, id, need = 'viewer') {
  if (!UUID.test(String(id || ''))) throw new AutomateError('Workflow not found', 'not_found', 404);
  const w = (await db.query('SELECT * FROM workspace_workflows WHERE id = $1 AND deleted_at IS NULL', [id])).rows[0];
  if (!w) throw new AutomateError('Workflow not found', 'not_found', 404);
  let sc;
  try { sc = await scopeFor(db, actor, w.workspace_id, need); }
  catch (e) { if (e.code === 'not_a_member') throw new AutomateError('Workflow not found', 'not_found', 404); throw e; }
  return { w, sc };
}

// ─────────────────────────────────────────── operations (REST, MCP and the screen all call these)

export async function status(db, actor, { workspace } = {}) {
  const sc = await scopeFor(db, actor, workspace, 'viewer');
  return { configured: !!runnerBase(), workspaceId: sc.workspaceId, canEdit: await isAdmin(db, sc.workspaceId, sc.userId), events: EVENTS };
}

export async function listWorkflows(db, actor, { workspace } = {}) {
  const sc = await scopeFor(db, actor, workspace, 'viewer');
  const canEdit = await isAdmin(db, sc.workspaceId, sc.userId);
  const rows = (await db.query(`SELECT w.*, (SELECT row_to_json(x) FROM (SELECT r.state, r.finished_at, r.created_at FROM workspace_workflow_runs r WHERE r.workflow_id = w.id ORDER BY r.created_at DESC LIMIT 1) x) AS last_run
    FROM workspace_workflows w WHERE w.workspace_id = $1 AND w.deleted_at IS NULL ORDER BY w.updated_at DESC LIMIT 500`, [sc.workspaceId])).rows;
  const failed = (await db.query(`SELECT count(*)::int AS n FROM workspace_workflow_runs WHERE workspace_id = $1 AND state IN ('failed','dead') AND created_at > now() - interval '7 days'`, [sc.workspaceId])).rows[0].n;
  return { workflows: rows.map((w) => ({ ...view(w, { canEdit }), graph: undefined, steps: (w.graph.nodes || []).length, lastRun: w.last_run || null })), canEdit, recentFailures: failed, configured: !!runnerBase() };
}

export async function getWorkflow(db, actor, id) {
  const { w, sc } = await loadOwned(db, actor, id, 'viewer');
  return { workflow: view(w, { canEdit: await isAdmin(db, sc.workspaceId, sc.userId) }) };
}

async function maybeCatalogue(db, actor, workspace) {
  if (!runnerBase()) return null;
  try { return await runnerCatalogue(db, actor, { workspace }); } catch { return null; }
}

export async function createWorkflow(db, actor, { workspace, name, description, graph, failureThreshold } = {}) {
  const sc = await scopeFor(db, actor, workspace, 'admin');
  const a = analyseGraph(graph || starterGraph(), { catalogue: await maybeCatalogue(db, actor, sc.workspaceId) });
  const fth = failureThreshold == null ? 5 : Number(failureThreshold);
  if (!Number.isInteger(fth) || fth < 1 || fth > 100) throw new AutomateError('Turn off after 1 to 100 failed runs', 'invalid_workflow');
  const secret = a.event === 'webhook' ? crypto.randomBytes(32).toString('base64url') : null;
  const row = (await db.query(`INSERT INTO workspace_workflows (workspace_id, name, description, graph, trigger_event, trigger_config, capabilities, scopes, failure_threshold, webhook_secret_enc, created_by, created_by_kind, updated_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11) RETURNING *`,
  [sc.workspaceId, str(name, 'Name', 200), str(description, 'Description', 2000, false), a.graph, a.event, a.triggerConfig, a.capabilities, a.scopes, fth, secret ? encrypt(secret) : null, sc.agentId || sc.userId, sc.kind === 'agent' ? 'agent' : 'human'])).rows[0];
  return { workflow: view(row, { canEdit: true }), ...(secret ? { webhookSecret: secret } : {}) };
}

/** Grant the workflow's agent exactly its capabilities in its workspace (and take back anything it no longer calls). */
async function syncGrants(db, w, capabilities) {
  if (!w.agent_user_id) return;
  await creds.revokeGrants(db, w.agent_user_id, w.workspace_id);
  if (capabilities.length) await creds.grant(db, w.agent_user_id, w.workspace_id, capabilities);
}

export async function updateWorkflow(db, actor, id, { name, description, graph, failureThreshold, expectedRevision } = {}) {
  const { w, sc } = await loadOwned(db, actor, id, 'admin');
  if (expectedRevision != null && Number(expectedRevision) !== w.revision) throw new AutomateError('Someone changed this workflow first. Reload it and try again.', 'conflict', 409);
  const a = graph !== undefined ? analyseGraph(graph, { catalogue: await maybeCatalogue(db, actor, w.workspace_id) }) : { graph: w.graph, event: w.trigger_event, triggerConfig: w.trigger_config, capabilities: w.capabilities, scopes: w.scopes };
  const fth = failureThreshold == null ? w.failure_threshold : Number(failureThreshold);
  if (!Number.isInteger(fth) || fth < 1 || fth > 100) throw new AutomateError('Turn off after 1 to 100 failed runs', 'invalid_workflow');
  // agents propose, humans ratify: an agent's change to a running workflow takes it back to a draft
  const toDraft = sc.kind === 'agent' && w.state === 'enabled';
  const newSecret = a.event === 'webhook' && !w.webhook_secret_enc ? crypto.randomBytes(32).toString('base64url') : null;
  const stillEnabled = w.state === 'enabled' && !toDraft;
  const next = stillEnabled && a.event === 'schedule' ? nextCron(a.triggerConfig.cron, a.triggerConfig.timezone) : null;
  const row = (await db.query(`UPDATE workspace_workflows SET name = $2, description = $3, graph = $4, trigger_event = $5, trigger_config = $6, capabilities = $7, scopes = $8, failure_threshold = $9,
      webhook_secret_enc = COALESCE($10, webhook_secret_enc), state = CASE WHEN $11 THEN 'draft' ELSE state END, disabled_reason = CASE WHEN $11 THEN 'Changed by an agent: a person turns it back on' ELSE disabled_reason END,
      next_run_at = $12, updated_by = $13, revision = revision + 1, updated_at = now() WHERE id = $1 AND revision = $14 RETURNING *`,
  [w.id, name !== undefined ? str(name, 'Name', 200) : w.name, description !== undefined ? str(description, 'Description', 2000, false) : w.description, a.graph, a.event, a.triggerConfig, a.capabilities, a.scopes, fth,
    newSecret ? encrypt(newSecret) : null, toDraft, next, sc.agentId || sc.userId, w.revision])).rows[0];
  if (!row) throw new AutomateError('Someone changed this workflow first. Reload it and try again.', 'conflict', 409);
  if (toDraft) await creds.revokeGrants(db, w.agent_user_id, w.workspace_id);
  else if (stillEnabled) await syncGrants(db, row, a.capabilities);
  return { workflow: view(row, { canEdit: true }), ...(newSecret ? { webhookSecret: newSecret } : {}) };
}

/** Turn a workflow on. A PERSON who is an admin; it then runs for them, through its own agent. */
export async function enableWorkflow(db, actor, id, { fetchImpl } = {}) {
  const { w, sc } = await loadOwned(db, actor, id, 'admin');
  if (sc.kind !== 'human') throw new AutomateError('Only a person turns a workflow on', 'human_required', 403);
  if (!runnerBase()) throw new AutomateError('Automate is not set up on this server yet', 'automate_not_configured', 503);
  // the runner's own catalogue decides what can run; check against it now rather than on the first run
  const cat = await runnerCatalogue(db, actor, { workspace: w.workspace_id, fetchImpl, fresh: true });
  const a = analyseGraph(w.graph, { catalogue: cat });
  if (!a.event) throw new AutomateError('Add a "XENO Workspace Event" step so the workflow knows when to run', 'no_trigger');
  // an agent handle is <name>.<owner handle>, at most 32 characters, so the name stays short: "flow-<6 hex>"
  const label = `Flow ${String(w.id).slice(0, 6)}`;
  let agentId = w.agent_user_id;
  if (!agentId) {
    try { agentId = await mcpAgentFor(db, sc.userId, label); }
    catch (e) { if (e && e.code === 'invalid_handle') throw new AutomateError('Your handle is too long to give this workflow its own agent (handles are at most 32 characters with the agent name).', 'agent_name', 409); throw e; }
  }
  const named = (await db.query('SELECT COALESCE(u.display_name, u.username) AS name FROM users u WHERE u.id = $1', [agentId])).rows[0];
  if (!w.agent_user_id && (!named || named.name !== label)) throw new AutomateError('You have reached your agent limit. Remove an agent or key to turn on another workflow.', 'agent_cap');
  const next = a.event === 'schedule' ? nextCron(a.triggerConfig.cron, a.triggerConfig.timezone) : null;
  const row = (await db.query(`UPDATE workspace_workflows SET state = 'enabled', enabled_by = $2, enabled_at = now(), agent_user_id = $3, disabled_reason = NULL, consecutive_failures = 0,
      capabilities = $4, scopes = $5, next_run_at = $6, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *`, [w.id, sc.userId, agentId, a.capabilities, a.scopes, next])).rows[0];
  await syncGrants(db, row, a.capabilities);
  return { workflow: view(row, { canEdit: true }) };
}

async function turnOff(db, w, reason) {
  const row = (await db.query(`UPDATE workspace_workflows SET state = 'disabled', disabled_reason = $2, next_run_at = NULL, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *`, [w.id, reason])).rows[0];
  if (w.agent_user_id) await creds.revokeGrants(db, w.agent_user_id, w.workspace_id);
  return row;
}
/** Turn a workflow off. Anyone allowed to write it — an agent too: stopping is the safe direction. */
export async function disableWorkflow(db, actor, id) {
  const { w } = await loadOwned(db, actor, id, 'admin');
  return { workflow: view(await turnOff(db, w, 'Turned off'), { canEdit: true }) };
}

export async function deleteWorkflow(db, actor, id) {
  const { w, sc } = await loadOwned(db, actor, id, 'admin');
  if (sc.kind !== 'human') throw new AutomateError('Only a person deletes a workflow', 'human_required', 403);
  if (w.agent_user_id) await creds.revokeGrants(db, w.agent_user_id, w.workspace_id);
  await db.query(`UPDATE workspace_workflows SET deleted_at = now(), state = 'disabled', next_run_at = NULL, updated_at = now() WHERE id = $1`, [w.id]);
  await db.query(`UPDATE workspace_workflow_runs SET state = 'discarded', finished_at = now() WHERE workflow_id = $1 AND state = 'queued'`, [w.id]);
  return { deleted: true };
}

export async function rotateWebhookSecret(db, actor, id) {
  const { w, sc } = await loadOwned(db, actor, id, 'admin');
  if (sc.kind !== 'human') throw new AutomateError('Only a person sees a webhook secret', 'human_required', 403);
  if (w.trigger_event !== 'webhook') throw new AutomateError('This workflow does not start from a webhook', 'not_webhook');
  const secret = crypto.randomBytes(32).toString('base64url');
  await db.query('UPDATE workspace_workflows SET webhook_secret_enc = $2, updated_at = now() WHERE id = $1', [w.id, encrypt(secret)]);
  return { webhookSecret: secret };
}

/** Run an enabled workflow now, as a person. The trigger step receives a `manual` event. */
export async function runNow(db, actor, id, { event = {} } = {}) {
  const { w, sc } = await loadOwned(db, actor, id, 'admin');
  if (sc.kind !== 'human') throw new AutomateError('Only a person starts a run by hand', 'human_required', 403);
  if (w.state !== 'enabled') throw new AutomateError('Turn the workflow on first', 'not_enabled', 409);
  const r = (await db.query(`INSERT INTO workspace_workflow_runs (workflow_id, workspace_id, event_key, trigger_event, input, graph_revision, requested_by) VALUES ($1,$2,$3,'manual',$4,$5,$6) RETURNING *`,
    [w.id, w.workspace_id, `manual:${crypto.randomUUID()}`, event && typeof event === 'object' && !Array.isArray(event) ? event : {}, w.revision, sc.userId])).rows[0];
  return { run: runView(r) };
}

export async function listRuns(db, actor, { workspace, workflowId, state, limit = 50 } = {}) {
  let ws;
  if (workflowId) ws = (await loadOwned(db, actor, workflowId, 'viewer')).w.workspace_id;
  else ws = (await scopeFor(db, actor, workspace, 'viewer')).workspaceId;
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const states = state === 'failed' ? ['failed', 'dead'] : state ? [String(state)] : null;
  const rows = (await db.query(`SELECT r.*, w.name AS workflow_name FROM workspace_workflow_runs r JOIN workspace_workflows w ON w.id = r.workflow_id
    WHERE r.workspace_id = $1 AND ($2::uuid IS NULL OR r.workflow_id = $2) AND ($3::text[] IS NULL OR r.state = ANY($3)) ORDER BY r.created_at DESC LIMIT $4`, [ws, workflowId || null, states, lim])).rows;
  return { runs: rows.map(runView) };
}

async function ownedRun(db, actor, runId, need) {
  if (!UUID.test(String(runId || ''))) throw new AutomateError('Run not found', 'not_found', 404);
  const r = (await db.query('SELECT r.*, w.name AS workflow_name FROM workspace_workflow_runs r JOIN workspace_workflows w ON w.id = r.workflow_id WHERE r.id = $1', [runId])).rows[0];
  if (!r) throw new AutomateError('Run not found', 'not_found', 404);
  const { sc } = await loadOwned(db, actor, r.workflow_id, need);
  return { r, sc };
}
export async function getRun(db, actor, runId) { return { run: runView((await ownedRun(db, actor, runId, 'viewer')).r) }; }

/** Deliver a dead or failed run again (a person decides). Same run id: the runner answers or resumes, never repeats. */
export async function retryRun(db, actor, runId) {
  const { r, sc } = await ownedRun(db, actor, runId, 'admin');
  if (sc.kind !== 'human') throw new AutomateError('A person decides about a failed run', 'human_required', 403);
  if (!['dead', 'failed'].includes(r.state)) throw new AutomateError('Only a failed run can be tried again', 'not_failed', 409);
  const row = (await db.query(`UPDATE workspace_workflow_runs SET state = 'queued', attempt = 0, available_at = now(), lease_until = NULL, error = NULL, error_code = NULL, finished_at = NULL WHERE id = $1 RETURNING *`, [r.id])).rows[0];
  return { run: runView(row) };
}
export async function discardRun(db, actor, runId) {
  const { r, sc } = await ownedRun(db, actor, runId, 'admin');
  if (sc.kind !== 'human') throw new AutomateError('A person decides about a failed run', 'human_required', 403);
  if (!['dead', 'failed', 'queued'].includes(r.state)) throw new AutomateError('This run cannot be discarded', 'not_discardable', 409);
  const row = (await db.query(`UPDATE workspace_workflow_runs SET state = 'discarded', finished_at = now() WHERE id = $1 RETURNING *`, [r.id])).rows[0];
  return { run: runView(row) };
}

// ─────────────────────────────────────────── platform events → runs (idempotent per event; never throws into callers)

/**
 * Queue one run for every ENABLED workflow of `workspaceId` listening for `event` whose filter matches. A workflow's
 * own agent causing the event does not re-trigger it, and a workflow firing faster than LOOP_LIMIT is turned off.
 */
export async function emitEvent(db, { workspaceId, event, eventKey, input = {}, match = () => true, actorId = null }) {
  if (!workspaceId || !EVENTS.includes(event) || !eventKey) return { queued: 0 };
  const flows = (await db.query(`SELECT * FROM workspace_workflows WHERE workspace_id = $1 AND state = 'enabled' AND deleted_at IS NULL AND trigger_event = $2`, [workspaceId, event])).rows;
  let n = 0;
  for (const w of flows) {
    if (actorId && w.agent_user_id && String(w.agent_user_id) === String(actorId)) continue;
    if (!match(w.trigger_config || {})) continue;
    const recent = (await db.query(`SELECT count(*)::int AS n FROM workspace_workflow_runs WHERE workflow_id = $1 AND created_at > now() - make_interval(mins => $2)`, [w.id, LOOP_LIMIT.windowMinutes])).rows[0].n;
    if (recent >= LOOP_LIMIT.runs) { await turnOff(db, w, `Started ${recent} runs in ${LOOP_LIMIT.windowMinutes} minutes, so it was turned off (a loop?)`); continue; }
    n += (await db.query(`INSERT INTO workspace_workflow_runs (workflow_id, workspace_id, event_key, trigger_event, input, graph_revision) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (workflow_id, event_key) DO NOTHING`,
      [w.id, workspaceId, String(eventKey).slice(0, 300), event, input, w.revision])).rowCount;
  }
  return { queued: n };
}

/** Which workspace a task belongs to: its project's, or its owner's Personal workspace. */
async function taskWorkspace(db, task) {
  const r = (await db.query(`SELECT p.workspace_id, p.owner_user_id AS p_owner, t.owner_user_id FROM tasks t LEFT JOIN chat_projects p ON p.id = t.project_id WHERE t.id = $1`, [task.id])).rows[0];
  if (!r) return null;
  if (r.workspace_id) return String(r.workspace_id);
  const owner = r.p_owner || r.owner_user_id; if (!owner) return null;
  const w = (await db.query(`SELECT id FROM workspaces WHERE owner_user_id = $1 AND workspace_type = 'personal' LIMIT 1`, [owner])).rows[0];
  return w ? String(w.id) : null;
}
/** xenoTasks.transitionTask, after a move. */
export async function onTaskStatus(db, { task, from, to, eventId, actorId }) {
  try {
    const ws = await taskWorkspace(db, task); if (!ws) return;
    await emitEvent(db, { workspaceId: ws, event: 'task.status_changed', eventKey: `task-event:${eventId || `${task.id}:${from}:${to}:${Date.now()}`}`, actorId,
      input: { task: { key: `T-${task.number}`, id: String(task.id), title: task.title, priority: task.priority || null, projectId: task.project_id ? String(task.project_id) : null, status: to }, from, to, actorId: actorId ? String(actorId) : null },
      match: (t) => !t.taskStatus || t.taskStatus === to });
  } catch (e) { console.error('[Automate] task event not delivered:', e && e.message); }
}
/** supportTickets.createTicket, after the ticket exists. */
export async function onSupportTicket(db, ticket, { actorId = null } = {}) {
  try {
    if (!ticket || !ticket.workspace_id) return;
    await emitEvent(db, { workspaceId: String(ticket.workspace_id), event: 'support.ticket_created', eventKey: `support-ticket:${ticket.id}`, actorId,
      // the ticket is the requester's conversation with XENO: the event carries no title or body. A step that needs more
      // reads it through support.ticket.get, which applies the requester-or-staff rule to the person the workflow runs for.
      input: { ticket: { key: `T-${ticket.number}`, id: String(ticket.id), kind: ticket.kind, priority: ticket.priority || null, createdAt: ticket.created_at || null } },
      match: (t) => !t.ticketKind || t.ticketKind === ticket.kind });
  } catch (e) { console.error('[Automate] ticket event not delivered:', e && e.message); }
}
/** A form surface reports an answer (the event every form product delivers; nothing else is assumed about it). */
export async function onFormResponse(db, { workspaceId, formId, formTitle = null, responseId, answers = {}, actorId = null }) {
  try {
    if (!workspaceId || !formId || !responseId) return { queued: 0 };
    return await emitEvent(db, { workspaceId: String(workspaceId), event: 'form.response_submitted', eventKey: `form-response:${responseId}`, actorId,
      input: { form: { id: String(formId), title: formTitle }, response: { id: String(responseId), answers } },
      match: (t) => !t.formId || String(t.formId) === String(formId) });
  } catch (e) { console.error('[Automate] form event not delivered:', e && e.message); return { queued: 0 }; }
}

/** `X-Xeno-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`, `X-Xeno-Timestamp` (ms), within 5 minutes. */
export function signWebhook(secret, timestamp, raw) { return 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex'); }
export async function receiveWebhook(db, { id, raw, signature, timestamp, deliveryId, now = Date.now() }) {
  const bad = () => new AutomateError('Signature does not verify', 'bad_signature', 401);
  if (!UUID.test(String(id || ''))) throw new AutomateError('Not found', 'not_found', 404);
  const w = (await db.query(`SELECT * FROM workspace_workflows WHERE id = $1 AND deleted_at IS NULL AND trigger_event = 'webhook'`, [id])).rows[0];
  if (!w || !w.webhook_secret_enc) throw new AutomateError('Not found', 'not_found', 404);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > WEBHOOK_TOLERANCE_MS) throw bad();
  const body = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw ?? ''), 'utf8');
  const want = Buffer.from(signWebhook(decrypt(w.webhook_secret_enc), ts, body)), got = Buffer.from(String(signature || ''));
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) throw bad();
  if (w.state !== 'enabled') throw new AutomateError('This workflow is off', 'workflow_off', 409);
  let parsed; const text = body.toString('utf8');
  try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 20000); }
  const key = deliveryId ? `webhook:${String(deliveryId).slice(0, 200)}` : `webhook:${crypto.createHash('sha256').update(`${ts}.`).update(body).digest('hex')}`;
  const r = await db.query(`INSERT INTO workspace_workflow_runs (workflow_id, workspace_id, event_key, trigger_event, input, graph_revision) VALUES ($1,$2,$3,'webhook',$4,$5) ON CONFLICT (workflow_id, event_key) DO NOTHING RETURNING id`,
    [w.id, w.workspace_id, key, { body: parsed, deliveryId: deliveryId || null, receivedAt: new Date(now).toISOString() }, w.revision]);
  return { accepted: true, duplicate: !r.rowCount };
}

/** schedule: claim due workflows under row locks, queue one run per occurrence, move next_run_at on. */
export async function enqueueDueSchedules(db, { now = new Date(), batch = 50 } = {}) {
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  let n = 0;
  try {
    await client.query('BEGIN');
    const due = (await client.query(`SELECT * FROM workspace_workflows WHERE state = 'enabled' AND deleted_at IS NULL AND trigger_event = 'schedule' AND next_run_at IS NOT NULL AND next_run_at <= $1
      ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT $2`, [now, batch])).rows;
    for (const w of due) {
      const at = new Date(w.next_run_at);
      n += (await client.query(`INSERT INTO workspace_workflow_runs (workflow_id, workspace_id, event_key, trigger_event, input, graph_revision) VALUES ($1,$2,$3,'schedule',$4,$5) ON CONFLICT (workflow_id, event_key) DO NOTHING`,
        [w.id, w.workspace_id, `schedule:${at.toISOString()}`, { scheduledFor: at.toISOString(), cron: w.trigger_config.cron, timezone: w.trigger_config.timezone }, w.revision])).rowCount;
      // a missed window (the platform was down) fires once, then continues from now — never a burst of catch-up runs
      await client.query('UPDATE workspace_workflows SET next_run_at = $2 WHERE id = $1', [w.id, nextCron(w.trigger_config.cron, w.trigger_config.timezone, now > at ? now : at)]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { if (client !== db) client.release(); }
  return n;
}

// ─────────────────────────────────────────── delivery to the runner (the one scheduler, leader-only)

const backoffMs = (attempt) => Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60_000);

/** Claim due runs: queued and available, or running with an expired lease (a worker died mid-delivery). */
export async function claimRuns(db, { worker = `w${process.pid}`, batch = 4, now = new Date() } = {}) {
  return (await db.query(`UPDATE workspace_workflow_runs SET state = 'running', attempt = attempt + 1, lease_until = $2, leased_by = $3, started_at = COALESCE(started_at, now())
    WHERE id IN (SELECT id FROM workspace_workflow_runs WHERE (state = 'queued' AND available_at <= $1) OR (state = 'running' AND lease_until < $1)
      ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT $4) RETURNING *`, [now, new Date(now.getTime() + LEASE_MS), worker, batch])).rows;
}

async function finish(db, run, fields) {
  const keys = Object.keys(fields);
  await db.query(`UPDATE workspace_workflow_runs SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, lease_until = NULL WHERE id = $1`, [run.id, ...keys.map((k) => fields[k])]);
}
async function endKey(db, run) {
  if (run.key_id) await creds.revokeRunKey(db, run.key_id);
  await db.query('UPDATE workspace_workflow_runs SET key_enc = NULL WHERE id = $1', [run.id]);
}

/** Deliver ONE claimed run to the runner and record what happened. Never throws. */
export async function dispatchRun(db, run, { fetchImpl } = {}) {
  try {
    const w = (await db.query('SELECT * FROM workspace_workflows WHERE id = $1', [run.workflow_id])).rows[0];
    if (!w || w.deleted_at || w.state !== 'enabled') { await finish(db, run, { state: 'discarded', finished_at: new Date(), error: 'The workflow is no longer on' }); await endKey(db, run); return 'discarded'; }
    // the person it runs for must still be allowed to run it — otherwise it stops rather than act on stale authority
    const enabler = (await db.query('SELECT is_active, status FROM users WHERE id = $1', [w.enabled_by])).rows[0];
    if (!enabler || enabler.is_active === false || String(enabler.status || '').toLowerCase() === 'suspended' || !(await isAdmin(db, w.workspace_id, w.enabled_by))) {
      await turnOff(db, w, 'The person who turned it on is no longer an admin of this workspace');
      await finish(db, run, { state: 'failed', finished_at: new Date(), error: 'The person who turned it on is no longer an admin of this workspace', error_code: 'enabler_lost' });
      await endKey(db, run); return 'failed';
    }
    // one key per RUN (not per attempt): a re-delivery reuses it, so the runner's idempotency keys dedupe on one connection
    let credential = null;
    if (run.key_enc) { try { credential = decrypt(run.key_enc); } catch { credential = null; } }
    if (credential && credential !== 'none' && !(await creds.resolveKey(db, credential))) credential = null;
    if (!credential && !w.scopes.length) credential = 'none';   // calls no workspace action: there is nothing to grant
    if (!credential) {
      const k = await creds.createRunKey(db, { ownerId: w.enabled_by, agentId: w.agent_user_id, workspaceId: w.workspace_id, scopes: w.scopes, label: `Run ${String(run.id).slice(0, 8)} · ${w.name}`.slice(0, 80), minutes: 60 });
      credential = k.key;
      await db.query('UPDATE workspace_workflow_runs SET key_id = $2, key_enc = $3 WHERE id = $1', [run.id, k.id, encrypt(k.key)]);
      run.key_id = k.id;
    }
    const body = { runId: String(run.id), workspaceId: String(w.workspace_id), workflow: { ...w.graph, id: String(w.id), name: w.name }, trigger: { type: run.trigger_event, occurredAt: new Date(run.created_at).toISOString(), event: run.input || {} }, credential };
    let r;
    try { r = await callRunner(db, { userId: w.enabled_by, agentId: w.agent_user_id, workspaceId: w.workspace_id }, 'POST', '/v1/runs', { body, purpose: 'run', runId: String(run.id), timeoutMs: 6 * 60_000, fetchImpl }); }
    catch (e) { r = { status: 0, data: null, error: e }; }
    const out = r.data && r.data.run;
    if (r.status === 200 && out) {
      const ok = out.status === 'success';
      await finish(db, run, { state: ok ? 'succeeded' : 'failed', finished_at: new Date(), execution_id: out.executionId || null, resumed: !!out.resumed, steps: JSON.stringify(out.steps || []), error: ok ? null : String(out.error || out.status).slice(0, 2000), error_code: ok ? null : 'run_failed' });
      if (ok) await db.query('UPDATE workspace_workflows SET consecutive_failures = 0 WHERE id = $1', [w.id]);
      else {
        const f = (await db.query('UPDATE workspace_workflows SET consecutive_failures = consecutive_failures + 1 WHERE id = $1 RETURNING consecutive_failures, failure_threshold', [w.id])).rows[0];
        if (f && f.consecutive_failures >= f.failure_threshold) await turnOff(db, w, `Failed ${f.consecutive_failures} runs in a row`);
      }
      await endKey(db, run); return ok ? 'succeeded' : 'failed';
    }
    // refused by the runner for a reason a retry cannot fix (a graph it cannot run, an assertion it does not accept)
    if (r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 408) {
      const code = (r.data && r.data.code) || `runner_${r.status}`;
      await finish(db, run, { state: 'failed', finished_at: new Date(), error: String((r.data && r.data.error) || `The runner refused the run (${r.status})`).slice(0, 2000), error_code: code });
      await endKey(db, run); return 'failed';
    }
    // unreachable, busy or 5xx: back off and deliver again; after MAX_ATTEMPTS it is dead and a person decides
    const why = r.error ? r.error.message : r.status === 429 ? 'The runner is busy' : `The runner answered ${r.status}`;
    if (run.attempt >= MAX_ATTEMPTS) { await finish(db, run, { state: 'dead', finished_at: new Date(), error: why, error_code: 'undeliverable' }); await endKey(db, run); return 'dead'; }
    const wait = Math.max(backoffMs(run.attempt), (r.retryAfter || 0) * 1000);
    await finish(db, run, { state: 'queued', available_at: new Date(Date.now() + wait), error: why, error_code: 'retrying' });
    return 'retrying';
  } catch (e) {
    console.error('[Automate] dispatch failed:', e && e.message);
    await finish(db, run, { state: 'queued', available_at: new Date(Date.now() + backoffMs(run.attempt)), error: 'Delivery failed on the platform', error_code: 'retrying' }).catch(() => {});
    return 'retrying';
  }
}

/** One scheduler pass: schedules due → runs queued → claimed runs delivered (in parallel, bounded). */
export async function sweep(db, { fetchImpl, batch = 4 } = {}) {
  await enqueueDueSchedules(db);
  if (!runnerBase()) return { delivered: 0 };
  const runs = await claimRuns(db, { batch });
  const outcomes = await Promise.all(runs.map((r) => dispatchRun(db, r, { fetchImpl })));
  return { delivered: runs.length, outcomes };
}
