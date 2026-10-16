/**
 * XENO MCP — one hosted address for every agent, end to end against a real Postgres and the REAL routers
 * (XENO AGENT SURFACES & CONNECTORS - SPEC.md §7).
 *
 * An MCP client signs in exactly as it does for Tasks (registration, consent, PKCE), then uses /api/mcp.
 *
 * Asserts the spec's rules, each against the running router:
 *   1. discovery: an unauthenticated call gets a 401 naming /api/mcp's own resource metadata
 *   2. one sign-in = one CONNECTION, listed for the person; signing in again reuses it
 *   3. tool names are prefixed by their service (tasks_…) and a call routes by the prefix
 *   4. a category turned off is neither LISTED nor CALLABLE (falsifier for §7)
 *   5. the call log keeps metadata only, never the arguments (falsifier for §7)
 *   6. disconnect: refused on the very next call, and the sign-in cannot refresh back in
 *   7. the management API is the person's: another person gets 404, an agent's token is refused
 *   8. one service failing fails alone: a throwing service is a tool error, the session keeps working
 *   9. the old address /api/tasks/mcp still works for a connection signed in there
 *  10. platform agents: create one, mint a short-lived credential, BECOME it over /api/mcp; scoped to its projects;
 *      revoked, expired, disconnected or deleted credentials are refused; someone else's agent is 404
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/xeno-mcp.test.mjs
 */
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import oauth2Routes from '../routes/oauth2Routes.js';
import chatRoutes from '../routes/chatRoutes.js';
import xenoTasksRoutes, { taskTokenAuth, unlessTaskToken, mcpChallenge } from '../routes/xenoTasksRoutes.js';
import platformAgentRoutes from '../routes/platformAgentRoutes.js';
import canvasRoutes from '../routes/canvasRoutes.js';
import xenoMcpRoutes, { management, personOnly, mcpResourceMetadata } from '../routes/xenoMcpRoutes.js';
import * as mcp from '../services/xenoMcp.js';
import { authMiddleware } from '../middleware/auth.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };
const pkce = () => { const v = crypto.randomBytes(32).toString('base64url'); return { v, c: crypto.createHash('sha256').update(v).digest('base64url') }; };

