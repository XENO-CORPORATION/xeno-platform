import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import { scopesForClient } from '../config/oidcAuthorityPolicy.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { ProjectPublicationInputError } from '../config/projectPublicationContract.js';
import * as publication from '../services/projectPublication.js';

const router = express.Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex'); next(); });
router.use(apiLimiter);
function handle(operation) {
  return async (req, res) => {
    try { res.json({ success: true, result: await operation(req) }); }
    catch (error) {
      if (error instanceof publication.ProjectPublicationError || error instanceof ProjectPublicationInputError) {
        return res.status(error.status).json({ success: false, code: error.code, error: error.message });
      }
      return res.status(503).json({ success: false, code: 'unavailable', error: 'Publication unavailable. Reconcile the same operation before retrying.' });
    }
  };
}
router.get('/', handle(req => {
  const keys = Object.keys(req.query);
  if (keys.some(key => !['after', 'limit'].includes(key))) throw new ProjectPublicationInputError('unknown_field');
  return publication.discoverPublicProjects(req.db, { after: req.query.after ?? null, limit: req.query.limit === undefined ? 20 : Number(req.query.limit) });
}));
router.get('/:projectId', handle(req => publication.readPublicProject(req.db, req.params.projectId)));

const authorized = scope => (req, res, next) => {
  if (req.auth?.kind === 'legacy') {
    req.publicationContext = { actorUserId: req.user.id, clientId: 'legacy-project-session' };
    return next();
  }
  if (req.auth?.kind !== 'oidc' || !String(req.auth.scope || '').split(/\s+/).includes(scope)
    || !scopesForClient(req.auth.clientId)?.includes(scope)) {
    return res.status(403).json({ success: false, code: 'denied', error: 'Project scope required.' });
  }
  req.publicationContext = { actorUserId: req.user.id, clientId: req.auth.clientId };
  next();
};
const body = [express.json({ limit: '48kb', strict: true }), (req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Buffer.byteLength(JSON.stringify(req.body)) > 48 * 1024) {
    return res.status(400).json({ success: false, code: 'bad_input', error: 'Invalid publication request.' });
  }
  next();
}];
for (const [path, service, scope] of [
  ['/state', publication.readProjectPublication, 'projects:read'],
  ['/milestones', publication.readPublicationMilestones, 'projects:read'],
  ['/preview', publication.previewProjectPublication, 'projects:read'],
  ['/operations/read', publication.readProjectPublicationOperation, 'projects:read'],
  ['/operations', publication.mutateProjectPublication, 'projects:write'],
]) {
  router.post(path, authMiddleware, requireDpopIfBound, authorized(scope), body, handle(req => service(req.db, req.publicationContext, req.body)));
}
router.all(['/', '/:projectId', '/operations/read'], (_req, res) => res.status(405).json({ success: false, code: 'method_not_allowed' }));
router.use((error, _req, res, _next) => res.status(400).json({ success: false, code: 'bad_input', error: 'Invalid publication request.' }));
export default router;
