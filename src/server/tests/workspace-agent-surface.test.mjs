/**
 * XENO WORKSPACE AGENT SURFACE - SPEC.md — the P2 proof target, end to end, against a real Postgres.
 *
 * A third-party agent signs in the way Claude Code does (RFC 9728 → RFC 7591 → consent → PKCE) asking for
 * `storage:write share:create`, and over MCP AND over REST: makes a folder, uploads a PDF into it, and makes a
 * sign-in link (PR #824) that opens for a signed-in recipient. Then:
 *   - the token's audience is 'xeno-workspace' and every other API refuses it (whoami, /api/tasks)
 *   - the same run without share:create answers 403 scope_missing (mutation check: the scope is what gates it)
 *   - a grant taken back answers 403 grant_missing
 *   - an irreversible capability without a fresh sign-in answers 403 step_up_required
 *   - a headless xwk_ key does the same over curl-shaped REST; revoked → 401
 *   - disconnecting the sign-in → the very next call answers 401
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/workspace-agent-surface.test.mjs
 */
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import oauth2Routes from '../routes/oauth2Routes.js';
import xenoTasksRoutes, { taskTokenAuth, unlessTaskToken, mcpChallenge } from '../routes/xenoTasksRoutes.js';
import xenoMcpRoutes, { management, personOnly } from '../routes/xenoMcpRoutes.js';
import workspaceApiRoutes from '../routes/workspaceApiRoutes.js';
import { createStorageSharedRouter } from '../routes/storageSharedRoutes.js';
import { authMiddleware } from '../middleware/auth.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';
import { createAuthorizationCode, exchangeAuthorizationCode } from '../utils/oidcProvider.js';
import { stepUpReason } from '../services/workspaceCredentials.js';
import { byName } from '../capabilities/catalogue.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
process.env.SHARE_INVITE_SECRET ||= 'workspace-surface-test-share-invite';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };
const pkce = () => { const v = crypto.randomBytes(32).toString('base64url'); return { v, c: crypto.createHash('sha256').update(v).digest('base64url') }; };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');

