/**
 * XENO MCP — one hosted MCP address for every agent (XENO AGENT SURFACES & CONNECTORS - SPEC.md §7).
 *
 * A ROUTING TABLE, not proxy code: each row is a category the person can turn on, the service that answers it,
 * and that service's tools. The gateway prefixes every tool with its category (`tasks_create_task`) — an
 * underscore, because some clients reject dots — so the prefix IS the route, and two services can both have a
 * `search` without colliding. A new service is a new row.
 *
 * Three rules this file exists to keep:
 *   1. A category a connection has turned off is neither LISTED nor CALLABLE. Hiding a tool that still answers
 *      would be a permission nobody revoked.
 *   2. One service failing fails alone: each call has its own timeout and comes back as a tool error, never as
 *      a broken session.
 *   3. The call log records metadata only — who, which tool, when, how long, how it ended. Never the arguments
 *      or the result: those are the person's content.
 */
import * as tasksMcp from './tasksMcp.js';
import * as tasks from './xenoTasks.js';
import * as agentMediaMcp from './agentMediaMcp.js';
import * as agentMedia from './agentMedia.js';
import * as canvasMcp from './canvasMcp.js';
import * as placesMcp from './placesMcp.js';
import * as modesMcp from './modesMcp.js';
import * as corpusMcp from './corpusMcp.js';
import * as canvases from './canvases.js';
import * as agentsMcp from './agentsMcp.js';
import * as storageMcp from './storageMcp.js';
import * as supportMcp from './supportMcp.js';
import * as publishMcp from './publishMcp.js';
import * as analyticsMcp from './analyticsMcp.js';
import * as docsMcp from './docsMcp.js';
import * as workforceMcp from './workforceMcp.js';
import * as forumMcp from './forumMcp.js';
import { resolvePrincipal } from './agentIdentity.js';
import * as creds from './workspaceCredentials.js';
import { personalWorkspace } from './workforceDivisions.js';
import { withTransaction } from './chatProjectAuthority.js';
import crypto from 'node:crypto';
import { CATALOGUE, byName, mcpCapabilities } from '../capabilities/catalogue.js';
import { toWire, fromWire } from '../capabilities/define.js';

export const PROTOCOL_VERSIONS = tasksMcp.PROTOCOL_VERSIONS;
export const PROTOCOL_VERSION = tasksMcp.PROTOCOL_VERSION;
const SEP = '_';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The routing table. `call` runs one of the service's own tools by its UNPREFIXED name, with the caller the
 * route resolved; `tools` is that service's own list. Tasks is called in-process — it lives in this server —
 * so a network hop would only add a way to fail.
 */
