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
import { creditsView, subscriptionView } from '../utils/accountViews.js';

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

/** Billing overview: credits (balance + lifetimes + frozen) + active subscription (or null). */
router.get('/overview', authMiddleware, async (req, res) => {
  try {
    const [credits, subscription] = await Promise.all([
      creditsView(req.db, req.user.id),
      subscriptionView(req.db, req.user.id),
    ]);
    res.json({ success: true, overview: { credits, subscription } });
  } catch (err) {
    console.error('[billing] overview error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load billing overview' });
  }
});

/** Active subscription only (or null). */
router.get('/subscription', authMiddleware, async (req, res) => {
  try {
    res.json({ success: true, subscription: await subscriptionView(req.db, req.user.id) });
  } catch (err) {
    console.error('[billing] subscription error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load subscription' });
  }
});

/** The user's credit-ledger history (paginated); amounts in whole credits. */
router.get('/ledger', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const acct = (await req.db.query('SELECT id FROM credit_accounts WHERE user_id = $1', [req.user.id])).rows[0];
    if (!acct) return res.json({ success: true, ledger: [], total: 0 });
    const total = (await req.db.query('SELECT COUNT(*)::int AS n FROM credit_transactions WHERE account_id = $1', [acct.id])).rows[0].n;
    const rows = (await req.db.query(
      `SELECT id, type, amount, balance_after, description, reference_type, reference_id, metadata, created_at
         FROM credit_transactions WHERE account_id = $1
        ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [acct.id, limit, offset],
    )).rows;
    const M = 1_000_000;
    res.json({
      success: true,
      total,
      ledger: rows.map((r) => ({
        id: String(r.id),
        type: r.type,
        amount: Number(r.amount) / M,
        balance_after: Number(r.balance_after) / M,
        description: r.description || null,
        reference_type: r.reference_type || null,
        reference_id: r.reference_id || null,
        metadata: r.metadata || {},
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    console.error('[billing] ledger error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load ledger' });
  }
});

/** Public: plan tiers for the pricing UI (Free + subscription plans). */
router.get('/pricing-tiers', async (req, res) => {
  try {
    const subs = billing.getCatalog().filter((i) => i.kind === 'subscription' && i.id !== 'team_monthly');
    const tiers = [
      { id: 'free', name: 'Free', monthly_price: 0, credits_included: 0, features: billing.entitlementsFor('free') },
      ...subs.map((i) => ({
        id: i.id,
        name: i.label,
        monthly_price: i.price,
        credits_included: i.credits || 0,
        features: billing.entitlementsFor(i.plan),
      })),
    ];
    res.json({ success: true, tiers });
  } catch (err) {
    console.error('[billing] pricing-tiers error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load pricing tiers' });
  }
});

/** Create a Stripe Checkout session for a catalog item; returns the redirect URL. */
router.post('/checkout', requireEnabled, authMiddleware, async (req, res) => {
  try {
    const itemId = req.body?.itemId;
    if (!itemId || typeof itemId !== 'string') {
      return res.status(400).json({ success: false, error: 'itemId is required' });
    }
    /* The download intent, if this checkout was reached from a Download button.
     * Passed as an OPAQUE token, never as a URL: createCheckout builds the
     * return destination itself, because a client-supplied success_url is an
     * open redirect with a payment attached. */
    const downloadIntent = typeof req.body?.downloadIntent === 'string'
      ? req.body.downloadIntent
      : null;
    const { url } = await billing.createCheckout(req.db, req.user, itemId, {
      origin: originOf(req), downloadIntent,
    });
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
