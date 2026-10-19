// XENO-WORKFORCE-01 ACCT-02..ACCT-08 -- the account API for gifts, returns, gift preferences and history.
//
// The services (accountGifts.js, accountHistory.js) were built and tested with no route, so nothing could call
// them. This adapter only authenticates and bounds the body; every rule lives in the service.
//
//   - Money movement (a gift, a return) needs a sender-bound DPoP account session, `ledger:spend`, and recent
//     authentication -- the same bar as a project contribution (workforceFundingRoutes.js).
//   - 🔒 It is CLOSED by default. §22.1: "Payment-provider acceptance of the actual gifting/contribution/rental
//     flow ... Do not activate a flow merely because implementation tests pass." `ACCOUNT_GIFTS_OPEN=true` is the
//     one switch, and it is read per request so it fails closed when unset, misspelled or removed. Closed answers
//     503 `gifts_closed` for preview and commit alike, so a closed flow cannot even be rehearsed against a recipient.
//   - Opting out (preferences) and reading history are NEVER gated: a person must be able to refuse gifts before
//     anyone can send one, and see what they have received.
//   - The dispute reversal is an operator process, not a customer call; it is deliberately not routed here.
// The body can name neither the actor nor the receipt namespace: both come from the authenticated session.
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import { requireRecentOidcAuth } from '../middleware/recentOidcAuth.js';
import { scopesForClient } from '../config/oidcAuthorityPolicy.js';
import { API_KEY_WORKFORCE_GRANT_CLIENTS } from '../services/apiKeyWorkforceCapabilities.js';
import * as gifts from '../services/accountGifts.js';
import { readAccountHistory, HistoryError } from '../services/accountHistory.js';

export const giftsOpen = (env = process.env) => env.ACCOUNT_GIFTS_OPEN === 'true';

const scoped = (req, scope) => String(req.auth?.scope || '').split(/\s+/).includes(scope) && !!scopesForClient(req.auth?.clientId)?.includes(scope);

export function createAccountGiftRouter({ env = process.env, recentAuth } = {}) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.vary('Authorization'); next(); });
  router.use(authMiddleware, requireDpopIfBound, (req, res, next) => {
    if (req.auth?.kind !== 'oidc' || !req.auth.sid || !req.auth.dpopJkt) return res.status(401).json({ success: false, code: 'denied', error: 'Sender-bound account session required.' });
    next();
  }, express.json({ limit: '16kb', strict: true }));
  const recent = recentAuth || requireRecentOidcAuth({ scope: 'ledger:spend', clients: API_KEY_WORKFORCE_GRANT_CLIENTS });
  const spend = (req, res, next) => scoped(req, 'ledger:spend') ? next() : res.status(403).json({ success: false, code: 'denied', error: 'Ledger spending scope required.' });
  const read = (req, res, next) => (scoped(req, 'ledger:read') || scoped(req, 'ledger:spend')) ? next() : res.status(403).json({ success: false, code: 'denied', error: 'Ledger read scope required.' });
  const open = (_req, res, next) => giftsOpen(env) ? next() : res.status(503).json({ success: false, code: 'gifts_closed', error: 'Gifting is not open yet.' });
  const handle = (service) => async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ success: false, code: 'bad_input' });
      if (['actorUserId', 'clientId', 'userId', 'payerUserId', 'senderUserId'].some((k) => Object.hasOwn(body, k))) return res.status(400).json({ success: false, code: 'bad_input' });
      return res.json({ success: true, result: await service(req.db, { actorUserId: req.user.id, clientId: req.auth.clientId }, body) });
    } catch (error) {
      if (error instanceof gifts.GiftError || error instanceof HistoryError) return res.status(error.status).json({ success: false, code: error.code, details: error.details });
      return res.status(503).json({ success: false, code: 'unavailable', error: 'Gift operation unavailable; reconcile the same operation before retrying.' });
    }
  };
  router.post('/preview', open, spend, handle(gifts.previewGift));
  router.post('/', open, spend, recent, handle(gifts.giftCredits));
  router.post('/returns/preview', open, spend, handle(gifts.previewGiftReturn));
  router.post('/returns', open, spend, recent, handle(gifts.returnGift));
  router.post('/preferences', spend, handle(gifts.setGiftPreferences));
  router.post('/history', read, handle(gifts.listGiftHistory));
  router.post('/account-history', read, handle(readAccountHistory));
  router.use((error, _req, res, _next) => res.status(error?.type === 'entity.too.large' || error?.type === 'entity.parse.failed' ? 400 : 503)
    .json({ success: false, code: 'bad_input', error: 'Invalid gift request.' }));
  return router;
}

export default createAccountGiftRouter();