export const SERVICES = Object.freeze([
  {
    category: 'tasks', title: 'Tasks', version: '1.1.0', timeoutMs: 20_000,
    description: 'Projects and tasks: list, read, raise, take, move, comment and report progress.',
    tools: () => tasksMcp.TOOLS,
    call: (db, actor, name, args, ctx) => tasksMcp.callTool(db, actor, name, args, ctx),
    isToolError: (e) => e instanceof tasks.TaskError,
  },
  {
    category: 'canvas', title: 'Canvases', version: '1.0.0', timeoutMs: 30_000,
    description: 'Canvases: lay work out — tasks, notes, links and groups on one board, connected; tasks stay live on it.',
    tools: () => canvasMcp.TOOLS,
    call: (db, actor, name, args) => canvasMcp.callTool(db, actor, name, args),
    isToolError: (e) => e instanceof canvases.CanvasError,
  },
  {
    category: 'places', title: 'Places', version: '1.0.0', timeoutMs: 20_000,
    description: 'Places: the building of each workspace — floors, pods, desks and who works where, filtered to your scope.',
    tools: () => placesMcp.TOOLS,
    call: (db, actor, name, args) => placesMcp.callTool(db, actor, name, args),
    isToolError: (e) => e instanceof placesMcp.PlacesMcpError,
  },
  // custom modes + trade packs (modesMcp.js): list, plan and status for whoever administers the workspace (an agent,
  // for its owner); apply and revert need a human admin's confirmation and refuse an agent.
  {
    category: 'modes', title: 'Business setups', version: '1.0.0', timeoutMs: 20_000,
    description: 'Business setups ("custom modes"): plan a trade pack for a workspace; a human admin confirms it.',
    tools: () => modesMcp.TOOLS,
    call: (db, actor, name, args) => modesMcp.callTool(db, actor, name, args),
    isToolError: (e) => e instanceof modesMcp.ModesMcpError,
  },
  // XENO Corpus (corpusMcp.js): read a scope's verified truth, assess it, propose a change a PERSON ratifies.
  {
    category: 'corpus', title: 'Corpus', version: '1.0.0', timeoutMs: 20_000,
    description: 'Corpus: the verified truth of a workspace, division or project — tenets, signed verdicts, inherited doctrine; agents propose, people ratify.',
    tools: () => corpusMcp.TOOLS,
    call: (db, actor, name, args) => corpusMcp.callTool(db, actor, name, args),
    isToolError: (e) => e instanceof corpusMcp.CorpusMcpError,
  },
  // XENO Storage (storageMcp.js, WORKSPACE AGENT SURFACE P1): an agent works in its owner's Storage, the person in their own.
  {
    category: 'storage', title: 'Storage', version: '1.0.0', timeoutMs: 60_000,
    description: 'Storage: list and make folders, upload files, and share a folder by a link that needs sign-in.',
    tools: () => storageMcp.TOOLS,
    call: (db, actor, name, args) => storageMcp.callTool(db, actor, name, args),
    isToolError: (e) => e instanceof storageMcp.StorageMcpError,
  },
  // XENO-WORKFORCE-01 (workforceMcp.js): agents and teams, runs, divisions, objectives and funding — the same services
  {
    category: 'workforce', title: 'Workforce', version: '1.0.0', timeoutMs: 30_000,
    description: 'Workforce: agents and teams, run admission and revocation, divisions, objectives and project funding.',
    tools: () => workforceMcp.TOOLS,
    call: (db, actor, name, args) => workforceMcp.callTool(db, actor, name, args),
    isToolError: (e) => e instanceof workforceMcp.WorkforceMcpError,
  },
  // XENO Publish (publishMcp.js): XENO Post through the platform. Drafts and proposed times; a person publishes.
  {
    category: 'publish', title: 'Publish', version: '1.0.0', timeoutMs: 60_000,
    description: 'Publish (XENO Post): list channels and posts, write drafts, propose times a person confirms.',
    tools: () => publishMcp.TOOLS,
    call: (db, actor, name, args) => publishMcp.callTool(db, actor, name, args),
    isToolError: (e) => e instanceof publishMcp.PublishMcpError,
  },
  // XENO support (supportMcp.js): ask XENO for your owner, or — delegated — triage and DRAFT replies a person sends.
  {
    category: 'support', title: 'Support', version: '1.0.0', timeoutMs: 20_000,
    description: 'XENO support: raise and read private requests; a delegated support agent triages and drafts replies a person sends.',
    tools: () => supportMcp.TOOLS,
    call: (db, actor, name, args) => supportMcp.callTool(db, actor, name, args),
    isToolError: (e) => e instanceof supportMcp.SupportMcpError,
  },
  // XENO Docs and Notes (docsMcp.js): documents that are Storage files. Writes are new versions or trash: reversible.
  {
    category: 'docs', title: 'Docs and Notes', version: '1.0.0', timeoutMs: 30_000,
    description: 'Docs and Notes: list, search, read, create and edit documents and notes (Markdown, versioned in Storage), with backlinks.',
    tools: () => docsMcp.TOOLS,
    call: (db, actor, name, args) => docsMcp.callTool(db, actor, name, args),
    isToolError: (e) => e instanceof docsMcp.DocsMcpError,
  },
  // XENO Analytics (analyticsMcp.js): read-only metrics and saved dashboards of a workspace.
  {
    category: 'analytics', title: 'Analytics', version: '1.0.0', timeoutMs: 30_000,
    description: 'Analytics: read a workspace’s metrics (credits, tasks, storage, support, agent runs) and saved dashboards.',
    tools: () => analyticsMcp.TOOLS,
    call: (db, actor, name, args) => analyticsMcp.callTool(db, actor, name, args),
    isToolError: (e) => e instanceof analyticsMcp.AnalyticsMcpError,
  },
  // XENO Forum, folded in from /api/forum/mcp (kept): the same tools, the same function. Its wire names were
  // always `forum_<verb>`, so as a category the grandfathered alias is exactly the old name.
  {
    category: 'forum', title: 'Forum', version: '1.0.0', timeoutMs: 20_000,
    description: 'The XENO Forum: search answers, read threads, ask, reply, subscribe and flag.',
    tools: () => forumMcp.TOOLS.map((t) => ({ ...t, name: t.name.replace(/^forum_/, '') })),
    call: async (db, actor, name, args) => {
      const p = await resolvePrincipal(db, actor.id);
      const r = await forumMcp.callTool(db, { id: p.id, username: p.handle, display_name: p.displayName, role: p.role, kind: p.kind, owner: p.owner }, `forum_${name}`, args);
      return r && r.isError ? { ...r, structuredContent: r.structuredContent || { error: (r.content && r.content[0] && r.content[0].text) || 'Forum refused', code: 'forum_refused' } } : r;
    },
    isToolError: () => false,
  },
  // what an agent can learn about itself (agentsMcp.js). On by default for a platform agent's own credential
  // (AGENT_DEFAULT_CATEGORIES); an app sign-in turns it on in Dev › XENO MCP like any other category.
  {
    category: 'agents', title: 'Agents', version: '1.0.0', timeoutMs: 15_000, agentsOnly: true,
    description: 'Who you are on XENO: your agent id, workspace, division, owner, projects and budget.',
    tools: () => agentsMcp.TOOLS,
    call: (db, actor, name, args) => agentsMcp.callTool(db, actor, name, args),
    isToolError: (e) => e instanceof agentsMcp.AgentsMcpError,
  },
  // what an agent can make and use (agentMedia.js). Agents only: a person's own screens already do all of this.
  ...[
    ['image', 'Images', 'Make images from a prompt, billed to the agent’s owner and counted against its division’s budget.', agentMediaMcp.IMAGE, 180_000],
    ['video', 'Video', 'Make short videos from a prompt, billed to the agent’s owner and counted against its division’s budget.', agentMediaMcp.VIDEO, 180_000],
    ['library', 'Library', 'Read the files in the agent’s projects and the files it made, and add what it made to a project.', agentMediaMcp.LIBRARY, 30_000],
    ['chat', 'Chat', 'Ask a XENO model a question, billed to the agent’s owner and counted against its division’s budget.', agentMediaMcp.CHAT, 120_000],
  ].map(([category, title, description, svc, timeoutMs]) => ({
    category, title, version: '1.0.0', timeoutMs, description, agentsOnly: true,
    tools: () => svc.tools,
    call: (db, actor, name, args) => svc.call(db, actor, name, args),
    isToolError: (e) => e instanceof agentMedia.MediaError,
  })),
]);
export const CATEGORIES = Object.freeze(SERVICES.map((s) => s.category));
const byCategory = new Map(SERVICES.map((s) => [s.category, s]));

