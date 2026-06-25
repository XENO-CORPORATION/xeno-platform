/**
 * /api/v2/ledger/* — the spend surface the @xeno/account-client SDK calls.
 *
 * Mounted behind `authMiddleware` (req.user set) and `databaseMiddleware`
 * (req.db = pg pool), and only when LEDGER_V2_ENABLED — see index.js. Every
 * handler maps the ledger's error codes to the HTTP taxonomy the SDK expects
 * (402 insufficient, 403 frozen, 404 not found, 409 conflict).
 *
 * Idempotency: usage keys on transactionId, holds on holdId — the ledger
 * enforces it at the DB layer, so a retried request is a safe no-op.
 */
import express from 'express';
import {
  getBalanceV2,
  recordUsageV2,
  holdV2,
  settleHoldV2,
  voidHoldV2,
  verifyChainV2,
  usageSummary,
  addGrant,
  setSpendCap,
} from '../utils/creditLedgerV2.js';
import { check as authzCheck } from '../utils/authzReBAC.js';

const router = express.Router();

function sendErr(res, err) {
  const map = {
    INSUFFICIENT_CREDITS: 402,
    ACCOUNT_FROZEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    SPEND_CAP_EXCEEDED: 429,
  };
  const status = map[err.code] || 500;
  if (status === 500) console.error('[v2/ledger] error:', err.message);
  res.status(status).json({ error: { code: err.code || 'PLATFORM_ERROR', message: err.message } });
}

// GET /api/v2/ledger/verify — tamper-evidence: recompute the hash chain (Arch §5)
router.get('/verify', async (req, res) => {
  try {
    res.json(await verifyChainV2(req.db, req.user.id));
  } catch (err) {
    sendErr(res, err);
  }
});

// GET /api/v2/ledger/usage?from&to&groupBy=surface — the "where/what" view (§4.5)
router.get('/usage', async (req, res) => {
  try {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    res.json(await usageSummary(req.db, req.user.id, { from, to, groupBy: req.query.groupBy }));
  } catch (err) {
    sendErr(res, err);
  }
});

// PUT /api/v2/ledger/caps { windowSec, limitMicro } — set your OWN spend cap (only
// restricts; safe to self-serve). Arch §4.6.
router.put('/caps', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.windowSec || b.limitMicro == null) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'windowSec + limitMicro required' } });
    }
    res.json(await setSpendCap(req.db, req.user.id, { windowSec: b.windowSec, limitMicro: b.limitMicro }));
  } catch (err) {
    sendErr(res, err);
  }
});

// POST /api/v2/ledger/grants { userId?, amountMicro, kind?, priority?, expiresAt? }
// Creates credits → ADMIN ONLY (relation admin on system:credits), else anyone
// could print money. Arch §4.7.
router.post('/grants', async (req, res) => {
  try {
    const can = await authzCheck(req.db, { object: 'system:credits', relation: 'admin', subject: `user:${req.user.id}` });
    if (!can.allowed) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'ledger grant requires system admin' } });
    const b = req.body || {};
    const target = b.userId || req.user.id;
    res.json(await addGrant(req.db, target, { amountMicro: b.amountMicro, kind: b.kind, priority: b.priority, expiresAt: b.expiresAt || null, sourceRef: b.sourceRef || null }));
  } catch (err) {
    sendErr(res, err);
  }
});

// GET /api/v2/ledger/balance
router.get('/balance', async (req, res) => {
  try {
    res.json(await getBalanceV2(req.db, req.user.id));
  } catch (err) {
    sendErr(res, err);
  }
});

// POST /api/v2/ledger/usage  (idempotent on transactionId)
router.post('/usage', async (req, res) => {
  const b = req.body || {};
  if (!b.surface || !b.transactionId || !b.operation) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'surface, transactionId, operation required' } });
  }
  try {
    res.json(await recordUsageV2(req.db, req.user.id, {
      surface: b.surface,
      transactionId: b.transactionId,
      operation: b.operation,
      model: b.model ?? null,
      provider: b.provider ?? null,
      costMicro: b.costMicro ?? 0,
      inputTokens: b.inputTokens ?? null,
      outputTokens: b.outputTokens ?? null,
      dimensions: b.dimensions ?? {},
    }));
  } catch (err) {
    sendErr(res, err);
  }
});

// POST /api/v2/ledger/holds  (reserve; idempotent on holdId)
router.post('/holds', async (req, res) => {
  const b = req.body || {};
  if (!b.surface || !b.holdId || !b.amountMicro || !b.operation) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'surface, holdId, amountMicro, operation required' } });
  }
  try {
    res.json(await holdV2(req.db, req.user.id, {
      surface: b.surface,
      holdId: b.holdId,
      amountMicro: b.amountMicro,
      operation: b.operation,
      expiresInSeconds: b.expiresInSeconds ?? 900,
    }));
  } catch (err) {
    sendErr(res, err);
  }
});

// POST /api/v2/ledger/holds/:holdId/settle
router.post('/holds/:holdId/settle', async (req, res) => {
  try {
    res.json(await settleHoldV2(req.db, req.user.id, req.params.holdId, (req.body || {}).actualCostMicro ?? 0));
  } catch (err) {
    sendErr(res, err);
  }
});

// POST /api/v2/ledger/holds/:holdId/void
router.post('/holds/:holdId/void', async (req, res) => {
  try {
    res.json(await voidHoldV2(req.db, req.user.id, req.params.holdId));
  } catch (err) {
    sendErr(res, err);
  }
});

export default router;
