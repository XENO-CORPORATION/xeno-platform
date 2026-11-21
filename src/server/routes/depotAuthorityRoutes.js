/**
 * /api/depot/authority — the SERVICE-authenticated surface XENO Depot's gate calls (services/depotAuthority.js;
 * xeno-depot/docs/decisions/0001-depot-foundation.md §3). Auth: `Authorization: Bearer <DEPOT_SERVICE_TOKEN>`,
 * constant-time; unset → 401 for everything. Mounted with databaseMiddleware and WITHOUT authMiddleware: there is no
 * signed-in person here, only the Depot deployment asking what the bearer of a `xeno-depot` token may do right now.
 * The person's token always travels in the BODY, never in a URL, so it is never written to an access log.
 *
 *   POST /token                         { token, repoId? }              → Authority (door, principal, scopes, repo permissions)
 *   POST /repos                         { token, repoId, workspaceId }  → register a repo Depot just created
 *   POST /repos/:repoId/delete          { token }                       → remove a deleted repo's grants
 *   POST /repos/:repoId/grants/list     { token }                       → explicit grants on a repo
 *   POST /repos/:repoId/grants          { token, userId, permission }   → grant one permission
 *   POST /repos/:repoId/grants/revoke   { token, userId, permission }   → revoke one permission
 *   POST /workspaces/:workspaceId/repos { token }                       → the repo ids the bearer can read there
 */
import express from 'express';
import { requireConnectServiceToken } from './connectAuthorityRoutes.js';
import {
  DepotAuthorityError, authorityFor, grant, listGrants, readableRepos, registerRepo, revoke, unregisterRepo, verifyToken,
} from '../services/depotAuthority.js';

export function createDepotAuthorityRouter({ getExpected = () => process.env.DEPOT_SERVICE_TOKEN } = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }), requireConnectServiceToken(getExpected));
  const send = (fn) => async (req, res) => {
    try {
      res.set('cache-control', 'no-store');
      const b = req.body || {};
      const actor = await verifyToken(req.db, b.token);
      res.json(await fn(req.db, actor, b, req.params));
    } catch (e) {
      if (e instanceof DepotAuthorityError) return res.status(e.status).json({ error: e.code, message: e.message !== e.code ? e.message : undefined });
      console.error('[depot-authority]', e.message);
      return res.status(500).json({ error: 'authority_unavailable' });
    }
  };
  router.post('/token', send((db, actor, b) => authorityFor(db, actor, { repoId: b.repoId || null })));
  router.post('/repos', send((db, actor, b) => registerRepo(db, actor, { repoId: b.repoId, workspaceId: b.workspaceId })));
  router.post('/repos/:repoId/delete', send((db, actor, b, p) => unregisterRepo(db, actor, { repoId: p.repoId })));
  router.post('/repos/:repoId/grants/list', send((db, actor, b, p) => listGrants(db, actor, { repoId: p.repoId })));
  router.post('/repos/:repoId/grants', send((db, actor, b, p) => grant(db, actor, { repoId: p.repoId, userId: b.userId, permission: b.permission })));
  router.post('/repos/:repoId/grants/revoke', send((db, actor, b, p) => revoke(db, actor, { repoId: p.repoId, userId: b.userId, permission: b.permission })));
  router.post('/workspaces/:workspaceId/repos', send((db, actor, b, p) => readableRepos(db, actor, { workspaceId: p.workspaceId })));
  return router;
}

export default createDepotAuthorityRouter();