/**
 * Two names reach one tool. The canonical wire name `tasks__task__create` (generated from the capability
 * catalogue, SPEC §19.3) and the grandfathered `tasks_create_task` (§3: kept until no client calls it). Either way
 * the call lands on the same service row and tool, so the category gate and the code path are the same.
 * An unknown name routes nowhere.
 */
export function route(prefixed, services = SERVICES) {
  const name = String(prefixed || '');
  if (name.includes('__')) {
    const c = byName.get(fromWire(name));
    const s = c && c.surfaces.includes('mcp') && services.find((x) => x.category === c.bind.category);
    return s ? { service: s, tool: c.bind.tool, capability: c } : null;
  }
  for (const s of services) if (name.startsWith(s.category + SEP)) {
    const tool = name.slice(s.category.length + SEP.length);
    return { service: s, tool, capability: CATALOGUE.find((c) => c.bind.category === s.category && c.bind.tool === tool && c.surfaces.includes('mcp')) || null };
  }
  return null;
}

/** The categories a connection may reach, from what it stored — never from anything the client sends. */
export const enabledCategories = (connection, services = SERVICES) => (connection && Array.isArray(connection.categories) ? connection.categories : ['tasks']).filter((c) => services.some((s) => s.category === c));

/** WORKSPACE AGENT SURFACE P2: a workspace credential (OAuth on 'xeno-workspace', or an xwk_ key) is narrowed by scope. */
const workspaceTokenOf = (actor) => (actor && actor.token && actor.token.audience === 'xeno-workspace' ? actor.token : null);
const scopeAllows = (actor, c) => { const t = workspaceTokenOf(actor); return !t || (Array.isArray(t.scopes) && t.scopes.includes(c.scope)); };
/** The categories whose declarations a scope set reaches: what a workspace credential's connection starts with. */
export const categoriesForScopes = (scopes) => [...new Set(CATALOGUE.filter((c) => [].concat(scopes || []).includes(c.scope) && c.surfaces.includes('mcp')).map((c) => c.bind.category))];

