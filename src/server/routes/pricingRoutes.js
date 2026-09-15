/**
 * /api/v2/pricing/* — the public price list for premium chat.
 *
 * Pricing is public information (it is on the pricing page), and it has ONE source:
 * `../utils/creditCosts.js`. The inference gateway reads this to decorate `/v1/models`,
 * and the website reads it to render costs — neither keeps a copy. A caller that CHARGES
 * never uses these numbers; charging goes through `/api/v2/ledger/service/*`, which prices
 * from the same table server-side.
 */
import express from 'express';
import * as defaultPricing from '../utils/creditCosts.js';

export function createPricingRouter({ pricing = defaultPricing } = {}) {
  const router = express.Router();

  // GET /api/v2/pricing/chat — the tiers and overrides.
  // GET /api/v2/pricing/chat?model=<id> — the rates one model resolves to.
  router.get('/chat', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    const model = typeof req.query.model === 'string' ? req.query.model.trim() : '';
    if (model) return res.json({ model, ...pricing.chatRatesFor(model) });
    res.json(pricing.chatPriceList());
  });

  // GET /api/v2/pricing/chat/quote?model=&estInputTokens=&maxOutputTokens= — worst-case
  // reservation for a request, the number a hold would carry.
  router.get('/chat/quote', (req, res) => {
    const model = typeof req.query.model === 'string' ? req.query.model.trim() : '';
    if (!model) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'model required' } });
    const n = (v, d) => (v === undefined ? d : Number(v));
    const estInputTokens = n(req.query.estInputTokens, 0);
    const maxOutputTokens = n(req.query.maxOutputTokens, 1024);
    if (![estInputTokens, maxOutputTokens].every((x) => Number.isFinite(x) && x >= 0)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'estInputTokens and maxOutputTokens must be non-negative numbers' } });
    }
    res.json({
      model,
      ...pricing.chatRatesFor(model),
      estInputTokens: Math.round(estInputTokens),
      maxOutputTokens: Math.round(maxOutputTokens),
      holdMicro: pricing.estimateChatCostMicro(model, { inputTokens: Math.round(estInputTokens), maxOutputTokens: Math.round(maxOutputTokens) }),
    });
  });

  return router;
}

export default createPricingRouter();
