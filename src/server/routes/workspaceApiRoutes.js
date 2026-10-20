/**
 * REST over the capability catalogue (XENO WORKSPACE AGENT SURFACE - SPEC.md P1.2, approved 2026-10-20).
 *
 *   POST /api/v1/<division>/<domain>/<verb>     run one capability; body = its arguments (JSON)
 *   GET  /api/v1/<division>/<domain>/<verb>     the same, for a SAFE capability only; arguments from the query
 *   GET  /api/v1/openapi.json                   OpenAPI 3.1, GENERATED from the catalogue (never hand-written)
 *
 * GENERATED, not written: every path is a catalogue declaration with `rest` in its surfaces, and every call runs
 * through services/xenoMcp.callTool — the same category gate, idempotency, timeout and metadata-only call log as
 * /api/mcp. A route written by hand beside this is a defect (§19.3 rule 2). The credential is the same one /api/mcp
 * takes (an OAuth sign-in of an app, a platform agent's xtk_ credential, a scoped xwk_ key), resolved by the same
 * function, so REST and MCP see exactly the same caller.
 *
 * Reply: { success: true, data } — data is the capability's declared reply — or { success: false, error, code }.
 */
import express from 'express';
import { restCapabilities, byName } from '../capabilities/catalogue.js';
import { toWire } from '../capabilities/define.js';
import { WORKSPACE_SCOPES } from '../capabilities/scopes.js';
import * as mcp from '../services/xenoMcp.js';
import { callerOf, needsToken } from './xenoMcpRoutes.js';
import { taskTokenAuth } from './xenoTasksRoutes.js';
import { issuer } from '../config/hosts.js';

const router = express.Router();

/** tasks.task.create → /tasks/task/create */
export const restPath = (name) => `/${name.split('.').join('/')}`;

/** A tool error's code → its HTTP status. Anything not listed is a 400: the caller sent something this refused. */
const STATUS = {
  unknown_tool: 404, not_found: 404, task_not_found: 404, connection_not_found: 404,
  agents_only: 403, category_disabled: 403, forbidden: 403, not_allowed: 403, scope_missing: 403, insufficient_scope: 403,
  grant_missing: 403, step_up_required: 403, service_principal_denied: 403,
  idempotency_key_reused: 409, idempotency_in_progress: 409, folder_exists: 409,
  storage_full: 507, service_timeout: 504, service_failed: 502,
};

/** OpenAPI 3.1 for every REST capability. */
export function openapi(origin = issuer()) {
  const paths = {};
  for (const c of restCapabilities()) {
    const op = {
      operationId: toWire(c.name), summary: c.title, description: c.description, tags: [c.division],
      security: [{ oauth2: [c.scope] }, { bearer: [] }],
      'x-xeno-capability': c.name, 'x-xeno-class': c.class, 'x-xeno-scope': c.scope, 'x-xeno-cost': c.cost, 'x-xeno-idempotency': c.idempotency,
      ...(c.agentsOnly ? { 'x-xeno-agents-only': true } : {}),
      requestBody: { required: true, content: { 'application/json': { schema: c.input } } },
      parameters: [{ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' } }, { name: 'X-Xeno-Run-Id', in: 'header', required: false, schema: { type: 'string' } }],
      responses: {
        200: { description: 'Done', content: { 'application/json': { schema: { type: 'object', required: ['success', 'data'], properties: { success: { const: true }, data: c.reply } } } } },
        401: { description: 'Not signed in, or the sign-in or key was revoked' },
        403: { description: 'Signed in, but this credential lacks the scope or grant' },
      },
    };
    paths[`/api/v1${restPath(c.name)}`] = { post: op };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'XENO Workspace API', version: '1.0.0', description: 'Everything an agent can do on the XENO workspace, generated from the capability catalogue. The same capabilities are tools on /api/mcp.' },
    servers: [{ url: origin }],
    components: { securitySchemes: {
      oauth2: { type: 'oauth2', flows: { authorizationCode: { authorizationUrl: `${issuer()}/api/oauth2/authorize`, tokenUrl: `${issuer()}/api/oauth2/token`, scopes: Object.fromEntries(WORKSPACE_SCOPES.map((s) => [s, s])) } } },
      bearer: { type: 'http', scheme: 'bearer', description: 'A scoped workspace key (xwk_…) or a platform agent credential (xtk_…).' },
    } },
    paths,
  };
}

router.get('/openapi.json', (req, res) => { res.set('Cache-Control', 'public, max-age=300'); res.json(openapi()); });

/** Coerce query strings to the declared argument types (GET on a safe capability). */
function queryArgs(cap, query) {
  const out = {};
  for (const [k, v] of Object.entries(query || {})) {
    const t = ((cap.input.properties || {})[k] || {}).type;
    out[k] = t === 'integer' || t === 'number' ? Number(v) : t === 'boolean' ? v === 'true' : v;
  }
  return out;
}

const capabilityOf = (params) => {
  const name = [params.division, params.domain, params.verb].join('.');
  const c = byName.get(name);
  return c && c.surfaces.includes('rest') ? c : null;
};

async function run(req, res, args) {
  const cap = capabilityOf(req.params);
  if (!cap) return res.status(404).json({ success: false, error: 'No such capability', code: 'unknown_capability' });
  try {
    const caller = await callerOf(req, res, null, { rest: true }); if (!caller) return;
    const ctx = {
      project: String(req.headers['x-xeno-tasks-project'] || '') || null,
      idempotencyKey: String(req.headers['idempotency-key'] || '') || null,
      runId: String(req.headers['x-xeno-run-id'] || '') || null,
    };
    const { result, log } = await mcp.callTool(req.db, caller.actor, caller.connection, toWire(cap.name), args || {}, ctx);
    try { await mcp.logCall(req.db, caller.connection.id, log); } catch (e) { console.error('[xeno v1] log', e); }
    if (result && result.isError) {
      const code = (result.structuredContent && result.structuredContent.code) || 'refused';
      return res.status(STATUS[code] || 400).json({ success: false, error: (result.structuredContent && result.structuredContent.error) || 'Refused', code });
    }
    if (result && result._meta && result._meta['xeno/replayed']) res.set('Idempotent-Replayed', 'true');
    res.json({ success: true, data: (result && result.structuredContent) || null });
  } catch (error) {
    if (error && error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, code: error.code });
    console.error('[xeno v1]', error);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
}

router.post('/:division/:domain/:verb', needsToken, taskTokenAuth, (req, res) => run(req, res, req.body));
router.get('/:division/:domain/:verb', needsToken, taskTokenAuth, (req, res) => {
  const cap = capabilityOf(req.params);
  if (cap && cap.class !== 'safe') { res.set('Allow', 'POST'); return res.status(405).json({ success: false, error: 'This capability changes something: use POST', code: 'method_not_allowed' }); }
  return run(req, res, cap ? queryArgs(cap, req.query) : {});
});

export default router;