/** May this caller, on this connection, reach this service row at all? One predicate for list, catalogue and call. */
const reachable = (s, on, actor) => on.has(s.category) && (!s.agentsOnly || (actor && actor.kind === 'agent'));

/**
 * The catalogue declarations THIS caller can use (SPEC §19.3). Nothing outside it is shown: a caller learns only
 * what it may call. ⚠️ Until per-capability grants land (§19.7 step 3) "may use" is the connection's categories
 * plus agentsOnly — the same predicate the call itself enforces.
 */
export function visibleCapabilities(connection, actor = null) {
  const on = new Set(enabledCategories(connection));
  return CATALOGUE.filter((c) => c.surfaces.includes('mcp') && byCategory.has(c.bind.category) && reachable(byCategory.get(c.bind.category), on, actor) && scopeAllows(actor, c));
}

/** The public shape of one declaration (no `bind`: where it executes is ours, not the caller's). */
export const publicDeclaration = (c) => ({
  name: c.name, wire: toWire(c.name), version: c.version, division: c.division, title: c.title, description: c.description,
  input: c.input, reply: c.reply, class: c.class, mode: c.mode, provenance: c.provenance, cost: c.cost, idempotency: c.idempotency,
  preview: c.preview, aliases: c.aliases, ...(c.agentsOnly ? { agentsOnly: true } : {}),
});

/** What a generated tool carries for an MCP client: standard annotations derived from the class, the rest in _meta. */
function generatedTool(c, serviceTitle) {
  return {
    name: toWire(c.name), title: `${serviceTitle}: ${c.title}`, description: c.description, inputSchema: c.input,
    annotations: { readOnlyHint: c.class === 'safe', destructiveHint: c.class === 'irreversible', idempotentHint: c.class === 'safe' || c.idempotency.strategy !== 'none', openWorldHint: false },
    _meta: {
      'xeno/name': c.name, 'xeno/version': c.version, 'xeno/division': c.division, 'xeno/class': c.class, 'xeno/mode': c.mode,
      'xeno/provenance': c.provenance, 'xeno/cost': c.cost, 'xeno/idempotency': c.idempotency, 'xeno/preview': c.preview,
      'xeno/reply': c.reply, 'xeno/aliases': c.aliases,
    },
  };
}

/** tools/list for one connection: only its categories. Each service's grandfathered names, then its generated ones. */
export function listTools(connection, actor = null) {
  const on = new Set(enabledCategories(connection));
  const legacyAllowed = (s, tool) => { if (!workspaceTokenOf(actor)) return true; const c = CATALOGUE.find((x) => x.bind.category === s.category && x.bind.tool === tool && x.surfaces.includes('mcp')); return Boolean(c && scopeAllows(actor, c)); };
  return SERVICES.filter((s) => reachable(s, on, actor)).flatMap((s) => [
    ...s.tools().filter((t) => legacyAllowed(s, t.name)).map(({ name, title, description, inputSchema, annotations }) => ({
      name: s.category + SEP + name, title: `${s.title}: ${title || name}`, description, inputSchema, ...(annotations ? { annotations } : {}),
    })),
    ...mcpCapabilities(s.category).filter((c) => scopeAllows(actor, c)).map((c) => generatedTool(c, s.title)),
  ]);
}

/** A stable version of what this caller sees: changes when a visible declaration changes. */
export const catalogueVersion = (caps) => crypto.createHash('sha256').update(JSON.stringify(caps.map(publicDeclaration))).digest('base64url').slice(0, 27);

const toolError = (text, code) => ({ isError: true, content: [{ type: 'text', text }], structuredContent: { error: text, code } });
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(Object.assign(new Error('timeout'), { mcpTimeout: true })), ms);
  promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