async function main() {
  await runAllMigrations(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS external_identity_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system varchar(64) NOT NULL, external_user_id text, external_email text, platform_user_id uuid, updated_at timestamptz, UNIQUE (source_system, platform_user_id))`).catch(() => {});
  await migrateAccountV2(pool);
  await migrateOidcClients(pool);
  const mk = async (m) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW())
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [m, `${m}@example.test`])).rows[0].id;
  const ada = await mk('xmcp-ada'), bob = await mk('xmcp-bob');
  const session = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });

  const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/oauth2', oauth2Routes);
  app.use('/api/chat', (req, _r, n) => { req.user = { id: ada }; n(); }, chatRoutes);
  app.use('/api/tasks', mcpChallenge, taskTokenAuth, unlessTaskToken(authMiddleware), xenoTasksRoutes);
  // mounted exactly as index.js mounts it: the endpoint at the root, management behind the person's session
  app.get('/.well-known/oauth-protected-resource/api/mcp', mcpResourceMetadata);
  app.use('/api/mcp', (req, res, next) => (req.path === '/' ? xenoMcpRoutes(req, res, next) : next()));
  app.use('/api/mcp', authMiddleware, personOnly, management);
  app.use('/api/agents', authMiddleware, personOnly, platformAgentRoutes);
  app.use('/api/canvases', authMiddleware, canvasRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body, headers = {}, raw } = {}) => {
    const r = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    let j = null; const text = await r.text(); try { j = text ? JSON.parse(text) : null; } catch { j = text; }
    return { s: r.status, j, h: r.headers };
  };
  let rid = 0;
  const rpc = (token, method, params, path = '/api/mcp') => call('POST', path, { token, body: { jsonrpc: '2.0', id: ++rid, method, params } });

  /** The whole sign-in an MCP client does: register, consent, PKCE code exchange. */
  async function signIn(person, clientName) {
    const reg = await call('POST', '/api/oauth2/register', { body: { client_name: clientName, redirect_uris: ['http://localhost:33418/callback'], token_endpoint_auth_method: 'none', scope: 'tasks:read tasks:write' } });
    const p = pkce(), redirect = 'http://localhost:51234/callback';
    const granted = await call('POST', '/api/oauth2/authorize', { token: session(person), body: { client_id: reg.j.client_id, redirect_uri: redirect, scope: 'tasks:read tasks:write', code_challenge: p.c, code_challenge_method: 'S256', state: 's', consent: true } });
    const tok = await call('POST', '/api/oauth2/token', { body: new URLSearchParams({ grant_type: 'authorization_code', code: granted.j.code, client_id: reg.j.client_id, redirect_uri: redirect, code_verifier: p.v }).toString(), raw: true, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    return { clientId: reg.j.client_id, at: tok.j.access_token, rt: tok.j.refresh_token };
  }

  try {
    // 1. discovery
    const ch = await call('POST', '/api/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
    check(ch.s === 401 && /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/api\/mcp"/.test(ch.h.get('www-authenticate') || ''), 'an unauthenticated call to /api/mcp gets a 401 naming its own resource metadata');
    const prm = await call('GET', '/.well-known/oauth-protected-resource/api/mcp');
    check(prm.s === 200 && /\/api\/mcp$/.test(prm.j.resource) && prm.j.resource_name === 'XENO MCP', 'the resource metadata names /api/mcp as XENO MCP');

    // 2. one sign-in = one connection
    const claude = await signIn(ada, 'Claude Code');
    const init = await rpc(claude.at, 'initialize', { protocolVersion: '2025-06-18' });
    check(init.s === 200 && init.j.result.serverInfo.name === 'xeno-mcp' && init.j.result.capabilities.tools.listChanged === true, 'a signed-in client initializes as XENO MCP, announcing list changes');
    let conns = (await call('GET', '/api/mcp/connections', { token: session(ada) })).j.connections;
    check(conns.length === 1 && conns[0].client.name === 'Claude Code' && conns[0].categories.join() === 'tasks', 'the sign-in is one connection, listed for the person, with Tasks on by default');
    await rpc(claude.at, 'ping', {});
    conns = (await call('GET', '/api/mcp/connections', { token: session(ada) })).j.connections;
    check(conns.length === 1, 'using it again does not make a second connection');
    const cursor = await signIn(ada, 'Cursor');
    await rpc(cursor.at, 'ping', {});
    conns = (await call('GET', '/api/mcp/connections', { token: session(ada) })).j.connections;
    check(conns.length === 2 && conns.some((c) => c.client.name === 'Cursor'), 'a second client is its own connection');
    const claudeConn = conns.find((c) => c.client.name === 'Claude Code');

    // 3. prefixed names, routed by prefix
    const list = await rpc(claude.at, 'tools/list', {});
    const names = list.j.result.tools.map((t) => t.name);
    check(names.length === mcp.SERVICES[0].tools().length && names.every((n) => /^tasks_[a-z_]+$/.test(n)), `every tool is prefixed by its service (${names.length} tools, e.g. ${names[0]})`);
    const projects = await rpc(claude.at, 'tools/call', { name: 'tasks_list_projects', arguments: {} });
    check(projects.s === 200 && !projects.j.result.isError && Array.isArray(projects.j.result.structuredContent.projects), 'a prefixed call routes to the Tasks service and answers');
    const unknown = await rpc(claude.at, 'tools/call', { name: 'forum_post', arguments: {} });
    check(unknown.j.result.isError === true && unknown.j.result.structuredContent.code === 'unknown_tool', 'a tool of a service that does not exist is refused, as a tool error');

    // 4. a category turned off is neither listed nor callable
    const off = await call('PATCH', `/api/mcp/connections/${claudeConn.id}`, { token: session(ada), body: { categories: [] } });
    check(off.s === 200 && off.j.connection.categories.length === 0, 'the person turns Tasks off for one connection');
    check((await rpc(claude.at, 'tools/list', {})).j.result.tools.length === 0, 'its tools leave the list');
    const blocked = await rpc(claude.at, 'tools/call', { name: 'tasks_list_projects', arguments: {} });
    check(blocked.j.result.isError === true && blocked.j.result.structuredContent.code === 'category_disabled', 'and a call to a turned-off tool is REFUSED, not just hidden (falsifier §7)');
    check((await rpc(cursor.at, 'tools/list', {})).j.result.tools.length > 0, 'the other connection is unaffected');
    check((await call('PATCH', `/api/mcp/connections/${claudeConn.id}`, { token: session(ada), body: { categories: ['tasks', 'nonsense'] } })).j.code === 'unknown_category', 'an unknown category is refused, not silently dropped');
    await call('PATCH', `/api/mcp/connections/${claudeConn.id}`, { token: session(ada), body: { categories: ['tasks'] } });

    // 5. the call log keeps metadata only
    const secret = 'SECRET-CONTENT-' + crypto.randomBytes(6).toString('hex');
    await rpc(claude.at, 'tools/call', { name: 'tasks_create_task', arguments: { title: secret, body: secret } });
    const calls = (await call('GET', `/api/mcp/activity?connection=${claudeConn.id}`, { token: session(ada) })).j.calls;
    check(calls.length >= 3 && calls.some((c) => c.tool === 'tasks_create_task') && calls.some((c) => c.outcome === 'refused' && c.errorCode === 'category_disabled'), `the log records each call with its outcome (${calls.length} calls)`);
    const stored = JSON.stringify((await pool.query('SELECT * FROM mcp_calls')).rows);
    check(!stored.includes(secret), 'the log never holds a tool\'s arguments (falsifier §7)');
    const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'mcp_calls'`)).rows.map((r) => r.column_name);
    check(!cols.some((c) => /arg|result|content|body|input|output|payload/.test(c)), `the log table has no column to put content in (${cols.join(',')})`);

    // 7. the management API is the person's
    check((await call('GET', `/api/mcp/connections/${claudeConn.id}`, { token: session(bob) })).s === 404, 'another person cannot see this connection (404, not 403)');
    check((await call('DELETE', `/api/mcp/connections/${claudeConn.id}`, { token: session(bob) })).s === 404, 'nor disconnect it');
    check((await call('GET', '/api/mcp/connections', { token: claude.at })).s === 401, 'an agent\'s own token cannot reach the management API');

    // 6. disconnect
    const gone = await call('DELETE', `/api/mcp/connections/${claudeConn.id}`, { token: session(ada) });
    check(gone.s === 200 && gone.j.disconnected === true, 'the person disconnects one connection');
    const after = await rpc(claude.at, 'tools/list', {});
    check(after.s === 401 && /disconnected/.test(after.j.error.message), 'its very next call is refused, telling it to sign in again');
    const refreshed = await call('POST', '/api/oauth2/token', { body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: claude.rt, client_id: claude.clientId }).toString(), raw: true, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    check(refreshed.s >= 400, `and it cannot refresh its way back in (${refreshed.s})`);
    check((await rpc(cursor.at, 'tools/list', {})).j.result.tools.length > 0, 'the other connection still works');
    check((await call('GET', '/api/mcp/connections', { token: session(ada) })).j.connections.length === 1, 'the disconnected one leaves the list');

    // 8. one service failing fails alone
    // the REAL gateway (mcp.callTool) over a routing table holding one healthy service and two broken ones
    const slow = { category: 'slow', title: 'Slow', timeoutMs: 80, tools: () => [{ name: 'wait' }], call: () => new Promise(() => {}), isToolError: () => false };
    const crash = { category: 'crash', title: 'Crash', timeoutMs: 1000, tools: () => [{ name: 'go' }], call: async () => { throw new Error('boom'); }, isToolError: () => false };
    const table = [mcp.SERVICES[0], slow, crash];
    const conn = { categories: ['tasks', 'slow', 'crash'] };
    const quiet = console.error; console.error = () => {};
    const started = Date.now();
    const t = await mcp.callTool(pool, { id: ada, kind: 'human' }, conn, 'slow_wait', {}, {}, table).catch((e) => ({ threw: e }));
    const ms = Date.now() - started;
    const c = await mcp.callTool(pool, { id: ada, kind: 'human' }, conn, 'crash_go', {}, {}, table).catch((e) => ({ threw: e }));
    console.error = quiet;
    check(!t.threw && t.result.isError && t.result.structuredContent.code === 'service_timeout' && t.log.outcome === 'timeout' && ms < 1000, `a service that never answers is cut off at its own timeout and becomes a tool error (${ms} ms)`);
    check(!c.threw && c.result.isError && c.result.structuredContent.code === 'service_failed' && c.log.outcome === 'failed', 'a service that throws becomes a tool error for that one call');
    const h = await mcp.callTool(pool, { id: ada, kind: 'human' }, conn, 'tasks_list_projects', {}, {}, table);
    check(!h.result.isError && h.log.outcome === 'ok', 'and the healthy service in the same table keeps answering');

    // 9. the old address still works
    const old = await rpc(cursor.at, 'tools/list', {}, '/api/tasks/mcp');
    check(old.s === 200 && old.j.result.tools.some((x) => x.name === 'list_projects'), 'a connection can still use the old /api/tasks/mcp address, unprefixed');
    // 10. platform agents: create, mint, become
    const made = await call('POST', '/api/agents', { token: session(ada), body: { name: 'Release Bot', description: 'Ships releases' } });
    const ag = made.j.agent;
    check(made.s === 201 && /^agt_[0-9a-f]{32}$/.test(ag.id) && ag.description === 'Ships releases' && ag.projects.length === 0, `a person creates an agent with a stable opaque id (${ag && ag.id})`);
    check((await call('GET', `/api/agents/${ag.id}`, { token: session(bob) })).s === 404, "another person cannot see it (404)");
    check((await call('POST', '/api/agents', { token: claude.at, body: { name: 'x' } })).s === 401, "an agent's token cannot create agents");
    const minted = await call('POST', `/api/agents/${ag.id}/credentials`, { token: session(ada), body: {} });
    const cred = minted.j.credential;
    const ttl = new Date(cred.expiresAt) - Date.now();
    check(minted.s === 201 && /^xtk_/.test(cred.token) && ttl > 50 * 60e3 && ttl <= 61 * 60e3 && minted.h.get('cache-control') === 'no-store', `a credential is minted, shown once, 1 hour by default (${Math.round(ttl / 60e3)} min)`);
    check(!JSON.stringify((await call('GET', `/api/agents/${ag.id}`, { token: session(ada) })).j).includes(cred.token), 'the secret is never shown again');
    const who = await rpc(cred.token, 'tools/call', { name: 'tasks_list_projects', arguments: {} });
    check(who.s === 200 && !who.j.result.isError && who.j.result.structuredContent.projects.length === 0, 'the credential BECOMES the agent over /api/mcp, and it sees only the projects it was given (none yet)');
    const pr = await call('POST', '/api/chat/projects', { body: { name: 'Releases' } });
    const proj = (pr.j.project || pr.j.data || pr.j).id;
    const added = await call('PUT', `/api/agents/${ag.id}/projects/${proj}`, { token: session(ada), body: { access: 'editor' } });
    check(added.s === 200 && added.j.agent.projects.some((x) => x.id === String(proj) && x.access === 'editor'), 'the person gives it a project');
    const seen = await rpc(cred.token, 'tools/call', { name: 'tasks_list_projects', arguments: {} });
    check(seen.j.result.structuredContent.projects.some((x) => x.id === String(proj)), 'and the agent now sees that project');
    const c1 = await rpc(cred.token, 'tools/call', { name: 'tasks_create_task', arguments: { title: 'Cut 1.0', projectId: String(proj) } });
    check(!c1.j.result.isError, 'and works in it as itself');
    const after1 = (await call('GET', `/api/agents/${ag.id}`, { token: session(ada) })).j.agent;
    check(after1.connections.length === 1 && after1.connections[0].client === 'Release Bot', 'its use shows as one connection named after the agent');
    const allConns = (await call('GET', '/api/mcp/connections', { token: session(ada) })).j.connections;
    const agConn = allConns.find((x) => x.client.name === 'Release Bot');
    check(Boolean(agConn), 'and in the person\'s MCP connections list');
    // 10b. instructions are INHERITED: an agent with none still gets XENO's way of working and the project's words
    await pool.query('UPDATE chat_projects SET custom_instructions = $2 WHERE id = $1', [proj, 'Always write release notes in plain English.']);
    const cg = (await rpc(cred.token, 'tools/call', { name: 'tasks_create_task', arguments: { title: 'Notes for 1.0', project: String(proj) } })).j.result.structuredContent;
    const kCut = cg.task ? cg.task.key : cg.key;
    const gt = (await rpc(cred.token, 'tools/call', { name: 'tasks_get_task', arguments: { key: kCut } })).j.result.structuredContent;
    check(/never accept your own work/i.test(gt.guidance || '') && /plain English/.test(gt.guidance || ''), 'an agent reading a task is told how to work it, inheriting the project’s instructions');
    await call('PATCH', `/api/agents/${ag.id}`, { token: session(ada), body: { instructions: 'Sign every comment as RB.' } });
    const gt2 = (await rpc(cred.token, 'tools/call', { name: 'tasks_get_task', arguments: { key: kCut } })).j.result.structuredContent.guidance || '';
    check(gt2.indexOf('plain English') < gt2.indexOf('Sign every comment') && gt2.indexOf('never accept') < gt2.indexOf('plain English'), 'and its own instructions, when written, come last: XENO, then project, then the agent');
    // 11. canvases over XENO MCP: the agent lays work out on a canvas, through the same rules as the screen
    const cl = await rpc(cred.token, 'tools/list', {});
    check(cl.j.result.tools.some((t) => t.name === 'canvas_add') && cl.j.result.tools.some((t) => t.name === 'canvas_connect'), 'an agent has the canvas tools');
    const t2 = (await rpc(cred.token, 'tools/call', { name: 'tasks_create_task', arguments: { title: 'Write notes', projectId: String(proj) } })).j.result.structuredContent;
    const k1 = c1.j.result.structuredContent.task ? c1.j.result.structuredContent.task.key : c1.j.result.structuredContent.key, k2 = t2.task ? t2.task.key : t2.key;
    const cvMade = (await rpc(cred.token, 'tools/call', { name: 'canvas_create', arguments: { name: 'Release plan', project: String(proj) } })).j.result;
    check(!cvMade.isError && cvMade.structuredContent.id && cvMade.structuredContent.items.length === 0, `the agent starts a canvas on its project (${cvMade.isError ? cvMade.structuredContent.error : cvMade.structuredContent.id})`);
    const cvId = cvMade.structuredContent.id;
    const addRes = (await rpc(cred.token, 'tools/call', { name: 'canvas_add', arguments: { canvas: cvId, items: [{ type: 'task', task: k1 }, { type: 'task', task: k2 }, { type: 'note', text: 'Ship **Friday**' }] } })).j.result;
    const [n1, n2] = addRes.structuredContent.added || [];
    check(!addRes.isError && addRes.structuredContent.canvas.items.length === 3 && addRes.structuredContent.canvas.items.find((x) => x.id === n1).title === 'Cut 1.0', `it puts its tasks and a note on it; task cards read live (${addRes.isError ? addRes.structuredContent.error : 'ok'})`);
    const cvConn = (await rpc(cred.token, 'tools/call', { name: 'canvas_connect', arguments: { canvas: cvId, from: n1, to: n2, link: 'blocks' } })).j.result;
    check(!cvConn.isError && cvConn.structuredContent.canvas.connections.some((x) => x.link === 'blocks'), `it connects them as "blocks" (${cvConn.isError ? cvConn.structuredContent.error : 'ok'})`);
    const linkedTask = (await rpc(cred.token, 'tools/call', { name: 'tasks_get_task', arguments: { key: k1 } })).j.result.structuredContent;
    check(JSON.stringify(linkedTask).includes(k2), 'and that is a REAL task link, on the task itself');
    const seenByPerson = (await call('GET', `/api/canvases/${cvId}`, { token: session(ada) }));
    check(seenByPerson.s === 200 && seenByPerson.j.canvas.content.nodes.length === 3, 'the person sees the same canvas the agent built');
    const moved = (await rpc(cred.token, 'tools/call', { name: 'canvas_update', arguments: { canvas: cvId, items: [{ id: n1, x: 500, y: 40 }], remove: [n2] } })).j.result;
    check(!moved.isError && moved.structuredContent.canvas.items.length === 2 && moved.structuredContent.canvas.items.find((x) => x.id === n1).x === 500, 'it moves a card and takes one off');
    check((await rpc(cred.token, 'tools/call', { name: 'tasks_get_task', arguments: { key: k2 } })).j.result.isError !== true, 'taking a card off never deletes the task');
    const hidden = String((await pool.query(`INSERT INTO chat_conversations (user_id, owner_user_id, created_by_user_id, title) VALUES ($1, $1, $1, 'Private planning') RETURNING id`, [ada])).rows[0].id);
    const refAdd = (await rpc(cred.token, 'tools/call', { name: 'canvas_add', arguments: { canvas: cvId, items: [{ type: 'chat', chat: hidden }] } })).j.result;
    const hc = !refAdd.isError && refAdd.structuredContent.canvas.items.find((x) => x.type === 'chat');
    check(hc && hc.missing === true && !hc.title, `a chat the agent cannot open shows as missing on its canvas, never its title (${refAdd.isError ? refAdd.structuredContent.error : 'ok'})`);
    const outsider = (await rpc(cred.token, 'tools/call', { name: 'canvas_get', arguments: { canvas: '00000000-0000-4000-8000-000000000000' } })).j.result;
    check(outsider.isError && outsider.structuredContent.code === 'canvas_not_found', 'a canvas it cannot see does not exist for it');

    // revocation, expiry, disconnect, delete
    const second = (await call('POST', `/api/agents/${ag.id}/credentials`, { token: session(ada), body: { ttlHours: 2 } })).j.credential;
    await call('DELETE', `/api/agents/${ag.id}/credentials/${second.id}`, { token: session(ada) });
    check((await rpc(second.token, 'ping', {})).s === 401, 'a revoked credential is refused');
    const third = (await call('POST', `/api/agents/${ag.id}/credentials`, { token: session(ada), body: {} })).j.credential;
    await pool.query(`UPDATE task_agent_tokens SET expires_at = now() - interval '1 second' WHERE id = $1`, [third.id]);
    check((await rpc(third.token, 'ping', {})).s === 401, 'an expired credential is refused');
    check((await call('POST', `/api/agents/${ag.id}/credentials`, { token: session(ada), body: { ttlHours: 99999 } })).j.code === 'invalid_ttl', 'an over-long lifetime is refused');
    await call('DELETE', `/api/mcp/connections/${agConn.id}`, { token: session(ada) });
    check((await rpc(cred.token, 'ping', {})).s === 401, 'disconnecting it stops its live credentials');
    const fresh = (await call('POST', `/api/agents/${ag.id}/credentials`, { token: session(ada), body: {} })).j.credential;
    check((await rpc(fresh.token, 'ping', {})).s === 200, 'and a newly minted credential reconnects');
    const del = await call('DELETE', `/api/agents/${ag.id}`, { token: session(ada) });
    check(del.s === 200 && (await rpc(fresh.token, 'ping', {})).s === 401, 'deleting the agent stops everything bound to it');
    check((await call('GET', `/api/agents/${ag.id}`, { token: session(ada) })).s === 404, 'and it is gone');
  } finally {
    server.close();
    await pool.end();
  }
  console.log(`\nxeno-mcp: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
