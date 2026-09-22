import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import { requireRecentOidcAuth } from '../middleware/recentOidcAuth.js';
import { scopesForClient } from '../config/oidcAuthorityPolicy.js';
import { normalizeOwnerScope } from '../services/workforceScope.js';
import { API_KEY_WORKFORCE_GRANT_CLIENTS, ApiKeyWorkforceCapabilityError,
  mutateApiKeyWorkforceCapabilities, readApiKeyWorkforceCapabilities } from '../services/apiKeyWorkforceCapabilities.js';

const router = express.Router();
router.use(authMiddleware, requireDpopIfBound, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.auth?.kind !== 'oidc' || !req.auth.dpopJkt || !req.auth.sid) return res.status(401).json({ success: false, code: 'denied', error: 'Sender-bound account session required.' });
  if (!String(req.auth.scope).split(/\s+/).includes('workforce:manage') || !scopesForClient(req.auth.clientId)?.includes('workforce:manage')) return res.status(403).json({ success: false, code: 'denied', error: 'Workforce management scope required.' });
  next();
}, express.json({ limit: 16384, strict: true }));
const handle = service => async (req, res) => {
  try {
    if (Buffer.byteLength(JSON.stringify(req.body ?? null), 'utf8') > 16384) return res.status(400).json({ success: false, code: 'bad_input', error: 'Invalid key capability request.' });
    const result = await service(req.db, { actorUserId: req.user.id, auth: req.auth }, req.body);
    return res.json({ ...result, success: true });
  } catch (error) {
    let details;
    if (error instanceof ApiKeyWorkforceCapabilityError && error.code === 'unavailable' && error.details?.reason === 'key_capability_state_uncertain') {
      try {
        const operationId = normalizeOwnerScope({ type: 'user', id: error.details.operationId }).id;
        const keyId = normalizeOwnerScope({ type: 'user', id: error.details.keyId }).id;
        if (operationId === String(req.body.operationId).toLowerCase() && keyId === String(req.body.keyId).toLowerCase()) details = { schemaVersion: 1, reason: 'key_capability_state_uncertain', operationId, keyId };
      } catch { /* Do not forward malformed recovery identity. */ }
    }
    const code = ['bad_input', 'denied', 'conflict', 'unavailable'].includes(error?.code) ? error.code : 'internal';
    return res.status({ bad_input: 400, denied: 403, conflict: 409, unavailable: 503, internal: 500 }[code]).json({ success: false, code,
      error: 'API key capability operation could not be confirmed.', ...(details ? { details } : {}) });
  }
};
router.post('/operations', requireRecentOidcAuth({ scope: 'workforce:manage', clients: API_KEY_WORKFORCE_GRANT_CLIENTS }), handle(mutateApiKeyWorkforceCapabilities));
router.post('/read', handle(readApiKeyWorkforceCapabilities));
router.use((error, _req, res, _next) => res.status(error?.type === 'entity.too.large' || error?.type === 'entity.parse.failed' ? 400 : 500)
  .json({ success: false, code: error?.type === 'entity.too.large' || error?.type === 'entity.parse.failed' ? 'bad_input' : 'internal', error: 'Invalid key capability request.' }));
export default router;
