/**
 * XENO MCP routes (XENO AGENT SURFACES & CONNECTORS - SPEC.md §7).
 *
 *   POST   /api/mcp                       the MCP endpoint (Streamable HTTP, stateless JSON responses)
 *   GET    /api/mcp                       a manifest: what is here and how to sign in
 *   GET    /api/mcp/connections           the caller's connected agents             (the person, signed in)
 *   GET    /api/mcp/connections/:id       one connection
 *   PATCH  /api/mcp/connections/:id       { categories: [...] } — turn services on or off for it
 *   DELETE /api/mcp/connections/:id       disconnect: refused on its next call, and it cannot refresh back in
 *   GET    /api/mcp/activity              the call log (?connection=<id>), metadata only
 *   GET    /api/mcp/services              the services a connection can be given
 *
 * Sign-in is the same OAuth the Tasks MCP already uses (RFC 9728 metadata, RFC 7591 registration, PKCE), so a
 * client signed in there works here. Each signed-in client is its own CONNECTION; the management routes are for
 * the person and refuse an agent's token — an agent does not manage agents.
 */
import express from 'express';
import { getClient } from '../utils/oidcProvider.js';
import { acceptedSiteOrigins, issuer } from '../config/hosts.js';
import { resolvePrincipal, assertPrincipalUsable } from '../services/agentIdentity.js';
import * as mcp from '../services/xenoMcp.js';
import { workspaceTokenAuth } from './workspaceAuth.js';
import * as creds from '../services/workspaceCredentials.js';
import { DYNAMIC_SCOPES, WORKSPACE_AUDIENCE } from '../utils/oidcProvider.js';
import { personalWorkspace } from '../services/workforceDivisions.js';

const router = express.Router();

function resourceUrl(req) {
  const origins = acceptedSiteOrigins();
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const secure = `https://${host}`, here = `${proto}://${host}`;
  const origin = origins.includes(secure) ? secure : origins.includes(here) ? here : (origins.find((o) => o.startsWith('https://')) || issuer());
  return { origin, resource: `${origin}/api/mcp`, metadata: `${origin}/.well-known/oauth-protected-resource/api/mcp` };
}
/** RFC 9728: where an MCP client learns which authorization server signs it in for /api/mcp. */
export function mcpResourceMetadata(req, res) {
  const { resource, origin } = resourceUrl(req);
  res.set('cache-control', 'public, max-age=300');
  res.json({ resource, resource_name: 'XENO MCP', authorization_servers: [issuer()], scopes_supported: [...DYNAMIC_SCOPES],
    bearer_methods_supported: ['header'], resource_documentation: `${origin}/workspace/dev/apps/mcp` });
}
export const challenge = (req, res, body, error) => {
  res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceUrl(req).metadata}"${error ? `, error="${error}"` : ''}, scope="tasks:read tasks:write"`);
  return res.status(401).json(body);
};
/** The credential middleware of /api/mcp and /api/v1: workspace sign-ins and xwk_ keys, then the Tasks credentials. */
export const surfaceAuth = workspaceTokenAuth(challenge);

const mcpOriginOk = (req) => { const o = req.headers.origin; return !o || acceptedSiteOrigins().includes(o) || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o); };

router.get('/', (req, res) => {
  if (String(req.headers.accept || '').includes('text/event-stream')) { res.set('Allow', 'POST'); return res.status(405).json({ error: 'This server does not open a server-to-client stream; send requests with POST.' }); }
  res.json(mcp.manifest(resourceUrl(req)));
});
router.delete('/', (req, res) => { res.set('Allow', 'POST'); res.status(405).end(); });

/**
 * The MCP endpoint. A request with no token gets the 401 that names the resource metadata — that is how a
 * client discovers it must sign in. An OAuth MCP token or a platform agent's xtk_ credential is accepted; anything
 * else (a session) is refused. Either way the call is one CONNECTION the person can see and disconnect.
 */
