/**
 * /api/connect/authority — the SERVICE-authenticated surface XENO Connect's host adapter calls (services/
 * connectAuthority.js). Auth: `Authorization: Bearer <CONNECT_SERVICE_TOKEN>`, constant-time; unset → 401 for
 * everything. Mounted with databaseMiddleware and WITHOUT authMiddleware: there is no signed-in person here, only the
 * Connect deployment asking what a person or token may do right now.
 *
 *   POST /token     { token, workspaceId }                     → Authority   (resolveVerifiedToken)
 *   POST /callback  { principalId, workspaceId, consumerId }   → Authority   (resolveBrowserCallback)
 */
import crypto from 'node:crypto';
import express from 'express';
import { authorityForCallback, authorityForToken, ConnectAuthorityError } from '../services/connectAuthority.js';

export function requireConnectServiceToken(getExpected = () => process.env.CONNECT_SERVICE_TOKEN) {
  return (req, res, next) => {
    const expected = getExpected();
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
    const a = Buffer.from(m ? m[1] : '', 'utf8'); const b = Buffer.from(expected || '', 'utf8');
    if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
  };
}

export function createConnectAuthorityRouter({ getExpected } = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }), requireConnectServiceToken(getExpected));
  const send = (fn) => async (req, res) => {
    try { res.set('cache-control', 'no-store'); res.json(await fn(req.db, req.body || {})); } catch (e) {
      if (e instanceof ConnectAuthorityError) return res.status(e.status).json({ error: e.code });
      console.error('[connect-authority]', e.message);
      return res.status(500).json({ error: 'authority_unavailable' });
    }
  };
  router.post('/token', send((db, b) => authorityForToken(db, { token: b.token, workspaceId: b.workspaceId })));
  router.post('/callback', send((db, b) => authorityForCallback(db, {
    principalId: b.principalId, workspaceId: b.workspaceId, consumerId: b.consumerId,
  })));
  return router;
}

export default createConnectAuthorityRouter();
