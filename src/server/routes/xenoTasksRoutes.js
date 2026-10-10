/**
 * /api/tasks — XENO Tasks (codename Telos). Product spec: xeno-tasks/SPEC.md; rules: services/xenoTasks.js.
 *
 *   GET    /api/tasks?area=&projectId=&status=&assignee=me|none|<id>&q=   the tasks the caller can see
 *   POST   /api/tasks                                     raise one (lands in `raised`)
 *   GET    /api/tasks/:key                                one task (T-123) with its history and the moves allowed
 *   PATCH  /api/tasks/:key                                edit, assign, set the review
 *   POST   /api/tasks/:key/transition {to, from?, note?}  move it (the state machine and who may); `from` = the status
 *                                                           the screen showed — refused with 409 if it has moved since
 *   POST   /api/tasks/:key/claim                          take it (atomic)
 *   POST   /api/tasks/:key/comments {body}                comment
 *   DELETE /api/tasks/:key                                delete (project admin; the reporter while still in triage)
 *   POST   /api/tasks/:key/attachments?name=              add an image (raw body; PNG, JPEG, GIF or WebP, by signature)
 *   GET    /api/tasks/:key/attachments/:id                the image, to anyone who can see the task
 *   DELETE /api/tasks/:key/attachments/:id                remove it (whoever added it, or a manager)
 *   GET    /api/tasks/assignees?projectId=                who a task there can be assigned to (people and agents)
 *   POST   /api/tasks/:key/restore                        undo a delete (30 days)
 *   PATCH|DELETE /api/tasks/:key/comments/:id              edit or remove a comment (its author; a project admin removes)
 *   PUT|DELETE /api/tasks/:key/watch                       watch / stop watching
 *   POST   /api/tasks/:key/links {kind,to}  DELETE /api/tasks/:key/links/:id     blocks · blocked_by · relates · duplicates
 *   GET|POST /api/tasks/views   DELETE /api/tasks/views/:id                       saved views (the caller's own)
 *
 * The caller is a principal (person or agent); agents act through the same routes as a person's screen.
 */
import express from 'express';
import * as tasks from '../services/xenoTasks.js';
import { resolvePrincipal, assertPrincipalUsable } from '../services/agentIdentity.js';
import * as mcp from '../services/tasksMcp.js';
import { verifyTasksAccessToken, getClient } from '../utils/oidcProvider.js';
import { acceptedSiteOrigins, issuer } from '../config/hosts.js';
import { requireEntitlement } from '../middleware/requireEntitlement.js';

const router = express.Router();   // mounted behind authMiddleware in index.js (see taskTokenAuth for agents)

/** Agents authenticate with their OWN Tasks credential (Authorization: Bearer xtk_…), never a person's.
 *  Mounted BEFORE authMiddleware: a valid credential becomes the agent principal; an invalid one is refused here
 *  (it never falls through to be read as something else). */
/** Where an MCP client learns how to sign in (RFC 9728), for the host it was given. */
export function resourceUrl(req) {
  const origins = acceptedSiteOrigins();
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  // the edge terminates TLS (Cloudflare → nginx speaks http), so prefer the https form of the host asked for
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const secure = `https://${host}`, here = `${proto}://${host}`;
  const origin = origins.includes(secure) ? secure : origins.includes(here) ? here : (origins.find((o) => o.startsWith('https://')) || issuer());
  return { origin, resource: `${origin}/api/tasks/mcp`, metadata: `${origin}/.well-known/oauth-protected-resource/api/tasks/mcp` };
}
export function protectedResourceMetadata(req, res) {
  const { resource } = resourceUrl(req);
  res.set('cache-control', 'public, max-age=300');
  res.json({ resource, resource_name: 'XENO Tasks', authorization_servers: [issuer()], scopes_supported: ['tasks:read', 'tasks:write'],
    bearer_methods_supported: ['header'], resource_documentation: `${resourceUrl(req).origin}/workspace/tasks/Agents` });
}
const challenge = (req, res, body, error) => {
  res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceUrl(req).metadata}"${error ? `, error="${error}"` : ''}, scope="tasks:read tasks:write"`);
  return res.status(401).json(body);
};
/** MCP clients discover sign-in from a 401 that names the resource metadata (MCP authorization spec). */
export function mcpChallenge(req, res, next) {
  if (req.path === '/mcp' && !req.headers.authorization) return challenge(req, res, { success: false, error: 'Sign in to use XENO Tasks', code: 'auth_required' });
  next();
}