export const needsToken = (req, res, next) => {
  if (!req.headers.authorization) return challenge(req, res, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Sign in to use XENO MCP' } });
  next();
};

/**
 * The connection and principal behind a request's MCP credential, or null once it has answered (401/403). One
 * function for the endpoint and the catalogue, so both see exactly the same caller.
 */
export async function callerOf(req, res, rid, { principal = true } = {}) {
  if (!mcpOriginOk(req)) { res.status(403).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Origin not allowed' } }); return null; }
  const tok = req.taskToken;
  // two ways in: an OAuth sign-in (one connection per signed-in client), or a platform agent's own xtk_ credential
  // (one connection per agent; the credential's expiry and revocation are its gate)
  const viaCredential = Boolean(tok && tok.via !== 'oauth' && tok.via !== 'xwk' && tok.tokenId);
  const viaKey = Boolean(tok && tok.via === 'xwk');
  if (!tok || (!viaCredential && !viaKey && (tok.via !== 'oauth' || !tok.clientId))) {
    challenge(req, res, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'XENO MCP needs a signed-in connection. Add https://xenosystem.ai/api/mcp to your agent and sign in.' } }, 'invalid_token'); return null;
  }
  // a disconnected connection is refused on its very next call, before anything runs
  let connection;
  const workspaceToken = tok.audience === WORKSPACE_AUDIENCE;
  // a workspace credential's connection reaches the categories its scopes name; a NEW sign-in is granted exactly what
  // its scopes reach in the person's own workspace (they consented to those scopes). Other workspaces: granted by hand.
  const fresh = workspaceToken && !viaKey && !(await req.db.query('SELECT 1 FROM mcp_connections WHERE owner_user_id = $1 AND client_id = $2 AND revoked_at IS NULL', [tok.ownerId, tok.clientId])).rows.length;
  if (viaKey) {
    connection = await mcp.connectionFor(req.db, { ownerId: tok.ownerId, agentId: tok.agentUserId, clientId: tok.clientId, clientName: `Key: ${tok.keyName}`, categories: mcp.categoriesForScopes(tok.scopes) });
  } else if (viaCredential) {
    const a = (await req.db.query(`SELECT ai.owner_user_id, ai.public_id, COALESCE(u.display_name, u.username) AS name FROM agent_identities ai JOIN users u ON u.id = ai.user_id WHERE ai.user_id = $1`, [tok.agentUserId])).rows[0];
    if (!a) { challenge(req, res, { jsonrpc: '2.0', id: rid, error: { code: -32001, message: 'This credential does not belong to an agent' } }, 'invalid_token'); return null; }
    connection = await mcp.connectionFor(req.db, { ownerId: String(a.owner_user_id), agentId: tok.agentUserId, clientId: `agent:${a.public_id}`, clientName: a.name, categories: [...mcp.AGENT_DEFAULT_CATEGORIES] });
  } else if (await mcp.isRevoked(req.db, tok.ownerId, tok.clientId)) {
    challenge(req, res, { jsonrpc: '2.0', id: rid, error: { code: -32001, message: 'This connection was disconnected in XENO. Sign in again to reconnect.' } }, 'invalid_token'); return null;
  }
  if (!connection) {
    const client = await getClient(req.db, tok.clientId);
    connection = await mcp.connectionFor(req.db, { ownerId: tok.ownerId, agentId: tok.agentUserId, clientId: tok.clientId, clientName: client ? client.name : null, ...(workspaceToken ? { categories: mcp.categoriesForScopes(tok.scopes) } : {}) });
  }
  if (fresh) await creds.grant(req.db, tok.agentUserId, await personalWorkspace(req.db, tok.ownerId), creds.capabilitiesForScopes(tok.scopes));
  if (!principal) return { connection, actor: null };
  const p = await resolvePrincipal(req.db, tok.agentUserId); assertPrincipalUsable(p);
  const u = (await req.db.query('SELECT COALESCE(display_name, username) AS name FROM users WHERE id = $1', [p.id])).rows[0];
  return { connection, actor: { id: p.id, kind: p.kind, role: p.role, name: u ? u.name : 'Someone', token: tok } };
}

/**
 * GET /api/mcp/catalogue — the capability declarations THIS caller may use (SPEC §19.3), with its own MCP
 * credential. A capability it cannot use is not listed. ETag is the catalogue version for this caller.
 */
