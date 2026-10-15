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
import { taskTokenAuth } from './xenoTasksRoutes.js';
import { resolvePrincipal, assertPrincipalUsable } from '../services/agentIdentity.js';
import * as mcp from '../services/xenoMcp.js';

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
  res.json({ resource, resource_name: 'XENO MCP', authorization_servers: [issuer()], scopes_supported: ['tasks:read', 'tasks:write'],
    bearer_methods_supported: ['header'], resource_documentation: `${origin}/workspace/dev/apps/mcp` });
}
const challenge = (req, res, body, error) => {
  res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceUrl(req).metadata}"${error ? `, error="${error}"` : ''}, scope="tasks:read tasks:write"`);
  return res.status(401).json(body);
};

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
router.post('/', (req, res, next) => {
  if (!req.headers.authorization) return challenge(req, res, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Sign in to use XENO MCP' } });
  next();
}, taskTokenAuth, async (req, res) => {
  const body = req.body;
  if (!mcpOriginOk(req)) return res.status(403).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Origin not allowed' } });
  const tok = req.taskToken;
  // two ways in: an OAuth sign-in (one connection per signed-in client), or a platform agent's own xtk_ credential
  // (one connection per agent; the credential's expiry and revocation are its gate)
  const viaCredential = Boolean(tok && tok.via !== 'oauth' && tok.tokenId);
  if (!tok || (!viaCredential && (tok.via !== 'oauth' || !tok.clientId))) {
    return challenge(req, res, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'XENO MCP needs a signed-in connection. Add https://xenosystem.ai/api/mcp to your agent and sign in.' } }, 'invalid_token');
  }
  if (Array.isArray(body)) return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batched requests are not supported (MCP 2025-06-18)' } });
  const pv = req.headers['mcp-protocol-version'];
  if (pv && !mcp.PROTOCOL_VERSIONS.includes(String(pv))) return res.status(400).json({ jsonrpc: '2.0', id: body && body.id != null ? body.id : null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version ${pv}; supported: ${mcp.PROTOCOL_VERSIONS.join(', ')}` } });
  try {
    // a disconnected connection is refused on its very next call, before anything runs
    let connection;
    if (viaCredential) {
      const a = (await req.db.query(`SELECT ai.owner_user_id, ai.public_id, COALESCE(u.display_name, u.username) AS name FROM agent_identities ai JOIN users u ON u.id = ai.user_id WHERE ai.user_id = $1`, [tok.agentUserId])).rows[0];
      if (!a) return challenge(req, res, { jsonrpc: '2.0', id: body && body.id != null ? body.id : null, error: { code: -32001, message: 'This credential does not belong to an agent' } }, 'invalid_token');
      connection = await mcp.connectionFor(req.db, { ownerId: String(a.owner_user_id), agentId: tok.agentUserId, clientId: `agent:${a.public_id}`, clientName: a.name });
    } else if (await mcp.isRevoked(req.db, tok.ownerId, tok.clientId)) {
      return challenge(req, res, { jsonrpc: '2.0', id: body && body.id != null ? body.id : null, error: { code: -32001, message: 'This connection was disconnected in XENO. Sign in again to reconnect.' } }, 'invalid_token');
    }
    if (!connection) {
      const client = await getClient(req.db, tok.clientId);
      connection = await mcp.connectionFor(req.db, { ownerId: tok.ownerId, agentId: tok.agentUserId, clientId: tok.clientId, clientName: client ? client.name : null });
    }
    if (body && typeof body === 'object' && body.id === undefined) return res.status(202).end();   // a notification: accept, answer nothing
    const p = await resolvePrincipal(req.db, tok.agentUserId); assertPrincipalUsable(p);
    const u = (await req.db.query('SELECT COALESCE(display_name, username) AS name FROM users WHERE id = $1', [p.id])).rows[0];
    const actor = { id: p.id, kind: p.kind, role: p.role, name: u ? u.name : 'Someone', token: tok };
    const out = await mcp.dispatch(req.db, actor, connection, body || {}, { project: String(req.headers['x-xeno-tasks-project'] || '') || null },
      (log) => mcp.logCall(req.db, connection.id, log));
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
management.get('/services', handled(async (req, res) => {
  res.json({ success: true, services: mcp.SERVICES.map((s) => ({ category: s.category, title: s.title, description: s.description, tools: s.tools().length })) });
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
