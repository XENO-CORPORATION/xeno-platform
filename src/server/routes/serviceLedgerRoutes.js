/**
 * /api/v2/ledger/service/* — SERVICE-authenticated ledger surface, and THE pricing authority.
 *
 * A trusted backend service (xeno-agents-api, the inference gateway on api.xenostudio.ai)
 * meters spend ON BEHALF OF a specified user, using a shared service token — WITHOUT the
 * user's own OIDC session. Every request carries an explicit `userId`; the caller can act
 * on ANY user, so the bearer token is a HIGH-VALUE secret (constant-time compared, never
 * logged, fail-closed when unset).
 *
 * 🔴 THE CALLER SENDS TOKENS, NEVER MONEY. `XENO ACCOUNT - ARCHITECTURE.md` §1 makes
 * xeno-platform the origin for the ledger AND pricing, and the inference layer the metering
 * point that posts usage here. Until 2026-09-15 this surface only accepted `amountMicro` —
 * the caller priced — and the gateway kept a second price table that charged Opus 5 at the
 * `default` rate, about 1/50 of cost, while writing straight into this database. Two
 * writers, two price lists, one wallet. Now a caller describes what was consumed
 * (`pricing` on a hold, `usage` on a settle or a one-shot debit) and this file prices it
 * from `../utils/creditCosts.js`, the single table. The table is never published: pricing
 * standard §8 refuses a public token/compute mapping, so rates leave this process only
 * behind the service token. `amountMicro` / `actualCostMicro` stay
 * accepted for the one existing caller that still sends them (xeno-agents-api), so this is
 * additive; new callers must not use them.
 *
 * Deliberately SEPARATE from the user-facing `v2LedgerRoutes.js`. Same ledger engine
 * (holdV2 / settleHoldV2 / voidHoldV2 / recordUsageV2 / getBalanceV2), same error taxonomy
 * (402 insufficient, 403 frozen, 404 not found, 409 conflict).
 *
 * Auth: `Authorization: Bearer <LEDGER_SERVICE_TOKEN>`. Unset/empty → 401 for everything.
 *
 * Mounted with databaseMiddleware (req.db = pg pool) but WITHOUT authMiddleware (there is
 * no req.user) — service auth lives entirely in this file.
 */
import express from 'express';
import crypto from 'node:crypto';
import * as defaultLedger from '../utils/creditLedgerV2.js';
import * as defaultPricing from '../utils/creditCosts.js';

// Same error taxonomy as v2LedgerRoutes.sendErr (kept local so the two files
// share no mutable surface). 23505 (unique-violation on holdId replay) → 409.
function sendErr(res, err) {
  const map = {
    INSUFFICIENT_CREDITS: 402,
    ACCOUNT_FROZEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    SPEND_CAP_EXCEEDED: 429,
  };
  // A Postgres unique-violation on the holdId (concurrent replay racing past the
  // idempotency SELECT) is a conflict, not a 500.
  if (err && err.code === '23505') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'a hold with this holdId already exists (idempotent replay)' } });
  }
  const status = map[err.code] || 500;
  if (status === 500) console.error('[v2/ledger/service] error:', err.message);
  res.status(status).json({ error: { code: err.code || 'PLATFORM_ERROR', message: err.message } });
}

function badRequest(res, message) {
  return res.status(400).json({ error: { code: 'BAD_REQUEST', message } });
}

function unauthorized(res) {
  return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
}

const nonNegInt = (v) => Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null;

/**
 * Constant-time bearer-token gate. Fail-closed: an unset/empty
 * LEDGER_SERVICE_TOKEN rejects every request (the router is never open).
 * timingSafeEqual requires equal-length buffers, so we length-guard first.
 */
