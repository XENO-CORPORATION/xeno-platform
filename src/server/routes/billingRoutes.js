/**
 * Billing API — /api/billing
 *
 * The self-serve pay path: credit-pack + subscription checkout via Stripe, wired
 * to the v2 credit ledger (see billingService.js). Public config endpoint so the
 * pricing UI can render; auth-gated commerce endpoints.
 *
 * The Stripe WEBHOOK (`stripeWebhook`) is exported separately and mounted in
 * index.js with a RAW body parser BEFORE express.json — Stripe signature
 * verification requires the unparsed request body.
 *
 * Conventions reused: express.Router default export, req.user from authMiddleware,
 * req.db = pool from databaseMiddleware.
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import * as billing from '../services/billingService.js';

const router = express.Router();

function requireEnabled(req, res, next) {
  if (!billing.isEnabled()) {
    return res.status(503).json({ success: false, error: 'Billing is not configured on this server' });
  }
  next();
}

function originOf(req) {
  return req.get('origin') || `${req.protocol}://${req.get('host')}`;
}

/** Public: lets the pricing UI render plans + know whether checkout is live. */
router.get('/config', async (req, res) => {
  res.json({ success: true, ...(await billing.getConfig()) });
});

/** Current user's credit balance + billing-enabled flag + plan + entitlements. */
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    res.json({ success: true, ...(await billing.getSummary(req.db, req.user)) });
  } catch (err) {
    console.error('[billing] summary error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load billing summary' });
  }
});

/** The user's plan + feature entitlements — the gate every product reads. */
router.get('/entitlements', authMiddleware, async (req, res) => {
  try {
    res.json({ success: true, ...(await billing.getEntitlements(req.db, req.user.id)) });
  } catch (err) {
    console.error('[billing] entitlements error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load entitlements' });
  }
});

/** Create a Stripe Checkout session for a catalog item; returns the redirect URL. */
router.post('/checkout', requireEnabled, authMiddleware, async (req, res) => {
  try {
    const itemId = req.body?.itemId;
    if (!itemId || typeof itemId !== 'string') {
      return res.status(400).json({ success: false, error: 'itemId is required' });
    }
    const { url } = await billing.createCheckout(req.db, req.user, itemId, { origin: originOf(req) });
    res.json({ success: true, url });
  } catch (err) {
    console.error('[billing] checkout error:', err.message);
    res.status(err.status || 500).json({ success: false, error: err.message || 'Checkout failed' });
  }
});

/** Stripe billing portal (manage/cancel subscription, update card). */
router.post('/portal', requireEnabled, authMiddleware, async (req, res) => {
  try {
    const { url } = await billing.createPortal(req.db, req.user, { origin: originOf(req) });
    res.json({ success: true, url });
  } catch (err) {
    console.error('[billing] portal error:', err.message);
    res.status(err.status || 500).json({ success: false, error: err.message || 'Could not open billing portal' });
  }
});

/**
 * Stripe webhook. Mounted in index.js as:
 *   app.use('/api/billing/webhook', express.raw({ type: 'application/json' }),
 *           (req,res,next)=>{ req.db = pool; next(); }, stripeWebhook)
 * so `req.body` is the raw Buffer required for signature verification.
 */
export async function stripeWebhook(req, res) {
  if (!billing.isEnabled()) return res.status(503).send('billing disabled');
  const signature = req.headers['stripe-signature'];
  let event;
  try {
    event = billing.constructEvent(req.body, signature);
  } catch (err) {
    console.error('[billing] webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  try {
    const result = await billing.handleEvent(req.db, event);
    return res.json({ received: true, ...result });
  } catch (err) {
    console.error('[billing] webhook handler error:', err.message);
    // 500 → Stripe will retry; the idempotency guard makes retries safe.
    return res.status(500).send('handler error');
  }
}

export default router;
