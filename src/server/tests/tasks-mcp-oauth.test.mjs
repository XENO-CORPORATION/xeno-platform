/**
 * XENO Tasks over MCP — the sign-in an agent CLI does, end to end, against a real Postgres.
 *
 * An MCP client (Claude Code, Codex, Cursor…) pointed at /api/tasks/mcp gets a 401 that names the
 * protected-resource metadata (RFC 9728), registers itself (RFC 7591), signs the person in with
 * authorization code + PKCE behind a consent screen, and then works tasks AS THE PERSON'S AGENT.
 *
 * Asserts:
 *   1. discovery: the 401 challenge, the resource metadata, the registration endpoint advertised
 *   2. registration: public + PKCE + tasks scopes only; dangerous redirects and secrets refused; rate limit
 *   3. consent: a self-registered client never signs straight through; Deny returns access_denied
 *   4. tokens: audience 'xeno-tasks' — refused by every other API, accepted by /api/tasks; refresh keeps it
 *   5. identity: the token acts as the person's agent (named after the app), never as the person
 *   6. projects: an agent sees nothing until a project admin adds it; then lists, takes and raises tasks
 *   7. protocol: version negotiation, notifications 202, batches refused, foreign Origin refused, GET stream 405
 *   8. revocation: signing out everywhere kills the token
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/tasks-mcp-oauth.test.mjs
 */
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import chatRoutes from '../routes/chatRoutes.js';
import oauth2Routes from '../routes/oauth2Routes.js';
import xenoTasksRoutes, { taskTokenAuth, unlessTaskToken, mcpChallenge, protectedResourceMetadata } from '../routes/xenoTasksRoutes.js';
import { authMiddleware } from '../middleware/auth.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';
import { registerDynamicClient, createAuthorizationCode, exchangeAuthorizationCode, refreshTokenGrant, logoutEverywhere, DYNAMIC_REGISTRATION_LIMIT } from '../utils/oidcProvider.js';

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
  const ada = await mk('mcp-ada'), bob = await mk('mcp-bob');
  const legacy = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });

  let actor = ada;
  const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.get('/.well-known/oauth-protected-resource/api/tasks/mcp', protectedResourceMetadata);
  app.use('/api/oauth2', oauth2Routes);
  app.get('/api/whoami', authMiddleware, (req, res) => res.json({ id: req.user.id }));   // stands for "any other API"
  app.use('/api/chat', (req, _r, n) => { req.user = { id: actor }; n(); }, chatRoutes);
  app.use('/api/tasks', mcpChallenge, taskTokenAuth, unlessTaskToken(authMiddleware), xenoTasksRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body, headers = {}, raw } = {}) => {
    const r = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    let j = null; const text = await r.text(); try { j = text ? JSON.parse(text) : null; } catch { j = text; }
    return { s: r.status, j, h: r.headers };
  };
  const rpc = (token, method, params, extra = {}) => call('POST', '/api/tasks/mcp', { token, body: { jsonrpc: '2.0', id: 1, method, params }, ...extra });
  try {
    // 1. discovery
    const ch = await call('POST', '/api/tasks/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
    const www = ch.h.get('www-authenticate') || '';
    check(ch.s === 401 && /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/api\/tasks\/mcp"/.test(www), 'an unauthenticated MCP request gets a 401 naming the resource metadata (RFC 9728)');
    const prm = await call('GET', '/.well-known/oauth-protected-resource/api/tasks/mcp');
    check(prm.s === 200 && /\/api\/tasks\/mcp$/.test(prm.j.resource) && prm.j.authorization_servers.length === 1 && prm.j.scopes_supported.includes('tasks:write'), 'the resource metadata names the resource, its authorization server and the Tasks scopes');
    const disc = await call('GET', '/api/oauth2/.well-known/oauth-authorization-server');
    check(disc.s === 200 && /\/api\/oauth2\/register$/.test(disc.j.registration_endpoint) && disc.j.code_challenge_methods_supported.includes('S256') && disc.j.scopes_supported.includes('tasks:read'), 'authorization-server metadata (RFC 8414) advertises registration, PKCE S256 and the Tasks scopes');

    // 2. registration
    const reg = await call('POST', '/api/oauth2/register', { body: { client_name: 'Claude Code', redirect_uris: ['http://localhost:33418/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], scope: 'tasks:read tasks:write' } });
    check(reg.s === 201 && /^mcp_/.test(reg.j.client_id) && reg.j.token_endpoint_auth_method === 'none' && reg.j.scope === 'tasks:read tasks:write' && !reg.j.client_secret, 'an MCP client registers itself as a public, PKCE-only client with the Tasks scopes');
    const row = (await pool.query('SELECT dynamic, access_audience, allowed_scopes, is_first_party FROM oauth_clients WHERE client_id = $1', [reg.j.client_id])).rows[0];
    check(row.dynamic === true && row.access_audience === 'xeno-tasks' && row.is_first_party === false && row.allowed_scopes.join(' ') === 'openid tasks:read tasks:write', 'it is stored flagged as self-registered, with its own token audience and nothing beyond the Tasks scopes');
    const refusals = [
      [{ client_name: 'x', redirect_uris: ['http://evil.example/cb'] }, 'invalid_redirect_uri'],
      [{ client_name: 'x', redirect_uris: ['javascript:alert(1)'] }, 'invalid_redirect_uri'],
      [{ client_name: 'x', redirect_uris: ['https://a.example/cb#frag'] }, 'invalid_redirect_uri'],
      [{ client_name: 'x', redirect_uris: ['myapp:/cb'] }, 'invalid_redirect_uri'],
      [{ client_name: 'x', redirect_uris: ['http://127.0.0.1/cb'], token_endpoint_auth_method: 'client_secret_post' }, 'invalid_client_metadata'],
      [{ client_name: 'x', redirect_uris: ['http://127.0.0.1/cb'], scope: 'ledger:spend billing:manage' }, 'invalid_client_metadata'],
      [{ client_name: 'x', redirect_uris: ['http://127.0.0.1/cb'], grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
      [{ redirect_uris: ['http://127.0.0.1/cb'] }, 'invalid_client_metadata'],
    ];
    let allRefused = true; for (const [b, code] of refusals) { const x = await call('POST', '/api/oauth2/register', { body: b }); if (x.s !== 400 || x.j.error !== code) { allRefused = false; console.log('   refused?', JSON.stringify(b), x.s, x.j); } }
    check(allRefused, 'registration refuses remote http, javascript:, fragments, non-reverse-DNS schemes, secrets, non-Tasks scopes, other grants and a missing name');
    const ok2 = [await registerDynamicClient(pool, { client_name: 'Cursor', redirect_uris: ['cursor.anysphere.app://oauth/callback'] }), await registerDynamicClient(pool, { client_name: 'Web IDE', redirect_uris: ['https://ide.example.com/oauth/cb'] })];
    check(ok2.every((c) => /^mcp_/.test(c.client_id)), 'a reverse-DNS app scheme and an https callback are both accepted');
    let limited = null; for (let i = 0; i <= DYNAMIC_REGISTRATION_LIMIT.perAddressPerHour; i++) { try { await registerDynamicClient(pool, { client_name: 'spam', redirect_uris: ['http://127.0.0.1/cb'] }, { from: '203.0.113.9' }); } catch (e) { limited = e; break; } }
    check(limited && limited.statusCode === 429, `registration is rate-limited per address (${DYNAMIC_REGISTRATION_LIMIT.perAddressPerHour}/hour)`);

    // 3. consent
    const p1 = pkce(), redirect = 'http://localhost:51234/callback';   // any port on the registered loopback path
    const authz = (extra) => call('POST', '/api/oauth2/authorize', { token: legacy(ada), body: { client_id: reg.j.client_id, redirect_uri: redirect, scope: 'tasks:read tasks:write', code_challenge: p1.c, code_challenge_method: 'S256', state: 'st8', ...extra } });
    const noConsent = await authz({});
    check(noConsent.s === 400 && noConsent.j.error === 'consent_required' && noConsent.j.consent.name === 'Claude Code' && noConsent.j.consent.sendsTo === 'this computer' && noConsent.j.consent.scopes.includes('tasks:write'), 'a signed-in person is not signed straight through: the server asks for consent, naming the app and where it goes');
    const denied = await authz({ deny: true });
    check(denied.s === 200 && /error=access_denied/.test(denied.j.redirect) && /state=st8/.test(denied.j.redirect) && !/code=/.test(denied.j.redirect), 'Cancel sends the app access_denied (with its state) and no code');
    const bad = await call('POST', '/api/oauth2/authorize', { token: legacy(ada), body: { client_id: reg.j.client_id, redirect_uri: 'http://localhost:51234/elsewhere', code_challenge: p1.c, code_challenge_method: 'S256', consent: true } });
    check(bad.s >= 400 && !(bad.j && bad.j.redirect), 'a callback path that was not registered is refused, even with consent');
    const granted = await authz({ consent: true });
    const code = granted.j && granted.j.code;
    check(granted.s === 200 && code && /state=st8/.test(granted.j.redirect), 'Allow issues a code to the registered loopback callback on the port the app chose');

    // 4. tokens
    const tok = await call('POST', '/api/oauth2/token', { body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: reg.j.client_id, redirect_uri: redirect, code_verifier: p1.v }).toString(), raw: true, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const claims = tok.j && tok.j.access_token ? jwt.decode(tok.j.access_token) : {};
    check(tok.s === 200 && claims.aud === 'xeno-tasks' && claims.scope === 'openid tasks:read tasks:write' && tok.j.refresh_token, 'the form-encoded code exchange returns a Tasks-audience token with only the Tasks scopes, and a refresh token');
    const at = tok.j.access_token;
    check((await call('GET', '/api/whoami', { token: at })).s === 401, 'that token is refused by every other API (it is not a xeno-api token)');
    const me = await call('GET', '/api/tasks/agent/me', { token: at });
    check(me.s === 200 && me.j.agent.name === 'Claude Code' && me.j.agent.kind === 'agent', 'and accepted by XENO Tasks');
    const agentId = me.j.agent.id;
    const owner = (await pool.query('SELECT owner_user_id, agent_origin FROM agent_identities WHERE user_id = $1', [agentId])).rows[0];
    const keyOn = (await pool.query('SELECT bool_or(is_active) AS on FROM api_keys WHERE user_id = $1', [agentId])).rows[0].on;
    check(String(owner.owner_user_id) === String(ada) && owner.agent_origin === 'mcp' && keyOn !== true, 'it acts as Ada’s own agent for that app (not as Ada), and the agent’s general API key is off');
    const rf = await refreshTokenGrant(pool, { refreshToken: tok.j.refresh_token, clientId: reg.j.client_id });
    check(jwt.decode(rf.access_token).aud === 'xeno-tasks', 'a refreshed token keeps the Tasks audience');
    const again = await createAuthorizationCode(pool, { clientId: reg.j.client_id, userId: ada, redirectUri: redirect, codeChallenge: p1.c, codeChallengeMethod: 'S256' });
    const t2 = await exchangeAuthorizationCode(pool, { code: again, clientId: reg.j.client_id, redirectUri: redirect, codeVerifier: p1.v });
    check((await call('GET', '/api/tasks/agent/me', { token: t2.access_token })).j.agent.id === agentId, 'signing in again from the same app reuses the same agent');

    // 5/6. projects and work, over MCP
    const init = await rpc(at, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    check(init.s === 200 && init.j.result.protocolVersion === '2025-03-26' && init.j.result.serverInfo.name === 'xeno-tasks', 'initialize answers with the client’s protocol version when supported');
    check((await rpc(at, 'initialize', { protocolVersion: '1999-01-01' })).j.result.protocolVersion === '2025-06-18', 'and with the newest one otherwise');
    const tl = (await rpc(at, 'tools/list', {})).j.result.tools;
    check(tl.some((x) => x.name === 'list_projects') && tl.find((x) => x.name === 'get_task').annotations.readOnlyHint === true && tl.find((x) => x.name === 'move_task').annotations.readOnlyHint === false && tl.every((x) => x.title), 'tools carry titles and read-only / write annotations, list_projects included');
    const empty = (await rpc(at, 'tools/call', { name: 'list_my_tasks', arguments: {} })).j.result.structuredContent;
    check(empty.tasks.length === 0 && /not on any project yet/.test(empty.hint), 'before anyone adds it, the agent sees nothing and is told exactly what the person must do');
    actor = ada; const proj = (await call('POST', '/api/chat/projects', { body: { name: 'Site', area: 'dev' } })).j.project;
    actor = bob; const other = (await call('POST', '/api/chat/projects', { body: { name: 'Bob only', area: 'dev' } })).j.project;
    check((await call('PUT', `/api/tasks/agents/${agentId}/projects/${proj.id}`, { token: legacy(bob), body: {} })).s >= 403, 'someone else cannot add Ada’s agent to a project');
    check((await call('PUT', `/api/tasks/agents/${agentId}/projects/${other.id}`, { token: legacy(ada), body: {} })).s === 404, 'Ada cannot add her agent to a project she cannot see');
    const added = await call('PUT', `/api/tasks/agents/${agentId}/projects/${proj.id}`, { token: legacy(ada), body: {} });
    check(added.s === 200 && added.j.projects.some((x) => x.id === proj.id && x.canEdit), 'a project admin adds the agent (editor) to her project');
    check((await call('PUT', `/api/tasks/agents/${agentId}/projects/${proj.id}`, { token: at, body: {} })).s === 403, 'the agent cannot manage its own projects');
    const lp = (await rpc(at, 'tools/call', { name: 'list_projects', arguments: {} })).j.result.structuredContent;
    check(lp.projects.length === 1 && lp.projects[0].name === 'Site', 'list_projects shows only the project it was added to');
    const t = (await call('POST', '/api/tasks', { token: legacy(ada), body: { title: 'Fix the header', projectId: proj.id } })).j.task;
    await call('POST', `/api/tasks/${t.key}/transition`, { token: legacy(ada), body: { to: 'todo' } });
    const linked = (await rpc(at, 'tools/call', { name: 'list_my_tasks', arguments: {} }, { headers: { 'x-xeno-tasks-project': proj.id } })).j.result.structuredContent;
    check(linked.unassigned && linked.unassigned.some((x) => x.key === t.key), 'with the folder’s project header, list_my_tasks offers the project’s unassigned tasks');
    const claimed = (await rpc(at, 'tools/call', { name: 'claim_task', arguments: { key: t.key } })).j.result.structuredContent.task;
    check(claimed.delegate && claimed.delegate.id === agentId && claimed.assignee == null, 'claim_task makes the agent the delegate');
    const raised = (await rpc(at, 'tools/call', { name: 'create_task', arguments: { title: 'Found a bug' } }, { headers: { 'x-xeno-tasks-project': proj.id } })).j.result.structuredContent.task;
    check(raised.project && raised.project.id === proj.id && raised.reporter.id === agentId, 'create_task lands in the linked project, reported by the agent');
    const outside = (await rpc(at, 'tools/call', { name: 'create_task', arguments: { title: 'Sneak', project: other.id } })).j.result;
    check(outside.isError === true, 'it cannot raise a task in a project it is not on');
    await call('DELETE', `/api/tasks/agents/${agentId}/projects/${proj.id}`, { token: legacy(ada) });
    check((await rpc(at, 'tools/call', { name: 'list_projects', arguments: {} })).j.result.structuredContent.projects.length === 0, 'removing the project takes the access away');

    // 7. protocol
    check((await call('POST', '/api/tasks/mcp', { token: at, body: { jsonrpc: '2.0', method: 'notifications/initialized' } })).s === 202, 'a notification is accepted with 202 and no body');
    check((await call('POST', '/api/tasks/mcp', { token: at, body: [{ jsonrpc: '2.0', id: 1, method: 'ping' }] })).s === 400, 'a batch is refused (MCP 2025-06-18 removed batching)');
    check((await rpc(at, 'ping', {}, { headers: { origin: 'https://evil.example' } })).s === 403, 'a request from a foreign browser Origin is refused (DNS-rebinding guard)');
    check((await rpc(at, 'ping', {}, { headers: { 'mcp-protocol-version': '1999-01-01' } })).s === 400, 'an unsupported MCP-Protocol-Version header is refused');
    check((await call('GET', '/api/tasks/mcp', { token: at, headers: { accept: 'text/event-stream' } })).s === 405, 'GET for a server stream answers 405 (stateless server)');

    // 8. revocation
    await logoutEverywhere(pool, { userId: ada });
    const dead = await call('GET', '/api/tasks/agent/me', { token: at });
    check(dead.s === 401 && /error="invalid_token"/.test(dead.h.get('www-authenticate') || ''), 'signing out everywhere kills the agent’s token, with an invalid_token challenge');
  } finally { server.close(); }
  console.log(failed ? `tasks-mcp-oauth: ${failed} failed, ${passed} passed` : `tasks-mcp-oauth: ${passed} checks passed`);
  await pool.end(); process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
