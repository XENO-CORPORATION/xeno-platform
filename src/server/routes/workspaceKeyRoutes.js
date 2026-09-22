import express from 'express';
import { scopesForClient } from '../config/oidcAuthorityPolicy.js';
import { listWorkspaceApiKeys, mutateWorkspaceApiKey, readWorkspaceKeyOperation } from '../services/workspaceApiKeys.js';

export const workspaceKeyRoutes = express.Router({ mergeParams: true });
// Parent router has already verified this exact request's DPoP proof. Do not
// consume it twice. Existing legacy sessions remain valid elsewhere, not here.
workspaceKeyRoutes.use((req, res, next) => {
  const auth = req.auth;
  if (auth?.kind !== 'oidc' || !auth.dpopJkt) return res.status(401).json({ success: false, error: 'sender_bound_account_required' });
  if (!String(auth.scope).split(/\s+/).includes('team:manage') || !scopesForClient(auth.clientId)?.includes('team:manage')) return res.status(403).json({ success: false, error: 'insufficient_scope' });
  const age = Date.now() / 1000 - Number(auth.authTime);
  if (req.method !== 'GET' && req.method !== 'HEAD' && (!Number.isFinite(age) || age < -60 || age > 300)) {
    res.set('WWW-Authenticate', 'DPoP error="insufficient_user_authentication", max_age="300"');
    return res.status(401).json({ success: false, error: 'insufficient_user_authentication' });
  }
  res.set('Cache-Control', 'no-store'); return next();
});
const handle = fn => (req, res) => Promise.resolve(fn(req, res)).catch(error => res.status(error.status || 503).json({ success: false, error: error.status ? error.code : 'workspace_key_operation_failed' }));
workspaceKeyRoutes.get('/', handle(async (req, res) => res.json({ success: true, ...await listWorkspaceApiKeys(req.db, req.params.id, req.user.id, req.query) })));
workspaceKeyRoutes.get('/operations/:operationId', handle(async (req, res) => res.json({ success: true, ...await readWorkspaceKeyOperation(req.db, req.params.id, req.user.id, req.auth.clientId, req.params.operationId) })));
workspaceKeyRoutes.post('/operations/:operationId/abandon', handle(async (req, res) => {
  const original = req.body?.request;
  if (!req.body || Object.keys(req.body).some(key => key !== 'request') || !original || typeof original !== 'object' || Array.isArray(original) || Object.hasOwn(original, 'operation_id')) {
    return res.status(400).json({ success: false, error: 'invalid_workspace_key_request' });
  }
  const { action, ...input } = original;
  const result = await mutateWorkspaceApiKey(req.db, req.params.id, req.user.id, action, { ...input, operation_id: req.params.operationId }, req.auth.clientId, { abandon: true });
  res.json({ success: true, operation: result.operation, replayed: result.replayed });
}));
workspaceKeyRoutes.post('/', handle(async (req, res) => res.status(201).json({ success: true, ...await mutateWorkspaceApiKey(req.db, req.params.id, req.user.id, 'create', req.body, req.auth.clientId) })));
workspaceKeyRoutes.post('/:keyId/rotate', handle(async (req, res) => res.json({ success: true, ...await mutateWorkspaceApiKey(req.db, req.params.id, req.user.id, 'rotate', { ...req.body, id: req.params.keyId }, req.auth.clientId) })));
workspaceKeyRoutes.delete('/:keyId', handle(async (req, res) => res.json({ success: true, ...await mutateWorkspaceApiKey(req.db, req.params.id, req.user.id, 'revoke', { ...req.body, id: req.params.keyId }, req.auth.clientId) })));