/** What the call actually charged, read from the reply's own fields; never a guess. */
export function chargedOf(capability, result) {
  if (!capability) return null;
  if (capability.cost.model === 'free') return { credits: 0, settled: true };
  const d = (result && result.structuredContent) || {};
  if (typeof d.credits === 'number') return { credits: d.credits, settled: true };
  if (typeof d.max_credits === 'number') return { reservedCredits: d.max_credits, settled: false, note: 'reserved at most; settled when the generation ends (see its get)' };
  return { credits: null, settled: false, note: 'this reply did not report a charge' };
}
const withMeta = (result, meta) => (result && typeof result === 'object' ? { ...result, _meta: { ...(result._meta || {}), ...meta } } : result);
const IDEMPOTENCY_TTL_SQL = "now() - interval '24 hours'";

/**
 * Run one tools/call for one connection. Returns the MCP result AND the metadata the log keeps; the log never
 * receives `args` or the result's content.
 *
 * ctx.idempotencyKey (the `Idempotency-Key` header): for a non-safe capability the first call with a key records
 * its result and every repeat replays it instead of acting again. ctx.runId fills a declared `run_id` argument.
 */
export async function callTool(db, actor, connection, prefixed, args = {}, ctx = {}, services = SERVICES) {
  const started = Date.now();
  const r = route(prefixed, services);
  const meta = (category, outcome, errorCode) => ({ tool: String(prefixed || '').slice(0, 120), category, outcome, errorCode: errorCode || null, latencyMs: Date.now() - started });
  if (!r || !r.service.tools().some((t) => t.name === r.tool)) return { result: toolError(`Unknown tool ${prefixed}`, 'unknown_tool'), log: meta(r ? r.service.category : 'unknown', 'refused', 'unknown_tool') };
  // rule 1: a category this connection has turned off cannot be called, whether or not the client listed it
  if (r.service.agentsOnly && !(actor && actor.kind === 'agent')) {
    return { result: toolError(`${r.service.title} tools are for agents. Sign in as one of your agents to use them.`, 'agents_only'), log: meta(r.service.category, 'refused', 'agents_only') };
  }
  if (!enabledCategories(connection, services).includes(r.service.category)) {
    return { result: toolError(`${r.service.title} is turned off for this connection. Turn it on in XENO: Dev › XENO MCP.`, 'category_disabled'), log: meta(r.service.category, 'refused', 'category_disabled') };
  }
  const cap = r.capability;
  const callArgs = { ...(args || {}) };
  // P2: a workspace credential needs the capability's scope, a grant of it in the acting workspace, and — for an
  // irreversible action or a large spend — a fresh sign-in. Refusals are tool errors (REST maps them to 403).
  const wt = workspaceTokenOf(actor);
  if (wt) {
    if (!cap) return { result: toolError(`${prefixed} has no capability declaration, so a workspace credential cannot call it`, 'scope_missing'), log: meta(r.service.category, 'refused', 'scope_missing') };
    if (!scopeAllows(actor, cap)) return { result: toolError(`This credential lacks the ${cap.scope} scope needed for ${cap.name}. Sign in again asking for it, or use a key that has it.`, 'scope_missing'), log: meta(r.service.category, 'refused', 'scope_missing') };
    const ws = ctx.workspaceId || (UUID_RE.test(String(callArgs.workspace || '')) ? String(callArgs.workspace) : null) || wt.workspaceId || await personalWorkspace(db, wt.ownerId);
    if (wt.workspaceId && ws !== wt.workspaceId) return { result: toolError('This key works in one workspace only', 'workspace_mismatch'), log: meta(r.service.category, 'refused', 'workspace_mismatch') };
    if (!(await creds.hasGrant(db, wt.agentUserId, cap.name, ws))) return { result: toolError(`${cap.name} is not granted to this app in that workspace. The person can grant it in XENO: Settings › Connected apps.`, 'grant_missing'), log: meta(r.service.category, 'refused', 'grant_missing') };
    const why = await creds.stepUpFor(db, cap, callArgs, actor);   // server-derived cost, never a caller-stated one
    if (why && !(wt.via === 'oauth' && creds.isFresh(wt.authTime))) {
      return { result: toolError(why === 'irreversible' ? `${cap.name} cannot be undone, so it needs a fresh sign-in (within 10 minutes). Sign in again with prompt=login.` : 'This spend is above the step-up limit, so it needs a fresh sign-in.', 'step_up_required'), log: meta(r.service.category, 'refused', 'step_up_required') };
    }
  }
  if (cap && ctx.runId && (cap.input.properties || {}).run_id && callArgs.run_id === undefined) callArgs.run_id = String(ctx.runId);
  // the key: the Idempotency-Key header, or the capability's own declared key argument (request_key) when only that was sent
  const argKey = cap && cap.idempotency.strategy === 'key' && callArgs[cap.idempotency.key] !== undefined ? String(callArgs[cap.idempotency.key]) : null;
  const key = cap && cap.class !== 'safe' && (ctx.idempotencyKey || argKey) ? String(ctx.idempotencyKey || argKey).slice(0, 255) : null;
  if (key && cap.idempotency.strategy === 'key' && callArgs[cap.idempotency.key] === undefined) callArgs[cap.idempotency.key] = key;
  const claimed = key && connection && connection.id ? await claimKey(db, connection.id, key, cap.name) : null;
  if (claimed && claimed.replay) return { result: withMeta(claimed.replay, { 'xeno/replayed': true }), log: meta(r.service.category, 'ok', 'idempotent_replay') };
  if (claimed && claimed.error) return { result: toolError(claimed.error.text, claimed.error.code), log: meta(r.service.category, 'refused', claimed.error.code) };
  const finish = async (result, log) => {
    const out = cap ? withMeta(result, { 'xeno/capability': cap.name, 'xeno/charged': chargedOf(cap, result) }) : result;
    if (claimed && claimed.claimed) {
      if (result && result.isError) await db.query('DELETE FROM mcp_idempotency WHERE connection_id = $1 AND key = $2', [connection.id, key]);   // a refusal may be retried
      else await db.query('UPDATE mcp_idempotency SET result = $3 WHERE connection_id = $1 AND key = $2', [connection.id, key, JSON.stringify(out)]);
    }
    return { result: out, log };
  };
  try {
    const result = await withTimeout(r.service.call(db, actor, r.tool, callArgs, ctx), r.service.timeoutMs);
    return await finish(result, meta(r.service.category, result && result.isError ? 'tool_error' : 'ok', null));
  } catch (e) {
    if (e && e.mcpTimeout) return finish(toolError(`${r.service.title} did not answer in time. Nothing else is affected; try again.`, 'service_timeout'), meta(r.service.category, 'timeout', 'service_timeout'));
    if (r.service.isToolError(e)) return finish(toolError(e.message, e.code), meta(r.service.category, 'tool_error', e.code));
    // rule 2: an unexpected failure is still a tool error for this one call, not a broken session
    console.error('[xeno mcp]', r.service.category, e);
    return finish(toolError(`${r.service.title} failed on this call. Other tools still work.`, 'service_failed'), meta(r.service.category, 'failed', 'service_failed'));
  }
}