function makeRequireServiceToken(getExpected) {
  return function requireServiceToken(req, res, next) {
    const expected = getExpected();
    if (!expected) return unauthorized(res); // fail-closed when the secret is unset

    const header = req.headers.authorization || '';
    const prefix = 'Bearer ';
    if (!header.startsWith(prefix)) return unauthorized(res);
    const presented = header.slice(prefix.length);

    const a = Buffer.from(presented, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return unauthorized(res);
    if (!crypto.timingSafeEqual(a, b)) return unauthorized(res);
    return next();
  };
}

/**
 * Build the router. `ledger` and `pricing` are injectable so the pricing rules — the part
 * that decides money — can be tested without Postgres; production uses the defaults.
 */
export function createServiceLedgerRouter({
  ledger = defaultLedger,
  pricing = defaultPricing,
  getServiceToken = () => process.env.LEDGER_SERVICE_TOKEN,
} = {}) {
  const router = express.Router();
  router.use(makeRequireServiceToken(getServiceToken));

  /**
   * Worst-case reservation for a request. `pricing` is priced HERE; `amountMicro` is the
   * legacy caller-priced form. Exactly one of them must be present.
   */
  function holdAmount(b) {
    if (b.pricing && typeof b.pricing === 'object') {
      if (b.amountMicro !== undefined) return { error: 'send either pricing or amountMicro, not both' };
      const { model, estInputTokens, maxOutputTokens } = b.pricing;
      if (!model || typeof model !== 'string') return { error: 'pricing.model required' };
      const inTok = nonNegInt(estInputTokens ?? 0);
      const maxOut = nonNegInt(maxOutputTokens ?? 1024);
      if (inTok === null || maxOut === null) return { error: 'pricing.estInputTokens and pricing.maxOutputTokens must be non-negative integers' };
      return {
        amountMicro: pricing.estimateChatCostMicro(model, { inputTokens: inTok, maxOutputTokens: maxOut }),
        priced: { model, tier: pricing.chatTier(model), estInputTokens: inTok, maxOutputTokens: maxOut },
      };
    }
    const legacy = nonNegInt(b.amountMicro);
    if (legacy === null || legacy <= 0) return { error: 'pricing { model, estInputTokens, maxOutputTokens } required (or legacy amountMicro)' };
    return { amountMicro: legacy, priced: null };
  }

  /**
   * Actual cost of what was consumed. `usage` is priced HERE; `actualCostMicro` is legacy.
   * `usage.measured === false` means the provider never reported output tokens: the caller's
   * numbers are an estimate, and an estimate must never settle BELOW the reservation — the
   * same rule the platform's own chat route applies (inferenceMeter.js). It settles at the
   * hold, which settleHoldV2 clamps to the held amount.
   */
  function settleAmount(b) {
    if (b.usage && typeof b.usage === 'object') {
      if (b.actualCostMicro !== undefined) return { error: 'send either usage or actualCostMicro, not both' };
      const { model, inputTokens, outputTokens, measured } = b.usage;
      if (!model || typeof model !== 'string') return { error: 'usage.model required' };
      const inTok = nonNegInt(inputTokens ?? 0);
      const outTok = nonNegInt(outputTokens ?? 0);
      if (inTok === null || outTok === null) return { error: 'usage.inputTokens and usage.outputTokens must be non-negative integers' };
      if (measured === false) return { actualCostMicro: Number.MAX_SAFE_INTEGER, priced: { model, measured: false, inputTokens: inTok, outputTokens: outTok } };
      return {
        actualCostMicro: pricing.getChatCostMicro(model, { inputTokens: inTok, outputTokens: outTok }),
        priced: { model, measured: true, inputTokens: inTok, outputTokens: outTok },
      };
    }
    const legacy = nonNegInt(b.actualCostMicro ?? 0);
    if (legacy === null) return { error: 'usage { model, inputTokens, outputTokens, measured } required (or legacy actualCostMicro)' };
    return { actualCostMicro: legacy, priced: null };
  }

  // GET /api/v2/ledger/service/balance?userId= — for a caller's admission gate.
  router.get('/balance', async (req, res) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
    if (!userId) return badRequest(res, 'userId required');
    try {
      res.json(await ledger.getBalanceV2(req.db, userId));
    } catch (err) {
      sendErr(res, err);
    }
  });

  // GET /api/v2/ledger/service/quote?model=&estInputTokens=&maxOutputTokens= — what a hold WOULD be.
  // Service-authenticated on purpose: per-token rates are internal (pricing standard §8).
  router.get('/quote', (req, res) => {
    const r = holdAmount({ pricing: {
      model: req.query.model, estInputTokens: req.query.estInputTokens, maxOutputTokens: req.query.maxOutputTokens,
    } });
    if (r.error) return badRequest(res, r.error);
    const rates = pricing.chatRatesFor(r.priced.model);
    res.json({ ...r.priced, holdMicro: r.amountMicro, rates });
  });

  // POST /api/v2/ledger/service/holds — reserve on behalf of userId. Idempotent on holdId.
  router.post('/holds', async (req, res) => {
    const b = req.body || {};
    const { userId, holdId, operation, surface } = b;
    if (!userId || !holdId || !operation || !surface) {
      return badRequest(res, 'userId, holdId, operation, surface required');
    }
    const amount = holdAmount(b);
    if (amount.error) return badRequest(res, amount.error);
    try {
      const hold = await ledger.holdV2(req.db, userId, {
        surface,
        holdId,
        amountMicro: amount.amountMicro,
        operation,
        expiresInSeconds: b.expiresInSeconds ?? 3600,
      });
      res.json({ ...hold, amountMicro: amount.amountMicro, pricing: amount.priced });
    } catch (err) {
      sendErr(res, err);
    }
  });

  // POST /api/v2/ledger/service/holds/:holdId/settle — debit actual, release remainder.
  router.post('/holds/:holdId/settle', async (req, res) => {
    const b = req.body || {};
    if (!b.userId) return badRequest(res, 'userId required');
    const amount = settleAmount(b);
    if (amount.error) return badRequest(res, amount.error);
    try {
      const settled = await ledger.settleHoldV2(req.db, b.userId, req.params.holdId, amount.actualCostMicro);
      res.json({ ...settled, pricing: amount.priced });
    } catch (err) {
      sendErr(res, err);
    }
  });

  // POST /api/v2/ledger/service/holds/:holdId/void — release without charging.
  router.post('/holds/:holdId/void', async (req, res) => {
    const b = req.body || {};
    if (!b.userId) return badRequest(res, 'userId required');
    try {
      res.json(await ledger.voidHoldV2(req.db, b.userId, req.params.holdId));
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * POST /api/v2/ledger/service/usage — one-shot meter + debit for a call whose cost is
   * known when it ends (a non-streaming completion). Idempotent on transactionId. Priced
   * here from `usage`; an unmeasured usage is still charged on the caller's token estimate,
   * because there is no reservation to fall back to — it is labelled in the ledger metadata.
   */
  router.post('/usage', async (req, res) => {
    const b = req.body || {};
    const { userId, transactionId, surface, operation } = b;
    if (!userId || !transactionId || !surface || !operation) {
      return badRequest(res, 'userId, transactionId, surface, operation required');
    }
    if (!b.usage || typeof b.usage !== 'object') return badRequest(res, 'usage { model, inputTokens, outputTokens, measured } required');
    const { model, inputTokens, outputTokens, measured } = b.usage;
    if (!model || typeof model !== 'string') return badRequest(res, 'usage.model required');
    const inTok = nonNegInt(inputTokens ?? 0);
    const outTok = nonNegInt(outputTokens ?? 0);
    if (inTok === null || outTok === null) return badRequest(res, 'usage.inputTokens and usage.outputTokens must be non-negative integers');
    const costMicro = pricing.getChatCostMicro(model, { inputTokens: inTok, outputTokens: outTok });
    try {
      const result = await ledger.recordUsageV2(req.db, userId, {
        transactionId,
        surface,
        operation,
        model,
        costMicro,
        inputTokens: inTok,
        outputTokens: outTok,
        dimensions: { usage_source: measured === false ? 'estimated' : 'provider' },
      });
      res.json({ ...result, costMicro, pricing: { model, measured: measured !== false, inputTokens: inTok, outputTokens: outTok } });
    } catch (err) {
      sendErr(res, err);
    }
  });

  return router;
}

export default createServiceLedgerRouter();