export async function taskTokenAuth(req, res, next) {
  const h = String(req.headers.authorization || '');
  const bearer = /^Bearer\s+(.+)$/i.exec(h)?.[1]?.trim() || null;
  if (bearer && !bearer.startsWith('xtk_') && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(bearer)) {
    // an OAuth access token for the Tasks audience: the person's MCP agent, never the person
    try {
      const claims = await verifyTasksAccessToken(req.db, bearer);
      if (!claims) return next();                       // a first-party token: authMiddleware handles it as the person
      const scopes = String(claims.scope || '').split(/\s+/).filter((s) => s === 'tasks:read' || s === 'tasks:write');
      if (!scopes.length) return challenge(req, res, { success: false, error: 'This sign-in has no Tasks access', code: 'insufficient_scope' }, 'insufficient_scope');
      const client = claims.client_id ? await getClient(req.db, claims.client_id) : null;
      const agentId = await tasks.mcpAgentFor(req.db, claims.sub, client ? client.name : null);
      req.user = { id: agentId };
      req.taskToken = { agentUserId: agentId, scopes, taskId: null, via: 'oauth', clientId: claims.client_id || null, ownerId: String(claims.sub) };
      return next();
    } catch (e) {
      if (e instanceof tasks.TaskError) return res.status(e.status).json({ success: false, error: e.message, code: e.code });
      return challenge(req, res, { success: false, error: 'This sign-in is no longer valid. Sign in again.', code: 'invalid_token' }, 'invalid_token');
    }
  }
  const raw = bearer && bearer.startsWith('xtk_') ? bearer : null;
  if (!raw) return next();
  try {
    const tok = await tasks.resolveTaskToken(req.db, raw);
    if (!tok) return res.status(401).json({ success: false, error: 'This Tasks credential is not valid (unknown, expired or revoked)', code: 'invalid_task_token' });
    req.user = { id: tok.agentUserId }; req.taskToken = tok; next();
  } catch (e) { console.error('[tasks] token', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
}
/** skip a middleware for a request already authenticated by an agent credential */
export const unlessTaskToken = (mw) => (req, res, next) => (req.taskToken ? next() : mw(req, res, next));

router.use(async (req, res, next) => {
  try { const p = await resolvePrincipal(req.db, req.user.id); assertPrincipalUsable(p); const u = (await req.db.query('SELECT COALESCE(display_name, username) AS name FROM users WHERE id = $1', [p.id])).rows[0]; req.me = { id: p.id, kind: p.kind, role: p.role, name: u ? u.name : 'Someone' }; if (req.taskToken) req.me.token = req.taskToken; next(); }
  catch (error) { res.status(error.statusCode || 403).json({ success: false, error: error.message || 'Not allowed', code: error.code || 'not_allowed' }); }
});
// what an agent credential may do: reads need tasks:read, everything else tasks:write; a single-task credential (the
// hand-off link) reaches only its own task, and none of the management surfaces
const SINGLE_TASK_OK = /^\/(T-\d+)(\/(?:transition|claim|comments(?:\/[\w-]+)?|activity|attachments(?:\/[\w-]+)?|watch))?$/i;
router.use(handledMw(async (req) => {
  const tok = req.taskToken; if (!tok) return;
  const need = req.method === 'GET' || req.method === 'HEAD' || req.path === '/mcp' ? 'tasks:read' : 'tasks:write';
  if (!tok.scopes.includes(need)) throw new tasks.TaskError(`This credential lacks ${need}`, 'scope_missing', 403);
  if (tok.taskId) {
    if (req.path === '/' && req.method === 'GET') return;            // the list, narrowed to the one task below
    if (req.path === '/mcp' || req.path === '/agent/events' || req.path === '/agent/me') return;
    const m = SINGLE_TASK_OK.exec(req.path);
    if (!m || req.method === 'DELETE' && !/attachments/.test(req.path)) throw new tasks.TaskError('This credential is for one task only', 'single_task', 403);
    const id = (await req.db.query('SELECT id FROM tasks WHERE number = $1', [m[1].slice(2)])).rows[0];
    if (!id || String(id.id) !== tok.taskId) throw new tasks.TaskError('This credential is for one task only', 'single_task', 403);
  }
  if (/^\/agents(\/|$)/.test(req.path)) throw new tasks.TaskError('Agents can’t manage agents', 'not_allowed', 403);
}));
function handledMw(fn) { return async (req, res, next) => { try { await fn(req); next(); } catch (error) { if (error instanceof tasks.TaskError) return res.status(error.status).json({ success: false, error: error.message, code: error.code }); console.error('[tasks]', error); res.status(500).json({ success: false, error: 'Internal server error' }); } }; }
const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (error) {
    if (error instanceof tasks.TaskError) return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    console.error('[tasks]', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

router.get('/', handled(async (req, res) => {
  let list = await tasks.listTasks(req.db, req.me, { area: req.query.area, projectId: req.query.projectId, status: req.query.status, assignee: req.query.assignee, delegate: req.query.delegate, q: req.query.q, limit: req.query.limit });
  if (req.taskToken && req.taskToken.taskId) list = list.filter((x) => String(x.id) === req.taskToken.taskId);
  res.json({ success: true, tasks: list });
}));
router.post('/', handled(async (req, res) => {
  res.status(201).json({ success: true, task: await tasks.createTask(req.db, req.me, req.body || {}) });
}));
router.get('/views', handled(async (req, res) => { res.json({ success: true, views: await tasks.listViews(req.db, req.me) }); }));
router.post('/views', handled(async (req, res) => { res.json({ success: true, views: await tasks.saveView(req.db, req.me, req.body || {}) }); }));
router.delete('/views/:id', handled(async (req, res) => { res.json({ success: true, views: await tasks.deleteView(req.db, req.me, req.params.id) }); }));
// agents: the caller's own agents and their credentials; an agent's own feed; MCP
router.get('/agents', handled(async (req, res) => { res.json({ success: true, agents: await tasks.listMyAgents(req.db, req.me) }); }));
router.post('/agents', unlessTaskToken(requireEntitlement('agents')), handled(async (req, res) => { res.status(201).json({ success: true, ...(await tasks.createTaskAgent(req.db, req.me, req.body || {})) }); }));
router.post('/agents/tokens', handled(async (req, res) => { res.status(201).json({ success: true, ...(await tasks.mintAgentToken(req.db, req.me, req.body || {})) }); }));
router.delete('/agents/tokens/:id', handled(async (req, res) => { res.json({ success: true, ...(await tasks.revokeAgentToken(req.db, req.me, req.params.id)) }); }));
router.put('/agents/webhook', handled(async (req, res) => { res.json({ success: true, ...(await tasks.setAgentWebhook(req.db, req.me, req.body || {})) }); }));
router.get('/agent/events', handled(async (req, res) => { res.json({ success: true, ...(await tasks.agentEvents(req.db, req.me, { after: req.query.after, limit: req.query.limit })) }); }));
router.get('/agent/me', handled(async (req, res) => { res.json({ success: true, agent: { id: String(req.me.id), name: req.me.name, kind: req.me.kind, scopes: req.taskToken ? req.taskToken.scopes : null, task: req.taskToken && req.taskToken.taskId ? true : false }, tasks: (await tasks.listTasks(req.db, req.me, { delegate: 'me', status: 'raised,todo,in_progress,blocked,in_review' })).filter((x) => !req.taskToken || !req.taskToken.taskId || String(x.id) === req.taskToken.taskId) }); }));
router.get('/projects', handled(async (req, res) => { res.json({ success: true, projects: await tasks.listTaskProjects(req.db, req.me) }); }));
router.get('/agents/:id/projects', handled(async (req, res) => { res.json({ success: true, ...(await tasks.agentProjects(req.db, req.me, req.params.id)) }); }));
router.put('/agents/:id/projects/:projectId', handled(async (req, res) => { res.json({ success: true, ...(await tasks.addAgentProject(req.db, req.me, req.params.id, req.params.projectId, req.body?.relation || 'editor')) }); }));
router.delete('/agents/:id/projects/:projectId', handled(async (req, res) => { res.json({ success: true, ...(await tasks.removeAgentProject(req.db, req.me, req.params.id, req.params.projectId)) }); }));

// MCP over Streamable HTTP (spec 2025-06-18): stateless JSON responses, no server-initiated stream.
const mcpOriginOk = (req) => { const o = req.headers.origin; return !o || acceptedSiteOrigins().includes(o) || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o); };
router.get('/mcp', (req, res) => {
  if (String(req.headers.accept || '').includes('text/event-stream')) { res.set('Allow', 'POST'); return res.status(405).json({ error: 'This server does not open a server-to-client stream; send requests with POST.' }); }
  res.json(mcp.manifest(resourceUrl(req)));
});
router.delete('/mcp', (req, res) => { res.set('Allow', 'POST'); res.status(405).end(); });
router.post('/mcp', async (req, res) => {
  const body = req.body;
  // DNS-rebinding guard (the spec's MUST): a browser page on another origin may not drive this endpoint
  if (!mcpOriginOk(req)) return res.status(403).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Origin not allowed' } });
  if (Array.isArray(body)) return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batched requests are not supported (MCP 2025-06-18)' } });
  const pv = req.headers['mcp-protocol-version'];
  if (pv && !mcp.PROTOCOL_VERSIONS.includes(String(pv))) return res.status(400).json({ jsonrpc: '2.0', id: body && body.id != null ? body.id : null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version ${pv}; supported: ${mcp.PROTOCOL_VERSIONS.join(', ')}` } });
  // a notification or a response carries no id: accept it, answer nothing
  if (body && typeof body === 'object' && body.id === undefined) return res.status(202).end();
  try {
    const out = await mcp.dispatch(req.db, req.me, body || {}, { project: String(req.headers['x-xeno-tasks-project'] || '') || null });
    res.json(out);
  } catch (error) { console.error('[tasks mcp]', error); res.status(500).json({ jsonrpc: '2.0', id: body && body.id != null ? body.id : null, error: { code: -32603, message: 'Internal error' } }); }
});
router.get('/assignees', handled(async (req, res) => { res.json({ success: true, assignees: await tasks.listAssignees(req.db, req.me, { projectId: req.query.projectId }) }); }));
router.get('/:key', handled(async (req, res) => { res.json({ success: true, task: await tasks.getTask(req.db, req.me, req.params.key) }); }));
router.patch('/:key', handled(async (req, res) => { res.json({ success: true, task: await tasks.updateTask(req.db, req.me, req.params.key, req.body || {}) }); }));
router.post('/:key/transition', handled(async (req, res) => { res.json({ success: true, task: await tasks.transitionTask(req.db, req.me, req.params.key, { to: req.body?.to, note: req.body?.note, from: req.body?.from }) }); }));
router.post('/:key/claim', handled(async (req, res) => { res.json({ success: true, task: await tasks.claimTask(req.db, req.me, req.params.key) }); }));
router.post('/:key/comments', handled(async (req, res) => { res.json({ success: true, task: await tasks.commentTask(req.db, req.me, req.params.key, { body: req.body?.body }) }); }));

router.delete('/:key', handled(async (req, res) => { res.json({ success: true, ...(await tasks.deleteTask(req.db, req.me, req.params.key)) }); }));
const rawImage = express.raw({ type: () => true, limit: tasks.ATTACH_MAX_BYTES + 1024 });
router.post('/:key/attachments', (req, res, next) => rawImage(req, res, (err) => (err ? res.status(err.type === 'entity.too.large' ? 413 : 400).json({ success: false, error: err.type === 'entity.too.large' ? 'Images can be at most 8 MB' : 'The image could not be read', code: err.type === 'entity.too.large' ? 'image_too_large' : 'bad_body' }) : next())),
  handled(async (req, res) => { res.status(201).json({ success: true, task: await tasks.addAttachment(req.db, req.me, req.params.key, { filename: req.query.name, data: Buffer.isBuffer(req.body) ? req.body : null }) }); }));
router.get('/:key/attachments/:id', handled(async (req, res) => {
  const a = await tasks.getAttachment(req.db, req.me, req.params.key, req.params.id);
  // the type was decided from the file's signature at upload; nosniff + a sandboxing CSP keep it an image
  res.set({ 'Content-Type': a.mime, 'Content-Length': String(a.size_bytes), 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.filename)}` });
  res.end(a.data);
}));
router.delete('/:key/attachments/:id', handled(async (req, res) => { res.json({ success: true, task: await tasks.removeAttachment(req.db, req.me, req.params.key, req.params.id) }); }));

router.post('/:key/restore', handled(async (req, res) => { res.json({ success: true, task: await tasks.restoreTask(req.db, req.me, req.params.key) }); }));
router.patch('/:key/comments/:id', handled(async (req, res) => { res.json({ success: true, task: await tasks.editComment(req.db, req.me, req.params.key, req.params.id, { body: req.body?.body }) }); }));
router.delete('/:key/comments/:id', handled(async (req, res) => { res.json({ success: true, task: await tasks.removeComment(req.db, req.me, req.params.key, req.params.id) }); }));
router.put('/:key/watch', handled(async (req, res) => { res.json({ success: true, task: await tasks.setWatching(req.db, req.me, req.params.key, true) }); }));
router.delete('/:key/watch', handled(async (req, res) => { res.json({ success: true, task: await tasks.setWatching(req.db, req.me, req.params.key, false) }); }));
router.post('/:key/links', handled(async (req, res) => { res.json({ success: true, task: await tasks.addLink(req.db, req.me, req.params.key, { kind: req.body?.kind, to: req.body?.to }) }); }));
router.delete('/:key/links/:id', handled(async (req, res) => { res.json({ success: true, task: await tasks.removeLink(req.db, req.me, req.params.key, req.params.id) }); }));

router.post('/:key/delegate', handled(async (req, res) => { res.json({ success: true, task: await tasks.delegateTask(req.db, req.me, req.params.key, { agentId: req.body?.agentId }) }); }));
router.post('/:key/activity', handled(async (req, res) => { res.json({ success: true, task: await tasks.reportActivity(req.db, req.me, req.params.key, { type: req.body?.type, body: req.body?.body }) }); }));
router.post('/:key/handoff', handled(async (req, res) => { res.status(201).json({ success: true, ...(await tasks.handoffTask(req.db, req.me, req.params.key)) }); }));

export default router;