/** Claim an idempotency key before acting; a repeat gets the stored result, a different capability is refused. */
async function claimKey(db, connectionId, key, capability) {
  await db.query(`DELETE FROM mcp_idempotency WHERE connection_id = $1 AND key = $2 AND created_at < ${IDEMPOTENCY_TTL_SQL}`, [connectionId, key]);
  const ins = await db.query('INSERT INTO mcp_idempotency (connection_id, key, capability) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING key', [connectionId, key, capability]);
  if (ins.rowCount) return { claimed: true };
  const row = (await db.query('SELECT capability, result FROM mcp_idempotency WHERE connection_id = $1 AND key = $2', [connectionId, key])).rows[0];
  if (!row) return claimKey(db, connectionId, key, capability);
  if (row.capability !== capability) return { error: { text: `This Idempotency-Key was already used for ${row.capability}. Use a new key for a different action.`, code: 'idempotency_key_reused' } };
  if (!row.result) return { error: { text: 'A call with this Idempotency-Key is still running. Try again shortly with the same key.', code: 'idempotency_in_progress' } };
  return { replay: row.result };
}

const INSTRUCTIONS = 'XENO MCP: the XENO services you are allowed to use, in one place. Tool names start with the service: '
  + 'agents_whoami tells an agent who it is (id, workspace, division, owner, projects, budget); tasks_… is XENO Tasks; canvas_… lays work out on canvases (tasks stay live on them); an agent also has image_… and video_… (make media), library_… (read files) and chat_… (ask a model). Media and model calls are billed to your owner within your division’s budget. For tasks: if the folder you are working in has .xeno/tasks.json, pass its project.id as project. Start with tasks_list_my_tasks. '
  + 'To work a task: tasks_claim_task, then tasks_report_activity as you go, then tasks_comment with what you changed and how you checked it, '
  + 'and tasks_move_task to in_review. The person who created a task accepts it; you never accept your own work.';