async function main() {
  await runAllMigrations(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS external_identity_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system varchar(64) NOT NULL, external_user_id text, external_email text, platform_user_id uuid, updated_at timestamptz, UNIQUE (source_system, platform_user_id))`).catch(() => {});
  await migrateAccountV2(pool);
  await migrateOidcClients(pool);
  const mk = async (m) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,is_active,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,TRUE,NOW())
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [m, `${m}@example.test`])).rows[0].id;
  const ada = await mk('wsa-ada'), investor = await mk('wsa-investor');
  const legacy = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });

  const app = express(); app.use(express.json({ limit: '20mb' })); app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/oauth2', oauth2Routes);
  app.get('/api/whoami', authMiddleware, (req, res) => res.json({ id: req.user.id }));
  app.use('/api/tasks', mcpChallenge, taskTokenAuth, unlessTaskToken(authMiddleware), xenoTasksRoutes);
  app.use('/api/mcp', (req, res, next) => (req.path === '/' || req.path === '/catalogue' ? xenoMcpRoutes(req, res, next) : next()));
  app.use('/api/mcp', authMiddleware, personOnly, management);
  app.use('/api/v1', workspaceApiRoutes);
  app.use('/storage/shared', createStorageSharedRouter());
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body, headers = {}, raw } = {}) => {
    const r = await fetch(origin + path, { method, redirect: 'manual', headers: { ...(body !== undefined ? { 'content-type': raw ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    let j = null; const text = await r.text(); try { j = text ? JSON.parse(text) : null; } catch { j = text; }
    return { s: r.status, j, h: r.headers, text };
  };
  let rid = 0;
  const rpc = (token, method, params) => call('POST', '/api/mcp', { token, body: { jsonrpc: '2.0', id: ++rid, method, params } });
  const tool = async (token, name, args) => { const r = await rpc(token, 'tools/call', { name, arguments: args }); return { s: r.s, res: r.j && r.j.result, data: r.j && r.j.result && r.j.result.structuredContent }; };

  /** Sign an app in the way an MCP client does. `authAgoSec` makes an old sign-in (for the step-up check). */
  const signIn = async (name, scope, { authAgoSec = 0 } = {}) => {
    const reg = await call('POST', '/api/oauth2/register', { body: { client_name: name, redirect_uris: ['http://localhost:33418/callback'], token_endpoint_auth_method: 'none', scope } });
    const p = pkce(), redirect = 'http://localhost:51234/callback';
    let code;
    if (!authAgoSec) {
      const g = await call('POST', '/api/oauth2/authorize', { token: legacy(ada), body: { client_id: reg.j.client_id, redirect_uri: redirect, scope, code_challenge: p.c, code_challenge_method: 'S256', state: 's', consent: true } });
      code = g.j && g.j.code;
    } else {
      code = await createAuthorizationCode(pool, { clientId: reg.j.client_id, userId: ada, redirectUri: redirect, codeChallenge: p.c, codeChallengeMethod: 'S256', scope, authTime: new Date(Date.now() - authAgoSec * 1000) });
    }
    const t = await exchangeAuthorizationCode(pool, { code, clientId: reg.j.client_id, redirectUri: redirect, codeVerifier: p.v });
    return { reg, token: t.access_token };
  };

  try {
    // discovery + registration
    const prm = await call('GET', '/.well-known/oauth-protected-resource/api/mcp');
    const unauth = await call('POST', '/api/v1/storage/folder/create', { body: { name: 'x' } });
    check(unauth.s === 401 && /resource_metadata=/.test(unauth.h.get('www-authenticate') || ''), 'REST with no token is a 401 that names the resource metadata');
    void prm;
    const consent = await call('POST', '/api/oauth2/register', { body: { client_name: 'Probe', redirect_uris: ['http://localhost:33418/callback'], token_endpoint_auth_method: 'none', scope: 'storage:write share:create ledger:spend' } });
    check(consent.s === 201 && consent.j.scope === 'storage:write share:create', 'a client may register for workspace scopes; a non-workspace scope (ledger:spend) is dropped');
    const row = (await pool.query('SELECT access_audience, allowed_scopes FROM oauth_clients WHERE client_id = $1', [consent.j.client_id])).rows[0];
    check(row.access_audience === 'xeno-workspace', 'a client asking beyond Tasks is a workspace client (audience xeno-workspace)');
    const ask = await call('POST', '/api/oauth2/authorize', { token: legacy(ada), body: { client_id: consent.j.client_id, redirect_uri: 'http://localhost:1/callback', scope: 'storage:write share:create', code_challenge: pkce().c, code_challenge_method: 'S256' } });
    check(ask.s === 400 && ask.j.error === 'consent_required' && ask.j.consent.scopes.includes('share:create'), 'the person is asked to consent, and the screen is given the scopes');

    // the proof target: storage:write share:create
    const a = await signIn('Claude Code', 'storage:write share:create');
    const claims = jwt.decode(a.token);
    check(claims.aud === 'xeno-workspace' && claims.scope.includes('share:create'), 'the token names the xeno-workspace audience and the granted scopes');
    check((await call('GET', '/api/whoami', { token: a.token })).s === 401, 'every other API refuses it (authMiddleware wants xeno-api)');
    check((await call('GET', '/api/tasks/agent/me', { token: a.token })).s === 401, 'and so does /api/tasks (Tasks audience only)');

    // over MCP
    const init = await rpc(a.token, 'initialize', { protocolVersion: '2025-06-18' });
    check(init.s === 200 && init.j.result && init.j.result.serverInfo.name === 'xeno-mcp', 'MCP initialize works with the workspace sign-in');
    const names = ((await rpc(a.token, 'tools/list', {})).j.result.tools || []).map((t) => t.name);
    check(names.includes('storage__folder__create') && names.includes('storage__link__create') && !names.some((n) => n.startsWith('tasks')) && !names.includes('storage__folder__list'), 'tools/list shows exactly what its scopes reach (no tasks, no storage:read)');
    const f1 = await tool(a.token, 'storage__folder__create', { name: 'Deck room (MCP)' });
    check(f1.data && f1.data.folder && f1.data.folder.id, `MCP: the agent makes a folder in its owner’s Storage (${JSON.stringify(f1.res && f1.res.structuredContent)})`);
    const owned = (await pool.query('SELECT owner_user_id FROM storage_folders WHERE id = $1', [f1.data.folder.id])).rows[0];
    check(owned && String(owned.owner_user_id) === String(ada), 'the folder is the person’s own, not the agent’s');
    const up1 = await tool(a.token, 'storage__file__upload', { name: 'deck.pdf', mime_type: 'application/pdf', content_base64: PDF, folder: f1.data.folder.id, request_key: 'mcp-upload-0001' });
    check(up1.data && up1.data.file && up1.data.file.folderId === f1.data.folder.id, 'MCP: it uploads a PDF into that folder');
    const up1b = await tool(a.token, 'storage__file__upload', { name: 'deck.pdf', mime_type: 'application/pdf', content_base64: PDF, folder: f1.data.folder.id, request_key: 'mcp-upload-0001' });
    check(up1b.res && up1b.res._meta && up1b.res._meta['xeno/replayed'] === true && up1b.data.file.id === up1.data.file.id, 'a retried upload with the same request_key is answered, not stored twice');
    const l1 = await tool(a.token, 'storage__link__create', { folder: f1.data.folder.id });
    check(l1.data && /\/storage\/shared\/[A-Za-z0-9_-]{43}$/.test(l1.data.url), 'MCP: it makes a sign-in link');

    // over REST
    const f2 = await call('POST', '/api/v1/storage/folder/create', { token: a.token, body: { name: 'Deck room (REST)' } });
    check(f2.s === 200 && f2.j.success && f2.j.data.folder.id, 'REST: POST /api/v1/storage/folder/create makes a folder');
    const up2 = await call('POST', '/api/v1/storage/file/upload', { token: a.token, body: { name: 'deck2.pdf', mime_type: 'application/pdf', content_base64: PDF, folder: f2.j.data.folder.id, request_key: 'rest-upload-0001' } });
    check(up2.s === 200 && up2.j.data.file.folderId === f2.j.data.folder.id, 'REST: it uploads a PDF into it');
    const l2 = await call('POST', '/api/v1/storage/link/create', { token: a.token, body: { folder: f2.j.data.folder.id, expires_in_days: 7 } });
    check(l2.s === 200 && /\/storage\/shared\//.test(l2.j.data.url), 'REST: it makes a sign-in link');
    check((await call('GET', '/api/v1/storage/link/create', { token: a.token })).s === 405, 'a capability that changes something refuses GET');

    // the link opens for a signed-in recipient
    await pool.query(`UPDATE library_asset_ingestions SET state = 'ready' WHERE asset_id = ANY($1::uuid[])`, [[up1.data.file.id, up2.j.data.file.id]]);
    const tok1 = l1.data.url.split('/storage/shared/')[1], tok2 = l2.j.data.url.split('/storage/shared/')[1];
    check((await call('GET', `/storage/shared/${tok1}`)).s === 401, 'signed out, the link shows only a sign-in page');
    const open1 = await call('GET', `/storage/shared/${tok1}`, { token: legacy(investor) });
    check(open1.s === 200 && /deck\.pdf/.test(open1.text), 'signed in, the recipient sees the folder and the PDF (MCP-made link)');
    const open2 = await call('GET', `/storage/shared/${tok2}`, { token: legacy(investor) });
    check(open2.s === 200 && /deck2\.pdf/.test(open2.text), 'and the REST-made link opens too');
    const dl = await fetch(`${origin}/storage/shared/${tok1}/files/${up1.data.file.id}?download=1`, { headers: { authorization: 'Bearer ' + legacy(investor) } });
    check(dl.status === 200 && (await dl.text()).startsWith('%PDF-1.4'), 'and downloads the very bytes the agent uploaded');

    // missing scope → 403 (the mutation: the same run without share:create)
    const b = await signIn('Claude Code no-share', 'storage:write');
    const bf = await call('POST', '/api/v1/storage/folder/create', { token: b.token, body: { name: 'No-share room' } });
    const bl = await call('POST', '/api/v1/storage/link/create', { token: b.token, body: { folder: bf.j.data.folder.id } });
    check(bf.s === 200 && bl.s === 403 && bl.j.code === 'scope_missing', `without share:create the link is refused 403 scope_missing (${bl.s} ${bl.j && bl.j.code})`);
    const bm = await tool(b.token, 'storage__link__create', { folder: bf.j.data.folder.id });
    check(bm.res && bm.res.isError && bm.data.code === 'scope_missing', 'over MCP too');

    // a grant taken back → 403 grant_missing
    const conns = (await call('GET', '/api/mcp/connections', { token: legacy(ada) })).j.connections;
    const ca = conns.find((c) => c.client.name === 'Claude Code');
    const gr = (await call('GET', `/api/mcp/connections/${ca.id}/grants`, { token: legacy(ada) })).j.grants;
    check(gr.some((g) => g.capability === 'storage.link.create') && gr.every((g) => /^[0-9a-f-]{36}$/.test(g.workspaceId)), 'a new sign-in is granted what its scopes reach, workspace-bound (capability:<name>@<workspace>)');
    const ws = gr[0].workspaceId;
    await call('PUT', `/api/mcp/connections/${ca.id}/grants`, { token: legacy(ada), body: { workspace: ws, capabilities: ['storage.folder.create'] } });
    const gm = await call('POST', '/api/v1/storage/link/create', { token: a.token, body: { folder: f2.j.data.folder.id } });
    check(gm.s === 403 && gm.j.code === 'grant_missing', `with the grant taken back the same token is refused 403 grant_missing (${gm.s} ${gm.j && gm.j.code})`);
    const other = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Other Co', 'wsa-other-co') RETURNING id`, [investor])).rows[0].id;
    const wrongWs = await call('POST', '/api/v1/storage/folder/create', { token: a.token, body: { name: 'elsewhere' }, headers: { 'x-xeno-workspace': other } });
    check(wrongWs.s === 403 && wrongWs.j.code === 'grant_missing', 'a grant in one workspace opens nothing in another');

    // step-up: an irreversible capability needs a fresh sign-in
    check(stepUpReason(byName.get('canvas.item.update')) === 'irreversible' && stepUpReason({ class: 'undoable', cost: { model: 'quoted' } }, { serverCredits: 5001 }) === 'spend'
      && stepUpReason({ class: 'undoable', cost: { model: 'quoted' } }, { serverCredits: 4000, teamLeftCredits: 1000 }) === 'spend' && stepUpReason({ class: 'undoable', cost: { model: 'quoted' } }, { serverCredits: 4000 }) === null,
    'step-up rule: irreversible always; spend above the lower of the team budget and EUR 50');
    const old = await signIn('Old sign-in', 'tasks:write storage:read', { authAgoSec: 3600 });
    const su = await call('POST', '/api/v1/canvas/item/update', { token: old.token, body: { canvas: crypto.randomUUID(), changes: [] } });
    check(su.s === 403 && su.j.code === 'step_up_required' && /insufficient_user_authentication/.test(su.h.get('www-authenticate') || ''), `an irreversible call on an hour-old sign-in is refused 403 step_up_required (${su.s} ${su.j && su.j.code})`);

    // workforce (the division after Storage): the REST/MCP answer IS the service's answer, for the same actor
    const w = await signIn('Workforce agent', 'agents:read agents:write workspace:read workspace:admin');
    const wAgent = (await pool.query(`SELECT ai.user_id FROM agent_identities ai JOIN users u ON u.id = ai.user_id WHERE ai.owner_user_id = $1 AND u.display_name = 'Workforce agent'`, [ada])).rows[0];
    const wl = await call('POST', '/api/v1/division/division/list', { token: w.token, body: {} });
    const divisionsSvc = await import('../services/workforceDivisions.js');
    const wa = wAgent || (await pool.query(`SELECT user_id FROM agent_identities WHERE owner_user_id = $1 ORDER BY created_at DESC LIMIT 1`, [ada])).rows[0];
    let direct; try { direct = { ok: true, v: await divisionsSvc.list(pool, { id: String(wa.user_id), kind: 'agent' }, {}) }; } catch (e) { direct = { ok: false, code: e.code }; }
    if (wl.s === 500 || process.env.DEBUG_WS) console.log('   division list:', wl.s, JSON.stringify(wl.j), JSON.stringify(direct));
    check(wl.s !== 500 && (direct.ok ? wl.s === 200 && JSON.stringify(wl.j.data.divisions || wl.j.data) === JSON.stringify(JSON.parse(JSON.stringify(direct.v.divisions || direct.v))) : wl.j.code === direct.code), `division.division.list over REST answers exactly what workforceDivisions.list answers for that agent (${wl.s} ${wl.j && (wl.j.code || 'ok')})`);
    const cat = await call('POST', '/api/v1/agent/catalog/list', { token: w.token, body: { actorUserId: ada } });
    check(cat.s === 400 && cat.j.code === 'bad_input', 'a workforce body naming another actor is refused bad_input, as the routes refuse it');
    const wt = (await rpc(w.token, 'tools/list', {})).j.result.tools.map((t) => t.name);
    check(['agent__resource__create', 'run__admission__revoke', 'division__division__create', 'objective__objective__create'].every((n) => wt.includes(n)) && !wt.some((n) => n.startsWith('funding__')), 'the §11.1 agent.* / run.* / division.* / objective.* tools are listed; funding.* is not (no wallet scope)');
    const rk = await call('POST', '/api/v1/run/admission/revoke', { token: w.token, body: { admissionId: crypto.randomUUID() } });
    check(rk.s >= 400 && rk.s < 500 && rk.j.code !== 'step_up_required' && rk.j.code !== 'scope_missing', `a fresh sign-in passes step-up and reaches revokeRun, which answers in its own closed vocabulary (${rk.s} ${rk.j && rk.j.code})`);

    // headless xwk_ keys
    const noExp = await call('POST', '/api/mcp/keys', { token: legacy(ada), body: { name: 'ci', scopes: ['storage:write'] } });
    check(noExp.s === 400 && noExp.j.code === 'invalid_expiry', 'a key without an expiry is refused');
    const k = await call('POST', '/api/mcp/keys', { token: legacy(ada), body: { name: 'ci', scopes: ['storage:write', 'share:create'], expiresInDays: 7 } });
    check(k.s === 201 && /^xwk_/.test(k.j.key), 'the person makes a scoped xwk_ key (shown once)');
    check((await pool.query('SELECT count(*)::int AS n FROM workspace_agent_keys WHERE key_sha256 = $1', [k.j.key])).rows[0].n === 0, 'only its hash is stored');
    const kf = await call('POST', '/api/v1/storage/folder/create', { token: k.j.key, body: { name: 'Key room' } });
    const kl = await call('POST', '/api/v1/storage/link/create', { token: k.j.key, body: { folder: kf.j && kf.j.data && kf.j.data.folder.id } });
    check(kf.s === 200 && kl.s === 200, `curl with the key: folder and sign-in link over REST (${kf.s} ${kl.s})`);
    check((await call('GET', '/api/whoami', { token: k.j.key })).s === 401, 'the key is refused by every other API');
    await call('DELETE', `/api/mcp/keys/${k.j.credential.id}`, { token: legacy(ada) });
    const kr = await call('POST', '/api/v1/storage/folder/create', { token: k.j.key, body: { name: 'after revoke' } });
    check(kr.s === 401, `a revoked key answers 401 on its next call (${kr.s})`);

    // revoke the sign-in → 401 on the next call
    await call('DELETE', `/api/mcp/connections/${ca.id}`, { token: legacy(ada) });
    const rv = await call('POST', '/api/v1/storage/folder/create', { token: a.token, body: { name: 'after disconnect' } });
    check(rv.s === 401, `disconnected in Settings, the very next REST call answers 401 (${rv.s})`);
    const rvm = await rpc(a.token, 'tools/list', {});
    check(rvm.s === 401, 'and MCP answers 401 too');
    const audit = (await pool.query(`SELECT count(*)::int AS n FROM mcp_calls k JOIN mcp_connections c ON c.id = k.connection_id WHERE c.owner_user_id = $1`, [ada])).rows[0].n;
    check(audit >= 10, `every call was audited (metadata only): ${audit} rows`);
  } finally {
    server.close();
    console.log(`\nworkspace-agent-surface: ${passed} passed, ${failed} failed`);
    await pool.end();
    process.exit(failed ? 1 : 0);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