router.get('/catalogue', needsToken, surfaceAuth, async (req, res) => {
  try {
    const caller = await callerOf(req, res, null); if (!caller) return;
    const caps = mcp.visibleCapabilities(caller.connection, caller.actor);
    const version = mcp.catalogueVersion(caps), etag = `"${version}"`;
    res.set({ ETag: etag, 'Cache-Control': 'private, no-cache', Vary: 'Authorization' });
    const inm = String(req.headers['if-none-match'] || '').split(',').map((x) => x.trim().replace(/^W\//, ''));
    if (inm.includes(etag) || inm.includes('*')) return res.status(304).end();
    res.json({ success: true, version, capabilities: caps.map(mcp.publicDeclaration) });
  } catch (error) {
    if (error && error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, code: error.code });
    console.error('[xeno mcp]', error);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

router.post('/', needsToken, surfaceAuth, async (req, res) => {
  const body = req.body;
  if (Array.isArray(body)) return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batched requests are not supported (MCP 2025-06-18)' } });
  const pv = req.headers['mcp-protocol-version'];
  if (pv && !mcp.PROTOCOL_VERSIONS.includes(String(pv))) return res.status(400).json({ jsonrpc: '2.0', id: body && body.id != null ? body.id : null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version ${pv}; supported: ${mcp.PROTOCOL_VERSIONS.join(', ')}` } });
  try {
    const notification = body && typeof body === 'object' && body.id === undefined;
    const caller = await callerOf(req, res, body && body.id != null ? body.id : null, { principal: !notification }); if (!caller) return;
    const { connection, actor } = caller;
    if (notification) return res.status(202).end();   // a notification: accept, answer nothing
    const ctx = {
      project: String(req.headers['x-xeno-tasks-project'] || '') || null,
      // SPEC §19.3: a key for every non-safe capability, and the run the call belongs to
      idempotencyKey: String(req.headers['idempotency-key'] || '') || null,
      runId: String(req.headers['x-xeno-run-id'] || '') || null,
      workspaceId: String(req.headers['x-xeno-workspace'] || '') || null,
    };
    const out = await mcp.dispatch(req.db, actor, connection, body || {}, ctx, (log) => mcp.logCall(req.db, connection.id, log));
    res.json(out);
  } catch (error) {
    console.error('[xeno mcp]', error);
    res.status(500).json({ jsonrpc: '2.0', id: body && body.id != null ? body.id : null, error: { code: -32603, message: 'Internal error' } });
  }
});

// ───────────────────────────── management: the person, never an agent

const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (error) {
    if (error instanceof mcp.McpError) return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    console.error('[xeno mcp]', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
/** The management routes run after authMiddleware (the person's session); an agent principal is refused. */
export async function personOnly(req, res, next) {
  try {
    const p = await resolvePrincipal(req.db, req.user.id); assertPrincipalUsable(p);
    if (p.kind !== 'human') return res.status(403).json({ success: false, error: 'Only a person manages their connected agents', code: 'not_allowed' });
    req.owner = String(p.id); next();
  } catch (error) { res.status(error.statusCode || 403).json({ success: false, error: error.message || 'Not allowed', code: error.code || 'not_allowed' }); }
}
export const management = express.Router();
const credsHandled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (error) {
    if (error instanceof creds.WorkspaceCredentialError || error instanceof mcp.McpError) return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    console.error('[xeno mcp] credentials', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
// headless scoped keys (xwk_): the person makes, lists and revokes them; the key is shown once
management.get('/keys', credsHandled(async (req, res) => { res.json({ success: true, keys: await creds.listKeys(req.db, req.owner) }); }));
management.post('/keys', credsHandled(async (req, res) => {
  const b = req.body || {};
  const out = await creds.createKey(req.db, req.owner, { name: b.name, scopes: b.scopes, workspaceId: b.workspace || null, expiresInDays: b.expiresInDays });
  res.status(201).json({ success: true, ...out });
}));
management.delete('/keys/:id', credsHandled(async (req, res) => { res.json({ success: true, ...(await creds.revokeKey(req.db, req.owner, req.params.id)) }); }));
// a connection's workspace grants: capability:<name>@<workspace>
management.get('/connections/:id/grants', credsHandled(async (req, res) => {
  const c = await mcp.getConnection(req.db, req.owner, req.params.id);
  res.json({ success: true, grants: await creds.listGrants(req.db, c.agentId) });
}));
management.put('/connections/:id/grants', credsHandled(async (req, res) => {
  const c = await mcp.getConnection(req.db, req.owner, req.params.id);
  const ws = String((req.body && req.body.workspace) || '');
  const names = Array.isArray(req.body && req.body.capabilities) ? req.body.capabilities.map(String) : null;
  if (!names) throw new creds.WorkspaceCredentialError('capabilities must be a list', 'invalid_capabilities');
  await creds.assertCanGrantIn(req.db, req.owner, ws);
  await creds.revokeGrants(req.db, c.agentId, ws);
  if (names.length) await creds.grant(req.db, c.agentId, ws, names);
  res.json({ success: true, grants: await creds.listGrants(req.db, c.agentId) });
}));
management.get('/services', handled(async (req, res) => {
  res.json({ success: true, services: mcp.SERVICES.map((s) => ({ category: s.category, title: s.title, description: s.description, tools: s.tools().length, ...(s.agentsOnly ? { agentsOnly: true } : {}) })) });
}));
management.get('/connections', handled(async (req, res) => { res.json({ success: true, connections: await mcp.listConnections(req.db, req.owner) }); }));
management.get('/connections/:id', handled(async (req, res) => { res.json({ success: true, connection: await mcp.getConnection(req.db, req.owner, req.params.id) }); }));
management.patch('/connections/:id', handled(async (req, res) => { res.json({ success: true, connection: await mcp.setCategories(req.db, req.owner, req.params.id, req.body && req.body.categories) }); }));
management.delete('/connections/:id', handled(async (req, res) => { res.json({ success: true, ...(await mcp.disconnect(req.db, req.owner, req.params.id)) }); }));
management.get('/activity', handled(async (req, res) => {
  const connection = req.query.connection ? String(req.query.connection) : null;
  if (connection) await mcp.getConnection(req.db, req.owner, connection);   // 404 for someone else's connection
  res.json({ success: true, calls: await mcp.listActivity(req.db, req.owner, { connectionId: connection, limit: req.query.limit }) });
}));

export default router;