/** One JSON-RPC message. `onCall` receives the log metadata of every tools/call (never its content). */
export async function dispatch(db, actor, connection, body, ctx = {}, onCall = () => {}) {
  const id = body && body.id != null ? body.id : null;
  const rpcError = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (!body || body.jsonrpc !== '2.0') return rpcError(-32600, 'jsonrpc must be "2.0"');
  switch (body.method) {
    case 'initialize': {
      const asked = body.params && body.params.protocolVersion;
      return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION, serverInfo: { name: 'xeno-mcp', title: 'XENO MCP', version: '1.0.0' }, capabilities: { tools: { listChanged: true } }, instructions: INSTRUCTIONS } };
    }
    case 'ping': return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: listTools(connection, actor) } };
    case 'tools/call': {
      const { result, log } = await callTool(db, actor, connection, body.params && body.params.name, (body.params && body.params.arguments) || {}, ctx);
      try { await onCall(log); } catch (e) { console.error('[xeno mcp] log', e); }
      return { jsonrpc: '2.0', id, result };
    }
    default: return rpcError(-32601, `Unknown method ${body.method}`);
  }
}

export function manifest(where = {}) {
  return { name: 'xeno-mcp', title: 'XENO MCP', protocolVersions: PROTOCOL_VERSIONS, transport: 'streamable-http', endpoint: where.resource || null,
    auth: { oauth: where.metadata || null, note: 'OAuth 2.1 with PKCE; clients register themselves (RFC 7591). Each sign-in is its own connection, managed in XENO: Dev › XENO MCP.' },
    services: SERVICES.map((s) => ({ category: s.category, title: s.title, description: s.description, tools: s.tools().length, ...(s.agentsOnly ? { agentsOnly: true } : {}) })) };
}

// ───────────────────────────── connections: one signed-in client for one person

const shapeConnection = (r) => ({ id: String(r.id), client: { id: r.client_id, name: r.client_name }, agentId: String(r.agent_user_id), categories: enabledCategories(r),
  createdAt: r.created_at, lastUsedAt: r.last_used_at, calls: r.calls != null ? Number(r.calls) : undefined, revokedAt: r.revoked_at || null });

/** The live connection for this person and client, created on first use. Signing the same client in again reuses it. */
/** The categories a platform agent's own credential starts with: every service an agent can use. */
export const AGENT_DEFAULT_CATEGORIES = Object.freeze(SERVICES.map((s) => s.category));
export async function connectionFor(db, { ownerId, agentId, clientId, clientName, categories = null }) {
  const found = (await db.query('SELECT * FROM mcp_connections WHERE owner_user_id = $1 AND client_id = $2 AND revoked_at IS NULL', [ownerId, clientId])).rows[0];
  if (found) {
    await db.query('UPDATE mcp_connections SET last_used_at = now(), agent_user_id = $2 WHERE id = $1', [found.id, agentId]);
    return found;
  }
  return (await db.query(`INSERT INTO mcp_connections (owner_user_id, agent_user_id, client_id, client_name, categories) VALUES ($1, $2, $3, $4, COALESCE($5::text[], '{tasks}'))
    ON CONFLICT (owner_user_id, client_id) WHERE revoked_at IS NULL DO UPDATE SET last_used_at = now() RETURNING *`,
    [ownerId, agentId, clientId, String(clientName || 'MCP app').slice(0, 80), categories])).rows[0];
}

/** Is this connection revoked? A revoked connection is refused on its very next call. */
export async function isRevoked(db, ownerId, clientId) {
  const r = (await db.query(`SELECT bool_and(revoked_at IS NOT NULL) AS all_revoked, count(*)::int AS n FROM mcp_connections WHERE owner_user_id = $1 AND client_id = $2`, [ownerId, clientId])).rows[0];
  return r.n > 0 && r.all_revoked === true;
}

