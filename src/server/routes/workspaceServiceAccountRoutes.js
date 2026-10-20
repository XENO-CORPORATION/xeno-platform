/**
 * /api/workspaces/:id/service-accounts — a workspace admin lists the service accounts in the workspace and grants or
 * revokes their named capabilities (D-3, services/serviceAccountGrants.js). Every change is audited.
 *
 *   GET    /                                   the service accounts and their grants
 *   GET    /:serviceId                         one, with its grant history
 *   PUT    /:serviceId/capabilities/:name      grant
 *   DELETE /:serviceId/capabilities/:name      revoke
 */
import express from 'express';
import { listServiceAccounts, getServiceAccount, setServiceGrant, ServiceGrantError } from '../services/serviceAccountGrants.js';

const router = express.Router({ mergeParams: true });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (e instanceof ServiceGrantError) return res.status(e.status).json({ success: false, error: e.message, code: e.code });
  console.error('[service-accounts]', req.method, req.originalUrl, '-', e.message);
  if (!res.headersSent) res.status(500).json({ success: false, error: 'Internal error' });
});
const who = (req) => ({ workspaceId: req.params.id, userId: req.user.id });

router.get('/', wrap(async (req, res) => res.json({ success: true, ...(await listServiceAccounts(req.db, who(req))) })));
router.get('/:serviceId', wrap(async (req, res) => res.json({ success: true, ...(await getServiceAccount(req.db, { ...who(req), serviceId: req.params.serviceId })) })));
router.put('/:serviceId/capabilities/:name', wrap(async (req, res) =>
  res.json({ success: true, ...(await setServiceGrant(req.db, { ...who(req), serviceId: req.params.serviceId, capability: req.params.name, granted: true })) })));
router.delete('/:serviceId/capabilities/:name', wrap(async (req, res) =>
  res.json({ success: true, ...(await setServiceGrant(req.db, { ...who(req), serviceId: req.params.serviceId, capability: req.params.name, granted: false })) })));

export default router;
