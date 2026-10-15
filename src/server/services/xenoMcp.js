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
import { withTransaction } from './chatProjectAuthority.js';

export const PROTOCOL_VERSIONS = tasksMcp.PROTOCOL_VERSIONS;
export const PROTOCOL_VERSION = tasksMcp.PROTOCOL_VERSION;
const SEP = '_';

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
]);
export const CATEGORIES = Object.freeze(SERVICES.map((s) => s.category));
const byCategory = new Map(SERVICES.map((s) => [s.category, s]));

/** `tasks_create_task` → the Tasks service and its own `create_task`. An unknown prefix routes nowhere. */
export function route(prefixed, services = SERVICES) {
  const name = String(prefixed || '');
  for (const s of services) if (name.startsWith(s.category + SEP)) return { service: s, tool: name.slice(s.category.length + SEP.length) };
  return null;
}

/** The categories a connection may reach, from what it stored — never from anything the client sends. */
export const enabledCategories = (connection, services = SERVICES) => (connection && Array.isArray(connection.categories) ? connection.categories : ['tasks']).filter((c) => services.some((s) => s.category === c));

/** tools/list for one connection: only its categories, each tool under its prefix. */
export function listTools(connection) {
  const on = new Set(enabledCategories(connection));
  return SERVICES.filter((s) => on.has(s.category)).flatMap((s) => s.tools().map(({ name, title, description, inputSchema, annotations }) => ({
    name: s.category + SEP + name, title: `${s.title}: ${title || name}`, description, inputSchema, ...(annotations ? { annotations } : {}),
  })));
}

const toolError = (text, code) => ({ isError: true, content: [{ type: 'text', text }], structuredContent: { error: text, code } });
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(Object.assign(new Error('timeout'), { mcpTimeout: true })), ms);
  promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

/**
 * Run one tools/call for one connection. Returns the MCP result AND the metadata the log keeps; the log never
 * receives `args` or the result's content.
 */
export async function callTool(db, actor, connection, prefixed, args = {}, ctx = {}, services = SERVICES) {
  const started = Date.now();
  const r = route(prefixed, services);
  const meta = (category, outcome, errorCode) => ({ tool: String(prefixed || '').slice(0, 120), category, outcome, errorCode: errorCode || null, latencyMs: Date.now() - started });
  if (!r || !r.service.tools().some((t) => t.name === r.tool)) return { result: toolError(`Unknown tool ${prefixed}`, 'unknown_tool'), log: meta(r ? r.service.category : 'unknown', 'refused', 'unknown_tool') };
  // rule 1: a category this connection has turned off cannot be called, whether or not the client listed it
  if (!enabledCategories(connection, services).includes(r.service.category)) {
    return { result: toolError(`${r.service.title} is turned off for this connection. Turn it on in XENO: Dev › XENO MCP.`, 'category_disabled'), log: meta(r.service.category, 'refused', 'category_disabled') };
  }
  try {
    const result = await withTimeout(r.service.call(db, actor, r.tool, args || {}, ctx), r.service.timeoutMs);
    return { result, log: meta(r.service.category, result && result.isError ? 'tool_error' : 'ok', null) };
  } catch (e) {
    if (e && e.mcpTimeout) return { result: toolError(`${r.service.title} did not answer in time. Nothing else is affected; try again.`, 'service_timeout'), log: meta(r.service.category, 'timeout', 'service_timeout') };
    if (r.service.isToolError(e)) return { result: toolError(e.message, e.code), log: meta(r.service.category, 'tool_error', e.code) };
    // rule 2: an unexpected failure is still a tool error for this one call, not a broken session
    console.error('[xeno mcp]', r.service.category, e);
    return { result: toolError(`${r.service.title} failed on this call. Other tools still work.`, 'service_failed'), log: meta(r.service.category, 'failed', 'service_failed') };
  }
}

const INSTRUCTIONS = 'XENO MCP: the XENO services you are allowed to use, in one place. Tool names start with the service: '
  + 'tasks_… is XENO Tasks. For tasks: if the folder you are working in has .xeno/tasks.json, pass its project.id as project. Start with tasks_list_my_tasks. '
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
    case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: listTools(connection) } };
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
    services: SERVICES.map((s) => ({ category: s.category, title: s.title, description: s.description, tools: s.tools().length })) };
}

// ───────────────────────────── connections: one signed-in client for one person

const shapeConnection = (r) => ({ id: String(r.id), client: { id: r.client_id, name: r.client_name }, agentId: String(r.agent_user_id), categories: enabledCategories(r),
  createdAt: r.created_at, lastUsedAt: r.last_used_at, calls: r.calls != null ? Number(r.calls) : undefined, revokedAt: r.revoked_at || null });

/** The live connection for this person and client, created on first use. Signing the same client in again reuses it. */
export async function connectionFor(db, { ownerId, agentId, clientId, clientName }) {
  const found = (await db.query('SELECT * FROM mcp_connections WHERE owner_user_id = $1 AND client_id = $2 AND revoked_at IS NULL', [ownerId, clientId])).rows[0];
  if (found) {
    await db.query('UPDATE mcp_connections SET last_used_at = now(), agent_user_id = $2 WHERE id = $1', [found.id, agentId]);
    return found;
  }
  return (await db.query(`INSERT INTO mcp_connections (owner_user_id, agent_user_id, client_id, client_name) VALUES ($1, $2, $3, $4)
    ON CONFLICT (owner_user_id, client_id) WHERE revoked_at IS NULL DO UPDATE SET last_used_at = now() RETURNING *`,
    [ownerId, agentId, clientId, String(clientName || 'MCP app').slice(0, 80)])).rows[0];
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