export async function logCall(db, connectionId, log) {
  await db.query(`INSERT INTO mcp_calls (connection_id, tool, category, latency_ms, outcome, error_code) VALUES ($1, $2, $3, $4, $5, $6)`,
    [connectionId, log.tool, log.category, Math.max(0, Math.round(log.latencyMs)), log.outcome, log.errorCode]);
  await db.query('UPDATE mcp_connections SET last_used_at = now() WHERE id = $1', [connectionId]);
}

export class McpError extends Error { constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; } }

export async function listConnections(db, ownerId) {
  const rows = (await db.query(`SELECT c.*, (SELECT count(*) FROM mcp_calls k WHERE k.connection_id = c.id) AS calls
    FROM mcp_connections c WHERE c.owner_user_id = $1 AND c.revoked_at IS NULL ORDER BY COALESCE(c.last_used_at, c.created_at) DESC`, [ownerId])).rows;
  return rows.map(shapeConnection);
}

async function ownedConnection(db, ownerId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new McpError('Connection not found', 'connection_not_found', 404);
  const row = (await db.query('SELECT * FROM mcp_connections WHERE id = $1 AND owner_user_id = $2 AND revoked_at IS NULL', [id, ownerId])).rows[0];
  if (!row) throw new McpError('Connection not found', 'connection_not_found', 404);
  return row;
}

export async function getConnection(db, ownerId, id) {
  const row = await ownedConnection(db, ownerId, id);
  const calls = (await db.query('SELECT count(*)::int AS n FROM mcp_calls WHERE connection_id = $1', [row.id])).rows[0].n;
  return shapeConnection({ ...row, calls });
}

/** Turn categories on or off for one connection. An unknown category is refused, not silently dropped. */
export async function setCategories(db, ownerId, id, categories) {
  if (!Array.isArray(categories)) throw new McpError('categories must be a list', 'invalid_categories');
  const unknown = categories.filter((c) => !byCategory.has(c));
  if (unknown.length) throw new McpError(`Unknown categor${unknown.length > 1 ? 'ies' : 'y'}: ${unknown.join(', ')}`, 'unknown_category');
  const row = await ownedConnection(db, ownerId, id);
  const next = [...new Set(categories)];
  await db.query('UPDATE mcp_connections SET categories = $2 WHERE id = $1', [row.id, next]);
  return getConnection(db, ownerId, id);
}

/**
 * Disconnect: the connection stops answering on its next call, and its sign-in can no longer be refreshed.
 * Revoking the refresh tokens is what makes this permanent — without it the client would silently sign back in.
 */
export async function disconnect(db, ownerId, id) {
  const row = await ownedConnection(db, ownerId, id);
  // both writes or neither (one client, one transaction): a connection marked gone whose sign-in can still
  // refresh would quietly come back
  await withTransaction(db, async (tx) => {
    await tx.query('UPDATE mcp_connections SET revoked_at = now() WHERE id = $1', [row.id]);
    await tx.query('UPDATE oauth_refresh_tokens SET revoked = true WHERE client_id = $1 AND user_id = $2 AND NOT revoked', [row.client_id, ownerId]);
    // an agent's credential connection: its live credentials stop working too (minting a new one reconnects)
    if (String(row.client_id).startsWith('agent:')) await tx.query('UPDATE task_agent_tokens SET revoked_at = now() WHERE agent_user_id = $1 AND revoked_at IS NULL', [row.agent_user_id]);
  });
  return { id: String(row.id), disconnected: true };
}

export async function listActivity(db, ownerId, { connectionId = null, limit = 100 } = {}) {
  const n = Math.min(500, Math.max(1, Number(limit) || 100));
  const rows = (await db.query(`SELECT k.id, k.connection_id, c.client_name, k.tool, k.category, k.started_at, k.latency_ms, k.outcome, k.error_code
    FROM mcp_calls k JOIN mcp_connections c ON c.id = k.connection_id
    WHERE c.owner_user_id = $1 ${connectionId ? 'AND k.connection_id = $3' : ''} ORDER BY k.started_at DESC LIMIT $2`,
    connectionId ? [ownerId, n, connectionId] : [ownerId, n])).rows;
  return rows.map((r) => ({ id: String(r.id), connectionId: String(r.connection_id), client: r.client_name, tool: r.tool, category: r.category, at: r.started_at, latencyMs: r.latency_ms, outcome: r.outcome, errorCode: r.error_code }));
}
