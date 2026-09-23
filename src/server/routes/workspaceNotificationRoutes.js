import express from 'express';
import { readNotificationSettings, saveNotificationSettings, admitAgentNotification } from '../services/workspaceNotificationService.js';
import { executeNotificationDestinationOperation, prepareNotificationDestinationOperation, readNotificationDestinationOperation } from '../services/workspaceNotificationDestinationOperations.js';
const router = express.Router({ mergeParams: true });
// New Agent ingress has no legacy API-key/session-cookie compatibility path.
// The enclosing workspace router validates request-bound DPoP and OAuth scopes.
router.use((req, res, next) => req.auth?.kind === 'oidc' && req.auth.dpopJkt
  ? next() : res.status(401).json({ success: false, error: 'Canonical account authorization required' }));
const handle = fn => async (req, res) => {
  try {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid workspace' });
    return res.json(await fn(req));
  } catch (error) { return res.status([400,403,404,409,429].includes(error.status) ? error.status : 500).json({ success: false, error: 'Notification request refused or could not be confirmed', ...(error.code ? { code: error.code } : {}) }); }
};
router.get('/', handle(req => {
  let scope;
  try { scope = JSON.parse(req.query.scope || '{}'); } catch { const error = new Error('Invalid scope'); error.status = 400; throw error; }
  return readNotificationSettings(req.db, req.params.id, req.user.id, scope);
}));
router.post('/settings', handle(req => saveNotificationSettings(req.db, req.params.id, req.user.id, req.body)));
// A strict new projection cannot be silently served by an older server. Keep v1
// available to old consumers; v2 writes never fall back after an unknown outcome.
router.get('/v2', handle(req => {
  let scope;
  try { scope = JSON.parse(req.query.scope || '{}'); } catch { const error = new Error('Invalid scope'); error.status = 400; throw error; }
  return readNotificationSettings(req.db, req.params.id, req.user.id, scope, { channelVersion: 2 });
}));
router.post('/v2/settings', handle(req => saveNotificationSettings(req.db, req.params.id, req.user.id, req.body, { channelVersion: 2 })));
router.post('/events', handle(req => admitAgentNotification(req.db, req.params.id, req.user.id, req.body)));
router.put('/destination-operations/:operationId', handle(req => prepareNotificationDestinationOperation(req.db, req.params.id, req.user.id, req.auth.clientId, req.params.operationId, req.body)));
router.get('/destination-operations/:operationId', handle(req => readNotificationDestinationOperation(req.db, req.params.id, req.user.id, req.auth.clientId, req.params.operationId)));
router.post('/destination-operations/:operationId', handle(req => executeNotificationDestinationOperation(req.db, req.params.id, req.user.id, req.auth.clientId, req.params.operationId)));
export default router;
