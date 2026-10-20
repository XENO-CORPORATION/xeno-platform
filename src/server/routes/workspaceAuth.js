/**
 * The credential middleware for the workspace agent surface — /api/mcp and /api/v1 ONLY (XENO WORKSPACE AGENT
 * SURFACE - SPEC.md P2). Nothing else mounts it, which is what keeps the 'xeno-workspace' audience refused by every
 * other API: authMiddleware requires 'xeno-api', and /api/tasks keeps taskTokenAuth (Tasks audience only).
 *
 *   Bearer xwk_…          a headless workspace key (services/workspaceCredentials.js)
 *   Bearer <JWT>, aud xeno-workspace   an OAuth sign-in of a self-registered app
 *   anything else         handed to taskTokenAuth unchanged (xtk_ credentials, Tasks-audience sign-ins)
 *
 * Only a FAILED VERIFICATION reads "sign in again". Any other failure is a real error and says so (Tasks rule, #675).
 */
import { verifyWorkspaceAccessToken, getClient, DYNAMIC_SCOPES, WORKSPACE_AUDIENCE } from '../utils/oidcProvider.js';
import { taskTokenAuth } from './xenoTasksRoutes.js';
import * as tasks from '../services/xenoTasks.js';
import { resolveKey } from '../services/workspaceCredentials.js';

const isJwt = (b) => /^[\w-]+\.[\w-]+\.[\w-]+$/.test(b);

export function workspaceTokenAuth(challenge) {
  return async (req, res, next) => {
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1]?.trim() || null;
    if (bearer && bearer.startsWith('xwk_')) {
      try {
        const k = await resolveKey(req.db, bearer);
        if (!k) return challenge(req, res, { success: false, error: 'This workspace key is not valid (unknown, expired or revoked)', code: 'invalid_token' }, 'invalid_token');
        req.user = { id: String(k.agent_user_id) };
        req.taskToken = { via: 'xwk', audience: WORKSPACE_AUDIENCE, agentUserId: String(k.agent_user_id), ownerId: String(k.owner_user_id), scopes: k.scopes, keyId: String(k.id), keyName: k.name, workspaceId: String(k.workspace_id), clientId: `key:${k.id}`, authTime: null };
        return next();
      } catch (e) { console.error('[workspace auth] key', e); return res.status(500).json({ success: false, error: 'Internal server error' }); }
    }
    if (bearer && isJwt(bearer)) {
      let claims;
      try { claims = await verifyWorkspaceAccessToken(req.db, bearer); }
      catch { return challenge(req, res, { success: false, error: 'This sign-in is no longer valid. Sign in again.', code: 'invalid_token' }, 'invalid_token'); }
      if (claims) {
        try {
          const scopes = String(claims.scope || '').split(/\s+/).filter((s) => DYNAMIC_SCOPES.includes(s));
          if (!scopes.length) return challenge(req, res, { success: false, error: 'This sign-in has no workspace access', code: 'insufficient_scope' }, 'insufficient_scope');
          const client = claims.client_id ? await getClient(req.db, claims.client_id) : null;
          const bound = claims.client_id ? await tasks.boundAgentFor(req.db, claims.sub, claims.client_id) : null;
          const agentId = bound || await tasks.mcpAgentFor(req.db, claims.sub, client ? client.name : null);
          req.user = { id: agentId };
          req.taskToken = { via: 'oauth', audience: WORKSPACE_AUDIENCE, agentUserId: agentId, scopes, taskId: null, clientId: claims.client_id || null, ownerId: String(claims.sub), authTime: claims.auth_time ?? null };
          return next();
        } catch (e) {
          if (e instanceof tasks.TaskError) return res.status(e.status).json({ success: false, error: e.message, code: e.code });
          console.error('[workspace auth] sign-in', e);
          return res.status(500).json({ success: false, error: 'Internal server error' });
        }
      }
    }
    return taskTokenAuth(req, res, next);
  };
}
