/**
 * /api/workforce/ownership-transfers -- the HTTP surface for OWN-05 ownership transfer.
 *
 * A transfer gives a resource -- and every secret reference and licence it carries -- to somebody
 * else, so it takes the same bar as the other act on this router that changes who holds workforce
 * authority (api-key capability grants): an OIDC session, sender-bound with DPoP, carrying
 * `workforce:manage` within its client's ceiling. The mutating acts additionally require a RECENT
 * authentication, so a stolen long-lived session cannot give a company's agents away. Reads and the
 * review subject need only the session.
 *
 * Never an API key and never a legacy header JWT: both are bearer credentials a script can hold,
 * and "a script moved our agents to another company" is exactly the outcome the two-sided
 * authorization exists to make impossible.
 *
 * Every act's authority is decided by the service against live ReBAC; this adapter authenticates,
 * bounds the body and translates typed refusals. It adds no authority of its own.
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import { requireRecentOidcAuth } from '../middleware/recentOidcAuth.js';
import { scopesForClient } from '../config/oidcAuthorityPolicy.js';
import {
  OwnershipTransferError, acceptOwnershipTransfer, authorizeOwnershipTransfer, declineOwnershipTransfer,
  proposeOwnershipTransfer, readOwnershipTransfer, reviewOwnershipTransfer, transferReviewSubject,
} from '../services/workforceOwnershipTransfer.js';
import { API_KEY_WORKFORCE_GRANT_CLIENTS } from '../services/apiKeyWorkforceCapabilities.js';

const MAX_BODY = 64 * 1024;
const router = express.Router();

router.use(authMiddleware, requireDpopIfBound, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.auth?.kind !== 'oidc' || !req.auth.dpopJkt || !req.auth.sid) {
    return res.status(401).json({ success: false, code: 'denied', error: 'Sender-bound account session required.' });
  }
  if (!String(req.auth.scope).split(/\s+/).includes('workforce:manage') || !scopesForClient(req.auth.clientId)?.includes('workforce:manage')) {
    return res.status(403).json({ success: false, code: 'denied', error: 'Workforce management scope required.' });
  }
  next();
}, express.json({ limit: MAX_BODY, strict: true }));

const recent = requireRecentOidcAuth({ scope: 'workforce:manage', clients: API_KEY_WORKFORCE_GRANT_CLIENTS });
const STATUS = { bad_input: 400, denied: 403, not_found: 404, conflict: 409 };

// Identity comes from authentication only; a body that tries to name the actor is refused.
const FORBIDDEN = ['actorUserId', 'userId', 'principal', 'auth'];
const handle = (service, pick) => async (req, res) => {
  try {
    const body = req.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body) || FORBIDDEN.some((key) => Object.hasOwn(body, key))) {
      return res.status(400).json({ success: false, code: 'bad_input', error: 'Invalid ownership transfer request.' });
    }
    const result = await service(req.db, { actorUserId: req.user.id, ...pick(req, body) });
    return res.json({ success: true, result });
  } catch (error) {
    if (error instanceof OwnershipTransferError) {
      return res.status(STATUS[error.code] ?? 500).json({ success: false, code: error.code, details: error.details,
        error: 'Ownership transfer refused.' });
    }
    console.error('[workforce] ownership transfer failed:', error?.message);
    return res.status(500).json({ success: false, code: 'internal', error: 'Ownership transfer failed.' });
  }
};
const transferId = (req) => ({ transferId: req.params.id });
const revision = (body) => (Object.hasOwn(body, 'expectedRevision') ? { expectedRevision: body.expectedRevision } : {});

router.post('/', recent, handle(proposeOwnershipTransfer, (_req, b) => ({ resourceId: b.resourceId, to: b.to, ...revision(b) })));
router.get('/:id', handle(readOwnershipTransfer, transferId));
router.get('/:id/review-subject', handle(transferReviewSubject, transferId));
router.post('/:id/authorize', recent, handle(authorizeOwnershipTransfer, (req, b) => ({ ...transferId(req), ...revision(b) })));
router.post('/:id/review', recent, handle(reviewOwnershipTransfer,
  (req, b) => ({ ...transferId(req), ...revision(b), agentVersion: b.agentVersion ?? null, review: b.review })));
router.post('/:id/accept', recent, handle(acceptOwnershipTransfer,
  (req, b) => ({ ...transferId(req), ...revision(b), rationale: b.rationale })));
router.post('/:id/decline', recent, handle(declineOwnershipTransfer,
  (req, b) => ({ ...transferId(req), ...revision(b), reason: b.reason })));

router.use((error, _req, res, _next) => {
  const parse = error?.type === 'entity.too.large' || error?.type === 'entity.parse.failed';
  return res.status(parse ? 400 : 500).json({ success: false, code: parse ? 'bad_input' : 'internal', error: 'Invalid ownership transfer request.' });
});

export default router;
