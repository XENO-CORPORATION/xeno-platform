/**
 * /api/chat/projects/:id/directories and /api/chat/directories/* -- ASN-07/ASN-08 bindings.
 *
 * Mounted inside chatRoutes, which authenticates. Every route here then requires what the service
 * requires: a DPoP-bound OIDC session, because only a sender-bound request names an installation,
 * and a binding without a host is exactly what ASN-07 forbids. The installation is taken from the
 * verified proof (`req.auth.dpopJkt`); no body or header field can choose it.
 */
import express from 'express';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import {
  DirectoryBindingError, bindProjectDirectory, executionRootFor, listProjectDirectories,
  projectForRoot, revokeProjectDirectory,
} from '../services/projectDirectoryBindings.js';

const router = express.Router();
router.use(['/projects/:id/directories', '/projects/:id/execution-root', '/directories'], requireDpopIfBound);

const FORBIDDEN = ['installationId', 'hostInstallationId', 'host', 'userId'];
const handle = (operation) => async (req, res) => {
  try {
    const body = req.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body) || FORBIDDEN.some((key) => Object.hasOwn(body, key))) {
      return res.status(400).json({ success: false, code: 'bad_input', error: 'The host is the authenticated installation.' });
    }
    return res.json({ success: true, ...(await operation(req, body)) });
  } catch (error) {
    if (error instanceof DirectoryBindingError) {
      return res.status(error.status).json({ success: false, code: error.code, error: error.message });
    }
    console.error('[chat] directory binding failed:', error?.message);
    return res.status(500).json({ success: false, code: 'internal', error: 'Directory binding failed.' });
  }
};

router.get('/projects/:id/directories', handle((req) =>
  listProjectDirectories(req.db, { userId: req.user.id, projectId: req.params.id })));
router.post('/projects/:id/directories', handle((req, body) => bindProjectDirectory(req.db, {
  userId: req.user.id, auth: req.auth, projectId: req.params.id,
  rootFamily: body.rootFamily, root: body.root, label: body.label ?? null })));
router.get('/projects/:id/execution-root', handle((req) =>
  executionRootFor(req.db, { userId: req.user.id, auth: req.auth, projectId: req.params.id })));
router.post('/directories/resolve', handle((req, body) =>
  projectForRoot(req.db, { userId: req.user.id, auth: req.auth, rootFamily: body.rootFamily, root: body.root })));
router.post('/directories/:bindingId/revoke', handle((req, body) => revokeProjectDirectory(req.db, {
  userId: req.user.id, auth: req.auth, bindingId: req.params.bindingId,
  ...(Object.hasOwn(body, 'expectedRevision') ? { expectedRevision: body.expectedRevision } : {}) })));

export default router;
